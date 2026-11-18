// Production entry point. Benchmarks live in a separate Worker (src/bench/worker.ts).
import { buildApp } from "./app";
import { productionDeps } from "./deps";
import type { Env } from "./env";
import { scheduledHandler } from "./scheduled";

const app = buildApp(productionDeps);

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler(productionDeps),
} satisfies ExportedHandler<Env>;
