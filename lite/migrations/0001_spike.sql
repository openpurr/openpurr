-- M0 spike schema. Throwaway: M1 replaces these tables with the real ledger.

-- Every SDK request, for building the request budget and the spec/ fixtures.
CREATE TABLE capture (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,          -- ISO 8601
  method        TEXT    NOT NULL,
  path          TEXT    NOT NULL,
  query         TEXT,
  platform      TEXT,                      -- X-Platform header
  sdk_version   TEXT,                      -- X-Version header
  app_user_id   TEXT,                      -- parsed from the path when present
  headers       TEXT    NOT NULL,          -- JSON, Authorization redacted
  body          TEXT,
  status        INTEGER
);
CREATE INDEX capture_ts ON capture (ts);

-- Unvalidated purchases: the spike trusts whatever the SDK posts.
CREATE TABLE spike_purchase (
  app_user_id           TEXT    NOT NULL,
  store_transaction_id  TEXT    NOT NULL,  -- StoreKit transaction ID or Play order ID / token
  product_id            TEXT    NOT NULL,
  base_plan_id          TEXT,              -- Play subscriptions only
  kind                  TEXT    NOT NULL,  -- subscription | non_subscription
  store                 TEXT    NOT NULL,  -- app_store | play_store
  is_sandbox            INTEGER NOT NULL,
  purchased_at          TEXT    NOT NULL,
  original_purchased_at TEXT    NOT NULL,
  expires_at            TEXT,
  PRIMARY KEY (store, store_transaction_id)
);
CREATE INDEX spike_purchase_user ON spike_purchase (app_user_id);

CREATE TABLE spike_customer (
  app_user_id           TEXT PRIMARY KEY,
  original_app_user_id  TEXT NOT NULL,
  first_seen            TEXT NOT NULL
);
