-- Daily exchange rates, for USD prices in webhooks (and later charts). Source: European Central
-- Bank euro reference rates, converted to "units of currency per 1 USD". About 30 rows per ECB
-- business day.
CREATE TABLE fx_rate (
  date      TEXT NOT NULL,   -- YYYY-MM-DD, the ECB reference date
  currency  TEXT NOT NULL,   -- ISO 4217
  per_usd   REAL NOT NULL,   -- units of `currency` per 1 USD
  source    TEXT NOT NULL,   -- provider, e.g. ecb
  PRIMARY KEY (currency, date)
);
