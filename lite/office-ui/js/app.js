// The openpurr dashboard: sign-in, then a sidebar shell whose pages call the admin API.
// Plain ES modules, no build step. Pages live under /admin/…; the Worker answers every unknown
// page path with index.html, and this file routes it.
import { get, onAuthChange, post, setProject } from "./api.js";
import { renderLink, renderLogin, renderNotConfigured, renderRequiredEnrollment, renderSetPassword } from "./auth.js";
import { renderConsent } from "./consent.js";
import { h, replace } from "./dom.js";
import { IconAlert, IconApps, IconBolt, IconChart, IconCustomers, IconFolder, IconGift, IconInfo, IconKey, IconLogOut, IconMenu, IconSettings, IconShield, IconTag, IconTerminal, IconUser, IconUsers, IconX } from "./icons.js";
import { accountPage } from "./pages/account.js";
import { auditPage, settingsPage, teamPage } from "./pages/admin.js";
import { chartPage, chartsPage } from "./pages/charts.js";
import { appsPage, entitlementsPage, offeringsPage, projectsPage } from "./pages/config.js";
import { customerPage, customersPage } from "./pages/customers.js";
import { secretKeysPage, tokensPage, webhooksPage } from "./pages/developers.js";
import { applyTheme, avatar, brand, empty, errorCard } from "./ui.js";

const root = document.getElementById("app");

// Sidebar sections. `perm` hides an item from operators without that permission (the API enforces
// it either way).
const ROUTES = [
  { key: "charts", label: "Charts", icon: IconChart, section: "Overview", perm: "read", page: chartsPage },
  { key: "customers", label: "Customers", icon: IconCustomers, section: "Overview", perm: "read", page: customersPage },
  { key: "apps", label: "Apps and products", icon: IconApps, section: "Configuration", perm: "read", page: appsPage },
  { key: "entitlements", label: "Entitlements", icon: IconTag, section: "Configuration", perm: "read", page: entitlementsPage },
  { key: "offerings", label: "Offerings", icon: IconGift, section: "Configuration", perm: "read", page: offeringsPage },
  { key: "projects", label: "Projects", icon: IconFolder, section: "Configuration", perm: "read", page: projectsPage },
  { key: "webhooks", label: "Webhooks", icon: IconBolt, section: "Developers", perm: "read", page: webhooksPage },
  { key: "secret-keys", label: "Secret keys", icon: IconKey, section: "Developers", perm: "keys:manage", page: secretKeysPage },
  { key: "tokens", label: "Access tokens", icon: IconTerminal, section: "Developers", page: tokensPage },
  { key: "team", label: "Team", icon: IconUsers, section: "Admin", perm: "read", page: teamPage },
  { key: "audit", label: "Audit log", icon: IconShield, section: "Admin", perm: "audit:read", page: auditPage },
  { key: "settings", label: "Settings", icon: IconSettings, section: "Admin", perm: "read", page: settingsPage },
  { key: "account", label: "Your account", icon: IconUser, page: accountPage, hidden: true },
];

/**
 * Signed-in state: { session, operator, permissions, projects, project, apps, allApps }. `project`
 * is the project being shown (null before the first one exists); `apps` are its apps.
 */
let state = null;
let returnTo = null;
let renderSeq = 0;
let shell = null;
let shownPage = null;

const can = (perm) => !perm || state.permissions.has(perm);

function parsePath() {
  const parts = location.pathname.replace(/^\/admin\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  // Before the first app exists, the dashboard opens on adding it.
  const home = state.allApps.length || !can("config:manage") ? "charts" : "apps";
  const route = ROUTES.find((r) => r.key === (parts[0] ?? home));
  return { route, rest: parts.slice(1) };
}

export function navigate(path, { replace: replaceEntry = false } = {}) {
  if (path !== location.pathname + location.search) history[replaceEntry ? "replaceState" : "pushState"](null, "", path);
  if (state) renderRoute();
  else void boot();
}

// In-app links: <a href="/admin/…" data-nav>. Modified clicks (new tab) are left to the browser.
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[data-nav]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
addEventListener("popstate", () => (state && location.pathname.startsWith("/admin") && !["/admin/login", "/admin/link"].includes(location.pathname) ? renderRoute() : boot()));

onAuthChange(
  () => showLogin("Your session ended. Sign in again to continue."),
  () => boot(),
);

// ---- Boot ---------------------------------------------------------------------------------------

async function boot() {
  applyTheme();
  state = null;
  shell = null;
  const path = location.pathname;
  if (!path.startsWith("/admin")) return navigate("/admin", { replace: true });
  if (path === "/admin/link") {
    return renderLink(root, {
      onSetup: (operator) => renderSetPassword(root, { operator, onDone: () => navigate("/admin", { replace: true }) }),
      onRecovery: () => navigate("/admin/account", { replace: true }),
      toSignIn: () => navigate("/admin/login", { replace: true }),
    });
  }

  let me;
  try {
    me = await get("/auth/me");
  } catch (err) {
    if (err.code === "not_configured") return renderNotConfigured(root, err.message);
    if (err.status === 401) return showLogin();
    return fatal(err);
  }
  if (me.session === "setup") return renderSetPassword(root, { operator: me.operator, onDone: () => boot() });
  if (me.totp_enrollment_required) {
    return renderRequiredEnrollment(root, { operator: me.operator, onDone: () => boot(), onSignOut: signOut });
  }

  let principal, apps, projects;
  try {
    [principal, { apps }, { projects }] = await Promise.all([get("/me"), get("/apps").catch(() => ({ apps: [] })), get("/projects").catch(() => ({ projects: [] }))]);
  } catch (err) {
    return fatal(err);
  }
  state = { session: me.session, operator: principal.operator, permissions: new Set(principal.permissions), projects, allApps: apps, project: null, apps: [] };
  selectProject(new URLSearchParams(location.search).get("project") ?? storedProject(), { quiet: true });
  if (path === "/admin/login") history.replaceState(null, "", returnTo ?? "/admin");
  returnTo = null;
  // An app asking to connect (OAuth): its own screen, outside the dashboard shell.
  if (location.pathname === "/admin/oauth/consent") {
    shell = null;
    document.title = "Connect an app · openpurr";
    return renderConsent(root, state.operator);
  }
  renderRoute();
}

// ---- Projects -----------------------------------------------------------------------------------

const PROJECT_KEY = "openpurr_project";

function storedProject() {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

/** Shows a project: its customers, charts, keys and configuration. Unknown IDs fall back to the first project. */
function selectProject(id, { quiet = false } = {}) {
  const project = state.projects.find((p) => p.id === id) ?? state.projects[0] ?? null;
  const changed = project?.id !== state.project?.id;
  state.project = project;
  state.apps = project ? state.allApps.filter((a) => a.project_id === project.id) : [];
  setProject(project?.id ?? null);
  try {
    // Remembers a project that was just created, too: the next load (which knows it) shows it.
    const remember = quiet ? project?.id : (id ?? project?.id);
    if (remember) localStorage.setItem(PROJECT_KEY, remember);
  } catch {
    /* private browsing */
  }
  if (!quiet && changed && shell) {
    shell = null; // the sidebar shows the project
    // A customer belongs to one project; their page doesn't carry over.
    if (/^\/admin\/customers\/./.test(location.pathname)) history.replaceState(null, "", "/admin/customers");
    renderRoute();
  }
}

function projectSwitcher() {
  if (state.projects.length < 2) return null;
  const s = h(
    "select",
    { class: "select project-select", "aria-label": "Project" },
    state.projects.map((p) => h("option", { value: p.id, selected: p.id === state.project?.id ? true : null }, p.name)),
  );
  s.addEventListener("change", () => selectProject(s.value));
  return h("div", { class: "project-switcher" }, h("span", { class: "nav-label" }, "Project"), s);
}

function showLogin(notice) {
  state = null;
  shell = null;
  if (location.pathname !== "/admin/login") {
    returnTo = location.pathname.startsWith("/admin") ? location.pathname + location.search : null;
    history.pushState(null, "", "/admin/login");
  }
  document.title = "Sign in · openpurr";
  renderLogin(root, { notice, onSignedIn: () => boot() });
}

async function signOut() {
  await post("/auth/logout").catch(() => {});
  returnTo = null;
  showLogin("You're signed out.");
}

function fatal(err) {
  replace(root, h("main", { class: "auth-screen" }, h("div", { class: "auth-card" }, errorCard(err, () => boot()))));
}

// ---- Shell --------------------------------------------------------------------------------------

function accountMenu() {
  const op = state.operator;
  const menu = h(
    "div",
    { class: "account-menu", role: "menu", hidden: true },
    h("div", { class: "account-menu-head" }, avatar(op, "sm"), h("div", { class: "cell-stack" }, h("span", { class: "cell-strong ellipsis" }, op.name), h("span", { class: "cell-sub ellipsis" }, `${op.email} · ${op.role}`))),
    h("a", { class: "account-menu-item", role: "menuitem", href: "/admin/account", "data-nav": "" }, IconUser(15), "Your account"),
    h("div", { class: "account-menu-divider" }),
    h("button", { class: "account-menu-item", role: "menuitem", type: "button", onClick: signOut }, IconLogOut(15), "Sign out"),
  );
  const trigger = h("button", { class: "nav-item", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, avatar(op, "nav"), h("span", { class: "nav-text" }, op.name));
  const wrap = h("div", { class: "account-menu-wrap" }, menu, trigger);
  const set = (open) => {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  };
  wrap.addEventListener("mouseenter", () => set(true));
  wrap.addEventListener("mouseleave", () => set(false));
  trigger.addEventListener("click", () => set(menu.hidden));
  menu.addEventListener("click", () => set(false));
  return wrap;
}

function buildShell() {
  shownPage = null;
  const nav = h("nav", { "aria-label": "Main" });
  let section = null;
  let group = null;
  for (const r of ROUTES) {
    if (r.hidden || !can(r.perm)) continue;
    if (r.section !== section) {
      section = r.section;
      nav.append(h("div", { class: "nav-label" }, section));
      group = nav.appendChild(h("div", { class: "nav-section" }));
    }
    group.append(h("a", { class: "nav-item", href: `/admin/${r.key}`, "data-nav": "", "data-route": r.key }, h("span", { class: "nav-icon" }, r.icon(16)), h("span", { class: "nav-text" }, r.label)));
  }

  const closeDrawer = () => {
    sidebar.removeAttribute("data-open");
    backdrop.hidden = true;
  };
  const backdrop = h("div", { class: "sidebar-backdrop", hidden: true, onClick: closeDrawer });
  const sidebar = h(
    "aside",
    { class: "sidebar" },
    h("div", { class: "sidebar-brand" }, brand(), h("span", { class: "brand-edition" }, "Lite"), h("button", { class: "sidebar-close", type: "button", "aria-label": "Close menu", onClick: closeDrawer }, IconX(18))),
    projectSwitcher(),
    nav,
    h("div", { class: "sidebar-footer" }, accountMenu()),
  );
  const topbar = h(
    "div",
    { class: "mobile-topbar" },
    h("button", { class: "mobile-menu-btn", type: "button", "aria-label": "Open menu", onClick: () => (sidebar.setAttribute("data-open", ""), (backdrop.hidden = false)) }, IconMenu(18)),
    brand(),
  );
  const banner = h("div", { hidden: true });
  const inner = h("div", { class: "content-inner" });
  const content = h("div", { class: "content" }, inner);
  replace(root, h("div", { class: "shell" }, sidebar, backdrop, h("div", { class: "main" }, topbar, banner, content)));
  return { nav, inner, content, banner, closeDrawer };
}

function renderBanner() {
  const b = shell.banner;
  if (state.session === "recovery") {
    b.className = "banner warning";
    b.hidden = false;
    replace(
      b,
      h("span", { class: "banner-icon" }, IconAlert(16)),
      h("span", null, h("strong", null, "Signed in with a recovery link. "), "Set a new password or replace your authenticator on ", h("a", { href: "/admin/account", "data-nav": "" }, "Your account"), ". This session ends after 30 minutes."),
    );
  } else if (!state.operator.totp_enabled) {
    b.className = "banner";
    b.hidden = false;
    replace(b, h("span", { class: "banner-icon" }, IconInfo(16)), h("span", null, "Protect your account with two-step sign-in. "), h("span", { class: "right" }, h("a", { href: "/admin/account", "data-nav": "" }, "Set it up")));
  } else {
    b.hidden = true;
  }
}

async function renderRoute() {
  const { route, rest } = parsePath();
  if (!shell) shell = buildShell();
  renderBanner();
  shell.closeDrawer();
  for (const a of shell.nav.querySelectorAll(".nav-item")) a.setAttribute("data-active", String(a.dataset.route === route?.key));

  const seq = ++renderSeq;
  const show = (node) => seq === renderSeq && (replace(shell.inner, node), (shell.content.scrollTop = 0));
  if (!route) {
    document.title = "Not found · openpurr";
    return show(h("div", { class: "card" }, empty({ icon: IconAlert, title: "Page not found", text: "That page doesn't exist." })));
  }
  document.title = `${rest[0] && route.key === "customers" ? rest[0] : route.label} · openpurr`;
  if (!can(route.perm)) return show(h("div", { class: "card" }, empty({ icon: IconShield, title: "No access", text: `Your role (${state.operator.role}) can't open ${route.label}.` })));

  const ctx = {
    ...state,
    can,
    navigate,
    rerender: () => renderRoute(),
    reload: () => boot(),
    selectProject: (id) => selectProject(id),
  };
  const pageKey = `${route.key}/${rest.join("/")}`;
  if (pageKey !== shownPage) replace(shell.inner, h("div", { class: "loading" }, "Loading…"));
  shownPage = pageKey;
  try {
    const node =
      route.key === "customers" && rest[0] ? await customerPage(ctx, rest[0]) : route.key === "charts" && rest[0] ? await chartPage(ctx, rest[0]) : await route.page(ctx);
    show(node);
  } catch (err) {
    if (err.code === "signed_out" || err.code === "totp_enrollment_required") return; // handled in api.js
    show(errorCard(err, () => renderRoute()));
  }
}

void boot();
