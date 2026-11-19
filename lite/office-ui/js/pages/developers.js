// Developer pages: webhook deliveries, secret keys (server-to-server) and personal access tokens.
import { del, get, post } from "../api.js";
import { h, replace } from "../dom.js";
import { IconBolt, IconKey, IconPlus, IconRefresh, IconTerminal } from "../icons.js";
import { replayButton } from "./customers.js";
import {
  badge,
  busy,
  button,
  cardWith,
  checkboxes,
  confirmDialog,
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

const DELIVERY = { delivered: ["Delivered", "success"], pending: ["Retrying", "info"], failed: ["Failed", "danger"] };

export async function webhooksPage(ctx) {
  let status = "";
  const body = h("div");
  const load = async () => {
    replace(body, h("div", { class: "loading" }, "Loading…"));
    const { deliveries } = await get(`/webhooks/deliveries?limit=100${status ? `&status=${status}` : ""}`);
    replace(
      body,
      deliveries.length
        ? table(
            [{ label: "Event" }, { label: "Endpoint", class: "hide-below-md" }, { label: "Status" }, { label: "Last response", class: "hide-below-md" }, { label: "Created" }, { label: "", class: "actions" }],
            deliveries.map((d) => {
              const [label, variant] = DELIVERY[d.status] ?? [d.status, ""];
              return [
                h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, d.type), h("span", { class: "cell-mono" }, d.event_id), ctx.apps.length > 1 ? h("span", { class: "cell-sub" }, d.app_id) : null),
                h("span", { class: "cell-mono cell-truncate", title: d.endpoint }, d.endpoint),
                h("div", { class: "cell-stack" }, badge(label, variant, true), h("span", { class: "cell-sub" }, d.status === "pending" && d.next_attempt_at ? `attempt ${d.attempts + 1} ${when(d.next_attempt_at).textContent}` : `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}`)),
                h("span", { class: "small cell-truncate", title: d.last_error ?? "" }, d.last_status ? `HTTP ${d.last_status}` : "", d.last_error ? `${d.last_status ? " · " : ""}${d.last_error}` : d.last_status ? "" : "—"),
                when(d.created_at),
                ctx.can("webhooks:replay") ? replayButton(d.event_id) : null,
              ];
            }),
          )
        : h("div", { class: "card" }, empty({ icon: IconBolt, title: status ? `No ${DELIVERY[status][0].toLowerCase()} deliveries` : "No webhook deliveries yet", text: "Webhook endpoints are set in openpurr.config.yaml under webhooks. Events are sent when purchases, renewals, cancellations and other changes happen." })),
    );
  };
  const filter = seg(
    [
      { value: "", label: "All" },
      { value: "failed", label: "Failed" },
      { value: "pending", label: "Retrying" },
      { value: "delivered", label: "Delivered" },
    ],
    status,
    (v) => {
      status = v;
      void load().catch((err) => toast(err.message, "error"));
    },
  );
  await load();
  return h(
    "div",
    null,
    pageHeader("Webhooks", "Events sent to your webhook endpoints. Failed deliveries are retried with backoff for about three days. Replay sends the same event again (same ID, so consumers can deduplicate).", [
      button(null, { variant: "outline", icon: IconRefresh(15), title: "Refresh", onClick: () => load().catch((err) => toast(err.message, "error")) }),
    ]),
    h("div", { class: "stack" }, h("div", null, filter), body),
  );
}

// ---- Shared key helpers -------------------------------------------------------------------------

function keyState(k) {
  if (k.revoked_at) return badge("Revoked", "danger");
  if (k.expires_at && k.expires_at <= Date.now()) return badge("Expired");
  if (k.expires_at) return h("span", { title: fmtDateTime(k.expires_at) }, badge(`Expires ${when(k.expires_at).textContent}`, "warning", true));
  return badge("Active", "success", true);
}

const nameCell = (k, prefix) =>
  h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, k.name), h("span", { class: "token-chip" }, `${prefix}…`));

// ---- Secret keys --------------------------------------------------------------------------------

const SECRET_KEY_SCOPES = [{ value: "customers:read", label: "customers:read", sub: "Read customers: GET /v1/subscribers/{app_user_id}" }];

export async function secretKeysPage(ctx) {
  const { secret_keys: keys } = await get("/secret-keys");
  const create = () => {
    const errors = formError();
    const name = input({ required: true, placeholder: "e.g. Production backend", maxlength: 100 });
    const scopes = checkboxes(SECRET_KEY_SCOPES, ["customers:read"]);
    const submit = button("Create key", { type: "submit" });
    const m = modal({
      title: "New secret key",
      sub: "For your servers to call the openpurr API. Never put a secret key in an app.",
      body: h("div", { class: "stack" }, errors.el, field("Name", name), h("div", null, h("span", { class: "label" }, "Scopes"), scopes.el)),
      actions: [button("Cancel", { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const created = await busy(submit, () => post("/secret-keys", { name: name.value.trim(), scopes: scopes.values() }), errors);
        if (!created) return false;
        m.close();
        showSecretOnce({ title: "Copy your secret key", sub: "This is the only time it's shown. Store it in your backend's secrets.", value: created.key, note: "Send it as Authorization: Bearer sk_… on requests to /v1." });
        ctx.rerender();
        return false;
      },
    });
  };

  const expire = (k) => {
    const errors = formError();
    const when = select(
      [
        { value: "0", label: "Now" },
        { value: "1", label: "In 1 hour" },
        { value: "24", label: "In 24 hours" },
        { value: "168", label: "In 7 days" },
        { value: "720", label: "In 30 days" },
      ],
      "24",
    );
    const submit = button("Set expiry", { type: "submit" });
    const m = modal({
      title: `Expire “${k.name}”`,
      sub: "To rotate a key without downtime: create a new key, switch your backend to it, then let the old one expire.",
      body: h("div", { class: "stack" }, errors.el, field("Stop working", when)),
      actions: [button("Cancel", { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const ok = await busy(submit, () => post(`/secret-keys/${k.id}/expire`, { in_hours: Number(when.value) }), errors);
        if (!ok) return false;
        toast("Expiry set", "success");
        ctx.rerender();
      },
    });
  };

  const revoke = async (k) => {
    if (!(await confirmDialog({ title: `Revoke “${k.name}”?`, text: "Requests using this key will fail within a minute. This can't be undone.", confirmLabel: "Revoke key", danger: true }))) return;
    try {
      await post(`/secret-keys/${k.id}/revoke`);
      toast("Key revoked", "success");
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const live = (k) => !k.revoked_at && !(k.expires_at && k.expires_at <= Date.now());
  return h(
    "div",
    null,
    pageHeader("Secret keys", "Server-to-server keys for your backend to read customers from the openpurr API. Your apps use the public SDK keys from openpurr.config.yaml instead.", [
      button("New secret key", { icon: IconPlus(15), onClick: create }),
    ]),
    keys.length
      ? table(
          [{ label: "Name" }, { label: "Scopes", class: "hide-below-md" }, { label: "Created", class: "hide-below-md" }, { label: "Last used" }, { label: "Status" }, { label: "", class: "actions" }],
          keys
            .slice()
            .reverse()
            .map((k) => [
              nameCell(k, k.key_prefix),
              h("div", { class: "row wrap", style: { gap: "4px" } }, k.scopes.map((s) => badge(s))),
              when(k.created_at),
              when(k.last_used_at),
              keyState(k),
              live(k) ? [button("Expire…", { variant: "outline", size: "sm", onClick: () => expire(k) }), button("Revoke", { variant: "outline", size: "sm", onClick: () => revoke(k) })] : null,
            ]),
        )
      : h("div", { class: "card" }, empty({ icon: IconKey, title: "No secret keys", text: "Create one when your backend needs to check a customer's entitlements.", action: button("New secret key", { icon: IconPlus(15), onClick: create }) })),
  );
}

// ---- Personal access tokens ---------------------------------------------------------------------

const TOKEN_SCOPES = [
  { value: "read", label: "read", sub: "Read customers, webhook deliveries, the team and the audit log" },
  { value: "write:webhooks", label: "write:webhooks", sub: "Replay webhook events" },
  { value: "admin", label: "admin", sub: "Manage secret keys, the team and settings" },
  { value: "write:grants", label: "write:grants", sub: "Grant entitlements (arrives with the MCP tools)" },
];

export async function tokensPage(ctx) {
  const { tokens } = await get("/tokens");
  const create = () => {
    const errors = formError();
    const name = input({ required: true, placeholder: "e.g. Laptop CLI", maxlength: 100 });
    const scopes = checkboxes(TOKEN_SCOPES, ["read"]);
    const expiry = select(
      [
        { value: "30", label: "30 days" },
        { value: "90", label: "90 days" },
        { value: "365", label: "1 year" },
        { value: "", label: "No expiry" },
      ],
      "90",
    );
    const submit = button("Create token", { type: "submit" });
    const m = modal({
      title: "New access token",
      sub: `Acts as you (${ctx.operator.role}), limited to the scopes you pick. Your role still applies: a scope can't grant more than you have.`,
      body: h("div", { class: "stack" }, errors.el, field("Name", name), h("div", null, h("span", { class: "label" }, "Scopes"), scopes.el), field("Expires", expiry)),
      actions: [button("Cancel", { variant: "outline", onClick: () => m.close() }), submit],
      onSubmit: async () => {
        const chosen = scopes.values();
        if (!chosen.length) return errors.show(new Error("Pick at least one scope.")), false;
        const created = await busy(
          submit,
          () => post("/tokens", { name: name.value.trim(), scopes: chosen, ...(expiry.value ? { expires_in_days: Number(expiry.value) } : {}) }),
          errors,
        );
        if (!created) return false;
        m.close();
        showSecretOnce({ title: "Copy your access token", sub: "This is the only time it's shown.", value: created.token, note: `Use it as Authorization: Bearer pat_… against ${location.origin}/admin/v1.` });
        ctx.rerender();
        return false;
      },
    });
  };

  const revoke = async (t) => {
    if (!(await confirmDialog({ title: `Revoke “${t.name}”?`, text: "Anything using this token stops working immediately.", confirmLabel: "Revoke token", danger: true }))) return;
    try {
      await del(`/tokens/${t.id}`);
      toast("Token revoked", "success");
      ctx.rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const live = tokens.filter((t) => !t.revoked_at && !(t.expires_at && t.expires_at <= Date.now()));
  const old = tokens.filter((t) => !live.includes(t));
  const rows = (list) =>
    list
      .slice()
      .reverse()
      .map((t) => [
        nameCell(t, t.token_prefix),
        h("div", { class: "row wrap", style: { gap: "4px" } }, t.scopes.map((s) => badge(s))),
        when(t.created_at),
        when(t.last_used_at),
        keyState(t),
        live.includes(t) ? button("Revoke", { variant: "outline", size: "sm", onClick: () => revoke(t) }) : null,
      ]);
  const columns = [{ label: "Name" }, { label: "Scopes", class: "hide-below-md" }, { label: "Created", class: "hide-below-md" }, { label: "Last used" }, { label: "Status" }, { label: "", class: "actions" }];

  return h(
    "div",
    null,
    pageHeader("Access tokens", "Personal tokens for the openpurr CLI, the MCP server and scripts that call the admin API as you.", [button("New token", { icon: IconPlus(15), onClick: create })]),
    h(
      "div",
      { class: "stack" },
      live.length
        ? table(columns, rows(live))
        : h("div", { class: "card" }, empty({ icon: IconTerminal, title: "No access tokens", text: "Create one to use the admin API from a terminal or an AI assistant.", action: button("New token", { icon: IconPlus(15), onClick: create }) })),
      old.length ? cardWith("Revoked and expired", null, table(columns, rows(old))) : null,
    ),
  );
}
