// Generates golden-apple.json: what Lite's own App Store code (lite/src/stores/apple*.ts and the
// event bodies of lite/src/webhooks.ts) produces for a set of inputs, so the Go tests can check
// Standard's output byte for byte.
//
// Regenerate after changing that code in Lite, from the repo root:
//   lite/node_modules/.bin/esbuild standard/internal/testdata/golden-apple.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/golden-apple.mjs && node /tmp/golden-apple.mjs > standard/internal/testdata/golden-apple.json

import { parseConfig } from "../../../lite/src/config";
import type { TransactionRow } from "../../../lite/src/ledger";
import { appleSubscriptionState, appleTransactionRow } from "../../../lite/src/stores/apple";
import { AppleApiError } from "../../../lite/src/stores/apple-api";
import { appleNotificationEvents, receiptPurchaseEvents } from "../../../lite/src/stores/apple-events";
import { syncFromTransactionId, syncStatuses } from "../../../lite/src/stores/apple-sync";
import { eventBody } from "../../../lite/src/webhooks";

const NOW = 1_800_000_000_000;
const DAY = 864e5;

const rawConfig = {
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
      products: { pro: { type: "subscription", base_plans: ["monthly", "annual"] }, lifetime: { type: "non_consumable" } },
    },
  },
  entitlements: {
    pro: { products: { ios: ["pro_monthly", "pro_annual", "lifetime"], android: ["pro", "lifetime"] } },
    annual_perks: { products: { ios: ["pro_annual"], android: ["pro:annual"] } },
  },
  offerings: [],
};
const config = parseConfig(rawConfig);
const project = config.projects.get("default")!;
const ios = config.apps.get("ios")!;

const tx = (o: Record<string, unknown> = {}) => ({
  transactionId: "2000000000000001",
  originalTransactionId: "2000000000000001",
  bundleId: "com.example.openpurr",
  productId: "pro_monthly",
  purchaseDate: NOW - DAY,
  originalPurchaseDate: NOW - DAY,
  expiresDate: NOW + 29 * DAY,
  type: "Auto-Renewable Subscription",
  inAppOwnershipType: "PURCHASED",
  environment: "Sandbox",
  price: 9990,
  currency: "USD",
  storefront: "USA",
  ...o,
});
const lifetime = { productId: "lifetime", type: "Non-Consumable" };

// --- transaction rows ----------------------------------------------------------------------------

const rowCases: [string, Record<string, unknown>][] = [
  ["subscription", tx()],
  ["non-consumable ignores expiresDate", tx(lifetime)],
  ["consumable", tx({ productId: "coins_100", type: "Consumable", expiresDate: undefined })],
  ["production, family shared", tx({ environment: "Production", inAppOwnershipType: "FAMILY_SHARED" })],
  ["xcode environment is sandbox", tx({ environment: "Xcode" })],
  ["free trial", tx({ offerType: 1, offerDiscountType: "FREE_TRIAL" })],
  ["pay as you go", tx({ offerType: 2, offerDiscountType: "PAY_AS_YOU_GO" })],
  ["offer code without discount type", tx({ offerType: 3 })],
  ["offerType 0", tx({ offerType: 0, offerDiscountType: "FREE_TRIAL" })],
  ["revoked, reason 1", tx({ revocationDate: NOW - 1000, revocationReason: 1 })],
  ["revocation reason null", tx({ revocationReason: null })],
  ["upgraded", tx({ isUpgraded: true })],
  ["isUpgraded false", tx({ isUpgraded: false })],
  ["no price", tx({ price: undefined, currency: undefined, storefront: undefined })],
  ["price zero", tx({ price: 0 })],
  ["price with fraction", tx({ price: 1234.5 })],
  ["numeric ids", tx({ transactionId: 2000000000000002, originalTransactionId: 2000000000000001 })],
  ["no originalPurchaseDate", tx({ originalPurchaseDate: undefined })],
  ["null expiresDate", tx({ expiresDate: null })],
  ["currency null", tx({ currency: null })],
  ["subscription group", tx({ subscriptionGroupIdentifier: "21000000" })],
  ["wrong bundle", tx({ bundleId: "com.someone.else" })],
  ["no bundle", tx({ bundleId: undefined })],
  ["wrong type", tx({ productId: "lifetime" })],
  ["no type", tx({ type: undefined })],
  ["no transactionId", tx({ transactionId: undefined })],
  ["null originalTransactionId", tx({ originalTransactionId: null })],
  ["no purchaseDate", tx({ purchaseDate: undefined })],
];

const transactionRows = rowCases.map(([name, payload]) => {
  const product = ios.products.get(String(payload.productId))!;
  try {
    return { name, payload: JSON.stringify(payload), row: JSON.stringify(appleTransactionRow(payload as never, ios, product)) };
  } catch (err) {
    return { name, payload: JSON.stringify(payload), error: (err as Error).message };
  }
});

// --- subscription state --------------------------------------------------------------------------

const renewal = (o: Record<string, unknown> = {}) => ({
  originalTransactionId: "2000000000000001",
  productId: "pro_monthly",
  autoRenewProductId: "pro_monthly",
  autoRenewStatus: 1,
  signedDate: NOW,
  ...o,
});
const stateCases: [string, Record<string, unknown>, number | undefined][] = [
  ["active", renewal(), 1],
  ["no status", renewal(), undefined],
  ["auto-renew off", renewal({ autoRenewStatus: 0, expirationIntent: 1 }), 1],
  ["auto-renew null", renewal({ autoRenewStatus: null }), 1],
  ["no auto-renew status", renewal({ autoRenewStatus: undefined, autoRenewProductId: undefined }), 2],
  ["grace from status", renewal({ gracePeriodExpiresDate: NOW + 5 * DAY }), 4],
  ["grace inferred", renewal({ gracePeriodExpiresDate: NOW + 5 * DAY }), undefined],
  ["grace in the past", renewal({ gracePeriodExpiresDate: NOW - DAY, isInBillingRetryPeriod: true }), undefined],
  ["billing retry inferred", renewal({ isInBillingRetryPeriod: true }), undefined],
  ["billing retry status, grace ignored", renewal({ gracePeriodExpiresDate: NOW + DAY }), 3],
  ["revoked", renewal(), 5],
  ["numeric original id", renewal({ originalTransactionId: 2000000000000001 }), 1],
];
const subscriptionStates = stateCases.map(([name, r, status]) => ({
  name,
  renewal: JSON.stringify(r),
  status: status ?? null,
  state: JSON.stringify(appleSubscriptionState(r as never, status)),
}));

// --- events --------------------------------------------------------------------------------------

const row = (o: Partial<TransactionRow> = {}): TransactionRow => ({
  app_id: "ios",
  store: "app_store",
  environment: "sandbox",
  transaction_id: "2000000000000002",
  original_transaction_id: "2000000000000001",
  product_id: "pro_monthly",
  base_plan_id: null,
  product_type: "subscription",
  purchased_at: NOW - DAY,
  original_purchased_at: NOW - 31 * DAY,
  expires_at: NOW + 29 * DAY,
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
});

const notificationCases: [string, string, string | undefined, Record<string, unknown> | undefined, string | null][] = [
  ["SUBSCRIBED", "INITIAL_BUY", undefined, undefined, null],
  ["SUBSCRIBED", "RESUBSCRIBE", undefined, undefined, "trial"],
  ["DID_RENEW", undefined, undefined, undefined, "trial"],
  ["DID_RENEW", "BILLING_RECOVERY", undefined, undefined, "normal"],
  ["ONE_TIME_CHARGE", undefined, undefined, undefined, null],
  ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", undefined, undefined, null],
  ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_ENABLED", undefined, undefined, null],
  ["DID_CHANGE_RENEWAL_STATUS", undefined, undefined, undefined, null],
  ["DID_FAIL_TO_RENEW", undefined, undefined, renewal(), null],
  ["DID_FAIL_TO_RENEW", "GRACE_PERIOD", undefined, renewal({ gracePeriodExpiresDate: NOW + 3 * DAY }), null],
  ["GRACE_PERIOD_EXPIRED", undefined, undefined, undefined, null],
  ["EXPIRED", "VOLUNTARY", undefined, undefined, null],
  ["EXPIRED", "BILLING_RETRY", undefined, undefined, null],
  ["EXPIRED", "PRICE_INCREASE", undefined, undefined, null],
  ["EXPIRED", "PRODUCT_NOT_FOR_SALE", undefined, undefined, null],
  ["EXPIRED", undefined, undefined, undefined, null],
  ["DID_CHANGE_RENEWAL_PREF", "UPGRADE", undefined, renewal({ autoRenewProductId: "pro_annual" }), null],
  ["DID_CHANGE_RENEWAL_PREF", "DOWNGRADE", undefined, undefined, null],
  ["DID_CHANGE_RENEWAL_PREF", undefined, undefined, renewal(), null],
  ["REFUND", undefined, undefined, undefined, null],
  ["REVOKE", undefined, undefined, undefined, null],
  ["REFUND_REVERSED", undefined, undefined, undefined, null],
  ["RENEWAL_EXTENDED", undefined, undefined, undefined, null],
  ["PRICE_INCREASE", "PENDING", undefined, undefined, null],
  ["PRICE_INCREASE", "ACCEPTED", undefined, undefined, null],
  ["PRICE_INCREASE", undefined, undefined, undefined, null],
  ["CONSUMPTION_REQUEST", undefined, undefined, undefined, null],
  ["TEST", undefined, "no transaction", undefined, null],
];
const notificationEvents = notificationCases.map(([type, subtype, noTx, r, previous]) => {
  const n = { notificationType: type, subtype, notificationUUID: "11111111-2222-4333-8444-555555555555", signedDate: NOW };
  const t = noTx ? undefined : row(type === "EXPIRED" && subtype === undefined ? { expires_at: null } : {});
  return {
    type,
    subtype: subtype ?? "",
    hasTransaction: !noTx,
    expiresNull: type === "EXPIRED" && subtype === undefined,
    renewal: r ? JSON.stringify(r) : null,
    previous: previous ?? "",
    events: JSON.stringify(appleNotificationEvents(n as never, t, r as never, { previousPeriodType: previous })),
  };
});

const receiptCases: [string, Partial<TransactionRow>][] = [
  ["first period", { transaction_id: "2000000000000001" }],
  ["renewal", {}],
  ["revoked", { revoked_at: NOW - 1000 }],
  ["old", { purchased_at: NOW - 73 * 3600_000 }],
  ["just recent", { purchased_at: NOW - 72 * 3600_000 }],
  ["non-consumable", { product_type: "non_consumable", expires_at: null }],
  ["consumable", { product_type: "consumable", expires_at: null }],
  ["play first", { store: "play_store", transaction_id: "GPA.1234-5678-9012-34567", original_transaction_id: "tok" }],
  ["play renewal", { store: "play_store", transaction_id: "GPA.1234-5678-9012-34567..0", original_transaction_id: "tok" }],
];
const receiptEvents = receiptCases.map(([name, o]) => ({
  name,
  row: JSON.stringify(row(o)),
  events: JSON.stringify(receiptPurchaseEvents(row(o), NOW)),
}));

// --- event bodies --------------------------------------------------------------------------------

const customer = {
  id: "c1",
  appUserId: "user@example",
  originalAppUserId: "$RCAnonymousID:abc",
  aliases: ["$RCAnonymousID:abc", "user@example"],
  attributes: { $email: { value: "a@example.com", updated_at_ms: 5 }, "10": { value: "x", updated_at_ms: 6 } },
};
const bodyCases: [string, Record<string, unknown>][] = [
  ["USD purchase", { type: "INITIAL_PURCHASE", transaction: row() }],
  ["EUR with a USD price", { type: "RENEWAL", transaction: row({ currency: "EUR", price_micros: 8990000 }), priceUsd: 9.5, extra: { is_trial_conversion: true } }],
  ["EUR without a rate", { type: "RENEWAL", transaction: row({ currency: "EUR", price_micros: 8990000 }), priceUsd: null }],
  ["refund", { type: "CANCELLATION", transaction: row(), negativePrice: true, priceUsd: -9.99, extra: { cancel_reason: "CUSTOMER_SUPPORT" } }],
  ["no price", { type: "INITIAL_PURCHASE", transaction: row({ price_micros: null, currency: null, storefront: null }) }],
  ["unknown storefront, family", { type: "INITIAL_PURCHASE", transaction: row({ storefront: "XXX", ownership_type: "FAMILY_SHARED", period_type: "trial" }) }],
  ["lifetime", { type: "NON_RENEWING_PURCHASE", transaction: row({ product_id: "lifetime", product_type: "non_consumable", expires_at: null }) }],
  ["play", { type: "INITIAL_PURCHASE", store: "play_store", transaction: row({ app_id: "android", store: "play_store", product_id: "pro", base_plan_id: "annual", storefront: "DE", environment: "production" }), environment: "production" }],
  ["transfer", { type: "TRANSFER", extra: { transferred_from: ["alice"], transferred_to: ["user@example"] } }],
  ["experiments, extra overriding", { type: "BILLING_ISSUE", transaction: row(), experiments: [{ experiment_id: "e1", experiment_variant: "b", enrolled_at_ms: 7 }], extra: { grace_period_expiration_at_ms: null, app_id: "override" } }],
];
const eventBodies = bodyCases.map(([name, o]) => {
  const input = {
    dedupeKey: "k",
    appId: "ios",
    environment: "sandbox",
    store: "app_store",
    now: NOW,
    ...o,
    customer: { ...customer, ...(o.experiments ? { experiments: o.experiments } : {}) },
  };
  return {
    name,
    type: o.type,
    appId: (input.transaction as TransactionRow | undefined)?.app_id ?? "ios",
    environment: input.environment,
    store: input.store,
    transaction: input.transaction ? JSON.stringify(input.transaction) : null,
    extra: o.extra ? JSON.stringify(o.extra) : null,
    negativePrice: !!o.negativePrice,
    priceUsd: "priceUsd" in o ? o.priceUsd : null,
    experiments: o.experiments ? JSON.stringify(o.experiments) : null,
    body: JSON.stringify(eventBody(project, input as never, "event-id")),
  };
});

// --- syncing from the App Store Server API -------------------------------------------------------

const statusOf = (t: Record<string, unknown>, status: number, r: Record<string, unknown> = {}) => ({
  originalTransactionId: String(t.originalTransactionId),
  status,
  transaction: t,
  renewal: renewal({ originalTransactionId: t.originalTransactionId, productId: t.productId, ...r }),
});
const many = Array.from({ length: 18 }, (_, i) =>
  tx({ transactionId: `30000000${String(i).padStart(2, "0")}`, originalTransactionId: `30000000${String(i).padStart(2, "0")}`, ...lifetime, purchaseDate: NOW - i * DAY }),
);
const syncCases: [string, Record<string, unknown>[], ReturnType<typeof statusOf>[]][] = [
  [
    "history",
    [
      tx({ transactionId: "3000000001", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: NOW + 200 * DAY }),
      tx({ transactionId: "3000000002", ...lifetime }),
      tx({ transactionId: "2999999999", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: NOW - 165 * DAY }),
      tx({ transactionId: "3000000003", productId: "discontinued_product" }),
      tx({ transactionId: "3000000004", bundleId: "com.other" }),
      tx({ transactionId: "3000000005", productId: "lifetime" }),
      tx({ transactionId: "3000000006", originalTransactionId: "3000000006", revocationDate: NOW - DAY }),
      tx({ transactionId: "3000000007", originalTransactionId: "3000000006", isUpgraded: true }),
      tx({ transactionId: "3000000008", originalTransactionId: "3000000006", expiresDate: NOW + 10 * DAY, purchaseDate: NOW - 2 * DAY }),
      tx({ transactionId: "3000000009", originalTransactionId: "3000000006", expiresDate: NOW + 10 * DAY, purchaseDate: NOW - 3 * DAY }),
    ],
    [],
  ],
  ["capped at 15", many, []],
  [
    "statuses first, duplicates replace",
    [tx({ transactionId: "3000000001", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: NOW + 5 * DAY })],
    [statusOf(tx({ transactionId: "3000000001", originalTransactionId: "3000000000", productId: "pro_annual", expiresDate: NOW + 6 * DAY }), 4, { gracePeriodExpiresDate: NOW + 9 * DAY })],
  ],
];
const notFound = () => {
  throw new AppleApiError(404, 4040010, "not found");
};
const syncs = await Promise.all(
  syncCases.map(async ([name, history, statuses]) => {
    const client = (env: string, known: boolean) =>
      ({
        environment: env,
        transactionHistory: async () => (known ? { transactions: history, complete: true } : notFound()),
        subscriptionStatuses: async () => statuses,
      }) as never;
    const result = await syncFromTransactionId({ production: client("production", false), sandbox: client("sandbox", true) }, ios, "x");
    const onlyStatuses = await syncStatuses(client("sandbox", true), ios, "x");
    return {
      name,
      history: JSON.stringify(history),
      statuses: JSON.stringify(statuses),
      result: JSON.stringify(result),
      statusesResult: JSON.stringify(onlyStatuses),
    };
  }),
);

console.log(
  JSON.stringify(
    { now: NOW, config: rawConfig, transactionRows, subscriptionStates, notificationEvents, receiptEvents, eventBodies, syncs },
    null,
    1,
  ),
);
