-- OAuth 2.1 for MCP clients that can't send a personal access token (Claude.ai connectors):
-- src/office/oauth.ts. Everything here is credentials or short-lived state, not ledger data.
-- Tokens and codes are stored as SHA-256 hashes only.

-- Known clients: registered through Dynamic Client Registration (id "opc_..."), or identified by a
-- Client ID Metadata Document URL (the id is the URL; the document is cached here).
CREATE TABLE oauth_client (
  id             TEXT    PRIMARY KEY,
  kind           TEXT    NOT NULL,     -- registered | metadata_document
  name           TEXT    NOT NULL,
  client_uri     TEXT,
  redirect_uris  TEXT    NOT NULL,     -- JSON array; redirects must match one exactly
  created_at     INTEGER NOT NULL,
  fetched_at     INTEGER               -- metadata documents: when last fetched
);

-- An authorization in progress: created by /oauth/authorize, approved or denied on the
-- dashboard's consent screen, then exchanged once for tokens. Ten minutes at most.
CREATE TABLE oauth_request (
  id              TEXT    PRIMARY KEY,
  client_id       TEXT    NOT NULL REFERENCES oauth_client (id),
  redirect_uri    TEXT    NOT NULL,
  state           TEXT,
  code_challenge  TEXT    NOT NULL,    -- PKCE S256
  scope           TEXT    NOT NULL,    -- space-separated, as requested
  resource        TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  operator_id     TEXT,                -- set on approval
  granted_scope   TEXT,
  code_hash       TEXT    UNIQUE,      -- set on approval
  used_at         INTEGER,
  grant_id        TEXT
);

-- A connected app: what an operator approved for a client. Holds the current access and refresh
-- tokens (both rotate on refresh). Shown under Access tokens; revoking ends both.
CREATE TABLE oauth_grant (
  id                  TEXT    PRIMARY KEY,
  client_id           TEXT    NOT NULL REFERENCES oauth_client (id),
  operator_id         TEXT    NOT NULL REFERENCES operator (id),
  scopes              TEXT    NOT NULL,   -- JSON array of token scopes
  resource            TEXT    NOT NULL,   -- the MCP endpoint the tokens are for
  access_hash         TEXT    UNIQUE,
  access_expires_at   INTEGER,
  refresh_hash        TEXT    UNIQUE,
  refresh_expires_at  INTEGER,
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER,
  revoked_at          INTEGER
);
CREATE INDEX oauth_grant_operator ON oauth_grant (operator_id);
