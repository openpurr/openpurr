// Production dependencies: the config compiled at build time and Apple's real root.
import { parseConfig } from "./config";
import rawConfig from "./config.generated.json";
import type { Deps } from "./env";
import { APPLE_ROOT_CA_G3_B64 } from "./lib/apple-roots";
import { base64ToBytes } from "./lib/der";

export const productionDeps: Deps = {
  config: parseConfig(rawConfig),
  appleRoots: [base64ToBytes(APPLE_ROOT_CA_G3_B64)],
};
