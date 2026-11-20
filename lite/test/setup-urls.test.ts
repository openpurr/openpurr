import { describe, expect, it } from "vitest";
import { guessSdkUrl, notificationUrl, parseSdkUrl } from "../src/office/setup";

describe("app setup URLs", () => {
  it("accepts an SDK URL that's just an https origin", () => {
    expect(parseSdkUrl(" https://purchases.example.com/ ")).toEqual({ url: "https://purchases.example.com" });
    expect(parseSdkUrl("http://localhost:8787")).toEqual({ url: "http://localhost:8787" });
    expect(parseSdkUrl("http://purchases.example.com")).toMatchObject({ error: expect.stringMatching(/https/) });
    expect(parseSdkUrl("https://purchases.example.com/v1")).toMatchObject({ error: expect.stringMatching(/no path/) });
    expect(parseSdkUrl("purchases.example.com")).toMatchObject({ error: expect.stringMatching(/full address/) });
  });

  it("guesses the SDK Worker from the back office's workers.dev address", () => {
    expect(guessSdkUrl("https://openpurr-office.acme.workers.dev")).toBe("https://openpurr.acme.workers.dev");
    expect(guessSdkUrl("https://office.example.com")).toBeNull();
    expect(guessSdkUrl("http://localhost:8787")).toBeNull();
  });

  it("points each store at its notification route", () => {
    expect(notificationUrl("app_store", "https://office.example.com")).toBe("https://office.example.com/notifications/apple");
    expect(notificationUrl("play_store", "https://office.example.com")).toBe("https://office.example.com/notifications/google");
  });
});
