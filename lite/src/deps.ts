// Production dependencies: the config from D1 (seeded once from the config compiled at build
// time, see src/config-store.ts) and Apple's real root.
import { configLoader } from "./config-store";
import rawConfig from "./config.generated.json";
import type { Deps } from "./env";
import { APPLE_ROOT_CA_G3_B64 } from "./lib/apple-roots";
import { base64ToBytes } from "./lib/der";

/** `configMaxAgeMs`: how long a Worker uses the config it loaded before checking for a newer one. */
export function productionDeps(opts: { configMaxAgeMs: number }): Deps {
  return {
    loadConfig: configLoader({ maxAgeMs: opts.configMaxAgeMs, seed: rawConfig }),
    appleRoots: [base64ToBytes(APPLE_ROOT_CA_G3_B64)],
  };
}

/** The SDK Worker: config changes reach it within a minute, without a D1 read on every request. */
export const SDK_CONFIG_MAX_AGE_MS = 60_000;
