// Rate limiting behind a small adapter (CONTRIBUTING rule 4), so core code doesn't call the
// Workers binding directly and the Standard edition can plug in its own.
//
// Cloudflare's Rate Limiting binding counts per Cloudflare location and is eventually
// consistent: a guard against abuse, not an exact quota. Each binding has one fixed limit,
// set in wrangler.jsonc, which is where operators tune it.

import type { Env } from "../env";

export interface RateLimiter {
  /** True if the request is within the limit for this key. */
  allow(key: string): Promise<boolean>;
}

export interface RateLimiters {
  /** Per client IP, across all SDK endpoints. */
  ip?: RateLimiter;
  /** Per app and app user ID, on the subscriber endpoints. */
  user?: RateLimiter;
}

function fromBinding(binding: RateLimit | undefined, name: string): RateLimiter | undefined {
  if (!binding) return undefined;
  return {
    async allow(key) {
      try {
        return (await binding.limit({ key })).success;
      } catch (err) {
        // Fail open: a limiter outage shouldn't lock every user out of their purchases.
        console.error(`Rate limiter ${name} failed; allowing the request.`, err);
        return true;
      }
    },
  };
}

/** The limiters configured in wrangler.jsonc. Missing bindings mean no limit (for example locally). */
export function cloudflareRateLimiters(env: Env): RateLimiters {
  return {
    ip: fromBinding(env.RATE_LIMIT_IP, "RATE_LIMIT_IP"),
    user: fromBinding(env.RATE_LIMIT_USER, "RATE_LIMIT_USER"),
  };
}
