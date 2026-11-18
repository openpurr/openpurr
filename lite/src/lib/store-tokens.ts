// Mints the signed JWTs the stores require, with WebCrypto only (no Apple/Google SDKs).
//
// - App Store Server API: ES256 JWT signed with the App Store Connect .p8 key, sent as a
//   bearer token directly. Lifetime max 60 minutes.
// - Google Play Developer API: RS256 JWT signed with the service account key, exchanged at
//   oauth2.googleapis.com/token for an access token (that exchange is a fetch, not CPU).
//
// Imported keys and minted tokens are cached per isolate.

import { importPKCS8, SignJWT } from "jose";

const keyCache = new Map<string, CryptoKey>();

async function importKey(pem: string, alg: "ES256" | "RS256", noCache: boolean): Promise<CryptoKey> {
  const cached = noCache ? undefined : keyCache.get(pem);
  if (cached) return cached;
  const key = await importPKCS8(pem, alg);
  if (!noCache) keyCache.set(pem, key);
  return key;
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
  return new SignJWT({ bid: c.bundleId })
    .setProtectedHeader({ alg: "ES256", kid: c.keyId, typ: "JWT" })
    .setIssuer(c.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 50 * 60)
    .setAudience("appstoreconnect-v1")
    .sign(key);
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
  return new SignJWT({ scope: ANDROID_PUBLISHER_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
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
