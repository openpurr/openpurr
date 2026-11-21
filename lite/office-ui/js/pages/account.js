// Your account: profile, theme, password and two-step sign-in.
import { get, patch, post } from "../api.js";
import { newPasswordFields, totpEnrollment } from "../auth.js";
import { h } from "../dom.js";
import { browserLocale, LOCALES, t } from "../i18n.js";
import { avatar, badge, busy, button, cardWith, field, formError, input, kv, pageHeader, select, themeToggle, toast } from "../ui.js";

export async function accountPage(ctx) {
  const op = ctx.operator;
  const recovering = ctx.session === "recovery";
  const { require_totp: required } = await get("/settings").catch(() => ({ require_totp: false }));

  // Password
  const pwErrors = formError();
  const current = input({ type: "password", autocomplete: "current-password", required: true });
  const fields = newPasswordFields();
  const savePw = button(t("Change password"), { type: "submit" });
  const pwForm = h(
    "form",
    { class: "card-body stack" },
    pwErrors.el,
    recovering ? h("p", { class: "small muted" }, t("You signed in with a recovery link, so your current password isn't needed.")) : field(t("Current password"), current),
    fields.el,
    h("div", null, savePw),
  );
  pwForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(
      savePw,
      async () => {
        await post("/auth/password", { current_password: recovering ? undefined : current.value, new_password: fields.value() });
        toast(t("Password changed. Other sessions were signed out."), "success");
        await ctx.reload(); // a recovery session is now a normal one
      },
      pwErrors,
    );
  });

  // Two-step sign-in
  let totpBody;
  if (op.totp_enabled) {
    const errors = formError();
    const pw = input({ type: "password", autocomplete: "current-password", required: true });
    const off = button(recovering ? t("Remove authenticator") : t("Turn off"), { variant: "danger", type: "submit" });
    const offForm = h(
      "form",
      { class: "stack-sm" },
      errors.el,
      recovering ? null : field(t("Confirm with your password"), pw),
      h("div", null, off),
    );
    offForm.addEventListener("submit", (e) => {
      e.preventDefault();
      void busy(
        off,
        async () => {
          await post("/auth/totp/disable", recovering ? {} : { password: pw.value });
          toast(required ? t("Authenticator removed. Set up a new one to continue.") : t("Two-step sign-in is off"), "success");
          await ctx.reload();
        },
        errors,
      );
    });
    totpBody = h(
      "div",
      { class: "card-body stack" },
      h("div", { class: "row" }, badge(t("On"), "success", true), h("span", { class: "small muted" }, t("You'll be asked for a code from your authenticator app when you sign in."))),
      required && !recovering
        ? h("p", { class: "small muted" }, t("The owner requires two-step sign-in, so it can't be turned off. Lost your authenticator? Ask for a recovery link."))
        : h("div", { class: "stack-sm" }, recovering ? h("p", { class: "small" }, t("Lost your authenticator? Remove it here, then set up a new one.")) : null, offForm),
    );
  } else {
    totpBody = h(
      "div",
      { class: "card-body stack" },
      h("div", { class: "row" }, badge(t("Off")), h("span", { class: "small muted" }, t("Add a code from an authenticator app to your sign-in."))),
      totpEnrollment({ onDone: () => ctx.reload() }),
    );
  }

  return h(
    "div",
    null,
    pageHeader(t("Your account")),
    h(
      "div",
      { class: "stack" },
      cardWith(
        t("Profile"),
        null,
        h(
          "div",
          { class: "card-body row", style: { alignItems: "flex-start", gap: "20px" } },
          avatar(op, "sm"),
          kv([
            [t("Name"), op.name],
            [t("Email"), op.email],
            [t("Role"), op.role.charAt(0).toUpperCase() + op.role.slice(1)],
            [t("Apps"), op.app_ids ? op.app_ids.join(", ") : t("All apps")],
            [t("Theme"), themeToggle()],
            [t("Language"), languagePicker(ctx)],
          ]),
        ),
      ),
      cardWith(t("Password"), t("Changing it signs you out everywhere else."), pwForm),
      cardWith(t("Two-step sign-in"), null, totpBody),
    ),
  );
}

/** The dashboard language: Automatic (the browser's) or one of ours. Saved on the account. */
function languagePicker(ctx) {
  const auto = LOCALES.find((l) => l.code === browserLocale())?.name ?? "English";
  const choice = ctx.operator.locale ?? "";
  const el = select([{ value: "", label: t("Automatic ({language})", { language: auto }) }, ...LOCALES.map((l) => ({ value: l.code, label: l.name }))], choice);
  el.setAttribute("aria-label", t("Language"));
  // Each language's name in its own script and direction.
  for (const opt of el.options) {
    const l = LOCALES.find((x) => x.code === opt.value);
    if (l) opt.lang = l.tag;
  }
  el.addEventListener("change", async () => {
    const value = el.value || null;
    el.disabled = true;
    try {
      await patch("/me", { locale: value });
      await ctx.changeLocale(value);
    } catch (err) {
      el.disabled = false;
      el.value = choice;
      toast(err.message, "error");
    }
  });
  return el;
}
