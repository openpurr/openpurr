-- Operators (people who run openpurr): sign-in, sessions, links, recovery codes, audit log.
-- Secrets are never stored in the clear: passwords are peppered PBKDF2 hashes, TOTP secrets are
-- encrypted with a Worker secret, and session tokens, link tokens and recovery codes are SHA-256.

CREATE TABLE operator (
  id               TEXT    PRIMARY KEY,
  email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT    NOT NULL,
  role             TEXT    NOT NULL,              -- owner | admin | developer | viewer
  app_ids          TEXT,                          -- JSON array of app IDs; NULL = all apps
  password_hash    TEXT,                          -- NULL until set through a setup link
  totp_secret      TEXT,                          -- encrypted; set while enrolling
  totp_enabled     INTEGER NOT NULL DEFAULT 0,
  totp_last_step   INTEGER,                       -- last accepted 30-second step (no code reuse)
  failed_logins    INTEGER NOT NULL DEFAULT 0,
  locked_until     INTEGER,
  disabled_at      INTEGER,
  created_at       INTEGER NOT NULL,
  last_login_at    INTEGER
);

CREATE TABLE recovery_code (
  operator_id  TEXT    NOT NULL REFERENCES operator (id),
  code_hash    TEXT    NOT NULL,
  used_at      INTEGER,
  PRIMARY KEY (operator_id, code_hash)
);

-- Single-use links: "setup" (set a password; 24 h) and "recovery" (sign in once; 15 min).
CREATE TABLE login_link (
  token_hash   TEXT    PRIMARY KEY,
  operator_id  TEXT    NOT NULL REFERENCES operator (id),
  purpose      TEXT    NOT NULL,                  -- setup | recovery
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE session (
  token_hash    TEXT    PRIMARY KEY,
  operator_id   TEXT    NOT NULL REFERENCES operator (id),
  kind          TEXT    NOT NULL,                 -- full | setup (may only set a password)
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX session_operator ON session (operator_id);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  operator_id  TEXT,                              -- NULL for failed sign-ins of unknown emails
  actor        TEXT,                              -- email, or "cli" / "system"
  token_id     TEXT,                              -- personal access token used, if any
  source       TEXT    NOT NULL,                  -- dashboard | api | cli | mcp | system
  action       TEXT    NOT NULL,                  -- e.g. auth.login, auth.password_changed
  target       TEXT,
  details      TEXT,                              -- JSON
  ip           TEXT
);
CREATE INDEX audit_log_at ON audit_log (at);

-- Owner-controlled settings (for example require_totp).
CREATE TABLE setting (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);
