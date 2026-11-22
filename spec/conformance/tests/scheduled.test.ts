// The scheduled job's cleanup, as far as it shows over HTTP: customers who never purchased and
// have been inactive for 90 days disappear from the admin API; everyone else stays. Customers are
// made through the SDK, time passes on the server's clock, and jobs() runs every task.
// Ported from lite/test/scheduled.test.ts. Dropped (no HTTP view of them): raw notification
// payloads after 30 days, spike captures, expired Apple chains, which tasks run in which slot,
// and the Worker's scheduled-handler wiring.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, advanceClock, call, DAY, jobs, now, postAppleTransaction, reset } from "../src";

/** A fresh anonymous ID ($RCAnonymousID: and 32 hex digits). */
const anonymous = () => `$RCAnonymousID:${crypto.randomUUID().replace(/-/g, "")}`;
/** logIn: a new customer for an unknown ID, or a new alias for an anonymous customer. */
const logIn = (from: string, to: string) => call("/v1/subscribers/identify", { body: { app_user_id: from, new_app_user_id: to } });
const exists = async (appUserId: string) => (await admin("GET", `/customers/${encodeURIComponent(appUserId)}`)).status === 200;

beforeEach(async () => {
  await reset();
});

describe("scheduled job", () => {
  it("deletes inactive customers who never purchased, and nobody else", async () => {
    expect((await logIn(anonymous(), "user-inactive")).status).toBe(201);
    await postAppleTransaction("user-buyer", { productId: "lifetime", type: "Non-Consumable", expiresDate: undefined });
    await logIn(anonymous(), "user-granted");
    expect((await admin("POST", "/customers/user-granted/grants", {}, { body: { entitlement_id: "pro", duration: "weekly" } })).status).toBe(201);
    // An anonymous customer who logs in again later.
    const later = anonymous();
    await call(`/v1/subscribers/${encodeURIComponent(later)}/attributes`, { body: { attributes: { $displayName: { value: "Later", updated_at_ms: now() } } } });

    await advanceClock(85 * DAY);
    expect((await logIn(later, "user-logged-in-lately")).status).toBe(201);
    await logIn(anonymous(), "user-new");
    await advanceClock(10 * DAY);
    expect(await exists("user-inactive")).toBe(true);

    await jobs();
    expect(await exists("user-inactive")).toBe(false);
    for (const id of ["user-buyer", "user-granted", "user-logged-in-lately", "user-new"]) expect(await exists(id), id).toBe(true);
    const listed = ((await admin("GET", "/customers")).body.customers as { app_user_id: string }[]).map((c) => c.app_user_id);
    expect(listed).not.toContain("user-inactive");
  });

  it("keeps customers until they've been inactive for 90 days", async () => {
    await logIn(anonymous(), "user-recent");
    await advanceClock(89 * DAY);
    await jobs();
    expect(await exists("user-recent")).toBe(true);
    await advanceClock(2 * DAY);
    await jobs();
    expect(await exists("user-recent")).toBe(false);
  });
});
