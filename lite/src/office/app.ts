// The back-office Worker's routes: everything the SDKs don't call. Store notifications, the
// spike's capture export, and (from M4a) the admin API, dashboard and MCP. Its bundle size doesn't
// affect SDK latency, and it runs the Cron Trigger jobs.
import type { Hono } from "hono/tiny";
import { createApp } from "../app";
import type { AppEnv, Deps } from "../env";
import { googleNotifications } from "../routes/google-notifications";
import { notifications } from "../routes/notifications";
import { admin } from "./admin";
import { auth } from "./auth";
import { mountIos } from "./ios";
import { mcp } from "./mcp";
import { oauth, wellKnown } from "./oauth";

export function mountOffice(app: Hono<AppEnv>) {
  app.route("/admin/v1/auth", auth);
  app.route("/admin/v1", admin);
  app.route("/mcp", mcp);
  mountIos(app);
  app.route("/.well-known", wellKnown);
  app.route("/oauth", oauth);
  app.route("/notifications/google", googleNotifications);
  app.route("/notifications", notifications);

  // Spike: export captured SDK requests for scripts/pull-captures.mjs. Protected by BENCH_TOKEN.
  app.get("/__capture", async (c) => {
    const token = c.env.BENCH_TOKEN;
    if (!token || c.req.header("authorization") !== `Bearer ${token}`) return c.notFound();
    const since = Number(c.req.query("since") ?? 0) || 0;
    const { results } = await c.env.DB.prepare("SELECT * FROM capture WHERE id > ? ORDER BY id LIMIT 500")
      .bind(since)
      .all();
    return c.json({ rows: results });
  });
}

export function buildOfficeApp(deps: Deps) {
  return createApp(deps, mountOffice);
}
