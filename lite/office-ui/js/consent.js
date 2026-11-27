// The OAuth consent screen (/admin/oauth/consent?request=…): an app such as Claude.ai asks to use
// openpurr's MCP server, or the iOS app asks to use the admin API, as the signed-in operator. Shown full screen, like sign-in. The operator
// sees who is asking, where the approval is sent, and which permissions, limited to their role.
import { get, post } from "./api.js";
import { h, replace } from "./dom.js";
import { t, tx } from "./i18n.js";
import { badge, brand, busy, button, formError } from "./ui.js";

export async function renderConsent(root, operator) {
  const id = new URLSearchParams(location.search).get("request") ?? "";
  const card = h("div", { class: "auth-card wide" }, h("div", { class: "auth-brand" }, brand()));
  replace(root, h("main", { class: "auth-screen" }, card));

  let req;
  try {
    req = await get(`/oauth/requests/${encodeURIComponent(id)}`);
  } catch (err) {
    card.append(
      h("h1", { class: "auth-title" }, t("This sign-in request isn't valid anymore")),
      h("p", { class: "auth-sub" }, err.status === 404 ? t("It expired or was already used. Start connecting again from the app.") : err.message),
      h("div", null, button(t("Go to the dashboard"), { variant: "outline", onClick: () => location.assign("/admin") })),
    );
    return;
  }

  const errors = formError();
  const boxes = req.scopes.map((s) => ({ s, box: h("input", { type: "checkbox", checked: s.allowed, disabled: !s.allowed }) }));
  const appHost = req.client.metadata_url ? new URL(req.client.metadata_url).host : req.client.uri ? new URL(req.client.uri).host : null;
  const decide = (approve, btn) =>
    busy(
      btn,
      async () => {
        const scopes = boxes.filter((b) => b.box.checked).map((b) => b.s.scope);
        if (approve && !scopes.length) throw new Error(t("Pick at least one permission, or deny."));
        const r = await post(`/oauth/requests/${encodeURIComponent(id)}/${approve ? "approve" : "deny"}`, approve ? { scopes } : {});
        location.assign(r.redirect);
      },
      errors,
    );
  const who = { app: appHost ? `${req.client.name} (${appHost})` : req.client.name, email: operator.email, role: operator.role };
  const allow = button(t("Allow"), {});
  const deny = button(t("Deny"), { variant: "outline" });
  allow.addEventListener("click", () => decide(true, allow));
  deny.addEventListener("click", () => decide(false, deny));

  card.append(
    h("h1", { class: "auth-title" }, t("Connect {app} to openpurr?", { app: req.client.name })),
    h(
      "p",
      { class: "auth-sub" },
      (req.api === "admin"
        ? t("{app} wants to use openpurr's admin API as you, {email} ({role}), to show charts, purchases and customers. It can only do what you allow below, and never more than your role.", who)
        : t("{app} wants to use openpurr's MCP server as you, {email} ({role}). It can only do what you allow below, and never more than your role.", who)),
    ),
    h(
      "div",
      { class: "stack" },
      errors.el,
      h(
        "div",
        { class: "checks" },
        boxes.map(({ s, box }) =>
          h("label", { class: "check" }, box, h("span", null, s.label, s.allowed ? null : h("span", { class: "check-sub" }, t("Your role doesn't allow this.")))),
        ),
      ),
      h(
        "p",
        { class: "small muted" },
        tx("After you choose, you'll be sent to {host}. You can disconnect it any time under Access tokens.", { host: h("strong", null, req.redirect_host) }),
      ),
      req.localhost
        ? h(
            "p",
            { class: "small" },
            badge(t("Check"), "warning"),
            " ",
            t("This sends the approval to a program on this computer (localhost). Only allow it if you just started connecting from an app you trust."),
          )
        : null,
      h("div", { class: "row", style: { justifyContent: "flex-end" } }, deny, allow),
    ),
  );
}
