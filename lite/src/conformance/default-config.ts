// The config /__conformance/reset loads when the runner sends none: the same apps, entitlements and
// offering as lite/test/helpers.ts and spec/conformance/src/config.ts.

export const DEFAULT_CONFORMANCE_CONFIG = {
  version: 1,
  apps: {
    ios: {
      store: "app_store",
      bundle_id: "com.example.openpurr",
      sdk_keys: ["appl_test_ios_0123456789"],
      products: {
        pro_monthly: { type: "subscription" },
        pro_annual: { type: "subscription", subscription_group: "21000000" },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
    android: {
      store: "play_store",
      package_name: "com.example.openpurr",
      sdk_keys: ["goog_test_android_0123456789"],
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
