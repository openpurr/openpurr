# Moving from Adapty

This guide moves an app's existing customers from Adapty to openpurr without losing anyone's access, while older app versions keep working against Adapty until people update.

## How it differs from moving from RevenueCat

openpurr works with the RevenueCat Purchases SDK, which has a setting for pointing it at your own server. Adapty's SDK has no such setting, so a move from Adapty needs an app update that **replaces the Adapty SDK with the Purchases SDK**. Your products stay the same in App Store Connect and the Play Console, and your customers keep their purchases. What changes is the purchase code in your app.

As with RevenueCat, openpurr doesn't copy purchase records out of Adapty. Apple and Google hold the real records, and openpurr asks them directly. What openpurr needs from Adapty is a mapping: which of your users owns which store purchase. It reaches openpurr in two ways, and you use both:

- **The import:** from Adapty's event export, `openpurr import` brings over App Store customers you've identified with your own user ID, including people who never open the app again.
- **The app:** the new version of your app sends each customer's purchases once (`syncPurchases`). That covers everyone else: Google Play customers, since Adapty's export has no purchase tokens, and anonymous users.

In order:

1. Set up openpurr.
2. Keep both backends informed during the switch.
3. Get your data from Adapty.
4. Import it.
5. Replace the SDK in your app.
6. Check.
7. Finish the switch.

### What moves

| | |
|---|---|
| Subscriptions and purchases, with renewals, refunds, grace periods and expiry | Yes, fetched from Apple and Google |
| App Store customers with your own user ID (`customer_user_id`) | Yes, from Adapty's event export |
| Google Play customers | When they open the new version: the export has no purchase tokens |
| Anonymous users (no `customer_user_id`) | When they open the new version, under a new anonymous ID |
| Products | Yes. They're the same products in the stores; you list them in openpurr with the same IDs. |
| Access levels | You recreate them as entitlements |
| Paywalls and placements | You recreate them as offerings. Paywall builder layouts don't move: your app draws its own paywall. |
| A/B tests | No. Start new ones as [price experiments](price-experiments.md): an offering per variant. Keep Adapty's results for your records. |
| Customer attributes | No. Your app sets them again with `setAttributes`. |
| Chart history | Partly. openpurr keeps the latest transaction of each subscription, so charts before the switch are incomplete. Export Adapty's analytics for your records. |
| Webhooks, integrations, onboardings, web paywalls | No. openpurr sends RevenueCat-shaped webhooks, so your backend's handlers change (step 7). |

## 1. Set up openpurr

1. **Deploy openpurr Lite** ([README](../README.md#getting-started)). Give the SDK Worker a custom domain you own, so you can move servers later without another app update.
2. **Give openpurr store API access.** The import uses it to fetch every purchase.
   - App Store: the In-App Purchase key ([`app-store-setup`](../plugin/skills/app-store-setup/SKILL.md), step 2). You can reuse the key you gave Adapty.
   - Google Play: the service account ([`play-setup`](../plugin/skills/play-setup/SKILL.md), step 2).

   Skip the store notification steps for now; step 2 below covers them.
3. **Recreate your catalog** (dashboard → Configuration):
   - **Products:** the same store product IDs as in Adapty. A purchase of a product openpurr doesn't know can't be imported.
   - **Entitlements:** one per Adapty access level, with the same ID (often `premium`), granted by the same products.
   - **Offerings:** one per paywall or placement your app shows, with its products as packages. Make the one most customers see the current offering.
4. Run `openpurr doctor` and fix what it reports. Notification checks will fail until step 7. That's expected.

## 2. Keep both backends informed during the switch

Until everyone has updated, some people still use app versions that talk to Adapty. Both backends need to hear about renewals, refunds and cancellations.

**App Store.** Apple sends notifications to one URL per environment. Keep Adapty's URL in App Store Connect, and have Adapty forward them:

- In Adapty, open App settings → iOS SDK, scroll to App Store server notifications, and set **URL for forwarding raw Apple events** to `https://<back office>/notifications/apple`. Adapty forwards Apple's notifications as they are.

**Google Play.** Notifications go through a Pub/Sub topic, and a topic can feed several subscriptions:

1. In the Play Console, under Monetization setup → Real-time developer notifications, note the topic name (`projects/<project>/topics/<topic>`).
2. In that Google Cloud project, add openpurr's push subscription to the topic, next to Adapty's. Follow [`play-setup`](../plugin/skills/play-setup/SKILL.md) step 3, items 3 to 5: an authenticated push to `https://<back office>/notifications/google`, plus `pubsub_push_account` in the config.

A notification can arrive for a customer openpurr doesn't know yet. openpurr records the purchase anyway and attaches it when the import or the app claims it. So Google Play subscribers keep renewing in openpurr even before they open the new version.

**Webhooks.** Leave openpurr's webhooks off until step 7. Imports never send webhooks: the purchases aren't new.

## 3. Get your data from Adapty

Adapty's [Amazon S3 export](https://adapty.io/docs/s3-exports) writes subscription events as CSV files, and its **manual data export** exports a date range you choose.

1. In Adapty, set up the Amazon S3 integration if you haven't, with the subscription event groups turned on.
2. Run a manual data export from the date your app started using Adapty until today.
3. Download the event CSV files from your bucket.

`openpurr import` reads them as they are. It uses these columns and ignores the rest:

| Adapty column | Used as |
|---|---|
| `customer_user_id` | the app user ID: the ID your app passed to `Adapty.identify` |
| `original_transaction_id` | the App Store purchase to fetch |
| `store` | `app_store` or `play_store` |
| `product_id` | the product |

Rows the import can't use are skipped without asking the stores, and listed in the report:

- **no `customer_user_id`:** an anonymous Adapty profile. Your app doesn't know that profile ID after the switch, so the new version's `syncPurchases` brings these customers over instead;
- **Google Play rows:** the export has Google's order ID (`GPA.…`) but no purchase token, and an order ID can't be looked up. The new version's `syncPurchases` brings these over too.

Sandbox rows (`environment` is `Sandbox`) usually come back as `not_found_at_store`. Remove them first if you'd rather keep the report short.

Keep the files somewhere private: they hold your customers' IDs and purchases.

## 4. Import

Install the CLI and sign in. You need an owner or admin, with an access token that has the **admin** scope (dashboard → Developers → Access tokens):

```sh
npm install -g @openpurr/cli
openpurr login --url https://<back office>
```

Try the first rows. A dry run asks the stores but writes nothing:

```sh
openpurr import adapty-events.csv --dry-run --limit 50
```

Then import everything, one file at a time:

```sh
openpurr import adapty-events.csv
```

The event export has a row per event, so most customers appear many times. That's fine: one App Store transaction brings back the customer's whole history, and their other rows are counted as already covered.

What an import does, how to stop and resume it, free plan limits, and what each line of the report means are the same as for RevenueCat: see [Moving from RevenueCat](migrating-from-revenuecat.md#4-import).

## 5. Replace the SDK in your app

In the new version, remove the Adapty SDK and add the RevenueCat Purchases SDK ([`integrate`](../plugin/skills/integrate/SKILL.md) has the install steps for each platform). The dashboard's Configuration → Apps and products page has setup code for each app, with openpurr's URL and SDK key filled in. Two rules:

- leave entitlement verification off;
- on Android, don't use RevenueCatUI paywalls.

### What replaces what

| Adapty | Purchases SDK |
|---|---|
| `Adapty.activate(…)` | `Purchases.proxyURL = …`, then `Purchases.configure(…)` with openpurr's SDK key |
| `Adapty.identify(customerUserId)` | `Purchases.logIn(customerUserId)`, with the same ID |
| `Adapty.logout()` | `Purchases.logOut()` |
| Get a paywall for a placement, then its products | `Purchases.getOfferings()`: `offerings.current`, or `offerings.offering(identifier:)` for a specific placement |
| Draw the paywall (Adapty's paywall builder or your own UI) | Your own UI, from the offering's packages and their `storeProduct` prices |
| `Adapty.makePurchase(product)` | `Purchases.purchase(package:)` |
| `Adapty.restorePurchases()` | `Purchases.restorePurchases()` |
| `profile.accessLevels["premium"]?.isActive` | `customerInfo.entitlements["premium"]?.isActive` |
| Profile updates (`Adapty.updateProfile`) | `Purchases.setAttributes(…)`, `setEmail`, `setDisplayName` |
| Profile update listener | `PurchasesDelegate` / `UpdatedCustomerInfoListener` |

Use the same user ID with `logIn` as you did with `Adapty.identify`: that's the ID the import used.

### Send each customer's purchases once

The first time the new version runs, call `syncPurchases`. It brings over everyone the import couldn't: Google Play customers and anonymous users. The code is the same as for RevenueCat: see [Moving from RevenueCat, step 5](migrating-from-revenuecat.md#5-ship-the-app-update). Call it after `logIn`, if the user is signed in, so the purchases go to the right customer.

Release the update once the import has finished, or at least started.

## 6. Check

- `openpurr doctor`: everything except the notification checks should pass.
- Look up a few customers you know: `openpurr customer <app user ID>`, and `openpurr explain <app user ID> <entitlement>` for why they do or don't have access.
- Compare active App Store subscriptions in openpurr's charts with Adapty's. Google Play numbers catch up as customers open the new version.
- Make a sandbox purchase in the new version, on each store, and check it arrives.

## 7. Finish the switch

Once most active customers are on the new version (consider making it the minimum version):

1. **Point the stores at openpurr directly.**
   - App Store Connect: set both notification URLs (production and sandbox) to `https://<back office>/notifications/apple`, Version 2, and clear Adapty's forwarding URL.
   - Google Cloud: remove Adapty's subscription from the topic.
   - `openpurr doctor` should now pass.
2. **Move your webhook handlers.** openpurr sends RevenueCat-shaped webhooks, not Adapty's. Update your backend's handler (the [`webhooks`](../plugin/skills/webhooks/SKILL.md) skill describes the events), then turn on openpurr's webhooks (Developers → Webhooks → Endpoints) and turn off Adapty's.
3. **Run the import once more with a fresh export (optional).** It picks up App Store customers who bought on an old app version and haven't updated yet.
4. **Keep the Adapty project until you're sure.** After step 1 it stops hearing about renewals, so any app version still talking to Adapty sees stale access. That's why the minimum version comes first.
