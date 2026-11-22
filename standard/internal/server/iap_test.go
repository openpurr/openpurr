package server_test

// Signing in through Identity-Aware Proxy (iap.go), with a fake IAP key server.

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func auditActions(t *testing.T, env *tu.Env, actor string) []string {
	t.Helper()
	rows, err := env.Pool.Query(t.Context(), "SELECT action, coalesce(details, '') FROM audit_log WHERE actor = $1 ORDER BY id", actor)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var action, details string
		if err := rows.Scan(&action, &details); err != nil {
			t.Fatal(err)
		}
		got = append(got, strings.TrimSpace(action+" "+details))
	}
	return got
}

func TestIAPSignsInAnOperator(t *testing.T) {
	env := tu.Start(t, tu.Options{IAP: true})
	op := env.CreateOperator(env.OwnerToken(), "developer", nil)
	assertion := tu.IAPToken(env.Clock.Now(), strings.ToUpper(op.Email), nil, nil)

	me := expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{IAP: assertion}, nil), 200)
	if me.Get(t, "session") != "iap" || me.Get(t, "operator", "email") != op.Email || me.Get(t, "totp_enrollment_required") != false {
		t.Fatalf("%s", me.Body)
	}
	principal := expectStatus(t, env.Admin("GET", "/me", tu.Auth{IAP: assertion}, nil), 200)
	if principal.Get(t, "via") != "iap" || principal.Get(t, "operator", "role") != "developer" {
		t.Fatalf("%s", principal.Body)
	}
	expectStatus(t, env.Admin("GET", "/apps", tu.Auth{IAP: assertion}, nil), 200)
	// No session is made: each request is checked on its own.
	if tu.SessionFrom(me) != "" || tu.SessionFrom(principal) != "" {
		t.Fatal("IAP sign-in set a session cookie")
	}
	// The role still applies.
	expectStatus(t, env.Admin("GET", "/audit", tu.Auth{IAP: assertion}, nil), 403)

	// Writes are audited as the dashboard's, and need its Origin.
	expectStatus(t, env.Admin("PATCH", "/me", tu.Auth{IAP: assertion, Origin: "https://evil.example"}, jsobj.New("locale", "de")), 403)
	expectStatus(t, env.Admin("PATCH", "/me", tu.Auth{IAP: assertion, Origin: "-"}, jsobj.New("locale", "de")), 403)
	expectStatus(t, env.Admin("PATCH", "/me", tu.Auth{IAP: assertion}, jsobj.New("locale", "de")), 200)
	var source string
	env.QueryRow("SELECT source FROM audit_log WHERE action = 'operator.locale' AND actor = $1", []any{op.Email}, &source)
	if source != "dashboard" {
		t.Fatalf("source %q", source)
	}

	// The sign-in is audited once, then again after an hour.
	env.Clock.Add(3600_000)
	expectStatus(t, env.Admin("GET", "/me", tu.Auth{IAP: tu.IAPToken(env.Clock.Now(), op.Email, nil, nil)}, nil), 200)
	got := auditActions(t, env, op.Email)
	want := []string{"auth.setup_link_used", "auth.password_changed", `auth.login {"via":"iap"}`, `operator.locale {"locale":"de"}`, `auth.login {"via":"iap"}`}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("audit %v", got)
	}
	// The dashboard's other sign-in routes still want a session.
	expectStatus(t, env.Admin("POST", "/auth/totp/setup", tu.Auth{IAP: assertion}, jsobj.New()), 401)
}

func TestIAPRefusals(t *testing.T) {
	env := tu.Start(t, tu.Options{IAP: true})
	owner := env.OwnerToken()
	op := env.CreateOperator(owner, "admin", nil)
	now := env.Clock.Now()
	cases := map[string]string{
		"wrong audience": tu.IAPToken(now, op.Email, tu.IAPClaims{"aud": "/projects/1/global/backendServices/2"}, nil),
		"expired":        tu.IAPToken(now, op.Email, tu.IAPClaims{"exp": now/1000 - 60}, nil),
		"bad signature":  tu.IAPToken(now, op.Email, nil, nil)[:20] + "x" + tu.IAPToken(now, op.Email, nil, nil)[21:],
		"garbage":        "not-a-jwt",
	}
	for name, assertion := range cases {
		t.Run(name, func(t *testing.T) {
			if res := env.Admin("GET", "/me", tu.Auth{IAP: assertion}, nil); res.Status != 401 || code(t, res) != "signed_out" {
				t.Fatalf("%d %s", res.Status, res.Body)
			}
			expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{IAP: assertion}, nil), 401)
		})
	}
	// None of those are audited: they name no one we can trust.
	if got := auditActions(t, env, op.Email); len(got) != 2 {
		t.Fatalf("audit %v", got)
	}

	// An email with no operator: refused, and audited once an hour.
	stranger := tu.IAPToken(now, "stranger@example.com", nil, nil)
	expectStatus(t, env.Admin("GET", "/me", tu.Auth{IAP: stranger}, nil), 401)
	expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{IAP: stranger}, nil), 401)
	if got := auditActions(t, env, "stranger@example.com"); strings.Join(got, "|") != `auth.login_failed {"reason":"unknown","via":"iap"}` {
		t.Fatalf("audit %v", got)
	}

	// A disabled operator.
	expectStatus(t, env.Admin("PATCH", "/operators/"+op.ID, tu.Auth{Token: owner}, jsobj.New("disabled", true)), 200)
	expectStatus(t, env.Admin("GET", "/me", tu.Auth{IAP: tu.IAPToken(now, op.Email, nil, nil)}, nil), 401)
}

func TestIAPIsOffUnlessConfigured(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	op := env.CreateOperator(env.OwnerToken(), "owner", nil)
	assertion := tu.IAPToken(env.Clock.Now(), op.Email, nil, nil)
	expectStatus(t, env.Admin("GET", "/me", tu.Auth{IAP: assertion}, nil), 401)
	expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{IAP: assertion}, nil), 401)
	// The doctor notices requests coming through IAP.
	doctor := expectStatus(t, env.Admin("GET", "/doctor", tu.Auth{Session: op.Session, IAP: assertion}, nil), 200)
	if c := findCheck(t, doctor, "iap"); c == nil || c["status"] != "info" {
		t.Fatalf("%s", doctor.Body)
	}
	if c := findCheck(t, expectStatus(t, env.Admin("GET", "/doctor", tu.Auth{Session: op.Session}, nil), 200), "iap"); c != nil {
		t.Fatalf("iap check without IAP: %v", c)
	}
}

func TestIAPComesAfterSessionsAndTokens(t *testing.T) {
	env := tu.Start(t, tu.Options{IAP: true})
	owner := env.OwnerToken()
	a := env.CreateOperator(owner, "viewer", nil)
	b := env.CreateOperator(owner, "admin", nil)
	assertion := tu.IAPToken(env.Clock.Now(), b.Email, nil, nil)
	res := expectStatus(t, env.Admin("GET", "/me", tu.Auth{Session: a.Session, IAP: assertion}, nil), 200)
	if res.Get(t, "operator", "email") != a.Email {
		t.Fatalf("%s", res.Body)
	}
	res = expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{Session: a.Session, IAP: assertion}, nil), 200)
	if res.Get(t, "operator", "email") != a.Email || res.Get(t, "session") != "full" {
		t.Fatalf("%s", res.Body)
	}
	token := env.CreateToken(t, a.Session, "read")
	res = expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: token, IAP: assertion}, nil), 200)
	if res.Get(t, "via") != "token" || res.Get(t, "operator", "email") != a.Email {
		t.Fatalf("%s", res.Body)
	}
	// A bad token isn't rescued by IAP.
	expectStatus(t, env.Admin("GET", "/me", tu.Auth{Token: "pat_nope", IAP: assertion}, nil), 401)
}

func TestIAPAndRequiredTwoStepSignIn(t *testing.T) {
	env := tu.Start(t, tu.Options{IAP: true})
	owner := env.CreateOperator(env.OwnerToken(), "owner", nil)
	enrollTOTP(t, env, owner.Session)
	expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: owner.Session}, jsobj.New("require_totp", true)), 200)
	dev := env.CreateOperator(env.OwnerToken(), "developer", nil)
	// With a password session, the developer must enroll first.
	if res := env.Admin("GET", "/apps", tu.Auth{Session: dev.Session}, nil); res.Status != 403 || code(t, res) != "totp_enrollment_required" {
		t.Fatalf("%d %s", res.Status, res.Body)
	}
	// Signed in by IAP, the Google account's two-step verification applies instead.
	assertion := tu.IAPToken(env.Clock.Now(), dev.Email, nil, nil)
	expectStatus(t, env.Admin("GET", "/apps", tu.Auth{IAP: assertion}, nil), 200)
	if me := expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{IAP: assertion}, nil), 200); me.Get(t, "totp_enrollment_required") != false {
		t.Fatalf("%s", me.Body)
	}
}

// IAP's assertion never signs anyone in outside the admin API.
func TestIAPDoesNotCoverOtherPaths(t *testing.T) {
	env := tu.Start(t, tu.Options{IAP: true})
	op := env.CreateOperator(env.OwnerToken(), "owner", nil)
	assertion := tu.IAPToken(env.Clock.Now(), op.Email, nil, nil)
	for _, c := range []struct{ method, path string }{
		{"POST", "/mcp"},
		{"GET", "/v1/subscribers/someone"},
		{"POST", "/notifications/google"},
		{"POST", "/oauth/token"},
	} {
		req, _ := http.NewRequest(c.method, env.Server.URL+c.path, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Goog-Iap-Jwt-Assertion", assertion)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode < 400 {
			t.Fatalf("%s %s: %d %s", c.method, c.path, res.StatusCode, body)
		}
	}
}

func TestIAPDoctorCheck(t *testing.T) {
	env := tu.Start(t, tu.Options{IAP: true})
	op := env.CreateOperator(env.OwnerToken(), "owner", nil)
	now := env.Clock.Now()
	for _, c := range []struct {
		assertion, status, contains string
	}{
		{tu.IAPToken(now, op.Email, nil, nil), "ok", "signed this request in as " + op.Email},
		{tu.IAPToken(now, "stranger@example.com", nil, nil), "warn", "isn't an active operator"},
		{tu.IAPToken(now, op.Email, tu.IAPClaims{"aud": "/projects/1/global/backendServices/2"}, nil), "fail", "unexpected audience"},
		{"", "info", tu.IAPAudience},
	} {
		doctor := expectStatus(t, env.Admin("GET", "/doctor", tu.Auth{Session: op.Session, IAP: c.assertion}, nil), 200)
		check := findCheck(t, doctor, "iap")
		if check == nil || check["status"] != c.status || !strings.Contains(check["message"].(string), c.contains) {
			t.Fatalf("%v", check)
		}
	}
}

func findCheck(t *testing.T, doctor *tu.Response, id string) map[string]any {
	t.Helper()
	list, _ := doctor.Get(t, "checks").([]any)
	for _, c := range list {
		o := c.(*jsobj.Object)
		if v, _ := o.Get("id"); v == id {
			m := map[string]any{}
			for _, k := range o.Keys() {
				m[k], _ = o.Get(k)
			}
			return m
		}
	}
	return nil
}

// The custom domain is the contract: a Cloud Run address as the SDK URL is a warning.
func TestDoctorWarnsAboutACloudRunSDKURL(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	op := env.CreateOperator(env.OwnerToken(), "owner", nil)
	expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: op.Session}, jsobj.New("sdk_url", "https://openpurr-abc123-uc.a.run.app")), 200)
	check := findCheck(t, expectStatus(t, env.Admin("GET", "/doctor", tu.Auth{Session: op.Session}, nil), 200), "sdk-url")
	if check == nil || check["status"] != "warn" {
		t.Fatalf("%v", check)
	}
	expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: op.Session}, jsobj.New("sdk_url", "https://purchases.example.com")), 200)
	check = findCheck(t, expectStatus(t, env.Admin("GET", "/doctor", tu.Auth{Session: op.Session}, nil), 200), "sdk-url")
	if check == nil || check["status"] != "ok" {
		t.Fatalf("%v", check)
	}
}
