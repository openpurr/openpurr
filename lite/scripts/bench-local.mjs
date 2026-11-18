// Rough local CPU estimate for the M0 crypto operations, run under Node.
// Indicative only: Workers uses BoringSSL and V8 isolates; real numbers come from
// Workers Logs on a deployed free-plan Worker (see src/bench/index.ts).
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "openpurr-bench-")), "ops.mjs");
await build({
  stdin: {
    contents: `
      export { verifyAppleJws } from "./src/lib/apple-jws";
      export { mintAppleApiToken, mintGoogleAssertion } from "./src/lib/store-tokens";
      export { base64ToBytes } from "./src/lib/der";
      export * from "./src/bench/fixtures.generated";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: out,
  logLevel: "error",
});
const m = await import(pathToFileURL(out).href);

const trustedRoots = [m.base64ToBytes(m.TEST_ROOT_CERT_B64)];
const apple = { issuerId: "x", keyId: "K", bundleId: "b", privateKeyPem: m.TEST_APPLE_API_KEY_PEM };
const google = { clientEmail: "e@x", privateKeyPem: m.TEST_GOOGLE_SA_KEY_PEM };
const pw = new TextEncoder().encode("correct horse");

const ops = {
  "jws-cold": () => m.verifyAppleJws(m.TEST_SIGNED_TRANSACTION, { trustedRoots, noCache: true }),
  "jws-warm": () => m.verifyAppleJws(m.TEST_SIGNED_TRANSACTION, { trustedRoots }),
  "apple-token-cold": () => m.mintAppleApiToken(apple, { noCache: true }),
  "apple-token-warm": () => m.mintAppleApiToken(apple),
  "google-token-cold": () => m.mintGoogleAssertion(google, { noCache: true }),
  "google-token-warm": () => m.mintGoogleAssertion(google),
  "pbkdf2-100k": async () => {
    const k = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(16), iterations: 100_000 }, k, 256);
  },
};

const N = Number(process.argv[2] ?? 200);
console.log(`op                   ms/op (median of ${N}, after warm-up)`);
for (const [name, fn] of Object.entries(ops)) {
  for (let i = 0; i < 20; i++) await fn();
  const t = [];
  const n = name.startsWith("pbkdf2") ? Math.min(N, 20) : N;
  for (let i = 0; i < n; i++) {
    const s = process.cpuUsage();
    await fn();
    const d = process.cpuUsage(s);
    t.push((d.user + d.system) / 1000);
  }
  t.sort((a, b) => a - b);
  console.log(`${name.padEnd(20)} ${t[Math.floor(t.length / 2)].toFixed(3)}`);
}
