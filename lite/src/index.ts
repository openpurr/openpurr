// Production entry point. Benchmarks live in a separate Worker (src/bench/worker.ts).
import { buildApp } from "./app";
import { productionDeps } from "./deps";

export default buildApp(productionDeps);
