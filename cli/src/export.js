// openpurr export: writes a deployment's data to an export bundle (spec/export-bundle.md), to move
// it to the other edition or keep a copy. Works against Lite and Standard alike, through the
// admin API's export endpoints (owners only). A bundle is a directory: manifest.json, written
// last, and one newline-delimited JSON file per table.
//
// A delta (--since PREVIOUS_BUNDLE) holds what changed after the previous bundle began: rows
// whose timestamps say so, every row of each customer whose ledger version changed (merges move
// rows without new timestamps), and the customers that are gone.

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./client.js";
import { json } from "./output.js";

export const FORMAT = "openpurr-export";
export const FORMAT_VERSION = 1;
/** A delta starts this long before the previous export did: writes in flight, clock skew. */
export const DELTA_SLACK_MS = 60_000;
const IDS_PER_REQUEST = 50;
const MAX_TRIES = 5;

/** One NDJSON file being written: counts rows and hashes them. */
class NdjsonFile {
  constructor(dir, file) {
    this.file = file;
    this.fd = openSync(join(dir, file), "w", 0o600);
    this.hash = createHash("sha256");
    this.rows = 0;
    this.bytes = 0;
  }
  write(row) {
    const line = `${JSON.stringify(row)}\n`;
    writeSync(this.fd, line);
    this.hash.update(line);
    this.rows++;
    this.bytes += Buffer.byteLength(line);
  }
  close(name) {
    closeSync(this.fd);
    return { ...(name ? { name } : {}), file: this.file, rows: this.rows, sha256: this.hash.digest("hex") };
  }
}

/** Reads every line of a bundle's NDJSON file. */
export function* readNdjson(path) {
  for (const line of readFileSync(path, "utf8").split("\n")) if (line.trim()) yield JSON.parse(line);
}

/** Reads a bundle's manifest, checking it's one. */
export function readManifest(dir) {
  let m;
  try {
    m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch (e) {
    throw new CliError(`${dir} isn't an export bundle (no readable manifest.json: ${e.message}).`, 2);
  }
  if (m.format !== FORMAT) throw new CliError(`${dir} isn't an openpurr export bundle.`, 2);
  if (m.version !== FORMAT_VERSION) throw new CliError(`${dir} is bundle format version ${m.version}; this CLI reads version ${FORMAT_VERSION}. Update the CLI.`, 2);
  return m;
}

/** Customer ID → ledger version as of a bundle: its customer index, or a full bundle's customers. */
function customerVersions(dir, m) {
  const versions = new Map();
  if (m.customer_index) {
    for (const r of readNdjson(join(dir, m.customer_index.file))) versions.set(r.id, r.ledger_version);
  } else {
    const e = m.tables.find((t) => t.name === "customer");
    if (!e) throw new CliError(`${dir} has no customer table, so it can't be the base of a delta.`, 2);
    for (const r of readNdjson(join(dir, e.file))) versions.set(r.id, r.ledger_version);
  }
  return versions;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An admin API GET, retried on 429 and 5xx (a Worker over its CPU limit answers 503). */
async function getJson(c, path, wait = sleep) {
  for (let attempt = 1; ; attempt++) {
    const { status, data, retryAfter } = await c.apiStatus("GET", path);
    if (status === 200) return data;
    if ((status === 429 || status >= 500) && attempt < MAX_TRIES) {
      await wait((retryAfter ?? 2 ** attempt) * 1000);
      continue;
    }
    throw new CliError(`${path}: ${data.message ?? `HTTP ${status}`}`);
  }
}

/** Every row of a table, page by page, in key order. */
async function* pages(c, table, params, pageSize, wait) {
  let after = null;
  for (;;) {
    const q = new URLSearchParams({ ...params, limit: String(pageSize) });
    if (after) q.set("after", JSON.stringify(after));
    const page = await getJson(c, `/export/tables/${encodeURIComponent(table)}?${q}`, wait);
    for (const row of page.rows) yield row;
    if (!page.next) return;
    after = page.next;
  }
}

const keyOf = (t, row) => JSON.stringify(t.key.map((k) => row[k]));

function stamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

/**
 * Runs `openpurr export`. opts: { out, since, optional, page, json, sleep, now }.
 */
export async function runExport(c, opts, out, s) {
  const pageSize = Math.min(Math.max(Number(opts.page ?? 500) || 500, 1), 5000);
  let previous = null;
  if (opts.since) {
    const m = readManifest(opts.since);
    previous = { dir: opts.since, manifest: m, versions: customerVersions(opts.since, m) };
  }
  const since = previous ? previous.manifest.started_at_ms - DELTA_SLACK_MS : null;

  const info = await c.api("POST", "/export", { since });
  if (info.format !== FORMAT || info.version !== FORMAT_VERSION) {
    throw new CliError(`${c.url} exports format ${info.format} version ${info.version}; this CLI writes version ${FORMAT_VERSION}. Update the CLI.`);
  }
  const startedAt = info.now;
  const dir = opts.out ?? `openpurr-export-${stamp(startedAt)}Z${previous ? "-delta" : ""}`;
  if (existsSync(dir) && readdirSync(dir).length) throw new CliError(`${dir} already exists and isn't empty. Choose another --out.`, 2);
  mkdirSync(join(dir, "tables"), { recursive: true, mode: 0o700 });

  const log = (line) => !opts.json && out(line);
  log(`Exporting ${c.url} (${info.edition}) to ${dir}${previous ? `, changes since ${new Date(since).toISOString()}` : ""}.`);
  const started = Date.now();
  const tables = [];
  let changed = null; // delta: customers whose rows are re-sent in full
  let deleted = null;
  let index = null;
  let totalBytes = 0;

  for (const t of info.tables) {
    if (previous && !t.delta) continue;
    const params = {};
    if (previous) params.since = String(since);
    if (opts.optional) params.optional = "1";
    const size = opts.optional && t.name === "store_notification" ? Math.min(pageSize, 100) : pageSize;
    const f = new NdjsonFile(dir, `tables/${t.name}.ndjson`);

    if (previous && t.name === "customer") {
      // Every customer, to see who changed or went; only the changed ones go in the bundle.
      changed = [];
      const seen = new Set();
      index = new NdjsonFile(dir, "customer-index.ndjson");
      for await (const row of pages(c, t.name, params, size, opts.sleep)) {
        seen.add(row.id);
        index.write({ id: row.id, ledger_version: row.ledger_version });
        if (previous.versions.get(row.id) !== row.ledger_version) {
          f.write(row);
          changed.push(row.id);
        }
      }
      deleted = new NdjsonFile(dir, "deleted-customers.ndjson");
      for (const id of previous.versions.keys()) if (!seen.has(id)) deleted.write({ id });
    } else {
      const seen = previous && t.customer_column ? new Set() : null;
      for await (const row of pages(c, t.name, params, size, opts.sleep)) {
        f.write(row);
        seen?.add(keyOf(t, row));
      }
      if (seen && changed?.length) {
        for (let i = 0; i < changed.length; i += IDS_PER_REQUEST) {
          const q = { customers: changed.slice(i, i + IDS_PER_REQUEST).join(",") };
          for await (const row of pages(c, t.name, q, pageSize, opts.sleep)) {
            if (!seen.has(keyOf(t, row))) {
              seen.add(keyOf(t, row));
              f.write(row);
            }
          }
        }
      }
    }
    totalBytes += f.bytes;
    tables.push(f.close(t.name));
    log(`  ${t.name.padEnd(22)} ${String(f.rows).padStart(9)} rows`);
  }

  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: randomUUID(),
    kind: previous ? "delta" : "full",
    created_at: new Date(startedAt).toISOString(),
    source: { url: c.url, edition: info.edition, schema: info.schema ?? null },
    started_at_ms: startedAt,
    since_ms: since,
    previous_id: previous?.manifest.id ?? null,
    options: { optional_columns: !!opts.optional },
    tables,
    deleted_customers: deleted ? deleted.close() : null,
    customer_index: index ? index.close() : null,
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const rows = tables.reduce((n, t) => n + t.rows, 0);
  const seconds = (Date.now() - started) / 1000;
  if (opts.json) {
    out(json({ dir, id: manifest.id, kind: manifest.kind, rows, bytes: totalBytes, seconds, changed_customers: changed?.length ?? null, deleted_customers: manifest.deleted_customers?.rows ?? null }));
    return 0;
  }
  out(`\n${s.green("Done:")} ${rows} rows, ${(totalBytes / 1e6).toFixed(1)} MB in ${seconds.toFixed(1)} s.${previous ? ` ${changed.length} customers changed, ${manifest.deleted_customers.rows} gone.` : ""}`);
  out(`The bundle holds every customer and the hashes of passwords, keys and tokens: keep it private and delete it when you're done.`);
  out(
    s.yellow(
      "Operators' passwords and authenticators only work where OPERATOR_SECRET is the same as here. Give the new server this deployment's OPERATOR_SECRET.",
    ),
  );
  out(`Next: openpurr migrate import --bundle ${dir} (the Standard server's binary, with its DATABASE_URL).`);
  return 0;
}
