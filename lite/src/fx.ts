// Exchange rates, for USD prices (webhook `price`, and later charts and MRR).
//
// Default provider: the European Central Bank's euro reference rates. Free, no API key, published
// around 16:00 CET on euro-area business days, about 30 currencies. Reuse is allowed with the
// source acknowledged: "Source: European Central Bank". Currencies the ECB doesn't publish
// (for example SAR, AED, EGP, VND, TWD, COP) have no rate, and their USD price is null, which
// RevenueCat's webhook docs allow for unknown prices. Another provider can be plugged in through
// FxProvider (for example a keyed API with full coverage).
//
// Conversion uses the rate for the purchase's date, or the most recent earlier business day
// (weekends, holidays, and today before publication).

import type { Env } from "./env";

/** Rates for one date: units of each currency per 1 USD. */
export interface DailyRates {
  date: string;
  perUsd: Record<string, number>;
}

export interface FxProvider {
  name: string;
  /** The latest published rates. */
  latest(fetchImpl: typeof fetch): Promise<DailyRates[]>;
  /** Recent history, to fill the table on first run. */
  history(fetchImpl: typeof fetch): Promise<DailyRates[]>;
}

const ECB = "https://www.ecb.europa.eu/stats/eurofxref";

/** Parses ECB eurofxref XML (rates per 1 EUR) into rates per 1 USD. */
export function parseEcbXml(xml: string): DailyRates[] {
  const days: DailyRates[] = [];
  for (const day of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const perEur: Record<string, number> = { EUR: 1 };
    for (const r of day[2]!.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g)) {
      const rate = Number(r[2]);
      if (Number.isFinite(rate) && rate > 0) perEur[r[1]!] = rate;
    }
    const usd = perEur.USD;
    if (!usd) continue; // can't express anything in USD without the USD rate
    const perUsd: Record<string, number> = {};
    for (const [currency, rate] of Object.entries(perEur)) perUsd[currency] = rate / usd;
    perUsd.USD = 1;
    days.push({ date: day[1]!, perUsd });
  }
  return days;
}

export const ecbProvider: FxProvider = {
  name: "ecb",
  async latest(fetchImpl) {
    return parseEcbXml(await fetchText(fetchImpl, `${ECB}/eurofxref-daily.xml`));
  },
  async history(fetchImpl) {
    return parseEcbXml(await fetchText(fetchImpl, `${ECB}/eurofxref-hist-90d.xml`));
  },
};

async function fetchText(fetchImpl: typeof fetch, url: string) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Exchange rates: ${url} answered ${res.status}`);
  return res.text();
}

/**
 * Statements storing rates, many rows per statement (each statement counts toward the free
 * plan's 50 D1 queries per invocation). Existing rows are kept.
 */
export function storeRatesStatements(db: D1Database, source: string, days: DailyRates[], rowsPerStatement = 400) {
  const rows = days.flatMap((d) => Object.entries(d.perUsd).map(([currency, perUsd]) => [d.date, currency, perUsd]));
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += rowsPerStatement) {
    statements.push(
      db
        .prepare(
          `INSERT INTO fx_rate (date, currency, per_usd, source)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), ? FROM json_each(?)
           WHERE true ON CONFLICT (currency, date) DO NOTHING`,
        )
        .bind(source, JSON.stringify(rows.slice(i, i + rowsPerStatement))),
    );
  }
  return statements;
}

/**
 * Scheduled task: fills the table on first run (90 days of history), then fetches the latest rates
 * once today's are due and missing. ECB publishes around 16:00 CET, so it checks from 15:00 UTC.
 * Returns how many rows were added.
 */
export async function refreshRates(env: Env, fetchImpl: typeof fetch, now: number, provider: FxProvider = ecbProvider) {
  const latest = await env.DB.prepare("SELECT max(date) AS date FROM fx_rate").first<{ date: string | null }>();
  const today = new Date(now).toISOString().slice(0, 10);
  let days: DailyRates[];
  if (!latest?.date) days = await provider.history(fetchImpl);
  else if (latest.date < today && new Date(now).getUTCHours() >= 15) days = await provider.latest(fetchImpl);
  else return 0;
  const fresh = days.filter((d) => !latest?.date || d.date > latest.date);
  if (!fresh.length) return 0; // weekend or holiday: nothing new published
  const statements = storeRatesStatements(env.DB, provider.name, fresh);
  await env.DB.batch(statements);
  return fresh.reduce((n, d) => n + Object.keys(d.perUsd).length, 0);
}

/**
 * Converts an amount to USD at the rate for `at` (or the most recent earlier business day).
 * Null when there's no rate for that currency on or before that date. Rounded to cents.
 */
export async function toUsd(db: D1Database, amount: number | null, currency: string | null, at: number): Promise<number | null> {
  if (amount === null || !currency) return null;
  if (currency === "USD") return amount;
  const row = await db
    .prepare("SELECT per_usd FROM fx_rate WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1")
    .bind(currency.toUpperCase(), new Date(at).toISOString().slice(0, 10))
    .first<{ per_usd: number }>();
  return row ? Math.round((amount / row.per_usd) * 100) / 100 : null;
}
