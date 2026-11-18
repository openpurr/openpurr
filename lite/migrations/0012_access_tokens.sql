-- Personal access tokens (pat_...) for the CLI and MCP. Each belongs to an operator and is
-- limited by both the operator's role and the token's scopes. Only a SHA-256 hash is stored.
CREATE TABLE access_token (
  id            TEXT    PRIMARY KEY,
  operator_id   TEXT    NOT NULL REFERENCES operator (id),
  token_hash    TEXT    NOT NULL UNIQUE,
  token_prefix  TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  scopes        TEXT    NOT NULL,   -- JSON array: read, write:grants, write:webhooks, admin
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,            -- updated at most hourly
  expires_at    INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX access_token_operator ON access_token (operator_id);
