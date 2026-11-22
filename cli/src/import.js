// openpurr import: moves existing customers to openpurr from a CSV file, typically RevenueCat
// Support's migration export or an Adapty event export. Each row says which app user owns which store purchase; the back
// office asks Apple or Google for the purchase itself (POST /admin/v1/import, one row per request).
//
// It's safe to stop and run again: progress is saved next to the file, and importing a row twice
// changes nothing. Problems with single rows are written to a report and don't stop the run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CliError } from "./client.js";
import { json } from "./output.js";

/** Header names we recognize (lowercased, spaces and dashes as underscores), by field. */
const COLUMNS = {
  app_user_id: ["app_user_id", "appuserid", "rc_app_user_id", "customer_user_id", "customer_id", "user_id"],
  store: ["store", "platform"],
  app: ["app", "app_id", "openpurr_app"],
  transaction_id: ["original_transaction_id", "original_store_transaction_id", "transaction_id", "store_transaction_id"],
  purchase_token: ["purchase_token", "fetch_token", "token", "google_purchase_token"],
  product_id: ["product_id", "product_identifier", "store_product_id"],
  aliases: ["aliases", "alias"],
  first_seen: ["first_seen", "first_seen_at", "first_seen_time"],
};
const GOOGLE_STORES = new Set(["play_store", "playstore", "google", "google_play", "android"]);
const MAX_RETRIES = 5;
const STATUS_STOP = new Set([403, 404, 409, 429]);

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF or LF. Returns rows of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** Maps a header row to fields. Columns starting with $ (reserved) or attr: are attributes. */
export function mapHeader(header) {
  const map = {};
  const attributes = [];
  header.forEach((raw, i) => {
    const name = raw.trim();
    if (name.startsWith("$")) return attributes.push({ i, key: name });
    const m = /^(?:attr|attribute):(.+)$/i.exec(name);
    if (m) return attributes.push({ i, key: m[1].trim() });
    const norm = name.toLowerCase().replace(/[\s-]+/g, "_");
    for (const [field, names] of Object.entries(COLUMNS)) {
      const rank = names.indexOf(norm);
      if (rank >= 0 && (map[field] === undefined || rank < map[field].rank)) map[field] = { i, rank };
    }
  });
  if (!map.app_user_id) throw new CliError(`The file needs an app_user_id column (found: ${header.join(", ")}).`, 2);
  return { columns: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.i])), attributes };
}

/**
 * Why a row can't be imported, decided here so it doesn't cost a request: a row with no app user
 * ID (an anonymous user in Adapty's export), or a Google Play row with only an order ID. The app
 * update's syncPurchases brings both over. Null when the row can go to the API.
 */
export function skipReason(row) {
  if (!row.app_user_id) return "No app user ID (an anonymous user). The app update's syncPurchases brings them over.";
  const store = String(row.store ?? "").toLowerCase().replace(/[\s-]/g, "_");
  if (row.transaction_id && !row.purchase_token && GOOGLE_STORES.has(store)) {
    return "A Google Play row without a purchase token: an order ID can't be looked up. The app update's syncPurchases brings it over.";
  }
  return null;
}

/** A CSV line as an import row for the API. */
export function toRow(cells, { columns, attributes }, defaults) {
  const get = (field) => (columns[field] === undefined ? "" : (cells[columns[field]] ?? "").trim());
  const row = { app_user_id: get("app_user_id") };
  for (const f of ["store", "app", "product_id", "aliases", "first_seen"]) if (get(f)) row[f] = get(f);
  // A token means Google Play; the same export's transaction column then holds the order ID.
  if (get("purchase_token")) row.purchase_token = get("purchase_token");
  else if (get("transaction_id")) row.transaction_id = get("transaction_id");
  if (defaults.store && !row.store) row.store = defaults.store;
  if (defaults.app && !row.app) row.app = defaults.app;
  const attrs = {};
  for (const { i, key } of attributes) if ((cells[i] ?? "").trim()) attrs[key] = cells[i].trim();
  if (Object.keys(attrs).length) row.attributes = attrs;
  return row;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (x) => x.toLocaleString("en-US");

/**
 * Runs an import. Returns the exit code: 0 done, 1 stopped (run again to resume), 2 bad usage.
 * opts: { file, dryRun, restart, limit, concurrency, project, app, store, json, sleep }.
 */
export async function runImport(c, opts, out, s) {
  const { file } = opts;
  if (!file) throw new CliError("Usage: openpurr import FILE.csv [--dry-run] [--app ID] [--project ID]", 2);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new CliError(`Can't read ${file}: ${e.message}`, 2);
  }
  const [header, ...lines] = parseCsv(text);
  if (!header) throw new CliError(`${file} is empty.`, 2);
  const mapping = mapHeader(header);
  const progressPath = `${file}.openpurr-import.json`;
  const reportPath = `${file}${opts.dryRun ? ".dry-run" : ""}.report.csv`;
  const wait = opts.sleep ?? sleep;

  // Resume where the last run stopped (not for dry runs, which change nothing).
  let state = { next: 0, imported: 0, created: 0, problems: 0, covered: 0, skipped: 0 };
  if (!opts.dryRun && !opts.restart && existsSync(progressPath)) {
    state = { ...state, ...JSON.parse(readFileSync(progressPath, "utf8")) };
    if (state.next >= lines.length) {
      out(`${file} was already imported (${n(state.imported)} rows). Use --restart to import it again.`);
      return 0;
    }
    if (!opts.json) out(s.dim(`Resuming at row ${n(state.next + 2)} of ${n(lines.length + 1)} (from ${progressPath}).`));
  }
  const report = existsSync(reportPath) && state.next > 0 ? readFileSync(reportPath, "utf8") : "row,app_user_id,result,message\n";
  let reportText = report;
  const save = () => {
    writeFileSync(reportPath, reportText);
    if (!opts.dryRun) writeFileSync(progressPath, json(state));
  };
  const note = (line, row, result, message) => {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    reportText += `${line + 2},${q(row.app_user_id)},${result},${q(message)}\n`;
  };

  // Transaction IDs already recorded: an App Store customer's history comes back whole, so their
  // other rows are already covered.
  const covered = new Set();
  const end = opts.limit ? Math.min(lines.length, state.next + Number(opts.limit)) : lines.length;
  const concurrency = Math.max(1, Math.min(8, Number(opts.concurrency) || 4));
  const wouldCreate = { n: 0 };
  let lastShown = Date.now();
  let stop = null;

  async function one(i) {
    const row = toRow(lines[i], mapping, opts);
    const id = row.transaction_id ?? row.purchase_token;
    if (id && covered.has(id)) {
      state.covered++;
      return null;
    }
    const skip = skipReason(row);
    if (skip) {
      state.skipped++;
      note(i, row, "skipped", skip);
      return null;
    }
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await c.apiStatus("POST", "/import", { row, dry_run: !!opts.dryRun, ...(opts.project ? { project: opts.project } : {}) });
      } catch (e) {
        if (e instanceof CliError && /Couldn't reach/.test(e.message) && attempt < MAX_RETRIES) {
          await wait(2 ** attempt * 1000);
          continue;
        }
        throw e;
      }
      if (r.status === 200) {
        for (const t of r.data.transaction_ids ?? []) covered.add(t);
        state.imported++;
        if (r.data.created && opts.dryRun) wouldCreate.n++;
        else if (r.data.created) state.created++;
        const notes = [
          ...r.data.kept_owner.map((k) => `kept ${k.original_transaction_id} with ${k.app_user_id}, who already has it`),
          ...(r.data.skipped_products.length ? [`products not in the config: ${r.data.skipped_products.join(", ")}`] : []),
          ...(r.data.aliases_skipped.length ? [`aliases used by another customer: ${r.data.aliases_skipped.join(", ")}`] : []),
        ];
        if (notes.length) note(i, row, "imported_with_notes", notes.join("; "));
        return null;
      }
      if (r.status === 503 && attempt < MAX_RETRIES) {
        await wait((r.retryAfter ?? 2 ** attempt) * 1000);
        continue;
      }
      if (STATUS_STOP.has(r.status) || r.status >= 500) return { i, status: r.status, message: r.data.message ?? `HTTP ${r.status}` };
      state.problems++;
      note(i, row, r.data.code ?? `http_${r.status}`, r.data.message);
      return null;
    }
  }

  let i = state.next;
  while (i < end && !stop) {
    const batch = [];
    for (let k = i; k < Math.min(end, i + concurrency); k++) batch.push(k);
    const results = await Promise.all(batch.map(one));
    stop = results.find(Boolean) ?? null;
    // Rows after a stop are redone next time (harmless: importing twice changes nothing).
    i = stop ? stop.i : batch.at(-1) + 1;
    state.next = i;
    save();
    if (!opts.json && Date.now() - lastShown > 5000) {
      lastShown = Date.now();
      out(s.dim(`${n(i)} of ${n(lines.length)} rows…`));
    }
  }

  const summary = {
    file,
    dry_run: !!opts.dryRun,
    rows: lines.length,
    processed: i,
    imported: state.imported,
    new_customers: opts.dryRun ? wouldCreate.n : state.created,
    already_covered: state.covered,
    skipped: state.skipped,
    problems: state.problems,
    report: reportPath,
    stopped: stop ? stop.message : null,
  };
  if (opts.json) {
    out(json(summary));
  } else {
    const verb = opts.dryRun ? "would import" : "imported";
    out(
      `${opts.dryRun ? s.bold("Dry run: ") : ""}${n(i)} of ${n(lines.length)} rows: ${verb} ${n(state.imported)}` +
        ` (${n(summary.new_customers)} new customers), ${n(state.covered)} already covered by another row,` +
        `${state.skipped ? ` ${n(state.skipped)} skipped,` : ""} ${n(state.problems)} problems.`,
    );
    if (state.problems || reportText.split("\n").length > 2) out(`Details: ${reportPath}`);
    if (stop) {
      out(s.red(`Stopped at row ${n(stop.i + 2)}: ${stop.message}`));
      if (!opts.dryRun) out("Fix that if needed, then run the same command again: it carries on from there.");
    } else if (i < lines.length) {
      out(`Run the same command again to continue from row ${n(i + 2)}.`);
    }
  }
  return stop ? 1 : 0;
}
