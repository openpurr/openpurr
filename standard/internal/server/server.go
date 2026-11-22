// Package server is the HTTP side of Standard: the RevenueCat-compatible SDK API under /v1, the
// health check, and the conformance routes. Lite splits the SDK API and the back office into two
// Workers; Standard serves both from one process (the back office arrives in a later milestone).
package server

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/google"
	"github.com/openpurr/openpurr/standard/internal/jobs"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/ratelimit"
	"github.com/openpurr/openpurr/standard/internal/secretkeys"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

// Deps are built once at startup and shared by every request.
type Deps struct {
	Pool   *pgxpool.Pool
	Clock  clock.Clock
	Config *config.Loader
	Log    *slog.Logger

	SecretKeys  *secretkeys.Verifier
	Limiters    ratelimit.Limiters
	Experiments *ledger.Experiments
	Jobs        *jobs.Registry
	Deferred    *jobs.Deferred

	// The one client for outbound calls (store APIs, webhooks); rewritten in conformance mode.
	HTTPClient *http.Client
	// Trusted Apple roots, DER. Production: Apple Root CA G3 only.
	AppleRoots [][]byte
	// Verifies App Store signed data, caching verified chains; made by New when nil.
	JWS *applejws.Verifier
	// App Store Server API bearer tokens; made by New when nil.
	AppleTokens *apple.Tokens
	// Google service-account access tokens and Google's ID token keys; made by New when nil.
	GoogleTokens *google.Tokens
	GoogleKeys   *google.Keys
	// Sends webhook deliveries; made by New when nil.
	Webhooks *webhooks.Deliverer
	// Exchange rates; the European Central Bank when nil.
	FX fx.Provider
	// Back-office secret (operator passwords, TOTP); used from the back-office milestone on.
	OperatorSecret string
	// Secret looks up a secret the config names (APPLE_IAP_KEY, a webhook signing secret...):
	// an environment variable of that name, as Lite reads Worker secrets by name.
	Secret func(name string) (string, bool)

	// The header holding the client IP set by a trusted proxy (for example CF-Connecting-IP or
	// X-Forwarded-For); empty means the connection's address.
	ClientIPHeader string

	// Set only in conformance mode.
	Conformance *Conformance
}

// Conformance mode settings (OPENPURR_CONFORMANCE=1).
type Conformance struct {
	Token string
	Clock *clock.Adjustable
}

// New returns the server's handler.
func New(d *Deps) http.Handler {
	if d.JWS == nil {
		d.JWS = applejws.NewVerifier()
	}
	if d.AppleTokens == nil {
		d.AppleTokens = apple.NewTokens(d.Clock.Now)
	}
	if d.GoogleTokens == nil {
		d.GoogleTokens = google.NewTokens(d.Clock.Now)
	}
	if d.GoogleKeys == nil {
		d.GoogleKeys = google.NewKeys(d.Clock.Now, d.HTTPClient)
	}
	if d.Webhooks == nil {
		d.Webhooks = &webhooks.Deliverer{DB: d.Pool, HTTP: d.HTTPClient, Secret: d.Secret, Now: d.Clock.Now, Log: d.Log}
	}
	if d.FX == nil {
		d.FX = fx.ECB
	}
	s := &server{Deps: d}
	if d.Jobs != nil {
		s.registerJobs()
	}
	return s.logRequests(s.recoverPanics(http.HandlerFunc(s.route)))
}

type server struct {
	*Deps
	sdkMuxOnce sync.Once
	sdkMux     *http.ServeMux
}

var healthReport = regexp.MustCompile(`^/v1/subscribers/[^/]+/health_report_availability$`)

// route dispatches by path prefix. Paths are matched as sent, without ServeMux's cleaning
// redirects, so an odd SDK path still gets a JSON answer.
func (s *server) route(w http.ResponseWriter, r *http.Request) {
	path := r.URL.EscapedPath()
	switch {
	case path == "/healthz" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		s.healthz(w, r)
	// Unauthenticated, iOS DEBUG builds of the SDK only. Failures are ignored by the SDK.
	case (r.Method == http.MethodGet || r.Method == http.MethodHead) && healthReport.MatchString(path):
		writeJSON(w, http.StatusOK, jsobj.New("report_logs", false))
	case strings.HasPrefix(path, "/v1/"):
		s.sdk(w, r)
		s.settleInConformance()
	case path == "/notifications/apple":
		s.appleNotification(w, r)
		s.settleInConformance()
	case path == "/notifications/google":
		s.googleNotification(w, r)
		s.settleInConformance()
	case s.Conformance != nil && strings.HasPrefix(path, "/__conformance/"):
		s.conformance(w, r)
	default:
		writeJSON(w, http.StatusNotFound, jsobj.New("code", 0.0, "message", "Not found"))
	}
}

// settleInConformance finishes deferred work before the response is complete in conformance mode,
// as Lite's conformance Worker does, so a scenario's next request sees its effects.
func (s *server) settleInConformance() {
	if s.Conformance != nil {
		s.Deferred.Wait()
	}
}

// deliverLater makes the first delivery attempt of events just written, after the response
// (Lite's waitUntil(deliverNow(...))). Deliveries to one endpoint go one after another, each
// bounded by webhooks.Timeout, so the time limit grows with the number of events.
func (s *server) deliverLater(cfg *config.Config, events []*webhooks.Prepared) {
	var ids []string
	for _, e := range events {
		if e != nil {
			ids = append(ids, e.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	s.Deferred.GoFor("deliver webhooks", time.Duration(len(ids)+1)*webhooks.Timeout, func(ctx context.Context) error {
		_, err := s.Webhooks.DeliverNow(ctx, cfg, ids, s.Clock.Now())
		return err
	})
}

func (s *server) healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.Pool.Ping(ctx); err != nil {
		s.Log.Error("health check failed", "error", err.Error())
		writeJSON(w, http.StatusServiceUnavailable, jsobj.New("status", "unavailable"))
		return
	}
	writeJSON(w, http.StatusOK, jsobj.New("status", "ok"))
}

// writeJSON answers with a JSON body serialized exactly like JSON.stringify.
func writeJSON(w http.ResponseWriter, status int, v any) {
	body := jsobj.StringifyBytes(v)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// internalError is the answer to anything unexpected. Android treats an error without a JSON body
// as a connection failure, and iOS only parses error bodies served as application/json. 7110 is
// "internal server error" in both SDKs.
func (s *server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	if !errors.Is(err, context.Canceled) {
		s.Log.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err.Error())
	}
	writeJSON(w, http.StatusInternalServerError, jsobj.New("code", 7110.0, "message", "Internal server error"))
}

func (s *server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				s.Log.Error("panic", "method", r.Method, "path", r.URL.Path, "panic", rec)
				writeJSON(w, http.StatusInternalServerError, jsobj.New("code", 7110.0, "message", "Internal server error"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

func (s *server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if r.URL.Path == "/healthz" {
			return
		}
		s.Log.Info("request",
			"method", r.Method,
			"path", r.URL.EscapedPath(),
			"status", rec.status,
			"ms", time.Since(start).Milliseconds(),
			"platform", r.Header.Get("X-Platform"),
		)
	})
}

// clientIP is the address rate limits count against.
func (s *server) clientIP(r *http.Request) string {
	if s.ClientIPHeader != "" {
		v := r.Header.Get(s.ClientIPHeader)
		if i := strings.IndexByte(v, ','); i >= 0 {
			v = v[:i]
		}
		return strings.TrimSpace(v)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
