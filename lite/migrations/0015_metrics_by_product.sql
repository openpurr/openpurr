-- Charts by product (src/metrics.ts): metric_daily gains a product column. Products are few, so this
-- multiplies the stored rows by about the number of products. (Country isn't a column: with dozens
-- of countries the full rebuild wouldn't fit the free plan's 100,000 rows written per day, so the
-- country filter is a Standard edition feature, rebuilt there from the ledger.)
--
-- The totals are derived from the ledger, so only new_customers is carried over (its counts can't
-- be recomputed: the cleanup job deletes old non-buyers). Everything else is rebuilt by the next
-- rollup, which the flag below makes a full one.
CREATE TABLE metric_daily_new (
  metric       TEXT    NOT NULL,
  environment  TEXT    NOT NULL,
  app_id       TEXT    NOT NULL,
  store        TEXT    NOT NULL,
  product_id   TEXT    NOT NULL,   -- product, plus ":base_plan" for Google Play ('' for new_customers)
  date         TEXT    NOT NULL,
  value        REAL    NOT NULL,
  PRIMARY KEY (metric, environment, app_id, store, product_id, date)
);
INSERT INTO metric_daily_new (metric, environment, app_id, store, product_id, date, value)
  SELECT metric, environment, app_id, store, '', date, value FROM metric_daily WHERE metric = 'new_customers';
DROP TABLE metric_daily;
ALTER TABLE metric_daily_new RENAME TO metric_daily;

UPDATE job_state SET value = json_set(value, '$.rebuild', json('true')) WHERE key = 'metrics_rollup';
