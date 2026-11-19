// Setup checks: is this deployment ready, and if not, exactly what to do. The same list answers
// GET /admin/v1/doctor (the dashboard and `openpurr doctor`), the MCP tool check_setup, and the
// deploy and store-setup skills. Every check reads only small, indexed amounts of data.

import type { Context } from "hono";
import type { AppEnv } from "../env";
import { requireTotpForEveryone } from "./auth";
import { canSeeApp, type Principal } from "./principal";
import { visibleProjects } from "./project";

/** The newest migration this code expects. A test keeps it in step with migrations/. */
export const EXPECTED_MIGRATION = "0018_projects.sql";

export type CheckStatus = "ok" | "warn" | "fail" | "info";
export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
  /** What to do about it, when it isn't ok. */
  fix?: string;
}

const DAY = 864e5;
/** Cloudflare's free plan caps each D1 database at 500 MB (Workers Paid: 10 GB). Writes fail past it. */
export const FREE_PLAN_DB_BYTES = 500e6;
type Ctx = Context<AppEnv>;
const secretSet = (c: Ctx, name: string) => typeof (c.env as unknown as Record<string, unknown>)[name] === "string" && !!(c.env as unknown as Record<string, string>)[name];

export async function runChecks(c: Ctx, principal: Principal, now = Date.now()): Promise<Check[]> {
  const db = c.env.DB;
  const config = c.get("config");
  const origin = new URL(c.req.url).origin;
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  const [migration, notifications, rollup, fx, failedDeliveries, owners, requireTotp, dbBytes] = await Promise.all([
    db.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").first<{ name: string }>().catch(() => null),
    db
      .prepare("SELECT app_id, store, max(received_at) AS last FROM store_notification WHERE received_at > ? AND app_id IS NOT NULL GROUP BY app_id, store")
      .bind(now - 90 * DAY)
      .all<{ app_id: string; store: string; last: number }>(),
    db.prepare("SELECT updated_at FROM job_state WHERE key = 'metrics_rollup'").first<{ updated_at: number }>(),
    db.prepare("SELECT max(date) AS date FROM fx_rate").first<{ date: string | null }>(),
    db.prepare("SELECT count(*) AS n FROM webhook_delivery WHERE status = 'failed' AND created_at > ?").bind(now - DAY).first<{ n: number }>(),
    db.prepare("SELECT count(*) AS n, sum(totp_enabled) AS totp FROM operator WHERE role = 'owner' AND disabled_at IS NULL").first<{ n: number; totp: number | null }>(),
    requireTotpForEveryone(db),
    // Every D1 result reports the database's size; a no-op query reads no rows.
    db
      .prepare("SELECT 1")
      .run()
      .then((r) => (r.meta as { size_after?: number }).size_after ?? null)
      .catch(() => null),
  ]);

  // Database schema.
  const applied = migration?.name ?? null;
  if (applied === EXPECTED_MIGRATION) add({ id: "database", title: "Database", status: "ok", message: `Up to date (${applied}).` });
  else if (!applied || applied < EXPECTED_MIGRATION) {
    add({ id: "database", title: "Database", status: "fail", message: `Migrations are behind: the newest applied is ${applied ?? "none"}, this version needs ${EXPECTED_MIGRATION}.`, fix: "Run: pnpm db:migrate:remote" });
  } else {
    add({ id: "database", title: "Database", status: "warn", message: `The database (${applied}) is newer than this Worker expects (${EXPECTED_MIGRATION}).`, fix: "Deploy the latest code: pnpm run deploy && pnpm deploy:office" });
  }

  // Database size against the free plan's limit, with time to act before writes start failing.
  if (typeof dbBytes === "number") {
    const share = dbBytes / FREE_PLAN_DB_BYTES;
    const size = `${(dbBytes / 1e6).toFixed(1)} MB of the free plan's 500 MB per database`;
    if (share >= 0.75) {
      add({
        id: "storage",
        title: "Database size",
        status: share >= 0.9 ? "fail" : "warn",
        message: `${size} (${Math.round(share * 100)}%). On the free plan, writes fail at the limit, and purchases stop being recorded. On Workers Paid the limit is 10 GB; ignore this if you're on it.`,
        fix: "Take a backup (pnpm db:backup), then move to Workers Paid in the Cloudflare dashboard, or delete data you no longer need.",
      });
    } else add({ id: "storage", title: "Database size", status: "ok", message: `${size}.` });
  }

  // Custom domain: proxyURL and store notification URLs should never point at workers.dev.
  if (new URL(origin).hostname.endsWith(".workers.dev")) {
    add({
      id: "domain",
      title: "Custom domain",
      status: "warn",
      message: `This back office is on ${new URL(origin).hostname}. Apps and store notifications should use a domain you own, so you can move hosts later without an app release.`,
      fix: "In the Cloudflare dashboard: Workers & Pages → each openpurr Worker → Settings → Domains & Routes → add a custom domain. Then use it for the SDK's proxyURL and the store notification URLs.",
    });
  } else add({ id: "domain", title: "Custom domain", status: "ok", message: `Served on ${new URL(origin).hostname}.` });

  // Projects and their apps. With one project, checks keep their plain IDs; with several, each is
  // prefixed with its project.
  const projects = visibleProjects(config, principal);
  const apps = [...config.apps.values()].filter((a) => canSeeApp(principal, a.id));
  if (!apps.length) add({ id: "apps", title: "Apps", status: "fail", message: "No apps in the config.", fix: "Add a project and its apps to the config (PUT /admin/v1/config)." });
  for (const project of projects) {
    const id = (check: string) => (projects.length > 1 ? `project:${project.id}:${check}` : check);
    const title = (t: string) => (projects.length > 1 ? `${project.name}: ${t}` : t);
    if (!project.apps.size && apps.length) add({ id: id("apps"), title: title("Apps"), status: "warn", message: "This project has no apps yet.", fix: "Add its apps to the config." });
    for (const app of project.apps.values()) {
      if (!app.products.size && canSeeApp(principal, app.id)) {
        add({ id: `app:${app.id}:products`, title: `${app.id}: Products`, status: "warn", message: "No products yet, so nothing can be bought in this app.", fix: "Add the app's products (as in App Store Connect or Play Console) to the config." });
      }
    }
    if (!project.entitlements.length) add({ id: id("entitlements"), title: title("Entitlements"), status: "warn", message: "No entitlements are configured, so purchases unlock nothing.", fix: "Add entitlements to the config." });
    if (!project.currentOffering) add({ id: id("offerings"), title: title("Offerings"), status: "info", message: "No current offering: Purchases.getOfferings() returns none.", fix: "Mark one offering current in the config if your paywall uses offerings." });
  }

  const lastNotice = (appId: string) => notifications.results.find((n) => n.app_id === appId)?.last ?? null;
  for (const app of apps) {
    if (app.store === "app_store") {
      const api = app.appStoreServerApi;
      if (!api) {
        add({
          id: `app:${app.id}:server-api`,
          title: `${app.id}: App Store Server API`,
          status: "warn",
          message: "No In-App Purchase key configured: StoreKit 1 receipts (older SDKs, restores of old purchases) can't be resolved, and subscriptions can't be refreshed from Apple.",
          fix: "In App Store Connect → Users and Access → Integrations → In-App Purchase, create a key. Add issuer_id and key_id under app_store_server_api in the app's config, then: wrangler secret put APPLE_IAP_KEY (on both Workers).",
        });
      } else if (!secretSet(c, api.privateKeySecret)) {
        add({ id: `app:${app.id}:server-api`, title: `${app.id}: App Store Server API`, status: "fail", message: `The config names the secret ${api.privateKeySecret}, but it isn't set on this Worker.`, fix: `wrangler secret put ${api.privateKeySecret} --env office (and on the SDK Worker: wrangler secret put ${api.privateKeySecret})` });
      } else add({ id: `app:${app.id}:server-api`, title: `${app.id}: App Store Server API`, status: "ok", message: `Key ${api.keyId} configured.` });
      const last = lastNotice(app.id);
      add(
        last
          ? { id: `app:${app.id}:notifications`, title: `${app.id}: App Store Server Notifications`, status: "ok", message: `Last received ${new Date(last).toISOString().slice(0, 10)}.` }
          : {
              id: `app:${app.id}:notifications`,
              title: `${app.id}: App Store Server Notifications`,
              status: "warn",
              message: "None received in the last 90 days. Without them, renewals, refunds and cancellations only show up when the app next sends a receipt.",
              fix: `In App Store Connect → your app → App Information → App Store Server Notifications, set both the production and sandbox URL to ${origin}/notifications/apple (Version 2). Then send a test: pnpm apple:test-notification.`,
            },
      );
    } else {
      const api = app.googlePlayApi;
      if (!api) {
        add({
          id: `app:${app.id}:play-api`,
          title: `${app.id}: Google Play Developer API`,
          status: app.allowUnverifiedPurchases ? "warn" : "fail",
          message: app.allowUnverifiedPurchases
            ? "No service account: purchases are accepted without verification (allow_unverified_purchases). Anyone with the public SDK key could grant themselves access. Development only."
            : "No service account: Google Play purchases are refused (they stay queued on the device).",
          fix: "Create a service account with Play Console access (View financial data, Manage orders and subscriptions), add google_play_api to the app's config, then: wrangler secret put GOOGLE_SERVICE_ACCOUNT (on both Workers).",
        });
      } else if (!secretSet(c, api.serviceAccountSecret)) {
        add({ id: `app:${app.id}:play-api`, title: `${app.id}: Google Play Developer API`, status: "fail", message: `The config names the secret ${api.serviceAccountSecret}, but it isn't set on this Worker.`, fix: `wrangler secret put ${api.serviceAccountSecret} --env office (and on the SDK Worker)` });
      } else add({ id: `app:${app.id}:play-api`, title: `${app.id}: Google Play Developer API`, status: "ok", message: "Service account configured." });
      const last = lastNotice(app.id);
      add(
        last
          ? { id: `app:${app.id}:notifications`, title: `${app.id}: Real-time developer notifications`, status: "ok", message: `Last received ${new Date(last).toISOString().slice(0, 10)}.` }
          : {
              id: `app:${app.id}:notifications`,
              title: `${app.id}: Real-time developer notifications`,
              status: api ? "warn" : "info",
              message: "None received in the last 90 days. Without them, renewals, cancellations and refunds only show up when the app next syncs.",
              fix: `Create a Pub/Sub topic, set it in Play Console → Monetization setup → Real-time developer notifications, and add a push subscription to ${origin}/notifications/google with authentication on (set pubsub_push_account in the config). Then use "Send test notification" in the Play Console.`,
            },
      );
    }
  }

  // Webhooks (IDs are unique within a project).
  for (const [project, w] of projects.flatMap((project) => project.webhooks.map((w) => [project, w] as const))) {
    const missing = [w.authorizationSecret, w.signingSecret].filter((s): s is string => !!s && !secretSet(c, s));
    const wid = projects.length > 1 ? `webhook:${project.id}:${w.id}` : `webhook:${w.id}`;
    const wtitle = projects.length > 1 ? `${project.name}: webhook ${w.id}` : `Webhook ${w.id}`;
    add(
      missing.length
        ? { id: wid, title: wtitle, status: "fail", message: `Secret${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not set: deliveries can't be signed or authorized.`, fix: missing.map((s) => `wrangler secret put ${s} (on both Workers)`).join("; ") }
        : { id: wid, title: wtitle, status: "ok", message: `Sends to ${new URL(w.url).host}.` },
    );
  }
  if (failedDeliveries && failedDeliveries.n > 0) {
    add({ id: "webhook-failures", title: "Webhook deliveries", status: "warn", message: `${failedDeliveries.n} deliver${failedDeliveries.n === 1 ? "y" : "ies"} gave up in the last 24 hours.`, fix: "See Webhooks in the dashboard (or openpurr webhooks --status failed), fix the endpoint, then replay." });
  }

  // Scheduled job and exchange rates.
  if (!rollup) add({ id: "cron", title: "Scheduled job", status: "info", message: "Hasn't run yet (it runs every 5 minutes once deployed)." });
  else if (now - rollup.updated_at > 2 * 3600_000) {
    add({ id: "cron", title: "Scheduled job", status: "warn", message: `Last ran ${new Date(rollup.updated_at).toISOString().slice(0, 16).replace("T", " ")} UTC. It should run hourly.`, fix: 'Check the back-office Worker\'s Cron Trigger ("*/5 * * * *") in the Cloudflare dashboard, and its logs.' });
  } else add({ id: "cron", title: "Scheduled job", status: "ok", message: "Running." });
  if (!fx?.date) add({ id: "fx", title: "Exchange rates", status: "info", message: "None fetched yet (the scheduled job fetches them daily). Until then, non-USD revenue isn't in USD totals." });
  else if (now - Date.parse(`${fx.date}T00:00:00Z`) > 5 * DAY) add({ id: "fx", title: "Exchange rates", status: "warn", message: `The newest rates are from ${fx.date}.`, fix: "Check the scheduled job's logs for refresh-exchange-rates errors." });
  else add({ id: "fx", title: "Exchange rates", status: "ok", message: `Rates from ${fx.date}.` });

  // Operator security.
  if (!requireTotp) {
    add({
      id: "two-step",
      title: "Two-step sign-in",
      status: owners && owners.totp && owners.totp >= owners.n ? "info" : "warn",
      message: "Not required for everyone. Anyone who can sign in can grant entitlements or manage keys (depending on their role).",
      fix: "Set up two-step sign-in under Your account, then turn on Settings → Require two-step sign-in.",
    });
  } else add({ id: "two-step", title: "Two-step sign-in", status: "ok", message: "Required for everyone." });

  return checks;
}

/** A one-line verdict for a list of checks. */
export function summarize(checks: Check[]) {
  const fails = checks.filter((x) => x.status === "fail").length;
  const warns = checks.filter((x) => x.status === "warn").length;
  return fails ? `${fails} problem${fails === 1 ? "" : "s"} to fix${warns ? `, ${warns} warning${warns === 1 ? "" : "s"}` : ""}.` : warns ? `Working, with ${warns} warning${warns === 1 ? "" : "s"}.` : "Everything checks out.";
}
