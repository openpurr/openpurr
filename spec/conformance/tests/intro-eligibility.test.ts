// Introductory offer eligibility (POST /v1/subscribers/:id/intro_eligibility): from the config's
// subscription groups, the groups learned from purchases, and the purchases in a StoreKit 1
// receipt. Ported from lite/test/intro-eligibility.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { buildAppReceipt, call, postAppleTransaction, reset } from "../src";

const eligibility = async (user: string, products: string[], fetchToken = "", platform: "ios" | "android" = "ios") =>
  (await call(`/v1/subscribers/${user}/intro_eligibility`, { platform, body: { product_identifiers: products, fetch_token: fetchToken } })).body;

beforeEach(async () => {
  await reset();
});

describe("intro eligibility", () => {
  it("is true for a new customer when the product's group is known, and null otherwise", async () => {
    // pro_annual's group comes from the config; nobody has bought pro_monthly yet, so its group is unknown.
    expect(await eligibility("elig-new", ["pro_annual", "pro_monthly", "lifetime", "nonexistent"])).toEqual({
      pro_annual: true,
      pro_monthly: null,
      lifetime: null,
      nonexistent: null,
    });
  });

  it("is false once the customer has subscribed to anything in the same group", async () => {
    // pro_monthly's group is learned from this transaction: the same group as pro_annual.
    await postAppleTransaction("elig-subscriber", { productId: "pro_monthly", subscriptionGroupIdentifier: "21000000" });
    expect(await eligibility("elig-subscriber", ["pro_annual", "pro_monthly"])).toEqual({ pro_annual: false, pro_monthly: false });
    // Someone else is still eligible, and now pro_monthly's group is known for them too.
    expect(await eligibility("elig-other", ["pro_annual", "pro_monthly"])).toEqual({ pro_annual: true, pro_monthly: true });
  });

  it("uses the receipt's purchases to answer ineligible before they reach the ledger", async () => {
    const receipt = buildAppReceipt({ inApp: [{ productId: "pro_annual", transactionId: "4000000001" }] });
    expect(await eligibility("elig-receipt", ["pro_annual"], receipt)).toEqual({ pro_annual: false });
    // A malformed receipt just means less information.
    expect(await eligibility("elig-receipt-2", ["pro_annual"], "not-a-receipt")).toEqual({ pro_annual: true });
  });

  it("answers unknown for Google Play apps", async () => {
    expect(await eligibility("elig-android", ["pro"], "", "android")).toEqual({ pro: null });
  });
});
