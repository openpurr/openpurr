// Boots Lite in conformance mode and runs the suite against it:
//   pnpm --filter @openpurr/conformance test:lite [-- vitest args, e.g. tests/sdk.test.ts]
//
// `wrangler dev --env conformance` (lite/src/conformance/worker.ts) on a free port, with a fresh
// local D1 in a temporary directory, migrations applied, and the test root, store base and
// secrets passed as vars. Stopped and cleaned up afterwards.
//   --keep        leave the server running after the suite (prints its URL), for debugging
//   --serve-only  boot it and wait, without running the suite

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, serverSecrets } from "../src/env.ts";
import { parseArgs, runVitest } from "./vitest.mjs";

const lite = fileURLToPath(new URL("../../../lite", import.meta.url));
const wrangler = join(lite, "node_modules", ".bin", "wrangler");

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const serveOnly = argv.includes("--serve-only");
const { rest } = parseArgs(argv.filter((a) => a !== "--keep" && a !== "--serve-only"));

// Ports are picked here but bound later by other processes (wrangler, and the fake store in the
// test process), so they come from below the OS ephemeral ranges (Linux from 32768, macOS from
// 49152): a port the OS hands out for listen(0) could be handed again to wrangler or workerd for
// one of their own sockets in the meantime, and the fake store's listen would fail.
const LOW = 20000;
const HIGH = 32000;
const taken = new Set();

const canListen = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

async function freePort() {
  for (let i = 0; i < 50; i++) {
    const port = LOW + Math.floor(Math.random() * (HIGH - LOW));
    if (taken.has(port) || !(await canListen(port))) continue;
    taken.add(port);
    return port;
  }
  throw new Error(`conformance: no free port between ${LOW} and ${HIGH}`);
}

const port = Number(process.env.CONFORMANCE_LITE_PORT) || (await freePort());
const storePort = Number(process.env.CONFORMANCE_STORE_PORT) || (await freePort());
const inspectorPort = await freePort();
const token = process.env.CONFORMANCE_TOKEN ?? "conformance-token";
const target = `http://127.0.0.1:${port}`;
const storeBase = `http://127.0.0.1:${storePort}`;
const persist = mkdtempSync(join(tmpdir(), "openpurr-conformance-"));

const vars = {
  CONFORMANCE_TOKEN: token,
  CONFORMANCE_STORE_BASE: storeBase,
  CONFORMANCE_APPLE_ROOT_B64: fixtures.appleRootB64,
  ...serverSecrets(),
};

console.log(`conformance: applying migrations to a local D1 in ${persist}`);
const migrate = spawnSync(wrangler, ["d1", "migrations", "apply", "openpurr-conformance", "--local", "--env", "conformance", "--persist-to", persist], {
  cwd: lite,
  env: { ...process.env, CI: "true" },
  stdio: ["ignore", "ignore", "inherit"],
});
if (migrate.status !== 0) {
  console.error("conformance: applying migrations failed");
  process.exit(1);
}

console.log(`conformance: starting Lite at ${target} (fake stores at ${storeBase})`);
const server = spawn(
  wrangler,
  [
    "dev",
    "--env", "conformance",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--inspector-port", String(inspectorPort),
    "--persist-to", persist,
    "--show-interactive-dev-session=false",
    "--log-level", process.env.CONFORMANCE_LOG_LEVEL ?? "warn",
    ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
  ],
  { cwd: lite, env: { ...process.env, CI: "true" }, stdio: ["ignore", "inherit", "inherit"], detached: true },
);

let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
  rmSync(persist, { recursive: true, force: true });
}
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
server.on("exit", (code) => {
  if (!stopped) {
    console.error(`conformance: wrangler dev exited (${code})`);
    process.exit(1);
  }
});

// Wait until the Worker answers the conformance routes.
const deadline = Date.now() + 120_000;
for (;;) {
  try {
    const res = await fetch(`${target}/__conformance/clock`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ advance_ms: 0 }),
    });
    if (res.ok) break;
  } catch {}
  if (Date.now() > deadline) {
    console.error("conformance: Lite didn't start within 2 minutes");
    stop();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}

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
stop();
process.exit(code);
