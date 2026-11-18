// Mints the signed JWTs the stores require, with WebCrypto only (no Apple/Google SDKs, and
// no JWT library: signing two fixed-shape tokens doesn't justify its load cost).
//
// - App Store Server API: ES256 JWT signed with the App Store Connect .p8 key, sent as a
//   bearer token directly. Lifetime max 60 minutes.
// - Google Play Developer API: RS256 JWT signed with the service account key, exchanged at
//   oauth2.googleapis.com/token for an access token (that exchange is a fetch, not CPU).
//
// Imported keys are cached per isolate.

import { bytesToBase64Url, pemToDer } from "./der";

type Alg = "ES256" | "RS256";

const ALGS: Record<Alg, { importParams: SubtleCryptoImportKeyAlgorithm; signParams: SubtleCryptoSignAlgorithm }> = {
  // WebCrypto ECDSA signatures are already the raw r||s form JWS uses.
  ES256: { importParams: { name: "ECDSA", namedCurve: "P-256" }, signParams: { name: "ECDSA", hash: "SHA-256" } },
  RS256: { importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, signParams: { name: "RSASSA-PKCS1-v1_5" } },
};

const keyCache = new Map<string, CryptoKey>();

async function importKey(pem: string, alg: Alg, noCache: boolean): Promise<CryptoKey> {
  const cacheKey = `${alg}:${pem}`;
  const cached = noCache ? undefined : keyCache.get(cacheKey);
  if (cached) return cached;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pem), ALGS[alg].importParams, false, ["sign"]);
  if (!noCache) keyCache.set(cacheKey, key);
  return key;
}

const encoder = new TextEncoder();
const b64urlJson = (v: unknown) => bytesToBase64Url(encoder.encode(JSON.stringify(v)));

async function signJwt(alg: Alg, key: CryptoKey, header: Record<string, unknown>, claims: Record<string, unknown>) {
  const input = `${b64urlJson({ alg, ...header })}.${b64urlJson(claims)}`;
  const sig = new Uint8Array(await crypto.subtle.sign(ALGS[alg].signParams, key, encoder.encode(input)));
  return `${input}.${bytesToBase64Url(sig)}`;
}

export interface AppleApiCredentials {
  issuerId: string;
  keyId: string;
  bundleId: string;
  privateKeyPem: string;
}

export async function mintAppleApiToken(c: AppleApiCredentials, opts: { noCache?: boolean } = {}) {
  const key = await importKey(c.privateKeyPem, "ES256", !!opts.noCache);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    "ES256",
    key,
    { kid: c.keyId, typ: "JWT" },
    { iss: c.issuerId, iat: now, exp: now + 50 * 60, aud: "appstoreconnect-v1", bid: c.bundleId },
  );
}

export interface GoogleServiceAccount {
  clientEmail: string;
  privateKeyPem: string;
}

export const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** The signed assertion; exchange it with `exchangeGoogleAssertion`. */
export async function mintGoogleAssertion(sa: GoogleServiceAccount, opts: { noCache?: boolean } = {}) {
  const key = await importKey(sa.privateKeyPem, "RS256", !!opts.noCache);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    "RS256",
    key,
    { typ: "JWT" },
    {
      iss: sa.clientEmail,
      scope: ANDROID_PUBLISHER_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
  );
}

export async function exchangeGoogleAssertion(assertion: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return res.json();
}
