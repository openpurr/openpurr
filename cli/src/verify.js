// openpurr migrate verify: compares two deployments after an import, before cutting over. For
// every customer of the old one it asks both for CustomerInfo (as the SDK would get it, at the
// same moment) and compares them; it looks for customers only the new one has; and it compares
// every chart over all of history. Any difference is reported and the exit code is 1.

import { CliError, client } from "./client.js";
import { json } from "./output.js";

const IDS_PER_REQUEST = 50;
const SHOWN = 20;
const MAX_CHART_DAYS = 3660;
const DAY = 864e5;
/** Both editions' cleanup job deletes customers with nothing bought, first seen this long ago. */
const INACTIVE_AFTER_MS = 90 * DAY;

/**
 * A customer the cleanup job may delete: nothing bought or granted, first seen over 90 days ago.
 * The target's job may have run before the source's, so these missing on the target aren't a
 * difference. (The job also waits for recent attribute syncs, which CustomerInfo doesn't show.)
 */
function inactive(info, at) {
  const s = info?.subscriber;
  if (!s) return false;
  const empty = (o) => !o || Object.keys(o).length === 0;
  return empty(s.subscriptions) && empty(s.non_subscriptions) && empty(s.entitlements) && Date.parse(s.first_seen) < at - INACTIVE_AFTER_MS;
}

/** JSON with object keys sorted: key order inside CustomerInfo may differ between editions. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The paths where two JSON values differ (at most `max`). */
export function differences(a, b, path = "", out = [], max = 5) {
  if (out.length >= max) return out;
  if (canonical(a) === canonical(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], path ? `${path}.${k}` : k, out, max);
    return out;
  }
  out.push({ path: path || "(root)", from: a, to: b });
  return out;
}

/** CustomerInfo without what depends on the moment of the request. */
function comparable(info) {
  if (!info) return info;
  const { request_date: _d, request_date_ms: _m, ...rest } = info;
  return rest;
}

async function* customerIds(c, pageSize) {
  let after = null;
  for (;;) {
    const q = new URLSearchParams({ limit: String(pageSize) });
    if (after) q.set("after", JSON.stringify(after));
    const page = await c.api("GET", `/export/tables/customer?${q}`);
    for (const row of page.rows) yield row.id;
    if (!page.next) return;
    after = page.next;
  }
}

async function customerInfos(c, ids, at) {
  const q = new URLSearchParams({ ids: ids.join(","), at: String(at) });
  const { customers } = await c.api("GET", `/export/customer-info?${q}`);
  return new Map(customers.map((x) => [x.id, x]));
}

/**
 * Runs `openpurr migrate verify`. opts: { from: {url, token}, to: {url, token}, page, at, json, fetch }.
 */
export async function runVerify(opts, out, s) {
  if (!opts.from.url || !opts.to.url) throw new CliError("Usage: openpurr migrate verify --from URL --to URL (tokens: --from-token, --to-token, or your saved token for both)", 2);
  const from = client(opts.from, opts.fetch);
  const to = client(opts.to, opts.fetch);
  const pageSize = Math.min(Math.max(Number(opts.page ?? IDS_PER_REQUEST) || IDS_PER_REQUEST, 1), 100);
  const log = (line) => !opts.json && out(line);

  const [a, b] = await Promise.all([from.api("GET", "/export"), to.api("GET", "/export")]);
  log(`Comparing ${from.url} (${a.edition}) with ${to.url} (${b.edition}).`);
  const at = opts.at ?? Math.max(a.now, b.now);
  const report = { at, customers: 0, customer_differences: [], only_on_from: [], only_on_to: [], cleaned_up_on_to: 0, charts: 0, chart_differences: [] };

  // Customers.
  const seen = new Set();
  let batch = [];
  const compare = async () => {
    const [x, y] = await Promise.all([customerInfos(from, batch, at), customerInfos(to, batch, at)]);
    for (const id of batch) {
      const p = x.get(id);
      const q = y.get(id);
      if (!p) continue; // deleted since it was listed
      report.customers++;
      if (report.customers % 10000 === 0) log(`  ${report.customers} customers compared`);
      if (!q) {
        if (inactive(p.customer_info, at)) report.cleaned_up_on_to++;
        else report.only_on_from.push({ id, project_id: p.project_id, app_user_id: p.app_user_id });
        continue;
      }
      const diff = differences(
        { project_id: p.project_id, app_user_id: p.app_user_id, customer_info: comparable(p.customer_info) },
        { project_id: q.project_id, app_user_id: q.app_user_id, customer_info: comparable(q.customer_info) },
      );
      if (diff.length) report.customer_differences.push({ id, project_id: p.project_id, app_user_id: p.app_user_id, differences: diff });
    }
    batch = [];
  };
  for await (const id of customerIds(from, 1000)) {
    seen.add(id);
    batch.push(id);
    if (batch.length >= pageSize) await compare();
  }
  if (batch.length) await compare();
  for await (const id of customerIds(to, 1000)) if (!seen.has(id)) report.only_on_to.push({ id });

  // Charts, over all of history, both environments. The totals are brought up to date first.
  await Promise.all([from.apiStatus("POST", "/metrics/refresh", {}), to.apiStatus("POST", "/metrics/refresh", {})]);
  const [ma, mb] = await Promise.all([from.api("GET", "/metrics"), to.api("GET", "/metrics")]);
  const today = new Date(at).toISOString().slice(0, 10);
  const first = [ma.first_date, mb.first_date].filter(Boolean).sort()[0] ?? today;
  const windows = [];
  for (let start = Date.parse(first); start <= Date.parse(today); start += MAX_CHART_DAYS * DAY) {
    const end = Math.min(start + (MAX_CHART_DAYS - 1) * DAY, Date.parse(today));
    windows.push([new Date(start).toISOString().slice(0, 10), new Date(end).toISOString().slice(0, 10)]);
  }
  for (const chart of ma.charts.map((x) => x.id)) {
    for (const environment of ["production", "sandbox"]) {
      for (const [f, t] of windows) {
        const q = new URLSearchParams({ from: f, to: t, interval: "month", environment });
        const path = `/metrics/${encodeURIComponent(chart)}?${q}`;
        const [x, y] = await Promise.all([from.api("GET", path), to.api("GET", path)]);
        report.charts++;
        const diff = differences({ points: x.points, categories: x.categories ?? null }, { points: y.points, categories: y.categories ?? null });
        if (diff.length) report.chart_differences.push({ chart, environment, from: f, to: t, differences: diff });
      }
    }
  }

  const problems = report.customer_differences.length + report.only_on_from.length + report.only_on_to.length + report.chart_differences.length;
  if (opts.json) {
    out(json({ ok: problems === 0, ...report }));
    return problems ? 1 : 0;
  }
  const show = (v) => (v === undefined ? "(missing)" : JSON.stringify(v));
  for (const d of report.customer_differences.slice(0, SHOWN)) {
    out(`${s.red("✗")} ${d.app_user_id} (customer ${d.id}, project ${d.project_id})`);
    for (const x of d.differences) out(`    ${x.path}: ${show(x.from)} → ${show(x.to)}`);
  }
  for (const d of report.only_on_from.slice(0, SHOWN)) out(`${s.red("✗")} ${d.app_user_id} (customer ${d.id}) is missing on ${to.url}`);
  for (const d of report.only_on_to.slice(0, SHOWN)) out(`${s.red("✗")} customer ${d.id} is only on ${to.url}`);
  for (const d of report.chart_differences.slice(0, SHOWN)) {
    out(`${s.red("✗")} chart ${d.chart} (${d.environment}, ${d.from} to ${d.to})`);
    for (const x of d.differences) out(`    ${x.path}: ${show(x.from)} → ${show(x.to)}`);
  }
  if (report.cleaned_up_on_to) {
    out(s.dim(`${report.cleaned_up_on_to} inactive customers (nothing bought, first seen over 90 days ago) are already cleaned up on ${to.url}; ${from.url} deletes them on its next runs. Not a difference.`));
  }
  out(
    `\n${report.customers} customers and ${report.charts} charts compared at ${new Date(at).toISOString()}: ` +
      (problems
        ? s.red(`${problems} difference${problems === 1 ? "" : "s"}. Don't cut over yet.`)
        : s.green("no differences.")),
  );
  if (problems) {
    out("Customers who bought or changed something after the export differ until a delta is imported:");
    out("  openpurr export --since <the last bundle>, openpurr migrate import --bundle <it>, then verify again.");
  }
  return problems ? 1 : 0;
}
