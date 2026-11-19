// Back-office Worker entry point (wrangler env "office", deployed as openpurr-office): store
// notifications, scheduled jobs, and the admin side. The SDK Worker is src/index.ts.
import { productionDeps } from "../deps";
import type { Env } from "../env";
import { scheduledHandler } from "../scheduled";
import { buildOfficeApp } from "./app";

// The back office reads the config fresh on every request (one small read), so the dashboard
// always shows what was just saved.
const deps = productionDeps({ configMaxAgeMs: 0 });
const app = buildOfficeApp(deps);

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler(deps),
} satisfies ExportedHandler<Env>;
