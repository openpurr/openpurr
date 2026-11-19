// Screens outside the dashboard shell: sign-in, setup and recovery links, choosing a password,
// setting up two-step sign-in, and the "not configured yet" notice.
import qrcode from "../vendor/qrcode.js";
import { post } from "./api.js";
import { h, replace } from "./dom.js";
import { brand, button, busy, copy, copyField, field, formError, input } from "./ui.js";

const PASSWORD_MIN = 12;

function screen(root, card) {
  replace(root, h("main", { class: "auth-screen" }, card));
  card.querySelector("input")?.focus();
}

const cardHead = (title, sub) => [h("div", { class: "auth-brand" }, brand()), h("h1", { class: "auth-title" }, title), sub ? h("p", { class: "auth-sub" }, sub) : null];

// ---- Sign in ------------------------------------------------------------------------------------

/** onSignedIn(result) gets the /auth/login response. */
export function renderLogin(root, { onSignedIn, notice }) {
  const errors = formError();
  let creds = null;

  const passwordStep = () => {
    const email = input({ type: "email", autocomplete: "username", required: true, placeholder: "you@example.com", value: creds?.email ?? "" });
    const password = input({ type: "password", autocomplete: "current-password", required: true });
    const submit = button("Sign in", { type: "submit", block: true });
    const form = h(
      "form",
      { class: "auth-card" },
      cardHead("Sign in", notice ?? "Use the email and password for this openpurr deployment."),
      h("div", { class: "stack" }, errors.el, h("div", null, field("Email", email), field("Password", password)), submit),
      h(
        "p",
        { class: "auth-foot" },
        "Forgot your password? Whoever runs this deployment can send you a one-time link: ",
        h("code", null, "pnpm admin login-link --email …"),
      ),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      creds = { email: email.value.trim(), password: password.value };
      void busy(submit, () => attempt({}), errors);
    });
    screen(root, form);
  };

  const codeStep = (useRecovery = false) => {
    const code = useRecovery
      ? input({ autocomplete: "off", required: true, placeholder: "xxxxx-xxxxx", mono: true, spellcheck: "false" })
      : input({ inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9 ]{6,7}", maxlength: 7, required: true, placeholder: "123456", mono: true });
    const submit = button("Verify", { type: "submit", block: true });
    const form = h(
      "form",
      { class: "auth-card" },
      cardHead(
        "Two-step sign-in",
        useRecovery ? "Enter one of the recovery codes you saved when you set up two-step sign-in. Each works once." : "Enter the 6-digit code from your authenticator app.",
      ),
      h("div", { class: "stack" }, errors.el, field(useRecovery ? "Recovery code" : "Code", code), submit),
      h(
        "p",
        { class: "auth-foot" },
        h("button", { type: "button", class: "link-btn", onClick: () => (errors.clear(), codeStep(!useRecovery)) }, useRecovery ? "Use your authenticator app instead" : "Lost your authenticator? Use a recovery code"),
        " · ",
        h("button", { type: "button", class: "link-btn", onClick: () => (errors.clear(), passwordStep()) }, "Start over"),
      ),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = code.value.trim();
      void busy(submit, () => attempt(useRecovery ? { recovery_code: value } : { code: value.replace(/\s/g, "") }), errors);
    });
    screen(root, form);
  };

  const attempt = async (second) => {
    try {
      const result = await post("/auth/login", { ...creds, ...second });
      creds = null;
      onSignedIn(result);
    } catch (err) {
      if (err.code === "totp_required") return codeStep(false);
      throw err;
    }
  };

  passwordStep();
}

// ---- Links --------------------------------------------------------------------------------------

/** Redeems /admin/link#token=… The token is removed from the address bar straight away. */
export async function renderLink(root, { onSetup, onRecovery, toSignIn }) {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(null, "", "/admin/link");
  const problem = (message) =>
    screen(
      root,
      h("div", { class: "auth-card" }, cardHead("This link didn't work", message), button("Go to sign in", { variant: "outline", block: true, onClick: toSignIn })),
    );
  if (!token) return problem("The link is incomplete, or it was already opened in this tab. Links work once; ask for a new one if you need it.");
  screen(root, h("div", { class: "auth-card" }, cardHead("Checking your link…")));
  try {
    const result = await post("/auth/link", { token });
    if (result.session === "setup") onSetup(result.operator);
    else onRecovery(result.operator);
  } catch (err) {
    problem(err.message);
  }
}

// ---- Password -----------------------------------------------------------------------------------

/** A password + confirmation form body; returns { el, value() } and validates on value(). */
export function newPasswordFields() {
  const pw = input({ type: "password", autocomplete: "new-password", required: true, minlength: PASSWORD_MIN, maxlength: 128 });
  const again = input({ type: "password", autocomplete: "new-password", required: true });
  return {
    el: h("div", null, field("New password", pw, `At least ${PASSWORD_MIN} characters. A passphrase or a password manager works well.`), field("Confirm password", again)),
    value() {
      if (pw.value.length < PASSWORD_MIN) throw new Error(`Use at least ${PASSWORD_MIN} characters.`);
      if (pw.value !== again.value) throw new Error("The passwords don't match.");
      return pw.value;
    },
  };
}

/** First password, from a setup link. onDone(result of /auth/password). */
export function renderSetPassword(root, { operator, onDone }) {
  const errors = formError();
  const fields = newPasswordFields();
  const submit = button("Set password and continue", { type: "submit", block: true });
  const form = h(
    "form",
    { class: "auth-card" },
    cardHead(`Welcome, ${operator.name || operator.email}`, `Choose a password for ${operator.email}. This page stays valid for 30 minutes.`),
    h("div", { class: "stack" }, errors.el, fields.el, submit),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(submit, async () => onDone(await post("/auth/password", { new_password: fields.value() })), errors);
  });
  screen(root, form);
}

// ---- Two-step sign-in setup ---------------------------------------------------------------------

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n + quiet * 2} ${n + quiet * 2}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code for your authenticator app");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(path);
  return svg;
}

/**
 * The enrollment flow as a block of content: start → scan + confirm a code → recovery codes.
 * onDone() runs after the operator has seen the recovery codes.
 */
export function totpEnrollment({ onDone, startLabel = "Set up two-step sign-in" }) {
  const el = h("div", { class: "stack" });
  const errors = formError();

  const start = () => {
    const go = button(startLabel, { onClick: () => busy(go, async () => scan(await post("/auth/totp/setup")), errors) });
    replace(
      el,
      h("p", { class: "small muted" }, "You'll need an authenticator app, such as 1Password, Google Authenticator, Microsoft Authenticator or Authy."),
      errors.el,
      h("div", null, go),
    );
  };

  const scan = ({ secret, otpauth_uri }) => {
    const code = input({ inputmode: "numeric", autocomplete: "one-time-code", maxlength: 7, required: true, placeholder: "123456", mono: true });
    const confirm = button("Turn on two-step sign-in", { type: "submit" });
    const form = h(
      "form",
      { class: "stack" },
      h(
        "div",
        { class: "enroll-grid" },
        h("div", { class: "qr" }, qrSvg(otpauth_uri)),
        h(
          "div",
          { class: "stack-sm" },
          h("p", { class: "small" }, "1. Scan the QR code with your authenticator app."),
          h("p", { class: "small muted" }, "Can't scan it? Enter this key instead:"),
          copyField(secret.replace(/(.{4})/g, "$1 ").trim()),
          h("p", { class: "small" }, "2. Enter the 6-digit code the app shows."),
          field("Code", code),
        ),
      ),
      errors.el,
      h("div", { class: "row" }, confirm, button("Cancel", { variant: "ghost", onClick: () => (errors.clear(), start()) })),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void busy(confirm, async () => codes((await post("/auth/totp/enable", { code: code.value.replace(/\s/g, "") })).recovery_codes), errors);
    });
    replace(el, form);
    code.focus();
  };

  const codes = (recovery) => {
    const all = recovery.join("\n");
    replace(
      el,
      h("p", { class: "small" }, h("strong", null, "Two-step sign-in is on. "), "Save these recovery codes somewhere safe, such as your password manager. Each one works once in place of an authenticator code. They won't be shown again."),
      h("div", { class: "code recovery-codes" }, recovery.map((c) => h("span", null, c))),
      h(
        "div",
        { class: "row" },
        button("Copy codes", { variant: "outline", onClick: () => copy(all) }),
        button("Download", {
          variant: "outline",
          onClick: () => {
            const a = h("a", { href: URL.createObjectURL(new Blob([`openpurr recovery codes (${location.host})\n\n${all}\n`], { type: "text/plain" })), download: "openpurr-recovery-codes.txt" });
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
        }),
        h("span", { class: "spacer" }),
        button("I've saved them", { onClick: onDone }),
      ),
    );
  };

  start();
  return el;
}

/** Full-screen enrollment, when the owner requires two-step sign-in for everyone. */
export function renderRequiredEnrollment(root, { operator, onDone, onSignOut }) {
  screen(
    root,
    h(
      "div",
      { class: "auth-card wide" },
      cardHead("Set up two-step sign-in", `This deployment requires two-step sign-in for everyone. Set it up for ${operator.email} to continue.`),
      totpEnrollment({ onDone, startLabel: "Start" }),
      h("p", { class: "auth-foot" }, h("button", { type: "button", class: "link-btn", onClick: onSignOut }, "Sign out")),
    ),
  );
}

// ---- Not configured -----------------------------------------------------------------------------

export function renderNotConfigured(root, message) {
  screen(
    root,
    h(
      "div",
      { class: "auth-card wide" },
      cardHead("Finish setting up the back office", message),
      h("p", { class: "small muted" }, "Set the secret on the back-office Worker, then create the first owner:"),
      h("pre", { class: "code mt" }, "openssl rand -base64 48 | npx wrangler secret put OPERATOR_SECRET --env office\npnpm admin create --email you@example.com --url " + location.origin),
    ),
  );
}
