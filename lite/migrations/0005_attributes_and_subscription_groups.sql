-- Subscriber attributes, and App Store subscription groups (for intro-offer eligibility).

-- Attributes the SDK syncs ($email, custom keys, attribution...). One row per customer and key.
-- A cleared attribute keeps its row with value NULL, so an older update can't bring it back.
CREATE TABLE subscriber_attribute (
  customer_id  TEXT    NOT NULL REFERENCES customer (id),
  key          TEXT    NOT NULL,
  value        TEXT,               -- NULL when cleared (the SDK sends "")
  updated_at   INTEGER NOT NULL,   -- updated_at_ms from the device; newer wins
  received_at  INTEGER NOT NULL,
  PRIMARY KEY (customer_id, key)
);

-- Apple's subscriptionGroupIdentifier. A customer who has had any subscription in a group
-- isn't eligible for that group's introductory offers.
ALTER TABLE store_transaction ADD COLUMN subscription_group TEXT;
CREATE INDEX store_transaction_product ON store_transaction (store, product_id);
