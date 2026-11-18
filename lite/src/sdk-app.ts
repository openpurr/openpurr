// The SDK Worker's routes: the RevenueCat-compatible API under /v1, and nothing else. Every fresh
// isolate pays to load this bundle out of the free plan's 10 ms CPU budget, so anything the SDKs
// don't call lives in the back-office Worker (src/office/).
import type { Hono } from "hono/tiny";
import { createApp } from "./app";
import type { AppEnv, Deps } from "./env";
import { capture } from "./lib/capture";
import { sdk } from "./routes/sdk";

export function mountSdk(app: Hono<AppEnv>) {
  app.use("/v1/*", capture);
  app.route("/v1", sdk);
}

/** `extend` mounts extra routes; the benchmark Worker uses it to add /__bench. */
export function buildSdkApp(deps: Deps, extend?: (app: Hono<AppEnv>) => void) {
  return createApp(deps, (app) => {
    mountSdk(app);
    extend?.(app);
  });
}
