// M0 CPU benchmarks. Each request runs one operation `n` times (default 1).
//
// Workers freezes Date.now() and performance.now() during CPU work (a Spectre mitigation),
// so these endpoints can't time themselves. Read CPU time per request from Workers Logs
// (wrangler tail, or the dashboard's Observability tab), then divide by n.
// scripts/bench-remote.mjs drives the endpoints.
//
// Ops:
//   noop                baseline: routing + JSON response
//   jws-cold            Apple-style JWS: parse x5c, verify chain, verify signature (no cache)
//   jws-warm            same JWS with the chain cached in the isolate; one ECDSA P-256 verify
//   jws-store           fresh-isolate path: chain found in the D1 ChainStore, so import the leaf
//                       key and verify the JWS (plus one D1 read, which is I/O, not CPU)
//   apple-token-cold    import .p8 + sign ES256 JWT
//   apple-token-warm    reuse the cached token (no signing until it nears expiry)
//   google-token-cold   import RSA-2048 key + sign RS256 JWT
//   google-token-warm   sign RS256 JWT with the cached key
//   hmac                HMAC-SHA256 over a 2 KB webhook body
//   pbkdf2              PBKDF2-SHA256, iterations from ?iter= (default 100000)

import { Hono } from "hono/tiny";
import type { AppEnv } from "../env";
import { verifyAppleJws } from "../lib/apple-jws";
import { d1ChainStore } from "../lib/chain-store-d1";
import { base64ToBytes } from "../lib/der";
import { mintAppleApiToken, mintGoogleAssertion } from "../lib/store-tokens";
import {
  TEST_APPLE_API_KEY_PEM,
  TEST_GOOGLE_SA_KEY_PEM,
  TEST_ROOT_CERT_B64,
  TEST_SIGNED_TRANSACTION,
} from "./fixtures.generated";

const trustedRoots = [base64ToBytes(TEST_ROOT_CERT_B64)];
const appleCreds = {
  issuerId: "00000000-0000-0000-0000-000000000000",
  keyId: "TESTKEY123",
  bundleId: "com.example.openpurr",
  privateKeyPem: TEST_APPLE_API_KEY_PEM,
};
const googleSa = { clientEmail: "bench@example.iam.gserviceaccount.com", privateKeyPem: TEST_GOOGLE_SA_KEY_PEM };
const webhookBody = new TextEncoder().encode("x".repeat(2048));

type Op = (iter: number, env: AppEnv["Bindings"]) => Promise<unknown>;

const ops: Record<string, Op> = {
  noop: async () => null,
  "jws-cold": () => verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, noCache: true }),
  "jws-warm": () => verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots }),
  "jws-store": (_iter, env) =>
    verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, store: d1ChainStore(env.DB), noIsolateCache: true }),
  "apple-token-cold": () => mintAppleApiToken(appleCreds, { noCache: true }),
  "apple-token-warm": () => mintAppleApiToken(appleCreds),
  "google-token-cold": () => mintGoogleAssertion(googleSa, { noCache: true }),
  "google-token-warm": () => mintGoogleAssertion(googleSa),
  hmac: async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    return crypto.subtle.sign("HMAC", key, webhookBody);
  },
  pbkdf2: async (iter) => {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode("correct horse"), "PBKDF2", false, [
      "deriveBits",
    ]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(16), iterations: iter }, base, 256);
  },
};

export const bench = new Hono<AppEnv>();

bench.use("*", async (c, next) => {
  const token = c.env.BENCH_TOKEN;
  if (!token || c.req.header("authorization") !== `Bearer ${token}`) return c.notFound();
  await next();
});

bench.get("/", (c) => c.json({ ops: Object.keys(ops) }));

bench.get("/ratelimit", async (c) => {
  if (!c.env.RATE_LIMIT_IP) return c.json({ available: false, reason: "binding not present" });
  const { success } = await c.env.RATE_LIMIT_IP.limit({ key: "bench" });
  return c.json({ available: true, success });
});

bench.get("/:op", async (c) => {
  const name = c.req.param("op");
  const op = ops[name];
  if (!op) return c.json({ error: `unknown op ${name}` }, 404);
  const n = Math.min(Math.max(Number(c.req.query("n") ?? 1) || 1, 1), 1000);
  const iter = Number(c.req.query("iter") ?? 100_000) || 100_000;
  try {
    for (let i = 0; i < n; i++) await op(iter, c.env);
    // Correlation line for Workers Logs; CPU time is attached to the invocation.
    console.log(JSON.stringify({ bench: name, n, iter: name === "pbkdf2" ? iter : undefined }));
    return c.json({ op: name, n, ok: true });
  } catch (err) {
    return c.json({ op: name, n, ok: false, error: String(err) }, 500);
  }
});
