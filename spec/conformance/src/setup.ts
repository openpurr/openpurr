// vitest setup: the fake store server runs once per test process, and starts each test clean.
import { beforeAll, beforeEach } from "vitest";
import { fake, startFakeStore } from "./fake-store";

beforeAll(async () => {
  await startFakeStore();
});

beforeEach(() => {
  fake.reset();
});
