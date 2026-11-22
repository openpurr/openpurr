// The admin API (/admin/v1): authentication, roles and token scopes, operators, customers and the
// customer list, charts, promotional grants, webhook replay, the audit log, settings and the
// dashboard language. Operators, tokens and customers are made over HTTP (invites, the SDK API)
// instead of rows in D1. Ported from lite/test/admin-api.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import {
  admin,
  advanceClock,
  call,
  createOperator,
  createToken,
  DAY,
  EDITION,
  fake,
  jobs,
  linkToken,
  login,
  now,
  onEdition,
  ORIGIN,
  postAppleTransaction,
  reset,
  sessionFrom,
  settle,
  signTransaction,
  testConfig,
  withWebhooks,
} from "../src";
import { requireTotp, totpOwner } from "../src/operator-auth-helpers";

const enc = encodeURIComponent;

beforeEach(async () => {
  await reset();
});

describe("authentication", () => {
  it("lists the configured apps, limited to the operator's apps", async () => {
    const all = await admin("GET", "/apps", { session: (await createOperator("viewer")).session });
    expect(all.status).toBe(200);
    expect(all.body.apps.length).toBeGreaterThan(0);
    const first = all.body.apps[0];
    expect(first).toMatchObject({ id: expect.any(String), store: expect.any(String) });
    const limited = await admin("GET", "/apps", { session: (await createOperator("viewer", { apps: [first.id] })).session });
    expect(limited.body.apps.map((a: { id: string }) => a.id)).toEqual([first.id]);
  });

  it("needs a session or a valid access token", async () => {
    expect((await admin("GET", "/me", { none: true })).status).toBe(401);
    expect((await admin("GET", "/me", { token: "pat_not-a-real-token" })).status).toBe(401);
    const op = await createOperator("viewer");
    expect((await admin("GET", "/me", { session: op.session })).body).toMatchObject({ via: "session", permissions: ["read"] });
    const t = await createToken(op.session, ["read"]);
    expect((await admin("GET", "/me", { token: t })).body.via).toBe("token");
  });

  it("requires same-origin for session writes, but not for tokens", async () => {
    const op = await createOperator("developer");
    expect((await admin("POST", "/secret-keys", { session: op.session }, { body: { name: "x" }, origin: null })).status).toBe(403);
    const t = await createToken(op.session, ["admin"]);
    expect((await admin("POST", "/secret-keys", { token: t }, { body: { name: "x" }, origin: null })).status).toBe(201);
  });

  it("holds operators without two-step sign-in to /me when the owner requires it", async () => {
    const op = await createOperator("admin");
    await requireTotp();
    expect((await admin("GET", "/me", { session: op.session })).status).toBe(200);
    expect((await admin("GET", "/operators", { session: op.session })).body.code).toBe("totp_enrollment_required");
  });
});

describe("roles and token scopes", () => {
  it("lets each role do only its part", async () => {
    const viewer = await createOperator("viewer");
    const developer = await createOperator("developer");
    expect((await admin("GET", "/operators", { session: viewer.session })).status).toBe(200);
    expect((await admin("POST", "/secret-keys", { session: viewer.session }, { body: { name: "k" } })).status).toBe(403);
    expect((await admin("POST", "/secret-keys", { session: developer.session }, { body: { name: "k" } })).status).toBe(201);
    expect((await admin("POST", "/operators", { session: developer.session }, { body: { email: "x@example.com", role: "viewer" } })).status).toBe(403);
    expect((await admin("GET", "/audit", { session: developer.session })).status).toBe(403);
  });

  it("limits a token to its role AND its scopes", async () => {
    const developer = await createOperator("developer");
    const readOnly = await createToken(developer.session, ["read"]);
    expect((await admin("POST", "/secret-keys", { token: readOnly }, { body: { name: "k" } })).status).toBe(403);
    const viewer = await createOperator("viewer");
    const overScoped = await createToken(viewer.session, ["admin"]); // scope can't exceed the role
    expect((await admin("POST", "/secret-keys", { token: overScoped }, { body: { name: "k" } })).status).toBe(403);
  });

  it("mints tokens only from a session; a token works until revoked", async () => {
    const op = await createOperator("developer");
    const created = await admin("POST", "/tokens", { session: op.session }, { body: { name: "cli", scopes: ["read"], expires_in_days: 30 } });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^pat_/);
    expect((await admin("POST", "/tokens", { token: created.body.token }, { body: { name: "x", scopes: ["read"] } })).status).toBe(403);
    expect((await admin("GET", "/tokens", { session: op.session })).body.tokens).toHaveLength(1);
    expect((await admin("DELETE", `/tokens/${created.body.id}`, { session: op.session })).status).toBe(200);
    expect((await admin("GET", "/me", { token: created.body.token })).status).toBe(401);
  });
});

describe("operators", () => {
  it("admins invite non-owners; only owners add owners", async () => {
    const adminOp = await createOperator("admin");
    const invited = await admin("POST", "/operators", { session: adminOp.session }, { body: { email: `New${Date.now()}@Example.com`, role: "developer" } });
    expect(invited.status).toBe(201);
    expect(invited.body.setup_link.startsWith(`${ORIGIN}/admin/link#token=`)).toBe(true);
    expect((await admin("POST", "/operators", { session: adminOp.session }, { body: { email: `o${Date.now()}@example.com`, role: "owner" } })).status).toBe(403);
    const owner = await createOperator("owner");
    expect((await admin("POST", "/operators", { session: owner.session }, { body: { email: `o2${Date.now()}@example.com`, role: "owner" } })).status).toBe(201);
  });

  it("never removes the last active owner", async () => {
    const owner = await createOperator("owner");
    // Disable the reset's owner, so `owner` is the only one.
    const resetOwner = (await admin("GET", "/me")).body.operator.id as string;
    expect((await admin("PATCH", `/operators/${resetOwner}`, { session: owner.session }, { body: { disabled: true } })).status).toBe(200);
    // The reset's owner token went with them, so the next operator is invited by `owner`.
    const invited = await admin("POST", "/operators", { session: owner.session }, { body: { email: `other${Date.now()}@example.com`, role: "admin" } });
    const other = { id: invited.body.id as string };
    expect((await admin("PATCH", `/operators/${other.id}`, { session: owner.session }, { body: { role: "owner" } })).status).toBe(200);
    // Two owners: demoting one is fine.
    expect((await admin("PATCH", `/operators/${other.id}`, { session: owner.session }, { body: { role: "admin" } })).status).toBe(200);
    // One owner left: can't be demoted or disabled, and can't change their own role.
    expect((await admin("PATCH", `/operators/${owner.id}`, { session: owner.session }, { body: { role: "admin" } })).status).toBe(403);
    expect((await admin("PATCH", `/operators/${owner.id}`, { session: owner.session }, { body: { disabled: true } })).status).toBe(403);
  });

  it("disabling ends sessions and revokes tokens; reset issues a new setup link", async () => {
    const owner = await createOperator("owner");
    const dev = await createOperator("developer");
    const t = await createToken(dev.session, ["read"]);
    expect((await admin("PATCH", `/operators/${dev.id}`, { session: owner.session }, { body: { disabled: true } })).status).toBe(200);
    expect((await admin("GET", "/me", { session: dev.session })).status).toBe(401);
    expect((await admin("GET", "/me", { token: t })).status).toBe(401);
    expect((await login(dev.email, dev.password)).res.status).toBe(401);

    const dev2 = await createOperator("developer");
    const reset = await admin("POST", `/operators/${dev2.id}/reset`, { session: owner.session }, { body: {} });
    expect(reset.body.setup_link).toMatch(/#token=/);
    const listed = (await admin("GET", "/operators", { session: owner.session })).body.operators.find((o: { id: string }) => o.id === dev2.id);
    expect(listed).toMatchObject({ has_password: false, totp_enabled: false });
    expect((await admin("GET", "/me", { session: dev2.session })).status).toBe(401);
    expect((await login(dev2.email, dev2.password)).res.status).toBe(401);
    // The new setup link works.
    const link = await admin("POST", "/auth/link", { none: true }, { body: { token: linkToken(reset.body.setup_link) } });
    expect(link.body.session).toBe("setup");
    expect(sessionFrom(link)).toBeTruthy();
  });
});

describe("customers", () => {
  it("shows CustomerInfo, attributes and transactions; app-limited operators see only their apps", async () => {
    await postAppleTransaction("admin-cust", { productId: "pro_monthly" });
    await call("/v1/subscribers/admin-cust/attributes", { body: { attributes: { $email: { value: "c@example.com", updated_at_ms: 1 } } } });
    const viewer = await createOperator("viewer");
    const res = await admin("GET", "/customers/admin-cust", { session: viewer.session });
    expect(res.status).toBe(200);
    expect(res.body.customer_info.subscriber.entitlements.pro).toBeDefined();
    expect(res.body.attributes.$email.value).toBe("c@example.com");
    expect(res.body.transactions[0]).toMatchObject({ app_id: "ios", product_id: "pro_monthly" });

    const androidOnly = await createOperator("viewer", { apps: ["android"] });
    const limited = await admin("GET", "/customers/admin-cust", { session: androidOnly.session });
    expect(limited.body.transactions).toEqual([]);
    expect(limited.body.customer_info).toBeUndefined();
    expect((await admin("GET", "/customers/nobody-here", { session: viewer.session })).status).toBe(404);
  });
});

describe("customer list", () => {
  /** Makes a customer through the SDK API (an attribute write); returns its id and first_seen. */
  async function customer(appUserId: string, email?: string) {
    const value = email ?? null;
    await call(`/v1/subscribers/${enc(appUserId)}/attributes`, { body: { attributes: { $displayName: { value: "x", updated_at_ms: 1 }, ...(value ? { $email: { value, updated_at_ms: 1 } } : {}) } } });
    return found(appUserId);
  }
  async function found(appUserId: string) {
    const res = await admin("GET", `/customers/${enc(appUserId)}`);
    expect(res.status).toBe(200);
    return res.body.customer as { id: string; first_seen: number };
  }

  it("lists the newest customers first, a page at a time", async () => {
    const a = await customer("page-a");
    await advanceClock(1000);
    const b = await customer("page-b");
    await advanceClock(1000);
    const c = await customer("page-c");
    const { session } = await createOperator("viewer");
    const first = await admin("GET", "/customers?limit=2", { session });
    expect(first.status).toBe(200);
    expect(first.body.customers.map((x: { id: string }) => x.id)).toEqual([c.id, b.id]);
    expect(first.body.next_before).toBe(`${b.first_seen}:${b.id}`);
    const second = await admin("GET", `/customers?limit=2&before=${enc(first.body.next_before)}`, { session });
    expect(second.body.customers.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect((await admin("GET", "/customers?before=nonsense", { session })).status).toBe(400);
  });

  it("finds customers by app user ID prefix, email, or store transaction ID, with a purchase summary", async () => {
    const anon = "$RCAnonymousID:abcdef0123456789abcdef0123456789";
    const first = await postAppleTransaction(anon, { productId: "pro_monthly", purchaseDate: now() - 40 * DAY, expiresDate: now() - DAY });
    const tx1 = first.payload.transactionId;
    // A renewal into the annual plan, on the same original transaction.
    const { jws, payload: renewal } = await signTransaction({ productId: "pro_annual", originalTransactionId: tx1, purchaseDate: now() - DAY, expiresDate: now() + DAY });
    await call("/v1/receipts", { body: { app_user_id: anon, fetch_token: jws } });
    const tx2 = renewal.transactionId;
    await call(`/v1/subscribers/${enc(anon)}/attributes`, { body: { attributes: { $email: { value: "Pat.Search@Example.com", updated_at_ms: 1 } } } });
    expect((await call("/v1/subscribers/identify", { body: { app_user_id: anon, new_app_user_id: "member-search" } })).status).toBe(201);
    const { id } = await found(anon);
    const lonely = (await customer("member-search-nopurchases")).id;
    const { session } = await createOperator("viewer");
    const ids = async (q: string, extra = "") => (await admin("GET", `/customers?q=${enc(q)}${extra}`, { session })).body.customers.map((x: { id: string }) => x.id);

    expect(await ids("member-search")).toEqual(expect.arrayContaining([id, lonely]));
    expect(await ids("member-search", "&purchases=1")).toEqual([id]);
    expect(await ids("pat.search@example.com")).toEqual([id]); // email, any case
    expect(await ids(tx2)).toEqual([id]); // a renewal's transaction ID
    expect(await ids(tx1)).toEqual([id]); // the original transaction ID
    expect(await ids("no-such-customer")).toEqual([]);

    const [row] = (await admin("GET", `/customers?q=${enc(anon)}`, { session })).body.customers;
    expect(row).toMatchObject({ id, app_user_id: anon, email: "Pat.Search@Example.com", purchases: 2, active: true, last_product: "pro_annual", stores: ["app_store"] });
  });

  it("shows app-limited operators only customers with purchases in their apps", async () => {
    // Unverified Play purchases last 30 days; let this one run out.
    await call("/v1/receipts", { platform: "android", body: { app_user_id: "scope-android", fetch_token: "scope-play-token", product_ids: ["pro"] } });
    await advanceClock(31 * DAY);
    await postAppleTransaction("scope-ios", { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
    await customer("scope-none");
    const iosBuyer = (await found("scope-ios")).id;
    const androidBuyer = (await found("scope-android")).id;

    const iosOnly = await createOperator("viewer", { apps: ["ios"] });
    const list = (await admin("GET", "/customers?q=scope-", { session: iosOnly.session })).body.customers;
    expect(list.map((x: { id: string }) => x.id)).toEqual([iosBuyer]);
    expect(list[0]).toMatchObject({ active: true, purchases: 1 }); // a non-consumable stays active

    const all = (await admin("GET", "/customers?q=scope-", { session: (await createOperator("viewer")).session })).body.customers;
    expect(all).toHaveLength(3);
    expect(all.find((x: { id: string }) => x.id === androidBuyer)).toMatchObject({ active: false, purchases: 1 });
  });
});

describe("charts API", () => {
  it("lists charts and serves one as JSON or CSV, with validated parameters", async () => {
    const { session } = await createOperator("viewer");
    const list = await admin("GET", "/metrics", { session });
    expect(list.status).toBe(200);
    expect(list.body.charts.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(["revenue", "mrr", "active_subscriptions", "new_customers"]));

    const mrr = await admin("GET", "/metrics/mrr?from=2026-01-01&to=2026-01-31&interval=week", { session });
    expect(mrr.status).toBe(200);
    expect(mrr.body).toMatchObject({ chart: "mrr", unit: "usd", kind: "running", interval: "week" });
    expect(mrr.body.points[0]).toMatchObject({ date: "2025-12-29", values: { mrr: expect.any(Number) } });

    const csv = await admin("GET", "/metrics/revenue?from=2026-01-01&to=2026-01-03&format=csv", { session });
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.text.split("\n")[0]).toBe("date,net,refunds,gross");

    for (const bad of ["from=2026-02-01&to=2026-01-01", "from=yesterday", "interval=hour", "environment=staging", "store=amazon", "from=2000-01-01&to=2026-01-01"]) {
      expect((await admin("GET", `/metrics/revenue?${bad}`, { session })).status).toBe(400);
    }
    expect((await admin("GET", "/metrics/ltv", { session })).status).toBe(404);
    expect((await admin("GET", "/metrics/revenue?app=not-an-app", { session })).status).toBe(404);
  });

  it("lists products per app (Google base plans separately) and filters charts by them", async () => {
    const { session } = await createOperator("viewer");
    const apps = (await admin("GET", "/apps", { session })).body.apps as { id: string; products: string[] }[];
    expect(apps.find((a) => a.id === "android")!.products).toEqual(expect.arrayContaining(["pro:monthly", "pro:annual", "lifetime"]));
    expect(apps.find((a) => a.id === "ios")!.products).toEqual(expect.arrayContaining(["pro_monthly", "pro_annual"]));
    expect((await admin("GET", "/metrics/mrr?product=pro:monthly", { session })).status).toBe(200);
    expect((await admin("GET", "/metrics/mrr?app=ios&product=pro:monthly", { session })).status).toBe(404); // not an iOS product
    expect((await admin("GET", "/metrics/mrr?product=nope", { session })).status).toBe(404);
    const status = await admin("GET", "/metrics/subscription_status", { session });
    expect(status.body).toMatchObject({ kind: "breakdown", categories: expect.arrayContaining([expect.objectContaining({ key: "active", value: expect.any(Number) })]) });
  });

  it("refreshes at most once a minute; only owners rebuild all history", async () => {
    const { session } = await createOperator("viewer");
    const first = await admin("POST", "/metrics/refresh", { session }, { body: {} });
    expect(first.status).toBe(200);
    expect((await admin("POST", "/metrics/refresh", { session }, { body: {} })).body.refreshed).toBe(false);
    expect((await admin("POST", "/metrics/refresh", { session }, { body: { full: true } })).status).toBe(403);
    const owner = await createOperator("owner");
    const full = await admin("POST", "/metrics/refresh", { session: owner.session }, { body: { full: true } });
    expect(full.body).toMatchObject({ refreshed: true, full: true });
  });
});

describe("promotional grants", () => {
  it("grants and revokes from the dashboard, needs grants:manage and all apps, and shows on the customer", async () => {
    const user = "dash-grant";
    await postAppleTransaction(user, { productId: "coins_100", type: "Consumable", expiresDate: undefined }); // makes the customer
    const dev = await createOperator("developer");
    const grants = `/customers/${enc(user)}/grants`;
    const created = await admin("POST", grants, { session: dev.session }, { body: { entitlement_id: "pro", duration: "three_day", note: "beta tester" } });
    expect(created.status).toBe(201);
    expect(created.body.grant).toMatchObject({ entitlement_id: "pro", duration: "three_day", source: "dashboard", granted_by: dev.email });
    const custom = await admin("POST", grants, { session: dev.session }, { body: { entitlement_id: "annual_perks", expires_at: new Date(now() + 40 * DAY).toISOString() } });
    expect(custom.body.grant.duration).toBe("custom");

    await settle();
    const detail = await admin("GET", `/customers/${enc(user)}`, { session: dev.session });
    expect(detail.body.grants).toHaveLength(2);
    expect(detail.body.entitlement_ids).toEqual(["pro", "annual_perks"]);
    expect(detail.body.customer_info.subscriber.entitlements.pro.product_identifier).toBe("rc_promo_pro_three_day");

    const revoked = await admin("POST", `${grants}/${created.body.grant.id}/revoke`, { session: dev.session }, { body: {} });
    expect(revoked.status).toBe(200);
    await settle();
    expect((await admin("GET", `/customers/${enc(user)}`, { session: dev.session })).body.customer_info.subscriber.entitlements.pro).toBeUndefined();

    const viewer = await createOperator("viewer");
    expect((await admin("POST", grants, { session: viewer.session }, { body: { entitlement_id: "pro", duration: "weekly" } })).status).toBe(403);
    const limited = await createOperator("admin", { apps: ["ios"] });
    expect((await admin("POST", grants, { session: limited.session }, { body: { entitlement_id: "pro", duration: "weekly" } })).status).toBe(403);
    expect((await admin("POST", "/customers/nobody-here/grants", { session: dev.session }, { body: { entitlement_id: "pro", duration: "weekly" } })).status).toBe(404);
    expect((await admin("POST", grants, { session: dev.session }, { body: { entitlement_id: "pro", expires_at: "2001-01-01" } })).status).toBe(400);
  });

  it("keeps customers with grants out of the inactive-customer cleanup", async () => {
    for (const user of ["old-granted", "old-plain"]) {
      await call(`/v1/subscribers/${user}/attributes`, { body: { attributes: { $displayName: { value: "x", updated_at_ms: 1 } } } });
    }
    expect((await admin("POST", "/customers/old-granted/grants", {}, { body: { entitlement_id: "pro", duration: "lifetime" } })).status).toBe(201);
    await advanceClock(400 * DAY);
    await jobs();
    expect((await admin("GET", "/customers/old-granted")).status).toBe(200);
    // How long inactive customers are kept is Lite's choice (90 days).
    if (onEdition("lite")) expect((await admin("GET", "/customers/old-plain")).status).toBe(404);
  });
});

describe("webhooks", () => {
  it("lists deliveries and replays an event", async () => {
    await reset(withWebhooks(testConfig()));
    let status = 500;
    fake.webhookStatus(() => status);
    await call("/v1/receipts", { body: { app_user_id: "admin-wh", fetch_token: (await signTransaction()).jws } });
    await settle();
    const dev = await createOperator("developer");
    const failed = await admin("GET", "/webhooks/deliveries?status=pending", { session: dev.session });
    const delivery = failed.body.deliveries.find((d: any) => d.last_status === 500);
    expect(delivery).toBeDefined();
    const before = fake.received("backend").length;
    expect(before).toBeGreaterThan(0);

    status = 200;
    const replay = await admin("POST", `/webhooks/events/${delivery.event_id}/replay`, { session: dev.session }, { body: {} });
    expect(replay.status).toBe(200);
    await settle();
    const received = fake.received("backend");
    expect(received.length).toBe(before + 1);
    expect(received.at(-1)!.body.event.id).toBe(received[0]!.body.event.id); // same event, same id
    const delivered = await admin("GET", "/webhooks/deliveries?status=delivered", { session: dev.session });
    expect(delivered.body.deliveries.map((d: any) => d.event_id)).toContain(delivery.event_id);

    const viewer = await createOperator("viewer");
    expect((await admin("POST", `/webhooks/events/${delivery.event_id}/replay`, { session: viewer.session }, { body: {} })).status).toBe(403);
  });
});

describe("audit log and settings", () => {
  it("records admin writes with who and how, readable by admins", async () => {
    const owner = await totpOwner();
    const t = await createToken(owner.session, ["admin"]);
    await admin("POST", "/secret-keys", { token: t }, { body: { name: "audited" } });
    const entries = (await admin("GET", "/audit?limit=5", { session: owner.session })).body.entries;
    expect(entries[0]).toMatchObject({ action: "secret_key.created", source: "api", operator_id: owner.id, details: { name: "audited", scopes: ["customers:read"] } });
    expect(entries[0].token_id).toBeTruthy();

    // Owners can require two-step sign-in, but only once they use it themselves.
    const noTotp = await createOperator("owner");
    expect((await admin("PUT", "/settings", { session: noTotp.session }, { body: { require_totp: true } })).status).toBe(403);
    expect((await admin("PUT", "/settings", { session: owner.session }, { body: { require_totp: false } })).status).toBe(200);
    const adminOp = await createOperator("admin");
    expect((await admin("PUT", "/settings", { session: adminOp.session }, { body: { require_totp: false } })).status).toBe(403);
  });

  it("keeps the SDK URL (the apps' proxyURL) as a deployment-wide setting that owners set, and says which edition this is", async () => {
    const owner = await createOperator("owner");
    const viewer = await createOperator("viewer");
    const put = (session: string, sdk_url: unknown) => admin("PUT", "/settings", { session }, { body: { sdk_url } });
    expect((await admin("GET", "/settings", { session: viewer.session })).body).toMatchObject({ sdk_url: null, edition: EDITION });
    expect((await put(owner.session, "https://purchases.example.com/")).body).toMatchObject({ sdk_url: "https://purchases.example.com" });
    expect((await admin("GET", "/settings", { session: viewer.session })).body.sdk_url).toBe("https://purchases.example.com");
    expect((await put(owner.session, "https://purchases.example.com/v1")).body.message).toMatch(/no path/);
    expect((await put(owner.session, "http://purchases.example.com")).body.message).toMatch(/https/);
    expect((await put(owner.session, "purchases")).status).toBe(400);
    expect((await put(viewer.session, "https://x.example.com")).status).toBe(403);
    const audit = (await admin("GET", "/audit?limit=10", { session: owner.session })).body.entries;
    expect(audit.find((e: { action: string }) => e.action === "setting.sdk_url")).toMatchObject({ details: { value: "https://purchases.example.com" } });
    expect((await put(owner.session, "")).body.sdk_url).toBeNull();
  });
});

describe("dashboard language", () => {
  it("is null (follow the browser) until set, and any operator can set their own", async () => {
    const viewer = await createOperator("viewer");
    expect((await admin("GET", "/me", { session: viewer.session })).body.operator.locale).toBeNull();
    const set = await admin("PATCH", "/me", { session: viewer.session }, { body: { locale: "ja" } });
    expect(set.status).toBe(200);
    expect(set.body.operator.locale).toBe("ja");
    expect((await admin("GET", "/me", { session: viewer.session })).body.operator.locale).toBe("ja");
    // Back to following the browser.
    expect((await admin("PATCH", "/me", { session: viewer.session }, { body: { locale: null } })).body.operator.locale).toBeNull();
    const entries = (await admin("GET", "/audit?limit=500")).body.entries as { action: string; target: string | null }[];
    expect(entries.find((e) => e.action === "operator.locale" && e.target === viewer.id)).toBeDefined();
  });

  it("accepts only the dashboard's languages, and works with a read-only token", async () => {
    const dev = await createOperator("developer");
    const bad = await admin("PATCH", "/me", { session: dev.session }, { body: { locale: "klingon" } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/zh-tw/);
    const pat = await createToken(dev.session, ["read"]);
    expect((await admin("PATCH", "/me", { token: pat }, { body: { locale: "zh-tw" }, origin: null })).body.operator.locale).toBe("zh-tw");
  });
});
