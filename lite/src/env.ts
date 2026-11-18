export interface Env {
  DB: D1Database;
  /** Present only if the Rate Limiting binding deployed (an M0 question for the free plan). */
  RATE_LIMITER?: RateLimit;
  /** "on" to store every SDK request in the `capture` table. */
  CAPTURE?: string;
  /** Comma-separated public SDK keys this server accepts. */
  SDK_KEYS?: string;
  /** Optional JSON override of the spike product catalog (see spike-config.ts). */
  SPIKE_CONFIG?: string;
  /** Bearer token for /__bench and /__capture. Those routes 404 when it's unset. */
  BENCH_TOKEN?: string;
}

export type AppEnv = { Bindings: Env };
