package db_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// On Cloud Run, Cloud SQL is a Unix socket under /cloudsql (the service's Cloud SQL connection),
// named in DATABASE_URL's host parameter, as infra/gcp writes it. No connector library needed.
func TestCloudSQLSocketURL(t *testing.T) {
	cfg, err := pgxpool.ParseConfig("postgres://openpurr:secret@/openpurr?host=/cloudsql/my-project:us-central1:openpurr&pool_max_conns=4")
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.ConnConfig
	if c.Host != "/cloudsql/my-project:us-central1:openpurr" || c.Port != 5432 || c.User != "openpurr" || c.Database != "openpurr" || c.Password != "secret" {
		t.Fatalf("%+v", c)
	}
	if c.TLSConfig != nil {
		t.Fatal("TLS over the socket: Cloud SQL's connector already encrypts the connection")
	}
	if cfg.MaxConns != 4 {
		t.Fatalf("max conns %d", cfg.MaxConns)
	}
}
