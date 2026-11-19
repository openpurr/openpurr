---
name: app-store-setup
description: Connect an iOS, iPadOS, macOS or tvOS app on the App Store to openpurr. Covers the In-App Purchase key, App Store Server Notifications V2, products in the config, and a test notification. Use when the user is setting up Apple in-app purchases with openpurr, or when doctor reports an App Store problem.
---

# Connect the App Store

The steps below happen partly in App Store Connect, where the user has to click, and partly in the repo's `lite/` directory, where you can help. Ask for the values you need. Never ask the user to paste a private key into the conversation.

## 1. The app and its products in the config

In `lite/openpurr.config.yaml`, under `apps`:

```yaml
apps:
  ios:
    store: app_store
    bundle_id: com.example.myapp
    sdk_keys:
      - appl_<long random string>
    products:
      pro_monthly: { type: subscription }
      pro_annual: { type: subscription }
      lifetime: { type: non_consumable }
```

- Product IDs must match App Store Connect exactly. Types: `subscription`, `non_consumable`, `consumable`.
- Every product that unlocks something belongs to an entitlement under `entitlements`. Offerings (`offerings`) are optional; they're what `Purchases.getOfferings()` returns.
- One app per platform build. A macOS build with a different bundle ID is a separate app entry.

## 2. The In-App Purchase key (App Store Server API)

openpurr uses it for StoreKit 1 receipts, restores and the setup checks.

1. App Store Connect → Users and Access → Integrations → In-App Purchase → Generate In-App Purchase Key. Download the `.p8` file. Apple lets you download it only once.
2. Note the **Issuer ID** (shown above the key list) and the **Key ID**.
3. Add them to the app in the config:
   ```yaml
       app_store_server_api:
         issuer_id: <issuer ID>
         key_id: <key ID>
   ```
4. Store the key as a secret **on both Workers**. Ask the user to run these, so the key never enters the conversation:
   ```sh
   ! npx wrangler secret put APPLE_IAP_KEY < AuthKey_XXXXXXXXXX.p8
   ! npx wrangler secret put APPLE_IAP_KEY --env office < AuthKey_XXXXXXXXXX.p8
   ```
   (Run from `lite/`, with the path to their `.p8`.) Use `private_key_secret:` in the config only if they want a different secret name, for example one key per app.
5. Deploy: `pnpm run deploy && pnpm deploy:office`.

## 3. App Store Server Notifications (Version 2)

These tell openpurr about renewals, cancellations, refunds and billing problems as they happen.

1. App Store Connect → the app → App Information → App Store Server Notifications.
2. Set **both** the production and the sandbox URL to `https://<back office>/notifications/apple`, Version 2. This is the back-office Worker, not the SDK Worker.
3. Send a test and confirm it arrived:
   ```sh
   pnpm apple:test-notification --issuer <issuer ID> --key-id <key ID> --bundle <bundle ID> --key-file AuthKey_XXXXXXXXXX.p8
   ```
   Add `--environment production` to test the production URL (sandbox is the default). The `.p8` is read locally to sign the request and isn't uploaded.

## 4. Check

Run the `check_setup` MCP tool, or `npx openpurr doctor`. The App Store checks confirm that the key works and that Apple has the right notification URL. Fix anything it flags; each problem carries its fix.

## Testing purchases

- Use a Sandbox Apple Account (App Store Connect → Users and Access → Sandbox), or StoreKit testing in Xcode. Sandbox purchases are tagged `sandbox` and kept apart from production in charts and webhooks.
- Sandbox subscriptions renew fast (a monthly plan renews every 5 minutes), so renewals and expirations show up quickly.
- After a test purchase, look the customer up: the `lookup_customer` tool, or `npx openpurr customer <app user ID>`.

## Common problems

- **Purchases are refused with a bundle ID error:** the transaction's bundle ID doesn't match `bundle_id` in the config.
- **"Product … is not in the config":** the product ID isn't in the config for that app. Add it and deploy.
- **No renewals or cancellations arrive:** the notification URL is missing, points at the SDK Worker, or is Version 1. Doctor reports it.
- **Restores fail for old StoreKit 1 receipts:** the In-App Purchase key is missing on the SDK Worker (it must be set on both).
