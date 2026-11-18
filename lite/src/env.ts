import type { AppConfig, Config } from "./config";
import type { FxProvider } from "./fx";
import type { RateLimiters } from "./lib/rate-limit";
import type { Principal } from "./office/principal";
import type { SecretKey } from "./secret-keys";

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
  /**
   * Back-office Worker: at least 32 random characters. Derives the operator password pepper and
   * the key that encrypts TOTP secrets (src/office/auth-crypto.ts). Changing it invalidates every
   * operator password and TOTP enrollment (reset them with login links).
   */
  OPERATOR_SECRET?: string;
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
  /** Exchange-rate provider. Defaults to the European Central Bank. */
  fx?: FxProvider;
}

export type AppEnv = {
  Bindings: Env;
  /** `app` is set for public SDK keys; `secretKey` for secret (server-to-server) keys. */
  Variables: { deps: Deps; app: AppConfig; secretKey?: SecretKey; principal?: Principal };
};
