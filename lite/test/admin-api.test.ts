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
