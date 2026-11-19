// Bundles an optional config file for the first import. Runs before `wrangler deploy` and
// `wrangler dev` (wrangler.jsonc build.command).
//
// The config lives in D1 and is edited in the dashboard (Configuration) or with
// `openpurr config pull` / `push`. A file is only a starting point: when a deployment starts with
// an empty config, the bundled file is imported once as the project "default"
// (src/config-store.ts). Without a file, the deployment starts empty and the dashboard opens on
// adding the first app.
//
// Which file: $OPENPURR_CONFIG if set, else openpurr.config.yaml if it exists. With
// --allow-example, falls back to openpurr.config.example.yaml (typecheck and tests). The file is
// validated first, so a mistake fails here with a message saying what's wrong.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ConfigError, parseConfig } from "../src/config.ts";

const root = new URL("..", import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));

let source = process.env.OPENPURR_CONFIG || path("openpurr.config.yaml");
if (!existsSync(source)) {
  if (process.env.OPENPURR_CONFIG) {
    console.error(`No config at ${source} (OPENPURR_CONFIG).`);
    process.exit(1);
  }
  source = process.argv.includes("--allow-example") ? path("openpurr.config.example.yaml") : null;
}

let raw = null;
if (source) {
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
}

// Write only on a change: wrangler dev watches src/, and rewriting an identical file would make it
// rebuild (which runs this script again) in a loop.
const out = path("src/config.generated.json");
const json = `${JSON.stringify(raw, null, 2)}\n`;
if (!existsSync(out) || readFileSync(out, "utf8") !== json) writeFileSync(out, json);
console.log(
  source
    ? `config: ${source} -> src/config.generated.json (imported into D1 only if the deployment has no config yet)`
    : "config: no config file; the deployment's config lives in D1 (set it up in the dashboard)",
);
