import { describe, expect, it } from "vitest";
import { TEST_ROOT_CERT_B64, TEST_SIGNED_TRANSACTION } from "../src/bench/fixtures.generated";
import { AppleJwsError, verifyAppleJws } from "../src/lib/apple-jws";
import { base64ToBytes } from "../src/lib/der";

const trustedRoots = [base64ToBytes(TEST_ROOT_CERT_B64)];

describe("verifyAppleJws", () => {
  it("accepts a valid chain and returns the payload", async () => {
    const tx = await verifyAppleJws<{ productId: string }>(TEST_SIGNED_TRANSACTION, { trustedRoots, noCache: true });
    expect(tx.productId).toBe("pro_monthly");
  });

  it("accepts the same JWS from the warm cache", async () => {
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots });
    const tx = await verifyAppleJws<{ productId: string }>(TEST_SIGNED_TRANSACTION, { trustedRoots });
    expect(tx.productId).toBe("pro_monthly");
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = TEST_SIGNED_TRANSACTION.split(".");
    const forged = btoa(JSON.stringify({ productId: "lifetime" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    await expect(verifyAppleJws(`${h}.${forged}.${s}`, { trustedRoots })).rejects.toThrow("JWS signature invalid");
  });

  it("rejects an untrusted root", async () => {
    await expect(
      verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots: [new Uint8Array([1, 2, 3])], noCache: true }),
    ).rejects.toBeInstanceOf(AppleJwsError);
  });

  it("rejects certificates outside their validity period", async () => {
    await expect(
      verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, noCache: true, at: new Date("2040-01-01") }),
    ).rejects.toThrow("not valid at the requested time");
  });
});
