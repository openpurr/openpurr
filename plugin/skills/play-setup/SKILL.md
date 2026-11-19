---
name: play-setup
description: Connect an Android app on Google Play to openpurr. Covers the service account and Play Console permissions, the products in the config, and Real-time Developer Notifications through Pub/Sub. Use when the user is setting up Google Play Billing with openpurr, or when doctor reports a Google Play problem.
---

# Connect Google Play

openpurr verifies every Play purchase with the Google Play Developer API, acknowledges it, and follows Real-time Developer Notifications (RTDN). Without API access, Play purchases are refused and stay queued on the device. Most steps happen in Google Cloud and the Play Console, where the user clicks. You help with the config and commands in `lite/`. Never ask the user to paste a service account key into the conversation.

## 1. The app and its products in the config

```yaml
apps:
  android:
    store: play_store
    package_name: com.example.myapp
    sdk_keys:
      - goog_<long random string>
    products:
      pro: { type: subscription, base_plans: [monthly, annual] }
      lifetime: { type: non_consumable }
      coins_100: { type: consumable }
```

- Subscriptions list their base plans. In entitlements and offerings, `pro` means every base plan and `pro:monthly` means just one.
- Product IDs and base plan IDs must match the Play Console exactly.

## 2. API access: a service account

1. In Google Cloud (any project): IAM & Admin → Service accounts → create one, for example `openpurr`. Then Keys → Add key → JSON. Keep the downloaded file safe.
2. In the Play Console: Users and permissions → Invite new users → the service account's email. Under app permissions, grant **View app information**, **View financial data** (for prices) and **Manage orders and subscriptions**.
3. Enable the **Google Play Android Developer API** in that Cloud project.
4. Add to the app in the config:
   ```yaml
       google_play_api:
         service_account_secret: GOOGLE_SERVICE_ACCOUNT
   ```
5. Store the JSON key as a secret **on both Workers**. Ask the user to run these:
   ```sh
   ! npx wrangler secret put GOOGLE_SERVICE_ACCOUNT < service-account.json
   ! npx wrangler secret put GOOGLE_SERVICE_ACCOUNT --env office < service-account.json
   ```
6. Deploy: `pnpm run deploy && pnpm deploy:office`.

Permissions for a new service account can take up to a day to apply in Play. If verification fails with a 401 or 403 right after setup, wait and retry before changing anything.

## 3. Real-time Developer Notifications

1. In Google Cloud → Pub/Sub, create a topic, for example `play-rtdn`. Grant `google-play-developer-notifications@system.gserviceaccount.com` the **Pub/Sub Publisher** role on it.
2. Play Console → Monetization setup → Real-time developer notifications: enter the topic's full name (`projects/<project>/topics/play-rtdn`).
3. Create a service account for the push, for example `rtdn-push`. It needs no roles.
4. Add a **push** subscription to the topic, endpoint `https://<back office>/notifications/google` (the back-office Worker), with **authentication enabled**, using the `rtdn-push` service account.
5. Name that account in the config, so openpurr accepts only pushes signed by it:
   ```yaml
       google_play_api:
         service_account_secret: GOOGLE_SERVICE_ACCOUNT
         pubsub_push_account: rtdn-push@<project>.iam.gserviceaccount.com
         # pubsub_audience: https://...   only if you set a custom audience on the subscription
   ```
   Deploy again.
6. In the Play Console, click **Send test notification**.

## 4. Check

Run the `check_setup` MCP tool, or `npx openpurr doctor`. The Google Play checks confirm the API credentials and notifications.

## Testing purchases

- Add testers under Play Console → Settings → License testing, and install the app from a testing track. License testers' purchases are free, tagged `sandbox`, and renew quickly (a monthly plan renews every 5 minutes).
- After a test purchase, look the customer up: the `lookup_customer` tool, or `npx openpurr customer <app user ID>`.

## Common problems

- **Purchases stay pending in the app:** API access isn't configured or the secret is missing on the SDK Worker. Without it, openpurr refuses Play purchases on purpose.
- **Pushes return 401:** the push subscription doesn't have authentication on, or `pubsub_push_account` doesn't match its service account.
- **Purchases are refunded automatically after 3 days:** they weren't acknowledged. openpurr acknowledges each verified purchase, so this means verification failed. Check the API permissions.
- `allow_unverified_purchases: true` exists for local development only. Never use it in production: anyone with the public SDK key could grant themselves entitlements.
