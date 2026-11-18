// hono/tiny (PatternRouter): skips compiling the route table on a fresh isolate's first
// request, about 1 ms of CPU, and is about 15 KB smaller. Matching speed is the same for our routes.
import { Hono } from "hono/tiny";
import type { AppEnv, Deps } from "./env";
import { capture } from "./lib/capture";
import { googleNotifications } from "./routes/google-notifications";
import { notifications } from "./routes/notifications";
import { sdk } from "./routes/sdk";

/**
 * Builds the HTTP app around a validated config. `extend` mounts extra routes before the
 * fallbacks; the benchmark Worker uses it to add /__bench without shipping benchmarks in the
 * production bundle.
 */
export function buildApp(deps: Deps, extend?: (app: Hono<AppEnv>) => void) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.use("/v1/*", capture);
  app.route("/v1", sdk);
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

  extend?.(app);

  app.notFound((c) => c.json({ code: 0, message: "Not found" }, 404));

  // Android treats an error without a JSON body as a connection failure, and iOS only parses
  // error bodies served as application/json. 7110 = internal server error in both SDKs.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ code: 7110, message: "Internal server error" }, 500);
  });

  return app;
}
