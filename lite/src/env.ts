import type { AppConfig, Config } from "./config";
import type { RateLimiters } from "./lib/rate-limit";

export interface Env {
  DB: D1Database;
  /** Per client IP across the SDK endpoints (limit set in wrangler.jsonc). */
  RATE_LIMIT_IP?: RateLimit;
  /** Per app user ID on the subscriber endpoints (limit set in wrangler.jsonc). */
  RATE_LIMIT_USER?: RateLimit;
  /** "on" to store every SDK request in the `capture` table (spike tooling). */
  CAPTURE?: string;
  /** Bearer token for /__capture (and /__bench on the bench Worker). Those routes 404 when unset. */
  BENCH_TOKEN?: string;
  // Store credentials (for example the App Store In-App Purchase key) are Worker secrets whose
  // names come from the config, so they're looked up by name rather than declared here.
}

/** Built once per isolate and shared by every request. */
export interface Deps {
  config: Config;
  /** Trusted Apple roots, DER. Production: Apple Root CA G3 only. */
  appleRoots: Uint8Array[];
  /** fetch for store APIs. Tests substitute a fake; production uses the global fetch. */
  fetch?: typeof fetch;
  /** Rate limiters. Tests substitute fakes; production uses the wrangler.jsonc bindings. */
  rateLimiters?: (env: Env) => RateLimiters;
}

export type AppEnv = { Bindings: Env; Variables: { deps: Deps; app: AppConfig } };
