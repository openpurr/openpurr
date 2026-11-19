// Connecting an app to this deployment: the SDK URL (the SDK's proxyURL, one deployment-wide
// setting), ready-to-paste setup code, and the URL each store sends notifications to. Used by the
// Apps and products page and the Settings page.
import { put } from "./api.js";
import { h } from "./dom.js";
import { IconCopy } from "./icons.js";
import { busy, button, cardWith, copy, copyField, field, formError, input, modal, seg, toast } from "./ui.js";

const PLACEHOLDER_URL = "https://<your SDK Worker>";

const SNIPPETS = {
  swift: {
    label: "Swift",
    code: (url, key) => `import RevenueCat

// Before configure: send the SDK's requests to openpurr.
Purchases.proxyURL = URL(string: "${url}")!
Purchases.configure(withAPIKey: "${key}")`,
  },
  kotlin: {
    label: "Kotlin",
    code: (url, key) => `import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import java.net.URL

// Before configure: send the SDK's requests to openpurr.
Purchases.proxyURL = URL("${url}")
Purchases.configure(
    PurchasesConfiguration.Builder(context, "${key}").build()
)`,
  },
  flutter: {
    label: "Flutter",
    code: (url, key) => `// Before configure: send the SDK's requests to openpurr.
await Purchases.setProxyURL("${url}");
await Purchases.configure(PurchasesConfiguration("${key}"));`,
  },
  reactNative: {
    label: "React Native",
    code: (url, key) => `// Before configure: send the SDK's requests to openpurr.
await Purchases.setProxyURL("${url}");
Purchases.configure({ apiKey: "${key}" });`,
  },
};

/** The SDK URL to show: the setting, else the workers.dev guess. source: "setting" | "guess" | null. */
export function sdkUrlOf(settings) {
  if (settings.sdk_url) return { url: settings.sdk_url, source: "setting" };
  if (settings.sdk_url_guess) return { url: settings.sdk_url_guess, source: "guess" };
  return { url: null, source: null };
}

export const notificationUrl = (store) => `${location.origin}/notifications/${store === "app_store" ? "apple" : "google"}`;

/** Owners: set or clear the SDK URL. */
export function editSdkUrl(settings, onSaved) {
  const errors = formError();
  const value = input({ mono: true, value: settings.sdk_url ?? "", placeholder: settings.sdk_url_guess ?? "https://purchases.example.com", autocomplete: "off", spellcheck: "false" });
  const submit = button("Save", { type: "submit" });
  const m = modal({
    title: "SDK URL",
    sub: "The openpurr SDK Worker's address: what your apps use as Purchases.proxyURL. Use a custom domain if you have one. Leave it empty to go back to the guess.",
    body: h("div", { class: "stack" }, errors.el, field("Address", value, "Find it in the Cloudflare dashboard: Workers & Pages → openpurr → Settings → Domains & Routes.")),
    actions: [button("Cancel", { variant: "outline", onClick: () => m.close() }), submit],
    onSubmit: async () => {
      const saved = await busy(submit, () => put("/settings", { sdk_url: value.value.trim() || null }), errors);
      if (!saved) return false;
      toast(saved.sdk_url ? "SDK URL saved" : "SDK URL cleared", "success");
      await onSaved?.(saved);
      return undefined;
    },
  });
}

/** What the SDK URL is and where it came from, with a Change button for owners. */
export function sdkUrlBlock(ctx, settings) {
  const { url, source } = sdkUrlOf(settings);
  const owner = ctx.can("settings:manage");
  const note =
    source === "guess"
      ? "A guess from this back office's address, right for a default deploy. Set it to be sure, and once you add a custom domain."
      : source === "setting"
        ? url.includes(".workers.dev")
          ? "The proxy URL ships inside your app, so switch to a domain you own before release: changing it later needs an app update."
          : null
        : "Not set. It's the openpurr SDK Worker's address (Workers & Pages → openpurr in the Cloudflare dashboard).";
  const change = owner ? button(url && source === "setting" ? "Change" : "Set SDK URL", { variant: "outline", size: "sm", onClick: () => editSdkUrl(settings, () => ctx.reload()) }) : null;
  const text = [note, !owner && source !== "setting" ? "An owner can set it under Settings." : null].filter(Boolean).join(" ");
  return h("div", { class: "stack-sm" }, url ? copyField(url) : null, text ? h("p", { class: "small muted" }, text) : null, change ? h("div", null, change) : null);
}

/** The card at the top of Apps and products. */
export function sdkUrlCard(ctx, settings) {
  return cardWith("SDK URL", "Your apps send their requests here (the SDK's proxy URL). It's the openpurr SDK Worker, not this back office, and the same for every project.", h("div", { class: "card-body" }, sdkUrlBlock(ctx, settings)));
}

function codeBlock(text) {
  return h(
    "div",
    { class: "snippet" },
    h("pre", { class: "code snippet-code" }, text),
    button(null, { variant: "outline", icon: IconCopy(15), title: "Copy code", onClick: () => copy(text) }),
  );
}

/** Setup code for one app, with a language switcher (the native language first). */
function setupCode(store, url, key) {
  const langs = [store === "app_store" ? "swift" : "kotlin", "flutter", "reactNative"];
  const host = h("div");
  const show = (lang) => host.replaceChildren(codeBlock(SNIPPETS[lang].code(url, key)));
  show(langs[0]);
  return h(
    "div",
    { class: "stack-sm" },
    seg(
      langs.map((l) => ({ value: l, label: SNIPPETS[l].label })),
      langs[0],
      show,
    ),
    host,
  );
}

/** Per app: the setup code and the store notification URL. */
export function connectSection(app, settings) {
  const apple = app.store === "app_store";
  const { url } = sdkUrlOf(settings);
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "stack-sm" },
      h("h3", { class: "subhead" }, "Setup code"),
      setupCode(app.store, url ?? PLACEHOLDER_URL, app.sdk_keys?.[0] ?? "<SDK key>"),
      h(
        "p",
        { class: "small muted" },
        apple
          ? "Keep entitlement verification at its default (disabled): signed responses rely on RevenueCat's own key."
          : "Keep entitlement verification at its default (disabled). Don't use RevenueCatUI paywalls or ads: on Android they call RevenueCat's servers directly, even with a proxy URL.",
      ),
    ),
    h(
      "div",
      { class: "stack-sm" },
      h("h3", { class: "subhead" }, "Store notifications"),
      copyField(notificationUrl(app.store)),
      h(
        "p",
        { class: "small muted" },
        apple
          ? "In App Store Connect → your app → App Information → App Store Server Notifications: set this as both the production and the sandbox URL, Version 2."
          : "The endpoint of a Pub/Sub push subscription with authentication on, on the topic set in Play Console → Monetization setup → Real-time developer notifications.",
      ),
    ),
  );
}
