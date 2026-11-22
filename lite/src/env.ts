import type { AppConfig, Config, ProjectConfig } from "./config";
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
  /**
   * Back-office Worker, optional: a Cloudflare API token with Account Analytics: Read, for the
   * free-plan usage alerts (src/office/usage.ts). CLOUDFLARE_ACCOUNT_ID is needed only when the
   * token can reach more than one account.
   */
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  /**
   * Forward mode (src/lib/forward.ts), both Workers: the origin of the Standard server this
   * deployment is moving to. Set, every request goes there and the scheduled jobs stop.
   */
  FORWARD_TO?: string;
  /** Forward mode: the shared secret the new origin checks (its own FORWARD_SECRET). */
  FORWARD_SECRET?: string;
  // Store credentials (for example the App Store In-App Purchase key) are Worker secrets whose
  // names come from the config, so they're looked up by name rather than declared here.
}

/** Built once per isolate and shared by every request. */
export interface Deps {
  /** A fixed config (tests). Production loads it from D1 instead, with loadConfig. */
  config?: Config;
  /** The current config from D1, cached per isolate (src/config-store.ts). */
  loadConfig?: (db: D1Database) => Promise<Config>;
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
  /**
   * `config` is the current config, set on every request. On the SDK API, `project` is the
   * caller's project; `app` is set for public SDK keys, `secretKey` for secret (server-to-server) keys.
   */
  Variables: { deps: Deps; config: Config; project: ProjectConfig; app: AppConfig; secretKey?: SecretKey; principal?: Principal };
};

/** The current config: the fixed one (tests) or the one in D1. */
export async function currentConfig(deps: Deps, db: D1Database): Promise<Config> {
  if (deps.config) return deps.config;
  if (!deps.loadConfig) throw new Error("Deps need config or loadConfig.");
  return deps.loadConfig(db);
}
