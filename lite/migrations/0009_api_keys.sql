-- Secret API keys (sk_...) for server-to-server calls. Only a SHA-256 hash of each key is
-- stored; the key itself is shown once, at creation. Keys are 256-bit random, so a plain hash is
-- enough (a slow password hash only matters for guessable secrets).
CREATE TABLE api_key (
  id            TEXT    PRIMARY KEY,
  key_hash      TEXT    NOT NULL UNIQUE,  -- SHA-256 hex of the full key
  key_prefix    TEXT    NOT NULL,         -- first characters, for recognizing a key in lists
  name          TEXT    NOT NULL,
  scopes        TEXT    NOT NULL,         -- JSON array, e.g. ["customers:read"]
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,                  -- updated at most hourly
  expires_at    INTEGER,                  -- set to end an old key's overlap during rotation
  revoked_at    INTEGER
);
