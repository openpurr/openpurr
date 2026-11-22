// Generates golden-google.json: what Lite's own Google Play code (lite/src/stores/google*.ts and the
// event bodies of lite/src/webhooks.ts) produces for a set of inputs, so the Go tests can check
// Standard's output byte for byte.
//
// Regenerate after changing that code in Lite, from the repo root:
//   lite/node_modules/.bin/esbuild standard/internal/testdata/golden-google.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/golden-google.mjs && node /tmp/golden-google.mjs > standard/internal/testdata/golden-google.json

import { parseConfig } from "../../../lite/src/config";
import type { TransactionRow } from "../../../lite/src/ledger";
import { GoogleMappingError, googleProductRow, googleSubscriptionRow, googleSubscriptionState } from "../../../lite/src/stores/google";
import { GoogleApiError, moneyMicros } from "../../../lite/src/stores/google-api";
import { googleOneTimePurchaseEvent, googleRefundEvent, googleSubscriptionEvents } from "../../../lite/src/stores/google-events";
import { PendingPurchase, verifyPlayPurchase } from "../../../lite/src/stores/google-sync";
import { eventBody } from "../../../lite/src/webhooks";

const NOW = 1_800_000_000_000;
const DAY = 864e5;
const iso = (ms: number) => new Date(ms).toISOString();

const rawConfig = {
  version: 1,
  apps: {
    ios: {
      store: "app_store",
      bundle_id: "com.example.openpurr",
      sdk_keys: ["appl_test_ios_0123456789"],
      products: { pro_monthly: { type: "subscription" }, lifetime: { type: "non_consumable" } },
    },
    android: {
      store: "play_store",
      package_name: "com.example.openpurr",
      sdk_keys: ["goog_test_android_0123456789"],
      products: {
        pro: { type: "subscription", base_plans: ["monthly", "annual"] },
        lifetime: { type: "non_consumable" },
        coins_100: { type: "consumable" },
      },
    },
  },
  entitlements: {
    pro: { products: { ios: ["pro_monthly", "lifetime"], android: ["pro", "lifetime"] } },
    annual_perks: { products: { android: ["pro:annual"] } },
  },
  offerings: [],
};
const config = parseConfig(rawConfig);
const project = config.projects.get("default")!;
const android = config.apps.get("android")!;

// A subscriptionsv2 answer, as lite/test/helpers.ts playSubscription builds them.
const sub = (o: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  kind: "androidpublisher#subscriptionPurchaseV2",
  startTime: iso(NOW - DAY),
  regionCode: "US",
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
  testPurchase: {},
  lineItems: [
    {
      productId: "pro",
      expiryTime: iso(NOW + 29 * DAY),
      latestSuccessfulOrderId: "GPA.1234-5678-9012-34567",
      autoRenewingPlan: { autoRenewEnabled: true, recurringPrice: { currencyCode: "USD", units: "4", nanos: 990000000 } },
      offerDetails: { basePlanId: "monthly" },
      offerPhase: { basePrice: {} },
      ...item,
    },
  ],
  ...o,
});
const eur = { orderId: "GPA.1234-5678-9012-34567", total: { currencyCode: "EUR", units: "4", nanos: 490000000 } };

// --- money ---------------------------------------------------------------------------------------

const moneyCases: [string, unknown][] = [
  ["units and nanos", { currencyCode: "USD", units: "4", nanos: 990000000 }],
  ["no nanos", { currencyCode: "JPY", units: "1200" }],
  ["no units", { currencyCode: "EUR", nanos: 500000 }],
  ["rounded nanos", { currencyCode: "EUR", units: "0", nanos: 1500 }],
  ["numeric units", { currencyCode: "EUR", units: 3 }],
  ["no currency", { units: "4" }],
  ["undefined", undefined],
];
const money = moneyCases.map(([name, m]) => ({ name, money: m === undefined ? null : JSON.stringify(m), result: JSON.stringify(moneyMicros(m as never)) }));

// --- subscription rows -----------------------------------------------------------------------------

const subCases: [string, ReturnType<typeof sub> | Record<string, unknown>, unknown, string][] = [
  ["active", sub(), null, "pro"],
  ["price paid", sub(), eur, "pro"],
  ["price paid per line item", sub(), { total: { currencyCode: "USD", units: "9" }, lineItems: [{ productId: "other", total: { currencyCode: "GBP", units: "1" } }, { productId: "pro", total: { currencyCode: "CHF", units: "5", nanos: 250000000 } }] }, "pro"],
  ["line item without total", sub(), { total: { currencyCode: "USD", units: "9" }, lineItems: [{ productId: "pro" }] }, "pro"],
  ["order without total", sub(), { orderId: "x" }, "pro"],
  ["production", sub({ testPurchase: undefined }), null, "pro"],
  ["renewal order", sub({}, { latestSuccessfulOrderId: "GPA.1234-5678-9012-34567..3" }), null, "pro"],
  ["free trial", sub({}, { offerPhase: { freeTrial: {} } }), null, "pro"],
  ["free trial without recurring price", sub({}, { offerPhase: { freeTrial: {} }, autoRenewingPlan: { autoRenewEnabled: true } }), null, "pro"],
  ["intro price", sub({}, { offerPhase: { introductoryPrice: {} } }), null, "pro"],
  ["intro price, paid", sub({}, { offerPhase: { introductoryPrice: {} } }), eur, "pro"],
  ["no offer phase", sub({}, { offerPhase: undefined }), null, "pro"],
  ["prepaid", sub({}, { autoRenewingPlan: undefined, prepaidPlan: {} }), null, "pro"],
  ["no order id", sub({}, { latestSuccessfulOrderId: undefined }), null, "pro"],
  ["no order id, no expiry", sub({}, { latestSuccessfulOrderId: undefined, expiryTime: undefined }), null, "pro"],
  ["no start time", sub({ startTime: undefined }), null, "pro"],
  ["no region, no base plan", sub({ regionCode: undefined }, { offerDetails: undefined }), null, "pro"],
  ["fractional seconds", sub({ startTime: "2027-01-15T08:00:00.123Z" }, { expiryTime: "2027-02-15T08:00:00.987654Z" }), null, "pro"],
  ["offset time", sub({ startTime: "2027-01-15T08:00:00+02:00" }), null, "pro"],
  ["no line item for the product", sub({}, { productId: "other" }), null, "pro"],
  ["one-time product in config", sub({}, { productId: "lifetime" }), null, "lifetime"],
];
const subscriptionRows = subCases.map(([name, s, order, productId]) => {
  const product = android.products.get(productId)!;
  try {
    return { name, sub: JSON.stringify(s), order: order ? JSON.stringify(order) : null, productId, row: JSON.stringify(googleSubscriptionRow(s as never, "tok-1", android, product, { now: NOW, order: order as never })) };
  } catch (err) {
    return { name, sub: JSON.stringify(s), order: order ? JSON.stringify(order) : null, productId, error: (err as Error).message };
  }
});

// --- subscription states ---------------------------------------------------------------------------

const stateCases: [string, Record<string, unknown>][] = [
  ...[
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_CANCELED",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    "SUBSCRIPTION_STATE_ON_HOLD",
    "SUBSCRIPTION_STATE_PAUSED",
    "SUBSCRIPTION_STATE_EXPIRED",
    "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
    "SUBSCRIPTION_STATE_PENDING",
    "SUBSCRIPTION_STATE_UNSPECIFIED",
  ].map((s): [string, Record<string, unknown>] => [s, sub({ subscriptionState: s })]),
  ["no state", sub({ subscriptionState: undefined })],
  ["auto-renew off", sub({}, { autoRenewingPlan: { autoRenewEnabled: false } })],
  ["auto-renew unset", sub({}, { autoRenewingPlan: {} })],
  ["prepaid", sub({}, { autoRenewingPlan: undefined, prepaidPlan: {} })],
  ["paused with resume time", sub({ subscriptionState: "SUBSCRIPTION_STATE_PAUSED", pausedStateContext: { autoResumeTime: iso(NOW + 20 * DAY) } })],
  ["active with resume time", sub({ pausedStateContext: { autoResumeTime: iso(NOW + 20 * DAY) } })],
  ["grace without expiry", sub({ subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" }, { expiryTime: undefined })],
  ["no line items", sub({ lineItems: [] })],
];
const subscriptionStates = stateCases.map(([name, s]) => ({ name, sub: JSON.stringify(s), state: JSON.stringify(googleSubscriptionState(s as never, "tok-1", NOW)) }));

// --- one-time products -----------------------------------------------------------------------------

const product = (o: Record<string, unknown> = {}) => ({
  orderId: "GPA.3333-4444-5555-66666",
  purchaseTimeMillis: String(NOW - 1000),
  purchaseState: 0,
  acknowledgementState: 0,
  purchaseType: 0,
  regionCode: "DE",
  ...o,
});
const productCases: [string, Record<string, unknown>, unknown, string][] = [
  ["license test", product(), null, "lifetime"],
  ["production", product({ purchaseType: undefined }), null, "lifetime"],
  ["promo", product({ purchaseType: 1 }), null, "lifetime"],
  ["consumable, price paid", product(), { total: { currencyCode: "EUR", units: "0", nanos: 990000000 } }, "coins_100"],
  ["canceled", product({ purchaseState: 1 }), null, "lifetime"],
  ["pending", product({ purchaseState: 2 }), null, "lifetime"],
  ["no order id", product({ orderId: undefined }), null, "lifetime"],
  ["no purchase time", product({ purchaseTimeMillis: undefined }), null, "lifetime"],
  ["numeric purchase time", product({ purchaseTimeMillis: NOW - 5000 }), null, "lifetime"],
  ["no region", product({ regionCode: undefined }), null, "lifetime"],
  ["subscription in config", product(), null, "pro"],
];
const productRows = productCases.map(([name, p, order, productId]) => {
  const prod = android.products.get(productId)!;
  try {
    return { name, product: JSON.stringify(p), order: order ? JSON.stringify(order) : null, productId, row: JSON.stringify(googleProductRow(p as never, "tok-2", android, prod, { now: NOW, order: order as never })) };
  } catch (err) {
    return { name, product: JSON.stringify(p), order: order ? JSON.stringify(order) : null, productId, error: (err as Error).message };
  }
});

// --- events ----------------------------------------------------------------------------------------

const row = (o: Partial<TransactionRow> = {}): TransactionRow => ({
  app_id: "android",
  store: "play_store",
  environment: "sandbox",
  transaction_id: "GPA.1234-5678-9012-34567..1",
  original_transaction_id: "tok-1",
  product_id: "pro",
  base_plan_id: "monthly",
  product_type: "subscription",
  purchased_at: NOW - DAY,
  original_purchased_at: NOW - 31 * DAY,
  expires_at: NOW + 29 * DAY,
  period_type: "normal",
  ownership_type: "PURCHASED",
  price_micros: 4990000,
  currency: "USD",
  storefront: "US",
  revoked_at: null,
  revocation_reason: null,
  is_upgraded: 0,
  verified: 1,
  subscription_group: null,
  ...o,
});
const canceled = (ctx: Record<string, unknown>) => sub({ subscriptionState: "SUBSCRIPTION_STATE_CANCELED", canceledStateContext: ctx });

const eventCases: [string, unknown, Record<string, unknown>, Partial<TransactionRow>, { previousPeriodType?: string | null; replacedProductId?: string | null }][] = [
  ["purchased", 4, sub(), {}, {}],
  ["purchased, plan change", 4, sub(), { base_plan_id: "annual" }, { replacedProductId: "pro:monthly" }],
  ["purchased, same plan re-signup", 4, sub(), {}, { replacedProductId: "pro:monthly" }],
  ["purchased, no base plan", 4, sub(), { base_plan_id: null }, { replacedProductId: "pro:monthly" }],
  ["purchased, no base plan either side", 4, sub(), { base_plan_id: null }, { replacedProductId: "pro:null" }],
  ["renewed after trial", 2, sub(), {}, { previousPeriodType: "trial" }],
  ["renewed", 2, sub(), {}, { previousPeriodType: "normal" }],
  ["renewed, first seen", 2, sub(), {}, {}],
  ["recovered", 1, sub(), {}, { previousPeriodType: "intro" }],
  ["restarted", 7, sub(), {}, {}],
  ["canceled by user", 3, canceled({ userInitiatedCancellation: { cancelTime: iso(NOW) } }), {}, {}],
  ["canceled by system", 3, canceled({ systemInitiatedCancellation: {} }), {}, {}],
  ["canceled by developer", 3, canceled({ developerInitiatedCancellation: {} }), {}, {}],
  ["canceled by replacement", 3, canceled({ replacementCancellation: {} }), {}, {}],
  ["canceled without context", 3, sub(), {}, {}],
  ["canceled, empty context", 3, canceled({}), {}, {}],
  ["grace period", 6, sub(), {}, {}],
  ["grace period, no expiry", 6, sub(), { expires_at: null }, {}],
  ["on hold", 5, sub(), {}, {}],
  ["expired", 13, sub(), {}, {}],
  ["expired after cancel", 13, canceled({ userInitiatedCancellation: {} }), {}, {}],
  ["expired after billing", 13, canceled({ systemInitiatedCancellation: {} }), {}, {}],
  ["expired after replacement", 13, canceled({ replacementCancellation: {} }), {}, {}],
  ["pause scheduled", 11, sub({ pausedStateContext: { autoResumeTime: iso(NOW + 30 * DAY) } }), {}, {}],
  ["pause schedule cleared", 11, sub(), {}, {}],
  ["paused", 10, sub(), {}, {}],
  ["deferred", 9, sub(), {}, {}],
  ["revoked", 12, sub(), { revoked_at: NOW, revocation_reason: "revoked" }, {}],
  ["price change confirmed (8)", 8, sub(), {}, {}],
  ["pending purchase canceled (20)", 20, sub(), {}, {}],
  ["type as a string", "4", sub(), {}, {}],
];
const subscriptionEvents = eventCases.map(([name, type, s, o, opts]) => ({
  name,
  type: JSON.stringify(type),
  sub: JSON.stringify(s),
  row: JSON.stringify(row(o)),
  previousPeriodType: opts.previousPeriodType ?? "",
  replacedProductId: opts.replacedProductId ?? "",
  events: JSON.stringify(googleSubscriptionEvents(type as number, "msg-1", s as never, row(o), opts)),
}));
const otherEvents = [
  { name: "refund", row: JSON.stringify(row({ revoked_at: NOW })), events: JSON.stringify([googleRefundEvent(row({ revoked_at: NOW }))]) },
  {
    name: "one-time purchase",
    row: JSON.stringify(row({ product_id: "lifetime", product_type: "non_consumable", transaction_id: "GPA.3333-4444-5555-66666", expires_at: null, base_plan_id: null })),
    events: JSON.stringify([googleOneTimePurchaseEvent(row({ product_id: "lifetime", product_type: "non_consumable", transaction_id: "GPA.3333-4444-5555-66666", expires_at: null, base_plan_id: null }))]),
  },
];

// --- event bodies ----------------------------------------------------------------------------------

const customer = {
  id: "c1",
  appUserId: "user@example",
  originalAppUserId: "$RCAnonymousID:abc",
  aliases: ["$RCAnonymousID:abc", "user@example"],
  attributes: { $email: { value: "a@example.com", updated_at_ms: 5 } },
};
const bodyCases: [string, Record<string, unknown>][] = [
  ["initial purchase", { type: "INITIAL_PURCHASE", transaction: row({ transaction_id: "GPA.1234-5678-9012-34567" }) }],
  ["renewal after trial", { type: "RENEWAL", transaction: row(), extra: { is_trial_conversion: true } }],
  ["product change", { type: "PRODUCT_CHANGE", transaction: row({ base_plan_id: "annual" }), extra: { new_product_id: "pro:annual" } }],
  ["billing issue", { type: "BILLING_ISSUE", transaction: row(), extra: { grace_period_expiration_at_ms: NOW + 3 * DAY } }],
  ["billing cancellation", { type: "CANCELLATION", transaction: row(), extra: { cancel_reason: "BILLING_ERROR" } }],
  ["expiration, paused", { type: "EXPIRATION", transaction: row(), extra: { expiration_reason: "SUBSCRIPTION_PAUSED" } }],
  ["paused", { type: "SUBSCRIPTION_PAUSED", transaction: row(), extra: { auto_resume_at_ms: NOW + 30 * DAY } }],
  ["extended", { type: "SUBSCRIPTION_EXTENDED", transaction: row() }],
  ["uncancellation", { type: "UNCANCELLATION", transaction: row() }],
  ["refund", { type: "CANCELLATION", transaction: row({ revoked_at: NOW, revocation_reason: "voided" }), negativePrice: true, priceUsd: -4.99, extra: { cancel_reason: "CUSTOMER_SUPPORT" } }],
  ["one-time, production, EUR", { type: "NON_RENEWING_PURCHASE", environment: "production", transaction: row({ environment: "production", product_id: "lifetime", product_type: "non_consumable", base_plan_id: null, expires_at: null, currency: "EUR", price_micros: 9990000, storefront: "DE" }), priceUsd: 10.5 }],
  ["no price, no region", { type: "INITIAL_PURCHASE", transaction: row({ price_micros: null, currency: null, storefront: null, period_type: "trial" }) }],
];
const eventBodies = bodyCases.map(([name, o]) => {
  const input = { dedupeKey: "k", appId: "android", environment: "sandbox", store: "play_store", now: NOW, ...o, customer };
  return {
    name,
    type: o.type,
    environment: input.environment,
    transaction: JSON.stringify(input.transaction),
    extra: o.extra ? JSON.stringify(o.extra) : null,
    negativePrice: !!o.negativePrice,
    priceUsd: "priceUsd" in o ? o.priceUsd : null,
    body: JSON.stringify(eventBody(project, input as never, "event-id")),
  };
});

// --- verifying a posted purchase -------------------------------------------------------------------

type Answer = { status?: number; body?: unknown };
const verifyCases: [string, string, Record<string, Answer>][] = [
  ["subscription, order readable", "pro", { sub: { body: sub() }, order: { body: eur } }],
  ["subscription, order forbidden", "pro", { sub: { body: sub({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }) }, order: { status: 403 } }],
  ["subscription, linked token", "pro", { sub: { body: sub({ linkedPurchaseToken: "tok-old" }, { offerDetails: { basePlanId: "annual" } }) }, order: { body: {} } }],
  ["subscription, pending", "pro", { sub: { body: sub({ subscriptionState: "SUBSCRIPTION_STATE_PENDING" }) } }],
  ["subscription, pending canceled", "pro", { sub: { body: sub({ subscriptionState: "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED" }) } }],
  ["subscription, no order id", "pro", { sub: { body: sub({}, { latestSuccessfulOrderId: undefined }) } }],
  ["subscription, wrong product", "pro", { sub: { body: sub({}, { productId: "other" }) } }],
  ["subscription, unknown token", "pro", { sub: { status: 410 } }],
  ["non-consumable", "lifetime", { product: { body: product() }, order: { body: { total: { currencyCode: "EUR", units: "19", nanos: 990000000 } } } }],
  ["non-consumable, acknowledged", "lifetime", { product: { body: product({ acknowledgementState: 1 }) }, order: { status: 403 } }],
  ["consumable", "coins_100", { product: { body: product() }, order: { status: 403 } }],
  ["one-time, pending", "lifetime", { product: { body: product({ purchaseState: 2 }) } }],
  ["one-time, canceled", "lifetime", { product: { body: product({ purchaseState: 1 }) }, order: { status: 403 } }],
];
const fail = (status: number) => {
  throw new GoogleApiError(status, `Google Play Developer API ${status}: GET`);
};
const verifications = await Promise.all(
  verifyCases.map(async ([name, productId, answers]) => {
    const answer = (a: Answer | undefined) => (a === undefined ? fail(404) : a.status ? fail(a.status) : a.body);
    const client = {
      packageName: "com.example.openpurr",
      subscription: async () => answer(answers.sub),
      product: async () => answer(answers.product),
      order: async () => answer(answers.order),
    } as never;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const result = await verifyPlayPurchase(client, android, "tok-v", productId, { now: NOW });
      return { name, productId, answers: JSON.stringify(answers), result: JSON.stringify(result) };
    } catch (err) {
      const kind = err instanceof GoogleApiError ? `api ${err.status}` : err instanceof PendingPurchase ? "pending" : err instanceof GoogleMappingError ? "mapping" : "other";
      return { name, productId, answers: JSON.stringify(answers), error: `${kind}: ${(err as Error).message}` };
    } finally {
      console.warn = warn;
    }
  }),
);

console.log(
  JSON.stringify(
    { now: NOW, config: rawConfig, money, subscriptionRows, subscriptionStates, productRows, subscriptionEvents, otherEvents, eventBodies, verifications },
    null,
    1,
  ),
);
