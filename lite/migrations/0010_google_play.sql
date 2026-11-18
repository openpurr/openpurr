-- Google Play (M2).

-- When a paused subscription resumes (Google Play pause). Shown as auto_resume_date.
ALTER TABLE subscription_state ADD COLUMN auto_resume_at INTEGER;

-- Purchases whose server-side acknowledgement failed. Google refunds purchases that aren't
-- acknowledged within 3 days, so the scheduled job retries these.
CREATE TABLE play_ack_pending (
  purchase_token  TEXT    PRIMARY KEY,
  app_id          TEXT    NOT NULL,
  product_id      TEXT    NOT NULL,
  kind            TEXT    NOT NULL,   -- subscription | product
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      INTEGER NOT NULL
);

-- Small key-value state for scheduled jobs (for example the voided-purchases checkpoint).
CREATE TABLE job_state (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);
