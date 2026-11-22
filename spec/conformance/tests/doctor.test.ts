// Setup checks (GET /admin/v1/doctor, the MCP tool check_setup, `openpurr doctor`), read by a
// signed-in viewer. Checks about Lite's deployment (D1 migrations and size, the workers.dev
// domain) run on Lite only. Ported from lite/test/doctor.test.ts. Dropped: keeping
// EXPECTED_MIGRATION in step with migrations/ (a source check, no HTTP equivalent).

import { beforeEach, describe, expect, it } from "vitest";
import { admin, createOperator, itEdition, mcpTool, ORIGIN, postNotification, reset, signNotification } from "../src";

type Check = { id: string; status: string; message: string; fix?: string };

async function doctor() {
  const { session } = await createOperator("viewer");
  const res = await admin("GET", "/doctor", { session });
  expect(res.status).toBe(200);
  const body = res.body as { summary: string; checks: Check[] };
  return { ...body, byId: Object.fromEntries(body.checks.map((x) => [x.id, x])) as Record<string, Check> };
}

beforeEach(async () => {
  await reset();
});

describe("setup checks", () => {
  it("reports each area with a fix for anything that isn't ok", async () => {
    const r = await doctor();
    expect(r.byId["sdk-url"]).toMatchObject({ status: "info" }); // not set
    // The test config: iOS without an In-App Purchase key; Android accepting unverified purchases.
    expect(r.byId["app:ios:server-api"]).toMatchObject({ status: "warn" });
    expect(r.byId["app:android:play-api"]).toMatchObject({ status: "warn" });
    expect(r.byId["app:android:play-api"]!.message).toMatch(/without verification/);
    expect(r.byId["app:ios:notifications"]!.fix).toContain(`${ORIGIN}/notifications/apple`);
    for (const x of r.checks) if (x.status === "fail" || x.status === "warn") expect(x.fix, x.id).toBeTruthy();
    expect(r.summary).toMatch(/warning/);
  });

  itEdition("lite", "reports the database, its size and the domain", async () => {
    const r = await doctor();
    expect(r.byId.database).toMatchObject({ status: "ok" });
    expect(r.byId.domain).toMatchObject({ status: "ok" }); // not workers.dev
    expect(r.byId.storage).toMatchObject({ status: "ok" });
    expect(r.byId.storage!.message).toMatch(/MB of the free plan's 500 MB/);
  });

  it("sees store notifications once they arrive", async () => {
    const { signedPayload } = await signNotification({ type: "TEST" });
    expect((await postNotification(signedPayload)).status).toBe(200);
    expect((await doctor()).byId["app:ios:notifications"]).toMatchObject({ status: "ok" });
  });

  it("answers the same checks through the MCP tool check_setup", async () => {
    const { checks, summary } = await doctor();
    const r = (await mcpTool("check_setup")).result;
    expect(r.structuredContent.summary).toBe(summary);
    expect(r.structuredContent.checks.map((x: Check) => x.id)).toEqual(checks.map((x) => x.id));
  });
});
