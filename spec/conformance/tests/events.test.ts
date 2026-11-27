// The event list (/admin/v1/events): every purchase event, newest first, whether or not a webhook
// wants it. It's the iOS app's feed. Plus the iOS app's sign-in pieces: its OAuth client document
// and apple-app-site-association from the ios_app_id setting.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, createOperator, postAppleTransaction, request, reset, settle } from "../src";

beforeEach(async () => {
  await reset();
});

const sandboxEvents = async (query = "", auth = {}) => admin("GET", `/events?environment=sandbox${query}`, auth);

describe("event list", () => {
  it("lists every purchase event, newest first, with the feed's fields", async () => {
    await postAppleTransaction("ev-a", { productId: "pro_monthly", price: 9990, currency: "USD", storefront: "USA" });
    await postAppleTransaction("ev-a", { productId: "coins_100", type: "Consumable", expiresDate: undefined, inAppOwnershipType: "FAMILY_SHARED" });
    await settle();

    // Production is the default; test purchases are sandbox.
    expect((await admin("GET", "/events")).body).toEqual({ events: [], next_cursor: null });

    const { status, body } = await sandboxEvents();
    expect(status).toBe(200);
    expect(body.next_cursor).toBeNull();
    expect(body.events.map((e: any) => [e.type, e.product_id])).toEqual([
      ["NON_RENEWING_PURCHASE", "coins_100"],
      ["INITIAL_PURCHASE", "pro_monthly"],
    ]);
    expect(body.events[1]).toMatchObject({
      app_id: "ios",
      project_id: "default",
      environment: "sandbox",
      app_user_id: "ev-a",
      store: "APP_STORE",
      period_type: "NORMAL",
      price: 9.99,
      price_in_purchased_currency: 9.99,
      currency: "USD",
      country_code: "US",
      is_family_share: false,
    });
    expect(body.events[0].is_family_share).toBe(true);

    const detail = await admin("GET", `/events/${body.events[1].id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.body.event).toMatchObject({ id: body.events[1].id, type: "INITIAL_PURCHASE", app_user_id: "ev-a" });
    expect((await admin("GET", "/events/no-such-event")).status).toBe(404);
  });

  it("pages with a cursor and filters by type and app", async () => {
    for (let i = 0; i < 3; i++) await postAppleTransaction(`ev-page-${i}`);
    await settle();
    const first = await sandboxEvents("&limit=2");
    expect(first.body.events.map((e: any) => e.app_user_id)).toEqual(["ev-page-2", "ev-page-1"]);
    const second = await sandboxEvents(`&limit=2&cursor=${encodeURIComponent(first.body.next_cursor)}`);
    expect(second.body.events.map((e: any) => e.app_user_id)).toEqual(["ev-page-0"]);
    expect(second.body.next_cursor).toBeNull();

    expect((await sandboxEvents("&type=RENEWAL")).body.events).toEqual([]);
    expect((await sandboxEvents("&type=INITIAL_PURCHASE,RENEWAL")).body.events).toHaveLength(3);
    expect((await sandboxEvents("&app=android")).body.events).toEqual([]);

    expect((await admin("GET", "/events?type=NOT_A_TYPE")).status).toBe(400);
    expect((await admin("GET", "/events?cursor=%25%25%25")).status).toBe(400);
    expect((await admin("GET", "/events?environment=staging")).status).toBe(400);
    expect((await admin("GET", "/events?app=nope")).status).toBe(404);
  });

  it("shows an operator limited to some apps only those apps' events", async () => {
    await postAppleTransaction("ev-scoped");
    await settle();
    const [event] = (await sandboxEvents()).body.events;
    const androidOnly = await createOperator("viewer", { apps: ["android"] });
    expect((await sandboxEvents("", { session: androidOnly.session })).body.events).toEqual([]);
    expect((await sandboxEvents("&app=ios", { session: androidOnly.session })).status).toBe(404);
    expect((await admin("GET", `/events/${event.id}`, { session: androidOnly.session })).status).toBe(404);
    const everyApp = await createOperator("viewer");
    expect((await admin("GET", `/events/${event.id}`, { session: everyApp.session })).status).toBe(200);
  });
});

describe("the iOS app's sign-in", () => {
  it("serves the client document, and apple-app-site-association once ios_app_id is set", async () => {
    const doc = await request("GET", "/app/ios-client.json");
    expect(doc.status).toBe(200);
    expect(doc.body).toMatchObject({ client_name: "openpurr for iOS", token_endpoint_auth_method: "none" });
    expect(doc.body.client_id).toMatch(/\/app\/ios-client\.json$/);
    expect(doc.body.redirect_uris).toEqual([doc.body.client_id.replace("/app/ios-client.json", "/app/oauth-callback")]);

    expect((await request("GET", "/.well-known/apple-app-site-association")).status).toBe(404);
    expect((await admin("PUT", "/settings", {}, { body: { ios_app_id: "not an app id" } })).status).toBe(400);
    const saved = await admin("PUT", "/settings", {}, { body: { ios_app_id: "ABCDE12345.com.example.purr" } });
    expect(saved.status).toBe(200);
    expect(saved.body.ios_app_id).toBe("ABCDE12345.com.example.purr");
    expect((await admin("GET", "/settings")).body.ios_app_id).toBe("ABCDE12345.com.example.purr");

    const aasa = await request("GET", "/.well-known/apple-app-site-association");
    expect(aasa.status).toBe(200);
    expect(aasa.body).toEqual({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.example.purr"], components: [{ "/": "/app/oauth-callback" }] }] },
      webcredentials: { apps: ["ABCDE12345.com.example.purr"] },
    });
  });
});
