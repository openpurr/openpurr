// Runs vitest on this package with the given environment; resolves with its exit code.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const vitestBin = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");

export function runVitest(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitestBin, "run", ...args], { cwd: pkg, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** Splits our options (--target, --edition, --token, --store-port, --store-base) from vitest's. */
export function parseArgs(argv) {
  const opts = {};
  const rest = [];
  const names = { "--target": "target", "--edition": "edition", "--token": "token", "--store-port": "storePort", "--store-base": "storeBase" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    const [flag, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    if (names[flag]) opts[names[flag]] = inline ?? argv[++i];
    else rest.push(a);
  }
  return { opts, rest };
}

/** The runner's environment for parsed options (unset ones keep their CONFORMANCE_* values). */
export function runnerEnv(opts) {
  const env = {};
  if (opts.target) env.CONFORMANCE_TARGET = opts.target;
  if (opts.edition) env.CONFORMANCE_EDITION = opts.edition;
  if (opts.token) env.CONFORMANCE_TOKEN = opts.token;
  if (opts.storePort) env.CONFORMANCE_STORE_PORT = String(opts.storePort);
  if (opts.storeBase) env.CONFORMANCE_STORE_BASE = opts.storeBase;
  return env;
}
