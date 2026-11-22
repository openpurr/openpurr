// Operator sign-in over /admin/v1/auth: setup links, passwords, sessions, the lockout, two-step
// sign-in (TOTP and recovery codes) and the audit trail they leave. Operators are invited by the
// reset's owner, as a real owner does. Ported from lite/test/operator-auth.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, advanceClock, createOperator, linkToken, login, reset, sessionFrom } from "../src";
import { enrollTotp, requireTotp, totpCode, totpStep } from "../src/operator-auth-helpers";

let n = 0;
/** An invited operator who hasn't used their setup link yet: { id, email, token }. */
async function newOperator(role = "owner", email = `op${++n}-${Date.now()}@example.com`) {
  const res = await admin("POST", "/operators", {}, { body: { email, name: "Test", role } });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, email, token: linkToken(res.body.setup_link) };
}

/** Redeems a setup or recovery link: the response and its session. */
async function useLink(token: string) {
  const res = await admin("POST", "/auth/link", { none: true }, { body: { token } });
  return { res, session: sessionFrom(res), setCookie: res.headers.get("set-cookie") ?? "" };
}

beforeEach(async () => {
  await reset();
});

describe("setup links and passwords", () => {
  it("a setup link gives a setup-only session; setting a password makes it a full session", async () => {
    const op = await newOperator();
    const link = await useLink(op.token);
    expect(link.res.status).toBe(200);
    expect(link.res.body.session).toBe("setup");
    expect(link.setCookie).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    const session = link.session!;

    // A setup session can't do anything but set a password.
    expect((await admin("POST", "/auth/totp/setup", { session }, { body: {} })).status).toBe(401);
    expect((await admin("POST", "/auth/password", { session }, { body: { new_password: "short" } })).body.code).toBe("weak_password");
    expect((await admin("POST", "/auth/password", { session }, { body: { new_password: "a perfectly fine passphrase" } })).status).toBe(200);
    const me = await admin("GET", "/auth/me", { session });
    expect(me.body).toMatchObject({ session: "full", operator: { email: op.email, role: "owner", has_password: true, totp_enabled: false } });
  });

  it("links work once, and not after they expire", async () => {
    const op = await newOperator();
    expect((await useLink(op.token)).res.status).toBe(200);
    expect((await useLink(op.token)).res.body.code).toBe("invalid_link");
    // Setup links last 24 hours.
    const expired = await newOperator();
    await advanceClock(24 * 3600_000 + 60_000);
    expect((await useLink(expired.token)).res.body.code).toBe("invalid_link");
  });
});

describe("sign-in", () => {
  it("signs in with the password and sets a session cookie", async () => {
    const op = await createOperator("owner");
    const { res, session } = await login(op.email.toUpperCase(), op.password);
    expect(res.status).toBe(200);
    expect(session).toBeTruthy();
    expect((await admin("GET", "/auth/me", { session: session! })).body.operator.email).toBe(op.email);
    const logout = await admin("POST", "/auth/logout", { session: session! }, { body: {} });
    expect(logout.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await admin("GET", "/auth/me", { session: session! })).status).toBe(401);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const op = await createOperator("owner");
    const wrong = await login(op.email, "not the password at all");
    const unknown = await login("nobody-here@example.com", "not the password at all");
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.body).toEqual(unknown.res.body);
  });

  // Lite's version also redeems a recovery link while locked; recovery links are made only by
  // scripts/admin.mjs (straight into D1), so here the lockout runs out on the clock instead.
  it("locks the account for 15 minutes after 10 failures", async () => {
    const op = await createOperator("owner");
    for (let i = 0; i < 10; i++) await login(op.email, `wrong password ${i}`);
    const locked = await login(op.email, op.password);
    expect(locked.res.status).toBe(429);
    expect(locked.res.body.code).toBe("locked");
    await advanceClock(14 * 60_000);
    expect((await login(op.email, op.password)).res.status).toBe(429);
    await advanceClock(60_000 + 1000);
    expect((await login(op.email, op.password)).res.status).toBe(200);
  });

  it("rejects cross-site requests (no matching Origin), including sign-in", async () => {
    const op = await createOperator("owner");
    const body = { email: op.email, password: op.password };
    expect((await admin("POST", "/auth/login", { none: true }, { body, origin: null })).status).toBe(403);
    expect((await admin("POST", "/auth/login", { none: true }, { body, origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("two-step sign-in (TOTP)", () => {
  async function enrolled() {
    const op = await createOperator("owner");
    const totp = await enrollTotp(op.session);
    expect(totp.otpauthUri).toMatch(/^otpauth:\/\/totp\/openpurr%3A/);
    expect(totp.recoveryCodes).toHaveLength(10);
    return { ...op, ...totp };
  }

  it("requires a code after the password, and refuses a code that was already used", async () => {
    const op = await enrolled();
    expect((await login(op.email, op.password)).res.body.code).toBe("totp_required");
    // The enrollment code used the current step, so move on to the next one.
    await advanceClock(30_000);
    const code = totpCode(op.secret, totpStep());
    expect((await login(op.email, op.password, { code })).res.status).toBe(200);
    expect((await login(op.email, op.password, { code })).res.body.code).toBe("invalid_code");
  });

  it("accepts each recovery code once instead of a TOTP code", async () => {
    const op = await enrolled();
    const code = op.recoveryCodes[0]!.toUpperCase().replace("-", " ");
    expect((await login(op.email, op.password, { recovery_code: code })).res.status).toBe(200);
    expect((await login(op.email, op.password, { recovery_code: code })).res.body.code).toBe("invalid_code");
  });

  it("can't be turned off when the owner requires it for everyone", async () => {
    const op = await enrolled();
    await requireTotp(true, op);
    expect((await admin("POST", "/auth/totp/disable", { session: op.session }, { body: { password: op.password } })).status).toBe(403);
    await requireTotp(false, op);
    expect((await admin("POST", "/auth/totp/disable", { session: op.session }, { body: { password: op.password } })).status).toBe(200);
  });
});

describe("audit log", () => {
  it("records sign-ins, failures and credential changes", async () => {
    const op = await createOperator("owner");
    await login(op.email, "definitely wrong pw");
    await login(op.email, op.password);
    const entries = (await admin("GET", "/audit?limit=500")).body.entries as { operator_id: string | null; action: string }[];
    const actions = entries.filter((e) => e.operator_id === op.id).map((e) => e.action).reverse();
    expect(actions).toEqual(["auth.setup_link_used", "auth.password_changed", "auth.login_failed", "auth.login"]);
  });
});
