// Price experiments: the admin API (/admin/v1/experiments), getOfferings showing each new person
// their variant's offering, and the results per variant (with experiments in webhook events and
// on the customer). Ported from lite/test/experiments.test.ts.
//
// Lite's test picks app user IDs for each variant with pickVariant(), Lite's hash. Here people are
// sorted into variants by what getOfferings shows them, so the suite doesn't depend on any
// edition's hash; everyone fetched is enrolled, so counts come from that sorting. Enrollment rows
// are read through the experiments list (enrolled), results and customer detail; backdating
// enrollments (an UPDATE in Lite) is done by running the experiment on a clock a week back.
//
// Dropped: "splits people by weight" and "gives the chance that a variant beats the control"
// (pure functions: pickVariant and the statistics stay in Lite).

import { beforeEach, describe, expect, it } from "vitest";
import { admin, call, createOperator, DAY, fake, now, postAppleTransaction, reset, setClock, settle, testConfig, withWebhooks } from "../src";

// The test config plus a second offering selling the same products at "higher" prices, a third, and a webhook.
function experimentConfig() {
  const raw = withWebhooks(testConfig());
  raw.offerings.push({ id: "higher", packages: [{ id: "$rc_monthly", ios: "pro_annual", android: "pro:annual" }] });
  raw.offerings.push({ id: "third", packages: [{ id: "$rc_lifetime", ios: "lifetime", android: "lifetime" }] });
  return raw;
}

const FIFTY_FIFTY = [
  { offering_id: "default", weight: 50 },
  { offering_id: "higher", weight: 50 },
];

const api = (method: string, path: string, session: string, body?: unknown) => admin(method, path, { session }, { body });

const offerings = async (appUserId: string) => (await call(`/v1/subscribers/${encodeURIComponent(appUserId)}/offerings`)).body.current_offering_id as string;

async function buy(appUserId: string, overrides: Parameters<typeof postAppleTransaction>[1] = {}) {
  const { res, payload } = await postAppleTransaction(appUserId, { purchaseDate: now() - 60_000, ...overrides });
  expect(res.status).toBe(200);
  return payload;
}

async function startExperiment(session: string, variants = FIFTY_FIFTY) {
  const created = await api("POST", "/experiments", session, { name: "Higher monthly price", variants });
  expect(created.status).toBe(201);
  const started = await api("POST", `/experiments/${created.body.experiment.id}/start`, session);
  expect(started.status).toBe(200);
  return created.body.experiment.id as string;
}

/**
 * Fetches offerings for new app user IDs (`<prefix>-0`, `<prefix>-1`, ...) until `want[offering]`
 * people have been shown each offering. Returns everyone fetched, by the offering they saw.
 */
async function enroll(prefix: string, want: Record<string, number>) {
  const by: Record<string, string[]> = {};
  for (let i = 0; Object.entries(want).some(([o, n]) => (by[o]?.length ?? 0) < n); i++) {
    if (i >= 200) throw new Error(`Couldn't fill the variants: ${JSON.stringify(by)}`);
    const id = `${prefix}-${i}`;
    (by[await offerings(id)] ??= []).push(id);
  }
  return by;
}

const enrolled = async (session: string, id: string) =>
  ((await api("GET", "/experiments", session)).body.experiments as { id: string; enrolled: number }[]).find((e) => e.id === id)!.enrolled;

beforeEach(async () => {
  await reset(experimentConfig());
});

describe("experiments API", () => {
  it("validates variants and lets only admins change experiments", async () => {
    const { session: adminS } = await createOperator("admin");
    const { session: viewer } = await createOperator("viewer");
    const { session: developer } = await createOperator("developer");
    const bad = async (variants: unknown) => (await api("POST", "/experiments", adminS, { name: "x", variants })).body.message as string;
    expect(await bad([{ offering_id: "default", weight: 100 }])).toMatch(/2 to 4/);
    expect(await bad([{ offering_id: "default", weight: 50 }, { offering_id: "nope", weight: 50 }])).toMatch(/one of the project's offerings/);
    expect(await bad([{ offering_id: "default", weight: 50 }, { offering_id: "default", weight: 50 }])).toMatch(/two variants/);
    expect(await bad([{ offering_id: "default", weight: 60 }, { offering_id: "higher", weight: 50 }])).toMatch(/add up to 110/);
    expect((await api("POST", "/experiments", adminS, { variants: FIFTY_FIFTY })).body.message).toMatch(/name is required/);
    expect((await api("POST", "/experiments", viewer, { name: "x", variants: FIFTY_FIFTY })).status).toBe(403);
    expect((await api("POST", "/experiments", developer, { name: "x", variants: FIFTY_FIFTY })).status).toBe(403);

    const created = await api("POST", "/experiments", adminS, {
      name: "Three ways",
      variants: [
        { offering_id: "default", weight: 34 },
        { offering_id: "higher", weight: 33 },
        { offering_id: "third", weight: 33 },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.experiment).toMatchObject({ status: "draft", variants: [{ id: "a", offering_id: "default" }, { id: "b" }, { id: "c", offering_id: "third", weight: 33 }] });
    const list = await api("GET", "/experiments", viewer);
    expect(list.body.experiments).toHaveLength(1);
    expect(list.body.experiments[0]).toMatchObject({ name: "Three ways", enrolled: 0 });
    const audit = (await admin("GET", "/audit")).body.entries as { action: string; target: string }[];
    expect(audit.filter((e) => e.target === created.body.experiment.id).map((e) => e.action)).toContain("experiment.create");
  });

  it("runs one experiment per project; variants are fixed once started", async () => {
    const { session } = await createOperator("admin");
    const first = await startExperiment(session);
    const second = await api("POST", "/experiments", session, { name: "Another", variants: FIFTY_FIFTY });
    expect((await api("POST", `/experiments/${second.body.experiment.id}/start`, session)).status).toBe(409);
    expect((await api("PATCH", `/experiments/${first}`, session, { variants: FIFTY_FIFTY })).status).toBe(409);
    expect((await api("PATCH", `/experiments/${first}`, session, { name: "Renamed", notes: "Annual as monthly" })).body.experiment).toMatchObject({
      name: "Renamed",
      notes: "Annual as monthly",
    });
    expect((await api("DELETE", `/experiments/${first}`, session)).status).toBe(409);
    expect((await api("POST", `/experiments/${first}/stop`, session)).body.experiment.status).toBe("stopped");
    expect((await api("POST", `/experiments/${first}/start`, session)).status).toBe(409);
    expect((await api("POST", `/experiments/${second.body.experiment.id}/start`, session)).status).toBe(200);
    expect((await api("DELETE", `/experiments/${first}`, session)).body.deleted).toBe(true);
    expect((await api("GET", `/experiments/${first}`, session)).status).toBe(404);
  });
});

describe("getOfferings during an experiment", () => {
  it("shows new people their variant's offering, and keeps it", async () => {
    const { session } = await createOperator("admin");
    const id = await startExperiment(session);
    const by = await enroll("new", { default: 1, higher: 1 });
    const everyone = Object.values(by).flat();
    // Both offerings show up for new people, and each person keeps theirs.
    for (const [offering, ids] of Object.entries(by)) {
      for (const u of ids) expect(await offerings(u)).toBe(offering);
    }
    expect(await offerings(by.higher![0]!)).toBe("higher");
    // Each person is enrolled once.
    expect(await enrolled(session, id)).toBe(everyone.length);
    const results = (await api("GET", `/experiments/${id}/results?environment=sandbox`, session)).body.results;
    expect(results.variants.map((v: { customers: number }) => v.customers)).toEqual([by.default!.length, by.higher!.length]);
  });

  it("leaves existing customers alone, and everyone after it stops", async () => {
    const { session } = await createOperator("admin");
    // Customers from before the experiment (some of whom would land in "b" if they were new).
    const old = Array.from({ length: 8 }, (_, i) => `old-${i}`);
    for (const u of old) expect((await call(`/v1/subscribers/${u}/attributes`, { body: { attributes: { $displayName: { value: u, updated_at_ms: now() } } } })).status).toBe(200);
    await setClock(now() + 1000);
    const id = await startExperiment(session);
    for (const u of old) expect(await offerings(u)).toBe("default");
    expect(await enrolled(session, id)).toBe(0);

    const inB = (await enroll("stopper", { higher: 1 })).higher![0]!;
    expect(await offerings(inB)).toBe("higher");
    await api("POST", `/experiments/${id}/stop`, session);
    expect(await offerings(inB)).toBe("default");
  });

  it("keeps the variant after logIn to a new app user ID", async () => {
    const { session } = await createOperator("admin");
    await startExperiment(session);
    // Several people, so a logIn that dropped the variant (and drew again) would show.
    const anons = (await enroll("$RCAnonymousID:feedface", { higher: 3 })).higher!;
    for (const [i, anon] of anons.entries()) {
      // The anonymous user becomes a customer, then logs in with a new named ID.
      await call(`/v1/subscribers/${encodeURIComponent(anon)}/attributes`, { body: { attributes: { $email: { value: `a${i}@example.com`, updated_at_ms: now() } } } });
      const login = await call("/v1/subscribers/identify", { body: { app_user_id: anon, new_app_user_id: `named-${i}` } });
      expect(login.status).toBeLessThan(300);
      expect(await offerings(`named-${i}`)).toBe("higher");
    }
  });
});

describe("results", () => {
  it("counts each variant's customers, buyers and revenue, and adds experiments to webhooks", async () => {
    const { session } = await createOperator("admin");
    // Enrolled a week ago, so purchases dated in the last few days count.
    await setClock(Date.now() - 7 * DAY);
    const id = await startExperiment(session);
    const by = await enroll("res", { default: 4, higher: 3 });
    const a = by.default!;
    const b = by.higher!;
    await setClock(Date.now());

    // Variant a: one monthly buyer ($9.99), and a trial that converted to monthly. Variant b: one annual buyer ($59.99).
    await buy(a[0]!, { price: 9990 });
    const trialStart = now() - 3 * DAY;
    const trial = await buy(a[1]!, { offerType: 1, offerDiscountType: "FREE_TRIAL", price: 0, purchaseDate: trialStart, originalPurchaseDate: trialStart, expiresDate: now() - 60_000 });
    await buy(a[1]!, { price: 9990, originalTransactionId: trial.originalTransactionId, originalPurchaseDate: trialStart });
    await buy("outsider-1"); // bought, but never fetched offerings: not in the experiment
    await buy(b[0]!, { productId: "pro_annual", price: 59990, expiresDate: now() + 360 * DAY });

    const results = (await api("GET", `/experiments/${id}/results?environment=sandbox`, session)).body.results;
    expect(results.environment).toBe("sandbox");
    const [ra, rb] = results.variants;
    const perCustomer = (revenue: number, n: number) => revenue / n;
    expect(ra).toMatchObject({
      id: "a",
      customers: a.length,
      trials: 1,
      trial_conversions: 1,
      paying: 2,
      revenue: 19.98,
      revenue_per_customer: Math.round(perCustomer(19.98, a.length) * 100) / 100,
      active_subscriptions: 2,
      vs_control: null,
    });
    expect(ra.products).toEqual({ pro_monthly: 2 });
    expect(rb).toMatchObject({ id: "b", offering_id: "higher", customers: b.length, paying: 1, revenue: 59.99, active_subscriptions: 1, products: { pro_annual: 1 } });
    expect(rb.mrr).toBeCloseTo(59.99 / 12, 1);
    expect(rb.vs_control).toMatchObject({ enough_data: false });
    expect(rb.vs_control.revenue_lift).toBeCloseTo(perCustomer(59.99, b.length) / perCustomer(19.98, a.length) - 1, 2);
    expect(results.daily.length).toBeGreaterThan(0);
    // Production has no purchases here.
    const prod = (await api("GET", `/experiments/${id}/results`, session)).body.results;
    expect(prod.variants[0]).toMatchObject({ customers: a.length, paying: 0, revenue: 0 });

    await settle();
    const events = fake.received("backend").map((d) => d.body.event);
    const event = events.find((e) => e.app_user_id === b[0]);
    expect(event.experiments).toEqual([{ experiment_id: id, experiment_variant: "b", enrolled_at_ms: expect.any(Number) }]);
    const outsider = events.find((e) => e.app_user_id === "outsider-1");
    expect(outsider).toBeDefined();
    expect(outsider.experiments).toBeUndefined();

    const detail = await admin("GET", `/customers/${encodeURIComponent(b[0]!)}`);
    expect(detail.body.experiments).toEqual([{ experiment_id: id, experiment_name: "Higher monthly price", experiment_variant: "b", enrolled_at_ms: expect.any(Number) }]);
  });

  it("are only for operators who see every app", async () => {
    const { session } = await createOperator("admin");
    const id = await startExperiment(session);
    const limited = await createOperator("viewer", { apps: ["ios"] });
    expect((await api("GET", `/experiments/${id}/results`, limited.session)).status).toBe(403);
  });
});
