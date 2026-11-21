-- Price experiments (src/experiments.ts): each customer new to the app sees one variant's offering
-- as the current one, and the dashboard compares what each variant's customers bought.
--
-- Experiments are dashboard objects, not part of the config: starting and stopping them is a
-- moment in time, and their enrollments are data. Variants name offerings from the config by ID.

CREATE TABLE experiment (
  id          TEXT    PRIMARY KEY,          -- random, shown in webhooks as experiment_id
  project_id  TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  notes       TEXT    NOT NULL DEFAULT '',
  variants    TEXT    NOT NULL,             -- JSON: [{"id": "a", "offering_id": "default", "weight": 50}, ...]; "a" is the control
  status      TEXT    NOT NULL,             -- draft | running | stopped
  created_at  INTEGER NOT NULL,
  created_by  TEXT,                         -- operator email
  started_at  INTEGER,
  stopped_at  INTEGER,
  results     TEXT,                         -- the last computed results (JSON), see results_at
  results_at  INTEGER
);
CREATE INDEX experiment_project ON experiment (project_id, created_at);
-- At most one running experiment per project, so every customer is in at most one.
CREATE UNIQUE INDEX experiment_running ON experiment (project_id) WHERE status = 'running';

-- Who saw which variant, by app user ID. Not by customer: an app fetches offerings before it has
-- bought or set anything, and creating a customer for every install would count each one as a new
-- customer in the charts. Results find the customer through customer_alias. Rows stay when the
-- cleanup job deletes a customer who never bought: they still count as enrolled.
CREATE TABLE experiment_enrollment (
  experiment_id  TEXT    NOT NULL,
  app_user_id    TEXT    NOT NULL,
  variant        TEXT    NOT NULL,
  enrolled_at    INTEGER NOT NULL,
  PRIMARY KEY (experiment_id, app_user_id)
);
CREATE INDEX experiment_enrollment_user ON experiment_enrollment (app_user_id);
