// Bundle budgets for both Workers (CONTRIBUTING rule 6).
//
// The SDK Worker (top level) is the one that matters for latency: every fresh isolate pays to load
// its bundle out of the free plan's 10 ms CPU budget. Since M4a it holds only /v1; store
// notifications, scheduled jobs and the admin side live in the back-office Worker (env "office"),
// whose size doesn't affect SDK requests and which gets a looser budget.
//
// Each bundle is built exactly as `wrangler deploy` would (dry run, no Cloudflare credentials).
// For the SDK Worker it also prints the CPU a fresh isolate pays in Node (load + first request),
// which varies by machine, so it's reported, not enforced.
//
//   node scripts/check-bundle.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WORKERS = [
  { env: "", name: "SDK Worker", maxKib: 100, probe: true },
  { env: "office", name: "back-office Worker", maxKib: 250, probe: false },
];

// The build step compiles the config; CI has no operator config, so use the example.
const example = new URL("../openpurr.config.example.yaml", import.meta.url).pathname;

function build(env) {
  const outdir = mkdtempSync(join(tmpdir(), "openpurr-bundle-"));
  execFileSync("npx", ["wrangler", "deploy", `--env=${env}`, "--dry-run", "--outdir", outdir], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, OPENPURR_CONFIG: process.env.OPENPURR_CONFIG || example },
  });
  const file = readdirSync(outdir).find((f) => f.endsWith(".js"));
  if (!file) throw new Error(`no bundle written to ${outdir}`);
  return join(outdir, file);
}

// What a fresh isolate pays: load the bundle (which also builds the app) plus its first request.
// Each sample runs in a fresh Node process. Node's own Request/Response are warmed up first,
// because workerd has them built in. Not identical to Workers, but it tracks it.
function freshIsolateMs(bundle) {
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
  return samples[3];
}

let failed = false;
for (const w of WORKERS) {
  const bundle = build(w.env);
  const kib = statSync(bundle).size / 1024;
  console.log(`${w.name}: ${kib.toFixed(1)} KiB (budget ${w.maxKib} KiB)`);
  if (w.probe) console.log(`  fresh-isolate CPU in Node (load + first request), median of 7: ${freshIsolateMs(bundle).toFixed(2)} ms (informational)`);
  if (kib > w.maxKib) {
    failed = true;
    console.error(
      `  Over budget by ${(kib - w.maxKib).toFixed(1)} KiB.` +
        (w.probe
          ? " Every fresh SDK isolate pays this out of the 10 ms CPU budget. Check for a new runtime dependency, or whether the code belongs in the back-office Worker (see CONTRIBUTING rule 6)."
          : " Check for a new runtime dependency (see CONTRIBUTING rule 6)."),
    );
  }
}
if (failed) process.exit(1);
