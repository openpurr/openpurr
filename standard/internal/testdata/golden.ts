// Generates golden.json: what Lite's own code (lite/src/config.ts and lite/src/customer-info.ts)
// produces for a set of inputs, so the Go tests can check Standard's output byte for byte.
//
// Regenerate after changing Lite's config validation or CustomerInfo, from the repo root:
//   lite/node_modules/.bin/esbuild standard/internal/testdata/golden.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/golden.mjs && node /tmp/golden.mjs > standard/internal/testdata/golden.json

import { ConfigError, parseConfig } from "../../../lite/src/config";
import { computeSnapshot, renderCustomerInfo } from "../../../lite/src/customer-info";
import type { GrantRow, SubscriptionStateRow, TransactionRow } from "../../../lite/src/ledger";

const IOS_KEY = "appl_test_ios_0123456789";
const ANDROID_KEY = "goog_test_android_0123456789";

// The same config as lite/test/helpers.ts, plus a numeric product and entitlement, which
// JavaScript orders first in objects.
const rawTestConfig = {
  version: 1,
  apps: {
    ios: {
      store: "app_store",
      bundle_id: "com.example.openpurr",
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
      package_name: "com.example.openpurr",
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

const goldenConfig = structuredClone(rawTestConfig) as any;
goldenConfig.apps.ios.products["2024"] = { type: "subscription" };
goldenConfig.entitlements["9"] = { products: { ios: ["2024"] } };

function twoProjects() {
  const project = (name: string, appId: string, bundle: string, key: string, product: string) => ({
    name,
    apps: { [appId]: { store: "app_store", bundle_id: bundle, sdk_keys: [key], products: { [product]: { type: "subscription" } } } },
    entitlements: { pro: { products: { [appId]: [product] } } },
    offerings: [{ id: `${appId}_default`, current: true, packages: [{ id: "$rc_monthly", [appId]: product }] }],
  });
  return {
    version: 2,
    projects: {
      rose: project("Rose", "rose_ios", "com.example.rose", "appl_rose_ios_0123456789", "rose_monthly"),
      gold: project("Gold", "gold_ios", "com.example.gold", "appl_gold_ios_0123456789", "gold_monthly"),
    },
  };
}

// --- config validation --------------------------------------------------------------------------

const mutations: Record<string, (c: any) => void> = {
  valid: () => {},
  test_key: (c) => (c.apps.ios.sdk_keys = ["test_abcdefghijklmnopqrst"]),
  wrong_prefix: (c) => (c.apps.ios.sdk_keys = ["goog_abcdefghijklmnopqrst"]),
  shared_key: (c) => (c.apps.android.sdk_keys = c.apps.ios.sdk_keys),
  unknown_refs: (c) => {
    c.entitlements.pro.products.ios.push("pro_weekly");
    c.entitlements.pro.products.tvos = ["x"];
    c.offerings[0].packages[0].android = "pro:weekly";
    c.apps.ios.colour = "blue";
  },
  dupe_bundle: (c) => (c.apps.ios2 = { ...structuredClone(c.apps.ios), sdk_keys: ["appl_second_ios_app_0000"] }),
  no_current: (c) => (c.offerings[0].current = false),
  two_current: (c) => c.offerings.push({ ...c.offerings[0], id: "other", current: true }),
  ios_base_plan: (c) => (c.entitlements.pro.products.ios = ["pro_monthly:monthly"]),
  everything_wrong: (c) => {
    c.extra = 1;
    c.apps.ios.store = "amazon";
    c.apps.android.package_name = "";
    c.apps.android.allow_unverified_purchases = "yes";
    c.apps.android.app_store_server_api = { issuer_id: "x" };
    c.apps.android.google_play_api = { service_account_secret: "lower", pubsub_push_account: "nobody", pubsub_audience: 5 };
    c.apps.android.sdk_keys = ["short", 7, "goog_abcdefghijklmnopqrst", "goog_abcdefghijklmnopqrst"];
    c.apps.android.products.pro.base_plans = ["ok", "not ok"];
    c.apps.android.products.lifetime = { type: "forever", subscription_group: 1 };
    c.apps.android.products["bad:id"] = "x";
    c.apps["bad app"] = { store: "app_store", bundle_id: "com.x", sdk_keys: ["appl_abcdefghijklmnopqrst"] };
    c.entitlements["bad ent"] = { products: { android: "pro" } };
    c.entitlements.empty = {};
    c.offerings.push({ id: "default", packages: [] });
    c.offerings.push({ id: 5, current: true, metadata: [], packages: [{ id: "$a", android: "pro:annual" }, { id: "$a", android: 3 }, "x"] });
    c.offerings.push("nope");
    c.webhooks = [
      { id: "a", url: "http://example.com/hook", signing_secret: "lower", environments: ["prod"], events: ["NOPE", "RENEWAL"] },
      { id: "a", url: "not a url", authorization_secret: "OK_SECRET", events: [] },
      { url: "http://localhost:8080/x" },
      "w",
    ];
  },
  apple_api: (c) => {
    c.apps.ios.app_store_server_api = { issuer_id: "57246542-96fe-1a63-e053-0824d011072a", key_id: "2X9R4HXF34", private_key_secret: null };
    c.apps.android.google_play_api = { pubsub_push_account: "rtdn-push@my-project.iam.gserviceaccount.com" };
    delete c.apps.android.allow_unverified_purchases;
  },
};

function problemsOf(raw: unknown): string[] {
  try {
    parseConfig(raw);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
}

const configCases = Object.entries(mutations).map(([name, mutate]) => {
  const doc = structuredClone(rawTestConfig) as any;
  mutate(doc);
  const problems = problemsOf(doc);
  const out: Record<string, unknown> = { name, document: doc, problems };
  if (!problems.length) {
    const c = parseConfig(doc);
    out.version = c.version;
    out.stored = JSON.stringify(c.document);
    out.projectVersions = Object.fromEntries([...c.projects].map(([id, p]) => [id, p.version]));
  }
  return out;
});

const projectDocs: Record<string, unknown> = {
  two_projects: twoProjects(),
  empty: { version: 2, projects: {} },
  bad_projects: { version: 2, projects: { "Not OK": {}, rose: { name: "", apps: [] }, gold: 5 } },
  version_3: { version: 3, projects: {}, other: true },
  not_a_mapping: [1, 2],
};
for (const [name, doc] of Object.entries(projectDocs)) {
  const problems = problemsOf(doc);
  const out: Record<string, unknown> = { name, document: doc, problems };
  if (!problems.length) {
    const c = parseConfig(doc);
    out.version = c.version;
    out.stored = JSON.stringify(c.document);
    out.projectVersions = Object.fromEntries([...c.projects].map(([id, p]) => [id, p.version]));
  }
  configCases.push(out);
}

// --- CustomerInfo ---------------------------------------------------------------------------------

const DAY = 864e5;
const T0 = 1_800_000_000_000;
let nextId = 1000;

function tx(o: Partial<TransactionRow>): TransactionRow {
  const id = String(nextId++);
  const purchased = o.purchased_at ?? T0 - DAY;
  return {
    app_id: "ios",
    store: "app_store",
    environment: "sandbox",
    transaction_id: id,
    original_transaction_id: id,
    product_id: "pro_monthly",
    base_plan_id: null,
    product_type: "subscription",
    purchased_at: purchased,
    original_purchased_at: purchased,
    expires_at: purchased + 30 * DAY,
    period_type: "normal",
    ownership_type: "PURCHASED",
    price_micros: 9990000,
    currency: "USD",
    storefront: "USA",
    revoked_at: null,
    revocation_reason: null,
    is_upgraded: 0,
    verified: 1,
    subscription_group: null,
    ...o,
  };
}

function state(t: TransactionRow, o: Partial<SubscriptionStateRow>): SubscriptionStateRow {
  return {
    store: t.store,
    original_transaction_id: t.original_transaction_id,
    status: 1,
    auto_renew: 1,
    auto_renew_product_id: t.product_id,
    unsubscribe_detected_at: null,
    billing_issue_detected_at: null,
    grace_period_expires_at: null,
    auto_resume_at: null,
    ...o,
  };
}

function grant(o: Partial<GrantRow>): GrantRow {
  return {
    id: `grant_${nextId++}`,
    entitlement_id: "pro",
    duration: "monthly",
    starts_at: T0 - DAY,
    expires_at: T0 + 29 * DAY,
    note: null,
    granted_by: "owner@example.com",
    source: "dashboard",
    created_at: T0 - DAY,
    revoked_at: null,
    revoked_by: null,
    ...o,
  };
}

const graceTx = tx({ product_id: "pro_monthly", purchased_at: T0 - 31 * DAY });
const pausedTx = tx({ app_id: "android", store: "play_store", product_id: "pro", base_plan_id: "monthly", transaction_id: "GPA.1", original_transaction_id: "token-1", expires_at: T0 - DAY, purchased_at: T0 - 31 * DAY });
const billingTx = tx({ product_id: "pro_annual", expires_at: T0 + 100 * DAY, price_micros: 49990000 });

const scenarios: { name: string; appUserId: string; customer: unknown; transactions: TransactionRow[]; states?: SubscriptionStateRow[]; grants?: GrantRow[]; requestStore?: string }[] = [
  { name: "empty", appUserId: "$RCAnonymousID:0123456789abcdef0123456789abcdef", customer: null, transactions: [] },
  {
    name: "furthest_expiry",
    appUserId: "u1",
    customer: { id: "c1", projectId: "default", appUserId: "u1", firstSeen: T0 - 90 * DAY },
    transactions: [tx({ product_id: "pro_monthly", expires_at: T0 + 10 * DAY }), tx({ product_id: "pro_annual", expires_at: T0 + 300 * DAY, price_micros: 49990000 })],
  },
  {
    name: "lifetime_wins",
    appUserId: "u2",
    customer: { id: "c2", projectId: "default", appUserId: "u2", firstSeen: T0 - 9 * DAY },
    transactions: [
      tx({ product_id: "pro_annual", expires_at: T0 + 300 * DAY }),
      tx({ product_id: "lifetime", product_type: "non_consumable", expires_at: null, price_micros: 99990000 }),
      tx({ product_id: "coins_100", product_type: "consumable", expires_at: null, purchased_at: T0 - 2 * DAY, price_micros: null, currency: null }),
      tx({ product_id: "coins_100", product_type: "consumable", expires_at: null, purchased_at: T0 - 5 * DAY, price_micros: 990000 }),
    ],
  },
  {
    name: "refunds",
    appUserId: "u3",
    customer: { id: "c3", projectId: "default", appUserId: "u3", firstSeen: T0 - 9 * DAY },
    transactions: [
      tx({ product_id: "pro_monthly", purchased_at: T0 - 5 * DAY, revoked_at: T0 - 3 * DAY, revocation_reason: "0" }),
      tx({ product_id: "lifetime", product_type: "non_consumable", expires_at: null, revoked_at: T0 - DAY }),
    ],
  },
  {
    name: "grace_and_status",
    appUserId: "u4",
    customer: { id: "c4", projectId: "default", appUserId: "u4", firstSeen: T0 - 40 * DAY },
    transactions: [graceTx, billingTx, pausedTx],
    states: [
      state(graceTx, { status: 4, grace_period_expires_at: T0 + 5 * DAY, billing_issue_detected_at: T0 - DAY + 123 }),
      state(billingTx, { auto_renew: 0, unsubscribe_detected_at: T0 - 2 * DAY + 999 }),
      state(pausedTx, { status: 2, auto_resume_at: T0 + 20 * DAY }),
    ],
  },
  {
    name: "upgraded",
    appUserId: "u5",
    customer: { id: "c5", projectId: "default", appUserId: "u5", firstSeen: T0 - 9 * DAY },
    transactions: [tx({ product_id: "pro_annual", expires_at: T0 + 300 * DAY, is_upgraded: 1 }), tx({ product_id: "pro_monthly", expires_at: T0 + 20 * DAY })],
  },
  {
    name: "google_base_plan",
    appUserId: "u6",
    customer: { id: "c6", projectId: "default", appUserId: "u6", firstSeen: T0 - 9 * DAY },
    transactions: [
      tx({ app_id: "android", store: "play_store", product_id: "pro", base_plan_id: "annual", transaction_id: "GPA.2", original_transaction_id: "token-2", expires_at: T0 + 300 * DAY, environment: "production" }),
      tx({ product_id: "pro_monthly", expires_at: T0 + 400 * DAY }),
    ],
    requestStore: "play_store",
  },
  {
    name: "google_base_plan_ios_request",
    appUserId: "u6",
    customer: { id: "c6", projectId: "default", appUserId: "u6", firstSeen: T0 - 9 * DAY },
    transactions: [
      tx({ app_id: "android", store: "play_store", product_id: "pro", base_plan_id: "annual", transaction_id: "GPA.3", original_transaction_id: "token-3", expires_at: T0 + 300 * DAY }),
    ],
    requestStore: "app_store",
  },
  {
    name: "grants",
    appUserId: "u7",
    customer: { id: "c7", projectId: "default", appUserId: "u7", firstSeen: T0 - 9 * DAY },
    transactions: [tx({ product_id: "pro_monthly", expires_at: T0 + 10 * DAY })],
    grants: [
      grant({ entitlement_id: "pro", duration: "yearly", expires_at: T0 + 365 * DAY + 500 }),
      grant({ entitlement_id: "annual_perks", duration: "lifetime", expires_at: null }),
      grant({ entitlement_id: "pro", duration: "weekly", expires_at: T0 + 7 * DAY }),
      grant({ entitlement_id: "pro", duration: "monthly", revoked_at: T0, revoked_by: "x" }),
      grant({ entitlement_id: "nonexistent", duration: "monthly" }),
    ],
  },
  {
    name: "grant_shorter_than_purchase",
    appUserId: "u8",
    customer: { id: "c8", projectId: "default", appUserId: "u8", firstSeen: T0 - 9 * DAY },
    transactions: [tx({ product_id: "lifetime", product_type: "non_consumable", expires_at: null })],
    grants: [grant({ entitlement_id: "pro", duration: "weekly", expires_at: T0 + 7 * DAY })],
  },
  {
    name: "numeric_keys",
    appUserId: "u9",
    customer: { id: "c9", projectId: "default", appUserId: "u9", firstSeen: T0 - 9 * DAY },
    transactions: [tx({ product_id: "pro_monthly", expires_at: T0 + 10 * DAY }), tx({ product_id: "2024", expires_at: T0 + 20 * DAY, price_micros: 1234567 })],
  },
  {
    name: "ties_and_expired",
    appUserId: "u10",
    customer: { id: "c10", projectId: "default", appUserId: "u10", firstSeen: T0 - 99 * DAY },
    transactions: [
      tx({ product_id: "pro_monthly", purchased_at: T0 - 60 * DAY, expires_at: T0 - 30 * DAY }),
      tx({ product_id: "pro_monthly", purchased_at: T0 - 59 * DAY, expires_at: T0 - 30 * DAY }),
      tx({ product_id: "pro_annual", purchased_at: T0 - 90 * DAY, expires_at: T0 - 30 * DAY, environment: "production", period_type: "trial", ownership_type: "FAMILY_SHARED" }),
    ],
  },
];

const project = parseConfig(goldenConfig).projects.get("default")!;
const customerInfoCases = scenarios.map((s) => {
  const snapshot = computeSnapshot({
    appUserId: s.appUserId,
    customer: s.customer as any,
    transactions: s.transactions,
    states: s.states,
    grants: s.grants,
    config: project,
    now: T0,
  });
  const rendered = renderCustomerInfo(snapshot, project, { now: T0 + 1234, requestStore: s.requestStore as any });
  return { ...s, states: s.states ?? [], grants: s.grants ?? [], snapshot: JSON.stringify(snapshot), rendered: JSON.stringify(rendered) };
});

console.log(
  JSON.stringify(
    { now: T0, renderNow: T0 + 1234, testConfig: rawTestConfig, goldenConfig, configCases, customerInfoCases },
    null,
    1,
  ),
);
