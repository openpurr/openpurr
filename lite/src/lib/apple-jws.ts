// Verifies App Store signed data (JWS with an x5c chain), the way Apple's
// app-store-server-library does, using only WebCrypto plus a small ASN.1 parser.
//
// Checks: alg is ES256; x5c is [leaf, intermediate, root]; the root is byte-identical to a
// trusted root; each certificate is signed by the next; all three are valid at the given
// time; the leaf and intermediate carry Apple's marker OIDs; the JWS signature verifies
// with the leaf key.
//
// Warm path: verified chains are cached per isolate, keyed by the leaf+intermediate
// base64, so a repeat chain costs one ECDSA P-256 verify.

import { AsnConvert } from "@peculiar/asn1-schema";
import { Certificate } from "@peculiar/asn1-x509";
import { base64ToBytes, base64UrlToBytes, bytesEqual, decodeOid, ecdsaDerToRaw, tbsBytes } from "./der";

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

interface ParsedCert {
  der: Uint8Array;
  cert: Certificate;
}

const chainCache = new Map<string, CryptoKey>();
const MAX_CACHE = 64;

export interface VerifyOptions {
  /** Trusted root certificates, DER. In production: Apple Root CA G3. */
  trustedRoots: Uint8Array[];
  /** Time at which certificates must be valid. Defaults to now. */
  at?: Date;
  /** Skip the per-isolate chain cache (for cold-path benchmarks). */
  noCache?: boolean;
}

export async function verifyAppleJws<T = unknown>(jws: string, opts: VerifyOptions): Promise<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new AppleJwsError("not a compact JWS");
  const [h, p, s] = parts as [string, string, string];

  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(h))) as {
    alg?: string;
    x5c?: string[];
  };
  if (header.alg !== "ES256") throw new AppleJwsError(`unexpected alg ${header.alg}`);
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3) throw new AppleJwsError("x5c must have 3 certificates");

  const cacheKey = x5c[0]! + x5c[1]!;
  let leafKey = opts.noCache ? undefined : chainCache.get(cacheKey);
  if (!leafKey) {
    leafKey = await verifyChain(x5c, opts);
    if (!opts.noCache) {
      if (chainCache.size >= MAX_CACHE) chainCache.clear();
      chainCache.set(cacheKey, leafKey);
    }
  }

  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    leafKey,
    base64UrlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new AppleJwsError("JWS signature invalid");
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(p))) as T;
}

async function verifyChain(x5c: string[], opts: VerifyOptions): Promise<CryptoKey> {
  const [leaf, intermediate, root] = x5c.map(parseCert) as [ParsedCert, ParsedCert, ParsedCert];

  if (!opts.trustedRoots.some((r) => bytesEqual(r, root.der))) {
    throw new AppleJwsError("root certificate is not trusted");
  }
  const at = opts.at ?? new Date();
  for (const c of [leaf, intermediate, root]) checkValidity(c, at);
  requireExtension(leaf, OID_LEAF_MARKER);
  requireExtension(intermediate, OID_INTERMEDIATE_MARKER);

  await checkSignedBy(intermediate, root);
  await checkSignedBy(leaf, intermediate);
  return importEcKey(leaf, "verify");
}

function parseCert(b64: string): ParsedCert {
  const der = base64ToBytes(b64);
  return { der, cert: AsnConvert.parse(der, Certificate) };
}

function checkValidity({ cert }: ParsedCert, at: Date) {
  const { notBefore, notAfter } = cert.tbsCertificate.validity;
  if (at < notBefore.getTime() || at > notAfter.getTime()) {
    throw new AppleJwsError("certificate not valid at the requested time");
  }
}

function requireExtension({ cert }: ParsedCert, oid: string) {
  if (!cert.tbsCertificate.extensions?.some((e) => e.extnID === oid)) {
    throw new AppleJwsError(`certificate missing extension ${oid}`);
  }
}

function curveOf({ cert }: ParsedCert) {
  const params = cert.tbsCertificate.subjectPublicKeyInfo.algorithm.parameters;
  if (!params) throw new AppleJwsError("EC key without curve parameters");
  const oid = decodeOid(new Uint8Array(params));
  const curve = CURVES[oid];
  if (!curve) throw new AppleJwsError(`unsupported curve ${oid}`);
  return curve;
}

async function importEcKey(c: ParsedCert, usage: "verify") {
  const spki = AsnConvert.serialize(c.cert.tbsCertificate.subjectPublicKeyInfo);
  return crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: curveOf(c).namedCurve }, false, [usage]);
}

async function checkSignedBy(child: ParsedCert, issuer: ParsedCert) {
  const hash = SIG_HASH[child.cert.signatureAlgorithm.algorithm];
  if (!hash) throw new AppleJwsError(`unsupported signature algorithm ${child.cert.signatureAlgorithm.algorithm}`);
  const issuerKey = await importEcKey(issuer, "verify");
  const sig = ecdsaDerToRaw(new Uint8Array(child.cert.signatureValue), curveOf(issuer).size);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash }, issuerKey, sig, tbsBytes(child.der));
  if (!ok) throw new AppleJwsError("certificate chain signature invalid");
}
