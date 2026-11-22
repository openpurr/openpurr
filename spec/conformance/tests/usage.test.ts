// Free-plan usage alerts (Cloudflare's daily limits), Lite only: the admin API's report and the
// setup check. Ported from lite/test/usage.test.ts. The conformance Worker has no
// CLOUDFLARE_ANALYTICS_TOKEN, so only the "alerts are off" behavior and the plan setting are
// testable here. Dropped: fetching usage from the GraphQL API (account lookup, refused tokens,
// the 15-minute refresh, the scheduled refresh), judging usage against the limits (pure
// functions), and the refresh/check results near a limit, which all need the token.

import { beforeEach, expect } from "vitest";
import { admin, describeEdition, itEdition, reset } from "../src";

const usageCheck = async () => ((await admin("GET", "/doctor")).body.checks as { id: string; status: string; fix?: string }[]).find((c) => c.id === "usage");

beforeEach(async () => {
  await reset();
});

describeEdition("lite", "usage in the admin API and the setup checks", () => {
  itEdition("lite", "reports usage, and says how to turn it on when there's no token", async () => {
    const off = await admin("GET", "/usage");
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ configured: false, plan: "free", updated_at: null });
    expect(off.body.metrics.map((m: { metric: string }) => m.metric)).toEqual(["workers_requests", "d1_rows_read", "d1_rows_written"]);
    expect(await usageCheck()).toMatchObject({ status: "info", fix: expect.stringContaining("wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN --env office") });
  });

  itEdition("lite", "refuses a refresh while usage alerts are off", async () => {
    const r = await admin("POST", "/usage/refresh");
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/CLOUDFLARE_ANALYTICS_TOKEN/);
  });

  itEdition("lite", "stops warning once the plan is set to Workers Paid", async () => {
    expect((await admin("PUT", "/settings", {}, { body: { cloudflare_plan: "paid" } })).body.cloudflare_plan).toBe("paid");
    expect((await admin("GET", "/usage")).body.plan).toBe("paid");
    expect((await usageCheck())!.status).toBe("info");
    expect((await admin("PUT", "/settings", {}, { body: { cloudflare_plan: "gold" } })).status).toBe(400);
  });
});
