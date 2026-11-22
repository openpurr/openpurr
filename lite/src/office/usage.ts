// Free-plan usage: today's Workers requests and D1 rows against the Cloudflare free plan's daily
// limits, so the operator hears about it before the limits stop the deployment.
//
// The limits are per account and reset at 00:00 UTC:
//   - Workers: 100,000 requests a day, across every Worker in the account. Past it, requests fail
//     with error 1027: the SDK's calls fail and purchases stay queued on devices until the reset.
//     (Requests for static assets, such as the dashboard's files, are free and don't count.)
//   - D1: 5,000,000 rows read and 100,000 rows written a day. Past them, queries fail.
//
// The numbers come from Cloudflare's GraphQL Analytics API, which needs an API token with
// "Account Analytics: Read", set as the back office's CLOUDFLARE_ANALYTICS_TOKEN secret (and the
// account ID, CLOUDFLARE_ACCOUNT_ID, if the token can reach more than one account). Without it,
// usage alerts are off and the setup checks say how to turn them on. The scheduled job fetches
// usage at most every 15 minutes and keeps the latest snapshot in job_state, so the dashboard and
// the checks never call Cloudflare themselves.

import type { Env } from "../env";

/** Which server this is, in the settings and usage reports: Standard, which has no such limits, says "standard". */
export const EDITION = "lite";

export const LIMITS = {
  workers_requests: 100_000,
  d1_rows_read: 5_000_000,
  d1_rows_written: 100_000,
} as const;
export type Metric = keyof typeof LIMITS;

export const METRIC_LABELS: Record<Metric, string> = {
  workers_requests: "Workers requests",
  d1_rows_read: "D1 rows read",
  d1_rows_written: "D1 rows written",
};

const STATE_KEY = "usage";
const REFRESH_EVERY_MS = 15 * 60_000;
const DAY = 864e5;
const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const ACCOUNTS = "https://api.cloudflare.com/client/v4/accounts";

export interface UsageSnapshot {
  /** When it was fetched. */
  at: number;
  /** The UTC day the counts are for. */
  date: string;
  usage: Record<Metric, number>;
  /** Set when the last attempt failed; `usage` is then the previous good snapshot's, if any. */
  error?: string;
  errorAt?: number;
}

export type Plan = "free" | "paid";
export type UsageStatus = "ok" | "warn" | "fail" | "info";

export interface MetricAssessment {
  metric: Metric;
  label: string;
  used: number;
  limit: number;
  /** used / limit. */
  share: number;
  /** Where today ends at the current pace (only after 6 hours of the day, else null). */
  projected: number | null;
  status: UsageStatus;
}

export class UsageError extends Error {}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const secret = (env: Env, name: string) => {
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export const usageConfigured = (env: Env) => !!secret(env, "CLOUDFLARE_ANALYTICS_TOKEN");

/** The account to query: CLOUDFLARE_ACCOUNT_ID, or the only account the token can reach. */
async function accountId(env: Env, token: string, fetchImpl: typeof fetch) {
  const set = secret(env, "CLOUDFLARE_ACCOUNT_ID");
  if (set) return set;
  const res = await fetchImpl(ACCOUNTS, { headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => null)) as { result?: { id: string }[] } | null;
  const ids = body?.result?.map((a) => a.id) ?? [];
  if (ids.length === 1) return ids[0]!;
  throw new UsageError(
    ids.length ? "The token reaches several accounts; set CLOUDFLARE_ACCOUNT_ID on the back office." : "Couldn't find the account; set CLOUDFLARE_ACCOUNT_ID on the back office.",
  );
}

/** Today's (UTC) usage for the whole account, from the GraphQL Analytics API. */
export async function fetchUsage(env: Env, fetchImpl: typeof fetch, now = Date.now()): Promise<UsageSnapshot> {
  const token = secret(env, "CLOUDFLARE_ANALYTICS_TOKEN");
  if (!token) throw new UsageError("CLOUDFLARE_ANALYTICS_TOKEN isn't set.");
  const account = await accountId(env, token, fetchImpl);
  const date = dayOf(now);
  const query = `query Usage($account: string!, $start: Time!, $end: Time!, $date: Date!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } }
        d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $date, date_leq: $date }) { sum { rowsRead rowsWritten } }
      }
    }
  }`;
  const res = await fetchImpl(GRAPHQL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { account, start: `${date}T00:00:00Z`, end: new Date(now).toISOString().replace(/\.\d+Z$/, "Z"), date } }),
  });
  type Sum<T> = { sum: T }[];
  const body = (await res.json().catch(() => null)) as {
    data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: Sum<{ requests: number }>; d1AnalyticsAdaptiveGroups?: Sum<{ rowsRead: number; rowsWritten: number }> }[] } };
    errors?: { message: string }[] | null;
  } | null;
  if (!res.ok || body?.errors?.length) {
    const message = body?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new UsageError(res.status === 401 || res.status === 403 || /auth/i.test(message) ? `The analytics token was refused (${message}). It needs Account Analytics: Read.` : message);
  }
  const acc = body?.data?.viewer?.accounts?.[0];
  if (!acc) throw new UsageError("The token can't read this account's analytics. It needs Account Analytics: Read.");
  const total = <T>(rows: Sum<T> | undefined, key: keyof T) => (rows ?? []).reduce((n, r) => n + (Number(r.sum[key]) || 0), 0);
  return {
    at: now,
    date,
    usage: {
      workers_requests: total(acc.workersInvocationsAdaptive, "requests"),
      d1_rows_read: total(acc.d1AnalyticsAdaptiveGroups, "rowsRead"),
      d1_rows_written: total(acc.d1AnalyticsAdaptiveGroups, "rowsWritten"),
    },
  };
}

export async function readUsage(db: D1Database): Promise<UsageSnapshot | null> {
  const row = await db.prepare("SELECT value FROM job_state WHERE key = ?").bind(STATE_KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as UsageSnapshot) : null;
}

const saveUsage = (db: D1Database, snapshot: UsageSnapshot) =>
  db
    .prepare("INSERT INTO job_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(STATE_KEY, JSON.stringify(snapshot), snapshot.errorAt ?? snapshot.at)
    .run();

/**
 * The scheduled job's step: fetches and stores usage if the last fetch is 15 minutes old (or
 * `force`). Returns whether it fetched. A failure is stored with the previous counts, so the
 * checks can say what went wrong.
 */
export async function refreshUsage(env: Env, fetchImpl: typeof fetch, now = Date.now(), force = false) {
  if (!usageConfigured(env)) return false;
  const previous = await readUsage(env.DB);
  const last = Math.max(previous?.at ?? 0, previous?.errorAt ?? 0);
  if (!force && now - last < REFRESH_EVERY_MS) return false;
  try {
    await saveUsage(env.DB, await fetchUsage(env, fetchImpl, now));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Usage fetch failed:", message);
    const base = previous ?? { at: 0, date: "", usage: { workers_requests: 0, d1_rows_read: 0, d1_rows_written: 0 } };
    await saveUsage(env.DB, { ...base, error: message.slice(0, 300), errorAt: now });
  }
  return true;
}

export async function cloudflarePlan(db: D1Database): Promise<Plan> {
  const row = await db.prepare("SELECT value FROM setting WHERE key = 'cloudflare_plan'").first<{ value: string }>();
  return row?.value === "paid" ? "paid" : "free";
}

/**
 * Each metric against its limit. Warn at 75%, or when today's pace (after 6 hours) would pass the
 * limit; fail at 90%. On a paid plan there's no daily cap, so it's information only. Counts from
 * an earlier day than `now` count as zero (the limits reset at midnight UTC).
 */
export function assessUsage(snapshot: UsageSnapshot | null, plan: Plan, now = Date.now()): MetricAssessment[] {
  const today = snapshot && snapshot.date === dayOf(now) ? snapshot : null;
  const asOf = today ? (today.at - Date.parse(`${today.date}T00:00:00Z`)) / DAY : 0;
  return (Object.keys(LIMITS) as Metric[]).map((metric) => {
    const used = today?.usage[metric] ?? 0;
    const limit = LIMITS[metric];
    const share = used / limit;
    const projected = today && asOf >= 0.25 ? Math.round(used / asOf) : null;
    const status: UsageStatus =
      plan === "paid" ? "info" : share >= 0.9 ? "fail" : share >= 0.75 || (projected !== null && projected >= limit) ? "warn" : "ok";
    return { metric, label: METRIC_LABELS[metric], used, limit, share, projected, status };
  });
}

/** One line per metric, for the checks and the CLI. */
export function describe(a: MetricAssessment) {
  const pct = `${Math.round(a.share * 100)}%`;
  const pace = a.projected !== null && a.projected > a.used ? `, on pace for ${a.projected.toLocaleString("en-US")}` : "";
  return `${a.label}: ${a.used.toLocaleString("en-US")} of ${a.limit.toLocaleString("en-US")} today (${pct}${pace})`;
}
