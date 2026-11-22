import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  hashPassword,
  sha256Hex,
  totpCode,
  verifyPassword,
} from "../src/office/auth-crypto";
import { SESSION_COOKIE } from "../src/office/auth";
import { appWithRateLimits, testApp } from "./helpers";

const SECRET = "test-operator-secret-0123456789abcdef";
const ORIGIN = "https://openpurr.test";
const authEnv = (secret: string | null = SECRET) => ({ ...env, OPERATOR_SECRET: secret ?? undefined });

async function req(
  path: string,
  opts: { body?: unknown; cookie?: string | null; origin?: string | null; env?: object; app?: { fetch: typeof testApp.fetch }; ip?: string } = {},
) {
  const ctx = createExecutionContext();
  const res = await (opts.app ?? testApp).fetch(
    new Request(`${ORIGIN}/admin/v1/auth${path}`, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
        ...(opts.cookie ? { cookie: `${SESSION_COOKIE}=${opts.cookie}` } : {}),
        ...(opts.ip ? { "cf-connecting-ip": opts.ip } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    opts.env ?? authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const set = res.headers.get("set-cookie") ?? "";
  const session = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(set)?.[1] || null;
  return { res, body: await res.json<any>(), session, setCookie: set };
}

let n = 0;
/** An operator with a setup link, as `admin.mjs create` makes. Returns the link token. */
async function newOperator(role = "owner", email = `op${++n}-${Date.now()}@example.com`) {
  const id = crypto.randomUUID();
  const token = `link-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, email, "Test", role, Date.now()),
    env.DB.prepare("INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES (?, ?, 'setup', ?, ?)").bind(
      await sha256Hex(token),
      id,
      Date.now() + 3600_000,
      Date.now(),
    ),
  ]);
  return { id, email, token };
}

/** An operator who has set a password. Returns a full session. */
async function signedUp(password = "correct horse battery staple") {
  const op = await newOperator();
  const link = await req("/link", { body: { token: op.token } });
  await req("/password", { body: { new_password: password }, cookie: link.session });
  return { ...op, password, session: link.session! };
}

describe("credential crypto", () => {
  it("peppers and hashes passwords, and only the same secret verifies them", async () => {
    const stored = await hashPassword(SECRET, "a long passphrase here");
    expect(stored).toMatch(/^pbkdf2-sha256\$20000\$[0-9a-f]{8}\$/);
    expect(await verifyPassword(SECRET, "a long passphrase here", stored)).toEqual({ ok: true, rehash: false });
    expect((await verifyPassword(SECRET, "wrong passphrase here!", stored)).ok).toBe(false);
    // Without the pepper (a different OPERATOR_SECRET), the database hash is useless.
    expect((await verifyPassword("another-secret-0123456789abcdefghij", "a long passphrase here", stored)).ok).toBe(false);
    // Old parameters verify but ask for a re-hash.
    const old = await hashPassword(SECRET, "a long passphrase here", 10_000);
    expect(await verifyPassword(SECRET, "a long passphrase here", old)).toEqual({ ok: true, rehash: true });
  });

  it("computes RFC 6238 TOTP codes (the RFC's SHA-1 test vectors)", async () => {
    const secret = new TextEncoder().encode("12345678901234567890");
    expect(await totpCode(secret, Math.floor(59 / 30))).toBe("287082"); // 94287082
    expect(await totpCode(secret, Math.floor(1111111109 / 30))).toBe("081804"); // 07081804
    expect(await totpCode(secret, Math.floor(1234567890 / 30))).toBe("005924"); // 89005924
    expect(base32Decode(base32Encode(secret))).toEqual(secret);
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI"); // RFC 4648
  });

  it("encrypts TOTP secrets at rest", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(20));
    const stored = await encryptTotpSecret(SECRET, raw);
    expect(stored).toMatch(/^v1:/);
    expect(await decryptTotpSecret(SECRET, stored)).toEqual(raw);
  });
});

describe("setup links and passwords", () => {
  it("a setup link gives a setup-only session; setting a password makes it a full session", async () => {
    const op = await newOperator();
    const link = await req("/link", { body: { token: op.token } });
    expect(link.res.status).toBe(200);
    expect(link.body.session).toBe("setup");
    expect(link.setCookie).toMatch(/HttpOnly; Secure; SameSite=Strict/);

    // A setup session can't do anything but set a password.
    expect((await req("/totp/setup", { body: {}, cookie: link.session })).res.status).toBe(401);
    expect((await req("/password", { body: { new_password: "short" }, cookie: link.session })).body.code).toBe("weak_password");
    expect((await req("/password", { body: { new_password: "a perfectly fine passphrase" }, cookie: link.session })).res.status).toBe(200);
    const me = await req("/me", { cookie: link.session });
    expect(me.body).toMatchObject({ session: "full", operator: { email: op.email, role: "owner", has_password: true, totp_enabled: false } });
  });

  it("links work once, and not after they expire", async () => {
    const op = await newOperator();
    expect((await req("/link", { body: { token: op.token } })).res.status).toBe(200);
    expect((await req("/link", { body: { token: op.token } })).body.code).toBe("invalid_link");
    const expired = await newOperator();
    await env.DB.prepare("UPDATE login_link SET expires_at = ? WHERE operator_id = ?").bind(Date.now() - 1, expired.id).run();
    expect((await req("/link", { body: { token: expired.token } })).body.code).toBe("invalid_link");
  });

  it("a link works once even when redeemed twice at the same moment", async () => {
    const op = await newOperator();
    const both = await Promise.all([req("/link", { body: { token: op.token } }), req("/link", { body: { token: op.token } })]);
    expect(both.map((r) => r.res.status).sort()).toEqual([200, 401]);
    expect(both.find((r) => r.res.status === 401)!.body.code).toBe("invalid_link");
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM session WHERE operator_id = ?").bind(op.id).first<{ n: number }>())!;
    expect(n).toBe(1);
  });
});

describe("sign-in", () => {
  it("signs in with the password and sets a session cookie", async () => {
    const op = await signedUp();
    const login = await req("/login", { body: { email: op.email.toUpperCase(), password: op.password } });
    expect(login.res.status).toBe(200);
    expect(login.session).toBeTruthy();
    expect((await req("/me", { cookie: login.session })).body.operator.email).toBe(op.email);
    const logout = await req("/logout", { body: {}, cookie: login.session });
    expect(logout.setCookie).toMatch(/Max-Age=0/);
    expect((await req("/me", { cookie: login.session })).res.status).toBe(401);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const op = await signedUp();
    const wrong = await req("/login", { body: { email: op.email, password: "not the password at all" } });
    const unknown = await req("/login", { body: { email: "nobody-here@example.com", password: "not the password at all" } });
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("locks the account for 15 minutes after 10 failures; a recovery link still works", async () => {
    const op = await signedUp();
    for (let i = 0; i < 10; i++) await req("/login", { body: { email: op.email, password: `wrong password ${i}` } });
    const locked = await req("/login", { body: { email: op.email, password: op.password } });
    expect(locked.res.status).toBe(429);
    expect(locked.body.code).toBe("locked");

    const token = `recovery-${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES (?, ?, 'recovery', ?, ?)")
      .bind(await sha256Hex(token), op.id, Date.now() + 60_000, Date.now())
      .run();
    const recovered = await req("/link", { body: { token } });
    expect(recovered.body.session).toBe("recovery");
    expect((await req("/login", { body: { email: op.email, password: op.password } })).res.status).toBe(200);
  });

  it("rate limits sign-in attempts per IP", async () => {
    const { app } = appWithRateLimits({ ip: 2 });
    const op = await signedUp();
    for (let i = 0; i < 2; i++) await req("/login", { app, ip: "7.7.7.7", body: { email: op.email, password: "wrong wrong wrong" } });
    expect((await req("/login", { app, ip: "7.7.7.7", body: { email: op.email, password: op.password } })).res.status).toBe(429);
  });

  it("rejects cross-site requests (no matching Origin), including sign-in", async () => {
    const op = await signedUp();
    expect((await req("/login", { origin: null, body: { email: op.email, password: op.password } })).res.status).toBe(403);
    expect((await req("/login", { origin: "https://evil.example", body: { email: op.email, password: op.password } })).res.status).toBe(403);
  });

  it("answers 503 when OPERATOR_SECRET isn't set", async () => {
    const res = await req("/login", { env: authEnv(null), body: { email: "a@example.com", password: "whatever whatever" } });
    expect(res.res.status).toBe(503);
    expect(res.body.message).toMatch(/OPERATOR_SECRET/);
  });
});

describe("two-step sign-in (TOTP)", () => {
  async function enrolled() {
    const op = await signedUp();
    const setup = await req("/totp/setup", { body: {}, cookie: op.session });
    const secret = base32Decode(setup.body.secret);
    expect(setup.body.otpauth_uri).toMatch(/^otpauth:\/\/totp\/openpurr%3A/);
    const step = Math.floor(Date.now() / 30_000);
    const enable = await req("/totp/enable", { body: { code: await totpCode(secret, step) }, cookie: op.session });
    expect(enable.res.status).toBe(200);
    expect(enable.body.recovery_codes).toHaveLength(10);
    return { ...op, secret, recoveryCodes: enable.body.recovery_codes as string[] };
  }

  it("requires a code after the password, and refuses a code that was already used", async () => {
    const op = await enrolled();
    expect((await req("/login", { body: { email: op.email, password: op.password } })).body.code).toBe("totp_required");
    // The enrollment code was for the current step, so the next valid one is the following step.
    const next = await totpCode(op.secret, Math.floor(Date.now() / 30_000) + 1);
    expect((await req("/login", { body: { email: op.email, password: op.password, code: next } })).res.status).toBe(200);
    expect((await req("/login", { body: { email: op.email, password: op.password, code: next } })).body.code).toBe("invalid_code");
  });

  it("lets one code sign in once, even from two sign-ins at the same moment", async () => {
    const op = await enrolled();
    const next = await totpCode(op.secret, Math.floor(Date.now() / 30_000) + 1);
    const login = () => req("/login", { body: { email: op.email, password: op.password, code: next } });
    const both = await Promise.all([login(), login()]);
    expect(both.map((r) => r.res.status).sort()).toEqual([200, 401]);
    expect(both.find((r) => r.res.status === 401)!.body.code).toBe("invalid_code");
    expect(both.filter((r) => r.session)).toHaveLength(1);
  });

  it("accepts each recovery code once instead of a TOTP code", async () => {
    const op = await enrolled();
    const code = op.recoveryCodes[0]!.toUpperCase().replace("-", " ");
    expect((await req("/login", { body: { email: op.email, password: op.password, recovery_code: code } })).res.status).toBe(200);
    expect((await req("/login", { body: { email: op.email, password: op.password, recovery_code: code } })).body.code).toBe("invalid_code");
  });

  it("a recovery link replaces a lost password and authenticator, even when two-step is required", async () => {
    const op = await enrolled();
    await env.DB.prepare("INSERT INTO setting (key, value, updated_at) VALUES ('require_totp', 'true', ?) ON CONFLICT (key) DO UPDATE SET value = 'true'").bind(Date.now()).run();
    try {
      const token = `recovery-${crypto.randomUUID()}`;
      await env.DB.prepare("INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES (?, ?, 'recovery', ?, ?)")
        .bind(await sha256Hex(token), op.id, Date.now() + 60_000, Date.now())
        .run();
      const link = await req("/link", { body: { token } });
      expect(link.body.session).toBe("recovery");
      expect(link.setCookie).toMatch(/Max-Age=1800/);
      const cookie = link.session!;

      // No old password or authenticator code needed.
      expect((await req("/totp/disable", { body: {}, cookie })).res.status).toBe(200);
      // Two-step is required, so a new authenticator comes before anything else.
      expect((await req("/me", { cookie })).body).toMatchObject({ session: "recovery", totp_enrollment_required: true });
      const changed = await req("/password", { body: { new_password: "a brand new passphrase" }, cookie });
      expect(changed.res.status).toBe(200);
      expect(changed.body.totp_enrollment_required).toBe(true);
      expect((await req("/me", { cookie })).body.session).toBe("full");
      // Now a full session: changing the password again needs the current one.
      expect((await req("/password", { body: { new_password: "another new passphrase" }, cookie })).res.status).toBe(401);
      expect((await req("/login", { body: { email: op.email, password: "a brand new passphrase" } })).res.status).toBe(200);
    } finally {
      await env.DB.prepare("UPDATE setting SET value = 'false' WHERE key = 'require_totp'").run();
    }
  });

  it("can't be turned off when the owner requires it for everyone", async () => {
    const op = await enrolled();
    await env.DB.prepare("INSERT INTO setting (key, value, updated_at) VALUES ('require_totp', 'true', ?) ON CONFLICT (key) DO UPDATE SET value = 'true'").bind(Date.now()).run();
    expect((await req("/totp/disable", { body: { password: op.password }, cookie: op.session })).res.status).toBe(403);
    await env.DB.prepare("UPDATE setting SET value = 'false' WHERE key = 'require_totp'").run();
    expect((await req("/totp/disable", { body: { password: op.password }, cookie: op.session })).res.status).toBe(200);
  });
});

describe("audit log", () => {
  it("records sign-ins, failures and credential changes", async () => {
    const op = await signedUp();
    await req("/login", { body: { email: op.email, password: "definitely wrong pw" } });
    await req("/login", { body: { email: op.email, password: op.password } });
    const { results } = await env.DB.prepare("SELECT action FROM audit_log WHERE operator_id = ? ORDER BY id").bind(op.id).all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(["auth.setup_link_used", "auth.password_changed", "auth.login_failed", "auth.login"]);
  });
});
