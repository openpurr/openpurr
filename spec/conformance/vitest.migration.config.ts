import { defineConfig } from "vitest/config";

// The end-to-end move from Lite to Standard (scripts/run-migration.mjs), kept out of the suite
// that runs against one server.
export default defineConfig({
  test: {
    include: ["migration/**/*.test.ts"],
    setupFiles: ["./src/setup.ts"],
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
