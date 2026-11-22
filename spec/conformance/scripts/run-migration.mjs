// The move from Lite to Standard, end to end (docs/migrating-from-lite-to-standard.md):
//   pnpm --filter @openpurr/conformance test:migration
//
// Boots Lite in conformance mode (wrangler dev, local D1), builds Standard (go build), and starts
// Lite's two production Workers in forward mode pointing at the port Standard will listen on.
// migration/lite-to-standard.test.ts then seeds Lite through the SDK, store notifications and
// the admin API, exports with the CLI, imports with Standard's binary, starts Standard in
// conformance mode on the imported database, verifies with the CLI, does it again with a delta,
// and sends requests through the forwarding Workers.
//
// Needs Go and an empty Postgres database it may erase: MIGRATION_DATABASE_URL (or
// OPENPURR_TEST_DATABASE_URL).

import { fixtures, serverSecrets } from "../src/env.ts";
import { buildStandard, conformanceReady, freePort, listening, startLite, stopAll, waitUntil } from "./servers.mjs";
import { parseArgs, runVitest } from "./vitest.mjs";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.OPENPURR_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error("conformance: set MIGRATION_DATABASE_URL to a Postgres database the migration test may erase.");
  process.exit(1);
}
const { rest } = parseArgs(process.argv.slice(2));
const token = process.env.CONFORMANCE_TOKEN ?? "conformance-token";
const forwardSecret = "migration-forward-secret-0123456789abcdef";
const [litePort, storePort, standardPort, sdkPort, officePort] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
const lite = `http://127.0.0.1:${litePort}`;
const standard = `http://127.0.0.1:${standardPort}`;
const storeBase = `http://127.0.0.1:${storePort}`;

const bin = buildStandard();
console.log(`conformance: starting Lite at ${lite}, and its Workers in forward mode to ${standard}`);
const forward = { FORWARD_TO: standard, FORWARD_SECRET: forwardSecret };
await startLite({
  env: "conformance",
  port: litePort,
  migrate: true,
  vars: { CONFORMANCE_TOKEN: token, CONFORMANCE_STORE_BASE: storeBase, CONFORMANCE_APPLE_ROOT_B64: fixtures.appleRootB64, ...serverSecrets() },
});
await startLite({ env: "", port: sdkPort, vars: forward, name: "Lite SDK Worker (forward mode)" });
await startLite({ env: "office", port: officePort, vars: forward, name: "Lite back-office Worker (forward mode)" });
await waitUntil(conformanceReady(lite, token), "Lite");
await waitUntil(listening(sdkPort), "the forwarding SDK Worker");
await waitUntil(listening(officePort), "the forwarding back-office Worker");

const code = await runVitest(["--config", "vitest.migration.config.ts", ...rest], {
  CONFORMANCE_TARGET: lite,
  CONFORMANCE_TOKEN: token,
  CONFORMANCE_STORE_PORT: String(storePort),
  CONFORMANCE_STORE_BASE: storeBase,
  CONFORMANCE_EDITION: "lite",
  MIGRATION_STANDARD_BIN: bin,
  MIGRATION_STANDARD_PORT: String(standardPort),
  MIGRATION_DATABASE_URL: databaseUrl,
  MIGRATION_FORWARD_SECRET: forwardSecret,
  MIGRATION_FORWARD_SDK: `http://127.0.0.1:${sdkPort}`,
  MIGRATION_FORWARD_OFFICE: `http://127.0.0.1:${officePort}`,
});
stopAll();
process.exit(code);
