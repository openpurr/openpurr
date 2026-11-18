import type { AppConfig, Config } from "./config";

export interface Env {
  DB: D1Database;
  RATE_LIMITER?: RateLimit;
  /** "on" to store every SDK request in the `capture` table (spike tooling). */
  CAPTURE?: string;
  /** Bearer token for /__capture (and /__bench on the bench Worker). Those routes 404 when unset. */
  BENCH_TOKEN?: string;
}

/** Built once per isolate and shared by every request. */
export interface Deps {
  config: Config;
  /** Trusted Apple roots, DER. Production: Apple Root CA G3 only. */
  appleRoots: Uint8Array[];
}

export type AppEnv = { Bindings: Env; Variables: { deps: Deps; app: AppConfig } };
