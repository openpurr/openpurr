// Verifies App Store signed data (JWS with an x5c chain), the way Apple's
// app-store-server-library does, using only WebCrypto and the small DER reader in ./der.
//
// Checks: alg is ES256; x5c is [leaf, intermediate, root]; the root is byte-identical to a
// trusted root; each certificate is signed by the next; all three are valid at the given
// time; the leaf and intermediate carry Apple's marker OIDs; the JWS signature verifies
// with the leaf key.
//
// The chain check is the expensive part, so verified chains are remembered at two levels:
//   1. per isolate, in memory (the warm path: one ECDSA P-256 verify);
//   2. optionally in a ChainStore (D1 on Lite, Postgres on Standard), so a fresh isolate
//      imports the stored leaf key instead of re-verifying the chain.
// Apple signs with a handful of long-lived leaf certificates, so the store stays tiny and
// almost every request is a cache hit.

import {
  base64ToBytes,
  base64UrlToBytes,
  bytesEqual,
  bytesToBase64,
  DerError,
  ecdsaDerToRaw,
  parseX509,
  type X509Cert,
} from "./der";

const OID_LEAF_MARKER = "1.2.840.113635.100.6.11.1";
const OID_INTERMEDIATE_MARKER = "1.2.840.113635.100.6.2.1";

const CURVES: Record<string, { namedCurve: string; size: number }> = {
  "1.2.840.10045.3.1.7": { namedCurve: "P-256", size: 32 },
  "1.3.132.0.34": { namedCurve: "P-384", size: 48 },
};
const SIG_HASH: Record<string, string> = {
  "1.2.840.10045.4.3.2": "SHA-256",
  "1.2.840.10045.4.3.3": "SHA-384",
};

export class AppleJwsError extends Error {}

/** A chain that passed full verification. Validity is the intersection of all three certificates. */
export interface VerifiedChain {
  /** The leaf's SubjectPublicKeyInfo, base64 DER. */
  leafSpki: string;
  notBefore: number;
  notAfter: number;
}

/** Remembers verified chains across isolates. Entries are only ever written after full verification. */
export interface ChainStore {
  get(fingerprint: string): Promise<VerifiedChain | null>;
  put(fingerprint: string, chain: VerifiedChain): Promise<void>;
}

interface CachedChain {
  key: CryptoKey;
  notBefore: number;
  notAfter: number;
}

const isolateCache = new Map<string, CachedChain>();
const MAX_ISOLATE_CACHE = 64;

export interface VerifyOptions {
  /** Trusted root certificates, DER. In production: Apple Root CA G3. */
  trustedRoots: Uint8Array[];
  /** Time at which certificates must be valid. Defaults to now. */
  at?: Date;
  /** Shared store of verified chains. */
  store?: ChainStore;
  /** Benchmarks: skip the in-memory cache. */
  noIsolateCache?: boolean;
  /** Benchmarks: skip both caches and always verify the full chain. */
  noCache?: boolean;
}

export async function verifyAppleJws<T = unknown>(jws: string, opts: VerifyOptions): Promise<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new AppleJwsError("not a compact JWS");
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: unknown; x5c?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(h)));
  } catch {
    throw new AppleJwsError("malformed JWS header");
  }
  if (header.alg !== "ES256") throw new AppleJwsError(`unexpected alg ${String(header.alg)}`);
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3 || !x5c.every((c) => typeof c === "string")) {
    throw new AppleJwsError("x5c must have 3 certificates");
  }

  const at = (opts.at ?? new Date()).getTime();
  const chain = await resolveChain(x5c as [string, string, string], at, opts);
  if (at < chain.notBefore || at > chain.notAfter) {
    throw new AppleJwsError("certificate not valid at the requested time");
  }

  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    chain.key,
    base64UrlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new AppleJwsError("JWS signature invalid");
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(p))) as T;
  } catch {
    throw new AppleJwsError("malformed JWS payload");
  }
}

async function resolveChain(x5c: [string, string, string], at: number, opts: VerifyOptions): Promise<CachedChain> {
  const useIsolate = !opts.noCache && !opts.noIsolateCache;
  const useStore = !opts.noCache && opts.store;

  // The root must be trusted on every path, including cache hits, so that removing a root
  // from the trusted set takes effect immediately.
  const rootDer = decodeCert(x5c[2]);
  if (!opts.trustedRoots.some((r) => bytesEqual(r, rootDer))) {
    throw new AppleJwsError("root certificate is not trusted");
  }

  const isolateKey = x5c.join(".");
  if (useIsolate) {
    const hit = isolateCache.get(isolateKey);
    if (hit) return hit;
  }

  let fingerprint: string | undefined;
  if (useStore) {
    fingerprint = await chainFingerprint(x5c);
    const stored = await opts.store!.get(fingerprint);
    if (stored) {
      const key = await crypto.subtle.importKey(
        "spki",
        base64ToBytes(stored.leafSpki),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return remember(isolateKey, { key, notBefore: stored.notBefore, notAfter: stored.notAfter }, useIsolate);
    }
  }

  const verified = await verifyChain(x5c, rootDer, at);
  if (useStore) {
    await opts.store!.put(fingerprint!, {
      leafSpki: bytesToBase64(verified.leaf.spki),
      notBefore: verified.notBefore,
      notAfter: verified.notAfter,
    });
  }
  return remember(isolateKey, { key: verified.key, notBefore: verified.notBefore, notAfter: verified.notAfter }, useIsolate);
}

function remember(key: string, chain: CachedChain, enabled: boolean): CachedChain {
  if (enabled) {
    if (isolateCache.size >= MAX_ISOLATE_CACHE) isolateCache.clear();
    isolateCache.set(key, chain);
  }
  return chain;
}

/** SHA-256 over the three certificates' DER, hex. Identifies a chain in the ChainStore. */
async function chainFingerprint(x5c: [string, string, string]): Promise<string> {
  const ders = x5c.map(decodeCert);
  const all = new Uint8Array(ders.reduce((n, d) => n + d.length, 0));
  let off = 0;
  for (const d of ders) {
    all.set(d, off);
    off += d.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyChain(x5c: [string, string, string], rootDer: Uint8Array, at: number) {
  const [leaf, intermediate, root] = [parse(x5c[0]), parse(x5c[1]), parse(rootDer)];

  const notBefore = Math.max(leaf.notBefore, intermediate.notBefore, root.notBefore);
  const notAfter = Math.min(leaf.notAfter, intermediate.notAfter, root.notAfter);
  if (at < notBefore || at > notAfter) throw new AppleJwsError("certificate not valid at the requested time");
  requireExtension(leaf, OID_LEAF_MARKER);
  requireExtension(intermediate, OID_INTERMEDIATE_MARKER);
  if (curveOf(leaf).namedCurve !== "P-256") throw new AppleJwsError("leaf key must be P-256 for ES256");

  await checkSignedBy(intermediate, root);
  await checkSignedBy(leaf, intermediate);
  return { leaf, key: await importEcKey(leaf), notBefore, notAfter };
}

function decodeCert(b64: string): Uint8Array {
  try {
    return base64ToBytes(b64);
  } catch {
    throw new AppleJwsError("x5c entry is not base64");
  }
}

function parse(cert: string | Uint8Array): X509Cert {
  try {
    return parseX509(typeof cert === "string" ? decodeCert(cert) : cert);
  } catch (err) {
    if (err instanceof DerError) throw new AppleJwsError(`malformed certificate: ${err.message}`);
    throw err;
  }
}

function requireExtension(cert: X509Cert, oid: string) {
  if (!cert.extensionOids.includes(oid)) throw new AppleJwsError(`certificate missing extension ${oid}`);
}

function curveOf(cert: X509Cert) {
  const curve = cert.keyParamsOid ? CURVES[cert.keyParamsOid] : undefined;
  if (!curve) throw new AppleJwsError(`unsupported key curve ${cert.keyParamsOid ?? "(none)"}`);
  return curve;
}

function importEcKey(cert: X509Cert) {
  return crypto.subtle.importKey("spki", cert.spki, { name: "ECDSA", namedCurve: curveOf(cert).namedCurve }, false, [
    "verify",
  ]);
}

async function checkSignedBy(child: X509Cert, issuer: X509Cert) {
  const hash = SIG_HASH[child.signatureAlgorithm];
  if (!hash) throw new AppleJwsError(`unsupported signature algorithm ${child.signatureAlgorithm}`);
  let sig: Uint8Array;
  try {
    sig = ecdsaDerToRaw(child.signature, curveOf(issuer).size);
  } catch {
    throw new AppleJwsError("malformed certificate signature");
  }
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash }, await importEcKey(issuer), sig, child.tbs);
  if (!ok) throw new AppleJwsError("certificate chain signature invalid");
}
