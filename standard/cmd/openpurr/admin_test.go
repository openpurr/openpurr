package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// The operator commands write what Lite's scripts/admin.mjs writes; the links they print work.
func TestAdminCommands(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	ctx := t.Context()
	var out bytes.Buffer
	a := &adminCLI{pool: env.Pool, out: &out, base: env.Server.URL, now: env.Clock.Now()}

	if err := a.create(ctx, "boss@example.com", "", ""); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Created owner boss@example.com") {
		t.Fatal(out.String())
	}
	link := strings.TrimSpace(out.String()[strings.Index(out.String(), env.Server.URL):])
	res := env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", tu.LinkToken(link)))
	if res.Status != 200 || res.Get(t, "session") != "setup" {
		t.Fatalf("%d %s", res.Status, res.Body)
	}
	if err := a.create(ctx, "boss@example.com", "", "admin"); err == nil || !strings.Contains(err.Error(), "already") {
		t.Fatal(err)
	}
	if err := a.create(ctx, "dev@example.com", "Dev", "wizard"); err == nil {
		t.Fatal("role accepted")
	}

	out.Reset()
	if err := a.loginLink(ctx, "BOSS@example.com"); err != nil {
		t.Fatal(err)
	}
	link = strings.TrimSpace(out.String()[strings.Index(out.String(), env.Server.URL):])
	res = env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", tu.LinkToken(link)))
	if res.Status != 200 || res.Get(t, "session") != "recovery" {
		t.Fatalf("%d %s", res.Status, res.Body)
	}
	if err := a.loginLink(ctx, "nobody@example.com"); err == nil {
		t.Fatal("unknown email")
	}

	out.Reset()
	if err := a.requireTOTP(ctx, "on"); err != nil {
		t.Fatal(err)
	}
	var v string
	env.QueryRow("SELECT value FROM setting WHERE key = 'require_totp'", nil, &v)
	if v != "true" {
		t.Fatal(v)
	}
	out.Reset()
	if err := a.list(ctx); err != nil || !strings.HasPrefix(out.String(), "boss@example.com  owner  setup pending  2-step off  last sign-in never") {
		t.Fatalf("%v %q", err, out.String())
	}
	var actions string
	env.QueryRow("SELECT string_agg(action, ',' ORDER BY id) FROM audit_log WHERE source = 'cli'", nil, &actions)
	if actions != "operator.created,auth.setup_link_created,auth.recovery_link_created,setting.require_totp" {
		t.Fatal(actions)
	}
}
