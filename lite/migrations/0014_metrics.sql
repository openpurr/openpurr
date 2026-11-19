-- Charts: daily totals derived from the ledger (src/metrics.ts). Everything here can be rebuilt
-- from store_transaction, except new_customers: the cleanup job deletes non-buyers after 90 days,
-- so those counts are kept once made.
--
-- Two kinds of rows, by metric:
--   per-day amounts (revenue, refunds, new_trials, ...): the value for that day;
--   running totals (active_subs, active_trials, paid_subs, mrr): that day's change (+starts,
--   -ends); a chart adds them up from the beginning. Days after today are never stored.
CREATE TABLE metric_daily (
  metric       TEXT    NOT NULL,
  environment  TEXT    NOT NULL,   -- production | sandbox ('' for new_customers)
  app_id       TEXT    NOT NULL,   -- '' for new_customers (customers aren't tied to an app)
  store        TEXT    NOT NULL,   -- app_store | play_store ('' for new_customers)
  date         TEXT    NOT NULL,   -- YYYY-MM-DD, UTC
  value        REAL    NOT NULL,
  PRIMARY KEY (metric, environment, app_id, store, date)
);

-- What the hourly rollup reads: what changed since the last run, and which purchases can still
-- start or end something on the days it recomputes.
CREATE INDEX store_transaction_updated ON store_transaction (updated_at);
CREATE INDEX store_transaction_purchased ON store_transaction (purchased_at);
CREATE INDEX store_transaction_expires ON store_transaction (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX store_transaction_revoked ON store_transaction (revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX subscription_state_updated ON subscription_state (updated_at);
