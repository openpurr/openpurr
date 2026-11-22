// Importing purchases from another backend (POST /admin/v1/import): the store is asked, the row's
// app user becomes the owner, nobody loses a purchase they already have, and no webhooks go out.
// Ported from lite/test/import.test.ts.
//
// DB reads are replaced by the admin API (customer detail, the audit log, the new-customers
// chart) and by the fake webhook receiver. The rollup's waiting during an import is Lite's (it
// protects the free plan's daily writes) and checked only there, through the refresh endpoint.
//
// Skipped: "stops near a free-plan daily limit": the usage snapshot comes from Cloudflare's API,
// which the conformance Worker can't reach without a CLOUDFLARE_ANALYTICS_TOKEN secret.
// Changed: the 409 for a missing App Store key is checked with a config that has no
// app_store_server_api, since the server's secrets are fixed.

import { beforeEach, describe, expect, it } from "vitest";
import {
  admin,
  advanceClock,
  call,
  createOperator,
  DAY,
  fake,
  itEdition,
  now,
  playSubscription,
  reset,
  setClock,
  settle,
  signJws,
  signTransaction,
  testConfig,
  withAppleApi,
  withGooglePlay,
  withWebhooks,
} from "../src";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** App Store and Play API access, and a webhook. */
const importConfig = () => withWebhooks(withGooglePlay(withAppleApi()));

async function importRow(row: object, opts: { dryRun?: boolean; session?: string } = {}) {
  return admin("POST", "/import", opts.session ? { session: opts.session } : {}, { body: { row, ...(opts.dryRun ? { dry_run: true } : {}) } });
}

/** Apple answers for a customer with one annual subscription (original transaction `original`). */
async function appleCustomer(original: string, opts: { firstPurchase?: number; expires?: number } = {}) {
  const firstPurchase = opts.firstPurchase ?? now() - 400 * DAY;
  const expires = opts.expires ?? now() + 100 * DAY;
  const first = await signTransaction({
    transactionId: original,
    originalTransactionId: original,
    productId: "pro_annual",
    purchaseDate: firstPurchase,
    originalPurchaseDate: firstPurchase,
    expiresDate: firstPurchase + 365 * DAY,
  });
  const latest = await signTransaction({
    transactionId: `${original}9`,
    originalTransactionId: original,
    productId: "pro_annual",
    purchaseDate: expires - 365 * DAY,
    originalPurchaseDate: firstPurchase,
    expiresDate: expires,
  });
  const renewal = await signJws({ originalTransactionId: original, productId: "pro_annual", autoRenewStatus: 1, signedDate: now() });
  return fake.apple({
    [`sandbox GET /inApps/v2/history/${original}`]: () => ({ body: { signedTransactions: [latest.jws, first.jws], hasMore: false, revision: "r" } }),
    [`sandbox GET /inApps/v1/subscriptions/${original}`]: () => ({
      body: { data: [{ subscriptionGroupIdentifier: "21000000", lastTransactions: [{ originalTransactionId: original, status: 1, signedTransactionInfo: latest.jws, signedRenewalInfo: renewal }] }] },
    }),
  });
}

const customerInfo = async (appUserId: string) => (await call(`/v1/subscribers/${encodeURIComponent(appUserId)}`)).body.subscriber;
const customer = (appUserId: string) => admin("GET", `/customers/${encodeURIComponent(appUserId)}`);

async function refresh() {
  const res = await admin("POST", "/metrics/refresh", {}, { body: {} });
  expect(res.status).toBe(200);
  return res.body as { refreshed: boolean; from: string | null; rows: number; deferred?: boolean; updated_at: number | null };
}

beforeEach(async () => {
  await reset(importConfig());
});

describe("importing App Store purchases", () => {
  it("asks Apple for the customer's history and makes the row's app user the owner", async () => {
    const firstPurchase = now() - 400 * DAY;
    const expires = now() + 100 * DAY;
    await appleCustomer("4000000001", { firstPurchase, expires });
    const r = await importRow({ app_user_id: "rc-user-1", store: "APP_STORE", transaction_id: "4000000001" });
    expect(r.status).toBe(200);
    // Like a receipt: the latest transaction of each subscription is what's kept.
    expect(r.body).toMatchObject({ app_user_id: "rc-user-1", app_id: "ios", created: true, transactions: 1, kept_owner: [], dry_run: false });
    expect(r.body.transaction_ids).toEqual(expect.arrayContaining(["4000000001", "40000000019"]));

    const sub = await customerInfo("rc-user-1");
    expect(sub.entitlements.pro).toMatchObject({ product_identifier: "pro_annual", expires_date: iso(expires) });
    // Backdated to the first purchase, so the import day doesn't fill up with "new" customers.
    expect(sub.first_seen).toBe(iso(firstPurchase));

    // Not a new purchase: no webhook events, and the import is in the audit log.
    await settle();
    expect((await customer("rc-user-1")).body.webhook_events).toEqual([]);
    expect(fake.received()).toEqual([]);
    const audit = (await admin("GET", "/audit")).body.entries as { action: string; target: string }[];
    expect(audit.find((e) => e.action === "customers.import" && e.target === "rc-user-1")).toBeDefined();
  });

  it("is safe to run again", async () => {
    await appleCustomer("4000000002");
    await importRow({ app_user_id: "rc-user-2", transaction_id: "4000000002" });
    const again = await importRow({ app_user_id: "rc-user-2", transaction_id: "4000000002" });
    expect(again.body).toMatchObject({ created: false, transactions: 1, kept_owner: [] });
    const txs = (await customer("rc-user-2")).body.transactions as { original_transaction_id: string }[];
    expect(txs.filter((t) => t.original_transaction_id === "4000000002")).toHaveLength(1);
  });

  it("never takes a purchase away from a customer the app already posted it for", async () => {
    await appleCustomer("4000000003");
    // The app switched to openpurr first and posted the purchase for its current user.
    const { jws } = await signTransaction({ transactionId: "40000000039", originalTransactionId: "4000000003", productId: "pro_annual", expiresDate: now() + 100 * DAY });
    expect((await call("/v1/receipts", { body: { app_user_id: "device-user", fetch_token: jws } })).status).toBe(200);

    const r = await importRow({ app_user_id: "rc-other", transaction_id: "4000000003" });
    expect(r.status).toBe(200);
    expect(r.body.kept_owner).toEqual([{ original_transaction_id: "4000000003", app_user_id: "device-user" }]);
    expect((await customerInfo("device-user")).entitlements.pro).toBeDefined();
    expect((await customerInfo("rc-other")).entitlements.pro).toBeUndefined();
  });

  it("reports what would happen on a dry run, writing nothing", async () => {
    await appleCustomer("4000000004");
    const r = await importRow({ app_user_id: "rc-dry", transaction_id: "4000000004", attributes: { $email: "dry@example.com" } }, { dryRun: true });
    expect(r.body).toMatchObject({ dry_run: true, created: true, transactions: 1, attributes: 1 });
    expect((await customer("rc-dry")).status).toBe(404);
    expect((await admin("GET", "/customers")).body.customers).toEqual([]);
  });

  it("skips a transaction Apple doesn't know (422), and stops when the API key is missing (409)", async () => {
    const unknown = await importRow({ app_user_id: "rc-x", transaction_id: "999" });
    expect(unknown).toMatchObject({ status: 422, body: { code: "not_found_at_store" } });

    await reset(withGooglePlay(testConfig()));
    const res = await importRow({ app_user_id: "rc-x", transaction_id: "999" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "store_not_configured", message: expect.stringMatching(/app_store_server_api/) });
  });

  it("counts backdated customers in the new-customers chart once the rollup has passed their day", async () => {
    const firstPurchase = Date.parse("2025-03-14T10:00:00Z");
    await refresh(); // the charts are up to date as of now
    await appleCustomer("4000000005", { firstPurchase });
    await importRow({ app_user_id: "rc-chart", transaction_id: "4000000005" });
    await settle();
    const chart = await admin("GET", "/metrics/new_customers?from=2025-03-14&to=2025-03-14");
    expect(chart.body.points[0].values.customers).toBe(1);
  });
});

describe("charts during an import", () => {
  itEdition("lite", "wait until an hour after the last imported row, then catch up in one run", async () => {
    await setClock(Date.now() - 3 * DAY);
    const start = (await refresh()).updated_at;
    await setClock(Date.now());
    await appleCustomer("4000000009");
    await importRow({ app_user_id: "rc-charts", transaction_id: "4000000009" });
    await advanceClock(10 * 60_000);
    const during = await refresh();
    expect(during).toMatchObject({ deferred: true, rows: 0, updated_at: start });
    await advanceClock(3600_000);
    const after = await refresh();
    expect(after.deferred).toBeUndefined();
    // Recomputed from the imported purchase (its latest renewal, about 265 days back), not just the last 3 days.
    expect(after.from! <= new Date(now() - 260 * DAY).toISOString().slice(0, 10)).toBe(true);
  });
});

describe("importing Google Play purchases", () => {
  it("verifies the purchase token, accepting RevenueCat's product:base_plan form", async () => {
    const expiry = now() + 20 * DAY;
    const google = fake.google({
      "GET /purchases/subscriptionsv2/tokens/rc-tok-1": () => ({ body: playSubscription({ ack: true, expiry, orderId: "GPA.1111-1111-1111-11111" }) }),
    });
    const r = await importRow({ app_user_id: "rc-android", store: "PLAY_STORE", purchase_token: "rc-tok-1", product_id: "pro:monthly" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ app_id: "android", created: true, transactions: 1 });
    expect((await customerInfo("rc-android")).entitlements.pro).toMatchObject({ expires_date: iso(expiry), product_plan_identifier: "monthly" });
    // Already acknowledged (by the old backend): nothing to acknowledge.
    await settle();
    expect(google.requests().some((x) => x.method === "POST")).toBe(false);
  });

  it("explains rows it can't use: an order ID instead of a token, or a product the config lacks", async () => {
    const orderId = await importRow({ app_user_id: "rc-a", store: "play_store", transaction_id: "GPA.1234-5678-9012-34567" });
    expect(orderId).toMatchObject({ status: 400, body: { message: expect.stringMatching(/purchase_token/) } });
    const unknown = await importRow({ app_user_id: "rc-a", purchase_token: "t", product_id: "gold:monthly" });
    expect(unknown).toMatchObject({ status: 422, body: { code: "unknown_products", message: expect.stringMatching(/gold/) } });
  });
});

describe("aliases and attributes", () => {
  it("adds them to an existing customer without overwriting what the app set", async () => {
    await appleCustomer("4000000006");
    await importRow({ app_user_id: "rc-attr", transaction_id: "4000000006" });
    await call("/v1/subscribers/rc-attr/attributes", { body: { attributes: { $email: { value: "new@example.com", updated_at_ms: now() } } } });

    const r = await importRow({ app_user_id: "rc-attr", aliases: "$RCAnonymousID:00000000000000000000000000000abc|rc-attr", attributes: { $email: "old@example.com", $displayName: "Jane" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ aliases_added: ["$RCAnonymousID:00000000000000000000000000000abc"], attributes: 2 });
    const attrs = (await customer("rc-attr")).body.attributes as Record<string, { value: string }>;
    expect(Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, v.value]))).toEqual({ $displayName: "Jane", $email: "new@example.com" });
    // The alias reaches the same customer.
    expect((await customerInfo("$RCAnonymousID:00000000000000000000000000000abc")).entitlements.pro).toBeDefined();
  });

  it("doesn't create customers from rows without a purchase", async () => {
    const r = await importRow({ app_user_id: "rc-nobody", attributes: { $email: "x@example.com" } });
    expect(r).toMatchObject({ status: 422, body: { code: "no_customer" } });
  });
});

describe("limits and permissions", () => {
  // The usage snapshot comes from Cloudflare's GraphQL API, which needs CLOUDFLARE_ANALYTICS_TOKEN;
  // the conformance Worker has none, so there's no way to bring usage near a limit over HTTP.
  it.skip("stops near a free-plan daily limit, so the app's own traffic keeps working", () => {});

  it("needs the customers:import permission (owners and admins)", async () => {
    await appleCustomer("4000000008");
    const developer = await createOperator("developer");
    const adminOp = await createOperator("admin");
    expect((await importRow({ app_user_id: "rc-p", transaction_id: "4000000008" }, { session: developer.session })).status).toBe(403);
    expect((await importRow({ app_user_id: "rc-p", transaction_id: "4000000008" }, { session: adminOp.session })).status).toBe(200);
  });

  it("validates rows", async () => {
    expect((await importRow({ transaction_id: "1" })).body.message).toMatch(/app_user_id is required/);
    expect((await importRow({ app_user_id: "u", store: "amazon", transaction_id: "1" })).body.message).toMatch(/Unknown store/);
    expect((await importRow({ app_user_id: "u", transaction_id: "1", purchase_token: "t" })).body.message).toMatch(/not both/);
    expect((await importRow({ app_user_id: "u", transaction_id: "1", first_seen: "soon" })).body.message).toMatch(/first_seen/);
  });
});
