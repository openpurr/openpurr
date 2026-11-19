// Writes wrangler.deploy.json: wrangler.jsonc with one deployment's own Worker name, database and
// custom domains, read from environment variables. The GitHub Actions deploy
// (.github/workflows/lite-deploy.yml) uses it, so an account's details live in repository secrets
// and never in the repo. Every variable is optional:
//
//   OPENPURR_WORKER_NAME        SDK Worker name (default "openpurr"); the back office is "<name>-office"
//   OPENPURR_D1_DATABASE_NAME   D1 database name (default "openpurr"), looked up by name at deploy time
//   OPENPURR_D1_DATABASE_ID     pins the database by ID instead
//   OPENPURR_SDK_DOMAIN         custom domain for the SDK Worker, e.g. purchases.example.com
//   OPENPURR_OFFICE_DOMAIN      custom domain for the back office, e.g. office.example.com
//
//   node scripts/deploy-config.mjs
//   wrangler deploy -c wrangler.deploy.json --env=        (SDK Worker)
//   wrangler deploy -c wrangler.deploy.json --env office  (back office)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { experimental_readRawConfig as readRawConfig } from "wrangler";

const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const env = (name) => (process.env[name] ?? "").trim();

function fail(message) {
  console.error(`deploy-config: ${message}`);
  process.exit(1);
}

const workerName = env("OPENPURR_WORKER_NAME");
const databaseName = env("OPENPURR_D1_DATABASE_NAME");
const databaseId = env("OPENPURR_D1_DATABASE_ID");
const sdkDomain = env("OPENPURR_SDK_DOMAIN");
const officeDomain = env("OPENPURR_OFFICE_DOMAIN");

// Worker names become part of the workers.dev hostname, and "-office" is appended to this one.
if (workerName && !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(workerName)) {
  fail("OPENPURR_WORKER_NAME must be lowercase letters, digits and hyphens, at most 50 characters.");
}
if (databaseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
  fail("OPENPURR_D1_DATABASE_ID must be a database UUID, as printed by `wrangler d1 list`.");
}
for (const [name, value] of [
  ["OPENPURR_SDK_DOMAIN", sdkDomain],
  ["OPENPURR_OFFICE_DOMAIN", officeDomain],
]) {
  if (value && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) {
    fail(`${name} must be a hostname such as purchases.example.com (no https://, no path).`);
  }
}
if (sdkDomain && sdkDomain === officeDomain) {
  fail("OPENPURR_SDK_DOMAIN and OPENPURR_OFFICE_DOMAIN must be different hostnames.");
}

const { rawConfig: config } = readRawConfig({ config: here("wrangler.jsonc") });

// Only the SDK Worker and the back office are deployed from here; the bench Worker isn't.
delete config.env.bench;

if (workerName) config.name = workerName;

for (const target of [config, config.env.office]) {
  for (const db of target.d1_databases ?? []) {
    if (db.binding !== "DB") continue;
    if (databaseName) db.database_name = databaseName;
    if (databaseId) db.database_id = databaseId;
  }
}

// `routes` is inherited by environments, so the back office always gets its own list.
const customDomain = (pattern) => (pattern ? [{ pattern, custom_domain: true }] : []);
if (sdkDomain) config.routes = customDomain(sdkDomain);
config.env.office.routes = customDomain(officeDomain);

const out = here("wrangler.deploy.json");
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);

const office = `${config.name}-office`;
const database = databaseId ? `${databaseId} (by ID)` : `"${config.d1_databases[0].database_name}" (by name)`;
console.log(`deploy-config: wrangler.deploy.json
  SDK Worker   ${config.name}${sdkDomain ? `, https://${sdkDomain}` : ""}
  back office  ${office}${officeDomain ? `, https://${officeDomain}` : ""}
  database     ${database}`);
