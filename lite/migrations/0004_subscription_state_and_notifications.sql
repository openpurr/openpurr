-- Subscription status reported by the stores (auto-renew, billing problems, grace periods),
-- and the raw store notifications we've processed.

-- One row per subscription chain. Derived from the latest renewal info the store sent; an
-- update applies only if it was signed later than what's stored, because notifications can
-- arrive out of order.
CREATE TABLE subscription_state (
  store                     TEXT    NOT NULL,
  original_transaction_id   TEXT    NOT NULL,
  -- Apple status: 1 active, 2 expired, 3 billing retry, 4 billing grace period, 5 revoked.
  status                    INTEGER,
  auto_renew                INTEGER,           -- 1 on, 0 off
  auto_renew_product_id     TEXT,              -- the product it renews into (pending downgrade)
  expiration_intent         INTEGER,
  unsubscribe_detected_at   INTEGER,           -- when we first saw auto-renew off
  billing_issue_detected_at INTEGER,           -- when we first saw a billing problem
  grace_period_expires_at   INTEGER,           -- set only while in a grace period
  signed_at                 INTEGER NOT NULL,  -- signedDate of the renewal info this came from
  updated_at                INTEGER NOT NULL,
  PRIMARY KEY (store, original_transaction_id)
);

-- Every store notification we accepted, for deduplication and debugging. Raw payloads are
-- pruned after 30 days (free-plan storage rule); the summary columns stay.
CREATE TABLE store_notification (
  store                    TEXT    NOT NULL,
  notification_id          TEXT    NOT NULL,   -- Apple notificationUUID
  notification_type        TEXT    NOT NULL,
  subtype                  TEXT,
  environment              TEXT    NOT NULL,   -- production | sandbox
  app_id                   TEXT,               -- from the config, when the bundle matched
  original_transaction_id  TEXT,
  signed_at                INTEGER NOT NULL,
  received_at              INTEGER NOT NULL,
  payload                  TEXT,               -- the signed payload as received
  PRIMARY KEY (store, notification_id)
);
CREATE INDEX store_notification_received ON store_notification (received_at);
CREATE INDEX store_notification_chain ON store_notification (store, original_transaction_id);
