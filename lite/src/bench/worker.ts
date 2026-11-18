// Benchmark Worker: the production app plus /__bench. Deployed separately as
// `openpurr-bench` (wrangler env "bench") so test keys and benchmark code never ship in
// the production bundle.
import { buildApp } from "../app";
import { bench } from "./index";

export default buildApp((app) => app.route("/__bench", bench));
