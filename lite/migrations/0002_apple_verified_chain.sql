-- Apple certificate chains that passed full verification (see src/lib/apple-jws.ts).
-- Lets a fresh isolate skip the chain check: Apple signs with a handful of long-lived
-- certificates, so this table stays at a few rows.
CREATE TABLE apple_verified_chain (
  fingerprint TEXT PRIMARY KEY,   -- SHA-256 hex of leaf || intermediate || root DER
  leaf_spki   TEXT NOT NULL,      -- base64 DER SubjectPublicKeyInfo of the leaf
  not_before  INTEGER NOT NULL,   -- epoch ms, latest notBefore in the chain
  not_after   INTEGER NOT NULL,   -- epoch ms, earliest notAfter in the chain
  verified_at INTEGER NOT NULL    -- epoch ms
);
