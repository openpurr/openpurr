import { Hono } from "hono";
import { bench } from "./bench";
import type { AppEnv } from "./env";
import { capture } from "./lib/capture";
import { sdk } from "./routes/sdk";

const app = new Hono<AppEnv>();

app.use("/v1/*", capture);
app.route("/v1", sdk);
app.route("/__bench", bench);

// Spike: export captured SDK requests for scripts/pull-captures.mjs. Same token as /__bench.
app.get("/__capture", async (c) => {
  const token = c.env.BENCH_TOKEN;
  if (!token || c.req.header("authorization") !== `Bearer ${token}`) return c.notFound();
  const since = Number(c.req.query("since") ?? 0) || 0;
  const { results } = await c.env.DB.prepare("SELECT * FROM capture WHERE id > ? ORDER BY id LIMIT 500")
    .bind(since)
    .all();
  return c.json({ rows: results });
});

app.notFound((c) => c.json({ code: 0, message: "Not found" }, 404));

// Android treats an error without a JSON body as a connection failure, and iOS only parses
// error bodies served as application/json. 7110 = internal server error in both SDKs.
app.onError((err, c) => {
  console.error(err);
  return c.json({ code: 7110, message: "Internal server error" }, 500);
});

export default app;
