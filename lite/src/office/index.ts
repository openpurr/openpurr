// Back-office Worker entry point (wrangler env "office", deployed as openpurr-office): store
// notifications, scheduled jobs, and the admin side. The SDK Worker is src/index.ts.
import { productionDeps } from "../deps";
import type { Env } from "../env";
import { scheduledHandler } from "../scheduled";
import { buildOfficeApp } from "./app";

const app = buildOfficeApp(productionDeps);

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler(productionDeps),
} satisfies ExportedHandler<Env>;
