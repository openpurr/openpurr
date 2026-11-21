// Developer pages: webhook deliveries, secret keys (server-to-server) and personal access tokens.
import { del, get, post } from "../api.js";
import { h, replace } from "../dom.js";
import { t, tk, tn } from "../i18n.js";
import { IconBolt, IconKey, IconPlus, IconRefresh, IconTerminal } from "../icons.js";
import { webhookEndpoints } from "./config.js";
import { replayButton } from "./customers.js";
import {
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
  modal,
  pageHeader,
  select,
  seg,
  showSecretOnce,
  table,
  toast,
  when,
} from "../ui.js";

// ---- Webhooks -----------------------------------------------------------------------------------

const DELIVERY = { delivered: [tk("Delivered"), "success"], pending: [tk("Retrying"), "info"], failed: [tk("Failed"), "danger"] };
// The empty state for each filter (one whole sentence per status, for translation).
const NO_DELIVERIES = { delivered: tk("No successful deliveries"), pending: tk("No retrying deliveries"), failed: tk("No failed deliveries") };

export async function webhooksPage(ctx) {
  let status = "";
  const body = h("div");
  const load = async () => {
    replace(body, h("div", { class: "loading" }, t("Loading…")));
    const { deliveries } = await get(`/webhooks/deliveries?limit=100${status ? `&status=${status}` : ""}`);
    replace(
      body,
      deliveries.length
        ? table(
            [{ label: t("Event") }, { label: t("Endpoint"), class: "hide-below-md" }, { label: t("Status") }, { label: t("Last response"), class: "hide-below-md" }, { label: t("Created") }, { label: "", class: "actions" }],
            deliveries.map((d) => {
              const [label, variant] = DELIVERY[d.status] ? [t(DELIVERY[d.status][0]), DELIVERY[d.status][1]] : [d.status, ""];
              return [
                h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, d.type), h("span", { class: "cell-mono" }, d.event_id), ctx.apps.length > 1 ? h("span", { class: "cell-sub" }, d.app_id) : null),
                h("span", { class: "cell-mono cell-truncate", title: d.endpoint }, d.endpoint),
                h("div", { class: "cell-stack" }, badge(label, variant, true), h("span", { class: "cell-sub" }, d.status === "pending" && d.next_attempt_at ? t("attempt {number} {when}", { number: d.attempts + 1, when: when(d.next_attempt_at).textContent }) : tn(d.attempts, "{n} attempt", "{n} attempts"))),
                h("span", { class: "small cell-truncate", title: d.last_error ?? "" }, d.last_status ? `HTTP ${d.last_status}` : "", d.last_error ? `${d.last_status ? " · " : ""}${d.last_error}` : d.last_status ? "" : "—"),
                when(d.created_at),
                ctx.can("webhooks:replay") ? replayButton(d.event_id) : null,
              ];
            }),
          )
        : h("div", { class: "card" }, empty({ icon: IconBolt, title: status ? t(NO_DELIVERIES[status]) : t("No webhook deliveries yet"), text: t("Events are sent to the endpoints above when purchases, renewals, cancellations and other changes happen.") })),
    );
  };
  const filter = seg(
    [
      { value: "", label: t("All") },
      { value: "failed", label: t("Failed") },
      { value: "pending", label: t("Retrying") },
      { value: "delivered", label: t("Delivered") },
    ],
    status,
    (v) => {
      status = v;
      void load().catch((err) => toast(err.message, "error"));
    },
  );
  const [endpoints] = await Promise.all([webhookEndpoints(ctx), load()]);
  return h(
    "div",
    null,
    pageHeader(t("Webhooks"), t("Events sent to your webhook endpoints. Failed deliveries are retried with backoff for about three days. Replay sends the same event again (same ID, so consumers can deduplicate)."), [
      button(null, { variant: "outline", icon: IconRefresh(15), title: t("Refresh"), onClick: () => load().catch((err) => toast(err.message, "error")) }),
    ]),
    h("div", { class: "stack" }, endpoints, h("h2", { class: "section-title" }, t("Deliveries")), h("div", null, filter), body),
  );
}

// ---- Shared key helpers -------------------------------------------------------------------------

function keyState(k) {
  if (k.revoked_at) return badge(t("Revoked"), "danger");
  if (k.expires_at && k.expires_at <= Date.now()) return badge(t("Expired"));
  if (k.expires_at) return h("span", { title: fmtDateTime(k.expires_at) }, badge(t("Expires {when}", { when: when(k.expires_at).textContent }), "warning", true));
  return badge(t("Active"), "success", true);
}

const nameCell = (k, prefix) =>
  h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, k.name), h("span", { class: "token-chip" }, `${prefix}…`));

// ---- Secret keys --------------------------------------------------------------------------------

const SECRET_KEY_SCOPES = [{ value: "customers:read", label: "customers:read", sub: tk("Read customers: GET /v1/subscribers/{app_user_id}") }];
/** Scope options with their descriptions in the current language. */
const scopeOptions = (list) => list.map((s) => ({ ...s, sub: t(s.sub) }));

export async function secretKeysPage(ctx) {
  const { secret_keys: keys } = await get("/secret-keys");
  const create = () => {
    const errors = formError();
    const name = input({ required: true, placeholder: t("e.g. Production backend"), maxlength: 100 });
    const scopes = checkboxes(scopeOptions(SECRET_KEY_SCOPES), ["customers:read"]);
    const submit = button(t("Create key"), { type: "submit" });
    const m = modal({
      title: t("New secret key"),
      sub: t("For your servers to call the openpurr API. Never put a secret key in an app."),
      body: h("div", { class: "stack" }, errors.el, field(t("Name"), name), h("div", null, h("span", { class: "label" }, t("Scopes")), scopes.el)),
      actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const created = await busy(submit, () => post("/secret-keys", { name: name.value.trim(), scopes: scopes.values() }), errors);
        if (!created) return false;
        m.close();
        showSecretOnce({ title: t("Copy your secret key"), sub: t("This is the only time it's shown. Store it in your backend's secrets."), value: created.key, note: t("Send it as Authorization: Bearer sk_… on requests to /v1.") });
        ctx.rerender();
        return false;
      },
    });
  };

  const expire = (k) => {
    const errors = formError();
    const when = select(
      [
        { value: "0", label: t("Now") },
        { value: "1", label: t("In 1 hour") },
        { value: "24", label: t("In 24 hours") },
        { value: "168", label: t("In 7 days") },
        { value: "720", label: t("In 30 days") },
      ],
      "24",
    );
    const submit = button(t("Set expiry"), { type: "submit" });
    const m = modal({
      title: t("Expire “{name}”", { name: k.name }),
      sub: t("To rotate a key without downtime: create a new key, switch your backend to it, then let the old one expire."),
      body: h("div", { class: "stack" }, errors.el, field(t("Stop working"), when)),
      actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const ok = await busy(submit, () => post(`/secret-keys/${k.id}/expire`, { in_hours: Number(when.value) }), errors);
        if (!ok) return false;
        toast(t("Expiry set"), "success");
        ctx.rerender();
      },
    });
  };

  const revoke = async (k) => {
    if (!(await confirmDialog({ title: t("Revoke “{name}”?", { name: k.name }), text: t("Requests using this key will fail within a minute. This can't be undone."), confirmLabel: t("Revoke key"), danger: true }))) return;
    try {
      await post(`/secret-keys/${k.id}/revoke`);
      toast(t("Key revoked"), "success");
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const live = (k) => !k.revoked_at && !(k.expires_at && k.expires_at <= Date.now());
  return h(
    "div",
    null,
    pageHeader(t("Secret keys"), ctx.project ? t("Server-to-server keys for your backend to read {project}'s customers from the openpurr API. Each key reads one project. Your apps use the public SDK keys under Apps and products instead.", { project: ctx.project.name }) : t("Server-to-server keys for your backend to read your customers from the openpurr API. Each key reads one project. Your apps use the public SDK keys under Apps and products instead."), [
      button(t("New secret key"), { icon: IconPlus(15), onClick: create }),
    ]),
    keys.length
      ? table(
          [{ label: t("Name") }, { label: t("Scopes"), class: "hide-below-md" }, { label: t("Created"), class: "hide-below-md" }, { label: t("Last used") }, { label: t("Status") }, { label: "", class: "actions" }],
          keys
            .slice()
            .reverse()
            .map((k) => [
              nameCell(k, k.key_prefix),
              h("div", { class: "row wrap", style: { gap: "4px" } }, k.scopes.map((s) => badge(s))),
              when(k.created_at),
              when(k.last_used_at),
              keyState(k),
              live(k) ? [button(t("Expire…"), { variant: "outline", size: "sm", onClick: () => expire(k) }), button(t("Revoke"), { variant: "outline", size: "sm", onClick: () => revoke(k) })] : null,
            ]),
        )
      : h("div", { class: "card" }, empty({ icon: IconKey, title: t("No secret keys"), text: t("Create one when your backend needs to check a customer's entitlements."), action: button(t("New secret key"), { icon: IconPlus(15), onClick: create }) })),
  );
}

// ---- Personal access tokens ---------------------------------------------------------------------

/** The Claude Code command that adds this deployment's MCP server. */
const mcpCommand = (token) => `claude mcp add --transport http openpurr ${location.origin}/mcp --header "Authorization: Bearer ${token}"`;

const TOKEN_SCOPES = [
  { value: "read", label: "read", sub: tk("Read customers, webhook deliveries, the team and the audit log") },
  { value: "write:webhooks", label: "write:webhooks", sub: tk("Replay webhook events") },
  { value: "admin", label: "admin", sub: tk("Manage secret keys, the team and settings") },
  { value: "write:grants", label: "write:grants", sub: tk("Grant and revoke promotional entitlements") },
  { value: "write:config", label: "write:config", sub: tk("Change the configuration: apps, products, entitlements, offerings and webhooks") },
];

export async function tokensPage(ctx) {
  const [{ tokens }, { grants: connected }] = await Promise.all([get("/tokens"), get("/oauth/grants")]);
  const create = () => {
    const errors = formError();
    const name = input({ required: true, placeholder: t("e.g. Laptop CLI"), maxlength: 100 });
    const scopes = checkboxes(scopeOptions(TOKEN_SCOPES), ["read"]);
    const expiry = select(
      [
        { value: "30", label: t("30 days") },
        { value: "90", label: t("90 days") },
        { value: "365", label: t("1 year") },
        { value: "", label: t("No expiry") },
      ],
      "90",
    );
    const submit = button(t("Create token"), { type: "submit" });
    const m = modal({
      title: t("New access token"),
      sub: t("Acts as you ({role}), limited to the scopes you pick. Your role still applies: a scope can't grant more than you have.", { role: ctx.operator.role }),
      body: h("div", { class: "stack" }, errors.el, field(t("Name"), name), h("div", null, h("span", { class: "label" }, t("Scopes")), scopes.el), field(t("Expires"), expiry)),
      actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const chosen = scopes.values();
        if (!chosen.length) return errors.show(new Error(t("Pick at least one scope."))), false;
        const created = await busy(
          submit,
          () => post("/tokens", { name: name.value.trim(), scopes: chosen, ...(expiry.value ? { expires_in_days: Number(expiry.value) } : {}) }),
          errors,
        );
        if (!created) return false;
        m.close();
        showSecretOnce({
          title: t("Copy your access token"),
          sub: t("This is the only time it's shown."),
          value: created.token,
          note: t("Use it as Authorization: Bearer pat_… against {url}, or connect Claude Code to openpurr with: {command}", { url: `${location.origin}/admin/v1`, command: mcpCommand(created.token) }),
        });
        ctx.rerender();
        return false;
      },
    });
  };

  const revoke = async (tok) => {
    if (!(await confirmDialog({ title: t("Revoke “{name}”?", { name: tok.name }), text: t("Anything using this token stops working immediately."), confirmLabel: t("Revoke token"), danger: true }))) return;
    try {
      await del(`/tokens/${tok.id}`);
      toast(t("Token revoked"), "success");
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const live = tokens.filter((tok) => !tok.revoked_at && !(tok.expires_at && tok.expires_at <= Date.now()));
  const old = tokens.filter((tok) => !live.includes(tok));
  const mcpCard = cardWith(
    t("Connect an AI assistant (MCP)"),
    t("Ask Claude why a customer doesn't have an entitlement, look up purchases, read charts and grant access. It acts as you, limited to the token's scopes."),
    h(
      "div",
      { class: "card-body stack-sm" },
      h("p", { class: "small" }, t("MCP server URL:")),
      copyField(`${location.origin}/mcp`),
      h("p", { class: "small" }, t("Claude Code (replace pat_… with a token from this page):")),
      copyField(mcpCommand("pat_…")),
      h(
        "p",
        { class: "small muted" },
        t("Claude.ai and other apps that sign in: add a custom connector with the MCP server URL, and approve it here when asked. Other MCP clients: add a Streamable HTTP server with that URL and the header Authorization: Bearer pat_…. Give the token the read scope to look things up, plus write:grants to grant access, write:webhooks to replay webhooks and write:config to change the configuration."),
      ),
    ),
  );
  const rows = (list) =>
    list
      .slice()
      .reverse()
      .map((tok) => [
        nameCell(tok, tok.token_prefix),
        h("div", { class: "row wrap", style: { gap: "4px" } }, tok.scopes.map((s) => badge(s))),
        when(tok.created_at),
        when(tok.last_used_at),
        keyState(tok),
        live.includes(tok) ? button(t("Revoke"), { variant: "outline", size: "sm", onClick: () => revoke(tok) }) : null,
      ]);
  const columns = [{ label: t("Name") }, { label: t("Scopes"), class: "hide-below-md" }, { label: t("Created"), class: "hide-below-md" }, { label: t("Last used") }, { label: t("Status") }, { label: "", class: "actions" }];

  return h(
    "div",
    null,
    pageHeader(t("Access tokens"), t("Personal tokens for the openpurr CLI, the MCP server and scripts that call the admin API as you."), [button(t("New token"), { icon: IconPlus(15), onClick: create })]),
    h(
      "div",
      { class: "stack" },
      live.length
        ? table(columns, rows(live))
        : h("div", { class: "card" }, empty({ icon: IconTerminal, title: t("No access tokens"), text: t("Create one to use the admin API from a terminal or an AI assistant."), action: button(t("New token"), { icon: IconPlus(15), onClick: create }) })),
      old.length ? cardWith(t("Revoked and expired"), null, table(columns, rows(old))) : null,
      mcpCard,
      connectedApps(ctx, connected),
    ),
  );
}

/** Apps connected through OAuth (Claude.ai connectors and others): what they may do, and revoke. */
function connectedApps(ctx, grants) {
  const disconnect = async (g) => {
    if (!(await confirmDialog({ title: t("Disconnect {name}?", { name: g.client_name }), text: t("It loses access right away. You can connect it again later."), confirmLabel: t("Disconnect"), danger: true }))) return;
    try {
      await post(`/oauth/grants/${g.id}/revoke`);
      toast(t("Disconnected"), "success");
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };
  return cardWith(
    t("Connected apps"),
    t("Apps you've allowed to use the MCP server by signing in, such as Claude.ai."),
    grants.length
      ? table(
          [{ label: t("App") }, { label: t("Can"), class: "hide-below-md" }, { label: t("Connected"), class: "hide-below-md" }, { label: t("Last used") }, { label: "", class: "actions" }],
          grants.map((g) => [
            h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, g.client_name), g.client_id ? h("span", { class: "cell-sub" }, new URL(g.client_id).host) : g.client_uri ? h("span", { class: "cell-sub" }, new URL(g.client_uri).host) : null),
            h("div", { class: "row wrap", style: { gap: "4px" } }, g.scopes.map((s) => badge(s))),
            when(g.created_at),
            when(g.last_used_at),
            button(t("Disconnect"), { variant: "outline", size: "sm", onClick: () => disconnect(g) }),
          ]),
        )
      : h("div", { class: "card-body muted small" }, t("No apps connected.")),
  );
}
