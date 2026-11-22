// Boots Lite in conformance mode and runs the suite against it:
//   pnpm --filter @openpurr/conformance test:lite [-- vitest args, e.g. tests/sdk.test.ts]
//
// `wrangler dev --env conformance` (lite/src/conformance/worker.ts) on a free port, with a fresh
// local D1 in a temporary directory, migrations applied, and the test root, store base and
// secrets passed as vars. Stopped and cleaned up afterwards.
//   --keep        leave the server running after the suite (prints its URL), for debugging
//   --serve-only  boot it and wait, without running the suite

import { fixtures, serverSecrets } from "../src/env.ts";
import { conformanceReady, freePort, startLite, stopAll, waitUntil } from "./servers.mjs";
import { parseArgs, runVitest } from "./vitest.mjs";

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const serveOnly = argv.includes("--serve-only");
const { rest } = parseArgs(argv.filter((a) => a !== "--keep" && a !== "--serve-only"));

const port = Number(process.env.CONFORMANCE_LITE_PORT) || (await freePort());
const storePort = Number(process.env.CONFORMANCE_STORE_PORT) || (await freePort());
const token = process.env.CONFORMANCE_TOKEN ?? "conformance-token";
const target = `http://127.0.0.1:${port}`;
const storeBase = `http://127.0.0.1:${storePort}`;

console.log(`conformance: starting Lite at ${target} (fake stores at ${storeBase})`);
await startLite({
  env: "conformance",
  port,
  migrate: true,
  name: "wrangler dev",
  vars: {
    CONFORMANCE_TOKEN: token,
    CONFORMANCE_STORE_BASE: storeBase,
    CONFORMANCE_APPLE_ROOT_B64: fixtures.appleRootB64,
    ...serverSecrets(),
  },
});
// Wait until the Worker answers the conformance routes.
await waitUntil(conformanceReady(target, token), "Lite");

if (serveOnly) {
  console.log(`conformance: Lite is up at ${target}. Run the suite with:\n  CONFORMANCE_TARGET=${target} CONFORMANCE_STORE_PORT=${storePort} CONFORMANCE_TOKEN=${token} pnpm --filter @openpurr/conformance test`);
  await new Promise(() => {});
}

const code = await runVitest(rest, {
  CONFORMANCE_TARGET: target,
  CONFORMANCE_TOKEN: token,
  CONFORMANCE_STORE_PORT: String(storePort),
  CONFORMANCE_STORE_BASE: storeBase,
  CONFORMANCE_EDITION: "lite",
});
if (keep) {
  console.log(`conformance: leaving Lite running at ${target} (Ctrl-C to stop)`);
  await new Promise(() => {});
}
stopAll();
process.exit(code);
