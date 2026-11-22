// Command openpurr is the Standard edition server: the RevenueCat-compatible SDK API on Postgres.
//
// Configuration comes from the environment:
//
//	DATABASE_URL                 Postgres connection string (required)
//	PORT                         port to listen on (default 8080)
//	OPENPURR_CONFIG              openpurr.config.yaml imported on first start (optional)
//	OPERATOR_SECRET              back-office secret, at least 32 random characters
//	PUBLIC_URL                   the server's public origin, for setup links (default: each request's)
//	RATE_LIMIT_IP_PER_MINUTE     SDK requests per client IP per minute (default 300; 0 = off)
//	RATE_LIMIT_USER_PER_MINUTE   SDK requests per app user per minute (default 60; 0 = off)
//	CLIENT_IP_HEADER             header with the client IP set by your proxy (default: the connection)
//	LOG_LEVEL                    debug, info (default), warn or error
//
// `openpurr admin ...` manages operators straight in the database (create, login-link, list,
// require-totp); see admin.go.
//
// Conformance mode, for the test suite in spec/ only:
//
//	OPENPURR_CONFORMANCE=1, CONFORMANCE_TOKEN, CONFORMANCE_STORE_BASE, CONFORMANCE_APPLE_ROOT_B64
package main

import (
	"context"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/openpurr/openpurr/standard/internal/appleroots"
	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/jobs"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/outbound"
	"github.com/openpurr/openpurr/standard/internal/ratelimit"
	"github.com/openpurr/openpurr/standard/internal/secretkeys"
	"github.com/openpurr/openpurr/standard/internal/server"
)

// How long the SDK API uses the config it loaded before checking for a newer one (Lite's
// SDK_CONFIG_MAX_AGE_MS).
const configMaxAgeMs = 60_000

// How long shutdown waits for requests, the job in progress and deferred work. Cloud Run allows
// 10 seconds after SIGTERM by default, Kubernetes 30.
const shutdownTimeout = 25 * time.Second

func main() {
	if len(os.Args) > 1 && os.Args[1] == "admin" {
		os.Exit(runAdmin(os.Args[2:], os.Stdout, os.Stderr))
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel(os.Getenv("LOG_LEVEL"))}))
	slog.SetDefault(log)
	if err := run(log); err != nil {
		log.Error("openpurr stopped", "error", err.Error())
		os.Exit(1)
	}
}

func logLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	}
	return slog.LevelInfo
}

func envInt(name string, def int) (int, error) {
	v := os.Getenv(name)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a whole number (got %q)", name, v)
	}
	return n, nil
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL must be set")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	ipLimit, err := envInt("RATE_LIMIT_IP_PER_MINUTE", 300)
	if err != nil {
		return err
	}
	userLimit, err := envInt("RATE_LIMIT_USER_PER_MINUTE", 60)
	if err != nil {
		return err
	}
	operatorSecret := os.Getenv("OPERATOR_SECRET")
	if operatorSecret != "" && len(operatorSecret) < 32 {
		return errors.New("OPERATOR_SECRET must be at least 32 random characters")
	}

	publicURL := strings.TrimRight(os.Getenv("PUBLIC_URL"), "/")
	if publicURL != "" && !strings.HasPrefix(publicURL, "https://") && !strings.HasPrefix(publicURL, "http://") {
		return errors.New("PUBLIC_URL must be an origin such as https://purchases.example.com")
	}

	// Conformance mode: refused unless a token guards its routes.
	var conformance *server.Conformance
	var clk clock.Clock = clock.System{}
	appleRoots := appleroots.Production()
	storeBase := ""
	if os.Getenv("OPENPURR_CONFORMANCE") == "1" {
		token := os.Getenv("CONFORMANCE_TOKEN")
		if token == "" {
			return errors.New("OPENPURR_CONFORMANCE=1 needs CONFORMANCE_TOKEN")
		}
		adjustable := clock.NewAdjustable(clock.System{})
		clk = adjustable
		conformance = &server.Conformance{Token: token, Clock: adjustable}
		storeBase = os.Getenv("CONFORMANCE_STORE_BASE")
		if b64 := os.Getenv("CONFORMANCE_APPLE_ROOT_B64"); b64 != "" {
			der, err := base64.StdEncoding.DecodeString(b64)
			if err != nil {
				return fmt.Errorf("CONFORMANCE_APPLE_ROOT_B64 isn't base64: %w", err)
			}
			if _, err := x509.ParseCertificate(der); err != nil {
				return fmt.Errorf("CONFORMANCE_APPLE_ROOT_B64 isn't a DER certificate: %w", err)
			}
			appleRoots = [][]byte{der}
		}
		log.Warn("CONFORMANCE MODE: this server trusts a test Apple root, sends store API calls to " +
			"CONFORMANCE_STORE_BASE, lets anyone with CONFORMANCE_TOKEN erase the database and move the clock. " +
			"Never run it with real data.")
	}

	// The seed config is checked at startup, so a mistake in the file stops the server with a
	// message saying what's wrong (Lite checks it at build time).
	var seed any
	if path := os.Getenv("OPENPURR_CONFIG"); path != "" {
		raw, _, err := config.LoadFile(path)
		if err != nil {
			return err
		}
		seed = raw
	}

	pool, err := db.Open(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool, log); err != nil {
		return err
	}

	// Conformance mode runs without rate limits, as the suite expects.
	var limiters ratelimit.Limiters
	if ipLimit > 0 && conformance == nil {
		limiters.IP = ratelimit.NewMemory(ipLimit, 60_000, clk)
	}
	if userLimit > 0 && conformance == nil {
		limiters.User = ratelimit.NewMemory(userLimit, 60_000, clk)
	}

	deferred := jobs.NewDeferred(log)
	registry := jobs.NewRegistry(pool, clk, log)
	maxAge := int64(configMaxAgeMs)
	if conformance != nil {
		maxAge = 0 // every request sees a config saved a moment ago, like Lite's conformance Worker
	}
	loader := config.NewLoader(pool, clk, maxAge, seed, log)
	// Import the seed now rather than on the first request.
	if _, err := loader.Get(ctx); err != nil {
		return fmt.Errorf("loading the config: %w", err)
	}

	deps := &server.Deps{
		Pool:           pool,
		Clock:          clk,
		Config:         loader,
		Log:            log,
		SecretKeys:     secretkeys.NewVerifier(),
		Limiters:       limiters,
		Experiments:    ledger.NewExperiments(),
		Jobs:           registry,
		Deferred:       deferred,
		HTTPClient:     outbound.NewClient(storeBase),
		AppleRoots:     appleRoots,
		OperatorSecret: operatorSecret,
		PublicURL:      publicURL,
		Secret:         os.LookupEnv,
		ClientIPHeader: os.Getenv("CLIENT_IP_HEADER"),
		Conformance:    conformance,
	}

	handler := server.New(deps) // registers the periodic jobs
	if conformance == nil {
		registry.Start(time.Minute)
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "port", port, "conformance", conformance != nil)
		errc <- srv.ListenAndServe()
	}()

	var serveErr error
	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			serveErr = err
		}
	case <-ctx.Done():
		log.Info("shutting down")
	}
	// Stop taking requests (in-flight ones finish), then let the job in progress and deferred
	// work (first webhook attempts, snapshot rebuilds) finish, all within shutdownTimeout.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown", "error", err.Error())
	}
	registry.Stop(shutdownCtx)
	if !deferred.WaitContext(shutdownCtx) {
		log.Warn("stopped with deferred work unfinished; webhook deliveries left are retried by the next server")
	}
	return serveErr
}
