# Moving from RevenueCat

This guide moves an app's existing customers from RevenueCat to openpurr without losing anyone's access, while older app versions keep working against RevenueCat until people update.

## How it works

openpurr doesn't copy purchase records out of RevenueCat. Apple and Google hold the real records, and openpurr asks them directly, exactly as it does when your app posts a purchase. What openpurr needs from RevenueCat is a mapping: which app user owns which store purchase.

That mapping reaches openpurr in two ways, and you use both:

- **The import:** from RevenueCat's export, `openpurr import` brings over every customer at once, including people who never open the app again.
- **The app:** the new version of your app sends each customer's purchases once (`syncPurchases`), catching anyone the export missed.

In order:

1. Set up openpurr.
2. Keep both backends informed during the switch.
3. Get your data from RevenueCat.
4. Import it.
5. Ship the app update.
6. Check.
7. Finish the switch.

### What moves

| | |
|---|---|
| Subscriptions and purchases, with renewals, refunds, grace periods and expiry | Yes, fetched from Apple and Google |
| Who owns which purchase | Yes, from RevenueCat's export |
| App user IDs, including anonymous ones (`$RCAnonymousID:…`) | Yes. The SDK keeps sending the same ID after the switch. |
| Customer attributes (`$email`, `$displayName`, your own) | Yes, from an Audience export |
| Aliases (other app user IDs of the same customer) | If your export has them |
| Chart history | Partly. openpurr keeps the latest transaction of each subscription, so charts before the switch are incomplete. Download RevenueCat's chart CSVs for your records. |
| Paywalls, experiments, integrations, Customer Center, web billing | No. openpurr doesn't have them. |
| Past webhook events | No |

## 1. Set up openpurr

1. **Deploy openpurr Lite** ([README](../README.md#quick-start)). Give the SDK Worker a custom domain you own, so you can move servers later without another app update.
2. **Give openpurr store API access.** The import uses it to fetch every purchase.
   - App Store: the In-App Purchase key ([`app-store-setup`](../plugin/skills/app-store-setup/SKILL.md), step 2).
   - Google Play: the service account ([`play-setup`](../plugin/skills/play-setup/SKILL.md), step 2).

   Skip the store notification steps for now; step 2 below covers them.
3. **Recreate your products, entitlements and offerings with the same identifiers** (dashboard → Configuration). Your app refers to them by ID, and a purchase of a product openpurr doesn't know can't be imported.
4. **Keep your RevenueCat public SDK keys (optional).** Add your existing `appl_…` and `goog_…` keys to each app's `sdk_keys`: run `openpurr config pull`, edit the file, then `openpurr config push`. The app update then only adds the proxy URL.
5. Run `openpurr doctor` and fix what it reports. Notification checks will fail until step 7. That's expected.

## 2. Keep both backends informed during the switch

Until everyone has updated, some people still use app versions that talk to RevenueCat. Both backends need to hear about renewals, refunds and cancellations.

**App Store.** Apple sends notifications to one URL per environment. Keep RevenueCat's URL in App Store Connect, and have RevenueCat forward them:

- In RevenueCat, open the app's settings and set the **Apple Server Notification Forwarding URL** to `https://<back office>/notifications/apple`.

**Google Play.** Notifications go through a Pub/Sub topic, and a topic can feed several subscriptions:

1. In the Play Console, under Monetization setup → Real-time developer notifications, note the topic name (`projects/<project>/topics/<topic>`).
2. In that Google Cloud project, add openpurr's push subscription to the topic. Follow [`play-setup`](../plugin/skills/play-setup/SKILL.md) step 3, items 3 to 5: an authenticated push to `https://<back office>/notifications/google`, plus `pubsub_push_account` in the config.
3. If the topic isn't in a project you control, ask RevenueCat Support, or create your own topic now and switch the Play Console to it in step 7.

A notification can arrive for a customer who hasn't been imported yet. openpurr records the purchase anyway and attaches it when the import or the app claims it.

**Webhooks.** openpurr sends RevenueCat-shaped webhooks. Leave them off in openpurr until step 7, so your backend doesn't get each event twice. Imports never send webhooks: the purchases aren't new.

## 3. Get your data from RevenueCat

RevenueCat's own exports don't include Google Play purchase tokens, so most apps need a migration export from RevenueCat Support. ([RevenueCat's page on this](https://www.revenuecat.com/docs/revenuecat-support/common-tickets/export-data-or-migrate-away).)

- **App Store only:** a Scheduled Data Export is enough. It has `app_user_id`, `store` and `original_store_transaction_id`, which `openpurr import` reads as they are.
- **Google Play:** ask Support for a migration export. The project owner has to send or approve the request. For example:

  > We're migrating our project `<project ID>` to a self-hosted backend. Please prepare a migration export with one row per purchase, for production (and sandbox, if possible), with these columns: `app_user_id`, `store`, `original_transaction_id` (App Store), `purchase_token` (Google Play), `product_id`, and `aliases` if available. The destination fetches each purchase from Apple and Google itself, so no price or status columns are needed.

- **Customer attributes:** the migration export doesn't include them. Download an Audience export as well, and import it after the purchases (step 4).

Keep the files somewhere private: purchase tokens are sensitive.

## 4. Import

Install the CLI and sign in. You need an owner or admin, with an access token that has the **admin** scope (dashboard → Developers → Access tokens):

```sh
npm install -g @openpurr/cli
openpurr login --url https://<back office>
```

Try the first rows. A dry run asks the stores but writes nothing:

```sh
openpurr import revenuecat-export.csv --dry-run --limit 50
```

Then import everything:

```sh
openpurr import revenuecat-export.csv
```

Then the attributes, if you have them:

```sh
openpurr import audience-export.csv
```

### The file

A CSV with a header row. Column names are matched loosely (case, spaces), so RevenueCat's files usually work unchanged.

| Column | Needed for | Also recognized as |
|---|---|---|
| `app_user_id` | every row | `App User ID`, `customer_id`, `user_id` |
| `original_transaction_id` | App Store rows | `original_store_transaction_id`, `transaction_id`, `store_transaction_id` |
| `purchase_token` | Google Play rows | `fetch_token`, `token` |
| `product_id` | Google Play rows | `product_identifier`. RevenueCat's `pro:monthly` form is fine. |
| `store` | optional | `APP_STORE`, `PLAY_STORE`, `ios`, `android` … |
| `app` | when a project has several apps for one store | the openpurr app ID; or pass `--app` |
| `aliases` | optional | other app user IDs, separated by `\|`, `;` or `,` |
| `first_seen` | optional | when the customer was first seen (ISO 8601 or milliseconds) |
| `$email`, `$displayName`, … and `attr:<name>` | optional | customer attributes |

**Rows without a purchase** (only `app_user_id` with aliases or attributes) add those to customers openpurr already has. Import the purchases first.

**Several rows for the same customer are fine.** For the App Store, one transaction brings back the customer's whole history, so later rows it already covered are skipped.

**Google Play needs the token.** A Google order ID (`GPA.…`) can't be looked up.

### What an import does

For each row, openpurr asks Apple or Google for the purchase and records what the store says. Then:

- **The row's app user becomes the owner, unless someone already is.** If the app has already posted that purchase for a customer, that customer keeps it, and the report says so.
- **No webhooks are sent.**
- **A new customer's first seen date is backdated** to their first purchase (or the `first_seen` column), so the import doesn't show up as a wave of new customers.
- **Imported attributes never overwrite** what the app has set.

### Progress, problems and limits

- **Problems with single rows don't stop the import.** They go to `<file>.report.csv`, along with notes such as purchases kept by their current owner.
- **Stopping and resuming:** progress is saved in `<file>.openpurr-import.json`. Stop any time and run the same command again to carry on. `--restart` starts over. Importing a row twice changes nothing, so running again with a newer export is safe too.
- **Free plan limits:** each customer takes about 30 D1 row writes. The free plan allows 100,000 a day, so expect about 2,500 customers a day, fewer if your app is busy. The import stops itself at 90% of any daily limit, so your app keeps working. Run it again after 00:00 UTC.
  - On Workers Paid ($5 a month, 50 million rows written a month included), a large import takes hours instead of days. Set the plan in Settings so openpurr knows.
- **Store rate limits:** handled automatically. The import waits and retries.
- **Charts:** they update about an hour after the last imported row.

| In the report | Meaning | What to do |
|---|---|---|
| `not_found_at_store` | The store doesn't know this transaction or token for this app | Check the row's app; often a sandbox or deleted purchase. Safe to ignore. |
| `unknown_products` | The store reported products the config doesn't list | Add them to the app, then run with `--restart` (rows already done are quick). |
| `pending` | A Google purchase that isn't paid yet | Nothing; the app sends it once it's paid. |
| `no_customer` | A row without a purchase, for someone openpurr doesn't have | Import the purchases first. |
| `imported_with_notes` | Imported; a purchase stayed with the customer who already had it, or an alias belongs to someone else | Usually nothing. Look the customers up if it's unexpected. |
| `bad_row` | The row can't be read | The message says what's wrong. |

The import stops, instead of skipping, when a problem affects every row. Examples are a missing store API key, a project with several apps for one store and no `app` column, or a daily limit. The message says what to fix. Then run the same command again.

## 5. Ship the app update

In the new version:

1. **Set the proxy URL before `configure`, and use openpurr's SDK key** (unless you kept RevenueCat's key in step 1). The dashboard's Configuration → Apps and products page has setup code for each app, with the values filled in. The [`integrate`](../plugin/skills/integrate/SKILL.md) skill has the details, including two rules:
   - leave entitlement verification off;
   - on Android, don't use RevenueCatUI paywalls.
2. **Send each customer's purchases once**, the first time the new version runs:

**iOS (Swift):**
```swift
if !UserDefaults.standard.bool(forKey: "openpurr.synced") {
  Purchases.shared.syncPurchases { _, error in
    if error == nil { UserDefaults.standard.set(true, forKey: "openpurr.synced") }
  }
}
```

**Android (Kotlin):**
```kotlin
val prefs = context.getSharedPreferences("openpurr", Context.MODE_PRIVATE)
if (!prefs.getBoolean("synced", false)) {
  Purchases.sharedInstance.syncPurchases()
  prefs.edit().putBoolean("synced", true).apply()
}
```

**Flutter:**
```dart
final prefs = await SharedPreferences.getInstance();
if (!(prefs.getBool('openpurr.synced') ?? false)) {
  await Purchases.syncPurchases();
  await prefs.setBool('openpurr.synced', true);
}
```

**React Native:**
```js
if ((await AsyncStorage.getItem("openpurr.synced")) !== "1") {
  await Purchases.syncPurchases();
  await AsyncStorage.setItem("openpurr.synced", "1");
}
```

Don't call `syncPurchases` on every launch; once per install is enough. On Android, it sends active subscriptions and one-time purchases that haven't been consumed.

Release the update once the import has finished, or at least started. The import covers people who don't update, and the sync covers anyone the export missed.

## 6. Check

- `openpurr doctor`: everything except the notification checks should pass.
- Look up a few customers you know: `openpurr customer <app user ID>`, and `openpurr explain <app user ID> <entitlement>` for why they do or don't have access.
- Compare active subscriptions in openpurr's charts with RevenueCat's. They should be close. Differences usually show up in the report as `unknown_products` or `not_found_at_store`.
- Make a sandbox purchase in the new version and check it arrives.

## 7. Finish the switch

Once most active customers are on the new version (consider making it the minimum version):

1. **Point the stores at openpurr directly.**
   - App Store Connect: set both notification URLs (production and sandbox) to `https://<back office>/notifications/apple`, Version 2, and clear RevenueCat's forwarding URL.
   - Google Cloud: remove RevenueCat's subscription from the topic, or switch the Play Console to your own topic.
   - `openpurr doctor` should now pass.
2. **Turn on openpurr's webhooks** (Developers → Webhooks → Endpoints) and turn off RevenueCat's.
3. **Run the import once more with a fresh export (optional).** It picks up anyone who bought on an old app version and hasn't updated yet.
4. **Keep the RevenueCat project until you're sure.** RevenueCat recommends not deleting it before the migration files have been checked. After step 1 it stops hearing about renewals, so any app version still talking to RevenueCat sees stale access. That's why the minimum version comes first.
