-- Standard only (Lite has no counterpart): chart totals by country, for the charts' country filter
-- (internal/metrics). The same ledger metrics as metric_daily (not new_customers: customers have
-- no country), split by the country of each purchase's storefront ('' when unknown).
--
-- A separate table rather than a column of metric_daily: each stored value is rounded, and the
-- sum of per-country values rounded separately can differ from the rounded total in the last
-- place, so unfiltered charts keep reading metric_daily, whose rows match Lite's exactly (and
-- move over from Lite unchanged). Everything here is derived from store_transaction: the rollup
-- recomputes it with metric_daily, and a full rebuild recreates it.
CREATE TABLE metric_daily_country (
  metric       text COLLATE "C" NOT NULL,
  environment  text COLLATE "C" NOT NULL,
  app_id       text COLLATE "C" NOT NULL,
  store        text COLLATE "C" NOT NULL,
  product_id   text COLLATE "C" NOT NULL,
  country      text COLLATE "C" NOT NULL,   -- ISO 3166-1 alpha-2, '' when unknown
  date         text COLLATE "C" NOT NULL,
  value        double precision NOT NULL,
  PRIMARY KEY (metric, environment, country, app_id, store, product_id, date)
);
-- Text compares byte by byte, as in SQLite (D1), which is also faster to index than a locale's
-- collation; metric_daily gets the same below.

-- The countries with data, for the filter's choices (read with a skip scan).
CREATE INDEX metric_daily_country_country ON metric_daily_country (country);

ALTER TABLE metric_daily
  ALTER COLUMN metric      TYPE text COLLATE "C",
  ALTER COLUMN environment TYPE text COLLATE "C",
  ALTER COLUMN project_id  TYPE text COLLATE "C",
  ALTER COLUMN app_id      TYPE text COLLATE "C",
  ALTER COLUMN store       TYPE text COLLATE "C",
  ALTER COLUMN product_id  TYPE text COLLATE "C",
  ALTER COLUMN date        TYPE text COLLATE "C";

-- An existing Standard database has no country rows yet: the next rollup rebuilds everything.
UPDATE job_state SET value = jsonb_set(value::jsonb, '{rebuild}', 'true')::text WHERE key = 'metrics_rollup';
