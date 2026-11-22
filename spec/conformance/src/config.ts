// Test configs: the same apps, entitlements and offering as lite/test/helpers.ts, plus builders for
// the variants the scenarios need. Each returns a fresh copy, so tests can change it freely.

import { fake } from "./fake-store";

export const IOS_KEY = "appl_test_ios_0123456789";
export const ANDROID_KEY = "goog_test_android_0123456789";
export const BUNDLE_ID = "com.example.openpurr";
export const PACKAGE = "com.example.openpurr";

export const API_ISSUER_ID = "57246542-96fe-1a63-e053-0824d011072a";
export const API_KEY_ID = "TESTKEY123";

export const PUSH_ACCOUNT = "rtdn-push@test-project.iam.gserviceaccount.com";
/** Set explicitly in the config, so it doesn't depend on the URL the server is reached at. */
export const PUSH_AUDIENCE = "https://openpurr.conformance/notifications/google";

export const WEBHOOK_AUTH = "Bearer hook-secret-123";
export const WEBHOOK_SIGNING_KEY = "whsec_test_signing_key";

const RAW = {
  version: 1,
  apps: {
    ios: {
      store: "app_store",
      bundle_id: BUNDLE_ID,
      sdk_keys: [IOS_KEY],
      products: {
        pro_monthly: { type: "subscription" },
        pro_annual: { type: "subscription", subscription_group: "21000000" },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
    android: {
      store: "play_store",
      package_name: PACKAGE,
      sdk_keys: [ANDROID_KEY],
      allow_unverified_purchases: true,
      products: {
        pro: { type: "subscription", base_plans: ["monthly", "annual"] },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
  },
  entitlements: {
    pro: { description: "Pro", products: { ios: ["pro_monthly", "pro_annual", "lifetime"], android: ["pro", "lifetime"] } },
    annual_perks: { products: { ios: ["pro_annual"], android: ["pro:annual"] } },
  },
  offerings: [
    {
      id: "default",
      current: true,
      description: "Standard",
      metadata: { headline: "Go Pro" },
      packages: [
        { id: "$rc_monthly", ios: "pro_monthly", android: "pro:monthly" },
        { id: "$rc_annual", ios: "pro_annual", android: "pro:annual" },
        { id: "$rc_lifetime", ios: "lifetime", android: "lifetime" },
      ],
    },
  ],
};

/** The base test config (version 1 file: one project, "default"). */
export const testConfig = (): any => structuredClone(RAW);

/** The iOS app gets App Store Server API access (key APPLE_IAP_KEY). */
export function withAppleApi(raw: any = testConfig()) {
  raw.apps.ios.app_store_server_api = { issuer_id: API_ISSUER_ID, key_id: API_KEY_ID };
  return raw;
}

/** The Android app gets Play Developer API access and RTDN push (no unverified purchases). */
export function withGooglePlay(raw: any = testConfig()) {
  delete raw.apps.android.allow_unverified_purchases;
  raw.apps.android.google_play_api = {
    service_account_secret: "GOOGLE_SERVICE_ACCOUNT",
    pubsub_push_account: PUSH_ACCOUNT,
    pubsub_audience: PUSH_AUDIENCE,
  };
  return raw;
}

/** One webhook endpoint, "backend", at the fake receiver (with auth and signing secrets by default). */
export function withWebhooks(raw: any = testConfig(), webhook: Record<string, unknown> = {}) {
  raw.webhooks = [
    { id: "backend", url: fake.webhookUrl("backend"), authorization_secret: "WEBHOOK_AUTH", signing_secret: "WEBHOOK_SECRET", ...webhook },
  ];
  return raw;
}
