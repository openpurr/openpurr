// Screens outside the dashboard shell: sign-in, setup and recovery links, choosing a password,
// setting up two-step sign-in, and the "not configured yet" notice.
import qrcode from "../vendor/qrcode.js";
import { post } from "./api.js";
import { h, replace } from "./dom.js";
import { isLite, setEdition } from "./edition.js";
import { t, tx } from "./i18n.js";
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
    const submit = button(t("Sign in"), { type: "submit", block: true });
    const form = h(
      "form",
      { class: "auth-card" },
      cardHead(t("Sign in"), notice ?? t("Use the email and password for this openpurr deployment.")),
      h("div", { class: "stack" }, errors.el, h("div", null, field(t("Email"), email), field(t("Password"), password)), submit),
      h(
        "p",
        { class: "auth-foot" },
        tx("Forgot your password? Whoever runs this deployment can send you a one-time link: {cmd}", { cmd: h("code", null, `${isLite() ? "pnpm" : "openpurr"} admin login-link --email …`) }),
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
    const submit = button(t("Verify"), { type: "submit", block: true });
    const form = h(
      "form",
      { class: "auth-card" },
      cardHead(
        t("Two-step sign-in"),
        useRecovery ? t("Enter one of the recovery codes you saved when you set up two-step sign-in. Each works once.") : t("Enter the 6-digit code from your authenticator app."),
      ),
      h("div", { class: "stack" }, errors.el, field(useRecovery ? t("Recovery code") : t("Code"), code), submit),
      h(
        "p",
        { class: "auth-foot" },
        h("button", { type: "button", class: "link-btn", onClick: () => (errors.clear(), codeStep(!useRecovery)) }, useRecovery ? t("Use your authenticator app instead") : t("Lost your authenticator? Use a recovery code")),
        " · ",
        h("button", { type: "button", class: "link-btn", onClick: () => (errors.clear(), passwordStep()) }, t("Start over")),
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
      h("div", { class: "auth-card" }, cardHead(t("This link didn't work"), message), button(t("Go to sign in"), { variant: "outline", block: true, onClick: toSignIn })),
    );
  if (!token) return problem(t("The link is incomplete, or it was already opened in this tab. Links work once; ask for a new one if you need it."));
  screen(root, h("div", { class: "auth-card" }, cardHead(t("Checking your link…"))));
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
    el: h("div", null, field(t("New password"), pw, t("At least {n} characters. A passphrase or a password manager works well.", { n: PASSWORD_MIN })), field(t("Confirm password"), again)),
    value() {
      if (pw.value.length < PASSWORD_MIN) throw new Error(t("Use at least {n} characters.", { n: PASSWORD_MIN }));
      if (pw.value !== again.value) throw new Error(t("The passwords don't match."));
      return pw.value;
    },
  };
}

/** First password, from a setup link. onDone(result of /auth/password). */
export function renderSetPassword(root, { operator, onDone }) {
  const errors = formError();
  const fields = newPasswordFields();
  const submit = button(t("Set password and continue"), { type: "submit", block: true });
  const form = h(
    "form",
    { class: "auth-card" },
    cardHead(t("Welcome, {name}", { name: operator.name || operator.email }), t("Choose a password for {email}. This page stays valid for 30 minutes.", { email: operator.email })),
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
  svg.setAttribute("aria-label", t("QR code for your authenticator app"));
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
export function totpEnrollment({ onDone, startLabel = t("Set up two-step sign-in") }) {
  const el = h("div", { class: "stack" });
  const errors = formError();

  const start = () => {
    const go = button(startLabel, { onClick: () => busy(go, async () => scan(await post("/auth/totp/setup")), errors) });
    replace(
      el,
      h("p", { class: "small muted" }, t("You'll need an authenticator app, such as 1Password, Google Authenticator, Microsoft Authenticator or Authy.")),
      errors.el,
      h("div", null, go),
    );
  };

  const scan = ({ secret, otpauth_uri }) => {
    const code = input({ inputmode: "numeric", autocomplete: "one-time-code", maxlength: 7, required: true, placeholder: "123456", mono: true });
    const confirm = button(t("Turn on two-step sign-in"), { type: "submit" });
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
          h("p", { class: "small" }, t("1. Scan the QR code with your authenticator app.")),
          h("p", { class: "small muted" }, t("Can't scan it? Enter this key instead:")),
          copyField(secret.replace(/(.{4})/g, "$1 ").trim()),
          h("p", { class: "small" }, t("2. Enter the 6-digit code the app shows.")),
          field(t("Code"), code),
        ),
      ),
      errors.el,
      h("div", { class: "row" }, confirm, button(t("Cancel"), { variant: "ghost", onClick: () => (errors.clear(), start()) })),
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
      h("p", { class: "small" }, h("strong", null, t("Two-step sign-in is on.")), " ", t("Save these recovery codes somewhere safe, such as your password manager. Each one works once in place of an authenticator code. They won't be shown again.")),
      h("div", { class: "code recovery-codes" }, recovery.map((c) => h("span", null, c))),
      h(
        "div",
        { class: "row" },
        button(t("Copy codes"), { variant: "outline", onClick: () => copy(all) }),
        button(t("Download"), {
          variant: "outline",
          onClick: () => {
            const a = h("a", { href: URL.createObjectURL(new Blob([`openpurr recovery codes (${location.host})\n\n${all}\n`], { type: "text/plain" })), download: "openpurr-recovery-codes.txt" });
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
        }),
        h("span", { class: "spacer" }),
        button(t("I've saved them"), { onClick: onDone }),
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
      cardHead(t("Set up two-step sign-in"), t("This deployment requires two-step sign-in for everyone. Set it up for {email} to continue.", { email: operator.email })),
      totpEnrollment({ onDone, startLabel: t("Start") }),
      h("p", { class: "auth-foot" }, h("button", { type: "button", class: "link-btn", onClick: onSignOut }, t("Sign out"))),
    ),
  );
}

// ---- Not configured -----------------------------------------------------------------------------

// Lite's message names "the Worker secret OPERATOR_SECRET"; Standard's, the server's own.
export function renderNotConfigured(root, message) {
  setEdition(/\bWorker\b/.test(message ?? "Worker") ? "lite" : "standard");
  screen(
    root,
    h(
      "div",
      { class: "auth-card wide" },
      cardHead(t("Finish setting up the back office"), message),
      isLite()
        ? [
            h("p", { class: "small muted" }, t("Set the secret on the back-office Worker, then create the first owner:")),
            h("pre", { class: "code mt" }, "openssl rand -base64 48 | npx wrangler secret put OPERATOR_SECRET --env office\npnpm admin create --email you@example.com --url " + location.origin),
          ]
        : [
            h("p", { class: "small muted" }, t("Set the secret in the server's environment and restart it, then create the first owner:")),
            h("pre", { class: "code mt" }, "openpurr admin create --email you@example.com --url " + location.origin),
          ],
    ),
  );
}
