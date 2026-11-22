// Configuration pages: the current project's apps and products, entitlements and offerings; the
// projects themselves and the config's history; and webhook endpoints (shown on the Webhooks
// page). Every change saves a new version of the config (js/config.js), which the back office uses
// at once and (on Lite) the SDK Worker within a minute. Where secrets live depends on the edition:
// Worker secrets on Lite, the server's environment on Standard.
import { get, post } from "../api.js";
import {
  appIdFor,
  dropReferences,
  loadConfig,
  newSdkKey,
  PRODUCT_TYPES,
  productRefs,
  projectIdFor,
  projectOf,
  saveConfig,
  saveProject,
  STORES,
  usage,
  validId,
  WEBHOOK_EVENTS,
} from "../config.js";
import { connectSection, sdkUrlCard } from "../connect.js";
import { h, replace } from "../dom.js";
import { isLite } from "../edition.js";
import { t, tk, tn, tx } from "../i18n.js";
import { IconBolt, IconKey, IconPlus } from "../icons.js";
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
  kv,
  modal,
  pageHeader,
  select,
  seg,
  table,
  toast,
  toggle,
  when,
} from "../ui.js";

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAVED = tk("Saved. The SDK picks it up within a minute.");
// PRODUCT_TYPES (js/config.js) holds the type values; these are their labels as shown.
const PRODUCT_TYPE_LABELS = { subscription: tk("Subscription"), non_consumable: tk("Non-consumable"), consumable: tk("Consumable") };
const productTypeLabel = (type) => (PRODUCT_TYPE_LABELS[type] ? t(PRODUCT_TYPE_LABELS[type]) : (PRODUCT_TYPES.find((pt) => pt.value === type)?.label ?? type));
/** How many entitlements and packages a removal also takes the app or product out of. */
const refCounts = (used) => ({ entitlements: tn(used.entitlements, "{n} entitlement", "{n} entitlements"), packages: tn(used.packages, "{n} package", "{n} packages") });

const textarea = (props = {}) => h("textarea", { class: "input mono textarea", rows: 4, spellcheck: "false", ...props });
const listOf = (s) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
const canEdit = (ctx) => ctx.can("config:manage");

/** Opens a form in a modal; `save()` runs on submit and returns false (or throws) to keep it open. */
function formModal({ title, sub, fields, submitLabel = t("Save"), save }) {
  const errors = formError();
  const submit = button(submitLabel, { type: "submit" });
  const m = modal({
    title,
    sub,
    body: h("div", { class: "stack" }, errors.el, fields),
    actions: [button(t("Cancel"), { variant: "outline", onClick: () => m.close() }), submit],
    onSubmit: async () => {
      const done = await busy(submit, async () => (await save()) ?? true, errors);
      return done === true ? undefined : false;
    },
  });
  return m;
}

/** A form check that stops the save with a message. */
function need(ok, message) {
  if (!ok) throw new Error(message);
}

async function saved(ctx, message = t(SAVED)) {
  toast(message, "success");
  await ctx.reload();
}

/** The config, and the current project's part of it (null if there's no project yet). */
async function current(ctx) {
  const config = await loadConfig();
  return { config, project: ctx.project ? projectOf(config.document, ctx.project.id) : null };
}

const readOnlyNote = (ctx) => (canEdit(ctx) ? null : h("p", { class: "small muted" }, t("Your role ({role}) can view the configuration. Admins and owners can change it.", { role: ctx.operator.role })));

// ---- First run ----------------------------------------------------------------------------------

/**
 * Adds the first app: a new project (when there's none, or `newProject`), with an iOS app, an
 * Android app, or both, each with a fresh SDK key.
 */
function addAppsForm(ctx, { newProject, onDone }) {
  const errors = formError();
  const name = input({ placeholder: t("e.g. Rose"), maxlength: 100, required: newProject });
  const bundle = input({ placeholder: "com.example.rose", mono: true, autocomplete: "off" });
  const pkg = input({ placeholder: "com.example.rose", mono: true, autocomplete: "off" });
  const submit = button(newProject ? t("Create project") : t("Add apps"), { type: "submit", icon: IconPlus(15) });
  const form = h(
    "form",
    { class: "stack" },
    errors.el,
    newProject ? field(t("Name"), name, t("Your app's name. Each title you sell gets its own project: apps, entitlements and customers.")) : null,
    field(t("iOS bundle ID"), bundle, t("As in App Store Connect. Leave it blank if you're not on the App Store.")),
    field(t("Android package name"), pkg, t("As in Play Console. Leave it blank if you're not on Google Play.")),
    h("div", null, submit),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = await busy(
      submit,
      async () => {
        const b = bundle.value.trim();
        const p = pkg.value.trim();
        need(b || p, t("Enter a bundle ID, a package name, or both."));
        need(!b || BUNDLE_ID.test(b), t("That doesn't look like a bundle ID (e.g. com.example.rose)."));
        need(!p || PACKAGE_NAME.test(p), t("That doesn't look like a package name (e.g. com.example.rose)."));
        need(!newProject || name.value.trim(), t("Give the project a name."));
        const keys = [];
        let projectId = ctx.project?.id;
        await saveConfig((doc) => {
          if (newProject) {
            projectId = projectIdFor(name.value.trim(), Object.keys(doc.projects));
            doc.projects[projectId] = { name: name.value.trim(), apps: {}, entitlements: {}, offerings: [], webhooks: [] };
          }
          const project = projectOf(doc, projectId);
          need(project, t("That project no longer exists. Reload the page."));
          for (const [store, id] of [["app_store", b], ["play_store", p]]) {
            if (!id) continue;
            const appId = appIdFor(projectId, store, doc);
            const key = newSdkKey(store);
            project.apps[appId] = { store, [store === "app_store" ? "bundle_id" : "package_name"]: id, sdk_keys: [key], products: {} };
            keys.push({ appId, store, key });
          }
        }, newProject ? `Created project ${name.value.trim()}` : "Added apps");
        return { projectId, keys };
      },
      errors,
    );
    if (!result) return;
    onDone?.();
    ctx.selectProject(result.projectId);
    modal({
      title: t("Your SDK keys"),
      sub: t("Use these in Purchases.configure. They're public (they ship inside your app), and you can always find them on this page."),
      body: h(
        "div",
        { class: "stack-sm" },
        result.keys.map((k) => h("div", { class: "stack-xs" }, h("span", { class: "label" }, `${k.appId} (${STORES[k.store]})`), copyField(k.key))),
        h(
          "p",
          { class: "small muted" },
          isLite()
            ? t("Next: add your products, then an entitlement that they unlock, and an offering if your paywall uses one. Point the SDK at your openpurr SDK Worker with Purchases.proxyURL.")
            : t("Next: add your products, then an entitlement that they unlock, and an offering if your paywall uses one. Point the SDK at your openpurr server with Purchases.proxyURL."),
        ),
      ),
      actions: [button(t("Add products"), { type: "submit" })],
      onSubmit: () => ctx.navigate("/admin/apps"),
    });
    await ctx.reload();
  });
  return form;
}

function firstRun(ctx) {
  if (!canEdit(ctx)) {
    return h("div", { class: "card" }, empty({ icon: IconKey, title: t("No apps yet"), text: t("An admin or owner can add the first app here.") }));
  }
  return h(
    "div",
    { class: "onboarding" },
    pageHeader(ctx.project ? t("Add {project}'s apps", { project: ctx.project.name }) : t("Add your first app"), t("openpurr needs to know your app's identifiers to accept its purchases. You get an SDK key for each app; products, entitlements and offerings come next.")),
    h("div", { class: "card" }, h("div", { class: "card-body" }, addAppsForm(ctx, { newProject: !ctx.project }))),
  );
}

// ---- Apps and products --------------------------------------------------------------------------

export async function appsPage(ctx) {
  const [{ config, project }, settings] = await Promise.all([current(ctx), get("/settings")]);
  if (!project || !Object.keys(project.apps).length) return firstRun(ctx);
  const pid = ctx.project.id;
  const edit = canEdit(ctx);

  const addApp = () => {
    const store = select(Object.entries(STORES).map(([value, label]) => ({ value, label })), "app_store");
    const ident = input({ mono: true, required: true, placeholder: "com.example.app", autocomplete: "off" });
    const appId = input({ mono: true, placeholder: t("generated"), autocomplete: "off" });
    formModal({
      title: t("Add an app"),
      sub: t("One app per store. Its purchases unlock this project's entitlements."),
      fields: [field(t("Store"), store), field(t("Bundle ID or package name"), ident), field(t("App ID"), appId, t("How openpurr names the app (charts, webhooks). Leave blank for one like rose_ios."))],
      save: async () => {
        const id = ident.value.trim();
        need((store.value === "app_store" ? BUNDLE_ID : PACKAGE_NAME).test(id), store.value === "app_store" ? t("Enter the bundle ID, e.g. com.example.app.") : t("Enter the package name, e.g. com.example.app."));
        need(!appId.value.trim() || validId(appId.value.trim()), t("App IDs are letters, digits, '.', '_', '-' and '$'."));
        await saveProject(
          pid,
          (p, doc) => {
            const newId = appId.value.trim() || appIdFor(pid, store.value, doc);
            p.apps[newId] = { store: store.value, [store.value === "app_store" ? "bundle_id" : "package_name"]: id, sdk_keys: [newSdkKey(store.value)], products: {} };
          },
          "Added an app",
        );
        await saved(ctx);
      },
    });
  };

  return h(
    "div",
    null,
    pageHeader(
      t("Apps and products"),
      isLite()
        ? t("{project}'s apps, their SDK keys and the products they sell. Store keys and service accounts are Worker secrets; this names them.", { project: ctx.project.name })
        : t("{project}'s apps, their SDK keys and the products they sell. Store keys and service accounts are environment variables on the server; this names them.", { project: ctx.project.name }),
      edit ? [button(t("Add app"), { icon: IconPlus(15), onClick: addApp })] : []),
    h("div", { class: "stack" }, readOnlyNote(ctx), sdkUrlCard(ctx, settings), Object.entries(project.apps).map(([appId, app]) => appCard(ctx, project, appId, app, settings)), configFooter(config)),
  );
}

function appCard(ctx, project, appId, app, settings) {
  const pid = ctx.project.id;
  const edit = canEdit(ctx);
  const ident = app.store === "app_store" ? app.bundle_id : app.package_name;

  const removeApp = async () => {
    const used = usage(project, appId);
    const text =
      used.entitlements + used.packages
        ? t("Its SDK keys stop working within a minute, and new purchases from it are refused. Purchases already recorded stay. It's also removed from {entitlements} and {packages}.", refCounts(used))
        : t("Its SDK keys stop working within a minute, and new purchases from it are refused. Purchases already recorded stay.");
    if (!(await confirmDialog({ title: t("Remove {name}?", { name: appId }), text, confirmLabel: t("Remove app"), danger: true }))) return;
    try {
      await saveProject(pid, (p) => (dropReferences(p, appId), delete p.apps[appId]), `Removed app ${appId}`);
      await saved(ctx);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const keyRows = (app.sdk_keys ?? []).map((key) =>
    h(
      "div",
      { class: "row", style: { gap: "8px" } },
      h("div", { style: { flex: "1", minWidth: "0" } }, copyField(key)),
      edit && app.sdk_keys.length > 1
        ? button(t("Remove"), {
            variant: "outline",
            size: "sm",
            onClick: async () => {
              if (!(await confirmDialog({ title: t("Remove this SDK key?"), text: t("App builds that use it stop working within a minute. Remove a key only once no installed version uses it."), confirmLabel: t("Remove key"), danger: true }))) return;
              try {
                await saveProject(pid, (p) => (p.apps[appId].sdk_keys = p.apps[appId].sdk_keys.filter((k) => k !== key)), `Removed an SDK key from ${appId}`);
                await saved(ctx);
              } catch (err) {
                toast(err.message, "error");
              }
            },
          })
        : null,
    ),
  );
  const addKey = async (btn) => {
    await busy(btn, async () => {
      await saveProject(pid, (p) => p.apps[appId].sdk_keys.push(newSdkKey(app.store)), `Added an SDK key to ${appId}`);
      await saved(ctx, t("Added a key. Ship it in a new app build, then remove the old one."));
    });
  };

  return cardWith(
    h("span", { class: "row", style: { gap: "8px" } }, h("span", { class: "mono" }, appId), badge(STORES[app.store] ?? app.store)),
    h("span", { class: "mono" }, ident),
    h(
      "div",
      { class: "card-body stack" },
      h("div", { class: "stack-sm" }, h("h3", { class: "subhead" }, t("SDK keys")), keyRows, edit ? h("div", null, button(t("Add a key"), { variant: "outline", size: "sm", onClick: (e) => addKey(e.currentTarget) })) : null),
      connectSection(app, settings),
      h("div", { class: "stack-sm" }, h("h3", { class: "subhead" }, t("Products")), productsTable(ctx, project, appId, app)),
      h("div", { class: "stack-sm" }, h("h3", { class: "subhead" }, app.store === "app_store" ? "App Store Server API" : "Google Play Developer API"), storeAccess(ctx, appId, app)),
    ),
    edit ? [button(t("Remove app"), { variant: "outline", size: "sm", onClick: removeApp })] : [],
  );
}

function productsTable(ctx, project, appId, app) {
  const pid = ctx.project.id;
  const edit = canEdit(ctx);
  const products = Object.entries(app.products ?? {});

  const productForm = (productId = null) => {
    const existing = productId ? app.products[productId] : null;
    const id = input({ mono: true, required: true, value: productId ?? "", disabled: !!productId, placeholder: app.store === "app_store" ? "pro_monthly" : "pro", autocomplete: "off" });
    const type = select(PRODUCT_TYPES.map(({ value }) => ({ value, label: productTypeLabel(value) })), existing?.type ?? "subscription");
    const plans = input({ mono: true, value: (existing?.base_plans ?? []).join(", "), placeholder: "monthly, annual" });
    const group = input({ mono: true, value: existing?.subscription_group ?? "", placeholder: "21000000" });
    const extra = h("div");
    const showExtra = () =>
      replace(
        extra,
        type.value !== "subscription"
          ? null
          : app.store === "play_store"
            ? field(t("Base plans"), plans, t("Optional: the base plan IDs from Play Console, separated by commas. Entitlements and packages can then pick one."))
            : field(t("Subscription group ID"), group, t("Optional: from App Store Connect. Learned from the first purchase otherwise; set it so intro-offer eligibility works before then.")),
      );
    type.addEventListener("change", showExtra);
    showExtra();
    formModal({
      title: productId ? t("Edit {name}", { name: productId }) : t("Add a product to {app}", { app: appId }),
      sub: app.store === "app_store" ? t("The product ID exactly as in App Store Connect.") : t("The product ID exactly as in Play Console."),
      fields: [field(t("Product ID"), id), field(t("Type"), type), extra],
      save: async () => {
        const pidValue = id.value.trim();
        need(validId(pidValue), t("Product IDs are letters, digits, '.', '_', '-' and '$' (no ':')."));
        need(productId || !app.products?.[pidValue], t("{app} already has {product}.", { app: appId, product: pidValue }));
        const product = { type: type.value };
        if (type.value === "subscription" && app.store === "play_store" && listOf(plans.value).length) product.base_plans = listOf(plans.value);
        if (type.value === "subscription" && app.store === "app_store" && group.value.trim()) product.subscription_group = group.value.trim();
        await saveProject(pid, (p) => ((p.apps[appId].products ??= {})[pidValue] = product), `${productId ? "Changed" : "Added"} product ${pidValue} (${appId})`);
        await saved(ctx);
      },
    });
  };

  const remove = async (productId) => {
    const used = usage(project, appId, productId);
    const text =
      used.entitlements + used.packages
        ? t("New purchases of it are refused (kept on the device). Purchases already recorded stay. It's also removed from {entitlements} and {packages}.", refCounts(used))
        : t("New purchases of it are refused (kept on the device). Purchases already recorded stay.");
    if (!(await confirmDialog({ title: t("Remove {name}?", { name: productId }), text, confirmLabel: t("Remove product"), danger: true }))) return;
    try {
      await saveProject(pid, (p) => (dropReferences(p, appId, productId), delete p.apps[appId].products[productId]), `Removed product ${productId} (${appId})`);
      await saved(ctx);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const unlocks = (productId) =>
    Object.entries(project.entitlements)
      .filter(([, e]) => (e.products?.[appId] ?? []).some((r) => r === productId || r.startsWith(`${productId}:`)))
      .map(([id]) => id);

  return h(
    "div",
    { class: "stack-sm" },
    products.length
      ? table(
          [{ label: t("Product") }, { label: t("Type") }, { label: t("Unlocks"), class: "hide-below-md" }, { label: "", class: "actions" }],
          products.map(([productId, p]) => [
            h("div", { class: "cell-stack" }, h("span", { class: "cell-strong mono" }, productId), p.base_plans?.length ? h("span", { class: "cell-sub" }, t("Base plans: {plans}", { plans: p.base_plans.join(", ") })) : p.subscription_group ? h("span", { class: "cell-sub" }, t("Group {group}", { group: p.subscription_group })) : null),
            productTypeLabel(p.type),
            unlocks(productId).length ? h("div", { class: "row wrap", style: { gap: "4px" } }, unlocks(productId).map((e) => badge(e))) : h("span", { class: "faint small" }, t("Nothing yet")),
            edit ? [button(t("Edit"), { variant: "outline", size: "sm", onClick: () => productForm(productId) }), button(t("Remove"), { variant: "outline", size: "sm", onClick: () => remove(productId) })] : null,
          ]),
        )
      : h("p", { class: "small muted" }, t("No products yet, so nothing can be bought in this app.")),
    edit ? h("div", null, button(t("Add product"), { variant: "outline", size: "sm", icon: IconPlus(14), onClick: () => productForm() })) : null,
  );
}

/** What holds a store key: a Worker secret on Lite, an environment variable on Standard. */
const secretLabel = () => (isLite() ? t("Worker secret") : t("Environment variable"));

function storeAccess(ctx, appId, app) {
  const pid = ctx.project.id;
  const edit = canEdit(ctx);
  if (app.store === "app_store") {
    const api = app.app_store_server_api;
    const open = () => {
      const issuer = input({ mono: true, value: api?.issuer_id ?? "", placeholder: "57246542-96fe-1a63-e053-0824d011072a" });
      const keyId = input({ mono: true, value: api?.key_id ?? "", placeholder: "2X9R4HXF34" });
      const secret = input({ mono: true, value: api?.private_key_secret ?? "APPLE_IAP_KEY" });
      formModal({
        title: t("App Store Server API for {app}", { app: appId }),
        sub: t("From App Store Connect → Users and Access → Integrations → In-App Purchase. Used for StoreKit 1 receipts, restores and setup checks."),
        fields: [field(t("Issuer ID"), issuer), field(t("Key ID"), keyId), isLite()
            ? field(t("Worker secret with the key"), secret, t("The .p8 file's contents never go here: set them with wrangler secret put on both Workers."))
            : field(t("Environment variable with the key"), secret, t("The .p8 file's contents never go here: set them in the server's environment (on every replica)."))],
        save: async () => {
          const clear = !issuer.value.trim() && !keyId.value.trim();
          need(clear || /^[0-9a-f-]{36}$/i.test(issuer.value.trim()), t("The issuer ID is a UUID."));
          need(clear || /^[A-Z0-9]{10}$/.test(keyId.value.trim()), t("The key ID is 10 capital letters and digits."));
          need(SECRET_NAME.test(secret.value.trim()), t("The secret name is capitals, digits and underscores, like APPLE_IAP_KEY."));
          await saveProject(
            pid,
            (p) => {
              if (clear) delete p.apps[appId].app_store_server_api;
              else p.apps[appId].app_store_server_api = { issuer_id: issuer.value.trim(), key_id: keyId.value.trim(), private_key_secret: secret.value.trim() };
            },
            `Changed App Store Server API access (${appId})`,
          );
          await saved(ctx);
        },
      });
    };
    return h(
      "div",
      { class: "stack-sm" },
      api ? kv([[t("Issuer ID"), h("span", { class: "mono small" }, api.issuer_id)], [t("Key ID"), h("span", { class: "mono small" }, api.key_id)], [secretLabel(), h("span", { class: "mono small" }, api.private_key_secret ?? "APPLE_IAP_KEY")]]) : h("p", { class: "small muted" }, t("Not set up: StoreKit 1 receipts (older SDKs, restores of old purchases) can't be resolved.")),
      edit ? h("div", null, button(api ? t("Edit") : t("Set up"), { variant: "outline", size: "sm", onClick: open })) : null,
    );
  }
  const api = app.google_play_api;
  const open = () => {
    const secret = input({ mono: true, value: api?.service_account_secret ?? "GOOGLE_SERVICE_ACCOUNT" });
    const push = input({ mono: true, value: api?.pubsub_push_account ?? "", placeholder: "rtdn-push@my-project.iam.gserviceaccount.com" });
    const audience = input({ mono: true, value: api?.pubsub_audience ?? "", placeholder: t("Leave blank for the notification URL") });
    const on = checkboxes([{ value: "on", label: t("Use the Google Play Developer API"), sub: t("Without it, Play purchases are refused (or, in development only, accepted unverified).") }], api ? ["on"] : []);
    formModal({
      title: t("Google Play Developer API for {app}", { app: appId }),
      sub: t("A service account invited in Play Console with View financial data and Manage orders and subscriptions."),
      fields: [
        on.el,
        isLite()
          ? field(t("Worker secret with the JSON key"), secret, t("Set it with wrangler secret put on both Workers."))
          : field(t("Environment variable with the JSON key"), secret, t("Set it in the server's environment (on every replica).")),
        field(t("Pub/Sub push account"), push, t("The service account Pub/Sub signs notifications with (Real-time developer notifications).")),
        field(t("Pub/Sub audience"), audience),
      ],
      save: async () => {
        const enabled = on.values().includes("on");
        need(!enabled || SECRET_NAME.test(secret.value.trim()), t("The secret name is capitals, digits and underscores, like GOOGLE_SERVICE_ACCOUNT."));
        need(!push.value.trim() || /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(push.value.trim()), t("The push account is a service account email ending in .iam.gserviceaccount.com."));
        await saveProject(
          pid,
          (p) => {
            if (!enabled) return void delete p.apps[appId].google_play_api;
            p.apps[appId].google_play_api = { service_account_secret: secret.value.trim(), ...(push.value.trim() ? { pubsub_push_account: push.value.trim() } : {}), ...(audience.value.trim() ? { pubsub_audience: audience.value.trim() } : {}) };
            delete p.apps[appId].allow_unverified_purchases;
          },
          `Changed Google Play Developer API access (${appId})`,
        );
        await saved(ctx);
      },
    });
  };
  return h(
    "div",
    { class: "stack-sm" },
    api
      ? kv([[secretLabel(), h("span", { class: "mono small" }, api.service_account_secret)], [t("Pub/Sub push account"), api.pubsub_push_account ? h("span", { class: "mono small" }, api.pubsub_push_account) : t("not set (no notifications)")]])
      : h("p", { class: "small muted" }, app.allow_unverified_purchases ? t("Not set up: purchases are accepted without verification (development only).") : t("Not set up: Google Play purchases are refused until it is.")),
    !api && edit
      ? toggle({
          checked: !!app.allow_unverified_purchases,
          label: t("Accept unverified purchases (development only: anyone with the SDK key could unlock entitlements)"),
          onChange: async (next) => {
            try {
              await saveProject(pid, (p) => (next ? (p.apps[appId].allow_unverified_purchases = true) : delete p.apps[appId].allow_unverified_purchases), `${next ? "Allowed" : "Stopped"} unverified purchases (${appId})`);
              await saved(ctx);
            } catch (err) {
              toast(err.message, "error");
              return false;
            }
          },
        })
      : null,
    edit ? h("div", null, button(api ? t("Edit") : t("Set up"), { variant: "outline", size: "sm", onClick: open })) : null,
  );
}

// ---- Entitlements -------------------------------------------------------------------------------

export async function entitlementsPage(ctx) {
  const { config, project } = await current(ctx);
  if (!project || !Object.keys(project.apps).length) return firstRun(ctx);
  const pid = ctx.project.id;
  const edit = canEdit(ctx);
  const apps = Object.entries(project.apps);

  const form = (entId = null) => {
    const e = entId ? project.entitlements[entId] : null;
    const id = input({ mono: true, required: true, value: entId ?? "", disabled: !!entId, placeholder: "pro", autocomplete: "off" });
    const description = input({ value: e?.description ?? "", placeholder: t("Pro features"), maxlength: 200 });
    const pickers = apps.map(([appId, app]) => {
      const refs = productRefs(app);
      return { appId, picker: checkboxes(refs, e?.products?.[appId] ?? []), refs };
    });
    formModal({
      title: entId ? t("Edit {name}", { name: entId }) : t("Add an entitlement"),
      sub: t("What your app checks (customerInfo.entitlements[\"pro\"]). Pick the products that unlock it in each app."),
      fields: [
        field(t("Entitlement ID"), id),
        field(t("Description"), description),
        pickers.map(({ appId, picker, refs }) => h("div", null, h("span", { class: "label" }, `${appId} (${STORES[project.apps[appId].store]})`), refs.length ? picker.el : h("p", { class: "small muted" }, t("No products yet.")))),
      ],
      save: async () => {
        const newId = id.value.trim();
        need(validId(newId), t("Entitlement IDs are letters, digits, '.', '_', '-' and '$'."));
        need(entId || !project.entitlements[newId], t("There's already an entitlement {name}.", { name: newId }));
        const products = Object.fromEntries(pickers.map(({ appId, picker }) => [appId, picker.values()]).filter(([, v]) => v.length));
        await saveProject(pid, (p) => (p.entitlements[newId] = { ...(description.value.trim() ? { description: description.value.trim() } : {}), products }), `${entId ? "Changed" : "Added"} entitlement ${newId}`);
        await saved(ctx);
      },
    });
  };

  const remove = async (entId) => {
    if (!(await confirmDialog({ title: t("Remove {name}?", { name: entId }), text: t("Customers stop having it (purchases stay recorded). Promotional grants of it stop showing. Apps that check it will see it missing."), confirmLabel: t("Remove entitlement"), danger: true }))) return;
    try {
      await saveProject(pid, (p) => delete p.entitlements[entId], `Removed entitlement ${entId}`);
      await saved(ctx);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const entries = Object.entries(project.entitlements);
  return h(
    "div",
    null,
    pageHeader(t("Entitlements"), t("What customers get access to, and which products unlock it in each app."), edit ? [button(t("Add entitlement"), { icon: IconPlus(15), onClick: () => form() })] : []),
    h(
      "div",
      { class: "stack" },
      readOnlyNote(ctx),
      entries.length
        ? table(
            [{ label: t("Entitlement") }, ...apps.map(([appId]) => ({ label: appId, class: "hide-below-md" })), { label: "", class: "actions" }],
            entries.map(([entId, e]) => [
              h("div", { class: "cell-stack" }, h("span", { class: "cell-strong mono" }, entId), e.description ? h("span", { class: "cell-sub" }, e.description) : null),
              ...apps.map(([appId]) => (e.products?.[appId]?.length ? h("div", { class: "row wrap", style: { gap: "4px" } }, e.products[appId].map((r) => badge(r))) : h("span", { class: "faint small" }, "—"))),
              edit ? [button(t("Edit"), { variant: "outline", size: "sm", onClick: () => form(entId) }), button(t("Remove"), { variant: "outline", size: "sm", onClick: () => remove(entId) })] : null,
            ]),
          )
        : h("div", { class: "card" }, empty({ icon: IconKey, title: t("No entitlements yet"), text: t("Purchases unlock nothing until an entitlement includes their product."), action: edit ? button(t("Add entitlement"), { icon: IconPlus(15), onClick: () => form() }) : null })),
      configFooter(config),
    ),
  );
}

// ---- Offerings ----------------------------------------------------------------------------------

const PACKAGE_IDS = ["$rc_weekly", "$rc_monthly", "$rc_two_month", "$rc_three_month", "$rc_six_month", "$rc_annual", "$rc_lifetime"];

export async function offeringsPage(ctx) {
  const { config, project } = await current(ctx);
  if (!project || !Object.keys(project.apps).length) return firstRun(ctx);
  const pid = ctx.project.id;
  const edit = canEdit(ctx);
  const apps = Object.entries(project.apps);

  const form = (index = null) => {
    const o = index === null ? null : project.offerings[index];
    const id = input({ mono: true, required: true, value: o?.id ?? "", placeholder: "default", autocomplete: "off" });
    const description = input({ value: o?.description ?? "", placeholder: t("Standard plans"), maxlength: 200 });
    const metadata = textarea({ value: o?.metadata && Object.keys(o.metadata).length ? JSON.stringify(o.metadata, null, 2) : "", placeholder: '{ "headline": "Go Pro" }' });
    const list = h("datalist", { id: "package-ids" }, PACKAGE_IDS.map((v) => h("option", { value: v })));
    const rows = h("div", { class: "stack-sm" });
    const rowEls = [];
    const addRow = (pkg = {}) => {
      const pkgId = input({ mono: true, value: pkg.id ?? "", placeholder: "$rc_monthly", list: "package-ids", autocomplete: "off" });
      const selects = apps.map(([appId, app]) => [appId, select([{ value: "", label: "—" }, ...productRefs(app)], pkg[appId] ?? "")]);
      const row = h(
        "div",
        { class: "package-row" },
        field(t("Package"), pkgId),
        selects.map(([appId, s]) => field(appId, s)),
        button(t("Remove"), { variant: "ghost", size: "sm", onClick: () => (row.remove(), rowEls.splice(rowEls.indexOf(entry), 1)) }),
      );
      const entry = { pkgId, selects };
      rowEls.push(entry);
      rows.append(row);
    };
    for (const pkg of o?.packages ?? [{ id: "$rc_monthly" }]) addRow(pkg);
    formModal({
      title: o ? t("Edit {name}", { name: o.id }) : t("Add an offering"),
      sub: t("What Purchases.getOfferings() returns: packages, each with the product to sell in each app."),
      fields: [field(t("Offering ID"), id), field(t("Description"), description), list, h("div", null, h("span", { class: "label" }, t("Packages")), rows, button(t("Add package"), { variant: "outline", size: "sm", icon: IconPlus(14), onClick: () => addRow() })), field(t("Metadata (JSON, optional)"), metadata)],
      save: async () => {
        const newId = id.value.trim();
        need(validId(newId), t("Offering IDs are letters, digits, '.', '_', '-' and '$'."));
        need(project.offerings.every((x, i) => i === index || x.id !== newId), t("There's already an offering {name}.", { name: newId }));
        let meta = {};
        if (metadata.value.trim()) {
          try {
            meta = JSON.parse(metadata.value);
          } catch {
            throw new Error(t("Metadata isn't valid JSON."));
          }
          need(meta && typeof meta === "object" && !Array.isArray(meta), t("Metadata must be a JSON object."));
        }
        const packages = rowEls.map(({ pkgId, selects }) => ({ id: pkgId.value.trim(), ...Object.fromEntries(selects.map(([appId, s]) => [appId, s.value]).filter(([, v]) => v)) }));
        need(packages.length, t("Add at least one package."));
        for (const pkg of packages) {
          need(validId(pkg.id), t("Each package needs an ID, like $rc_monthly."));
          need(Object.keys(pkg).length > 1, t("Pick a product for {package} in at least one app.", { package: pkg.id }));
        }
        await saveProject(
          pid,
          (p) => {
            const next = { id: newId, current: o?.current ?? !p.offerings.length, ...(description.value.trim() ? { description: description.value.trim() } : {}), metadata: meta, packages };
            if (index === null) p.offerings.push(next);
            else p.offerings[index] = next;
          },
          `${o ? "Changed" : "Added"} offering ${newId}`,
        );
        await saved(ctx);
      },
    });
  };

  const makeCurrent = async (index) => {
    try {
      await saveProject(pid, (p) => p.offerings.forEach((x, i) => (x.current = i === index)), `Made ${project.offerings[index].id} the current offering`);
      await saved(ctx);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const remove = async (index) => {
    const o = project.offerings[index];
    if (!(await confirmDialog({ title: t("Remove {name}?", { name: o.id }), text: o.current ? t("It's the current offering; another one becomes current (or none, if it's the last).") : t("Apps asking for it by ID won't find it."), confirmLabel: t("Remove offering"), danger: true }))) return;
    try {
      await saveProject(
        pid,
        (p) => {
          p.offerings.splice(index, 1);
          if (p.offerings.length && !p.offerings.some((x) => x.current)) p.offerings[0].current = true;
        },
        `Removed offering ${o.id}`,
      );
      await saved(ctx);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return h(
    "div",
    null,
    pageHeader(t("Offerings"), t("What your paywall shows: Purchases.getOfferings() returns these, with the current one first."), edit ? [button(t("Add offering"), { icon: IconPlus(15), onClick: () => form() })] : []),
    h(
      "div",
      { class: "stack" },
      readOnlyNote(ctx),
      project.offerings.length
        ? project.offerings.map((o, i) =>
            cardWith(
              h("span", { class: "row", style: { gap: "8px" } }, h("span", { class: "mono" }, o.id), o.current ? badge(t("Current"), "success", true) : null),
              o.description || null,
              table(
                [{ label: t("Package") }, ...apps.map(([appId]) => ({ label: appId }))],
                (o.packages ?? []).map((pkg) => [h("span", { class: "mono cell-strong" }, pkg.id), ...apps.map(([appId]) => (pkg[appId] ? h("span", { class: "mono small" }, pkg[appId]) : h("span", { class: "faint small" }, "—")))]),
              ),
              edit
                ? [
                    o.current ? null : button(t("Make current"), { variant: "outline", size: "sm", onClick: () => makeCurrent(i) }),
                    button(t("Edit"), { variant: "outline", size: "sm", onClick: () => form(i) }),
                    button(t("Remove"), { variant: "outline", size: "sm", onClick: () => remove(i) }),
                  ].filter(Boolean)
                : [],
            ),
          )
        : h("div", { class: "card" }, empty({ icon: IconKey, title: t("No offerings"), text: t("Purchases.getOfferings() returns none. Add one if your paywall uses offerings."), action: edit ? button(t("Add offering"), { icon: IconPlus(15), onClick: () => form() }) : null })),
      configFooter(config),
    ),
  );
}

// ---- Projects and history -----------------------------------------------------------------------

export async function projectsPage(ctx) {
  const [config, { versions }] = await Promise.all([loadConfig(), get("/config/versions?limit=50")]);
  const edit = canEdit(ctx);
  const projects = Object.entries(config.document.projects ?? {});

  const addProject = () => {
    const m = modal({
      title: t("Add a project"),
      sub: t("One project per title you sell. It gets its own apps, entitlements, offerings, webhooks and customers."),
      body: addAppsForm({ ...ctx, project: null }, { newProject: true, onDone: () => m.close() }),
      actions: [button(t("Close"), { variant: "outline", onClick: () => m.close() })],
    });
  };

  const rename = (projectId, p) => {
    const name = input({ value: p.name ?? projectId, required: true, maxlength: 100 });
    formModal({
      title: t("Rename {name}", { name: p.name ?? projectId }),
      sub: t("The project ID ({id}) stays the same; only the name shown changes.", { id: projectId }),
      fields: [field(t("Name"), name)],
      save: async () => {
        need(name.value.trim(), t("Enter a name."));
        await saveProject(projectId, (x) => (x.name = name.value.trim()), `Renamed project ${projectId}`);
        await saved(ctx, t("Renamed."));
      },
    });
  };

  const remove = async (projectId, p) => {
    if (!(await confirmDialog({ title: t("Remove {name}?", { name: p.name ?? projectId }), text: t("Its apps' SDK keys stop working. A project that has customers can't be removed."), confirmLabel: t("Remove project"), danger: true }))) return;
    try {
      await saveConfig((doc) => delete doc.projects[projectId], `Removed project ${projectId}`);
      await saved(ctx, t("Removed."));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const restore = async (v) => {
    if (!(await confirmDialog({ title: t("Restore version {version}?", { version: v.id }), text: t("It's saved again as the newest version; nothing in the history is lost. Apps can't move between projects, and projects with customers can't disappear, so some restores are refused."), confirmLabel: t("Restore") }))) return;
    try {
      await post(`/config/versions/${v.id}/restore`, { base_id: config.id });
      await saved(ctx, t("Restored version {version}.", { version: v.id }));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const view = async (v) => {
    const full = await get(`/config/versions/${v.id}`);
    modal({ title: t("Version {version}", { version: v.id }), sub: `${fmtDateTime(v.created_at)}${v.created_by ? ` · ${v.created_by}` : ""}`, body: h("pre", { class: "code-block" }, JSON.stringify(full.document, null, 2)), actions: [button(t("Close"), { type: "submit" })] });
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({ base_id: config.id, document: config.document }, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `openpurr-config-v${config.id}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return h(
    "div",
    null,
    pageHeader(t("Projects"), t("Each project is one title: its apps, entitlements, offerings, webhooks, secret keys and customers."), edit ? [button(t("Add project"), { icon: IconPlus(15), onClick: addProject })] : []),
    h(
      "div",
      { class: "stack" },
      readOnlyNote(ctx),
      projects.length
        ? table(
            [{ label: t("Project") }, { label: t("Apps") }, { label: "", class: "actions" }],
            projects.map(([projectId, p]) => [
              h("div", { class: "cell-stack" }, h("span", { class: "cell-strong" }, p.name ?? projectId), h("span", { class: "cell-mono" }, projectId)),
              Object.keys(p.apps ?? {}).length ? h("div", { class: "row wrap", style: { gap: "4px" } }, Object.entries(p.apps).map(([id, a]) => badge(`${id} · ${STORES[a.store] ?? a.store}`))) : h("span", { class: "faint small" }, t("No apps")),
              [
                button(t("Open"), { variant: "outline", size: "sm", onClick: () => (ctx.selectProject(projectId), ctx.navigate("/admin/apps")) }),
                edit ? button(t("Rename"), { variant: "outline", size: "sm", onClick: () => rename(projectId, p) }) : null,
                edit ? button(t("Remove"), { variant: "outline", size: "sm", onClick: () => remove(projectId, p) }) : null,
              ],
            ]),
          )
        : h("div", { class: "card" }, empty({ icon: IconKey, title: t("No projects yet"), text: t("Add one for your first app."), action: edit ? button(t("Add project"), { icon: IconPlus(15), onClick: addProject }) : null })),
      cardWith(
        t("History"),
        t("Every change to the configuration is a version. Restoring one saves it again as the newest."),
        versions.length
          ? table(
              [{ label: t("Version") }, { label: t("Change") }, { label: t("By"), class: "hide-below-md" }, { label: t("Saved") }, { label: "", class: "actions" }],
              versions.map((v) => [
                h("span", { class: "mono" }, String(v.id)),
                h("span", { class: "small" }, v.note ?? "—", v.id === config.id ? h("span", null, " ", badge(t("Current"), "success")) : null),
                h("span", { class: "small" }, v.created_by ?? "—"),
                when(v.created_at),
                [button(t("View"), { variant: "outline", size: "sm", onClick: () => view(v).catch((err) => toast(err.message, "error")) }), edit && v.id !== config.id ? button(t("Restore"), { variant: "outline", size: "sm", onClick: () => restore(v) }) : null],
              ]),
            )
          : h("div", { class: "card-body muted small" }, t("No versions yet.")),
        [button(t("Download JSON"), { variant: "outline", size: "sm", onClick: download })],
      ),
    ),
  );
}

/** The version a page shows, so it's clear when the config last changed. */
function configFooter(config) {
  const historyLink = () => h("a", { href: "/admin/projects", "data-nav": "" }, t("History"));
  if (!config.id) return null;
  const parts = { version: String(config.id), date: fmtDateTime(config.created_at), history: historyLink() };
  return h(
    "p",
    { class: "small faint" },
    config.created_by
      ? tx("Configuration version {version}, saved {date} by {operator}. {history}", { ...parts, operator: config.created_by })
      : tx("Configuration version {version}, saved {date}. {history}", parts),
  );
}

// ---- Webhook endpoints (on the Webhooks page) ---------------------------------------------------

export async function webhookEndpoints(ctx) {
  if (!ctx.project) return null;
  const { project } = await current(ctx);
  if (!project) return null;
  const pid = ctx.project.id;
  const edit = canEdit(ctx);

  const form = (index = null) => {
    const w = index === null ? null : project.webhooks[index];
    const id = input({ mono: true, required: true, value: w?.id ?? "", placeholder: "backend", autocomplete: "off" });
    const url = input({ type: "url", mono: true, required: true, value: w?.url ?? "", placeholder: "https://api.example.com/webhooks/revenuecat" });
    const auth = input({ mono: true, value: w?.authorization_secret ?? "", placeholder: "WEBHOOK_AUTH" });
    const signing = input({ mono: true, value: w?.signing_secret ?? "", placeholder: "WEBHOOK_SIGNING_SECRET" });
    const envs = checkboxes(
      [
        { value: "production", label: t("Production") },
        { value: "sandbox", label: t("Sandbox") },
      ],
      w?.environments ?? ["production", "sandbox"],
    );
    let which = w?.events?.length ? "some" : "all";
    const events = checkboxes(WEBHOOK_EVENTS.map((e) => ({ value: e, label: e })), w?.events ?? []);
    const eventsWrap = h("div", { hidden: which === "all" }, events.el);
    const chooser = seg(
      [
        { value: "all", label: t("All events") },
        { value: "some", label: t("Some events") },
      ],
      which,
      (v) => ((which = v), (eventsWrap.hidden = v === "all")),
    );
    formModal({
      title: w ? t("Edit {name}", { name: w.id }) : t("Add a webhook endpoint"),
      sub: isLite()
        ? t("RevenueCat-shaped events, POSTed to your backend and retried for about three days. Secrets are Worker secrets, named here.")
        : t("RevenueCat-shaped events, POSTed to your backend and retried for about three days. Secrets are environment variables on the server, named here."),
      fields: [
        field(t("ID"), id),
        field(t("URL"), url),
        field(t("Authorization secret (optional)"), auth, isLite() ? t("A Worker secret holding the exact Authorization header to send.") : t("An environment variable holding the exact Authorization header to send.")),
        field(
          t("Signing secret (optional)"),
          signing,
          isLite() ? t("A Worker secret holding the HMAC key. Requests then carry X-RevenueCat-Webhook-Signature.") : t("An environment variable holding the HMAC key. Requests then carry X-RevenueCat-Webhook-Signature."),
        ),
        h("div", null, h("span", { class: "label" }, t("Environments")), envs.el),
        h("div", { class: "stack-sm" }, h("span", { class: "label" }, t("Events")), chooser, eventsWrap),
      ],
      save: async () => {
        const newId = id.value.trim();
        need(validId(newId), t("IDs are letters, digits, '.', '_', '-' and '$'."));
        need(project.webhooks.every((x, i) => i === index || x.id !== newId), t("There's already an endpoint {name}.", { name: newId }));
        need(/^https:\/\//.test(url.value.trim()) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(url.value.trim()), t("The URL must use https."));
        for (const s of [auth, signing]) need(!s.value.trim() || SECRET_NAME.test(s.value.trim()), t("Secret names are capitals, digits and underscores."));
        need(envs.values().length, t("Pick at least one environment."));
        need(which === "all" || events.values().length, t("Pick at least one event, or send all."));
        const next = {
          id: newId,
          url: url.value.trim(),
          ...(auth.value.trim() ? { authorization_secret: auth.value.trim() } : {}),
          ...(signing.value.trim() ? { signing_secret: signing.value.trim() } : {}),
          environments: envs.values(),
          ...(which === "some" ? { events: events.values() } : {}),
        };
        await saveProject(pid, (p) => (index === null ? p.webhooks.push(next) : (p.webhooks[index] = next)), `${w ? "Changed" : "Added"} webhook ${newId}`);
        await saved(ctx);
      },
    });
  };

  const remove = async (index) => {
    const w = project.webhooks[index];
    if (!(await confirmDialog({ title: t("Remove {name}?", { name: w.id }), text: t("No more events go to it, and pending retries stop."), confirmLabel: t("Remove endpoint"), danger: true }))) return;
    try {
      await saveProject(pid, (p) => p.webhooks.splice(index, 1), `Removed webhook ${w.id}`);
      await saved(ctx);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return cardWith(
    t("Endpoints"),
    t("Where {project}'s events go.", { project: ctx.project.name }),
    project.webhooks.length
      ? table(
          [{ label: t("Endpoint") }, { label: t("Sends"), class: "hide-below-md" }, { label: t("Secrets"), class: "hide-below-md" }, { label: "", class: "actions" }],
          project.webhooks.map((w, i) => [
            h("div", { class: "cell-stack" }, h("span", { class: "cell-strong mono" }, w.id), h("span", { class: "cell-mono cell-truncate", title: w.url }, w.url)),
            h("span", { class: "small" }, `${w.events?.length ? tn(w.events.length, "{n} event type", "{n} event types") : t("All events")} · ${(w.environments ?? ["production", "sandbox"]).join(", ")}`),
            h("span", { class: "mono small" }, [w.authorization_secret, w.signing_secret].filter(Boolean).join(", ") || "—"),
            edit ? [button(t("Edit"), { variant: "outline", size: "sm", onClick: () => form(i) }), button(t("Remove"), { variant: "outline", size: "sm", onClick: () => remove(i) })] : null,
          ]),
        )
      : h("div", { class: "card-body muted small" }, t("No endpoints yet.")),
    edit ? [button(t("Add endpoint"), { variant: "outline", size: "sm", icon: IconBolt(14), onClick: () => form() })] : [],
  );
}
