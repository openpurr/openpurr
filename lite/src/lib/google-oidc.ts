// Verifies the OIDC ID token Pub/Sub attaches to authenticated push requests:
// "Authorization: Bearer <JWT>", RS256, signed with Google's keys.
//
// Checks: RS256 signature against Google's JWKS (https://www.googleapis.com/oauth2/v3/certs, from
// accounts.google.com's OpenID configuration); iss is https://accounts.google.com or
// accounts.google.com; aud is one we expect; exp hasn't passed (allowing a little clock skew);
// email is verified and is the configured push service account.
// Keys are cached per isolate for as long as Google's Cache-Control allows, and refetched once
// when a token names a key we haven't seen (Google rotates keys).

import { base64UrlToBytes } from "./der";

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_S = 300;

export class GoogleIdTokenError extends Error {}

export interface GoogleIdClaims {
  iss: string;
  aud: string;
  email?: string;
  email_verified?: boolean;
  exp: number;
  iat?: number;
  sub?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let jwks: { keys: Map<string, CryptoKey>; expires: number } | undefined;

async function loadKeys(fetchImpl: typeof fetch) {
  const res = await fetchImpl(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new GoogleIdTokenError(`Couldn't fetch Google's signing keys (${res.status})`);
  const body = await res.json<{ keys?: Jwk[] }>();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys ?? []) {
    if (k.kty !== "RSA") continue;
    keys.set(
      k.kid,
      await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
        "verify",
      ]),
    );
  }
  jwks = { keys, expires: Date.now() + Math.min(maxAge, 86_400) * 1000 };
  return jwks;
}

async function keyFor(kid: string, fetchImpl: typeof fetch) {
  let set = jwks && jwks.expires > Date.now() ? jwks : await loadKeys(fetchImpl);
  if (!set.keys.has(kid)) set = await loadKeys(fetchImpl); // maybe rotated since we cached
  const key = set.keys.get(kid);
  if (!key) throw new GoogleIdTokenError("Token signed with an unknown key");
  return key;
}

const json = (part: string) => JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));

/** Verifies signature, issuer, expiry and that the audience is one of `audiences`. Returns the claims. */
export async function verifyGoogleIdToken(
  token: string,
  audiences: string[],
  opts: { fetch?: typeof fetch; now?: number } = {},
): Promise<GoogleIdClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new GoogleIdTokenError("Not a JWT");
  let header: { alg?: string; kid?: string };
  let claims: GoogleIdClaims;
  let signature: Uint8Array;
  try {
    header = json(parts[0]!);
    claims = json(parts[1]!);
    signature = base64UrlToBytes(parts[2]!);
  } catch {
    throw new GoogleIdTokenError("Malformed JWT");
  }
  // Valid JSON, but nothing to read claims from.
  if (header === null || claims === null) throw new GoogleIdTokenError("Malformed JWT");
  if (header.alg !== "RS256" || !header.kid) throw new GoogleIdTokenError(`Unexpected token algorithm ${header.alg}`);

  const key = await keyFor(header.kid, opts.fetch ?? fetch);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new GoogleIdTokenError("Bad token signature");

  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!ISSUERS.has(claims.iss)) throw new GoogleIdTokenError(`Unexpected issuer ${claims.iss}`);
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < now) throw new GoogleIdTokenError("Token expired");
  if (!audiences.includes(claims.aud)) throw new GoogleIdTokenError(`Unexpected audience ${claims.aud}`);
  if (claims.email_verified !== true) throw new GoogleIdTokenError("Token email isn't verified");
  return claims;
}

/** Forget cached keys (tests). */
export function clearGoogleKeys() {
  jwks = undefined;
}
