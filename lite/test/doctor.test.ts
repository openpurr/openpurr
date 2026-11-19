// Setup checks (GET /admin/v1/doctor, the MCP tool check_setup, `openpurr doctor`).
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/office/auth";
import { randomToken, sha256Hex } from "../src/office/auth-crypto";
import { EXPECTED_MIGRATION } from "../src/office/doctor";
import { testApp } from "./helpers";

const ORIGIN = "https://openpurr.test";

async function doctor() {
  const session = randomToken();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, created_at) VALUES (?, ?, 'v', 'viewer', ?)").bind(id, `doctor-${id}@example.com`, Date.now()),
    env.DB.prepare("INSERT INTO session (token_hash, operator_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, 'full', ?, ?, ?)").bind(await sha256Hex(session), id, Date.now(), Date.now() + 3600_000, Date.now()),
  ]);
  const ctx = createExecutionContext();
  const res = await testApp.fetch(new Request(`${ORIGIN}/admin/v1/doctor`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }), { ...env, OPERATOR_SECRET: "test-operator-secret-0123456789abcdef" }, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { summary: string; checks: { id: string; status: string; message: string; fix?: string }[] };
  return { ...body, byId: Object.fromEntries(body.checks.map((x) => [x.id, x])) };
}

describe("setup checks", () => {
  it("knows the newest migration (keep EXPECTED_MIGRATION in step with migrations/)", () => {
    const names = (env as unknown as { TEST_MIGRATIONS: { name: string }[] }).TEST_MIGRATIONS.map((m) => m.name);
    expect(EXPECTED_MIGRATION).toBe(names.at(-1));
  });

  it("reports each area with a fix for anything that isn't ok", async () => {
    const r = await doctor();
    expect(r.byId.database).toMatchObject({ status: "ok" });
    expect(r.byId.domain).toMatchObject({ status: "ok" }); // not workers.dev
    // The test config: iOS without an In-App Purchase key; Android accepting unverified purchases.
    expect(r.byId["app:ios:server-api"]).toMatchObject({ status: "warn" });
    expect(r.byId["app:android:play-api"]).toMatchObject({ status: "warn" });
    expect(r.byId["app:android:play-api"]!.message).toMatch(/without verification/);
    expect(r.byId["app:ios:notifications"]!.fix).toContain(`${ORIGIN}/notifications/apple`);
    for (const x of r.checks) if (x.status === "fail" || x.status === "warn") expect(x.fix, x.id).toBeTruthy();
    expect(r.summary).toMatch(/warning/);
  });

  it("sees store notifications once they arrive", async () => {
    await env.DB.prepare(
      "INSERT INTO store_notification (store, notification_id, notification_type, environment, app_id, signed_at, received_at) VALUES ('app_store', ?, 'TEST', 'sandbox', 'ios', ?, ?)",
    )
      .bind(crypto.randomUUID(), Date.now(), Date.now())
      .run();
    expect((await doctor()).byId["app:ios:notifications"]).toMatchObject({ status: "ok" });
  });
});
