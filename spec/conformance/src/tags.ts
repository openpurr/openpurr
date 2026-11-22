// Edition-specific checks. Wrap them so they run only on their edition:
//   describeEdition("lite", "Cloudflare usage alerts", () => { ... });
//   itEdition("lite", "...", async () => { ... });

import { describe, it } from "vitest";
import { EDITION } from "./env";

export const onEdition = (edition: "lite" | "standard") => EDITION === edition;

export const describeEdition = (edition: "lite" | "standard", name: string, fn: () => void) => describe.skipIf(!onEdition(edition))(`[${edition}] ${name}`, fn);

export const itEdition = (edition: "lite" | "standard", name: string, fn: () => Promise<void> | void, timeout?: number) =>
  it.skipIf(!onEdition(edition))(`[${edition}] ${name}`, fn, timeout);
