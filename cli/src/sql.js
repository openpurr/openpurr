// openpurr migrate sql: turns a full export bundle into SQL for a new, empty Lite database (D1), the
// way back from Standard to Lite (docs/migrating-from-lite-to-standard.md, "Rolling back"):
//
//   wrangler d1 create openpurr-restored
//   wrangler d1 migrations apply openpurr-restored --remote
//   openpurr migrate sql --bundle <dir> > restore.sql
//   wrangler d1 execute openpurr-restored --remote --file restore.sql
//
// Rows go in the bundle's table order (parents first). Snapshots aren't in the bundle: Lite
// computes CustomerInfo from the ledger until its backfill job has rebuilt them. The chart totals
// are rebuilt by the next hourly run.

import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CliError } from "./client.js";
import { readManifest } from "./export.js";

/** Standard-only columns, which Lite's tables don't have. */
const STANDARD_ONLY = { webhook_delivery: new Set(["claimed_until"]) };
/** D1 refuses statements over 100 KB; stay well under. */
const MAX_STATEMENT_BYTES = 90_000;
const MAX_ROWS_PER_STATEMENT = 100;

export function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new CliError(`Can't write ${v} to SQL.`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  throw new CliError(`Can't write a ${typeof v} to SQL.`);
}

const ident = (name) => `"${name.replace(/"/g, '""')}"`;

/** Writes the SQL for a bundle with `write` (a string per call). Returns the number of rows. */
export async function bundleToSql(dir, write) {
  const m = readManifest(dir);
  if (m.kind !== "full") throw new CliError("Only a full bundle can be loaded into Lite (into a new, empty database). Export without --since.", 2);
  write(`-- openpurr export ${m.id} from ${m.source?.url} (${m.source?.edition}), ${m.created_at}\n`);
  write("-- Load into a new D1 database after its migrations: wrangler d1 execute <db> --remote --file <this file>\n");
  let total = 0;
  for (const t of m.tables) {
    const drop = STANDARD_ONLY[t.name] ?? new Set();
    let columns = null;
    let values = [];
    let bytes = 0;
    const flush = () => {
      if (!values.length) return;
      write(`INSERT INTO ${ident(t.name)} (${columns.map(ident).join(", ")}) VALUES\n${values.join(",\n")};\n`);
      values = [];
      bytes = 0;
    };
    const lines = createInterface({ input: createReadStream(join(dir, t.file), "utf8"), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (!columns) columns = Object.keys(row).filter((k) => !drop.has(k));
      const tuple = `(${columns.map((k) => sqlValue(row[k])).join(", ")})`;
      if (values.length && (values.length >= MAX_ROWS_PER_STATEMENT || bytes + tuple.length > MAX_STATEMENT_BYTES)) flush();
      values.push(tuple);
      bytes += tuple.length + 2;
      total++;
    }
    flush();
  }
  // The chart totals are rebuilt from the ledger on the next run (new_customers came with the bundle).
  write(`UPDATE job_state SET value = json_set(value, '$.rebuild', json('true')) WHERE key = 'metrics_rollup';\n`);
  return total;
}
