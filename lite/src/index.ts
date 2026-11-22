// SDK Worker entry point: only the RevenueCat-compatible API (/v1). Store notifications, scheduled
// jobs and the admin side run in the back-office Worker (src/office/index.ts), so none of their
// code adds to the SDK's cold-start cost. Benchmarks live in src/bench/worker.ts.
import { productionDeps, SDK_CONFIG_MAX_AGE_MS } from "./deps";
import type { Env } from "./env";
import { forward } from "./lib/forward";
import { buildSdkApp } from "./sdk-app";

const app = buildSdkApp(productionDeps({ configMaxAgeMs: SDK_CONFIG_MAX_AGE_MS }));

// Forward mode (moving to Standard): every request goes to FORWARD_TO instead.
export default { fetch: (req, env, ctx) => (env.FORWARD_TO ? forward(req, env) : app.fetch(req, env, ctx)) } satisfies ExportedHandler<Env>;
