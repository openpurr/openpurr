// Package testutil sets up tests that need Postgres: a fresh schema per test with the migrations
// applied, a server wired like production with a fixed clock, and helpers that call it the way
// the SDKs do, sign App Store payloads with a test chain (apple.go), and write ledger rows
// directly.
//
// Tests that need Postgres skip unless OPENPURR_TEST_DATABASE_URL is set.
package testutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/jobs"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/outbound"
	"github.com/openpurr/openpurr/standard/internal/ratelimit"
	"github.com/openpurr/openpurr/standard/internal/secretkeys"
	"github.com/openpurr/openpurr/standard/internal/server"
	"github.com/openpurr/openpurr/standard/internal/testdata"
)

const (
	IOSKey     = "appl_test_ios_0123456789"
	AndroidKey = "goog_test_android_0123456789"
	Anon       = "$RCAnonymousID:0123456789abcdef0123456789abcdef"
	Day        = int64(86_400_000)
	// T0 is the fixed time tests start at.
	T0 = int64(1_800_000_000_000)
)

// Quiet is a logger that drops everything.
var Quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// Pool returns a pool on a new, migrated schema, dropped when the test ends.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("OPENPURR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("OPENPURR_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	var b [6]byte
	_, _ = rand.Read(b[:])
	schema := "test_" + hex.EncodeToString(b[:])

	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		_ = admin.Close(context.Background())
	})
	if err := db.Migrate(ctx, pool, nil); err != nil {
		t.Fatal(err)
	}
	return pool
}

// Env is a running test server.
type Env struct {
	T      testing.TB
	Pool   *pgxpool.Pool
	Clock  *clock.Fixed
	Deps   *server.Deps
	Server *httptest.Server
	Loader *config.Loader
	// Counts per limiter key, when rate limits are on.
	Counts map[string]int
}

// Options change the test server.
type Options struct {
	// The seed config; the test config when nil.
	Config any
	// Rate limits per key (nil: no limit), counted in Env.Counts like Lite's test limiter.
	IPLimit, UserLimit *int
	// Conformance mode with this token.
	ConformanceToken string
	// Conformance store base.
	StoreBase string
	// The client IP header (default CF-Connecting-IP, as in Lite's tests).
	ClientIPHeader string
	// Secrets by name (APPLE_IAP_KEY...), instead of the environment.
	Secrets map[string]string
	// Trusted Apple roots; the test chain's root when nil.
	AppleRoots [][]byte
	// Exchange rates for the refresh-exchange-rates job; none when nil (tests don't fetch the ECB).
	FX fx.Provider
}

// NoRates is an exchange-rate provider that never has any.
type NoRates struct{}

func (NoRates) Name() string { return "none" }
func (NoRates) Latest(context.Context, *http.Client) ([]fx.DailyRates, error) {
	return nil, nil
}
func (NoRates) History(context.Context, *http.Client) ([]fx.DailyRates, error) {
	return nil, nil
}

// countingLimiter allows `max` requests per key, forever (lite/test/helpers.ts appWithRateLimits).
type countingLimiter struct {
	kind   string
	max    int
	counts map[string]int
}

func (l *countingLimiter) Allow(_ context.Context, key string) bool {
	k := l.kind + ":" + key
	l.counts[k]++
	return l.counts[k] <= l.max
}

// Start runs a server on a fresh database. Its clock is fixed at T0; move it with Env.Clock.
func Start(t testing.TB, opts Options) *Env {
	t.Helper()
	pool := Pool(t)
	return StartOn(t, pool, opts)
}

// StartOn runs a server on an existing database.
func StartOn(t testing.TB, pool *pgxpool.Pool, opts Options) *Env {
	t.Helper()
	clk := clock.NewFixed(T0)
	seed := opts.Config
	if seed == nil {
		seed = testdata.TestConfig()
	}
	env := &Env{T: t, Pool: pool, Clock: clk, Counts: map[string]int{}}
	var limiters ratelimit.Limiters
	if opts.IPLimit != nil {
		limiters.IP = &countingLimiter{kind: "ip", max: *opts.IPLimit, counts: env.Counts}
	}
	if opts.UserLimit != nil {
		limiters.User = &countingLimiter{kind: "user", max: *opts.UserLimit, counts: env.Counts}
	}
	var conf *server.Conformance
	var serverClock clock.Clock = clk
	if opts.ConformanceToken != "" {
		adj := clock.NewAdjustable(clk)
		conf = &server.Conformance{Token: opts.ConformanceToken, Clock: adj}
		serverClock = adj
	}
	header := opts.ClientIPHeader
	if header == "" {
		header = "CF-Connecting-IP"
	}
	roots := opts.AppleRoots
	if roots == nil {
		roots = [][]byte{AppleFixtures().RootDER}
	}
	secret := os.LookupEnv
	if opts.Secrets != nil {
		secret = func(name string) (string, bool) {
			v, ok := opts.Secrets[name]
			return v, ok
		}
	}
	rates := opts.FX
	if rates == nil {
		rates = NoRates{}
	}
	loader := config.NewLoader(pool, serverClock, 60_000, seed, Quiet)
	env.Loader = loader
	env.Deps = &server.Deps{
		Pool:           pool,
		Clock:          serverClock,
		Config:         loader,
		Log:            Quiet,
		SecretKeys:     secretkeys.NewVerifier(),
		Limiters:       limiters,
		Experiments:    ledger.NewExperiments(),
		Jobs:           jobs.NewRegistry(pool, serverClock, Quiet),
		Deferred:       jobs.NewDeferred(Quiet),
		HTTPClient:     outbound.NewClient(opts.StoreBase),
		ClientIPHeader: header,
		Secret:         secret,
		AppleRoots:     roots,
		Conformance:    conf,
		FX:             rates,
	}
	env.Server = httptest.NewServer(server.New(env.Deps))
	t.Cleanup(env.Server.Close)
	return env
}

// Response is a finished call.
type Response struct {
	Status int
	Header http.Header
	Body   []byte
}

// JSON parses the body with JavaScript semantics.
func (r *Response) JSON(t testing.TB) any {
	t.Helper()
	v, err := jsobj.Parse(r.Body)
	if err != nil {
		t.Fatalf("not JSON (status %d): %s", r.Status, r.Body)
	}
	return v
}

// Get reads a property path from the JSON body ("subscriber", "entitlements", "pro").
func (r *Response) Get(t testing.TB, path ...string) any {
	t.Helper()
	v := r.JSON(t)
	for _, p := range path {
		v, _ = jsobj.Prop(v, p)
	}
	return v
}

// CallOptions are like lite/test/helpers.ts call()'s options.
type CallOptions struct {
	Key      *string
	Body     any
	Platform string // "ios" (default) or "android"
	Headers  map[string]string
	Method   string
}

// Key is a helper for CallOptions.Key.
func Key(k string) *string { return &k }

// Call calls the server the way the SDKs do (headers per spec/sdk-wire-contract.md). path is sent
// as is, so raw "$" and ":" stay raw, as iOS sends them.
func (e *Env) Call(path string, opts CallOptions) *Response {
	e.T.Helper()
	platform := opts.Platform
	if platform == "" {
		platform = "ios"
	}
	key := IOSKey
	if platform == "android" {
		key = AndroidKey
	}
	if opts.Key != nil {
		key = *opts.Key
	}
	method := opts.Method
	var body io.Reader
	if opts.Body != nil {
		if method == "" {
			method = http.MethodPost
		}
		switch b := opts.Body.(type) {
		case string:
			body = strings.NewReader(b)
		default:
			body = strings.NewReader(jsobj.Stringify(b))
		}
	}
	if method == "" {
		method = http.MethodGet
	}
	req, err := http.NewRequest(method, e.Server.URL+"/", body)
	if err != nil {
		e.T.Fatal(err)
	}
	req.URL.Opaque = path
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	if platform == "ios" {
		req.Header.Set("X-Platform", "iOS")
		req.Header.Set("X-Version", "5.103.1")
		req.Header.Set("X-Is-Sandbox", "true")
	} else {
		req.Header.Set("X-Platform", "android")
		req.Header.Set("X-Version", "11.4.0")
	}
	req.Header.Set("X-RevenueCat-ETag", "")
	for k, v := range opts.Headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.T.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		e.T.Fatal(err)
	}
	// Let deferred work (last-used stamps, enrollments) land before the test looks.
	e.Deps.Deferred.Wait()
	return &Response{Status: res.StatusCode, Header: res.Header, Body: data}
}

// Count is the number of rows in a table.
func (e *Env) Count(table string) int {
	e.T.Helper()
	var n int
	if err := e.Pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		e.T.Fatal(err)
	}
	return n
}

// Exec runs SQL against the test database.
func (e *Env) Exec(sql string, args ...any) {
	e.T.Helper()
	if _, err := e.Pool.Exec(context.Background(), sql, args...); err != nil {
		e.T.Fatal(err)
	}
}

// Tx is a ledger row to insert; zero values get sensible defaults.
type Tx struct {
	AppID, Store, Environment, TransactionID, OriginalTransactionID, ProductID, ProductType string
	BasePlanID                                                                              *string
	PurchasedAt                                                                             int64
	ExpiresAt                                                                               *int64
	NoExpiry                                                                                bool
	RevokedAt                                                                               *int64
	PriceMicros                                                                             *int64
	SubscriptionGroup                                                                       *string
	IsUpgraded                                                                              int
}

var txCounter atomic.Int64

// Ms is a helper for optional timestamps.
func Ms(v int64) *int64 { return &v }

// Str is a helper for optional strings.
func Str(v string) *string { return &v }

// Purchase writes a transaction owned by the customer of appUserID (created if needed), the way
// the receipt endpoint does, and drops their snapshot. It returns the customer ID.
func (e *Env) Purchase(projectID, appUserID string, tx Tx) string {
	e.T.Helper()
	ctx := context.Background()
	c, err := ledger.EnsureCustomer(ctx, e.Pool, projectID, appUserID, e.Clock.Now())
	if err != nil {
		e.T.Fatal(err)
	}
	e.PurchaseFor(c.ID, tx)
	return c.ID
}

// PurchaseFor writes a transaction owned by a customer ID.
func (e *Env) PurchaseFor(customerID string, tx Tx) {
	e.T.Helper()
	id := tx.TransactionID
	if id == "" {
		id = strconv.FormatInt(txCounter.Add(1), 10)
	}
	if tx.OriginalTransactionID == "" {
		tx.OriginalTransactionID = id
	}
	def := func(s *string, v string) {
		if *s == "" {
			*s = v
		}
	}
	def(&tx.AppID, "ios")
	def(&tx.Store, "app_store")
	def(&tx.Environment, "sandbox")
	def(&tx.ProductID, "pro_monthly")
	def(&tx.ProductType, "subscription")
	if tx.PurchasedAt == 0 {
		tx.PurchasedAt = e.Clock.Now() - Day
	}
	if tx.ExpiresAt == nil && !tx.NoExpiry && tx.ProductType == "subscription" {
		tx.ExpiresAt = Ms(tx.PurchasedAt + 30*Day)
	}
	now := e.Clock.Now()
	e.Exec(`INSERT INTO store_transaction (app_id, store, environment, transaction_id, original_transaction_id, product_id,
		base_plan_id, product_type, purchased_at, original_purchased_at, expires_at, price_micros, currency, revoked_at,
		is_upgraded, verified, source, received_at, updated_at, subscription_group)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, CASE WHEN $11::bigint IS NULL THEN NULL ELSE 'USD' END, $12,
		$13, 1, 'sdk', $14, $14, $15)`,
		tx.AppID, tx.Store, tx.Environment, id, tx.OriginalTransactionID, tx.ProductID, tx.BasePlanID, tx.ProductType,
		tx.PurchasedAt, tx.ExpiresAt, tx.PriceMicros, tx.RevokedAt, tx.IsUpgraded, now, tx.SubscriptionGroup)
	e.Exec(`INSERT INTO purchase_owner (store, original_transaction_id, customer_id, app_id, updated_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (store, original_transaction_id) DO UPDATE SET customer_id = excluded.customer_id`,
		tx.Store, tx.OriginalTransactionID, customerID, tx.AppID, now)
	e.Exec("DELETE FROM customer_snapshot WHERE customer_id = $1", customerID)
}

// CustomerID is the customer an app user ID belongs to ("" if none).
func (e *Env) CustomerID(projectID, appUserID string) string {
	e.T.Helper()
	c, err := ledger.FindCustomer(context.Background(), e.Pool, projectID, appUserID)
	if err != nil {
		e.T.Fatal(err)
	}
	if c == nil {
		return ""
	}
	return c.ID
}
