-- The purchase ledger. Replaces the M0 spike tables.
--
-- Source of truth: store_transaction, plus who owns each purchase (purchase_owner) and which
-- app user IDs belong to which customer (customer_alias). CustomerInfo, entitlements and
-- metrics are derived from these and can always be rebuilt.
-- All timestamps are epoch milliseconds (UTC).

DROP TABLE IF EXISTS spike_purchase;
DROP TABLE IF EXISTS spike_customer;

CREATE TABLE customer (
  id           TEXT    PRIMARY KEY,          -- internal, random; never shown to apps
  app_user_id  TEXT    NOT NULL,             -- original_app_user_id: the first ID we saw
  first_seen   INTEGER NOT NULL
);

-- Every app user ID that maps to a customer, including the original one. logIn and anonymous
-- merges add rows here instead of moving purchases.
CREATE TABLE customer_alias (
  app_user_id  TEXT    PRIMARY KEY,
  customer_id  TEXT    NOT NULL REFERENCES customer (id),
  created_at   INTEGER NOT NULL
);
CREATE INDEX customer_alias_customer ON customer_alias (customer_id);

-- One row per store transaction (an Apple transaction, or a Google order). A row changes only
-- when the store reports new facts about that same transaction, such as a refund.
CREATE TABLE store_transaction (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id                   TEXT    NOT NULL,  -- app ID from the config
  store                    TEXT    NOT NULL,  -- app_store | play_store
  environment              TEXT    NOT NULL,  -- production | sandbox
  transaction_id           TEXT    NOT NULL,  -- Apple transactionId; Google orderId
  original_transaction_id  TEXT    NOT NULL,  -- Apple originalTransactionId; Google purchase token
  product_id               TEXT    NOT NULL,
  base_plan_id             TEXT,              -- Google Play subscriptions
  product_type             TEXT    NOT NULL,  -- subscription | non_consumable | consumable
  purchased_at             INTEGER NOT NULL,
  original_purchased_at    INTEGER NOT NULL,
  expires_at               INTEGER,           -- subscriptions only
  period_type              TEXT    NOT NULL DEFAULT 'normal',     -- normal | trial | intro
  ownership_type           TEXT    NOT NULL DEFAULT 'PURCHASED',  -- PURCHASED | FAMILY_SHARED
  price_micros             INTEGER,           -- in the purchase currency
  currency                 TEXT,
  storefront               TEXT,
  revoked_at               INTEGER,           -- refund or revocation
  revocation_reason        TEXT,
  is_upgraded              INTEGER NOT NULL DEFAULT 0,
  verified                 INTEGER NOT NULL,  -- 1 = store signature or API confirmed it
  source                   TEXT    NOT NULL,  -- sdk | notification | store_api
  received_at              INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  UNIQUE (store, transaction_id)
);
CREATE INDEX store_transaction_chain ON store_transaction (store, original_transaction_id);

-- Which customer owns a purchase chain (all renewals share the original transaction ID).
-- A transfer between customers updates one row here.
CREATE TABLE purchase_owner (
  store                    TEXT    NOT NULL,
  original_transaction_id  TEXT    NOT NULL,
  customer_id              TEXT    NOT NULL REFERENCES customer (id),
  app_id                   TEXT    NOT NULL,
  updated_at               INTEGER NOT NULL,
  PRIMARY KEY (store, original_transaction_id)
);
CREATE INDEX purchase_owner_customer ON purchase_owner (customer_id);
