-- Promotional grants: entitlements given by an operator (dashboard, admin API or MCP) rather than
-- bought. CustomerInfo shows them the way RevenueCat does, as an entitlement backed by a
-- subscriptions entry with store "promotional" and product "rc_promo_<entitlement>_<duration>".
-- Part of the ledger: revoking keeps the row (revoked_at), so the history stays.
CREATE TABLE promotional_grant (
  id              TEXT    PRIMARY KEY,
  customer_id     TEXT    NOT NULL REFERENCES customer (id),
  entitlement_id  TEXT    NOT NULL,
  duration        TEXT    NOT NULL,    -- daily, weekly, monthly, ..., yearly, lifetime, or custom
  starts_at       INTEGER NOT NULL,
  expires_at      INTEGER,             -- NULL = lifetime
  note            TEXT,
  granted_by      TEXT,                -- operator email
  source          TEXT    NOT NULL,    -- dashboard | api | mcp
  created_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  revoked_by      TEXT
);
CREATE INDEX promotional_grant_customer ON promotional_grant (customer_id);
