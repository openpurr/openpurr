import { describe, expect, it } from "vitest";
import { InvalidReceiptError, transactionIdFromAppReceipt } from "../src/stores/apple-receipt";
import { buildAppReceipt } from "./receipt-builder";

describe("transactionIdFromAppReceipt", () => {
  const inApp = [{ productId: "pro_monthly", transactionId: "2000000444", originalTransactionId: "2000000111" }];

  it("reads a transaction ID from an App Store (DER) receipt", () => {
    expect(transactionIdFromAppReceipt(buildAppReceipt({ inApp }))).toBe("2000000444");
  });

  it("reads Xcode receipts with indefinite lengths and the extra OCTET STRING", () => {
    expect(transactionIdFromAppReceipt(buildAppReceipt({ inApp, xcode: true }))).toBe("2000000444");
  });

  it("returns null for a receipt with no in-app purchases", () => {
    expect(transactionIdFromAppReceipt(buildAppReceipt({}))).toBeNull();
    expect(transactionIdFromAppReceipt(buildAppReceipt({ xcode: true }))).toBeNull();
  });

  it("rejects malformed receipts", () => {
    const good = atob(buildAppReceipt({ inApp }));
    for (const bad of ["not base64!!", btoa("hello"), btoa(good.slice(0, 40)), btoa(good.slice(0, good.length - 3))]) {
      expect(() => transactionIdFromAppReceipt(bad), bad).toThrow(InvalidReceiptError);
    }
  });

  it("rejects receipts nested past the depth limit", () => {
    let nested = "\x04\x00";
    for (let i = 0; i < 40; i++) nested = `\x30\x80${nested}\x00\x00`;
    expect(() => transactionIdFromAppReceipt(btoa(nested))).toThrow(InvalidReceiptError);
  });
});
