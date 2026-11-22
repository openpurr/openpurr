package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// `openpurr migrate` on the test database: its schema named in DATABASE_URL.
func TestMigrateCommand(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	env.PostAppleTransaction("alice", nil)
	var schema string
	if err := env.Pool.QueryRow(context.Background(), "SELECT current_schema()").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	url := os.Getenv("OPENPURR_TEST_DATABASE_URL")
	sep := "?"
	if strings.Contains(url, "?") {
		sep = "&"
	}
	t.Setenv("DATABASE_URL", url+sep+"search_path="+schema)

	var out, errOut bytes.Buffer
	if code := runMigrate(nil, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "Usage: openpurr migrate import") {
		t.Fatalf("%d %q", code, errOut.String())
	}
	errOut.Reset()
	if code := runMigrate([]string{"import"}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "--bundle is required") {
		t.Fatalf("%d %q", code, errOut.String())
	}
	errOut.Reset()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"format":"something-else"}`), 0o644)
	if code := runMigrate([]string{"import", "--bundle", dir}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "isn't an openpurr export bundle") {
		t.Fatalf("%d %q", code, errOut.String())
	}
	// A full bundle never lands on data.
	errOut.Reset()
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"format":"openpurr-export","version":1,"id":"b1","kind":"full","tables":[]}`), 0o644)
	if code := runMigrate([]string{"import", "--bundle", dir}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "Nothing was imported: this database already has data (1 customers") {
		t.Fatalf("%d %q", code, errOut.String())
	}

	out.Reset()
	env.Exec("DELETE FROM customer_snapshot")
	if code := runMigrate([]string{"rebuild"}, &out, &errOut); code != 0 || !strings.Contains(out.String(), "1 CustomerInfo snapshots built") {
		t.Fatalf("%d %q %q", code, out.String(), errOut.String())
	}
}
