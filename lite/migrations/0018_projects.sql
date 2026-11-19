-- Projects, and the config in D1 (src/config-store.ts).
--
-- A project is one title: its apps (one per store, or more), entitlements, offerings, webhooks,
-- secret keys and customers. Two titles in one deployment (say Rose and Gold, each on iOS and
-- Android) are two projects, and a customer "user_123" of Rose is not the same customer as
-- "user_123" of Gold.
--
-- Customers carry their project. Tables keyed by customer (purchases, attributes, snapshots,
-- grants) inherit it. Purchases, notifications and metrics carry an app ID, and app IDs are unique
-- across projects and never move between them, so a purchase's project is its app's project.
--
-- Everything that exists before this migration belongs to the project "default", which the first
-- config import creates (src/config-store.ts). Its name can be changed later; its ID can't.

-- Every saved config, newest last. The current config is the row with the highest id. Documents
-- are validated (parseConfig) before they're written, and never edited, so this is the history.
CREATE TABLE config_version (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document    TEXT    NOT NULL,   -- the config as JSON: {"version": 2, "projects": {...}}
  created_at  INTEGER NOT NULL,
  created_by  TEXT,               -- operator email, or "import" for the first import
  note        TEXT
);

ALTER TABLE customer ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
DROP INDEX IF EXISTS customer_first_seen;
CREATE INDEX customer_project_first_seen ON customer (project_id, first_seen, id);

-- App user IDs are unique per project, not per deployment. SQLite can't change a primary key in
-- place, so the table is rebuilt. Aliases whose customer is gone are dropped. The default is for
-- the previous Worker version, which keeps running for a minute while a deploy rolls out after
-- this migration; the current code always sets project_id.
CREATE TABLE customer_alias_new (
  project_id   TEXT    NOT NULL DEFAULT 'default',
  app_user_id  TEXT    NOT NULL,
  customer_id  TEXT    NOT NULL REFERENCES customer (id),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, app_user_id)
);
INSERT INTO customer_alias_new (project_id, app_user_id, customer_id, created_at)
  SELECT c.project_id, a.app_user_id, a.customer_id, a.created_at FROM customer_alias a JOIN customer c ON c.id = a.customer_id;
DROP TABLE customer_alias;
ALTER TABLE customer_alias_new RENAME TO customer_alias;
CREATE INDEX customer_alias_customer ON customer_alias (customer_id);

-- A secret key reads one project's customers.
ALTER TABLE api_key ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

-- Charts by project. Ledger metrics are per app (an app's project comes from the config), so their
-- project_id is ''. new_customers isn't tied to an app, so its rows carry the project instead.
CREATE TABLE metric_daily_new (
  metric       TEXT    NOT NULL,
  environment  TEXT    NOT NULL,
  project_id   TEXT    NOT NULL DEFAULT '',   -- new_customers only; '' for every other metric
  app_id       TEXT    NOT NULL,
  store        TEXT    NOT NULL,
  product_id   TEXT    NOT NULL,
  date         TEXT    NOT NULL,
  value        REAL    NOT NULL,
  PRIMARY KEY (metric, environment, project_id, app_id, store, product_id, date)
);
INSERT INTO metric_daily_new (metric, environment, project_id, app_id, store, product_id, date, value)
  SELECT metric, environment, CASE WHEN metric = 'new_customers' THEN 'default' ELSE '' END, app_id, store, product_id, date, value
  FROM metric_daily;
DROP TABLE metric_daily;
ALTER TABLE metric_daily_new RENAME TO metric_daily;
