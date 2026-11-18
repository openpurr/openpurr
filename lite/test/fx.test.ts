import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { type DailyRates, type FxProvider, parseEcbXml, refreshRates, storeRatesStatements, toUsd } from "../src/fx";
import { appWithWebhooks, call, envWithWebhookSecrets, signTransaction, webhookReceiver } from "./helpers";

const ecbXml = (days: { time: string; rates: Record<string, number> }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube>${days
    .map((d) => `<Cube time='${d.time}'>${Object.entries(d.rates).map(([c, r]) => `<Cube currency='${c}' rate='${r}'/>`).join("")}</Cube>`)
    .join("")}</Cube></gesmes:Envelope>`;

describe("ECB parsing", () => {
  it("turns euro reference rates into units per USD", () => {
    const [day] = parseEcbXml(ecbXml([{ time: "2026-11-18", rates: { USD: 1.25, JPY: 175, GBP: 0.85 } }]));
    expect(day!.date).toBe("2026-11-18");
    expect(day!.perUsd.USD).toBe(1);
    expect(day!.perUsd.EUR).toBeCloseTo(0.8); // 1 USD = 0.80 EUR
    expect(day!.perUsd.JPY).toBeCloseTo(140);
    expect(day!.perUsd.GBP).toBeCloseTo(0.68);
  });

  it("skips days without a USD rate and ignores malformed rates", () => {
    expect(parseEcbXml(ecbXml([{ time: "2026-11-18", rates: { JPY: 175 } }]))).toEqual([]);
    const [day] = parseEcbXml(ecbXml([{ time: "2026-11-18", rates: { USD: 1, XYZ: 0 } }]));
    expect(day!.perUsd.XYZ).toBeUndefined();
  });
});

function fakeProvider(history: DailyRates[], latest: DailyRates[]) {
  const calls: string[] = [];
  const provider: FxProvider = {
    name: "test",
    history: async () => (calls.push("history"), history),
    latest: async () => (calls.push("latest"), latest),
  };
  return { provider, calls };
}

describe("refreshRates", () => {
  it("loads history first, then the latest rates once they're due", async () => {
    const { provider, calls } = fakeProvider(
      [{ date: "2026-11-16", perUsd: { USD: 1, EUR: 0.9 } }, { date: "2026-11-17", perUsd: { USD: 1, EUR: 0.91 } }],
      [{ date: "2026-11-18", perUsd: { USD: 1, EUR: 0.92 } }],
    );
    const at = (iso: string) => Date.parse(iso);
    expect(await refreshRates(env, fetch, at("2026-11-18T09:00:00Z"), provider)).toBe(4); // empty table: history
    expect(await refreshRates(env, fetch, at("2026-11-18T10:00:00Z"), provider)).toBe(0); // before publication
    expect(await refreshRates(env, fetch, at("2026-11-18T16:00:00Z"), provider)).toBe(2); // today's rates
    expect(await refreshRates(env, fetch, at("2026-11-18T17:00:00Z"), provider)).toBe(0); // already have today
    expect(calls).toEqual(["history", "latest"]);
  });
});

describe("toUsd", () => {
  it("uses the purchase date's rate, or the most recent earlier business day", async () => {
    await env.DB.batch(
      storeRatesStatements(env.DB, "test", [
        { date: "2026-10-02", perUsd: { USD: 1, EUR: 0.8, JPY: 150 } }, // a Friday
        { date: "2026-10-05", perUsd: { USD: 1, EUR: 0.9, JPY: 160 } }, // the next Monday
      ]),
    );
    expect(await toUsd(env.DB, 8, "EUR", Date.parse("2026-10-02T12:00:00Z"))).toBe(10);
    expect(await toUsd(env.DB, 8, "EUR", Date.parse("2026-10-04T12:00:00Z"))).toBe(10); // Sunday: Friday's rate
    expect(await toUsd(env.DB, 9, "EUR", Date.parse("2026-10-05T12:00:00Z"))).toBe(10);
    expect(await toUsd(env.DB, 1500, "JPY", Date.parse("2026-10-02T12:00:00Z"))).toBe(10);
  });

  it("is null when there's no rate, and passes USD through", async () => {
    expect(await toUsd(env.DB, 37.99, "SAR", Date.now())).toBeNull(); // the ECB doesn't publish SAR
    expect(await toUsd(env.DB, 8, "EUR", Date.parse("2001-01-01"))).toBeNull(); // before any rate
    expect(await toUsd(env.DB, 9.99, "USD", Date.now())).toBe(9.99);
    expect(await toUsd(env.DB, null, "EUR", Date.now())).toBeNull();
  });
});

describe("webhook price", () => {
  it("is converted to USD at the purchase date's rate; price_in_purchased_currency stays as charged", async () => {
    const purchaseDate = Date.now() - 3600_000;
    const day = new Date(purchaseDate).toISOString().slice(0, 10);
    // Storage is shared across this file; replace any rate stored for this date by earlier tests.
    await env.DB.prepare("DELETE FROM fx_rate WHERE date = ?").bind(day).run();
    await env.DB.batch(storeRatesStatements(env.DB, "test", [{ date: day, perUsd: { USD: 1, EUR: 0.8 } }]));
    const receiver = webhookReceiver();
    const { app } = appWithWebhooks(receiver);
    const { jws } = await signTransaction({ purchaseDate, price: 7990, currency: "EUR", storefront: "DEU" });
    await call("/v1/receipts", { app, env: envWithWebhookSecrets(), body: { app_user_id: "fx-buyer", fetch_token: jws } });
    expect(receiver.events()[0]).toMatchObject({ currency: "EUR", price_in_purchased_currency: 7.99, price: 9.99, country_code: "DE" });

    const { jws: sar } = await signTransaction({ purchaseDate, price: 37990, currency: "SAR", storefront: "SAU" });
    await call("/v1/receipts", { app, env: envWithWebhookSecrets(), body: { app_user_id: "fx-sar", fetch_token: sar } });
    expect(receiver.events()[1]).toMatchObject({ currency: "SAR", price_in_purchased_currency: 37.99, price: null, country_code: "SA" });
  });
});
