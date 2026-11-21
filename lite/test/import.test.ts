// Importing purchases from another backend (POST /admin/v1/import): the store is asked, the row's
// app user becomes the owner, nobody loses a purchase they already have, and no webhooks go out.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { base64ToBytes } from "../src/lib/der";
import { parseConfig } from "../src/config";
import { IMPORT_QUIET_MS, lastRollupAt, rollupMetrics } from "../src/metrics";
import { SESSION_COOKIE } from "../src/office/auth";
import { hashPassword, randomToken, sha256Hex } from "../src/office/auth-crypto";
import { mountOffice } from "../src/office/app";
import { mountSdk } from "../src/sdk-app";
import { TEST_ROOT_CERT_B64 } from "../src/bench/fixtures.generated";
import {
  API_ISSUER_ID,
  API_KEY_ID,
  call,
  envWithAppleKey,
  envWithGoogleKey,
  fakeAppleApi,
  fakeGoogleApi,
  playSubscription,
  rawTestConfig,
  signJws,
  signTransaction,
  WEBHOOK_URL,
} from "./helpers";

const DAY = 864e5;
const SECRET = "test-operator-secret-0123456789abcdef";
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** An app with App Store and Play API access and a webhook, its store calls going to `stores`. */
function importApp(stores: { fetch: typeof fetch }) {
  const raw = structuredClone(rawTestConfig) as any;
  raw.apps.ios.app_store_server_api = { issuer_id: API_ISSUER_ID, key_id: API_KEY_ID };
  delete raw.apps.android.allow_unverified_purchases;
  raw.apps.android.google_play_api = { service_account_secret: "GOOGLE_SERVICE_ACCOUNT" };
  raw.webhooks = [{ id: "backend", url: WEBHOOK_URL }];
  const webhookCalls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith(WEBHOOK_URL)) {
      webhookCalls.push(String(init?.body));
      return new Response("ok");
    }
    return stores.fetch(input, init);
  }) as typeof fetch;
  const app = createApp({ config: parseConfig(raw), appleRoots: [base64ToBytes(TEST_ROOT_CERT_B64)], fetch: fetchImpl, rateLimiters: () => ({}) }, (a) => {
    mountSdk(a);
    mountOffice(a);
  });
  return { app, webhookCalls };
}

/** Apple and Google fakes behind one fetch. */
function stores(apple: ReturnType<typeof fakeAppleApi>, google: ReturnType<typeof fakeGoogleApi> = fakeGoogleApi({})) {
  return {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).hostname.includes("storekit") ? apple.fetch(input, init) : google.fetch(input, init)) as typeof fetch,
  };
}

const importEnv = () => ({ ...envWithAppleKey(), ...envWithGoogleKey(), APPLE_IAP_KEY: envWithAppleKey().APPLE_IAP_KEY, OPERATOR_SECRET: SECRET });

async function session(role: "owner" | "admin" | "developer" | "viewer" = "owner") {
  const id = crypto.randomUUID();
  const s = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, password_hash, totp_enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").bind(
      id,
      `${role}-${id}@example.com`,
      role,
      role,
      await hashPassword(SECRET, "a long test passphrase"),
      Date.now(),
    ),
    env.DB.prepare("INSERT INTO session (token_hash, operator_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, 'full', ?, ?, ?)").bind(
      await sha256Hex(s),
      id,
      Date.now(),
      Date.now() + 3600_000,
      Date.now(),
    ),
  ]);
  return s;
}

async function importRow(app: { fetch: typeof fetch } | ReturnType<typeof importApp>["app"], row: object, opts: { dryRun?: boolean; role?: "owner" | "admin" | "developer" | "viewer" } = {}) {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request("https://openpurr.test/admin/v1/import", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${await session(opts.role)}`, origin: "https://openpurr.test", "content-type": "application/json" },
      body: JSON.stringify({ row, ...(opts.dryRun ? { dry_run: true } : {}) }),
    }),
    importEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.json<any>() };
}

/** Apple's answer for a customer with one annual subscription (original transaction `original`). */
async function appleCustomer(original: string, opts: { firstPurchase?: number; expires?: number } = {}) {
  const firstPurchase = opts.firstPurchase ?? Date.now() - 400 * DAY;
  const expires = opts.expires ?? Date.now() + 100 * DAY;
  const first = await signTransaction({ transactionId: original, originalTransactionId: original, productId: "pro_annual", purchaseDate: firstPurchase, originalPurchaseDate: firstPurchase, expiresDate: firstPurchase + 365 * DAY });
  const latest = await signTransaction({
    transactionId: `${original}9`,
    originalTransactionId: original,
    productId: "pro_annual",
    purchaseDate: expires - 365 * DAY,
    originalPurchaseDate: firstPurchase,
    expiresDate: expires,
  });
  const renewal = await signJws({ originalTransactionId: original, productId: "pro_annual", autoRenewStatus: 1, signedDate: Date.now() });
  return fakeAppleApi({
    [`sandbox GET /inApps/v2/history/${original}`]: () => ({ body: { signedTransactions: [latest.jws, first.jws], hasMore: false, revision: "r" } }),
    [`sandbox GET /inApps/v1/subscriptions/${original}`]: () => ({
      body: { data: [{ subscriptionGroupIdentifier: "21000000", lastTransactions: [{ originalTransactionId: original, status: 1, signedTransactionInfo: latest.jws, signedRenewalInfo: renewal }] }] },
    }),
  });
}

const customerInfo = async (app: ReturnType<typeof importApp>["app"], appUserId: string) =>
  (await (await call(`/v1/subscribers/${encodeURIComponent(appUserId)}`, { app, env: importEnv() })).json<any>()).subscriber;

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM job_state WHERE key IN ('usage', 'metrics_rollup', 'import_active')"), env.DB.prepare("DELETE FROM setting WHERE key = 'cloudflare_plan'")]);
});

describe("importing App Store purchases", () => {
  it("asks Apple for the customer's history and makes the row's app user the owner", async () => {
    const firstPurchase = Date.now() - 400 * DAY;
    const expires = Date.now() + 100 * DAY;
    const { app, webhookCalls } = importApp(stores(await appleCustomer("4000000001", { firstPurchase, expires })));
    const r = await importRow(app, { app_user_id: "rc-user-1", store: "APP_STORE", transaction_id: "4000000001" });
    expect(r.status).toBe(200);
    // Like a receipt: the latest transaction of each subscription is what's kept.
    expect(r.body).toMatchObject({ app_user_id: "rc-user-1", app_id: "ios", created: true, transactions: 1, kept_owner: [], dry_run: false });
    expect(r.body.transaction_ids).toEqual(expect.arrayContaining(["4000000001", "40000000019"]));

    const sub = await customerInfo(app, "rc-user-1");
    expect(sub.entitlements.pro).toMatchObject({ product_identifier: "pro_annual", expires_date: iso(expires) });
    // Backdated to the first purchase, so the import day doesn't fill up with "new" customers.
    expect(sub.first_seen).toBe(iso(firstPurchase));

    // Not a new purchase: no webhook events, and the import is in the audit log.
    const events = await env.DB.prepare("SELECT count(*) AS n FROM webhook_event e JOIN customer_alias a ON a.customer_id = e.customer_id WHERE a.app_user_id = 'rc-user-1'").first<{ n: number }>();
    expect(events!.n).toBe(0);
    expect(webhookCalls).toEqual([]);
    const audit = await env.DB.prepare("SELECT action, target FROM audit_log WHERE action = 'customers.import' AND target = 'rc-user-1'").first();
    expect(audit).toEqual({ action: "customers.import", target: "rc-user-1" });
  });

  it("is safe to run again", async () => {
    const { app } = importApp(stores(await appleCustomer("4000000002")));
    await importRow(app, { app_user_id: "rc-user-2", transaction_id: "4000000002" });
    const again = await importRow(app, { app_user_id: "rc-user-2", transaction_id: "4000000002" });
    expect(again.body).toMatchObject({ created: false, transactions: 1, kept_owner: [] });
    const n = await env.DB.prepare("SELECT count(*) AS n FROM store_transaction WHERE original_transaction_id = '4000000002'").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("never takes a purchase away from a customer the app already posted it for", async () => {
    const api = await appleCustomer("4000000003");
    const { app } = importApp(stores(api));
    // The app switched to openpurr first and posted the purchase for its current user.
    const { jws } = await signTransaction({ transactionId: "40000000039", originalTransactionId: "4000000003", productId: "pro_annual", expiresDate: Date.now() + 100 * DAY });
    expect((await call("/v1/receipts", { app, env: importEnv(), body: { app_user_id: "device-user", fetch_token: jws } })).status).toBe(200);

    const r = await importRow(app, { app_user_id: "rc-other", transaction_id: "4000000003" });
    expect(r.status).toBe(200);
    expect(r.body.kept_owner).toEqual([{ original_transaction_id: "4000000003", app_user_id: "device-user" }]);
    expect((await customerInfo(app, "device-user")).entitlements.pro).toBeDefined();
    expect((await customerInfo(app, "rc-other")).entitlements.pro).toBeUndefined();
  });

  it("reports what would happen on a dry run, writing nothing", async () => {
    const { app } = importApp(stores(await appleCustomer("4000000004")));
    const r = await importRow(app, { app_user_id: "rc-dry", transaction_id: "4000000004", attributes: { $email: "dry@example.com" } }, { dryRun: true });
    expect(r.body).toMatchObject({ dry_run: true, created: true, transactions: 1, attributes: 1 });
    const c = await env.DB.prepare("SELECT count(*) AS n FROM customer_alias WHERE app_user_id = 'rc-dry'").first<{ n: number }>();
    const t = await env.DB.prepare("SELECT count(*) AS n FROM store_transaction WHERE original_transaction_id = '4000000004'").first<{ n: number }>();
    expect([c!.n, t!.n]).toEqual([0, 0]);
  });

  it("skips a transaction Apple doesn't know (422), and stops when the API key is missing (409)", async () => {
    const { app } = importApp(stores(fakeAppleApi({})));
    const unknown = await importRow(app, { app_user_id: "rc-x", transaction_id: "999" });
    expect(unknown).toMatchObject({ status: 422, body: { code: "not_found_at_store" } });

    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request("https://openpurr.test/admin/v1/import", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${await session()}`, origin: "https://openpurr.test", "content-type": "application/json" },
        body: JSON.stringify({ row: { app_user_id: "rc-x", transaction_id: "999" } }),
      }),
      { ...env, OPERATOR_SECRET: SECRET },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(409);
    expect((await res.json<any>()).message).toMatch(/APPLE_IAP_KEY/);
  });

  it("counts backdated customers in the new-customers chart once the rollup has passed their day", async () => {
    const firstPurchase = Date.parse("2025-03-14T10:00:00Z");
    await env.DB.prepare("INSERT INTO job_state (key, value, updated_at) VALUES ('metrics_rollup', ?, ?)").bind(JSON.stringify({ at: Date.now() }), Date.now()).run();
    const { app } = importApp(stores(await appleCustomer("4000000005", { firstPurchase })));
    await importRow(app, { app_user_id: "rc-chart", transaction_id: "4000000005" });
    const row = await env.DB.prepare("SELECT value FROM metric_daily WHERE metric = 'new_customers' AND date = '2025-03-14' AND project_id = 'default'").first<{ value: number }>();
    expect(row!.value).toBe(1);
  });
});

describe("charts during an import", () => {
  it("wait until an hour after the last imported row, then catch up in one run", async () => {
    const start = Date.now() - 3 * DAY;
    await rollupMetrics(env.DB, start);
    const { app } = importApp(stores(await appleCustomer("4000000009")));
    await importRow(app, { app_user_id: "rc-charts", transaction_id: "4000000009" });
    const during = await rollupMetrics(env.DB, Date.now() + 10 * 60_000);
    expect(during).toMatchObject({ deferred: true, rows: 0 });
    expect(await lastRollupAt(env.DB)).toBe(start);
    const after = await rollupMetrics(env.DB, Date.now() + IMPORT_QUIET_MS + 60_000);
    expect(after.deferred).toBeUndefined();
    // Recomputed from the imported purchase (its latest renewal, about 265 days back), not just the last 3 days.
    expect(after.from! <= new Date(Date.now() - 260 * DAY).toISOString().slice(0, 10)).toBe(true);
  });
});

describe("importing Google Play purchases", () => {
  it("verifies the purchase token, accepting RevenueCat's product:base_plan form", async () => {
    const expiry = Date.now() + 20 * DAY;
    const google = fakeGoogleApi({
      "GET /purchases/subscriptionsv2/tokens/rc-tok-1": () => ({ body: playSubscription({ ack: true, expiry, orderId: "GPA.1111-1111-1111-11111" }) }),
    });
    const { app } = importApp(stores(fakeAppleApi({}), google));
    const r = await importRow(app, { app_user_id: "rc-android", store: "PLAY_STORE", purchase_token: "rc-tok-1", product_id: "pro:monthly" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ app_id: "android", created: true, transactions: 1 });
    expect((await customerInfo(app, "rc-android")).entitlements.pro).toMatchObject({ expires_date: iso(expiry), product_plan_identifier: "monthly" });
    // Already acknowledged (by the old backend): nothing to acknowledge.
    expect(google.requests.some((x) => x.method === "POST")).toBe(false);
  });

  it("explains rows it can't use: an order ID instead of a token, or a product the config lacks", async () => {
    const { app } = importApp(stores(fakeAppleApi({})));
    const orderId = await importRow(app, { app_user_id: "rc-a", store: "play_store", transaction_id: "GPA.1234-5678-9012-34567" });
    expect(orderId).toMatchObject({ status: 400, body: { message: expect.stringMatching(/purchase_token/) } });
    const unknown = await importRow(app, { app_user_id: "rc-a", purchase_token: "t", product_id: "gold:monthly" });
    expect(unknown).toMatchObject({ status: 422, body: { code: "unknown_products", message: expect.stringMatching(/gold/) } });
  });
});

describe("aliases and attributes", () => {
  it("adds them to an existing customer without overwriting what the app set", async () => {
    const { app } = importApp(stores(await appleCustomer("4000000006")));
    await importRow(app, { app_user_id: "rc-attr", transaction_id: "4000000006" });
    await call("/v1/subscribers/rc-attr/attributes", { app, env: importEnv(), body: { attributes: { $email: { value: "new@example.com", updated_at_ms: Date.now() } } } });

    const r = await importRow(app, { app_user_id: "rc-attr", aliases: "$RCAnonymousID:00000000000000000000000000000abc|rc-attr", attributes: { $email: "old@example.com", $displayName: "Jane" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ aliases_added: ["$RCAnonymousID:00000000000000000000000000000abc"], attributes: 2 });
    const attrs = await env.DB.prepare(
      "SELECT key, value FROM subscriber_attribute s JOIN customer_alias a ON a.customer_id = s.customer_id WHERE a.app_user_id = 'rc-attr' ORDER BY key",
    ).all();
    expect(attrs.results).toEqual([
      { key: "$displayName", value: "Jane" },
      { key: "$email", value: "new@example.com" },
    ]);
    // The alias reaches the same customer.
    expect((await customerInfo(app, "$RCAnonymousID:00000000000000000000000000000abc")).entitlements.pro).toBeDefined();
  });

  it("doesn't create customers from rows without a purchase", async () => {
    const { app } = importApp(stores(fakeAppleApi({})));
    const r = await importRow(app, { app_user_id: "rc-nobody", attributes: { $email: "x@example.com" } });
    expect(r).toMatchObject({ status: 422, body: { code: "no_customer" } });
  });
});

describe("limits and permissions", () => {
  it("stops near a free-plan daily limit, so the app's own traffic keeps working", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO job_state (key, value, updated_at) VALUES ('usage', ?, ?)")
      .bind(JSON.stringify({ at: now, date: new Date(now).toISOString().slice(0, 10), usage: { workers_requests: 1000, d1_rows_read: 1000, d1_rows_written: 95_000 } }), now)
      .run();
    const { app } = importApp(stores(await appleCustomer("4000000007")));
    const r = await importRow(app, { app_user_id: "rc-limit", transaction_id: "4000000007" });
    expect(r).toMatchObject({ status: 429, body: { code: "daily_limit", message: expect.stringMatching(/D1 rows written.*00:00 UTC/s) } });
    // A dry run writes nothing, so it still works.
    expect((await importRow(app, { app_user_id: "rc-limit", transaction_id: "4000000007" }, { dryRun: true })).status).toBe(200);
  });

  it("needs the customers:import permission (owners and admins)", async () => {
    const { app } = importApp(stores(await appleCustomer("4000000008")));
    expect((await importRow(app, { app_user_id: "rc-p", transaction_id: "4000000008" }, { role: "developer" })).status).toBe(403);
    expect((await importRow(app, { app_user_id: "rc-p", transaction_id: "4000000008" }, { role: "admin" })).status).toBe(200);
  });

  it("validates rows", async () => {
    const { app } = importApp(stores(fakeAppleApi({})));
    expect((await importRow(app, { transaction_id: "1" })).body.message).toMatch(/app_user_id is required/);
    expect((await importRow(app, { app_user_id: "u", store: "amazon", transaction_id: "1" })).body.message).toMatch(/Unknown store/);
    expect((await importRow(app, { app_user_id: "u", transaction_id: "1", purchase_token: "t" })).body.message).toMatch(/not both/);
    expect((await importRow(app, { app_user_id: "u", transaction_id: "1", first_seen: "soon" })).body.message).toMatch(/first_seen/);
  });
});
