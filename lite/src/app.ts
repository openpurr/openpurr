import { Hono } from "hono";
import type { AppEnv } from "./env";
import { capture } from "./lib/capture";
import { sdk } from "./routes/sdk";

/**
 * Builds the HTTP app. `extend` mounts extra routes before the fallbacks; the benchmark
 * Worker uses it to add /__bench without shipping benchmarks in the production bundle.
 */
export function buildApp(extend?: (app: Hono<AppEnv>) => void) {
  const app = new Hono<AppEnv>();

  app.use("/v1/*", capture);
  app.route("/v1", sdk);

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
