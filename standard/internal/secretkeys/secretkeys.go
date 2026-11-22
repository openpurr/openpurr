// Package secretkeys verifies secret API keys (sk_...) for server-to-server calls, such as reading
// full CustomerInfo from a backend. A port of lite/src/secret-keys.ts.
//
// Unlike public SDK keys, these are secrets: only a SHA-256 hash is stored (api_key), and a key is
// shown once, when created. Lookups are cached for a minute, so a busy backend doesn't cost a
// query per request; revoking a key therefore takes effect within a minute. last_used_at is
// written at most once an hour per key, to keep writes off the read path.
package secretkeys

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

const Prefix = "sk_"

// Scopes a secret key can have.
var Scopes = []string{"customers:read"}

type Key struct {
	ID string
	// A secret key reads one project's customers.
	ProjectID  string
	Name       string
	Scopes     map[string]bool
	lastUsedAt *int64
	mu         sync.Mutex
}

const (
	cacheMs         = 60_000
	lastUsedEveryMs = 3600_000
	maxCached       = 1000
)

// Verifier checks presented keys, with a cache.
type Verifier struct {
	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	key *Key
	at  int64
}

func NewVerifier() *Verifier { return &Verifier{cache: map[string]cached{}} }

// Hash is the SHA-256 hex of a key, as stored in api_key.key_hash.
func Hash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// Verify returns the key for a presented token, or nil if it's unknown, revoked or expired.
func (v *Verifier) Verify(ctx context.Context, db ledger.DB, token string, now int64) (*Key, error) {
	n := jsobj.UTF16Len(token)
	if !strings.HasPrefix(token, Prefix) || n < 20 || n > 200 {
		return nil, nil
	}
	hash := Hash(token)
	v.mu.Lock()
	c, ok := v.cache[hash]
	v.mu.Unlock()
	if ok && now-c.at < cacheMs {
		return c.key, nil
	}

	var key *Key
	var id, projectID, name, scopes string
	var lastUsed *int64
	err := db.QueryRow(ctx,
		`SELECT id, project_id, name, scopes, last_used_at FROM api_key
		 WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $2)`, hash, now).
		Scan(&id, &projectID, &name, &scopes, &lastUsed)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	default:
		var list []string
		_ = json.Unmarshal([]byte(scopes), &list)
		set := map[string]bool{}
		for _, s := range list {
			set[s] = true
		}
		key = &Key{ID: id, ProjectID: projectID, Name: name, Scopes: set, lastUsedAt: lastUsed}
	}
	v.mu.Lock()
	if len(v.cache) > maxCached {
		v.cache = map[string]cached{}
	}
	v.cache[hash] = cached{key: key, at: now}
	v.mu.Unlock()
	return key, nil
}

// Clear forgets cached lookups (conformance resets and tests).
func (v *Verifier) Clear() {
	v.mu.Lock()
	v.cache = map[string]cached{}
	v.mu.Unlock()
}

// TouchDue reports whether last use should be recorded now (at most hourly), and marks it as
// recorded on the cached copy.
func (k *Key) TouchDue(now int64) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.lastUsedAt != nil && now-*k.lastUsedAt < lastUsedEveryMs {
		return false
	}
	k.lastUsedAt = &now
	return true
}

// Touch records use.
func Touch(ctx context.Context, db ledger.DB, keyID string, now int64) error {
	_, err := db.Exec(ctx, "UPDATE api_key SET last_used_at = $1 WHERE id = $2", now, keyID)
	return err
}
