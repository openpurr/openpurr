// SDK Worker entry point: only the RevenueCat-compatible API (/v1). Store notifications, scheduled
// jobs and the admin side run in the back-office Worker (src/office/index.ts), so none of their
// code adds to the SDK's cold-start cost. Benchmarks live in src/bench/worker.ts.
import { productionDeps, SDK_CONFIG_MAX_AGE_MS } from "./deps";
import type { Env } from "./env";
import { buildSdkApp } from "./sdk-app";

const app = buildSdkApp(productionDeps({ configMaxAgeMs: SDK_CONFIG_MAX_AGE_MS }));

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
