package server

// Conformance mode (OPENPURR_CONFORMANCE=1): routes the shared conformance suite in spec/ uses to
// drive a server through its scenarios quickly. Present only in conformance mode, and only for
// requests carrying `Authorization: Bearer $CONFORMANCE_TOKEN`; anything else gets the usual 404.
//
//   POST /__conformance/reset   {"config": {...}?} -> {"owner_token": "pat_..."}
//     Empties every data table, puts the clock back to real time, saves the given config (else
//     DefaultConformanceConfig) as the current version, and creates an owner operator with an
//     access token. An invalid config answers 400 invalid_config.
//   POST /__conformance/jobs    -> runs every periodic job now, waits for deferred work: {}
//   POST /__conformance/clock   {"advance_ms": n} or {"now_ms": n} -> {"now_ms": n}
//
// The details (owner email, config version note, error codes) follow Lite's conformance Worker
// (lite/src/conformance/worker.ts) and spec/conformance/README.md.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"math"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/ratelimit"
)

// AccessTokenPrefix starts personal access tokens (lite/src/office/principal.ts).
const AccessTokenPrefix = "pat_"

// TokenScopes are every scope an access token can have; the reset's owner token has them all.
var TokenScopes = []string{"read", "write:grants", "write:webhooks", "write:config", "admin"}

// ConformanceOwnerEmail is the owner operator a reset creates.
const ConformanceOwnerEmail = "owner@conformance.test"

// DefaultConformanceConfig is what a reset loads when the runner sends no config: the apps,
// entitlements and offering of lite/test/helpers.ts and spec/conformance/src/config.ts.
const DefaultConformanceConfig = `{"version":1,"apps":{"ios":{"store":"app_store","bundle_id":"com.example.openpurr",` +
	`"sdk_keys":["appl_test_ios_0123456789"],"products":{"pro_monthly":{"type":"subscription"},` +
	`"pro_annual":{"type":"subscription","subscription_group":"21000000"},"lifetime":{"type":"non_consumable"},` +
	`"coins_100":{"type":"consumable"}}},"android":{"store":"play_store","package_name":"com.example.openpurr",` +
	`"sdk_keys":["goog_test_android_0123456789"],"allow_unverified_purchases":true,"products":{"pro":{"type":"subscription",` +
	`"base_plans":["monthly","annual"]},"lifetime":{"type":"non_consumable"},"coins_100":{"type":"consumable"}}}},` +
	`"entitlements":{"pro":{"description":"Pro","products":{"ios":["pro_monthly","pro_annual","lifetime"],"android":["pro","lifetime"]}},` +
	`"annual_perks":{"products":{"ios":["pro_annual"],"android":["pro:annual"]}}},"offerings":[{"id":"default","current":true,` +
	`"description":"Standard","metadata":{"headline":"Go Pro"},"packages":[{"id":"$rc_monthly","ios":"pro_monthly","android":"pro:monthly"},` +
	`{"id":"$rc_annual","ios":"pro_annual","android":"pro:annual"},{"id":"$rc_lifetime","ios":"lifetime","android":"lifetime"}]}]}`

func (s *server) conformance(w http.ResponseWriter, r *http.Request) {
	want := "Bearer " + s.Conformance.Token
	got := r.Header.Get("Authorization")
	if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		writeJSON(w, http.StatusNotFound, jsobj.New("code", 0.0, "message", "Not found"))
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusNotFound, jsobj.New("code", 0.0, "message", "Not found"))
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	var err error
	switch r.URL.Path {
	case "/__conformance/reset":
		err = s.conformanceReset(w, r, body)
	case "/__conformance/jobs":
		s.Deferred.Wait()
		for _, res := range s.Jobs.RunAll(r.Context()) {
			if res.Error != "" {
				s.Log.Error("job failed", "job", res.Job, "error", res.Error)
			}
		}
		s.Deferred.Wait()
		writeJSON(w, http.StatusOK, jsobj.New())
	case "/__conformance/clock":
		s.conformanceClock(w, body)
	default:
		writeJSON(w, http.StatusNotFound, jsobj.New("code", 0.0, "message", "Not found"))
	}
	if err != nil {
		s.internalError(w, r, err)
	}
}

func badRequest(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusBadRequest, jsobj.New("code", "bad_request", "message", message))
}

func (s *server) conformanceReset(w http.ResponseWriter, r *http.Request, body []byte) error {
	ctx := r.Context()
	var raw any
	if len(body) > 0 {
		parsed, err := jsobj.Parse(body)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, jsobj.New("code", "bad_request", "message", "Expected a JSON body: {\"config\": {...}} or {}."))
			return nil
		}
		raw, _ = jsobj.Prop(parsed, "config")
	}
	if raw == nil {
		raw, _ = jsobj.Parse([]byte(DefaultConformanceConfig))
	}
	newConfig, err := config.Parse(raw)
	if err != nil {
		var ce *config.Error
		if errors.As(err, &ce) {
			writeJSON(w, http.StatusBadRequest, jsobj.New("code", "invalid_config", "message", ce.Error()))
			return nil
		}
		return err
	}

	// Work started before the reset must not land after it.
	s.Deferred.Wait()
	if err := db.Truncate(ctx, s.Pool); err != nil {
		return err
	}
	s.Conformance.Clock.Reset()
	s.SecretKeys.Clear()
	s.Experiments.Forget()
	for _, l := range []ratelimit.Limiter{s.Limiters.IP, s.Limiters.User} {
		if rl, ok := l.(ratelimit.Resetter); ok {
			rl.Reset()
		}
	}
	now := s.Clock.Now()

	if _, err := s.Pool.Exec(ctx,
		`INSERT INTO config_version (document, created_at, created_by, note) VALUES ($1, $2, 'conformance', 'Conformance reset')`,
		jsobj.Stringify(newConfig.Document), now); err != nil {
		return err
	}
	s.Config.Invalidate()

	token, err := createOwner(ctx, s.Pool, now)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, jsobj.New("owner_token", token))
	return nil
}

// createOwner adds an owner operator and a personal access token with every scope, in the formats
// of lite/src/office/admin.ts, so the back office accepts it.
func createOwner(ctx context.Context, pool interface {
	Begin(context.Context) (pgx.Tx, error)
}, now int64) (string, error) {
	token := AccessTokenPrefix + randomToken()
	operatorID := ledger.NewUUID()
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO operator (id, email, name, role, totp_enabled, created_at) VALUES ($1, $2, 'Conformance owner', 'owner', 0, $3)`,
			operatorID, ConformanceOwnerEmail, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO access_token (id, operator_id, token_hash, token_prefix, name, scopes, created_at, expires_at)
			 VALUES ($1, $2, $3, $4, 'conformance', $5, $6, NULL)`,
			ledger.NewUUID(), operatorID, sha256Hex(token), token[:10], jsobj.Stringify(stringsToAny(TokenScopes)), now)
		return err
	})
	return token, err
}

func stringsToAny(list []string) []any {
	out := make([]any, len(list))
	for i, s := range list {
		out[i] = s
	}
	return out
}

// randomToken is lite/src/office/auth-crypto.ts's randomToken: 32 random bytes, base64url.
func randomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (s *server) conformanceClock(w http.ResponseWriter, body []byte) {
	parsed, err := jsobj.Parse(body)
	if err != nil {
		badRequest(w, "Expected {\"advance_ms\": n} or {\"now_ms\": n}.")
		return
	}
	advance, hasAdvance := jsobj.Prop(parsed, "advance_ms")
	set, hasSet := jsobj.Prop(parsed, "now_ms")
	integer := func(v any) (int64, bool) {
		f, ok := v.(float64)
		if !ok || math.IsInf(f, 0) || math.IsNaN(f) || f != math.Trunc(f) || math.Abs(f) > 1<<53 {
			return 0, false
		}
		return int64(f), true
	}
	var now int64
	switch {
	case hasSet:
		n, ok := integer(set)
		if !ok {
			badRequest(w, "now_ms must be an integer epoch time in milliseconds.")
			return
		}
		now = s.Conformance.Clock.Set(n)
	case hasAdvance:
		n, ok := integer(advance)
		if !ok {
			badRequest(w, "advance_ms must be an integer number of milliseconds.")
			return
		}
		now = s.Conformance.Clock.Advance(n)
	default:
		badRequest(w, "Expected {\"advance_ms\": n} or {\"now_ms\": n}.")
		return
	}
	writeJSON(w, http.StatusOK, jsobj.New("now_ms", float64(now)))
}
