// Generates TEST-ONLY keys and certificate chains for the tests and CPU benchmarks.
// Nothing here is trusted by any real system. The output is git-ignored and generated on
// demand (`--if-missing` from the test, typecheck and deploy:bench scripts). Force a fresh set:
//   pnpm --filter @openpurr/lite bench:fixtures
//
// The chain mirrors the shape of an App Store signed transaction:
//   root (P-384, self-signed) -> intermediate (P-384) -> leaf (P-256), JWS alg ES256, x5c header.
// Apple's real chain uses the same curves, so verification cost should be representative.

import { webcrypto as crypto } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { CompactSign, exportPKCS8 } from "jose";

const target = fileURLToPath(new URL("../src/bench/fixtures.generated.ts", import.meta.url));
if (process.argv.includes("--if-missing") && existsSync(target)) process.exit(0);

x509.cryptoProvider.set(crypto);

const P384 = { name: "ECDSA", namedCurve: "P-384" };
const P256 = { name: "ECDSA", namedCurve: "P-256" };
const SHA384 = { name: "ECDSA", hash: "SHA-384" };

const notBefore = new Date("2026-01-01T00:00:00Z");
const notAfter = new Date("2036-01-01T00:00:00Z");

const rootKeys = await crypto.subtle.generateKey(P384, true, ["sign", "verify"]);
const root = await x509.X509CertificateGenerator.createSelfSigned({
  serialNumber: "01",
  name: "CN=openpurr TEST Root CA, O=openpurr test fixtures",
  notBefore,
  notAfter,
  keys: rootKeys,
  signingAlgorithm: SHA384,
  extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
});

const intKeys = await crypto.subtle.generateKey(P384, true, ["sign", "verify"]);
const intermediate = await x509.X509CertificateGenerator.create({
  serialNumber: "02",
  subject: "CN=openpurr TEST Intermediate CA, O=openpurr test fixtures",
  issuer: root.subject,
  notBefore,
  notAfter,
  publicKey: intKeys.publicKey,
  signingKey: rootKeys.privateKey,
  signingAlgorithm: SHA384,
  extensions: [
    new x509.BasicConstraintsExtension(true, 0, true),
    // Same marker OID Apple puts on its WWDR intermediate.
    new x509.Extension("1.2.840.113635.100.6.2.1", false, new Uint8Array([0x05, 0x00])),
  ],
});

const leafKeys = await crypto.subtle.generateKey(P256, true, ["sign", "verify"]);
const leaf = await x509.X509CertificateGenerator.create({
  serialNumber: "03",
  subject: "CN=openpurr TEST Signing Leaf, O=openpurr test fixtures",
  issuer: intermediate.subject,
  notBefore,
  notAfter,
  publicKey: leafKeys.publicKey,
  signingKey: intKeys.privateKey,
  signingAlgorithm: SHA384,
  extensions: [
    new x509.BasicConstraintsExtension(false, undefined, true),
    // Same marker OID Apple puts on its App Store receipt-signing leaf.
    new x509.Extension("1.2.840.113635.100.6.11.1", false, new Uint8Array([0x05, 0x00])),
  ],
});

// Negative cases: a leaf without Apple's marker OID, and a leaf signed by a key that isn't
// the intermediate's.
const noMarkerKeys = await crypto.subtle.generateKey(P256, true, ["sign", "verify"]);
const leafNoMarker = await x509.X509CertificateGenerator.create({
  serialNumber: "04",
  subject: "CN=openpurr TEST Leaf Without Marker, O=openpurr test fixtures",
  issuer: intermediate.subject,
  notBefore,
  notAfter,
  publicKey: noMarkerKeys.publicKey,
  signingKey: intKeys.privateKey,
  signingAlgorithm: SHA384,
  extensions: [new x509.BasicConstraintsExtension(false, undefined, true)],
});

const strayKeys = await crypto.subtle.generateKey(P384, true, ["sign", "verify"]);
const wrongIssuerKeys = await crypto.subtle.generateKey(P256, true, ["sign", "verify"]);
const leafWrongIssuer = await x509.X509CertificateGenerator.create({
  serialNumber: "05",
  subject: "CN=openpurr TEST Leaf Wrong Issuer, O=openpurr test fixtures",
  issuer: intermediate.subject,
  notBefore,
  notAfter,
  publicKey: wrongIssuerKeys.publicKey,
  signingKey: strayKeys.privateKey,
  signingAlgorithm: SHA384,
  extensions: [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.Extension("1.2.840.113635.100.6.11.1", false, new Uint8Array([0x05, 0x00])),
  ],
});

const b64 = (cert) => Buffer.from(cert.rawData).toString("base64");

// A payload the size and shape of a decoded JWSTransaction.
const payload = {
  transactionId: "2000000999999999",
  originalTransactionId: "2000000999999999",
  webOrderLineItemId: "2000000088888888",
  bundleId: "com.example.openpurr",
  productId: "pro_monthly",
  subscriptionGroupIdentifier: "21000000",
  purchaseDate: 1763337600000,
  originalPurchaseDate: 1763337600000,
  expiresDate: 1765929600000,
  quantity: 1,
  type: "Auto-Renewable Subscription",
  inAppOwnershipType: "PURCHASED",
  signedDate: 1763337601000,
  environment: "Sandbox",
  transactionReason: "PURCHASE",
  storefront: "USA",
  storefrontId: "143441",
  price: 9990,
  currency: "USD",
  appTransactionId: "704000000000000000",
};

const signJws = (leafCert, key) =>
  new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "ES256", x5c: [b64(leafCert), b64(intermediate), b64(root)] })
    .sign(key);
const jws = await signJws(leaf, leafKeys.privateKey);
const jwsNoMarker = await signJws(leafNoMarker, noMarkerKeys.privateKey);
const jwsWrongIssuer = await signJws(leafWrongIssuer, wrongIssuerKeys.privateKey);

const appleApiKey = await crypto.subtle.generateKey(P256, true, ["sign", "verify"]);
const googleSaKey = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);

const out = `// GENERATED by scripts/gen-bench-fixtures.mjs. TEST-ONLY keys; do not reuse anywhere.
/* eslint-disable */

/** Self-signed test root, base64 DER. Plays the part of Apple Root CA G3 in benchmarks. */
export const TEST_ROOT_CERT_B64 = ${JSON.stringify(b64(root))};

/** An ES256 JWS with an x5c chain [leaf, intermediate, root], shaped like a signed transaction. */
export const TEST_SIGNED_TRANSACTION = ${JSON.stringify(jws)};

/** Same payload, but the leaf lacks Apple's marker OID. Must be rejected. */
export const TEST_JWS_LEAF_WITHOUT_MARKER = ${JSON.stringify(jwsNoMarker)};

/** Same payload, but the leaf is signed by a key other than the intermediate's. Must be rejected. */
export const TEST_JWS_LEAF_WRONG_ISSUER = ${JSON.stringify(jwsWrongIssuer)};

/** P-256 PKCS#8 PEM, shaped like an App Store Connect API .p8 key. */
export const TEST_APPLE_API_KEY_PEM = ${JSON.stringify(await exportPKCS8(appleApiKey.privateKey))};

/** RSA-2048 PKCS#8 PEM, shaped like a Google service account private_key. */
export const TEST_GOOGLE_SA_KEY_PEM = ${JSON.stringify(await exportPKCS8(googleSaKey.privateKey))};
`;

writeFileSync(target, out);
console.log(`wrote ${target} (JWS ${jws.length} bytes)`);
