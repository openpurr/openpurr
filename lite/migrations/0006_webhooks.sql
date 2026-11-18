-- Outbound webhooks: RevenueCat-shaped events and their delivery to each configured endpoint.
-- Events are written in the same D1 batch as the ledger change that caused them, so an event
-- exists exactly when its change does. Deliveries form an outbox that the scheduled job retries.

CREATE TABLE webhook_event (
  id           TEXT    PRIMARY KEY,         -- event.id in the body (UUID)
  dedupe_key   TEXT    NOT NULL UNIQUE,     -- one event per fact, whichever source reports it first
  type         TEXT    NOT NULL,            -- INITIAL_PURCHASE, RENEWAL, CANCELLATION...
  app_id       TEXT    NOT NULL,
  customer_id  TEXT,
  environment  TEXT    NOT NULL,            -- production | sandbox
  body         TEXT    NOT NULL,            -- the exact JSON sent
  created_at   INTEGER NOT NULL
);
CREATE INDEX webhook_event_customer ON webhook_event (customer_id, created_at);

CREATE TABLE webhook_delivery (
  event_id         TEXT    NOT NULL REFERENCES webhook_event (id),
  endpoint         TEXT    NOT NULL,        -- webhook id from the config
  status           TEXT    NOT NULL,        -- pending | delivered | failed
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER,                 -- NULL once delivered or given up
  last_status      INTEGER,                 -- HTTP status of the last attempt (0 = network error)
  last_error       TEXT,
  delivered_at     INTEGER,
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (event_id, endpoint)
);
CREATE INDEX webhook_delivery_due ON webhook_delivery (status, next_attempt_at);
