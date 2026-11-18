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

const MAX_KIB = Number(process.argv[process.argv.indexOf("--max") + 1]) || 100;

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

// Load CPU: each sample in a fresh Node process, so nothing is cached between runs.
const probe = `const t=process.cpuUsage();await import(${JSON.stringify(pathToFileURL(bundle).href)});const d=process.cpuUsage(t);console.log((d.user+d.system)/1000)`;
const samples = Array.from({ length: 5 }, () =>
  Number(execFileSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8" }).trim()),
).sort((a, b) => a - b);

console.log(`production bundle: ${kib.toFixed(1)} KiB (budget ${MAX_KIB} KiB)`);
console.log(`load CPU in Node, median of 5: ${samples[2].toFixed(2)} ms (informational)`);

if (kib > MAX_KIB) {
  console.error(
    `\nBundle is over budget by ${(kib - MAX_KIB).toFixed(1)} KiB. Every fresh isolate pays this out of the ` +
      `10 ms CPU budget. Check for a new runtime dependency (see CONTRIBUTING rule 6).`,
  );
  process.exit(1);
}
