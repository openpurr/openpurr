// Starting servers for the runner scripts: free ports, Lite under `wrangler dev`, Standard from a
// binary built with `go build`, and waiting until each answers.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const liteDir = fileURLToPath(new URL("../../../lite", import.meta.url));
export const standardDir = fileURLToPath(new URL("../../../standard", import.meta.url));
const wrangler = join(liteDir, "node_modules", ".bin", "wrangler");

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

export async function freePort() {
  for (let i = 0; i < 50; i++) {
    const port = LOW + Math.floor(Math.random() * (HIGH - LOW));
    if (taken.has(port) || !(await canListen(port))) continue;
    taken.add(port);
    return port;
  }
  throw new Error(`conformance: no free port between ${LOW} and ${HIGH}`);
}

const children = [];
const dirs = [];

/** Stops every server started here and removes their temporary directories. */
export function stopAll() {
  for (const child of children.splice(0)) {
    child.stopping = true;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

function track(child, name) {
  children.push(child);
  child.on("exit", (code) => {
    if (!child.stopping) {
      console.error(`conformance: ${name} exited (${code})`);
      stopAll();
      process.exit(1);
    }
  });
  return child;
}

/**
 * Starts a Lite Worker with `wrangler dev`: env "conformance" (the suite's Worker, with a migrated
 * local D1), "" (the production SDK Worker) or "office" (the production back-office Worker).
 */
export async function startLite({ env, port, vars = {}, migrate = false, name = `Lite (${env || "SDK Worker"})` }) {
  const persist = mkdtempSync(join(tmpdir(), "openpurr-conformance-"));
  dirs.push(persist);
  const database = env === "conformance" ? "openpurr-conformance" : "openpurr";
  if (migrate) {
    console.log(`conformance: applying migrations to a local D1 in ${persist}`);
    const r = spawnSync(wrangler, ["d1", "migrations", "apply", database, "--local", "--env", env, "--persist-to", persist], {
      cwd: liteDir,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (r.status !== 0) throw new Error("conformance: applying migrations failed");
  }
  const inspectorPort = await freePort();
  const child = spawn(
    wrangler,
    [
      "dev",
      "--env", env,
      "--ip", "127.0.0.1",
      "--port", String(port),
      "--inspector-port", String(inspectorPort),
      "--persist-to", persist,
      "--show-interactive-dev-session=false",
      "--log-level", process.env.CONFORMANCE_LOG_LEVEL ?? "warn",
      ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
    ],
    { cwd: liteDir, env: { ...process.env, CI: "true" }, stdio: ["ignore", "inherit", "inherit"], detached: true },
  );
  track(child, name);
  return child;
}

/** Builds the Standard server into a temporary directory; returns the binary's path. */
export function buildStandard() {
  const dir = mkdtempSync(join(tmpdir(), "openpurr-standard-"));
  dirs.push(dir);
  const bin = join(dir, "openpurr");
  console.log("conformance: building Standard (go build)");
  const r = spawnSync("go", ["build", "-o", bin, "./cmd/openpurr"], { cwd: standardDir, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error("conformance: go build failed");
  return bin;
}

/** Starts a Standard binary with these environment variables. */
export function startStandard(bin, env, name = "Standard") {
  const child = spawn(bin, [], { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"], detached: true });
  return track(child, name);
}

/** Stops one server started here. */
export function stop(child) {
  child.stopping = true;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
}

/** Waits until `ready()` resolves true (2 minutes at most). */
export async function waitUntil(ready, what) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      if (await ready()) return;
    } catch {}
    if (Date.now() > deadline) {
      stopAll();
      throw new Error(`conformance: ${what} didn't start within 2 minutes`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** True once a server in conformance mode answers its control routes. */
export const conformanceReady = (target, token) => async () =>
  (
    await fetch(`${target}/__conformance/clock`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ advance_ms: 0 }),
    })
  ).ok;

/** True once something listens on the port (without a request, which a forwarder would pass on). */
export const listening = (port) => () =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
