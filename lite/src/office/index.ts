// Back-office Worker entry point (wrangler env "office", deployed as openpurr-office): store
// notifications, scheduled jobs, and the admin side. The SDK Worker is src/index.ts.
import { productionDeps } from "../deps";
import type { Env } from "../env";
import { forward } from "../lib/forward";
import { scheduledHandler } from "../scheduled";
import { buildOfficeApp } from "./app";

// The back office reads the config fresh on every request (one small read), so the dashboard
// always shows what was just saved.
const deps = productionDeps({ configMaxAgeMs: 0 });
const app = buildOfficeApp(deps);
const scheduled = scheduledHandler(deps);

// Forward mode (moving to Standard, src/lib/forward.ts): requests that reach the Worker (the admin
// API, store notifications, MCP and OAuth) go to FORWARD_TO, and the jobs stop, since the new
// server runs its own. The dashboard's static files are still served from here.
export default {
  fetch: (req, env, ctx) => (env.FORWARD_TO ? forward(req, env) : app.fetch(req, env, ctx)),
  scheduled: (controller, env, ctx) => {
    if (!env.FORWARD_TO) scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<Env>;
