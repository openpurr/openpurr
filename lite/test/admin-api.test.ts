import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/office/auth";
import { hashPassword, randomToken, sha256Hex } from "../src/office/auth-crypto";
import { appWithWebhooks, call, envWithWebhookSecrets, postAppleTransaction, signTransaction, testApp, webhookReceiver } from "./helpers";

const SECRET = "test-operator-secret-0123456789abcdef";
const ORIGIN = "https://openpurr.test";
const adminEnv = () => ({ ...env, OPERATOR_SECRET: SECRET });

let n = 0;
async function operator(role: "owner" | "admin" | "developer" | "viewer", opts: { apps?: string[]; totp?: boolean } = {}) {
  const id = crypto.randomUUID();
  const email = `${role}${++n}-${Date.now()}@example.com`;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, app_ids, password_hash, totp_enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      email,
      role,
      role,
      opts.apps ? JSON.stringify(opts.apps) : null,
      await hashPassword(SECRET, "a long test passphrase"),
      opts.totp ? 1 : 0,
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
  return { id, email, session };
}

async function token(operatorId: string, scopes: string[]) {
  const t = `pat_${randomToken()}`;
  await env.DB.prepare("INSERT INTO access_token (id, operator_id, token_hash, token_prefix, name, scopes, created_at) VALUES (?, ?, ?, ?, 'test', ?, ?)")
    .bind(crypto.randomUUID(), operatorId, await sha256Hex(t), t.slice(0, 10), JSON.stringify(scopes), Date.now())
    .run();
  return t;
}

async function api(
  method: string,
  path: string,
  auth: { session?: string; token?: string },
  opts: { body?: unknown; origin?: string | null; app?: { fetch: typeof testApp.fetch }; env?: object } = {},
) {
  const ctx = createExecutionContext();
  const res = await (opts.app ?? testApp).fetch(
    new Request(`${ORIGIN}/admin/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(auth.session ? { cookie: `${SESSION_COOKIE}=${auth.session}` } : {}),
        ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
        ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    opts.env ?? adminEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.json<any>() };
}

describe("authentication", () => {
  it("lists the configured apps, limited to the operator's apps", async () => {
    const all = await api("GET", "/apps", { session: (await operator("viewer")).session });
    expect(all.status).toBe(200);
    expect(all.body.apps.length).toBeGreaterThan(0);
    const first = all.body.apps[0];
    expect(first).toMatchObject({ id: expect.any(String), store: expect.any(String) });
    const limited = await api("GET", "/apps", { session: (await operator("viewer", { apps: [first.id] })).session });
    expect(limited.body.apps.map((a: { id: string }) => a.id)).toEqual([first.id]);
  });

  it("needs a session or a valid access token", async () => {
    expect((await api("GET", "/me", {})).status).toBe(401);
    expect((await api("GET", "/me", { token: "pat_not-a-real-token" })).status).toBe(401);
    const op = await operator("viewer");
    expect((await api("GET", "/me", { session: op.session })).body).toMatchObject({ via: "session", permissions: ["read"] });
    const t = await token(op.id, ["read"]);
    expect((await api("GET", "/me", { token: t })).body.via).toBe("token");
  });

  it("requires same-origin for session writes, but not for tokens", async () => {
    const op = await operator("developer");
    expect((await api("POST", "/secret-keys", { session: op.session }, { body: { name: "x" }, origin: null })).status).toBe(403);
    const t = await token(op.id, ["admin"]);
    expect((await api("POST", "/secret-keys", { token: t }, { body: { name: "x" }, origin: null })).status).toBe(201);
  });

  it("holds operators without two-step sign-in to /me when the owner requires it", async () => {
    const op = await operator("admin");
    await env.DB.prepare("INSERT INTO setting (key, value, updated_at) VALUES ('require_totp', 'true', ?) ON CONFLICT (key) DO UPDATE SET value = 'true'").bind(Date.now()).run();
    try {
      expect((await api("GET", "/me", { session: op.session })).status).toBe(200);
      expect((await api("GET", "/operators", { session: op.session })).body.code).toBe("totp_enrollment_required");
    } finally {
      await env.DB.prepare("UPDATE setting SET value = 'false' WHERE key = 'require_totp'").run();
    }
  });
});

describe("roles and token scopes", () => {
  it("lets each role do only its part", async () => {
    const viewer = await operator("viewer");
    const developer = await operator("developer");
    expect((await api("GET", "/operators", { session: viewer.session })).status).toBe(200);
    expect((await api("POST", "/secret-keys", { session: viewer.session }, { body: { name: "k" } })).status).toBe(403);
    expect((await api("POST", "/secret-keys", { session: developer.session }, { body: { name: "k" } })).status).toBe(201);
    expect((await api("POST", "/operators", { session: developer.session }, { body: { email: "x@example.com", role: "viewer" } })).status).toBe(403);
    expect((await api("GET", "/audit", { session: developer.session })).status).toBe(403);
  });

  it("limits a token to its role AND its scopes", async () => {
    const developer = await operator("developer");
    const readOnly = await token(developer.id, ["read"]);
    expect((await api("POST", "/secret-keys", { token: readOnly }, { body: { name: "k" } })).status).toBe(403);
    const viewer = await operator("viewer");
    const overScoped = await token(viewer.id, ["admin"]); // scope can't exceed the role
    expect((await api("POST", "/secret-keys", { token: overScoped }, { body: { name: "k" } })).status).toBe(403);
  });

  it("mints tokens only from a session; a token works until revoked", async () => {
    const op = await operator("developer");
    const created = await api("POST", "/tokens", { session: op.session }, { body: { name: "cli", scopes: ["read"], expires_in_days: 30 } });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^pat_/);
    expect((await api("POST", "/tokens", { token: created.body.token }, { body: { name: "x", scopes: ["read"] } })).status).toBe(403);
    expect((await api("GET", "/tokens", { session: op.session })).body.tokens).toHaveLength(1);
    expect((await api("DELETE", `/tokens/${created.body.id}`, { session: op.session })).status).toBe(200);
    expect((await api("GET", "/me", { token: created.body.token })).status).toBe(401);
  });
});

describe("operators", () => {
  it("admins invite non-owners; only owners add owners", async () => {
    const adminOp = await operator("admin");
    const invited = await api("POST", "/operators", { session: adminOp.session }, { body: { email: `New${Date.now()}@Example.com`, role: "developer" } });
    expect(invited.status).toBe(201);
    expect(invited.body.setup_link).toMatch(/^https:\/\/openpurr\.test\/admin\/link#token=/);
    expect((await api("POST", "/operators", { session: adminOp.session }, { body: { email: `o${Date.now()}@example.com`, role: "owner" } })).status).toBe(403);
    const owner = await operator("owner");
    expect((await api("POST", "/operators", { session: owner.session }, { body: { email: `o2${Date.now()}@example.com`, role: "owner" } })).status).toBe(201);
  });

  it("never removes the last active owner", async () => {
    // Disable every other owner the earlier tests made, so this one is the only one.
    await env.DB.prepare("UPDATE operator SET disabled_at = ? WHERE role = 'owner'").bind(Date.now()).run();
    const owner = await operator("owner");
    const other = await operator("admin");
    await env.DB.prepare("UPDATE operator SET role = 'owner' WHERE id = ?").bind(other.id).run();
    // Two owners: demoting one is fine.
    expect((await api("PATCH", `/operators/${other.id}`, { session: owner.session }, { body: { role: "admin" } })).status).toBe(200);
    // One owner left: can't be demoted or disabled, and can't change their own role.
    expect((await api("PATCH", `/operators/${owner.id}`, { session: owner.session }, { body: { role: "admin" } })).status).toBe(403);
    expect((await api("PATCH", `/operators/${owner.id}`, { session: owner.session }, { body: { disabled: true } })).status).toBe(403);
  });

  it("disabling ends sessions and revokes tokens; reset issues a new setup link", async () => {
    const owner = await operator("owner");
    const dev = await operator("developer");
    const t = await token(dev.id, ["read"]);
    expect((await api("PATCH", `/operators/${dev.id}`, { session: owner.session }, { body: { disabled: true } })).status).toBe(200);
    expect((await api("GET", "/me", { session: dev.session })).status).toBe(401);
    expect((await api("GET", "/me", { token: t })).status).toBe(401);

    const dev2 = await operator("developer");
    const reset = await api("POST", `/operators/${dev2.id}/reset`, { session: owner.session }, { body: {} });
    expect(reset.body.setup_link).toMatch(/#token=/);
    const row = await env.DB.prepare("SELECT password_hash, totp_enabled FROM operator WHERE id = ?").bind(dev2.id).first();
    expect(row).toEqual({ password_hash: null, totp_enabled: 0 });
    expect((await api("GET", "/me", { session: dev2.session })).status).toBe(401);
  });
});

describe("customers", () => {
  it("shows CustomerInfo, attributes and transactions; app-limited operators see only their apps", async () => {
    await postAppleTransaction("admin-cust", { productId: "pro_monthly" });
    await call("/v1/subscribers/admin-cust/attributes", { body: { attributes: { $email: { value: "c@example.com", updated_at_ms: 1 } } } });
    const viewer = await operator("viewer");
    const res = await api("GET", "/customers/admin-cust", { session: viewer.session });
    expect(res.status).toBe(200);
    expect(res.body.customer_info.subscriber.entitlements.pro).toBeDefined();
    expect(res.body.attributes.$email.value).toBe("c@example.com");
    expect(res.body.transactions[0]).toMatchObject({ app_id: "ios", product_id: "pro_monthly" });

    const androidOnly = await operator("viewer", { apps: ["android"] });
    const limited = await api("GET", "/customers/admin-cust", { session: androidOnly.session });
    expect(limited.body.transactions).toEqual([]);
    expect(limited.body.customer_info).toBeUndefined();
    expect((await api("GET", "/customers/nobody-here", { session: viewer.session })).status).toBe(404);
  });
});

describe("customer list", () => {
  const FUTURE = Date.now() + 1e12; // newer than every customer other tests create
  let seq = 0;
  /** A customer with aliases, an optional email and purchases, inserted directly. */
  async function seed(opts: {
    firstSeen: number;
    aliases: string[];
    email?: string;
    purchases?: { app: string; store: "app_store" | "play_store"; tx: string; otx?: string; product: string; type?: string; expires?: number | null; revoked?: boolean }[];
  }) {
    const id = `list-${++seq}-${crypto.randomUUID()}`;
    const now = Date.now();
    const writes = [
      env.DB.prepare("INSERT INTO customer (id, app_user_id, first_seen) VALUES (?, ?, ?)").bind(id, opts.aliases[0], opts.firstSeen),
      ...opts.aliases.map((a) => env.DB.prepare("INSERT INTO customer_alias (project_id, app_user_id, customer_id, created_at) VALUES ('default', ?, ?, ?)").bind(a, id, now)),
    ];
    if (opts.email) {
      writes.push(env.DB.prepare("INSERT INTO subscriber_attribute (customer_id, key, value, updated_at, received_at) VALUES (?, '$email', ?, ?, ?)").bind(id, opts.email, now, now));
    }
    for (const [i, t] of (opts.purchases ?? []).entries()) {
      const otx = t.otx ?? t.tx;
      writes.push(
        env.DB.prepare(
          `INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id, product_type, purchased_at, original_purchased_at, expires_at, revoked_at, verified, source, received_at, updated_at)
           VALUES (?, ?, 'production', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'sdk', ?, ?)`,
        ).bind(t.app, t.store, t.tx, otx, t.product, t.type ?? "subscription", now - 1000 + i, now - 1000, t.expires ?? null, t.revoked ? now : null, now, now),
        env.DB.prepare("INSERT INTO purchase_owner (store, original_transaction_id, customer_id, app_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(t.store, otx, id, t.app, now),
      );
    }
    await env.DB.batch(writes);
    return id;
  }

  it("lists the newest customers first, a page at a time", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const a = await seed({ firstSeen: FUTURE + 1, aliases: [`page-${tag}-a`] });
    const b = await seed({ firstSeen: FUTURE + 2, aliases: [`page-${tag}-b`] });
    const c = await seed({ firstSeen: FUTURE + 3, aliases: [`page-${tag}-c`] });
    const { session } = await operator("viewer");
    const first = await api("GET", "/customers?limit=2", { session });
    expect(first.status).toBe(200);
    expect(first.body.customers.map((x: { id: string }) => x.id)).toEqual([c, b]);
    expect(first.body.next_before).toBe(`${FUTURE + 2}:${b}`);
    const second = await api("GET", `/customers?limit=2&before=${encodeURIComponent(first.body.next_before)}`, { session });
    expect(second.body.customers[0].id).toBe(a);
    expect((await api("GET", "/customers?before=nonsense", { session })).status).toBe(400);
  });

  it("finds customers by app user ID prefix, email, or store transaction ID, with a purchase summary", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const id = await seed({
      firstSeen: Date.now(),
      aliases: [`$RCAnonymousID:${tag}`, `member-${tag}`],
      email: `Pat.${tag}@Example.com`,
      purchases: [
        { app: "ios", store: "app_store", tx: `tx-${tag}-1`, product: "pro_monthly", expires: Date.now() - 864e5 },
        { app: "ios", store: "app_store", tx: `tx-${tag}-2`, otx: `tx-${tag}-1`, product: "pro_annual", expires: Date.now() + 864e5 },
      ],
    });
    const lonely = await seed({ firstSeen: Date.now(), aliases: [`member-${tag}-nopurchases`] });
    const { session } = await operator("viewer");
    const ids = async (q: string, extra = "") => (await api("GET", `/customers?q=${encodeURIComponent(q)}${extra}`, { session })).body.customers.map((x: { id: string }) => x.id);

    expect(await ids(`member-${tag}`)).toEqual(expect.arrayContaining([id, lonely]));
    expect(await ids(`member-${tag}`, "&purchases=1")).toEqual([id]);
    expect(await ids(`pat.${tag}@example.com`)).toEqual([id]); // email, any case
    expect(await ids(`tx-${tag}-2`)).toEqual([id]); // a renewal's transaction ID
    expect(await ids(`tx-${tag}-1`)).toEqual([id]); // the original transaction ID
    expect(await ids(`no-such-${tag}`)).toEqual([]);

    const [row] = (await api("GET", `/customers?q=${encodeURIComponent(`$RCAnonymousID:${tag}`)}`, { session })).body.customers;
    expect(row).toMatchObject({ id, app_user_id: `$RCAnonymousID:${tag}`, email: `Pat.${tag}@Example.com`, purchases: 2, active: true, last_product: "pro_annual", stores: ["app_store"] });
  });

  it("shows app-limited operators only customers with purchases in their apps", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const iosBuyer = await seed({ firstSeen: Date.now(), aliases: [`scope-${tag}-ios`], purchases: [{ app: "ios", store: "app_store", tx: `scope-${tag}-1`, product: "lifetime", type: "non_consumable" }] });
    const androidBuyer = await seed({ firstSeen: Date.now(), aliases: [`scope-${tag}-android`], purchases: [{ app: "android", store: "play_store", tx: `scope-${tag}-2`, product: "pro", expires: Date.now() - 1000 }] });
    await seed({ firstSeen: Date.now(), aliases: [`scope-${tag}-none`] });
    const iosOnly = await operator("viewer", { apps: ["ios"] });
    const list = (await api("GET", `/customers?q=scope-${tag}`, { session: iosOnly.session })).body.customers;
    expect(list.map((x: { id: string }) => x.id)).toEqual([iosBuyer]);
    expect(list[0]).toMatchObject({ active: true, purchases: 1 }); // a non-consumable stays active

    const all = (await api("GET", `/customers?q=scope-${tag}`, { session: (await operator("viewer")).session })).body.customers;
    expect(all).toHaveLength(3);
    expect(all.find((x: { id: string }) => x.id === androidBuyer)).toMatchObject({ active: false, purchases: 1 });
  });
});

describe("charts API", () => {
  it("lists charts and serves one as JSON or CSV, with validated parameters", async () => {
    const { session } = await operator("viewer");
    const list = await api("GET", "/metrics", { session });
    expect(list.status).toBe(200);
    expect(list.body.charts.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(["revenue", "mrr", "active_subscriptions", "new_customers"]));

    const mrr = await api("GET", "/metrics/mrr?from=2026-01-01&to=2026-01-31&interval=week", { session });
    expect(mrr.status).toBe(200);
    expect(mrr.body).toMatchObject({ chart: "mrr", unit: "usd", kind: "running", interval: "week" });
    expect(mrr.body.points[0]).toMatchObject({ date: "2025-12-29", values: { mrr: expect.any(Number) } });

    const ctx = createExecutionContext();
    const csv = await testApp.fetch(
      new Request(`${ORIGIN}/admin/v1/metrics/revenue?from=2026-01-01&to=2026-01-03&format=csv`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }),
      adminEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect((await csv.text()).split("\n")[0]).toBe("date,net,refunds,gross");

    for (const bad of ["from=2026-02-01&to=2026-01-01", "from=yesterday", "interval=hour", "environment=staging", "store=amazon", "from=2000-01-01&to=2026-01-01"]) {
      expect((await api("GET", `/metrics/revenue?${bad}`, { session })).status).toBe(400);
    }
    expect((await api("GET", "/metrics/ltv", { session })).status).toBe(404);
    expect((await api("GET", "/metrics/revenue?app=not-an-app", { session })).status).toBe(404);
  });

  it("lists products per app (Google base plans separately) and filters charts by them", async () => {
    const { session } = await operator("viewer");
    const apps = (await api("GET", "/apps", { session })).body.apps as { id: string; products: string[] }[];
    expect(apps.find((a) => a.id === "android")!.products).toEqual(expect.arrayContaining(["pro:monthly", "pro:annual", "lifetime"]));
    expect(apps.find((a) => a.id === "ios")!.products).toEqual(expect.arrayContaining(["pro_monthly", "pro_annual"]));
    expect((await api("GET", "/metrics/mrr?product=pro:monthly", { session })).status).toBe(200);
    expect((await api("GET", "/metrics/mrr?app=ios&product=pro:monthly", { session })).status).toBe(404); // not an iOS product
    expect((await api("GET", "/metrics/mrr?product=nope", { session })).status).toBe(404);
    const status = await api("GET", "/metrics/subscription_status", { session });
    expect(status.body).toMatchObject({ kind: "breakdown", categories: expect.arrayContaining([expect.objectContaining({ key: "active", value: expect.any(Number) })]) });
  });

  it("refreshes at most once a minute; only owners rebuild all history", async () => {
    const { session } = await operator("viewer");
    const first = await api("POST", "/metrics/refresh", { session }, { body: {} });
    expect(first.status).toBe(200);
    expect((await api("POST", "/metrics/refresh", { session }, { body: {} })).body.refreshed).toBe(false);
    expect((await api("POST", "/metrics/refresh", { session }, { body: { full: true } })).status).toBe(403);
    const owner = await operator("owner");
    const full = await api("POST", "/metrics/refresh", { session: owner.session }, { body: { full: true } });
    expect(full.body).toMatchObject({ refreshed: true, full: true });
  });
});

describe("promotional grants", () => {
  it("grants and revokes from the dashboard, needs grants:manage and all apps, and shows on the customer", async () => {
    const user = `dash-grant-${crypto.randomUUID()}`;
    await postAppleTransaction(user, { productId: "coins_100", type: "Consumable", expiresDate: undefined }); // makes the customer
    const dev = await operator("developer");
    const created = await api("POST", `/customers/${encodeURIComponent(user)}/grants`, { session: dev.session }, { body: { entitlement_id: "pro", duration: "three_day", note: "beta tester" } });
    expect(created.status).toBe(201);
    expect(created.body.grant).toMatchObject({ entitlement_id: "pro", duration: "three_day", source: "dashboard", granted_by: dev.email });
    const custom = await api("POST", `/customers/${encodeURIComponent(user)}/grants`, { session: dev.session }, { body: { entitlement_id: "annual_perks", expires_at: new Date(Date.now() + 864e5 * 40).toISOString() } });
    expect(custom.body.grant.duration).toBe("custom");

    const detail = await api("GET", `/customers/${encodeURIComponent(user)}`, { session: dev.session });
    expect(detail.body.grants).toHaveLength(2);
    expect(detail.body.entitlement_ids).toEqual(["pro", "annual_perks"]);
    expect(detail.body.customer_info.subscriber.entitlements.pro.product_identifier).toBe("rc_promo_pro_three_day");

    const revoked = await api("POST", `/customers/${encodeURIComponent(user)}/grants/${created.body.grant.id}/revoke`, { session: dev.session }, { body: {} });
    expect(revoked.status).toBe(200);
    expect((await api("GET", `/customers/${encodeURIComponent(user)}`, { session: dev.session })).body.customer_info.subscriber.entitlements.pro).toBeUndefined();

    const viewer = await operator("viewer");
    expect((await api("POST", `/customers/${encodeURIComponent(user)}/grants`, { session: viewer.session }, { body: { entitlement_id: "pro", duration: "weekly" } })).status).toBe(403);
    const limited = await operator("admin", { apps: ["ios"] });
    expect((await api("POST", `/customers/${encodeURIComponent(user)}/grants`, { session: limited.session }, { body: { entitlement_id: "pro", duration: "weekly" } })).status).toBe(403);
    expect((await api("POST", `/customers/nobody-${crypto.randomUUID()}/grants`, { session: dev.session }, { body: { entitlement_id: "pro", duration: "weekly" } })).status).toBe(404);
    expect((await api("POST", `/customers/${encodeURIComponent(user)}/grants`, { session: dev.session }, { body: { entitlement_id: "pro", expires_at: "2001-01-01" } })).status).toBe(400);
  });

  it("keeps customers with grants out of the inactive-customer cleanup", async () => {
    const id = crypto.randomUUID();
    const old = Date.now() - 400 * 864e5;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO customer (id, app_user_id, first_seen) VALUES (?, ?, ?)").bind(id, `old-${id}`, old),
      env.DB.prepare("INSERT INTO customer_alias (project_id, app_user_id, customer_id, created_at) VALUES ('default', ?, ?, ?)").bind(`old-${id}`, id, old),
      env.DB.prepare("INSERT INTO promotional_grant (id, customer_id, entitlement_id, duration, starts_at, expires_at, granted_by, source, created_at) VALUES (?, ?, 'pro', 'lifetime', ?, NULL, 'x', 'api', ?)").bind(crypto.randomUUID(), id, old, old),
    ]);
    const { runScheduled } = await import("../src/scheduled");
    await runScheduled(env, Date.parse("2026-12-01T10:00:00Z"));
    expect(await env.DB.prepare("SELECT 1 AS ok FROM customer WHERE id = ?").bind(id).first()).toEqual({ ok: 1 });
  });
});

describe("webhooks", () => {
  it("lists deliveries and replays an event", async () => {
    let status = 500;
    const receiver = webhookReceiver(() => status);
    const { app } = appWithWebhooks(receiver);
    await call("/v1/receipts", { app, env: envWithWebhookSecrets(), body: { app_user_id: "admin-wh", fetch_token: (await signTransaction()).jws } });
    const dev = await operator("developer");
    const failed = await api("GET", "/webhooks/deliveries?status=pending", { session: dev.session }, { app, env: { ...envWithWebhookSecrets(), OPERATOR_SECRET: SECRET } });
    const delivery = failed.body.deliveries.find((d: any) => d.last_status === 500);
    expect(delivery).toBeDefined();

    status = 200;
    const replay = await api("POST", `/webhooks/events/${delivery.event_id}/replay`, { session: dev.session }, { body: {}, app, env: { ...envWithWebhookSecrets(), OPERATOR_SECRET: SECRET } });
    expect(replay.status).toBe(200);
    expect(receiver.received).toHaveLength(2);
    expect(receiver.received[1]!.body.event.id).toBe(receiver.received[0]!.body.event.id); // same event, same id
    const viewer = await operator("viewer");
    expect((await api("POST", `/webhooks/events/${delivery.event_id}/replay`, { session: viewer.session }, { body: {}, app })).status).toBe(403);
  });
});

describe("audit log and settings", () => {
  it("records admin writes with who and how, readable by admins", async () => {
    const owner = await operator("owner", { totp: true });
    const t = await token(owner.id, ["admin"]);
    await api("POST", "/secret-keys", { token: t }, { body: { name: "audited" } });
    const entries = (await api("GET", "/audit?limit=5", { session: owner.session })).body.entries;
    expect(entries[0]).toMatchObject({ action: "secret_key.created", source: "api", operator_id: owner.id, details: { name: "audited", scopes: ["customers:read"] } });
    expect(entries[0].token_id).toBeTruthy();

    // Owners can require two-step sign-in, but only once they use it themselves.
    const noTotp = await operator("owner");
    expect((await api("PUT", "/settings", { session: noTotp.session }, { body: { require_totp: true } })).status).toBe(403);
    expect((await api("PUT", "/settings", { session: owner.session }, { body: { require_totp: false } })).status).toBe(200);
    const adminOp = await operator("admin");
    expect((await api("PUT", "/settings", { session: adminOp.session }, { body: { require_totp: false } })).status).toBe(403);
  });
});
