// Customers: look one up by app user ID (or any alias), then see what they own and why.
import { get, post } from "../api.js";
import { h, replace } from "../dom.js";
import { IconCustomers, IconRefresh, IconSearch } from "../icons.js";
import { badge, breadcrumb, busy, button, cardWith, copy, empty, errorCard, fmtDate, fmtDateTime, kv, pageHeader, seg, table, toast, when } from "../ui.js";

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
  const more = button("Load more", { variant: "outline" });
  const results = h("div");
  const query = h("input", { class: "input", type: "search", placeholder: "Search by app user ID, email or transaction ID", value: q, "aria-label": "Search customers", spellcheck: "false", autocomplete: "off" });

  const syncUrl = () => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (purchasesOnly) next.set("purchases", "1");
    listUrl = `/admin/customers${next.size ? `?${next}` : ""}`;
    history.replaceState(null, "", listUrl);
  };

  const row = (cust) => {
    const href = `/admin/customers/${encodeURIComponent(cust.app_user_id)}`;
    const tr = h(
      "tr",
      { class: "clickable", onClick: (e) => !e.target.closest("a") && ctx.navigate(href) },
      h("td", null, h("div", { class: "cell-stack" }, h("a", { href, "data-nav": "", class: "cell-strong cell-truncate", title: cust.app_user_id }, cust.app_user_id), cust.email ? h("span", { class: "cell-sub cell-truncate" }, cust.email) : null)),
      h("td", null, cust.active ? badge("Active", "success", true) : cust.purchases ? badge("Inactive") : h("span", { class: "faint small", style: { whiteSpace: "nowrap" } }, "No purchases")),
      h("td", { class: "hide-below-md" }, cust.purchases ? h("div", { class: "cell-stack" }, h("span", { class: "mono small" }, cust.last_product ?? "—"), h("span", { class: "cell-sub" }, `${cust.purchases} purchase${cust.purchases === 1 ? "" : "s"} · ${cust.stores.map((x) => STORE_SHORT[x] ?? x).join(", ")}`)) : "—"),
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
    replace(results, h("div", { class: "loading" }, "Loading…"));
    const n = await fetchPage(null);
    if (!n) {
      replace(
        results,
        h(
          "div",
          { class: "card" },
          q
            ? empty({ icon: IconSearch, title: "No customers match", text: `Nothing matches “${q}”${purchasesOnly ? " among customers with purchases" : ""}. App user IDs match from the start; emails and transaction IDs must match exactly.` })
            : empty({ icon: IconCustomers, title: purchasesOnly ? "No customers with purchases yet" : "No customers yet", text: "Customers appear when your app first talks to openpurr through the SDK." }),
        ),
      );
      return;
    }
    replace(
      results,
      h("div", { class: "stack" }, table([{ label: "Customer" }, { label: "Status" }, { label: "Latest product", class: "hide-below-md" }, { label: "Last purchase", class: "hide-below-md" }, { label: "First seen", class: "hide-below-sm" }], []), h("div", null, more)),
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
    button("Search", { type: "submit", variant: "outline" }),
    seg(
      [
        { value: "all", label: "All" },
        { value: "purchases", label: "With purchases" },
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
    pageHeader("Customers", "Everyone who has used your apps, newest first. Open one to see what they own and why."),
    h("div", { class: "stack" }, form, results),
  );
}

// ---- Detail -------------------------------------------------------------------------------------

const APPLE_STATUS = { 1: ["Active", "success"], 2: ["Expired", ""], 3: ["Billing retry", "warning"], 4: ["Grace period", "warning"], 5: ["Revoked", "danger"] };
const STORE = { app_store: "App Store", play_store: "Google Play" };

function money(micros, currency) {
  if (micros === null || micros === undefined || !currency) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(micros / 1e6);
  } catch {
    return `${(micros / 1e6).toFixed(2)} ${currency}`;
  }
}

function txStatus(t) {
  if (t.revoked_at) return badge(t.revocation_reason ? `Refunded (${t.revocation_reason})` : "Refunded", "danger");
  if (t.is_upgraded) return badge("Upgraded", "");
  if (t.expires_at && t.expires_at < Date.now()) return badge("Expired", "");
  if (t.expires_at) return badge(t.period_type === "trial" ? "Trial" : t.period_type === "intro" ? "Intro offer" : "Active", t.period_type === "normal" ? "success" : "info", true);
  return badge("Owned", "success", true);
}

export async function customerPage(ctx, appUserId) {
  const data = await get(`/customers/${encodeURIComponent(appUserId)}`).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });
  const crumbs = breadcrumb([{ label: "Customers", href: listUrl }, { label: appUserId }]);

  if (!data) {
    return h("div", null, crumbs, pageHeader("Customer not found"), h("div", { class: "stack" }, h("div", { class: "card" }, empty({ icon: IconCustomers, title: `No customer “${appUserId}”`, text: "No customer has this app user ID or alias. IDs are case-sensitive." }))));
  }

  const { customer, aliases, customer_info: info, attributes, transactions, subscription_states: states, webhook_events: events } = data;
  const entitlements = Object.entries(info?.subscriber?.entitlements ?? {});
  const now = Date.now();
  const activeEntitlements = entitlements.filter(([, e]) => !e.expires_date || Date.parse(e.expires_date) > now);
  const appLabel = (id) => (ctx.apps.length > 1 ? id : null);

  const refresh = button(null, { variant: "outline", icon: IconRefresh(15), title: "Refresh", onClick: () => ctx.rerender() });

  const stats = h(
    "div",
    { class: "stats" },
    [
      ["Active entitlements", String(activeEntitlements.length)],
      ["Purchases", String(transactions.length)],
      ["App user IDs", String(aliases.length)],
      ["First seen", fmtDate(customer.first_seen)],
    ].map(([label, value]) => h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-value", title: value }, value))),
  );

  const sections = [];

  if (info) {
    sections.push(
      cardWith(
        "Entitlements",
        "What the SDK reports as unlocked, computed from the purchases below.",
        entitlements.length
          ? table(
              [{ label: "Entitlement" }, { label: "Product" }, { label: "Since", class: "hide-below-md" }, { label: "Expires" }, { label: "Status" }],
              entitlements.map(([id, e]) => {
                const active = !e.expires_date || Date.parse(e.expires_date) > now;
                return [
                  h("span", { class: "cell-strong" }, id),
                  h("span", { class: "mono small" }, e.product_identifier),
                  fmtDate(Date.parse(e.purchase_date)),
                  e.expires_date ? fmtDateTime(Date.parse(e.expires_date)) : "Never",
                  active ? badge("Active", "success", true) : badge("Expired"),
                ];
              }),
            )
          : h("div", { class: "card-body muted small" }, "No entitlements."),
      ),
    );
  } else {
    sections.push(h("div", { class: "card small muted" }, "Entitlements span every app, so they're shown only to operators with access to all apps. The purchases below are limited to your apps."));
  }

  sections.push(
    cardWith(
      "Purchases",
      "Every store transaction this customer owns, newest first. Renewals share the original transaction ID.",
      transactions.length
        ? table(
            [{ label: "Product" }, { label: "Store", class: "hide-below-md" }, { label: "Purchased" }, { label: "Expires", class: "hide-below-md" }, { label: "Price", class: "hide-below-md" }, { label: "Status" }],
            transactions.map((t) => [
              h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, t.product_id + (t.base_plan_id ? `:${t.base_plan_id}` : "")), h("span", { class: "cell-mono", title: "Transaction ID" }, t.transaction_id), appLabel(t.app_id) ? h("span", { class: "cell-sub" }, t.app_id) : null),
              h("div", { class: "row wrap", style: { gap: "4px" } }, badge(STORE[t.store] ?? t.store), t.environment === "sandbox" ? badge("Sandbox", "warning") : null, t.verified ? null : badge("Unverified", "danger")),
              fmtDateTime(t.purchased_at),
              t.expires_at ? fmtDateTime(t.expires_at) : "—",
              money(t.price_micros, t.currency),
              txStatus(t),
            ]),
          )
        : h("div", { class: "card-body muted small" }, "No purchases yet."),
    ),
  );

  if (states.length) {
    sections.push(
      cardWith(
        "Subscription status",
        "The latest renewal information from the store, per subscription.",
        table(
          [{ label: "Original transaction" }, { label: "Status" }, { label: "Auto-renew" }, { label: "Billing issue", class: "hide-below-md" }, { label: "Grace period ends", class: "hide-below-md" }],
          states.map((s) => {
            const [label, variant] = APPLE_STATUS[s.status] ?? ["Unknown", ""];
            return [
              h("span", { class: "cell-mono cell-truncate", title: s.original_transaction_id }, s.original_transaction_id),
              badge(label, variant, true),
              s.auto_renew === null || s.auto_renew === undefined ? "—" : s.auto_renew ? `On${s.auto_renew_product_id ? ` → ${s.auto_renew_product_id}` : ""}` : "Off",
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
        "Attributes",
        "Set by the SDK (setAttributes, setEmail…).",
        h("div", { class: "card-body" }, attrEntries.length ? kv(attrEntries.map(([k, v]) => [h("span", { class: "mono small" }, k), h("span", { title: `Updated ${fmtDateTime(v.updated_at_ms)}` }, v.value)])) : h("p", { class: "muted small" }, "No attributes.")),
      ),
      cardWith(
        "App user IDs",
        "Every ID that finds this customer (anonymous IDs merged at logIn).",
        h("div", { class: "card-body" }, kv(aliases.map((a) => [h("span", { class: "mono small" }, a.app_user_id), when(a.created_at)]))),
      ),
    ),
  );

  sections.push(
    cardWith(
      "Webhook events",
      "The latest 50 events sent about this customer.",
      events.length
        ? table(
            [{ label: "Event" }, { label: "App", class: "hide-below-md" }, { label: "Created" }, { label: "", class: "actions" }],
            events.map((e) => [
              h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, e.type), h("span", { class: "cell-mono" }, e.id)),
              h("span", null, e.app_id, e.environment === "SANDBOX" || e.environment === "sandbox" ? h("span", null, " ", badge("Sandbox", "warning")) : null),
              when(e.created_at),
              ctx.can("webhooks:replay") ? replayButton(e.id) : null,
            ]),
          )
        : h("div", { class: "card-body muted small" }, "No webhook events."),
    ),
  );

  if (info) {
    const json = JSON.stringify(info, null, 2);
    sections.push(
      h(
        "details",
        { class: "card card-tight" },
        h("summary", { class: "card-header", style: { cursor: "pointer" } }, h("span", { class: "card-title" }, "CustomerInfo JSON"), h("span", { class: "card-sub" }, "What GET /v1/subscribers returns for this customer")),
        h("div", { class: "card-body stack-sm" }, h("div", null, button("Copy JSON", { variant: "outline", size: "sm", onClick: () => copy(json) })), h("pre", { class: "code" }, json)),
      ),
    );
  }

  return h(
    "div",
    null,
    crumbs,
    pageHeader(customer.original_app_user_id, `Customer since ${fmtDateTime(customer.first_seen)}`, [refresh]),
    h("div", { class: "stack" }, stats, sections),
  );
}

export function replayButton(eventId) {
  const btn = button("Replay", {
    variant: "outline",
    size: "sm",
    title: "Send this event to your webhook endpoints again (same event ID)",
    onClick: () =>
      busy(btn, async () => {
        await post(`/webhooks/events/${encodeURIComponent(eventId)}/replay`);
        toast("Replay queued", "success");
      }),
  });
  return btn;
}
