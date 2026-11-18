-- Precomputed CustomerInfo, so GET /v1/subscribers/{id} is one D1 query.
-- Every write that changes a customer deletes their snapshot in the same batch, then rebuilds it.
-- A missing or outdated snapshot is computed on read (without writing), so a failed rebuild can
-- cost a little CPU but never serves stale data.
CREATE TABLE customer_snapshot (
  customer_id     TEXT    PRIMARY KEY REFERENCES customer (id),
  body            TEXT    NOT NULL,  -- the time-independent part of CustomerInfo (JSON)
  etag            TEXT    NOT NULL,
  config_version  TEXT    NOT NULL,  -- recomputed when the config changes
  updated_at      INTEGER NOT NULL
);
CREATE INDEX customer_snapshot_version ON customer_snapshot (config_version);
