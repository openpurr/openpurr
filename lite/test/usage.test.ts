// Free-plan usage alerts: fetching today's usage from the GraphQL Analytics API, judging it
// against the daily limits, and reporting it in the admin API and the setup checks.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/office/auth";
import { hashPassword, randomToken, sha256Hex } from "../src/office/auth-crypto";
import { mountOffice } from "../src/office/app";
import { assessUsage, fetchUsage, LIMITS, readUsage, refreshUsage, type UsageSnapshot } from "../src/office/usage";
import { runScheduled } from "../src/scheduled";
import { testConfig } from "./helpers";

const NOON = Date.parse("2026-11-19T12:00:00Z");
const SECRET = "test-operator-secret-0123456789abcdef";

/** A fake Cloudflare API: /accounts and /graphql, recording the requests. */
function cloudflare(opts: { requests?: number; rowsRead?: number; rowsWritten?: number; accounts?: string[]; graphqlStatus?: number; errors?: string[] } = {}) {
  const calls: { url: string; body: any; auth: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/accounts")) return Response.json({ result: (opts.accounts ?? ["acc1"]).map((id) => ({ id })) });
    if (opts.errors) return Response.json({ data: null, errors: opts.errors.map((message) => ({ message })) }, { status: opts.graphqlStatus ?? 200 });
    return Response.json({
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptive: [{ sum: { requests: opts.requests ?? 1200 } }],
              d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: opts.rowsRead ?? 40_000, rowsWritten: (opts.rowsWritten ?? 900) - 100 } }, { sum: { rowsRead: 0, rowsWritten: 100 } }],
            },
          ],
        },
      },
      errors: null,
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const withToken = (extra: object = {}) => ({ ...env, CLOUDFLARE_ANALYTICS_TOKEN: "cf-token", OPERATOR_SECRET: SECRET, ...extra });
const snapshot = (usage: Partial<UsageSnapshot["usage"]>, at = NOON): UsageSnapshot => ({
  at,
  date: new Date(at).toISOString().slice(0, 10),
  usage: { workers_requests: 0, d1_rows_read: 0, d1_rows_written: 0, ...usage },
});

async function ownerSession() {
  const id = crypto.randomUUID();
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, password_hash, totp_enabled, created_at) VALUES (?, ?, 'Owner', 'owner', ?, 1, ?)").bind(
      id,
      `owner-${id}@example.com`,
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

async function admin(method: string, path: string, opts: { env?: object; fetch?: typeof fetch; body?: unknown } = {}) {
  const app = createApp({ config: testConfig, appleRoots: [], fetch: opts.fetch }, mountOffice);
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`https://openpurr.test/admin/v1${path}`, {
      method,
      headers: { cookie: `${SESSION_COOKIE}=${await ownerSession()}`, origin: "https://openpurr.test", "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    opts.env ?? withToken(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.json<any>() };
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM job_state WHERE key = 'usage'"), env.DB.prepare("DELETE FROM setting WHERE key = 'cloudflare_plan'")]);
});

describe("fetching usage", () => {
  it("asks the GraphQL API for today's requests and D1 rows, account-wide", async () => {
    const cf = cloudflare({ requests: 5000, rowsRead: 123_456, rowsWritten: 2000 });
    const s = await fetchUsage(withToken() as never, cf.fetch, NOON);
    expect(s).toEqual({ at: NOON, date: "2026-11-19", usage: { workers_requests: 5000, d1_rows_read: 123_456, d1_rows_written: 2000 } });
    const gql = cf.calls.find((c) => c.url.endsWith("/graphql"))!;
    expect(gql.auth).toBe("Bearer cf-token");
    expect(gql.body.variables).toEqual({ account: "acc1", start: "2026-11-19T00:00:00Z", end: "2026-11-19T12:00:00Z", date: "2026-11-19" });
  });

  it("uses CLOUDFLARE_ACCOUNT_ID when set, and asks for it when the token reaches several accounts", async () => {
    const cf = cloudflare({ accounts: ["a", "b"] });
    await expect(fetchUsage(withToken() as never, cf.fetch, NOON)).rejects.toThrow(/several accounts; set CLOUDFLARE_ACCOUNT_ID/);
    const pinned = cloudflare();
    await fetchUsage(withToken({ CLOUDFLARE_ACCOUNT_ID: "acc9" }) as never, pinned.fetch, NOON);
    expect(pinned.calls.some((c) => c.url.endsWith("/accounts"))).toBe(false);
    expect(pinned.calls[0]!.body.variables.account).toBe("acc9");
  });

  it("explains a refused token", async () => {
    const cf = cloudflare({ errors: ["not authorized for that account"], graphqlStatus: 200 });
    await expect(fetchUsage(withToken() as never, cf.fetch, NOON)).rejects.toThrow(/needs Account Analytics: Read/);
  });

  it("refreshes at most every 15 minutes, and keeps the last good counts when a fetch fails", async () => {
    const e = withToken() as never;
    expect(await refreshUsage(e, cloudflare({ requests: 10 }).fetch, NOON)).toBe(true);
    expect(await refreshUsage(e, cloudflare({ requests: 20 }).fetch, NOON + 5 * 60_000)).toBe(false);
    expect((await readUsage(env.DB))!.usage.workers_requests).toBe(10);
    await refreshUsage(e, cloudflare({ errors: ["boom"] }).fetch, NOON + 16 * 60_000);
    const s = (await readUsage(env.DB))!;
    expect(s).toMatchObject({ error: "boom", errorAt: NOON + 16 * 60_000, at: NOON });
    expect(s.usage.workers_requests).toBe(10);
    expect(await refreshUsage(env as never, cloudflare().fetch, NOON + 60 * 60_000)).toBe(false); // no token: off
  });

  it("runs from the scheduled job", async () => {
    const cf = cloudflare({ requests: 77 });
    await runScheduled(withToken() as never, NOON + 2 * 60_000, { deps: { config: testConfig, appleRoots: [], fetch: cf.fetch } });
    expect((await readUsage(env.DB))!.usage.workers_requests).toBe(77);
  });
});

describe("judging usage", () => {
  const status = (usage: Partial<UsageSnapshot["usage"]>, at = NOON, now = NOON) =>
    Object.fromEntries(assessUsage(snapshot(usage, at), "free", now).map((m) => [m.metric, m.status]));

  it("warns at 75%, fails at 90%, of each daily limit", () => {
    expect(status({ workers_requests: 10_000 }).workers_requests).toBe("ok");
    expect(status({ workers_requests: 75_000 }).workers_requests).toBe("warn");
    expect(status({ d1_rows_written: 90_000 }).d1_rows_written).toBe("fail");
    expect(status({ d1_rows_read: 4_000_000 }).d1_rows_read).toBe("warn");
  });

  it("warns when today's pace would pass the limit, but not in the first 6 hours", () => {
    // 60,000 by noon is on pace for 120,000.
    expect(status({ workers_requests: 60_000 }).workers_requests).toBe("warn");
    const early = Date.parse("2026-11-19T03:00:00Z");
    expect(status({ workers_requests: 30_000 }, early, early).workers_requests).toBe("ok");
  });

  it("counts yesterday's numbers as zero (the limits reset at midnight UTC), and only informs on Workers Paid", () => {
    const yesterday = assessUsage(snapshot({ workers_requests: 99_000 }), "free", NOON + 864e5);
    expect(yesterday[0]).toMatchObject({ used: 0, status: "ok" });
    const paid = assessUsage(snapshot({ workers_requests: 99_000 }), "paid", NOON);
    expect(paid.every((m) => m.status === "info")).toBe(true);
    expect(LIMITS.workers_requests).toBe(100_000);
  });
});

describe("usage in the admin API and the setup checks", () => {
  it("reports usage, and says how to turn it on when there's no token", async () => {
    const off = await admin("GET", "/usage", { env: { ...env, OPERATOR_SECRET: SECRET } });
    expect(off.body).toMatchObject({ configured: false, plan: "free", updated_at: null });
    const check = (await admin("GET", "/doctor", { env: { ...env, OPERATOR_SECRET: SECRET } })).body.checks.find((c: { id: string }) => c.id === "usage");
    expect(check).toMatchObject({ status: "info", fix: expect.stringContaining("wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN --env office") });
  });

  it("refreshes on request, and the check fails close to a limit", async () => {
    const cf = cloudflare({ requests: 95_000 });
    const r = await admin("POST", "/usage/refresh", { fetch: cf.fetch });
    expect(r.status).toBe(200);
    expect(r.body.metrics.find((m: { metric: string }) => m.metric === "workers_requests")).toMatchObject({ used: 95_000, status: "fail" });
    const check = (await admin("GET", "/doctor")).body.checks.find((c: { id: string }) => c.id === "usage");
    expect(check.status).toBe("fail");
    expect(check.message).toMatch(/Workers requests: 95,000 of 100,000 today/);
  });

  it("stops warning once the plan is set to Workers Paid", async () => {
    await admin("POST", "/usage/refresh", { fetch: cloudflare({ requests: 95_000 }).fetch });
    expect((await admin("PUT", "/settings", { body: { cloudflare_plan: "paid" } })).body.cloudflare_plan).toBe("paid");
    const check = (await admin("GET", "/doctor")).body.checks.find((c: { id: string }) => c.id === "usage");
    expect(check.status).toBe("info");
    expect((await admin("PUT", "/settings", { body: { cloudflare_plan: "gold" } })).status).toBe(400);
  });
});
