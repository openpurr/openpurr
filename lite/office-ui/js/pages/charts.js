// Charts: an overview of the key numbers, and a page per chart with its table and CSV.
// Totals come from /admin/v1/metrics, which the back office updates hourly from the ledger.
import { get, post, withProject } from "../api.js";
import { formatPeriod, formatValue, renderChart } from "../chart.js";
import { h, replace } from "../dom.js";
import { formatNumber, t, tk, tx } from "../i18n.js";
import { IconRefresh } from "../icons.js";
import { breadcrumb, busy, button, empty, errorCard, fmtDateTime, pageHeader, seg, select, table, toast, when } from "../ui.js";

const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const daysBefore = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

const RANGES = [
  // `inline`: the range as it reads inside a sentence ("total, all time").
  { value: "30d", label: tk("30 days"), inline: tk("30 days"), days: 30, interval: "day" },
  { value: "90d", label: tk("90 days"), inline: tk("90 days"), days: 90, interval: "week" },
  { value: "12m", label: tk("12 months"), inline: tk("12 months"), days: 365, interval: "month" },
  { value: "all", label: tk("All time"), inline: tk("all time"), days: null, interval: "month" },
];
const INTERVALS = [
  { value: "day", label: tk("Day") },
  { value: "week", label: tk("Week") },
  { value: "month", label: tk("Month") },
];

/**
 * How each chart draws: its form, series colors (CSS variables, checked with the dataviz palette
 * validator in the order they stack), what its tooltip adds, and its headline number.
 */
const usd = (n) => formatValue(n, "usd");
const count = (n) => formatValue(n, "count");
const pct = (n) => formatValue(n, "percent");
const signed = (n, unit) => `${n > 0 ? "+" : ""}${formatValue(n, unit, { compact: Math.abs(n) >= 1e5, whole: true })}`;
const sum = (r, key) => r.points.reduce((n, p) => n + (p.values[key] ?? 0), 0);
// One color per meaning across the movement charts: new purple, reactivation/conversion aqua,
// expansion blue, contraction yellow, churn/expiry magenta.
const C = { new: "--chart-1", second: "--chart-2", up: "--chart-aqua", expansion: "--chart-blue", contraction: "--chart-yellow", out: "--chart-magenta" };
const rangeLabel = (f) => t(RANGES.find((x) => x.value === f.range).inline);
const VIEW = {
  revenue: { form: "column", plot: ["net"], extra: (p) => [[t("Gross"), usd(p.values.gross)], [t("Refunded"), usd(p.values.refunds)]] },
  mrr_movement: {
    form: "stacked",
    colors: [C.new, C.up, C.expansion, C.contraction, C.out],
    extra: (p) => [[t("Net change"), usd(p.values.net)]],
    headline: (r) => ({ text: signed(sum(r, "net"), "usd"), sub: (f) => t("net change, {range}", { range: rangeLabel(f) }) }),
  },
  subscription_movement: {
    form: "stacked",
    colors: [C.new, C.up, C.out],
    extra: (p) => [[t("Net change"), count(p.values.net)], [t("Renewed"), count(p.values.renewed)]],
    headline: (r) => ({ text: signed(sum(r, "net"), "count"), sub: (f) => t("net change, {range}", { range: rangeLabel(f) }) }),
  },
  trial_movement: {
    form: "stacked",
    colors: [C.new, C.up, C.out],
    extra: (p) => [[t("Cancelled"), count(p.values.cancelled)], [t("Conversion rate"), pct(p.values.conversion_rate)]],
    headline: (r) => {
      const converted = -sum(r, "converted");
      const ended = converted - sum(r, "expired");
      return { text: ended ? pct(Math.round((converted / ended) * 1000) / 10) : "—", sub: (f) => t("of ended trials converted, {range}", { range: rangeLabel(f) }) };
    },
  },
  churn: {
    form: "line",
    extra: (p) => [[t("Churned"), count(p.values.churned)], [t("Paying at start"), count(p.values.paying_at_start)]],
    headline: (r) => {
      const rates = r.points.map((p) => p.values.rate).filter((v) => v !== null && v !== undefined);
      return { text: rates.length ? pct(rates.reduce((a, b) => a + b, 0) / rates.length) : "—", sub: () => (r.interval === "day" ? t("average per day") : r.interval === "week" ? t("average per week") : t("average per month")) };
    },
  },
  refund_rate: {
    form: "line",
    extra: (p) => [[t("Refunds"), t("{refunds} of {purchases}", { refunds: count(p.values.refunds), purchases: count(p.values.transactions) })], [t("Of revenue"), pct(p.values.amount_rate)]],
    headline: (r) => {
      const total = sum(r, "transactions");
      return { text: total ? pct(Math.round((sum(r, "refunds") / total) * 1000) / 10) : "—", sub: (f) => t("of purchases, {range}", { range: rangeLabel(f) }) };
    },
  },
  subscription_status: {
    form: "breakdown",
    headline: (r) => {
      const access = r.categories.filter((c) => ["active", "cancelled", "trial", "grace"].includes(c.key)).reduce((n, c) => n + c.value, 0);
      return { text: count(access), sub: () => t("with access now") };
    },
  },
  mrr: { form: "line" },
  arr: { form: "line" },
  active_subscriptions: { form: "line" },
  paid_subscriptions: { form: "line" },
  active_trials: { form: "line" },
  new_trials: { form: "column" },
  new_customers: { form: "column" },
  refunds: { form: "column", extra: (p) => [[t("Amount"), usd(p.values.amount)]] },
  non_subscription_purchases: { form: "column", extra: (p) => [[t("Revenue"), usd(p.values.revenue)]] },
};
const OVERVIEW = [
  "revenue",
  "mrr",
  "mrr_movement",
  "active_subscriptions",
  "churn",
  "new_customers",
  "new_trials",
  "active_trials",
  "refunds",
  "non_subscription_purchases",
];

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
    product: p.get("product") ?? "",
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
  if (f.product) p.set("product", f.product);
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
  if (f.product) p.set("product", f.product);
  return p;
}

function filterBar(ctx, f, onChange, info, onRefresh) {
  const set = (patch) => {
    Object.assign(f, patch);
    history.replaceState(null, "", location.pathname + filterQuery(f));
    onChange();
  };
  const controls = [
    seg(RANGES.map((r) => ({ value: r.value, label: t(r.label) })), f.range, (v) => set({ range: v, interval: RANGES.find((r) => r.value === v).interval })),
    seg(INTERVALS.map((i) => ({ value: i.value, label: t(i.label) })), f.interval, (v) => set({ interval: v })),
  ];
  if (ctx.apps.length > 1) {
    const s = select([{ value: "", label: t("All apps") }, ...ctx.apps.map((a) => ({ value: a.id, label: a.id }))], f.app);
    s.classList.add("select-auto");
    s.setAttribute("aria-label", t("App"));
    // A product filter belongs to the apps it came from; changing app clears it if it doesn't fit.
    s.addEventListener("change", () => set({ app: s.value, product: s.value && !productsFor(ctx, s.value).includes(f.product) ? "" : f.product }));
    controls.push(s);
  }
  const products = productsFor(ctx, f.app);
  if (products.length > 1) {
    const s = select([{ value: "", label: t("All products") }, ...products.map((p) => ({ value: p, label: p }))], f.product);
    s.classList.add("select-auto");
    s.setAttribute("aria-label", t("Product"));
    s.addEventListener("change", () => set({ product: s.value }));
    controls.push(s);
  }
  const stores = [...new Set(ctx.apps.map((a) => a.store))];
  if (stores.length > 1) {
    const s = select([{ value: "", label: t("All stores") }, { value: "app_store", label: "App Store" }, { value: "play_store", label: "Google Play" }], f.store);
    s.classList.add("select-auto");
    s.setAttribute("aria-label", t("Store"));
    s.addEventListener("change", () => set({ store: s.value }));
    controls.push(s);
  }
  const env = select([{ value: "production", label: t("Production") }, { value: "sandbox", label: t("Sandbox") }], f.environment);
  env.classList.add("select-auto");
  env.setAttribute("aria-label", t("Environment"));
  env.addEventListener("change", () => set({ environment: env.value }));
  controls.push(env);
  const refresh = button(null, { variant: "outline", size: "sm", icon: IconRefresh(14), title: t("Update the totals now") });
  refresh.addEventListener("click", () => busy(refresh, onRefresh));
  return h(
    "div",
    { class: "filter-bar" },
    controls,
    // Kept together, so a wrapping filter row never strands the refresh button.
    h(
      "span",
      { class: "filter-status" },
      h("span", { class: "small muted", title: info.updated_at ? t("Totals last updated {time}", { time: fmtDateTime(info.updated_at) }) : "" }, info.updated_at ? tx("Updated {time}", { time: when(info.updated_at) }) : t("Not updated yet")),
      refresh,
    ),
  );
}

/** Product IDs as charts name them (Google base plans separately), for one app or all of them. */
function productsFor(ctx, app) {
  return [...new Set(ctx.apps.filter((a) => !app || a.id === app).flatMap((a) => a.products ?? []))].sort();
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
  if (r.deferred) toast(t("An import is running. Totals update an hour after it finishes."), "info");
  else toast(r.refreshed ? t("Totals updated") : t("Totals were updated less than a minute ago"), r.refreshed ? "success" : "info");
  rerender();
}

// ---- Numbers ------------------------------------------------------------------------------------

/** The headline for a chart over a range: the latest value (point in time) or the total (per period). */
function headline(result, key = (VIEW[result.chart].plot ?? [result.series[0].key])[0]) {
  if (!result.points?.length) return 0;
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
    `${up ? "▲" : "▼"} ${formatNumber(Math.abs(change), { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })} `,
    h("span", { class: "muted" }, label),
  );
}

function statTile(label, value, unit, deltaNode) {
  return h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-figure" }, formatValue(value, unit, { compact: value >= 1e5, whole: true })), deltaNode);
}

function legend(result, plotted) {
  if (plotted.length < 2) return null;
  const colors = VIEW[result.chart].colors;
  return h(
    "div",
    { class: "chart-legend" },
    plotted.map((s, i) => h("span", { class: "chart-legend-item" }, h("span", { class: "chart-swatch", style: { background: `var(${colors?.[i] ?? `--chart-${i + 1}`})` } }), s.label)),
  );
}

/** The figure at the top of a chart card: the chart's own headline, or its latest value / total. */
function figure(r, f, opts = {}) {
  const custom = VIEW[r.chart].headline?.(r);
  if (custom) return { text: custom.text, sub: custom.sub(f) };
  return {
    text: formatValue(headline(r), r.unit, { compact: opts.compact ?? true }),
    sub: r.kind === "running" ? t("now") : opts.long ?? t("total, {range}", { range: rangeLabel(f) }),
  };
}

/** A breakdown (Subscription status): one bar per category, longest = 100%. */
function breakdown(r) {
  const max = Math.max(1, ...r.categories.map((c) => c.value));
  return h(
    "div",
    { class: "breakdown", role: "list" },
    r.categories.map((c) =>
      h(
        "div",
        { class: "breakdown-row", role: "listitem" },
        h("span", { class: "breakdown-label" }, t(c.label)),
        h("span", { class: "breakdown-track" }, c.value ? h("span", { class: "breakdown-bar", style: { width: `${(c.value / max) * 100}%` } }) : null),
        h("span", { class: "breakdown-value" }, count(c.value)),
      ),
    ),
  );
}

function plotted(result) {
  const keys = VIEW[result.chart].plot;
  // Series labels come from the server in English: shown translated.
  return (keys ? result.series.filter((s) => keys.includes(s.key)) : result.series).map((s) => ({ ...s, label: t(s.label) }));
}

// ---- Overview -----------------------------------------------------------------------------------

export async function chartsPage(ctx) {
  const f = readFilters();
  const info = await ensureTotals();
  const body = h("div", { class: "stack" });
  const page = h("div", null);

  const load = async () => {
    replace(body, h("div", { class: "loading" }, t("Loading…")));
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
    const span = t("vs the period before");
    const tiles = h(
      "div",
      { class: "stats" },
      statTile(t("MRR"), headline(by.mrr), "usd", delta(headline(by.mrr), startOf(by.mrr, "mrr"), t("since {date}", { date: formatPeriod(by.mrr.points[0]?.date ?? from, "day") }))),
      statTile(t("Active subscriptions"), headline(by.active_subscriptions), "count", delta(headline(by.active_subscriptions), startOf(by.active_subscriptions, "all"), t("since {date}", { date: formatPeriod(by.active_subscriptions.points[0]?.date ?? from, "day") }))),
      statTile(t("Revenue"), headline(by.revenue), "usd", delta(headline(by.revenue), headline(prevRevenue), span)),
      allApps
        ? statTile(t("New customers"), headline(by.new_customers), "count", delta(headline(by.new_customers), headline(prevCustomers), span))
        : statTile(t("Active trials"), headline(by.active_trials), "count", h("span", { class: "stat-delta" }, "")),
    );

    const noData = results.every((r) => r.points.every((p) => Object.values(p.values).every((v) => !v)));
    if (noData && f.range !== "all") {
      replace(body, tiles, h("div", { class: "card" }, empty({ title: t("Nothing in this range yet"), text: t("Charts fill in as customers and purchases arrive. Totals update every hour; use the refresh button to update them now.") })));
      return;
    }
    const notes = [...new Set(results.flatMap((r) => r.notes.map((n) => t(n))))];
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
              h("a", { class: "chart-card-title", href: `/admin/charts/${r.chart}${filterQuery(f)}`, "data-nav": "" }, t(r.label)),
              h("div", { class: "chart-card-figure" }, figure(r, f).text),
              h("div", { class: "card-sub" }, figure(r, f).sub),
            ),
            legend(r, shown),
            host,
          );
          queueMicrotask(() =>
            renderChart(host, { points: r.points, series: shown, unit: r.unit, interval: r.interval, form: VIEW[r.chart].form, height: 200, label: t(r.label), extra: VIEW[r.chart].extra, colors: VIEW[r.chart].colors }),
          );
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
      pageHeader(t("Charts"), t("Revenue, subscriptions and customers, from your purchase ledger. Money is in USD at each purchase date's exchange rate; days are UTC.")),
      filterBar(ctx, f, changed, info, () => refreshNow(ctx.rerender)),
      body,
    );
  rebuild();
  await load();
  return page;
}

/** Money, a count or a percentage, per value: some charts carry extra values alongside their series. */
function unitOf(r, key) {
  if (["rate", "amount_rate", "conversion_rate"].includes(key)) return "percent";
  if (["gross", "amount", "revenue", "net", "mrr", "arr"].includes(key)) return r.chart === "subscription_movement" && key === "net" ? "count" : "usd";
  if (r.chart === "revenue" || r.chart === "mrr_movement") return "usd";
  return "count";
}

/** Table column names for values that aren't plotted series. */
const EXTRA_LABELS = {
  gross: tk("Gross"),
  amount: tk("Amount (USD)"),
  revenue: tk("Revenue (USD)"),
  net: tk("Net change"),
  renewed: tk("Renewed"),
  cancelled: tk("Cancelled"),
  conversion_rate: tk("Conversion rate"),
  churned: tk("Churned"),
  paying_at_start: tk("Paying at start"),
  amount_rate: tk("Refunded share of revenue"),
  refunds: tk("Refunds"),
  transactions: tk("Purchases"),
};
function labelOf(r, key) {
  const label = r.series.find((s) => s.key === key)?.label;
  return label ? t(label) : EXTRA_LABELS[key] ? t(EXTRA_LABELS[key]) : key;
}

// ---- One chart ----------------------------------------------------------------------------------

export async function chartPage(ctx, id) {
  const f = readFilters();
  const info = await ensureTotals();
  const known = info.charts.find((c) => c.id === id);
  if (!known) return h("div", { class: "card" }, empty({ title: t("No such chart"), text: t("Pick one from Charts.") }));
  const body = h("div", { class: "stack" });

  const load = async () => {
    replace(body, h("div", { class: "loading" }, t("Loading…")));
    const { from, to } = dates(f, info.first_date);
    const q = apiQuery(f, from, to);
    const r = await get(`/metrics/${id}?${q}`);
    const csv = h("a", { class: "btn btn-outline btn-sm", href: `/admin/v1${withProject(`/metrics/${id}?${q}&format=csv`)}`, download: "" }, t("Download CSV"));
    const top = figure(r, f, { compact: false, long: t("total, {from} to {to}", { from: formatPeriod(r.from, "day", { long: true }), to: formatPeriod(r.to, "day", { long: true }) }) });
    const head = h("div", { class: "chart-card-head" }, h("div", { class: "chart-card-figure big" }, top.text), h("div", { class: "card-sub" }, top.sub));
    const notes = r.notes.length ? h("div", { class: "chart-notes small muted" }, r.notes.map((n) => h("p", null, t(n)))) : null;

    if (r.kind === "breakdown") {
      replace(
        body,
        h("section", { class: "card chart-card" }, head, breakdown(r), notes),
        h(
          "section",
          { class: "card card-tight" },
          h("div", { class: "card-header" }, h("h2", { class: "card-title" }, t("Table")), h("div", { class: "actions" }, csv)),
          table([{ label: t("Status") }, { label: t("Subscriptions"), class: "num" }], r.categories.map((c) => [t(c.label), count(c.value)])),
        ),
      );
      return;
    }

    const shown = plotted(r);
    const host = h("div");
    const keys = [...new Set(r.points.flatMap((p) => Object.keys(p.values)))];
    replace(
      body,
      h("section", { class: "card chart-card" }, head, legend(r, shown), host, notes),
      h(
        "section",
        { class: "card card-tight" },
        h("div", { class: "card-header" }, h("h2", { class: "card-title" }, t("Table")), h("div", { class: "actions" }, csv)),
        table(
          [{ label: r.interval === "day" ? t("Day") : r.interval === "week" ? t("Week") : t("Month") }, ...keys.map((k) => ({ label: labelOf(r, k), class: "num" }))],
          r.points
            .slice()
            .reverse()
            .map((p) => [formatPeriod(p.date, r.interval, { long: true }), ...keys.map((k) => formatValue(p.values[k], unitOf(r, k)))]),
        ),
      ),
    );
    queueMicrotask(() =>
      renderChart(host, { points: r.points, series: shown, unit: r.unit, interval: r.interval, form: VIEW[id].form, height: 320, label: t(r.label), extra: VIEW[id].extra, colors: VIEW[id].colors }),
    );
  };

  const picker = select(info.charts.map((c) => ({ value: c.id, label: t(c.label) })), id);
  picker.classList.add("select-auto");
  picker.setAttribute("aria-label", t("Chart"));
  picker.addEventListener("change", () => ctx.navigate(`/admin/charts/${picker.value}${filterQuery(f)}`));

  const page = h("div");
  const changed = () => (rebuild(), void load().catch((err) => replace(body, errorCard(err))));
  const rebuild = () =>
    replace(
      page,
      breadcrumb([{ label: t("Charts"), href: `/admin/charts${filterQuery(f)}` }, { label: t(known.label) }]),
      pageHeader(t(known.label), t(known.description), [picker]),
      filterBar(ctx, f, changed, info, () => refreshNow(ctx.rerender)),
      body,
    );
  rebuild();
  await load();
  return page;
}
