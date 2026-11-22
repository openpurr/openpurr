// Runs the suite against a server that's already running in conformance mode:
//   pnpm --filter @openpurr/conformance test -- --target http://127.0.0.1:8787 [--edition standard] [vitest args]
// or with CONFORMANCE_TARGET set. Without a target it does nothing (so `pnpm -r test` stays
// offline); `test:lite` boots Lite and runs the suite against it.
import { parseArgs, runVitest, runnerEnv } from "./vitest.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2));
if (!opts.target && !process.env.CONFORMANCE_TARGET) {
  console.log("conformance: no --target or CONFORMANCE_TARGET, so nothing to test. Use `test:lite` to run against Lite.");
  process.exit(0);
}
process.exit(await runVitest(rest, runnerEnv(opts)));
