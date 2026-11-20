---
name: integrate
description: Point an app's RevenueCat SDK (iOS, Android, Flutter, React Native) at an openpurr deployment, and check entitlements from the user's own backend with a secret key. Use when the user wants to wire up purchases in their app with openpurr, migrate an app from RevenueCat to openpurr, or check a customer's access from a server.
---

# Point an app at openpurr

openpurr speaks the RevenueCat SDK's API, so apps keep the official, unmodified SDK. Two changes: the SDK key comes from the openpurr config, and the SDK's proxy URL is the openpurr **SDK Worker** (not the back office).

## 1. Find the values

The dashboard's Configuration → Apps and products page has both, plus ready-to-paste setup code for each app with them filled in. The `get_config` MCP tool prints them too.

- **SDK URL:** the `openpurr` SDK Worker's custom domain, or `https://openpurr.<account>.workers.dev`. Owners set it once under Settings → This deployment → SDK URL. Until then the dashboard and `get_config` show a guess, so confirm it if it's marked as one.
- **SDK key:** in the dashboard, Configuration → Apps and products (`appl_…` for App Store apps, `goog_…` for Google Play apps). Or run the `get_config` MCP tool, or `npx openpurr config`. With several projects, use the key of the right project's app.

If the user is migrating from RevenueCat, the code that calls `configure` already exists. Change only the key and add the proxy URL.

## 2. Set the proxy URL before `configure`

Find where the app configures Purchases and set the proxy URL first.

**iOS (Swift):**
```swift
Purchases.proxyURL = URL(string: "https://purchases.example.com")!
Purchases.configure(withAPIKey: "appl_…")
```

**Android (Kotlin):**
```kotlin
Purchases.proxyURL = URL("https://purchases.example.com")
Purchases.configure(PurchasesConfiguration.Builder(context, "goog_…").build())
```

**Flutter:**
```dart
await Purchases.setProxyURL("https://purchases.example.com");
await Purchases.configure(PurchasesConfiguration("appl_…"));
```

**React Native / Expo:**
```js
await Purchases.setProxyURL("https://purchases.example.com");
Purchases.configure({ apiKey: Platform.OS === "ios" ? "appl_…" : "goog_…" });
```

Rules:

- Leave entitlement verification at its default (disabled). Signed responses rely on RevenueCat's own key, so verification would reject openpurr's answers.
- Use the key that matches the build's store: each key identifies one app in the config, and so its store. An iOS build needs the `appl_` key, an Android build the `goog_` key.
- **Android:** the SDK still sends diagnostics, paywall and ad traffic straight to RevenueCat's hosts, even with a proxy URL. openpurr turns diagnostics off through remote config. Don't use RevenueCatUI paywalls or ads on Android with openpurr; build the paywall with your own UI and `getOfferings()`.

Everything else works unchanged: `getOfferings`, `purchase`, `restorePurchases`, `getCustomerInfo`, `logIn`/`logOut`, subscriber attributes, and the customer info listener.

## 3. App user IDs

openpurr follows RevenueCat's identity model. Without `logIn`, the SDK creates an anonymous ID (`$RCAnonymousID:…`). Call `Purchases.logIn("<your user ID>")` once the user signs in, so purchases follow them across devices and platforms. Use a stable, non-guessable ID from your own system, not an email address.

## 4. Check access from your backend

Never trust the app's word that a user is subscribed. Ask openpurr from your server:

1. Create a secret key: dashboard → Developers → Secret keys, or `npx openpurr keys create "Backend"`. It's shown once. Store it in your backend's secret store, never in the app.
2. Call the SDK Worker:
   ```sh
   curl -H "Authorization: Bearer sk_…" https://purchases.example.com/v1/subscribers/<app user ID>
   ```
   The response is the same CustomerInfo the SDK gets (RevenueCat's `GET /v1/subscribers` shape). A user has an entitlement when `subscriber.entitlements.<id>` exists and its `expires_date` is null (lifetime) or in the future.

Secret keys can only read customers. For changes as they happen, use webhooks (the `webhooks` skill).

## 5. Verify

Make a sandbox purchase in the app, then look the customer up: the `lookup_customer` or `explain_entitlement` MCP tool, or `npx openpurr customer <app user ID>` and `npx openpurr explain <app user ID> <entitlement>`. If the purchase doesn't show up or doesn't unlock the entitlement, use the `debug-purchase` skill.
