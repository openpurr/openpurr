// Conformance Worker (wrangler env "conformance"): the SDK and back-office apps in one Worker, as the
// tests mount them, built for the language-neutral suite in spec/conformance/. Never deployed.
//
// What differs from production (spec/conformance/README.md has the contract):
//   - Apple JWS chains are checked against CONFORMANCE_APPLE_ROOT_B64 instead of Apple's root;
//   - outbound requests to the store, Google, ECB and Cloudflare APIs go to the runner's fakes at
//     CONFORMANCE_STORE_BASE (https://<host>/<path> becomes <base>/<host>/<path>);
//   - Date is shifted by an offset the runner controls, for expiry, retry and cleanup scenarios;
//   - deferred work (waitUntil) finishes before the response is sent, so it's observable at once;
//   - no rate limits;
//   - /__conformance/{reset,jobs,clock}, guarded by CONFORMANCE_TOKEN.

import { configLoader, saveConfig } from "../config-store";
import { ConfigError } from "../config";
import { createApp } from "../app";
import type { Deps, Env } from "../env";
import { forgetRunning } from "../experiments";
import { base64ToBytes } from "../lib/der";
import { mountOffice } from "../office/app";
import { randomToken, sha256Hex } from "../office/auth-crypto";
import { ACCESS_TOKEN_PREFIX, TOKEN_SCOPES } from "../office/principal";
import { runScheduled } from "../scheduled";
import { mountSdk } from "../sdk-app";
import { clearSecretKeyCache } from "../secret-keys";
import { DEFAULT_CONFORMANCE_CONFIG } from "./default-config";

interface ConformanceEnv extends Env {
  CONFORMANCE_TOKEN?: string;
  CONFORMANCE_STORE_BASE?: string;
  CONFORMANCE_APPLE_ROOT_B64?: string;
}

// --- clock ----------------------------------------------------------------------------------------

const RealDate = Date;
let offsetMs = 0;

class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs);
    else super(...(args as [string | number | Date]));
  }
  static override now() {
    return RealDate.now() + offsetMs;
  }
}
globalThis.Date = ShiftedDate as DateConstructor;

// --- outbound requests ----------------------------------------------------------------------------

export const FAKED_HOSTS = new Set([
  "api.storekit.apple.com",
  "api.storekit-sandbox.apple.com",
  "androidpublisher.googleapis.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "www.ecb.europa.eu",
  "api.cloudflare.com",
]);

/** fetch that sends the faked hosts to the runner and everything else (webhooks) as is. */
export function rewritingFetch(base: string): typeof fetch {
  const root = base.replace(/\/+$/, "");
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.protocol === "https:" && FAKED_HOSTS.has(url.hostname)) {
      return fetch(new Request(`${root}/${url.hostname}${url.pathname}${url.search}`, req));
    }
    return fetch(req);
  }) as typeof fetch;
}

// --- the app --------------------------------------------------------------------------------------

// The config loader caches the last version it read; reset starts a fresh one, because version
// ids start again from 1 after a wipe.
let loadConfig = configLoader({ maxAgeMs: 0 });
let built: { app: ReturnType<typeof createApp>; deps: Deps } | null = null;

function build(env: ConformanceEnv) {
  if (built) return built;
  if (!env.CONFORMANCE_APPLE_ROOT_B64 || !env.CONFORMANCE_STORE_BASE) {
    throw new Error("Set CONFORMANCE_APPLE_ROOT_B64 and CONFORMANCE_STORE_BASE for the conformance Worker.");
  }
  const deps: Deps = {
    loadConfig: (db) => loadConfig(db),
    appleRoots: [base64ToBytes(env.CONFORMANCE_APPLE_ROOT_B64)],
    fetch: rewritingFetch(env.CONFORMANCE_STORE_BASE),
    rateLimiters: () => ({}),
  };
  const app = createApp(deps, (a) => {
    mountSdk(a);
    mountOffice(a);
  });
  built = { app, deps };
  return built;
}

/** An execution context whose waitUntil promises the caller awaits before answering. */
function collectingContext(ctx: ExecutionContext) {
  const pending: Promise<unknown>[] = [];
  const inner = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => ctx.passThroughOnException(),
    props: (ctx as { props?: unknown }).props,
  } as unknown as ExecutionContext;
  return {
    ctx: inner,
    async drain() {
      // Deferred work may defer more work, so loop until nothing is left.
      while (pending.length) await Promise.allSettled(pending.splice(0));
    },
  };
}

// --- /__conformance -------------------------------------------------------------------------------

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function wipe(db: D1Database) {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'")
    .all<{ name: string }>();
  const hasSequence = await db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").first();
  await db.batch([
    db.prepare("PRAGMA defer_foreign_keys = on"),
    ...results.map(({ name }) => db.prepare(`DELETE FROM "${name.replace(/"/g, '""')}"`)),
    ...(hasSequence ? [db.prepare("DELETE FROM sqlite_sequence")] : []),
  ]);
}

async function reset(env: ConformanceEnv, body: { config?: unknown }) {
  const db = env.DB;
  offsetMs = 0;
  await wipe(db);
  loadConfig = configLoader({ maxAgeMs: 0 });
  clearSecretKeyCache();
  forgetRunning();
  try {
    await saveConfig(db, body.config ?? DEFAULT_CONFORMANCE_CONFIG, { baseId: 0, by: "conformance", note: "Conformance reset" });
  } catch (err) {
    if (err instanceof ConfigError) return json({ code: "invalid_config", message: err.message }, 400);
    throw err;
  }
  const now = Date.now();
  const operatorId = crypto.randomUUID();
  const token = `${ACCESS_TOKEN_PREFIX}${randomToken()}`;
  await db.batch([
    db.prepare("INSERT INTO operator (id, email, name, role, created_at) VALUES (?, 'owner@conformance.test', 'Conformance owner', 'owner', ?)").bind(operatorId, now),
    db.prepare("INSERT INTO access_token (id, operator_id, token_hash, token_prefix, name, scopes, created_at) VALUES (?, ?, ?, ?, 'conformance', ?, ?)").bind(
      crypto.randomUUID(),
      operatorId,
      await sha256Hex(token),
      token.slice(0, 10),
      JSON.stringify(TOKEN_SCOPES),
      now,
    ),
  ]);
  return json({ owner_token: token });
}

async function conformance(req: Request, env: ConformanceEnv, path: string) {
  const token = env.CONFORMANCE_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}` || req.method !== "POST") return json({ code: 0, message: "Not found" }, 404);
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  switch (path) {
    case "/__conformance/reset":
      return reset(env, body);
    case "/__conformance/jobs": {
      const { deps } = build(env);
      await runScheduled(env, Date.now(), { all: true, deps });
      return json({});
    }
    case "/__conformance/clock": {
      if (typeof body.now_ms === "number") offsetMs = body.now_ms - RealDate.now();
      else if (typeof body.advance_ms === "number") offsetMs += body.advance_ms;
      else return json({ code: "bad_request", message: "Send advance_ms or now_ms." }, 400);
      return json({ now_ms: Date.now() });
    }
  }
  return json({ code: 0, message: "Not found" }, 404);
}

export default {
  async fetch(req: Request, env: ConformanceEnv, ctx: ExecutionContext) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/__conformance/")) return conformance(req, env, path);
    const { app } = build(env);
    const deferred = collectingContext(ctx);
    const res = await app.fetch(req, env, deferred.ctx);
    await deferred.drain();
    return res;
  },
} satisfies ExportedHandler<ConformanceEnv>;
