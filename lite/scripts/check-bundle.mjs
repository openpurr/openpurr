// Bundle budget for the production Worker (CONTRIBUTING rule 6).
//
// Every fresh Worker isolate pays to load the bundle out of the free plan's 10 ms CPU budget,
// so the bundle has a hard size limit. This builds it exactly as `wrangler deploy` would
// (dry run, no Cloudflare credentials needed), fails if it's over the limit, and prints the
// CPU to load it in Node. Load CPU varies by machine, so it's reported, not enforced.
//
//   node scripts/check-bundle.mjs            check against the budget
//   node scripts/check-bundle.mjs --max 120  override the limit (KiB)

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 125 KiB since M2 (Google Play). Measured: the store-notification routes and scheduled jobs are
// about 24 KiB and 0.75 ms of a fresh isolate's CPU, and deferring them with dynamic import() doesn't
// help (wrangler doesn't split bundles, so they're still parsed). They move to the back-office
// Worker in M4a, which should bring the SDK Worker back near 90 KiB.
const MAX_KIB = Number(process.argv[process.argv.indexOf("--max") + 1]) || 125;

const outdir = mkdtempSync(join(tmpdir(), "openpurr-bundle-"));
// The build step compiles the config; CI has no operator config, so use the example.
const example = new URL("../openpurr.config.example.yaml", import.meta.url).pathname;
execFileSync("npx", ["wrangler", "deploy", "--env=", "--dry-run", "--outdir", outdir], {
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, OPENPURR_CONFIG: process.env.OPENPURR_CONFIG || example },
});

const file = readdirSync(outdir).find((f) => f.endsWith(".js"));
if (!file) throw new Error(`no bundle written to ${outdir}`);
const bundle = join(outdir, file);
const kib = statSync(bundle).size / 1024;

// What a fresh isolate pays: load the bundle (which also builds the app) plus its first request.
// Each sample runs in a fresh Node process. Node's own Request/Response are warmed up first,
// because workerd has them built in. Not identical to Workers, but it tracks it.
const probe = `
  { const r = new Request("https://w/x", { headers: { a: "b" } }); new URL(r.url); await Response.json({}).text(); }
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const t = cpu();
  const { default: worker } = await import(${JSON.stringify(pathToFileURL(bundle).href)});
  const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };
  const res = await worker.fetch(new Request("https://x/v1/subscribers/u1", { headers: { authorization: "Bearer appl_replace_with_a_long_random_string" } }), { DB: db }, { waitUntil() {} });
  await res.text();
  console.log(cpu() - t);`;
const samples = Array.from({ length: 7 }, () =>
  Number(execFileSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8" }).trim()),
).sort((a, b) => a - b);

console.log(`production bundle: ${kib.toFixed(1)} KiB (budget ${MAX_KIB} KiB)`);
console.log(`fresh-isolate CPU in Node (load + first request), median of 7: ${samples[3].toFixed(2)} ms (informational)`);

if (kib > MAX_KIB) {
  console.error(
    `\nBundle is over budget by ${(kib - MAX_KIB).toFixed(1)} KiB. Every fresh isolate pays this out of the ` +
      `10 ms CPU budget. Check for a new runtime dependency (see CONTRIBUTING rule 6).`,
  );
  process.exit(1);
}
