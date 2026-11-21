import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetRunning, pickVariant, type Variant } from "../src/experiments";
import { chanceConversionHigher, chanceMeanHigher, normalCdf } from "../src/office/experiments";
import { SESSION_COOKIE } from "../src/office/auth";
import { hashPassword, randomToken, sha256Hex } from "../src/office/auth-crypto";
import { appWithRawConfig, call, DAY, envWithWebhookSecrets, rawTestConfig, signTransaction, WEBHOOK_URL, webhookReceiver } from "./helpers";

const SECRET = "test-operator-secret-0123456789abcdef";
const ORIGIN = "https://openpurr.test";

// The test config plus a second offering selling the same products at "higher" prices, and a webhook.
const raw = structuredClone(rawTestConfig) as any;
raw.offerings.push({ id: "higher", packages: [{ id: "$rc_monthly", ios: "pro_annual", android: "pro:annual" }] });
raw.offerings.push({ id: "third", packages: [{ id: "$rc_lifetime", ios: "lifetime", android: "lifetime" }] });
raw.webhooks = [{ id: "backend", url: WEBHOOK_URL, authorization_secret: "WEBHOOK_AUTH", signing_secret: "WEBHOOK_SECRET" }];
const receiver = webhookReceiver();
const app = appWithRawConfig(raw, receiver);
const appEnv = () => ({ ...envWithWebhookSecrets(), OPERATOR_SECRET: SECRET });

let n = 0;
async function operator(role: "owner" | "admin" | "developer" | "viewer", apps?: string[]) {
  const id = crypto.randomUUID();
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, app_ids, password_hash, totp_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").bind(
      id,
      `exp-${role}${++n}-${Date.now()}@example.com`,
      role,
      role,
      apps ? JSON.stringify(apps) : null,
      await hashPassword(SECRET, "a long test passphrase"),
      Date.now(),
    ),
    env.DB.prepare("INSERT INTO session (token_hash, operator_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, 'full', ?, ?, ?)").bind(
      await sha256Hex(session),
      id,
      Date.now(),
      Date.now() + 3600_000,
      Date.now(),
    ),
  ]);
  return session;
}

async function api(method: string, path: string, session: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`${ORIGIN}/admin/v1${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${session}`, origin: ORIGIN },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    appEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.json<any>() };
}

const offerings = async (appUserId: string) =>
  (await (await call(`/v1/subscribers/${encodeURIComponent(appUserId)}/offerings`, { app, env: appEnv() })).json<any>()).current_offering_id as string;

async function buy(appUserId: string, overrides: Record<string, unknown> = {}) {
  const { jws, payload } = await signTransaction({ purchaseDate: Date.now() - 60_000, ...overrides });
  const res = await call("/v1/receipts", {
    app,
    env: appEnv(),
    body: { app_user_id: appUserId, fetch_token: jws, product_id: payload.productId, transaction_id: payload.transactionId, is_restore: false },
  });
  expect(res.status).toBe(200);
  return payload;
}

async function startExperiment(admin: string, variants = [{ offering_id: "default", weight: 50 }, { offering_id: "higher", weight: 50 }]) {
  const created = await api("POST", "/experiments", admin, { name: "Higher monthly price", variants });
  expect(created.status).toBe(201);
  const started = await api("POST", `/experiments/${created.body.experiment.id}/start`, admin);
  expect(started.status).toBe(200);
  return created.body.experiment.id as string;
}

/** App user IDs that land in each variant of an experiment. */
function usersIn(experimentId: string, variants: Variant[], variant: string, count: number, prefix: string) {
  const ids: string[] = [];
  for (let i = 0; ids.length < count; i++) {
    const id = `${prefix}-${i}`;
    if (pickVariant(experimentId, id, variants).id === variant) ids.push(id);
  }
  return ids;
}
const FIFTY_FIFTY: Variant[] = [
  { id: "a", offering_id: "default", weight: 50 },
  { id: "b", offering_id: "higher", weight: 50 },
];

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM experiment_enrollment"), env.DB.prepare("DELETE FROM experiment")]);
  forgetRunning();
  receiver.received.length = 0;
});

describe("assignment", () => {
  it("splits people by weight, the same way every time", () => {
    const tally = (variants: Variant[]) => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 20_000; i++) {
        const v = pickVariant("exp_1", `user-${i}`, variants).id;
        counts[v] = (counts[v] ?? 0) + 1;
      }
      return counts;
    };
    const even = tally(FIFTY_FIFTY);
    expect(even.a! / 20_000).toBeCloseTo(0.5, 1);
    const skewed = tally([
      { id: "a", offering_id: "x", weight: 90 },
      { id: "b", offering_id: "y", weight: 10 },
    ]);
    expect(skewed.b! / 20_000).toBeGreaterThan(0.08);
    expect(skewed.b! / 20_000).toBeLessThan(0.12);
    expect(pickVariant("exp_1", "someone", FIFTY_FIFTY)).toEqual(pickVariant("exp_1", "someone", FIFTY_FIFTY));
  });
});

describe("statistics", () => {
  it("gives the chance that a variant beats the control", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(chanceConversionHigher({ n: 1000, x: 50 }, { n: 1000, x: 50 })).toBeCloseTo(0.5, 6);
    expect(chanceConversionHigher({ n: 1000, x: 50 }, { n: 1000, x: 80 })!).toBeGreaterThan(0.99);
    expect(chanceConversionHigher({ n: 1000, x: 80 }, { n: 1000, x: 50 })!).toBeLessThan(0.01);
    // A small difference on a small sample is a coin flip, not a winner.
    const small = chanceConversionHigher({ n: 40, x: 2 }, { n: 40, x: 3 })!;
    expect(small).toBeGreaterThan(0.5);
    expect(small).toBeLessThan(0.8);
    // Revenue per customer: 100 customers each, 10 paying $10 vs 10 paying $20.
    const control = { n: 100, sum: 100, sumSq: 10 * 100 };
    const variant = { n: 100, sum: 200, sumSq: 10 * 400 };
    expect(chanceMeanHigher(control, variant)!).toBeGreaterThan(0.9);
    expect(chanceMeanHigher(control, control)).toBeCloseTo(0.5, 6);
    expect(chanceConversionHigher({ n: 0, x: 0 }, { n: 10, x: 1 })).toBeNull();
  });
});

describe("experiments API", () => {
  it("validates variants and lets only admins change experiments", async () => {
    const admin = await operator("admin");
    const viewer = await operator("viewer");
    const developer = await operator("developer");
    const bad = async (variants: unknown) => (await api("POST", "/experiments", admin, { name: "x", variants })).body.message as string;
    expect(await bad([{ offering_id: "default", weight: 100 }])).toMatch(/2 to 4/);
    expect(await bad([{ offering_id: "default", weight: 50 }, { offering_id: "nope", weight: 50 }])).toMatch(/one of the project's offerings/);
    expect(await bad([{ offering_id: "default", weight: 50 }, { offering_id: "default", weight: 50 }])).toMatch(/two variants/);
    expect(await bad([{ offering_id: "default", weight: 60 }, { offering_id: "higher", weight: 50 }])).toMatch(/add up to 110/);
    expect((await api("POST", "/experiments", admin, { variants: FIFTY_FIFTY })).body.message).toMatch(/name is required/);
    expect((await api("POST", "/experiments", viewer, { name: "x", variants: FIFTY_FIFTY })).status).toBe(403);
    expect((await api("POST", "/experiments", developer, { name: "x", variants: FIFTY_FIFTY })).status).toBe(403);

    const created = await api("POST", "/experiments", admin, { name: "Three ways", variants: [{ offering_id: "default", weight: 34 }, { offering_id: "higher", weight: 33 }, { offering_id: "third", weight: 33 }] });
    expect(created.status).toBe(201);
    expect(created.body.experiment).toMatchObject({ status: "draft", variants: [{ id: "a", offering_id: "default" }, { id: "b" }, { id: "c", offering_id: "third", weight: 33 }] });
    const list = await api("GET", "/experiments", viewer);
    expect(list.body.experiments).toHaveLength(1);
    expect(list.body.experiments[0]).toMatchObject({ name: "Three ways", enrolled: 0 });
    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE target = ?").bind(created.body.experiment.id).all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toContain("experiment.create");
  });

  it("runs one experiment per project; variants are fixed once started", async () => {
    const admin = await operator("admin");
    const first = await startExperiment(admin);
    const second = await api("POST", "/experiments", admin, { name: "Another", variants: FIFTY_FIFTY });
    expect((await api("POST", `/experiments/${second.body.experiment.id}/start`, admin)).status).toBe(409);
    expect((await api("PATCH", `/experiments/${first}`, admin, { variants: FIFTY_FIFTY })).status).toBe(409);
    expect((await api("PATCH", `/experiments/${first}`, admin, { name: "Renamed", notes: "Annual as monthly" })).body.experiment).toMatchObject({ name: "Renamed", notes: "Annual as monthly" });
    expect((await api("DELETE", `/experiments/${first}`, admin)).status).toBe(409);
    expect((await api("POST", `/experiments/${first}/stop`, admin)).body.experiment.status).toBe("stopped");
    expect((await api("POST", `/experiments/${first}/start`, admin)).status).toBe(409);
    expect((await api("POST", `/experiments/${second.body.experiment.id}/start`, admin)).status).toBe(200);
    expect((await api("DELETE", `/experiments/${first}`, admin)).body.deleted).toBe(true);
    expect((await api("GET", `/experiments/${first}`, admin)).status).toBe(404);
  });
});

describe("getOfferings during an experiment", () => {
  it("shows new people their variant's offering, and keeps it", async () => {
    const admin = await operator("admin");
    const id = await startExperiment(admin);
    const [inA] = usersIn(id, FIFTY_FIFTY, "a", 1, "new-a");
    const [inB] = usersIn(id, FIFTY_FIFTY, "b", 1, "new-b");
    expect(await offerings(inA!)).toBe("default");
    expect(await offerings(inB!)).toBe("higher");
    expect(await offerings(inB!)).toBe("higher");
    const rows = await env.DB.prepare("SELECT app_user_id, variant FROM experiment_enrollment WHERE experiment_id = ? ORDER BY variant").bind(id).all();
    expect(rows.results).toEqual([
      { app_user_id: inA, variant: "a" },
      { app_user_id: inB, variant: "b" },
    ]);
  });

  it("leaves existing customers alone, and everyone after it stops", async () => {
    const admin = await operator("admin");
    // A customer from before the experiment, who would hash into "b".
    const id = await startExperiment(admin);
    const [old] = usersIn(id, FIFTY_FIFTY, "b", 1, "old");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO customer (id, project_id, app_user_id, first_seen) VALUES (?, 'default', ?, ?)").bind(`c-${old}`, old, Date.now() - DAY),
      env.DB.prepare("INSERT INTO customer_alias (project_id, app_user_id, customer_id, created_at) VALUES ('default', ?, ?, ?)").bind(old, `c-${old}`, Date.now() - DAY),
    ]);
    expect(await offerings(old!)).toBe("default");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM experiment_enrollment").first<{ n: number }>())!.n).toBe(0);

    const [inB] = usersIn(id, FIFTY_FIFTY, "b", 1, "stopper");
    expect(await offerings(inB!)).toBe("higher");
    await api("POST", `/experiments/${id}/stop`, admin);
    expect(await offerings(inB!)).toBe("default");
  });

  it("keeps the variant after logIn to a new app user ID", async () => {
    const admin = await operator("admin");
    const id = await startExperiment(admin);
    const anon = usersIn(id, FIFTY_FIFTY, "b", 1, "$RCAnonymousID:feedface")[0]!;
    expect(await offerings(anon)).toBe("higher");
    // logIn: a new named ID that hashes into "a" joins the anonymous customer.
    await call("/v1/subscribers/" + encodeURIComponent(anon) + "/attributes", { app, env: appEnv(), body: { attributes: { $email: { value: "a@example.com", updated_at_ms: Date.now() } } } });
    const named = usersIn(id, FIFTY_FIFTY, "a", 1, "named")[0]!;
    const login = await call("/v1/subscribers/identify", { app, env: appEnv(), body: { app_user_id: anon, new_app_user_id: named } });
    expect(login.status).toBeLessThan(300);
    expect(await offerings(named)).toBe("higher");
  });
});

describe("results", () => {
  it("counts each variant's customers, buyers and revenue, and adds experiments to webhooks", async () => {
    const admin = await operator("admin");
    const id = await startExperiment(admin);
    const a = usersIn(id, FIFTY_FIFTY, "a", 4, "res-a");
    const b = usersIn(id, FIFTY_FIFTY, "b", 3, "res-b");
    for (const u of [...a, ...b]) await offerings(u);
    // As if they'd enrolled a week ago, so purchases dated in the last few days count.
    await env.DB.prepare("UPDATE experiment_enrollment SET enrolled_at = enrolled_at - ?").bind(7 * DAY).run();
    // Variant a: one monthly buyer ($9.99), and a trial that converted to monthly. Variant b: one annual buyer ($59.99).
    await buy(a[0]!, { price: 9990 });
    const trialStart = Date.now() - 3 * DAY;
    const trial = await buy(a[1]!, { offerType: 1, offerDiscountType: "FREE_TRIAL", price: 0, purchaseDate: trialStart, originalPurchaseDate: trialStart, expiresDate: Date.now() - 60_000 });
    await buy(a[1]!, { price: 9990, originalTransactionId: trial.originalTransactionId, originalPurchaseDate: trialStart });
    await buy("outsider-1"); // bought, but never fetched offerings: not in the experiment
    await buy(b[0]!, { productId: "pro_annual", price: 59990, expiresDate: Date.now() + 360 * DAY });

    const results = (await api("GET", `/experiments/${id}/results?environment=sandbox`, admin)).body.results;
    expect(results.environment).toBe("sandbox");
    const [ra, rb] = results.variants;
    expect(ra).toMatchObject({ id: "a", customers: 4, trials: 1, trial_conversions: 1, paying: 2, revenue: 19.98, revenue_per_customer: 5, active_subscriptions: 2, vs_control: null });
    expect(ra.products).toEqual({ pro_monthly: 2 });
    expect(rb).toMatchObject({ id: "b", offering_id: "higher", customers: 3, paying: 1, revenue: 59.99, active_subscriptions: 1, products: { pro_annual: 1 } });
    expect(rb.mrr).toBeCloseTo(59.99 / 12, 1);
    expect(rb.vs_control).toMatchObject({ enough_data: false });
    expect(rb.vs_control.revenue_lift).toBeCloseTo(20 / 5 - 1, 0);
    expect(results.daily.length).toBeGreaterThan(0);
    // Production has no purchases here.
    const prod = (await api("GET", `/experiments/${id}/results`, admin)).body.results;
    expect(prod.variants[0]).toMatchObject({ customers: 4, paying: 0, revenue: 0 });

    const event = receiver.events().find((e) => e.app_user_id === b[0]);
    expect(event.experiments).toEqual([{ experiment_id: id, experiment_variant: "b", enrolled_at_ms: expect.any(Number) }]);
    const outsider = receiver.events().find((e) => e.app_user_id === "outsider-1");
    expect(outsider).toBeDefined();
    expect(outsider.experiments).toBeUndefined();

    const detail = await api("GET", `/customers/${encodeURIComponent(b[0]!)}`, admin);
    expect(detail.body.experiments).toEqual([{ experiment_id: id, experiment_variant: "b", enrolled_at_ms: expect.any(Number) }]);
  });

  it("are only for operators who see every app", async () => {
    const admin = await operator("admin");
    const id = await startExperiment(admin);
    const limited = await operator("viewer", ["ios"]);
    expect((await api("GET", `/experiments/${id}/results`, limited)).status).toBe(403);
  });
});
