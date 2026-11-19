// Charts: an overview of the key numbers, and a page per chart with its table and CSV.
// Totals come from /admin/v1/metrics, which the back office updates hourly from the ledger.
import { get, post } from "../api.js";
import { formatPeriod, formatValue, renderChart } from "../chart.js";
import { h, replace } from "../dom.js";
import { IconRefresh } from "../icons.js";
import { breadcrumb, busy, button, empty, errorCard, fmtDateTime, pageHeader, seg, select, table, toast, when } from "../ui.js";

const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const daysBefore = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

const RANGES = [
  { value: "30d", label: "30 days", days: 30, interval: "day" },
  { value: "90d", label: "90 days", days: 90, interval: "week" },
  { value: "12m", label: "12 months", days: 365, interval: "month" },
  { value: "all", label: "All time", days: null, interval: "month" },
];
const INTERVALS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** How each chart draws, and what its tooltip adds beyond the plotted series. */
const usd = (n) => formatValue(n, "usd");
const VIEW = {
  revenue: { form: "column", plot: ["net"], extra: (p) => [["Gross", usd(p.values.gross)], ["Refunded", usd(p.values.refunds)]] },
  mrr: { form: "line" },
  arr: { form: "line" },
  active_subscriptions: { form: "line" },
  paid_subscriptions: { form: "line" },
  active_trials: { form: "line" },
  new_trials: { form: "column" },
  new_customers: { form: "column" },
  refunds: { form: "column", extra: (p) => [["Amount", usd(p.values.amount)]] },
  non_subscription_purchases: { form: "column", extra: (p) => [["Revenue", usd(p.values.revenue)]] },
};
const OVERVIEW = ["revenue", "mrr", "active_subscriptions", "new_customers", "new_trials", "active_trials", "refunds", "non_subscription_purchases"];

// ---- Filters (kept in the URL) ------------------------------------------------------------------

function readFilters() {
  const p = new URLSearchParams(location.search);
  const range = RANGES.find((r) => r.value === p.get("range")) ?? RANGES[1];
  return {
    range: range.value,
    interval: INTERVALS.some((i) => i.value === p.get("interval")) ? p.get("interval") : range.interval,
    environment: p.get("environment") === "sandbox" ? "sandbox" : "production",
    app: p.get("app") ?? "",
    store: p.get("store") ?? "",
  };
}

function filterQuery(f) {
  const p = new URLSearchParams();
  const range = RANGES.find((r) => r.value === f.range);
  if (f.range !== "90d") p.set("range", f.range);
  if (f.interval !== range.interval) p.set("interval", f.interval);
  if (f.environment !== "production") p.set("environment", f.environment);
  if (f.app) p.set("app", f.app);
  if (f.store) p.set("store", f.store);
  return p.size ? `?${p}` : "";
}

/** The next period boundary on or after `date`, so a chart never starts with a part-period. */
function snapForward(date, interval) {
  if (interval === "day") return date;
  const d = new Date(`${date}T00:00:00Z`);
  if (interval === "week") {
    const back = (d.getUTCDay() + 6) % 7; // days since Monday
    return back ? daysBefore(date, back - 7) : date;
  }
  return d.getUTCDate() === 1 ? date : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** from/to for the range, and the same-length period just before it. */
function dates(f, firstDate) {
  const to = today();
  const range = RANGES.find((r) => r.value === f.range);
  const start = range.days ? daysBefore(to, range.days - 1) : firstDate && firstDate < to ? firstDate : daysBefore(to, 364);
  // "All time" keeps its first, partial period: that's when the data starts.
  const snapped = range.days ? snapForward(start, f.interval) : start;
  const from = snapped <= to ? snapped : start;
  const length = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  return { from, to, prevFrom: daysBefore(from, length), prevTo: daysBefore(from, 1), length };
}

function apiQuery(f, from, to, interval = f.interval) {
  const p = new URLSearchParams({ from, to, interval, environment: f.environment });
  if (f.app) p.set("app", f.app);
  if (f.store) p.set("store", f.store);
  return p;
}

function filterBar(ctx, f, onChange, info, onRefresh) {
  const set = (patch) => {
    Object.assign(f, patch);
    history.replaceState(null, "", location.pathname + filterQuery(f));
    onChange();
  };
  const controls = [
    seg(RANGES.map((r) => ({ value: r.value, label: r.label })), f.range, (v) => set({ range: v, interval: RANGES.find((r) => r.value === v).interval })),
    seg(INTERVALS, f.interval, (v) => set({ interval: v })),
  ];
  if (ctx.apps.length > 1) {
    const s = select([{ value: "", label: "All apps" }, ...ctx.apps.map((a) => ({ value: a.id, label: a.id }))], f.app);
    s.classList.add("select-auto");
    s.setAttribute("aria-label", "App");
    s.addEventListener("change", () => set({ app: s.value }));
    controls.push(s);
  }
  const stores = [...new Set(ctx.apps.map((a) => a.store))];
  if (stores.length > 1) {
    const s = select([{ value: "", label: "All stores" }, { value: "app_store", label: "App Store" }, { value: "play_store", label: "Google Play" }], f.store);
    s.classList.add("select-auto");
    s.setAttribute("aria-label", "Store");
    s.addEventListener("change", () => set({ store: s.value }));
    controls.push(s);
  }
  const env = select([{ value: "production", label: "Production" }, { value: "sandbox", label: "Sandbox" }], f.environment);
  env.classList.add("select-auto");
  env.setAttribute("aria-label", "Environment");
  env.addEventListener("change", () => set({ environment: env.value }));
  controls.push(env);
  const refresh = button(null, { variant: "outline", size: "sm", icon: IconRefresh(14), title: "Update the totals now" });
  refresh.addEventListener("click", () => busy(refresh, onRefresh));
  return h(
    "div",
    { class: "filter-bar" },
    controls,
    h("span", { class: "spacer" }),
    h("span", { class: "small muted", title: info.updated_at ? `Totals last updated ${fmtDateTime(info.updated_at)}` : "" }, info.updated_at ? ["Updated ", when(info.updated_at)] : "Not updated yet"),
    refresh,
  );
}

/** Makes sure the totals exist: the first view after setup (or demo data) builds them. */
async function ensureTotals() {
  let info = await get("/metrics");
  if (!info.updated_at) {
    await post("/metrics/refresh", {});
    info = await get("/metrics");
  }
  return info;
}

async function refreshNow(rerender) {
  const r = await post("/metrics/refresh", {});
  toast(r.refreshed ? "Totals updated" : "Totals were updated less than a minute ago", r.refreshed ? "success" : "info");
  rerender();
}

// ---- Numbers ------------------------------------------------------------------------------------

/** The headline for a chart over a range: the latest value (point in time) or the total (per period). */
function headline(result, key = (VIEW[result.chart].plot ?? [result.series[0].key])[0]) {
  if (!result.points.length) return 0;
  if (result.kind === "running") {
    const last = result.points.at(-1).values;
    return result.chart === "active_subscriptions" ? (last.paid ?? 0) + (last.trials ?? 0) : last[key] ?? 0;
  }
  return result.points.reduce((n, p) => n + (p.values[key] ?? 0), 0);
}

function delta(now, before, label) {
  if (!before) return h("span", { class: "stat-delta" }, label ? `— ${label}` : "");
  const change = (now - before) / Math.abs(before);
  const up = change >= 0;
  return h(
    "span",
    { class: `stat-delta ${Math.abs(change) < 0.0005 ? "" : up ? "up" : "down"}` },
    `${up ? "▲" : "▼"} ${Math.abs(change * 100).toFixed(1)}% `,
    h("span", { class: "muted" }, label),
  );
}

function statTile(label, value, unit, deltaNode) {
  return h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-figure" }, formatValue(value, unit, { compact: value >= 1e5, whole: true })), deltaNode);
}

function legend(result, plotted) {
  if (plotted.length < 2) return null;
  return h(
    "div",
    { class: "chart-legend" },
    plotted.map((s, i) => h("span", { class: "chart-legend-item" }, h("span", { class: "chart-swatch", style: { background: `var(--chart-${i + 1})` } }), s.label)),
  );
}

function plotted(result) {
  const keys = VIEW[result.chart].plot;
  return keys ? result.series.filter((s) => keys.includes(s.key)) : result.series;
}

// ---- Overview -----------------------------------------------------------------------------------

export async function chartsPage(ctx) {
  const f = readFilters();
  const info = await ensureTotals();
  const body = h("div", { class: "stack" });
  const page = h("div", null);

  const load = async () => {
    replace(body, h("div", { class: "loading" }, "Loading…"));
    const { from, to, prevFrom, prevTo } = dates(f, info.first_date);
    const allApps = ctx.operator.app_ids === null;
    const ids = OVERVIEW.filter((id) => id !== "new_customers" || allApps);
    const [results, prevRevenue, prevCustomers] = await Promise.all([
      Promise.all(ids.map((id) => get(`/metrics/${id}?${apiQuery(f, from, to)}`))),
      get(`/metrics/revenue?${apiQuery(f, prevFrom, prevTo, "month")}`),
      allApps ? get(`/metrics/new_customers?${apiQuery(f, prevFrom, prevTo, "month")}`) : null,
    ]);
    const by = Object.fromEntries(results.map((r) => [r.chart, r]));
    const first = (r) => (r.points.length ? r : null);
    const startOf = (r, key) => {
      const p = first(r)?.points[0]?.values ?? {};
      return key === "all" ? (p.paid ?? 0) + (p.trials ?? 0) : p[key] ?? 0;
    };
    const span = "vs the period before";
    const tiles = h(
      "div",
      { class: "stats" },
      statTile("MRR", headline(by.mrr), "usd", delta(headline(by.mrr), startOf(by.mrr, "mrr"), `since ${formatPeriod(by.mrr.points[0]?.date ?? from, "day")}`)),
      statTile("Active subscriptions", headline(by.active_subscriptions), "count", delta(headline(by.active_subscriptions), startOf(by.active_subscriptions, "all"), `since ${formatPeriod(by.active_subscriptions.points[0]?.date ?? from, "day")}`)),
      statTile("Revenue", headline(by.revenue), "usd", delta(headline(by.revenue), headline(prevRevenue), span)),
      allApps
        ? statTile("New customers", headline(by.new_customers), "count", delta(headline(by.new_customers), headline(prevCustomers), span))
        : statTile("Active trials", headline(by.active_trials), "count", h("span", { class: "stat-delta" }, "")),
    );

    const noData = results.every((r) => r.points.every((p) => Object.values(p.values).every((v) => !v)));
    if (noData && f.range !== "all") {
      replace(body, tiles, h("div", { class: "card" }, empty({ title: "Nothing in this range yet", text: "Charts fill in as customers and purchases arrive. Totals update every hour; use the refresh button to update them now." })));
      return;
    }
    const notes = [...new Set(results.flatMap((r) => r.notes))];
    replace(
      body,
      tiles,
      notes.length ? h("div", { class: "chart-notes small muted" }, notes.map((n) => h("p", null, n))) : null,
      h(
        "div",
        { class: "chart-grid" },
        results.map((r) => {
          const host = h("div");
          const shown = plotted(r);
          const card = h(
            "section",
            { class: "card chart-card" },
            h(
              "div",
              { class: "chart-card-head" },
              h("a", { class: "chart-card-title", href: `/admin/charts/${r.chart}${filterQuery(f)}`, "data-nav": "" }, r.label),
              h("div", { class: "chart-card-figure" }, formatValue(headline(r), r.unit, { compact: true })),
              h("div", { class: "card-sub" }, r.kind === "running" ? "now" : `total, ${RANGES.find((x) => x.value === f.range).label.toLowerCase()}`),
            ),
            legend(r, shown),
            host,
          );
          queueMicrotask(() => renderChart(host, { points: r.points, series: shown, unit: r.unit, interval: r.interval, form: VIEW[r.chart].form, height: 200, label: r.label, extra: VIEW[r.chart].extra }));
          return card;
        }),
      ),
    );
  };

  // The filter row is redrawn on every change: picking a range also picks its interval.
  const changed = () => (rebuild(), void load().catch((err) => replace(body, errorCard(err))));
  const rebuild = () =>
    replace(
      page,
      pageHeader("Charts", "Revenue, subscriptions and customers, from your purchase ledger. Money is in USD at each purchase date's exchange rate; days are UTC."),
      filterBar(ctx, f, changed, info, () => refreshNow(ctx.rerender)),
      body,
    );
  rebuild();
  await load();
  return page;
}

/** Money or a count, per value: some count charts carry an amount alongside (refunds, purchases). */
function unitOf(r, key) {
  if (["gross", "amount", "revenue", "net", "mrr", "arr"].includes(key)) return "usd";
  if (r.chart === "revenue") return "usd";
  return "count";
}

// ---- One chart ----------------------------------------------------------------------------------

export async function chartPage(ctx, id) {
  const f = readFilters();
  const info = await ensureTotals();
  const known = info.charts.find((c) => c.id === id);
  if (!known) return h("div", { class: "card" }, empty({ title: "No such chart", text: "Pick one from Charts." }));
  const body = h("div", { class: "stack" });

  const load = async () => {
    replace(body, h("div", { class: "loading" }, "Loading…"));
    const { from, to } = dates(f, info.first_date);
    const q = apiQuery(f, from, to);
    const r = await get(`/metrics/${id}?${q}`);
    const shown = plotted(r);
    const host = h("div");
    const keys = [...new Set(r.points.flatMap((p) => Object.keys(p.values)))];
    const labelOf = (k) => r.series.find((s) => s.key === k)?.label ?? { gross: "Gross", amount: "Amount (USD)", revenue: "Revenue (USD)" }[k] ?? k;
    const csv = h("a", { class: "btn btn-outline btn-sm", href: `/admin/v1/metrics/${id}?${q}&format=csv`, download: "" }, "Download CSV");
    replace(
      body,
      h(
        "section",
        { class: "card chart-card" },
        h(
          "div",
          { class: "chart-card-head" },
          h("div", { class: "chart-card-figure big" }, formatValue(headline(r), r.unit)),
          h("div", { class: "card-sub" }, r.kind === "running" ? "now" : `total, ${formatPeriod(r.from, "day", { long: true })} to ${formatPeriod(r.to, "day", { long: true })}`),
        ),
        legend(r, shown),
        host,
        r.notes.length ? h("div", { class: "chart-notes small muted" }, r.notes.map((n) => h("p", null, n))) : null,
      ),
      h(
        "section",
        { class: "card card-tight" },
        h("div", { class: "card-header" }, h("h2", { class: "card-title" }, "Table"), h("div", { class: "actions" }, csv)),
        table(
          [{ label: r.interval === "day" ? "Day" : r.interval === "week" ? "Week" : "Month" }, ...keys.map((k) => ({ label: labelOf(k), class: "num" }))],
          r.points
            .slice()
            .reverse()
            .map((p) => [formatPeriod(p.date, r.interval, { long: true }), ...keys.map((k) => formatValue(p.values[k] ?? 0, unitOf(r, k)))]),
        ),
      ),
    );
    queueMicrotask(() => renderChart(host, { points: r.points, series: shown, unit: r.unit, interval: r.interval, form: VIEW[id].form, height: 320, label: r.label, extra: VIEW[id].extra }));
  };

  const picker = select(info.charts.map((c) => ({ value: c.id, label: c.label })), id);
  picker.classList.add("select-auto");
  picker.setAttribute("aria-label", "Chart");
  picker.addEventListener("change", () => ctx.navigate(`/admin/charts/${picker.value}${filterQuery(f)}`));

  const page = h("div");
  const changed = () => (rebuild(), void load().catch((err) => replace(body, errorCard(err))));
  const rebuild = () =>
    replace(
      page,
      breadcrumb([{ label: "Charts", href: `/admin/charts${filterQuery(f)}` }, { label: known.label }]),
      pageHeader(known.label, known.description, [picker]),
      filterBar(ctx, f, changed, info, () => refreshNow(ctx.rerender)),
      body,
    );
  rebuild();
  await load();
  return page;
}
