// The conformance-only routes of the server under test: reset, jobs, clock.
//
// Deferred work: an edition may finish work like webhook delivery after it responds. Lite finishes
// it before the response; Standard may leave it for the job loop. Tests that observe deferred
// effects (webhook deliveries, snapshot rebuilds, Play acknowledgements) call settle() first, which
// runs /__conformance/jobs, so they pass either way.

import { CONFORMANCE_TOKEN, TARGET } from "./env";
import { testConfig } from "./config";

let clockOffset = 0;
let ownerToken = "";

async function control(path: string, body: unknown) {
  const res = await fetch(`${TARGET}/__conformance/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${CONFORMANCE_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as any;
  if (res.status !== 200) throw new Error(`/__conformance/${path} answered ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/**
 * Wipes the server, loads `config` (default: the test config) and returns an owner access token.
 * Every test file calls this in a beforeEach (or per test when it needs another config).
 */
export async function reset(config: object = testConfig()) {
  const { owner_token } = await control("reset", { config });
  clockOffset = 0;
  ownerToken = owner_token;
  return { ownerToken: owner_token as string };
}

/** The owner access token from the last reset. */
export const owner = () => {
  if (!ownerToken) throw new Error("Call reset() first.");
  return ownerToken;
};

/** Runs the scheduled jobs (all of them, hourly ones included) and flushes deferred work. */
export async function jobs() {
  await control("jobs", {});
}

/** Lets deferred work finish before asserting on it (see the note at the top). */
export const settle = jobs;

/** Moves the server's clock forward by `ms`. Returns the server's new now. */
export async function advanceClock(ms: number) {
  const { now_ms } = await control("clock", { advance_ms: ms });
  clockOffset = now_ms - Date.now();
  return now_ms as number;
}

/** Sets the server's clock to `ms`. */
export async function setClock(ms: number) {
  const { now_ms } = await control("clock", { now_ms: ms });
  clockOffset = now_ms - Date.now();
  return now_ms as number;
}

/** The server's notion of now, as far as the runner knows (local clock plus the offset it set). */
export const now = () => Date.now() + clockOffset;
