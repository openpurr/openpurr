import { describe, expect, it } from "vitest";
import { TEST_APPLE_API_KEY_PEM, TEST_GOOGLE_SA_KEY_PEM } from "../src/bench/fixtures.generated";
import { base64UrlToBytes, pemToDer } from "../src/lib/der";
import { ANDROID_PUBLISHER_SCOPE, mintAppleApiToken, mintGoogleAssertion } from "../src/lib/store-tokens";

/** Derives the public key from a PKCS#8 private key, via JWK. */
async function publicKeyOf(pem: string, params: SubtleCryptoImportKeyAlgorithm) {
  const priv = await crypto.subtle.importKey("pkcs8", pemToDer(pem), params, true, ["sign"]);
  const { kty, crv, x, y, n, e } = (await crypto.subtle.exportKey("jwk", priv)) as JsonWebKey;
  return crypto.subtle.importKey("jwk", { kty, crv, x, y, n, e }, params, false, ["verify"]);
}

function decode(jwt: string) {
  const [h, p, s] = jwt.split(".") as [string, string, string];
  const json = (x: string) => JSON.parse(new TextDecoder().decode(base64UrlToBytes(x)));
  return { header: json(h), claims: json(p), signed: new TextEncoder().encode(`${h}.${p}`), sig: base64UrlToBytes(s) };
}

describe("store tokens", () => {
  it("mints an App Store Server API token Apple would accept", async () => {
    const jwt = await mintAppleApiToken({
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId: "2X9R4HXF34",
      bundleId: "com.example.openpurr",
      privateKeyPem: TEST_APPLE_API_KEY_PEM,
    });
    const { header, claims, signed, sig } = decode(jwt);
    expect(header).toEqual({ alg: "ES256", kid: "2X9R4HXF34", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: "57246542-96fe-1a63-e053-0824d011072a",
      aud: "appstoreconnect-v1",
      bid: "com.example.openpurr",
    });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    expect(sig).toHaveLength(64); // raw r||s, as JWS requires
    const params = { name: "ECDSA", namedCurve: "P-256" };
    const key = await publicKeyOf(TEST_APPLE_API_KEY_PEM, params);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, signed)).toBe(true);
  });

  it("mints a Google service-account assertion", async () => {
    const jwt = await mintGoogleAssertion({
      clientEmail: "openpurr@example.iam.gserviceaccount.com",
      privateKeyPem: TEST_GOOGLE_SA_KEY_PEM,
    });
    const { header, claims, signed, sig } = decode(jwt);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: "openpurr@example.iam.gserviceaccount.com",
      scope: ANDROID_PUBLISHER_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
    });
    const params = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const key = await publicKeyOf(TEST_GOOGLE_SA_KEY_PEM, params);
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed)).toBe(true);
  });
});
