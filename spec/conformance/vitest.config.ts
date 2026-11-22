import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./src/setup.ts"],
    // Every test resets the one server under test, so files run one at a time, in one process
    // (which also keeps the fake store server on its single port).
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
