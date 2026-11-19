// Shared UI pieces: buttons, badges, tables, forms, modals, toasts, the theme switcher.
import { append, h, replace } from "./dom.js";
import { IconAlert, IconCheck, IconCopy, IconMonitor, IconMoon, IconSun } from "./icons.js";

// ---- Formatting ---------------------------------------------------------------------------------

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const fmtDateTime = (ms) => (ms ? dateTime.format(new Date(ms)) : "—");
export const fmtDate = (ms) => (ms ? dateOnly.format(new Date(ms)) : "—");

export function fmtRelative(ms) {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const s = mins < 60 ? `${mins}m` : hours < 24 ? `${hours}h` : `${days}d`;
  return diff < 0 ? `in ${s}` : `${s} ago`;
}

/** A timestamp shown relative, with the exact time on hover. */
export const when = (ms) => h("span", { title: ms ? fmtDateTime(ms) : null }, fmtRelative(ms));

export function initials(name, email) {
  const src = (name && name.trim()) || email || "?";
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src.slice(0, 2).toUpperCase();
}

export const avatar = (op, size = "md") => h("span", { class: `avatar avatar-${size}`, "aria-hidden": "true" }, initials(op.name, op.email));

// ---- Primitives ---------------------------------------------------------------------------------

/** variant: primary (default) | outline | ghost | danger. size: "sm". */
export function button(label, { variant = "primary", size, icon, onClick, type = "button", disabled, title, block } = {}) {
  const cls = ["btn"];
  if (variant !== "primary") cls.push(`btn-${variant}`);
  if (size === "sm") cls.push("btn-sm");
  if (!label) cls.push("btn-icon");
  if (block) cls.push("btn-block");
  return h("button", { class: cls.join(" "), type, onClick, disabled, title, "aria-label": !label ? title : null }, icon ?? null, label ?? null);
}

export const badge = (text, variant = "", dot = false) => h("span", { class: `badge ${variant} ${dot ? "has-dot" : ""}`.trim() }, text);

export function pageHeader(title, sub, actions = []) {
  return h(
    "div",
    { class: "page-header" },
    h("div", null, h("h1", { class: "page-title" }, title), sub ? h("p", { class: "page-sub" }, sub) : null),
    actions.length ? h("div", { class: "actions" }, actions) : null,
  );
}

export function breadcrumb(items) {
  const nav = h("nav", { class: "breadcrumb", "aria-label": "Breadcrumb" });
  items.forEach((item, i) => {
    if (i) nav.append(h("span", { class: "crumb-sep" }, "/"));
    nav.append(item.href ? h("a", { href: item.href, "data-nav": "" }, item.label) : h("span", { class: "crumb-current" }, item.label));
  });
  return nav;
}

export function empty({ icon, title, text, action }) {
  return h("div", { class: "empty" }, icon ? h("div", { class: "empty-icon" }, icon(28)) : null, h("h3", null, title), text ? h("p", null, text) : null, action ? h("div", { class: "mt" }, action) : null);
}

export function errorCard(err, retry) {
  return h(
    "div",
    { class: "card" },
    empty({ icon: IconAlert, title: "Couldn't load this page", text: err?.message ?? String(err), action: retry ? button("Try again", { variant: "outline", onClick: retry }) : null }),
  );
}

/**
 * A table. columns: [{ label, class }]. rows: arrays of cells (strings or nodes), or
 * { cells, onClick } for clickable rows.
 */
export function table(columns, rows) {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table" },
      h("thead", null, h("tr", null, columns.map((c) => h("th", { class: c.class ?? null, scope: "col" }, c.label)))),
      h(
        "tbody",
        null,
        rows.map((row) => {
          const cells = Array.isArray(row) ? row : row.cells;
          const tr = h("tr", { class: row.onClick ? "clickable" : null, onClick: row.onClick ?? null });
          cells.forEach((cell, i) => tr.append(append(h("td", { class: columns[i]?.class ?? null }), [cell])));
          return tr;
        }),
      ),
    ),
  );
}

export function cardWith(title, sub, body, actions = []) {
  return h(
    "section",
    { class: "card card-tight" },
    h("div", { class: "card-header" }, h("div", { class: "cell-stack" }, h("h2", { class: "card-title" }, title), sub ? h("p", { class: "card-sub" }, sub) : null), actions.length ? h("div", { class: "actions" }, actions) : null),
    body,
  );
}

export function kv(pairs) {
  const dl = h("dl", { class: "kv" });
  for (const [k, v] of pairs) if (v !== undefined) dl.append(h("dt", null, k), append(h("dd"), [v ?? "—"]));
  return dl;
}

// ---- Forms --------------------------------------------------------------------------------------

let fieldIds = 0;
export function field(label, control, hint) {
  const id = control.id || `f${++fieldIds}`;
  control.id = id;
  return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), control, hint ? h("p", { class: "field-hint" }, hint) : null);
}

export const input = (props = {}) => h("input", { class: `input ${props.mono ? "mono" : ""}`.trim(), type: "text", ...props, mono: null });

export function select(options, value) {
  return h(
    "select",
    { class: "select" },
    options.map((o) => h("option", { value: o.value, selected: o.value === value ? true : null }, o.label)),
  );
}

/** Checkboxes; returns { el, values() }. */
export function checkboxes(options, checked = []) {
  const boxes = options.map((o) => h("input", { type: "checkbox", value: o.value, checked: checked.includes(o.value) }));
  const el = h(
    "div",
    { class: "checks" },
    options.map((o, i) => h("label", { class: "check" }, boxes[i], h("span", null, o.label, o.sub ? h("span", { class: "check-sub" }, o.sub) : null))),
  );
  return { el, values: () => boxes.filter((b) => b.checked).map((b) => b.value) };
}

/** A form-level error area: show(err) / clear(). */
export function formError() {
  const el = h("div", { class: "form-error", role: "alert", hidden: true });
  return {
    el,
    show(err) {
      el.textContent = err?.message ?? String(err);
      el.hidden = false;
    },
    clear() {
      el.hidden = true;
    },
  };
}

/** Runs fn with the button disabled; reports errors to `errors` (a formError) or a toast. */
export async function busy(btn, fn, errors) {
  btn.disabled = true;
  errors?.clear();
  try {
    return await fn();
  } catch (err) {
    if (errors) errors.show(err);
    else toast(err.message, "error");
    return undefined;
  } finally {
    btn.disabled = false;
  }
}

export function toggle({ checked, label, onChange, disabled }) {
  const el = h(
    "button",
    { type: "button", role: "switch", class: "toggle", "aria-checked": String(!!checked), disabled },
    h("span", { class: "toggle-track" }, h("span", { class: "toggle-thumb" })),
    label ? h("span", { class: "small" }, label) : null,
  );
  el.addEventListener("click", async () => {
    const next = el.getAttribute("aria-checked") !== "true";
    el.disabled = true;
    try {
      if ((await onChange(next)) !== false) el.setAttribute("aria-checked", String(next));
    } finally {
      el.disabled = !!disabled;
    }
  });
  return el;
}

export function seg(options, value, onChange) {
  const el = h("div", { class: "seg", role: "group" });
  const render = (current) =>
    replace(
      el,
      options.map((o) =>
        h("button", { type: "button", class: "seg-opt", "data-active": String(o.value === current), "aria-pressed": String(o.value === current), onClick: () => (render(o.value), onChange(o.value)) }, o.label),
      ),
    );
  render(value);
  return el;
}

// ---- Copy, secrets ------------------------------------------------------------------------------

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", "success");
  } catch {
    toast("Couldn't copy. Select the text and copy it yourself.", "error");
  }
}

/** A value in a mono block with a copy button. */
export function copyField(value) {
  return h("div", { class: "copy-field" }, h("code", { class: "code" }, value), button(null, { variant: "outline", icon: IconCopy(15), title: "Copy", onClick: () => copy(value) }));
}

// ---- Toasts -------------------------------------------------------------------------------------

export function toast(message, kind = "info") {
  let host = document.querySelector(".toasts");
  if (!host) host = document.body.appendChild(h("div", { class: "toasts", role: "status", "aria-live": "polite" }));
  const el = h("div", { class: `toast ${kind}` }, kind === "error" ? IconAlert(15) : kind === "success" ? IconCheck(15) : null, h("span", null, message));
  host.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 2600);
}

// ---- Modals -------------------------------------------------------------------------------------

/**
 * Opens a modal. body: nodes. actions: buttons (a button with type=submit submits the form).
 * onSubmit runs on submit; return false to keep the modal open.
 */
export function modal({ title, sub, body, actions, onSubmit, dismissable = true }) {
  const previous = document.activeElement;
  const form = h("form", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": title });
  append(form, [h("h2", { class: "modal-title" }, title), sub ? h("p", { class: "modal-sub" }, sub) : h("div", { class: "modal-sub" }), body, h("div", { class: "modal-actions" }, actions)]);
  const backdrop = h("div", { class: "modal-backdrop" }, form);
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    previous?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape" && dismissable) close();
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (onSubmit && (await onSubmit()) === false) return;
    close();
  });
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop && dismissable) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  (form.querySelector("input, select, textarea") ?? form.querySelector("button"))?.focus();
  return { close, form };
}

/** Resolves true when confirmed. */
export function confirmDialog({ title, text, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) (done = true), resolve(v);
    };
    const cancel = button("Cancel", { variant: "outline", onClick: () => (finish(false), m.close()) });
    const ok = button(confirmLabel, { variant: danger ? "danger" : "primary", type: "submit" });
    const m = modal({ title, sub: text, body: null, actions: [cancel, ok], onSubmit: () => finish(true) });
    const observer = new MutationObserver(() => {
      if (!m.form.isConnected) (observer.disconnect(), finish(false));
    });
    observer.observe(document.body, { childList: true });
  });
}

/** Shows a secret once, with a copy button. */
export function showSecretOnce({ title, sub, value, note }) {
  modal({
    title,
    sub,
    body: h("div", { class: "stack-sm" }, copyField(value), note ? h("p", { class: "small muted" }, note) : null),
    actions: [button("Done", { type: "submit" })],
    dismissable: false,
  });
}

// ---- Theme --------------------------------------------------------------------------------------

const THEME_KEY = "openpurr_theme";
const DARK = "(prefers-color-scheme: dark)";

export function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export const resolveTheme = (choice) => (choice === "auto" ? (matchMedia(DARK).matches ? "dark" : "light") : choice);

export function applyTheme(choice = storedTheme()) {
  document.documentElement.setAttribute("data-theme", resolveTheme(choice));
}

matchMedia(DARK).addEventListener("change", () => storedTheme() === "auto" && applyTheme("auto"));

export function themeToggle() {
  const options = [
    { value: "light", label: "Light", icon: IconSun },
    { value: "dark", label: "Dark", icon: IconMoon },
    { value: "auto", label: "Match system", icon: IconMonitor },
  ];
  const el = h("div", { class: "seg theme-toggle", role: "group", "aria-label": "Theme" });
  const render = () => {
    const current = storedTheme();
    replace(
      el,
      options.map((o) =>
        h(
          "button",
          {
            type: "button",
            class: "seg-opt",
            "data-active": String(current === o.value),
            "aria-pressed": String(current === o.value),
            title: o.label,
            "aria-label": o.label,
            onClick: () => {
              try {
                localStorage.setItem(THEME_KEY, o.value);
              } catch {
                /* private browsing */
              }
              applyTheme(o.value);
              render();
            },
          },
          o.icon(14),
        ),
      ),
    );
  };
  render();
  return el;
}

// ---- Brand --------------------------------------------------------------------------------------

export const brand = () =>
  h("span", { class: "row", style: { gap: "10px" } }, h("img", { class: "brand-mark", src: "/mark.png", alt: "" }), h("span", { class: "brand-word" }, "openpurr"));
