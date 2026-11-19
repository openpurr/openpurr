// Compiles openpurr.config.yaml into src/config.generated.json, validating it first.
// Runs automatically before `wrangler deploy` and `wrangler dev` (wrangler.jsonc build.command).
//
// The config lives in D1 (src/config-store.ts). This file is imported into D1 once, when a
// deployment first starts with an empty config; after that, edits go through the admin API, and
// changes to this file are ignored.
//
// Which file: $OPENPURR_CONFIG if set, else openpurr.config.yaml. With --allow-example, falls
// back to openpurr.config.example.yaml (typecheck, tests and CI only; never for a deploy).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ConfigError, parseConfig } from "../src/config.ts";

const root = new URL("..", import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));

let source = process.env.OPENPURR_CONFIG || path("openpurr.config.yaml");
if (!existsSync(source)) {
  if (process.argv.includes("--allow-example")) {
    source = path("openpurr.config.example.yaml");
  } else {
    console.error(
      `No config at ${source}.\nCopy openpurr.config.example.yaml to openpurr.config.yaml and edit it, or set OPENPURR_CONFIG.`,
    );
    process.exit(1);
  }
}

let raw;
try {
  raw = parse(readFileSync(source, "utf8"), { prettyErrors: true });
} catch (err) {
  console.error(`${source}: YAML syntax error\n${err.message}`);
  process.exit(1);
}

try {
  parseConfig(raw);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`${source}\n${err.message}`);
    process.exit(1);
  }
  throw err;
}

// Write only on a change: wrangler dev watches src/, and rewriting an identical file would make it
// rebuild (which runs this script again) in a loop.
const out = path("src/config.generated.json");
const json = `${JSON.stringify(raw, null, 2)}\n`;
if (!existsSync(out) || readFileSync(out, "utf8") !== json) writeFileSync(out, json);
console.log(`config: ${source} -> src/config.generated.json (imported into D1 only if the deployment has no config yet)`);
