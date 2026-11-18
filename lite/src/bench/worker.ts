// Benchmark Worker: the production app plus /__bench. Deployed separately as
// `openpurr-bench` (wrangler env "bench") so test keys and benchmark code never ship in
// the production bundle.
import { buildSdkApp } from "../sdk-app";
import { productionDeps } from "../deps";
import { bench } from "./index";

export default buildSdkApp(productionDeps, (app) => app.route("/__bench", bench));
