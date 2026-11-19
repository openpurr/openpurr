// Your account: profile, theme, password and two-step sign-in.
import { get, post } from "../api.js";
import { newPasswordFields, totpEnrollment } from "../auth.js";
import { h } from "../dom.js";
import { avatar, badge, busy, button, cardWith, field, formError, input, kv, pageHeader, themeToggle, toast } from "../ui.js";

export async function accountPage(ctx) {
  const op = ctx.operator;
  const recovering = ctx.session === "recovery";
  const { require_totp: required } = await get("/settings").catch(() => ({ require_totp: false }));

  // Password
  const pwErrors = formError();
  const current = input({ type: "password", autocomplete: "current-password", required: true });
  const fields = newPasswordFields();
  const savePw = button("Change password", { type: "submit" });
  const pwForm = h(
    "form",
    { class: "card-body stack" },
    pwErrors.el,
    recovering ? h("p", { class: "small muted" }, "You signed in with a recovery link, so your current password isn't needed.") : field("Current password", current),
    fields.el,
    h("div", null, savePw),
  );
  pwForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(
      savePw,
      async () => {
        await post("/auth/password", { current_password: recovering ? undefined : current.value, new_password: fields.value() });
        toast("Password changed. Other sessions were signed out.", "success");
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
    const off = button(recovering ? "Remove authenticator" : "Turn off", { variant: "danger", type: "submit" });
    const offForm = h(
      "form",
      { class: "stack-sm" },
      errors.el,
      recovering ? null : field("Confirm with your password", pw),
      h("div", null, off),
    );
    offForm.addEventListener("submit", (e) => {
      e.preventDefault();
      void busy(
        off,
        async () => {
          await post("/auth/totp/disable", recovering ? {} : { password: pw.value });
          toast(required ? "Authenticator removed. Set up a new one to continue." : "Two-step sign-in is off", "success");
          await ctx.reload();
        },
        errors,
      );
    });
    totpBody = h(
      "div",
      { class: "card-body stack" },
      h("div", { class: "row" }, badge("On", "success", true), h("span", { class: "small muted" }, "You'll be asked for a code from your authenticator app when you sign in.")),
      required && !recovering
        ? h("p", { class: "small muted" }, "The owner requires two-step sign-in, so it can't be turned off. Lost your authenticator? Ask for a recovery link.")
        : h("div", { class: "stack-sm" }, recovering ? h("p", { class: "small" }, "Lost your authenticator? Remove it here, then set up a new one.") : null, offForm),
    );
  } else {
    totpBody = h(
      "div",
      { class: "card-body stack" },
      h("div", { class: "row" }, badge("Off"), h("span", { class: "small muted" }, "Add a code from an authenticator app to your sign-in.")),
      totpEnrollment({ onDone: () => ctx.reload() }),
    );
  }

  return h(
    "div",
    null,
    pageHeader("Your account"),
    h(
      "div",
      { class: "stack" },
      cardWith(
        "Profile",
        null,
        h(
          "div",
          { class: "card-body row", style: { alignItems: "flex-start", gap: "20px" } },
          avatar(op, "sm"),
          kv([
            ["Name", op.name],
            ["Email", op.email],
            ["Role", op.role.charAt(0).toUpperCase() + op.role.slice(1)],
            ["Apps", op.app_ids ? op.app_ids.join(", ") : "All apps"],
            ["Theme", themeToggle()],
          ]),
        ),
      ),
      cardWith("Password", "Changing it signs you out everywhere else.", pwForm),
      cardWith("Two-step sign-in", null, totpBody),
    ),
  );
}
