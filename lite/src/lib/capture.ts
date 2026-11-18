// Spike-only: records every SDK request in D1 so M0 can (a) count requests per session to
// measure the real free-plan budget and (b) turn real request bodies into spec/ fixtures.
// Writing on every request breaks the "no writes on read paths" rule on purpose; it's off
// unless CAPTURE=on, and M1 removes it.

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

const MAX_BODY = 64 * 1024;
const REDACT = new Set(["authorization", "cookie", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"]);

export const capture: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.CAPTURE !== "on") return next();

  const req = c.req.raw;
  const body = req.body ? (await req.clone().text()).slice(0, MAX_BODY) : null;
  await next();

  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers) headers[k] = REDACT.has(k) ? redact(k, v) : v;
  const appUserId = /\/subscribers\/([^/]+)/.exec(url.pathname)?.[1];

  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO capture (ts, method, path, query, platform, sdk_version, app_user_id, headers, body, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        new Date().toISOString(),
        req.method,
        url.pathname,
        url.search || null,
        req.headers.get("x-platform"),
        req.headers.get("x-version"),
        appUserId ? decodeURIComponent(appUserId) : null,
        JSON.stringify(headers),
        body,
        c.res.status,
      )
      .run()
      .catch((err) => console.error("capture insert failed", err)),
  );
};

/** Keeps the key prefix and last 4 characters so key-format checks are still visible. */
function redact(name: string, value: string): string {
  if (name !== "authorization") return "[redacted]";
  const m = /^(Bearer\s+)([a-z]+_)?.*(.{4})$/i.exec(value);
  return m ? `${m[1]}${m[2] ?? ""}…${m[3]}` : "[redacted]";
}
