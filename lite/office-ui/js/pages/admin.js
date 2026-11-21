// Admin pages: the team (operators), the audit log and deployment settings.
import { get, patch, post, put } from "../api.js";
import { sdkUrlBlock } from "../connect.js";
import { h, replace } from "../dom.js";
import { t, tk, tx } from "../i18n.js";
import { IconPlus, IconRefresh, IconShield } from "../icons.js";
import {
  avatar,
  badge,
  busy,
  button,
  cardWith,
  checkboxes,
  confirmDialog,
  copyField,
  empty,
  field,
  fmtDateTime,
  formError,
  input,
  kv,
  modal,
  pageHeader,
  seg,
  select,
  table,
  toast,
  toggle,
  when,
} from "../ui.js";

// ---- Team ---------------------------------------------------------------------------------------

const ROLES = [
  { value: "owner", label: tk("Owner"), sub: tk("Everything, including managing owners and security settings") },
  { value: "admin", label: tk("Admin"), sub: tk("Everything except owners and security settings") },
  { value: "developer", label: tk("Developer"), sub: tk("Read, replay webhooks, manage secret keys") },
  { value: "viewer", label: tk("Viewer"), sub: tk("Read only") },
];
const roleLabel = (r) => {
  const label = ROLES.find((x) => x.value === r)?.label;
  return label ? t(label) : r;
};
const roleSub = (r) => t(ROLES.find((x) => x.value === r).sub);
/** Role options for a select, in the current language. */
const roleChoices = (list) => list.map((r) => ({ value: r.value, label: t(r.label), sub: t(r.sub) }));

/** "All apps" or a subset; returns { el, value() } where value() is null (all) or a list. */
function appPicker(apps, current) {
  const all = h("input", { type: "checkbox", checked: current === null || current === undefined });
  const boxes = checkboxes(
    apps.map((a) => ({ value: a.id, label: a.id, sub: a.bundle_id ?? a.package_name ?? a.store })),
    current ?? [],
  );
  const sync = () => (boxes.el.hidden = all.checked);
  all.addEventListener("change", sync);
  sync();
  return {
    el: h("div", { class: "stack-sm" }, h("label", { class: "check" }, all, h("span", null, t("All apps"), h("span", { class: "check-sub" }, t("Including apps added later")))), boxes.el),
    value() {
      if (all.checked) return null;
      const chosen = boxes.values();
      if (!chosen.length) throw new Error(t("Pick at least one app, or All apps."));
      return chosen;
    },
  };
}

function linkModal(title, sub, link) {
  modal({
    title,
    sub,
    body: h("div", { class: "stack-sm" }, copyField(link), h("p", { class: "small muted" }, t("Send it privately (a direct message, not a shared channel). It works once, within 24 hours. openpurr doesn't send email."))),
    actions: [button(t("Done"), { type: "submit" })],
    dismissable: false,
  });
}

export async function teamPage(ctx) {
  const { operators } = await get("/operators");
  const me = ctx.operator;
  const canManage = ctx.can("operators:manage");
  const mayManage = (role) => canManage && (role !== "owner" || me.role === "owner");
  const roleOptions = ROLES.filter((r) => mayManage(r.value));

  const add = () => {
    const errors = formError();
    const email = input({ type: "email", required: true, placeholder: "teammate@example.com" });
    const name = input({ placeholder: t("Their name") });
    const role = select(roleChoices(roleOptions), "developer");
    const apps = appPicker(ctx.allApps, null);
    const submit = button(t("Add and create link"), { type: "submit" });
    const m = modal({
      title: t("Add a teammate"),
      sub: t("You'll get a one-time setup link to send them. They choose their own password."),
      body: h("div", { class: "stack" }, errors.el, h("div", null, field(t("Email"), email), field(t("Name"), name), field(t("Role"), role, roleSub("developer"))), ctx.allApps.length > 1 ? h("div", null, h("span", { class: "label" }, t("Apps")), apps.el) : null),
      actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const created = await busy(submit, () => post("/operators", { email: email.value.trim(), name: name.value.trim(), role: role.value, app_ids: apps.value() }), errors);
        if (!created) return false;
        m.close();
        linkModal(t("Send {email} their setup link", { email: email.value.trim() }), t("They'll use it to set a password and sign in."), created.setup_link);
        ctx.rerender();
        return false;
      },
    });
    role.addEventListener("change", () => (role.closest(".field").querySelector(".field-hint").textContent = roleSub(role.value)));
  };

  const edit = (op) => {
    const errors = formError();
    const self = op.id === me.id;
    const name = input({ value: op.name, required: true });
    const role = select(roleChoices(self ? ROLES : roleOptions), op.role);
    role.disabled = self;
    const apps = appPicker(ctx.allApps, op.app_ids);
    const submit = button(t("Save"), { type: "submit" });
    const m = modal({
      title: t("Edit {email}", { email: op.email }),
      body: h("div", { class: "stack" }, errors.el, h("div", null, field(t("Name"), name), field(t("Role"), role, self ? t("You can't change your own role.") : null)), ctx.allApps.length > 1 ? h("div", null, h("span", { class: "label" }, t("Apps")), apps.el) : null),
      actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const body = { name: name.value.trim() };
        if (!self && role.value !== op.role) body.role = role.value;
        if (ctx.allApps.length > 1) body.app_ids = apps.value();
        const ok = await busy(submit, () => patch(`/operators/${op.id}`, body), errors);
        if (!ok) return false;
        toast(t("Saved"), "success");
        ctx.rerender();
      },
    });
  };

  const reset = async (op) => {
    if (!(await confirmDialog({ title: t("Reset sign-in for {email}?", { email: op.email }), text: t("This clears their password and two-step sign-in, signs them out everywhere and gives you a new setup link for them."), confirmLabel: t("Reset"), danger: true }))) return;
    try {
      const { setup_link } = await post(`/operators/${op.id}/reset`);
      linkModal(t("Send {email} their new setup link", { email: op.email }), t("They'll use it to choose a new password."), setup_link);
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const setDisabled = async (op, disabled) => {
    if (disabled && !(await confirmDialog({ title: t("Disable {email}?", { email: op.email }), text: t("They're signed out everywhere and their access tokens are revoked. You can enable them again later."), confirmLabel: t("Disable"), danger: true }))) return;
    try {
      await patch(`/operators/${op.id}`, { disabled });
      toast(disabled ? t("Disabled") : t("Enabled"), "success");
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const status = (op) => (op.disabled ? badge(t("Disabled"), "danger") : !op.has_password ? badge(t("Setup pending"), "warning", true) : badge(t("Active"), "success", true));

  return h(
    "div",
    null,
    pageHeader(t("Team"), t("People who can sign in to this openpurr deployment."), canManage ? [button(t("Add teammate"), { icon: IconPlus(15), onClick: add })] : []),
    table(
      [{ label: t("Name") }, { label: t("Role") }, { label: t("Apps"), class: "hide-below-md" }, { label: t("Two-step"), class: "hide-below-md" }, { label: t("Last sign-in"), class: "hide-below-md" }, { label: t("Status") }, { label: "", class: "actions" }],
      operators.map((op) => [
        h("div", { class: "row" }, avatar(op), h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, op.name, op.id === me.id ? h("span", { class: "muted" }, " ", t("(you)")) : null), h("span", { class: "cell-sub" }, op.email))),
        roleLabel(op.role),
        op.app_ids ? h("span", { class: "small" }, op.app_ids.join(", ")) : h("span", { class: "muted small" }, t("All apps")),
        op.totp_enabled ? badge(t("On"), "success") : badge(t("Off")),
        when(op.last_login_at),
        status(op),
        mayManage(op.role)
          ? [
              button(t("Edit"), { variant: "outline", size: "sm", onClick: () => edit(op) }),
              op.id !== me.id && !op.disabled ? button(t("Reset"), { variant: "outline", size: "sm", onClick: () => reset(op) }) : null,
              op.id !== me.id ? button(op.disabled ? t("Enable") : t("Disable"), { variant: "outline", size: "sm", onClick: () => setDisabled(op, !op.disabled) }) : null,
            ]
          : null,
      ]),
    ),
  );
}

// ---- Audit log ----------------------------------------------------------------------------------

const SOURCE = { dashboard: "", api: "info", cli: "warning", mcp: "info", system: "" };

export async function auditPage() {
  const rows = h("tbody");
  const more = button(t("Load more"), { variant: "outline" });
  let before = null;
  const columns = [t("When"), t("Who"), t("Action"), t("Target"), t("Details")];
  const load = async () => {
    const { entries, next_before } = await get(`/audit?limit=100${before ? `&before=${before}` : ""}`);
    for (const e of entries) {
      const details = e.details ? JSON.stringify(e.details) : "";
      rows.append(
        h(
          "tr",
          null,
          h("td", { title: fmtDateTime(e.at) }, fmtDateTime(e.at)),
          h("td", null, h("div", { class: "cell-stack" }, h("span", null, e.actor ?? "—"), h("span", { class: "row", style: { gap: "4px" } }, badge(e.source, SOURCE[e.source] ?? ""), e.ip ? h("span", { class: "cell-sub mono" }, e.ip) : null))),
          h("td", null, h("span", { class: "mono small" }, e.action)),
          h("td", null, h("span", { class: "cell-mono cell-truncate", title: e.target ?? "" }, e.target ?? "—")),
          h("td", null, h("span", { class: "cell-mono cell-truncate", title: details }, details || "—")),
        ),
      );
    }
    before = next_before;
    more.hidden = !next_before;
  };
  more.addEventListener("click", () => busy(more, load));
  await load();
  return h(
    "div",
    null,
    pageHeader(t("Audit log"), t("Sign-ins, credential changes and every change made through the dashboard, the admin API or the CLI.")),
    rows.childElementCount
      ? h(
          "div",
          { class: "stack" },
          h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", null, h("tr", null, columns.map((c) => h("th", { scope: "col" }, c)))), rows)),
          h("div", null, more),
        )
      : h("div", { class: "card" }, empty({ icon: IconShield, title: t("Nothing logged yet") })),
  );
}

// ---- Settings -----------------------------------------------------------------------------------

const STORE = { app_store: "App Store", play_store: "Google Play" };

// Free-plan usage: today's requests and D1 rows against the daily limits (src/office/usage.ts).
const fmtCount = (n) => n.toLocaleString();
const USAGE_TONE = { ok: "", info: "", warn: "warning", fail: "danger" };

export function usageCard(ctx, initial) {
  const owner = ctx.can("settings:manage");
  const body = h("div", { class: "card-body stack-sm" });
  const render = (r) => {
    const rows = r.metrics.map((m) =>
      h(
        "div",
        { class: "meter-row" },
        h("div", { class: "meter-head" }, h("span", { class: "small" }, m.label), h("span", { class: "small mono" }, `${fmtCount(m.used)} / ${fmtCount(m.limit)}`, m.projected && m.projected > m.used && r.plan === "free" ? h("span", { class: "faint" }, " · ", t("on pace for {count}", { count: fmtCount(m.projected) })) : null)),
        h("div", { class: `meter ${USAGE_TONE[m.status]}` }, h("div", { class: "meter-fill", style: { width: `${Math.min(100, m.share * 100)}%` } })),
      ),
    );
    const plan = owner
      ? seg(
          [
            { value: "free", label: t("Free plan") },
            { value: "paid", label: t("Workers Paid") },
          ],
          r.plan,
          async (v) => {
            try {
              await put("/settings", { cloudflare_plan: v });
              render(await get("/usage"));
              toast(v === "paid" ? t("Workers Paid: no daily-limit warnings") : t("Free plan: warnings from 75% of each daily limit"), "success");
            } catch (err) {
              toast(err.message, "error");
            }
          },
        )
      : h("span", { class: "small" }, r.plan === "paid" ? t("Workers Paid") : t("Free plan"));
    const status = !r.configured
      ? h(
          "p",
          { class: "small muted" },
          tx("Usage alerts are off. To turn them on, create a Cloudflare API token with Account Analytics: Read (My Profile → API Tokens), then run {command}. If the token can reach several accounts, also set CLOUDFLARE_ACCOUNT_ID.", {
            command: h("code", { class: "code-inline" }, "wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN --env office"),
          }),
        )
      : h(
          "p",
          { class: "small muted" },
          r.error ? [t("The latest fetch failed: {error}.", { error: r.error }), " "] : "",
          r.updated_at ? [...tx("Updated {when}.", { when: when(r.updated_at) }), " "] : [t("Not fetched yet."), " "],
          r.plan === "free" ? t("Limits reset at 00:00 UTC. Past one, requests fail until then and purchases stay queued on devices.") : t("Workers Paid has no daily cap; usage beyond what's included is billed."),
        );
    replace(body, h("div", null, plan), r.configured ? rows : null, status);
  };
  render(initial);
  const refresh = button(null, {
    variant: "outline",
    size: "sm",
    icon: IconRefresh(14),
    title: t("Fetch now"),
    onClick: (e) => busy(e.currentTarget, async () => render(await post("/usage/refresh"))),
  });
  return cardWith(t("Daily usage"), t("Today's requests and database rows against Cloudflare's free-plan limits."), body, initial.configured ? [refresh] : []);
}

export async function settingsPage(ctx) {
  const [settings, usage] = await Promise.all([get("/settings"), get("/usage")]);
  const owner = ctx.can("settings:manage");
  const requireTotp = toggle({
    checked: settings.require_totp,
    disabled: !owner,
    label: t("Require two-step sign-in for everyone"),
    onChange: async (next) => {
      try {
        await put("/settings", { require_totp: next });
        toast(next ? t("Two-step sign-in is now required") : t("Two-step sign-in is now optional"), "success");
        return true;
      } catch (err) {
        toast(err.message, "error");
        return false;
      }
    },
  });

  return h(
    "div",
    null,
    pageHeader(t("Settings"), t("Deployment-wide settings. Apps, products, entitlements, offerings and webhooks are under Configuration, per project.")),
    h(
      "div",
      { class: "stack" },
      usageCard(ctx, usage),
      cardWith(
        t("Security"),
        owner ? null : t("Only owners can change these."),
        h("div", { class: "card-body stack-sm" }, requireTotp, h("p", { class: "small muted" }, t("When on, anyone without two-step sign-in has to set it up before they can do anything else. Turn it on for yourself first."))),
      ),
      cardWith(
        t("Apps"),
        h("span", null, ...tx("Every project's apps. Change them under {link}.", { link: h("a", { href: "/admin/apps", "data-nav": "" }, t("Apps and products")) })),
        ctx.allApps.length
          ? table(
              [{ label: t("App ID") }, { label: t("Project"), class: "hide-below-md" }, { label: t("Store") }, { label: t("Bundle ID / package") }, { label: t("Products") }],
              ctx.allApps.map((a) => [h("span", { class: "cell-strong mono" }, a.id), ctx.projects.find((p) => p.id === a.project_id)?.name ?? a.project_id, STORE[a.store] ?? a.store, h("span", { class: "mono small" }, a.bundle_id ?? a.package_name ?? "—"), String(a.products.length)]),
            )
          : h("div", { class: "card-body muted small" }, t("No apps you can see.")),
      ),
      cardWith(
        t("This deployment"),
        null,
        h("div", { class: "card-body" }, kv([[t("Back office"), h("span", { class: "mono small" }, location.origin)], [t("SDK URL"), sdkUrlBlock(ctx, settings)], [t("Edition"), t("Lite (Cloudflare Workers + D1)")]])),
      ),
    ),
  );
}

