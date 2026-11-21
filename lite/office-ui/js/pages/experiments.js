// Price experiments: split customers new to the app between offerings, then compare what each
// group bought. The admin API is /admin/v1/experiments (src/office/admin.ts); how customers are
// assigned and what counts is explained in src/experiments.ts.
import { del, get, patch, post } from "../api.js";
import { formatValue, renderChart } from "../chart.js";
import { h, replace } from "../dom.js";
import { t, tk, tn } from "../i18n.js";
import { IconFlask, IconPlus, IconRefresh } from "../icons.js";
import { badge, breadcrumb, busy, button, cardWith, confirmDialog, empty, errorCard, field, fmtDate, fmtDateTime, formError, input, kv, modal, pageHeader, seg, select, table, toast, when } from "../ui.js";

const MAX_VARIANTS = 4;
const STATUS = {
  draft: { label: tk("Draft"), variant: "" },
  running: { label: tk("Running"), variant: "success" },
  stopped: { label: tk("Stopped"), variant: "info" },
};
const statusBadge = (status) => badge(t(STATUS[status]?.label ?? status), STATUS[status]?.variant ?? "", status === "running");
/** "A", "B", ... and the control marked. */
const variantName = (v) => (v.id === "a" ? t("{variant} (control)", { variant: v.id.toUpperCase() }) : v.id.toUpperCase());
const canEdit = (ctx) => ctx.can("config:manage");
const usd = (n) => formatValue(n, "usd");
const count = (n) => formatValue(n, "count");
const pct = (n) => formatValue(n * 100, "percent");
const signedPct = (n) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${pct(n)}`);

async function loadOfferings(ctx) {
  const { document } = await get("/config");
  return (document.projects?.[ctx.project.id]?.offerings ?? []).map((o) => o.id);
}

/** Opens a form in a modal; `save()` runs on submit and returns false (or throws) to keep it open. */
function formModal({ title, sub, fields, submitLabel = t("Save"), save }) {
  const errors = formError();
  const submit = button(submitLabel, { type: "submit" });
  const m = modal({
    title,
    sub,
    body: h("div", { class: "stack" }, errors.el, fields),
    actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
    onSubmit: async () => {
      const done = await busy(submit, async () => (await save()) ?? true, errors);
      return done === true ? undefined : false;
    },
  });
  return m;
}

/** Splits 100 as evenly as whole percents allow: 34, 33, 33. */
const evenWeights = (n) => Array.from({ length: n }, (_, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));

/**
 * The form for a new experiment, or for editing one (`exp`). Variants can change only on a draft.
 * Calls onSaved(experiment) after saving.
 */
function experimentForm(ctx, offerings, exp, onSaved) {
  const name = input({ required: true, maxlength: 100, value: exp?.name ?? "", placeholder: t("Annual plan at $59.99 vs $49.99"), autocomplete: "off" });
  const notes = h("textarea", { class: "input textarea", rows: 3, maxlength: 2000, placeholder: t("What you're testing, and what would make you switch.") }, exp?.notes ?? "");
  const variantsEditable = !exp || exp.status === "draft";
  const rows = h("div", { class: "stack-sm" });
  const entries = [];
  const addBtn = button(t("Add variant"), { variant: "outline", size: "sm", icon: IconPlus(14), onClick: () => (addRow(), rebalance()) });
  const relabel = () => {
    entries.forEach((e, i) => (e.label.textContent = variantName({ id: "abcd"[i] })));
    addBtn.hidden = entries.length >= MAX_VARIANTS;
    entries.forEach((e) => (e.remove.hidden = entries.length <= 2));
  };
  const rebalance = () => evenWeights(entries.length).forEach((w, i) => (entries[i].weight.value = String(w)));
  const addRow = (v = {}) => {
    const used = new Set(entries.map((e) => e.offering.value));
    const offering = select(offerings.map((id) => ({ value: id, label: id })), v.offering_id ?? offerings.find((id) => !used.has(id)) ?? offerings[0]);
    const weight = input({ type: "number", min: 1, max: 99, step: 1, value: String(v.weight ?? 50), inputmode: "numeric", "aria-label": t("Share of new customers (%)") });
    weight.classList.add("experiment-weight");
    const label = h("span", { class: "experiment-variant-name" });
    const entry = { offering, weight, label };
    const row = h(
      "div",
      { class: "package-row experiment-row" },
      label,
      field(t("Offering"), offering),
      field(t("Share (%)"), weight),
    );
    entry.remove = button(t("Remove"), { variant: "ghost", size: "sm", onClick: () => (row.remove(), entries.splice(entries.indexOf(entry), 1), relabel(), rebalance()) });
    row.append(entry.remove);
    entries.push(entry);
    rows.append(row);
    relabel();
  };
  for (const v of exp?.variants ?? [{ offering_id: offerings[0] }, { offering_id: offerings[1] }]) addRow(v);
  if (!exp) rebalance();
  if (!variantsEditable) for (const e of entries) (e.offering.disabled = true), (e.weight.disabled = true), (e.remove.hidden = true);
  addBtn.hidden ||= !variantsEditable;

  formModal({
    title: exp ? t("Edit {name}", { name: exp.name }) : t("New price experiment"),
    sub: t("Each customer new to the app gets one variant, and sees its offering as the current one. Put each price in its own product, and each variant's products in its own offering."),
    submitLabel: exp ? t("Save") : t("Create draft"),
    fields: [
      field(t("Name"), name),
      field(t("Notes (optional)"), notes),
      h(
        "div",
        null,
        h("span", { class: "label" }, t("Variants")),
        h("p", { class: "small muted" }, variantsEditable ? t("The first is the control: usually the offering customers see today.") : t("Variants can't change once an experiment has started.")),
        rows,
        addBtn,
      ),
    ],
    save: async () => {
      const body = { name: name.value.trim(), notes: notes.value.trim() };
      if (variantsEditable) body.variants = entries.map((e) => ({ offering_id: e.offering.value, weight: Number(e.weight.value) }));
      if (body.variants) {
        const total = body.variants.reduce((a, v) => a + v.weight, 0);
        if (total !== 100) throw new Error(t("The shares add up to {total}%; they must add up to 100%.", { total }));
        if (new Set(body.variants.map((v) => v.offering_id)).size !== body.variants.length) throw new Error(t("Each variant needs its own offering."));
      }
      const { experiment } = exp ? await patch(`/experiments/${exp.id}`, body) : await post("/experiments", { ...body, project: ctx.project.id });
      onSaved(experiment);
    },
  });
}

// ---- List ---------------------------------------------------------------------------------------

export async function experimentsPage(ctx, id) {
  if (id) return experimentPage(ctx, id);
  if (!ctx.project) return h("div", { class: "card" }, empty({ icon: IconFlask, title: t("No projects yet"), text: t("Add an app first.") }));
  const [{ experiments }, offerings] = await Promise.all([get(`/experiments?project=${encodeURIComponent(ctx.project.id)}`), canEdit(ctx) ? loadOfferings(ctx) : []]);
  const href = (e) => `/admin/experiments/${encodeURIComponent(e.id)}`;
  const create = () => {
    if (offerings.length < 2) return toast(t("An experiment compares offerings: add at least two on the Offerings page first."), "error");
    experimentForm(ctx, offerings, null, (e) => ctx.navigate(href(e)));
  };
  const newBtn = canEdit(ctx) ? [button(t("New experiment"), { icon: IconPlus(15), onClick: create })] : [];
  return h(
    "div",
    null,
    pageHeader(t("Price experiments"), t("Test prices by showing customers new to the app different offerings, then compare what each group buys."), newBtn),
    experiments.length
      ? h(
          "div",
          { class: "card card-tight" },
          table(
            [{ label: t("Experiment") }, { label: t("Status") }, { label: t("Variants") }, { label: t("Customers"), class: "num" }, { label: t("Started") }],
            experiments.map((e) => ({
              onClick: (ev) => !ev.target.closest("a") && ctx.navigate(href(e)),
              cells: [
                h("a", { href: href(e), "data-nav": "", class: "cell-strong", dir: "auto" }, e.name),
                statusBadge(e.status),
                h("span", { class: "mono small" }, e.variants.map((v) => `${v.id.toUpperCase()} ${v.offering_id} ${v.weight}%`).join(" · ")),
                count(e.enrolled),
                e.started_at ? when(e.started_at) : h("span", { class: "faint" }, "—"),
              ],
            })),
          ),
        )
      : h(
          "div",
          { class: "card" },
          empty({
            icon: IconFlask,
            title: t("No experiments yet"),
            text: t("Put each price you want to test in its own product and offering. An experiment then shows each customer new to the app one of those offerings as the current one; Purchases.getOfferings() needs no changes."),
            action: newBtn[0] ?? null,
          }),
        ),
  );
}

// ---- One experiment -----------------------------------------------------------------------------

async function experimentPage(ctx, id) {
  const { experiment: exp } = await get(`/experiments/${encodeURIComponent(id)}`);
  const edit = canEdit(ctx);
  const page = h("div");
  const resultsHost = h("div", { class: "stack" });
  let environment = "production";

  const act = async (btn, fn) => {
    await busy(btn, async () => {
      try {
        await fn();
        ctx.rerender();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  };
  const start = button(t("Start"), {
    onClick: async () => {
      const ok = await confirmDialog({
        title: t("Start {name}?", { name: exp.name }),
        text: t("From now on, customers new to the app are split between the variants. Variants can't change after this. Apps pick it up within a minute."),
        confirmLabel: t("Start experiment"),
      });
      if (ok) await act(start, () => post(`/experiments/${exp.id}/start`));
    },
  });
  const stop = button(t("Stop"), {
    variant: "outline",
    onClick: async () => {
      const ok = await confirmDialog({
        title: t("Stop {name}?", { name: exp.name }),
        text: t("Everyone sees the current offering again, and no one new joins. Results keep counting renewals and refunds of purchases made during the experiment. To keep a winning variant, make its offering the current one on the Offerings page."),
        confirmLabel: t("Stop experiment"),
        danger: true,
      });
      if (ok) await act(stop, () => post(`/experiments/${exp.id}/stop`));
    },
  });
  const remove = button(t("Delete"), {
    variant: "outline",
    onClick: async () => {
      const ok = await confirmDialog({ title: t("Delete {name}?", { name: exp.name }), text: t("Its enrollments and results are deleted too. This can't be undone."), confirmLabel: t("Delete experiment"), danger: true });
      if (!ok) return;
      try {
        await del(`/experiments/${exp.id}`);
        ctx.navigate("/admin/experiments");
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });
  const editBtn = button(t("Edit"), {
    variant: "outline",
    onClick: async () => {
      try {
        experimentForm(ctx, await loadOfferings(ctx), exp, () => ctx.rerender());
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });
  const actions = edit ? [exp.status === "draft" ? start : null, exp.status === "running" ? stop : null, editBtn, exp.status !== "running" ? remove : null].filter(Boolean) : [];

  const missing = exp.variants.filter((v) => !v.offering_exists);
  const info = cardWith(
    t("Setup"),
    exp.notes ? h("span", { dir: "auto" }, exp.notes) : null,
    h(
      "div",
      null,
      missing.length
        ? h("div", { class: "card-body" }, h("div", { class: "notice warning small" }, t("Not in the config any more: {offerings}. Customers in those variants see the current offering instead.", { offerings: missing.map((v) => v.offering_id).join(", ") })))
        : null,
      table(
        [{ label: t("Variant") }, { label: t("Offering") }, { label: t("Share of new customers"), class: "num" }],
        exp.variants.map((v) => [h("span", { class: "cell-strong" }, variantName(v)), h("span", { class: "mono" }, v.offering_id), pct(v.weight / 100)]),
      ),
      h(
        "div",
        { class: "card-body" },
        kv([
          [t("Created"), h("span", null, fmtDate(exp.created_at), exp.created_by ? h("span", { class: "muted" }, ` · ${exp.created_by}`) : null)],
          [t("Started"), exp.started_at ? fmtDate(exp.started_at) : t("Not yet")],
          [t("Stopped"), exp.stopped_at ? fmtDate(exp.stopped_at) : undefined],
        ]),
      ),
    ),
  );

  const loadResults = async (refresh = false) => {
    if (exp.status === "draft") {
      replace(resultsHost, h("div", { class: "card" }, empty({ icon: IconFlask, title: t("Not started yet"), text: t("Results appear here once the experiment starts and customers fetch offerings.") })));
      return;
    }
    if (ctx.operator.app_ids) {
      replace(resultsHost, h("div", { class: "card" }, empty({ title: t("Results aren't available to you"), text: t("They add up purchases in every app, and your access is limited to some apps.") })));
      return;
    }
    try {
      const { results } = await get(`/experiments/${exp.id}/results?environment=${environment}${refresh ? "&refresh=1" : ""}`);
      replace(resultsHost, ...renderResults(results));
    } catch (err) {
      replace(resultsHost, errorCard(err, () => loadResults()));
    }
  };

  const envSeg = seg(
    [
      { value: "production", label: t("Production") },
      { value: "sandbox", label: t("Sandbox") },
    ],
    environment,
    (v) => ((environment = v), void loadResults()),
  );
  const refresh = button(null, { variant: "outline", size: "sm", icon: IconRefresh(14), title: t("Recompute now") });
  refresh.addEventListener("click", () => busy(refresh, () => loadResults(true)));

  replace(
    page,
    breadcrumb([{ label: t("Price experiments"), href: "/admin/experiments" }, { label: h("bdi", null, exp.name) }]),
    pageHeader(h("span", { class: "row wrap", style: { gap: "10px" } }, h("bdi", null, exp.name), statusBadge(exp.status)), null, actions),
    h(
      "div",
      { class: "stack" },
      info,
      exp.status === "draft" ? null : h("div", { class: "row between wrap" }, h("h2", { class: "section-title" }, t("Results")), h("div", { class: "row" }, envSeg, refresh)),
      resultsHost,
    ),
  );
  void loadResults();
  return page;
}

/** The verdict for one variant versus the control, on revenue per customer (what a price test is for). */
function verdict(v) {
  const c = v.vs_control;
  if (!c?.enough_data || c.revenue_chance === null) return { text: t("Too early to tell"), variant: "" };
  if (c.revenue_chance >= 0.95) return { text: t("Likely better"), variant: "success" };
  if (c.revenue_chance <= 0.05) return { text: t("Likely worse"), variant: "danger" };
  return { text: t("No clear difference yet"), variant: "warning" };
}

function renderResults(r) {
  const vs = r.variants;
  const totalCustomers = vs.reduce((a, v) => a + v.customers, 0);
  if (!totalCustomers) {
    return [h("div", { class: "card" }, empty({ icon: IconFlask, title: t("No one has joined yet"), text: t("Customers join when an app fetches offerings for an app user ID we haven't seen before. Apps pick up a started experiment within a minute.") }))];
  }
  const rate = (n, d) => (d ? n / d : 0);
  const chanceLine = (lift, chance, enough) =>
    h(
      "div",
      { class: "cell-sub" },
      signedPct(lift),
      chance === null || chance === undefined ? null : ` · ${t("{chance} chance higher", { chance: pct(chance) })}`,
      enough ? null : h("span", { class: "faint" }, ` · ${t("early")}`),
    );
  const cell = (main, sub) => h("div", { class: "cell-stack" }, h("span", null, main), sub ?? null);

  const metricRows = [
    [t("Customers"), (v) => cell(count(v.customers))],
    [t("Trials started"), (v) => cell(count(v.trials), h("div", { class: "cell-sub" }, pct(rate(v.trials, v.customers))))],
    [t("Trials converted"), (v) => cell(count(v.trial_conversions), h("div", { class: "cell-sub" }, pct(rate(v.trial_conversions, v.trials))))],
    [
      t("Paying customers"),
      (v) => cell(`${count(v.paying)} (${pct(rate(v.paying, v.customers))})`, v.vs_control ? chanceLine(v.vs_control.conversion_lift, v.vs_control.conversion_chance, v.vs_control.enough_data) : null),
    ],
    [t("Revenue"), (v) => cell(usd(v.revenue))],
    [
      t("Revenue per customer"),
      (v) => cell(usd(v.revenue_per_customer), v.vs_control ? chanceLine(v.vs_control.revenue_lift, v.vs_control.revenue_chance, v.vs_control.enough_data) : null),
    ],
    [t("Active subscriptions"), (v) => cell(count(v.active_subscriptions))],
    [t("MRR"), (v) => cell(usd(v.mrr))],
    [t("Churned subscribers"), (v) => cell(count(v.churned), h("div", { class: "cell-sub" }, pct(rate(v.churned, v.paying))))],
  ];

  const summary = h(
    "div",
    { class: "stats" },
    vs.map((v) =>
      h(
        "div",
        { class: "stat" },
        h("div", { class: "stat-label" }, `${variantName(v)} · ${v.offering_id}`),
        h("div", { class: "stat-figure" }, usd(v.revenue_per_customer)),
        h("div", { class: "small muted" }, t("revenue per customer, from {n}", { n: tn(v.customers, "{n} customer", "{n} customers") })),
        v.vs_control ? h("div", { class: "experiment-verdict" }, badge(verdict(v).text, verdict(v).variant)) : null,
      ),
    ),
  );

  const metrics = cardWith(
    t("By variant"),
    t("Purchases that started between a customer joining and the experiment's end, with their renewals and refunds since. Revenue is in USD, net of refunds."),
    table(
      [{ label: t("Metric") }, ...vs.map((v) => ({ label: `${variantName(v)} · ${v.offering_id}`, class: "num" }))],
      metricRows.map(([label, fn]) => [h("span", { class: "cell-strong" }, label), ...vs.map(fn)]),
    ),
  );

  // Revenue per customer so far, by day: each variant's revenue to date over its customers to date.
  const totals = Object.fromEntries(vs.map((v) => [v.id, { customers: 0, revenue: 0 }]));
  const points = r.daily.map((d) => {
    const values = {};
    for (const v of vs) {
      const x = d.values[v.id] ?? { customers: 0, revenue: 0 };
      totals[v.id].customers += x.customers;
      totals[v.id].revenue += x.revenue;
      values[v.id] = totals[v.id].customers ? totals[v.id].revenue / totals[v.id].customers : null;
    }
    return { date: d.date, values };
  });
  const series = vs.map((v) => ({ key: v.id, label: `${variantName(v)} · ${v.offering_id}` }));
  const chartHost = h("div");
  const chart =
    points.length > 1
      ? cardWith(
          t("Revenue per customer over time"),
          t("Early days swing a lot; the lines settle as customers join."),
          h(
            "div",
            { class: "card-body" },
            h("div", { class: "chart-legend" }, series.map((s, i) => h("span", { class: "chart-legend-item" }, h("span", { class: "chart-swatch", style: { background: `var(--chart-${i + 1})` } }), s.label))),
            chartHost,
          ),
        )
      : null;
  if (chart) queueMicrotask(() => renderChart(chartHost, { points, series, unit: "usd", interval: "day", form: "line", height: 240, label: t("Revenue per customer over time") }));

  const products = [...new Set(vs.flatMap((v) => Object.keys(v.products)))].sort();
  const productCard = products.length
    ? cardWith(
        t("What paying customers bought first"),
        null,
        table(
          [{ label: t("Product") }, ...vs.map((v) => ({ label: variantName(v), class: "num" }))],
          products.map((p) => [h("span", { class: "mono" }, p), ...vs.map((v) => cell(count(v.products[p] ?? 0), h("div", { class: "cell-sub" }, pct(rate(v.products[p] ?? 0, v.paying)))))]),
        ),
      )
    : null;

  const notes = [
    t("A variant is called likely better or worse at a 95% chance on revenue per customer, once each variant has at least 100 customers and there are at least 20 paying customers between it and the control. Decide on the date you planned to, not the first day it looks good."),
    r.unconverted ? tn(r.unconverted, "{n} purchase in a currency without an exchange rate is left out of revenue.", "{n} purchases in currencies without an exchange rate are left out of revenue.") : null,
    t("Updated {time}.", { time: fmtDateTime(r.computed_at) }),
  ].filter(Boolean);

  return [summary, metrics, chart, productCard, h("div", { class: "chart-notes small muted" }, notes.map((n) => h("p", null, n)))].filter(Boolean);
}
