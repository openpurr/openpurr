// Customers: look one up by app user ID (or any alias), then see what they own and why.
import { get, post } from "../api.js";
import { h, replace } from "../dom.js";
import { localeTag, t, tk, tn } from "../i18n.js";
import { IconCustomers, IconPlus, IconRefresh, IconSearch } from "../icons.js";
import { badge, breadcrumb, busy, button, cardWith, confirmDialog, copy, empty, errorCard, field, fmtDate, fmtDateTime, formError, kv, modal, pageHeader, seg, select, table, toast, when } from "../ui.js";

// ---- List ---------------------------------------------------------------------------------------

/** Where "Customers" in the detail page's breadcrumb goes back to: the last list and search. */
let listUrl = "/admin/customers";

const STORE_SHORT = { app_store: "App Store", play_store: "Google Play" };

export async function customersPage(ctx) {
  const params = new URLSearchParams(location.search);
  let q = params.get("q") ?? "";
  let purchasesOnly = params.get("purchases") === "1";
  let nextBefore = null;

  const rows = h("tbody");
  const more = button(t("Load more"), { variant: "outline" });
  const results = h("div");
  const query = h("input", { class: "input", type: "search", placeholder: t("Search by app user ID, email or transaction ID"), value: q, "aria-label": t("Search customers"), spellcheck: "false", autocomplete: "off" });

  const syncUrl = () => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (purchasesOnly) next.set("purchases", "1");
    listUrl = `/admin/customers${next.size ? `?${next}` : ""}`;
    history.replaceState(null, "", listUrl);
  };

  const row = (cust) => {
    // With several projects, the link names the project (a customer belongs to one).
    const href = `/admin/customers/${encodeURIComponent(cust.app_user_id)}${ctx.projects.length > 1 ? `?project=${encodeURIComponent(ctx.project.id)}` : ""}`;
    const tr = h(
      "tr",
      { class: "clickable", onClick: (e) => !e.target.closest("a") && ctx.navigate(href) },
      h("td", null, h("div", { class: "cell-stack" }, h("a", { href, "data-nav": "", class: "cell-strong cell-truncate", title: cust.app_user_id }, cust.app_user_id), cust.email ? h("span", { class: "cell-sub cell-truncate" }, cust.email) : null)),
      h("td", null, cust.active ? badge(t("Active"), "success", true) : cust.purchases ? badge(t("Inactive")) : h("span", { class: "faint small", style: { whiteSpace: "nowrap" } }, t("No purchases"))),
      h("td", { class: "hide-below-md" }, cust.purchases ? h("div", { class: "cell-stack" }, h("span", { class: "mono small" }, cust.last_product ?? "—"), h("span", { class: "cell-sub" }, tn(cust.purchases, "{n} purchase · {stores}", "{n} purchases · {stores}", { stores: cust.stores.map((x) => STORE_SHORT[x] ?? x).join(", ") }))) : "—"),
      h("td", { class: "hide-below-md" }, cust.last_purchase_at ? when(cust.last_purchase_at) : "—"),
      h("td", { class: "hide-below-sm" }, when(cust.first_seen)),
    );
    return tr;
  };

  const fetchPage = async (before) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (purchasesOnly) p.set("purchases", "1");
    if (before) p.set("before", before);
    const page = await get(`/customers?${p}`);
    rows.append(...page.customers.map(row));
    nextBefore = page.next_before;
    more.hidden = !nextBefore;
    return page.customers.length;
  };

  const load = async () => {
    rows.replaceChildren();
    replace(results, h("div", { class: "loading" }, t("Loading…")));
    const n = await fetchPage(null);
    if (!n) {
      replace(
        results,
        h(
          "div",
          { class: "card" },
          q
            ? empty({
                icon: IconSearch,
                title: t("No customers match"),
                text: purchasesOnly
                  ? t("Nothing matches “{query}” among customers with purchases. App user IDs match from the start; emails and transaction IDs must match exactly.", { query: q })
                  : t("Nothing matches “{query}”. App user IDs match from the start; emails and transaction IDs must match exactly.", { query: q }),
              })
            : empty({ icon: IconCustomers, title: purchasesOnly ? t("No customers with purchases yet") : t("No customers yet"), text: t("Customers appear when your app first talks to openpurr through the SDK.") }),
        ),
      );
      return;
    }
    replace(
      results,
      h("div", { class: "stack" }, table([{ label: t("Customer") }, { label: t("Status") }, { label: t("Latest product"), class: "hide-below-md" }, { label: t("Last purchase"), class: "hide-below-md" }, { label: t("First seen"), class: "hide-below-sm" }], []), h("div", null, more)),
    );
    results.querySelector("tbody").replaceWith(rows);
  };
  const reload = () => {
    syncUrl();
    return load().catch((err) => replace(results, errorCard(err, reload)));
  };

  more.addEventListener("click", () => busy(more, () => fetchPage(nextBefore)));
  const form = h(
    "form",
    { class: "row wrap" },
    h("div", { class: "search", style: { minWidth: "240px" } }, IconSearch(14), query),
    button(t("Search"), { type: "submit", variant: "outline" }),
    seg(
      [
        { value: "all", label: t("All") },
        { value: "purchases", label: t("With purchases") },
      ],
      purchasesOnly ? "purchases" : "all",
      (v) => {
        purchasesOnly = v === "purchases";
        void reload();
      },
    ),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    q = query.value.trim();
    void reload();
  });
  // Clearing the box (the search field's ✕ or deleting the text) shows the newest customers again.
  query.addEventListener("input", () => {
    if (!query.value && q) {
      q = "";
      void reload();
    }
  });

  syncUrl();
  await load();
  return h(
    "div",
    null,
    pageHeader(t("Customers"), t("Everyone who has used your apps, newest first. Open one to see what they own and why.")),
    h("div", { class: "stack" }, form, results),
  );
}

// ---- Detail -------------------------------------------------------------------------------------

const APPLE_STATUS = { 1: [tk("Active"), "success"], 2: [tk("Expired"), ""], 3: [tk("Billing retry"), "warning"], 4: [tk("Grace period"), "warning"], 5: [tk("Revoked"), "danger"] };
const STORE = { app_store: "App Store", play_store: "Google Play" };

function money(micros, currency) {
  if (micros === null || micros === undefined || !currency) return "—";
  try {
    return new Intl.NumberFormat(localeTag(), { style: "currency", currency }).format(micros / 1e6);
  } catch {
    return `${(micros / 1e6).toFixed(2)} ${currency}`;
  }
}

function txStatus(tx) {
  if (tx.revoked_at) return badge(tx.revocation_reason ? t("Refunded ({reason})", { reason: tx.revocation_reason }) : t("Refunded"), "danger");
  if (tx.is_upgraded) return badge(t("Upgraded"), "");
  if (tx.expires_at && tx.expires_at < Date.now()) return badge(t("Expired"), "");
  if (tx.expires_at) return badge(tx.period_type === "trial" ? t("Trial") : tx.period_type === "intro" ? t("Intro offer") : t("Active"), tx.period_type === "normal" ? "success" : "info", true);
  return badge(t("Owned"), "success", true);
}

export async function customerPage(ctx, appUserId) {
  const data = await get(`/customers/${encodeURIComponent(appUserId)}`).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });
  const crumbs = breadcrumb([{ label: t("Customers"), href: listUrl }, { label: appUserId }]);

  if (!data) {
    return h("div", null, crumbs, pageHeader(t("Customer not found")), h("div", { class: "stack" }, h("div", { class: "card" }, empty({ icon: IconCustomers, title: t("No customer “{id}”", { id: appUserId }), text: t("No customer has this app user ID or alias. IDs are case-sensitive.") }))));
  }

  const { customer, aliases, customer_info: info, attributes, transactions, subscription_states: states, webhook_events: events, grants, entitlement_ids: entitlementIds, experiments = [] } = data;
  const entitlements = Object.entries(info?.subscriber?.entitlements ?? {});
  const now = Date.now();
  const activeEntitlements = entitlements.filter(([, e]) => !e.expires_date || Date.parse(e.expires_date) > now);
  const appLabel = (id) => (ctx.apps.length > 1 ? id : null);

  const refresh = button(null, { variant: "outline", icon: IconRefresh(15), title: t("Refresh"), onClick: () => ctx.rerender() });

  const stats = h(
    "div",
    { class: "stats" },
    [
      [t("Active entitlements"), String(activeEntitlements.length)],
      [t("Purchases"), String(transactions.length)],
      [t("App user IDs"), String(aliases.length)],
      [t("First seen"), fmtDate(customer.first_seen)],
    ].map(([label, value]) => h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-value", title: value }, value))),
  );

  const sections = [];

  if (info) {
    sections.push(
      cardWith(
        t("Entitlements"),
        t("What the SDK reports as unlocked, computed from the purchases and grants below."),
        entitlements.length
          ? table(
              [{ label: t("Entitlement") }, { label: t("Product") }, { label: t("Since"), class: "hide-below-md" }, { label: t("Expires") }, { label: t("Status") }],
              entitlements.map(([id, e]) => {
                const active = !e.expires_date || Date.parse(e.expires_date) > now;
                return [
                  h("span", { class: "cell-strong" }, id),
                  e.product_identifier.startsWith("rc_promo_") ? h("span", null, badge(t("Promotional grant"), "info")) : h("span", { class: "mono small" }, e.product_identifier),
                  fmtDate(Date.parse(e.purchase_date)),
                  e.expires_date ? fmtDateTime(Date.parse(e.expires_date)) : t("Never"),
                  active ? badge(t("Active"), "success", true) : badge(t("Expired")),
                ];
              }),
            )
          : h("div", { class: "card-body muted small" }, t("No entitlements.")),
      ),
    );
  } else {
    sections.push(h("div", { class: "card small muted" }, t("Entitlements span every app, so they're shown only to operators with access to all apps. The purchases below are limited to your apps.")));
  }

  if (grants) sections.push(grantsCard(ctx, appUserId, grants, entitlementIds));

  sections.push(
    cardWith(
      t("Purchases"),
      t("Every store transaction this customer owns, newest first. Renewals share the original transaction ID."),
      transactions.length
        ? table(
            [{ label: t("Product") }, { label: t("Store"), class: "hide-below-md" }, { label: t("Purchased") }, { label: t("Expires"), class: "hide-below-md" }, { label: t("Price"), class: "hide-below-md" }, { label: t("Status") }],
            transactions.map((tx) => [
              h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, tx.product_id + (tx.base_plan_id ? `:${tx.base_plan_id}` : "")), h("span", { class: "cell-mono", title: t("Transaction ID") }, tx.transaction_id), appLabel(tx.app_id) ? h("span", { class: "cell-sub" }, tx.app_id) : null),
              h("div", { class: "row wrap", style: { gap: "4px" } }, badge(STORE[tx.store] ?? tx.store), tx.environment === "sandbox" ? badge(t("Sandbox"), "warning") : null, tx.verified ? null : badge(t("Unverified"), "danger")),
              fmtDateTime(tx.purchased_at),
              tx.expires_at ? fmtDateTime(tx.expires_at) : "—",
              money(tx.price_micros, tx.currency),
              txStatus(tx),
            ]),
          )
        : h("div", { class: "card-body muted small" }, t("No purchases yet.")),
    ),
  );

  if (states.length) {
    sections.push(
      cardWith(
        t("Subscription status"),
        t("The latest renewal information from the store, per subscription."),
        table(
          [{ label: t("Original transaction") }, { label: t("Status") }, { label: t("Auto-renew") }, { label: t("Billing issue"), class: "hide-below-md" }, { label: t("Grace period ends"), class: "hide-below-md" }],
          states.map((s) => {
            const [label, variant] = APPLE_STATUS[s.status] ?? [tk("Unknown"), ""];
            return [
              h("span", { class: "cell-mono cell-truncate", title: s.original_transaction_id }, s.original_transaction_id),
              badge(t(label), variant, true),
              s.auto_renew === null || s.auto_renew === undefined ? "—" : s.auto_renew ? (s.auto_renew_product_id ? t("On → {product}", { product: s.auto_renew_product_id }) : t("On")) : t("Off"),
              s.billing_issue_detected_at ? fmtDateTime(s.billing_issue_detected_at) : "—",
              s.grace_period_expires_at ? fmtDateTime(s.grace_period_expires_at) : "—",
            ];
          }),
        ),
      ),
    );
  }

  const attrEntries = Object.entries(attributes ?? {});
  sections.push(
    h(
      "div",
      { class: "detail-grid" },
      cardWith(
        t("Attributes"),
        t("Set by the SDK (setAttributes, setEmail…)."),
        h("div", { class: "card-body" }, attrEntries.length ? kv(attrEntries.map(([k, v]) => [h("span", { class: "mono small" }, k), h("span", { title: t("Updated {time}", { time: fmtDateTime(v.updated_at_ms) }) }, v.value)])) : h("p", { class: "muted small" }, t("No attributes."))),
      ),
      cardWith(
        t("App user IDs"),
        t("Every ID that finds this customer (anonymous IDs merged at logIn)."),
        h("div", { class: "card-body" }, kv(aliases.map((a) => [h("span", { class: "mono small" }, a.app_user_id), when(a.created_at)]))),
      ),
    ),
  );

  if (experiments.length) {
    sections.push(
      cardWith(
        t("Price experiments"),
        t("Which variant's offering this customer is shown (or was, while the experiment ran)."),
        h(
          "div",
          { class: "card-body" },
          kv(
            experiments.map((x) => [
              h("a", { href: `/admin/experiments/${encodeURIComponent(x.experiment_id)}`, "data-nav": "" }, x.experiment_name ?? x.experiment_id),
              h("span", null, t("Variant {variant}", { variant: x.experiment_variant.toUpperCase() }), h("span", { class: "muted" }, " · ", t("joined {time}", { time: fmtDate(x.enrolled_at_ms) }))),
            ]),
          ),
        ),
      ),
    );
  }

  sections.push(
    cardWith(
      t("Webhook events"),
      t("The latest 50 events sent about this customer."),
      events.length
        ? table(
            [{ label: t("Event") }, { label: t("App"), class: "hide-below-md" }, { label: t("Created") }, { label: "", class: "actions" }],
            events.map((e) => [
              h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, e.type), h("span", { class: "cell-mono" }, e.id)),
              h("span", null, e.app_id, e.environment === "SANDBOX" || e.environment === "sandbox" ? h("span", null, " ", badge(t("Sandbox"), "warning")) : null),
              when(e.created_at),
              ctx.can("webhooks:replay") ? replayButton(e.id) : null,
            ]),
          )
        : h("div", { class: "card-body muted small" }, t("No webhook events.")),
    ),
  );

  if (info) {
    const json = JSON.stringify(info, null, 2);
    sections.push(
      h(
        "details",
        { class: "card card-tight" },
        h("summary", { class: "card-header", style: { cursor: "pointer" } }, h("span", { class: "card-title" }, "CustomerInfo JSON"), h("span", { class: "card-sub" }, t("What GET /v1/subscribers returns for this customer"))),
        h("div", { class: "card-body stack-sm" }, h("div", null, button(t("Copy JSON"), { variant: "outline", size: "sm", onClick: () => copy(json) })), h("pre", { class: "code" }, json)),
      ),
    );
  }

  return h(
    "div",
    null,
    crumbs,
    pageHeader(customer.original_app_user_id, t("Customer since {date}", { date: fmtDateTime(customer.first_seen) }), [refresh]),
    h("div", { class: "stack" }, stats, sections),
  );
}

export function replayButton(eventId) {
  const btn = button(t("Replay"), {
    variant: "outline",
    size: "sm",
    title: t("Send this event to your webhook endpoints again (same event ID)"),
    onClick: () =>
      busy(btn, async () => {
        await post(`/webhooks/events/${encodeURIComponent(eventId)}/replay`);
        toast(t("Replay queued"), "success");
      }),
  });
  return btn;
}

// ---- Promotional grants -------------------------------------------------------------------------

const DURATIONS = [
  { value: "daily", label: tk("1 day") },
  { value: "three_day", label: tk("3 days") },
  { value: "weekly", label: tk("1 week") },
  { value: "monthly", label: tk("1 month") },
  { value: "two_month", label: tk("2 months") },
  { value: "three_month", label: tk("3 months") },
  { value: "six_month", label: tk("6 months") },
  { value: "yearly", label: tk("1 year") },
  { value: "lifetime", label: tk("Lifetime") },
  { value: "custom", label: tk("Until a date…") },
];
const durationLabel = (d) => {
  const label = DURATIONS.find((x) => x.value === d)?.label;
  return label ? t(label) : t("Custom");
};

function grantsCard(ctx, appUserId, grants, entitlementIds) {
  const canGrant = ctx.can("grants:manage") && ctx.operator.app_ids === null;
  const now = Date.now();
  const status = (g) =>
    g.revoked_at ? badge(t("Revoked")) : g.expires_at === null || g.expires_at > now ? badge(t("Active"), "success", true) : badge(t("Ended"));

  const grant = () => {
    const errors = formError();
    const entitlement = select(entitlementIds.map((id) => ({ value: id, label: id })), entitlementIds[0]);
    const duration = select(DURATIONS.map((d) => ({ value: d.value, label: t(d.label) })), "monthly");
    const until = h("input", { class: "input", type: "date", min: new Date(now + 864e5).toISOString().slice(0, 10) });
    const untilField = field(t("Ends on"), until, t("Access ends at the start of this day (UTC)."));
    untilField.hidden = true;
    duration.addEventListener("change", () => (untilField.hidden = duration.value !== "custom"));
    const note = h("input", { class: "input", maxlength: 500, placeholder: t("e.g. Support make-good for the outage on May 3") });
    const submit = button(t("Grant"), { type: "submit" });
    const m = modal({
      title: t("Grant an entitlement to {user}", { user: appUserId }),
      sub: t("Gives access without a purchase. The app sees it the next time it fetches CustomerInfo, as a promotional entitlement. Purchases aren't affected."),
      body: h("div", { class: "stack" }, errors.el, h("div", null, field(t("Entitlement"), entitlement), field(t("For"), duration), untilField, field(t("Note"), note, t("Why: shown here and in the audit log.")))),
      actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const body = { entitlement_id: entitlement.value, note: note.value.trim() || undefined };
        if (duration.value === "custom") {
          if (!until.value) return errors.show(new Error(t("Pick the day it ends."))), false;
          body.expires_at = `${until.value}T00:00:00Z`;
        } else body.duration = duration.value;
        const ok = await busy(submit, () => post(`/customers/${encodeURIComponent(appUserId)}/grants`, body), errors);
        if (!ok) return false;
        toast(t("Granted"), "success");
        ctx.rerender();
      },
    });
  };

  const revoke = async (g) => {
    if (!(await confirmDialog({ title: t("Revoke {entitlement}?", { entitlement: g.entitlement_id }), text: t("{user} loses this grant now. Purchases aren't affected.", { user: appUserId }), confirmLabel: t("Revoke grant"), danger: true }))) return;
    try {
      await post(`/customers/${encodeURIComponent(appUserId)}/grants/${g.id}/revoke`, {});
      toast(t("Grant revoked"), "success");
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return cardWith(
    t("Promotional grants"),
    t("Entitlements given without a purchase: support, testing, partners."),
    grants.length
      ? table(
          [{ label: t("Entitlement") }, { label: t("For"), class: "hide-below-md" }, { label: t("Ends") }, { label: t("Granted by"), class: "hide-below-md" }, { label: t("Status") }, { label: "", class: "actions" }],
          grants
            .slice()
            .reverse()
            .map((g) => [
              h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, g.entitlement_id), g.note ? h("span", { class: "cell-sub cell-truncate", title: g.note }, g.note) : null),
              durationLabel(g.duration),
              g.revoked_at ? h("span", { title: g.revoked_by ? t("Revoked {time} by {operator}", { time: fmtDateTime(g.revoked_at), operator: g.revoked_by }) : t("Revoked {time}", { time: fmtDateTime(g.revoked_at) }) }, fmtDate(g.revoked_at)) : g.expires_at ? fmtDateTime(g.expires_at) : t("Never"),
              h("div", { class: "cell-stack" }, h("span", { class: "small" }, g.granted_by ?? "—"), h("span", { class: "cell-sub" }, `${fmtDate(g.created_at)} · ${g.source}`)),
              status(g),
              canGrant && !g.revoked_at && (g.expires_at === null || g.expires_at > now) ? button(t("Revoke"), { variant: "outline", size: "sm", onClick: () => revoke(g) }) : null,
            ]),
        )
      : h("div", { class: "card-body muted small" }, t("No grants.")),
    canGrant && entitlementIds.length ? [button(t("Grant entitlement"), { size: "sm", icon: IconPlus(14), onClick: grant })] : [],
  );
}
