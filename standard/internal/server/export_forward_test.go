package server_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

const forwardSecret = "forward-secret-0123456789abcdef0123"

// A request Lite forwards (lite/src/lib/forward.ts) is answered as if this server were at the
// address the client called, with the client's IP; only with the shared secret.
func TestForwardedRequests(t *testing.T) {
	env := tu.Start(t, tu.Options{ForwardSecret: forwardSecret})
	login := func(secret string) int {
		req, _ := http.NewRequest("POST", env.Server.URL+"/admin/v1/auth/login", strings.NewReader(`{"email":"nobody@example.com","password":"wrong password here"}`))
		req.Header.Set("Content-Type", "application/json")
		// The dashboard's origin is Lite's back office, not this server.
		req.Header.Set("Origin", "https://office.example.com")
		req.Header.Set("CF-Connecting-IP", "198.51.100.1")
		req.Header.Set("X-Openpurr-Forwarded", secret)
		req.Header.Set("X-Openpurr-Origin", "https://office.example.com")
		req.Header.Set("X-Openpurr-Client-IP", "203.0.113.7")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if status := login("not the secret"); status != 403 {
		t.Fatalf("wrong secret: %d, want the same-origin check's 403", status)
	}
	if env.Count("audit_log") != 0 {
		t.Fatal("audited a refused request")
	}
	if status := login(forwardSecret); status != 401 {
		t.Fatalf("forwarded: %d, want 401 (unknown email)", status)
	}
	var ip string
	env.QueryRow("SELECT ip FROM audit_log WHERE action = 'auth.login_failed'", nil, &ip)
	if ip != "203.0.113.7" {
		t.Fatalf("audit ip %q", ip)
	}

	// Without FORWARD_SECRET nothing is trusted.
	plain := tu.Start(t, tu.Options{})
	req, _ := http.NewRequest("GET", plain.Server.URL+"/.well-known/oauth-authorization-server", nil)
	req.Header.Set("X-Openpurr-Forwarded", "")
	req.Header.Set("X-Openpurr-Origin", "https://evil.example")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var body strings.Builder
	buf := make([]byte, 4096)
	n, _ := res.Body.Read(buf)
	body.Write(buf[:n])
	res.Body.Close()
	if strings.Contains(body.String(), "evil.example") {
		t.Fatalf("trusted an unsigned origin: %s", body.String())
	}

	// The OAuth issuer is the address the client called.
	req, _ = http.NewRequest("GET", env.Server.URL+"/.well-known/oauth-authorization-server", nil)
	req.Header.Set("X-Openpurr-Forwarded", forwardSecret)
	req.Header.Set("X-Openpurr-Origin", "https://office.example.com")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	n, _ = res.Body.Read(buf)
	res.Body.Close()
	if !strings.Contains(string(buf[:n]), `"issuer":"https://office.example.com"`) {
		t.Fatalf("issuer: %s", buf[:n])
	}
}

func TestExportAPI(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()
	env.PostAppleTransaction("exp_a", nil)
	env.PostAppleTransaction("exp_b", nil)
	env.PostAppleTransaction("exp_c", nil)

	admin := env.CreateOperator(owner, "admin", nil)
	if r := env.Admin("GET", "/export", tu.Auth{Session: admin.Session}, nil); r.Status != 403 {
		t.Fatalf("admin: %d", r.Status)
	}
	info := env.Admin("GET", "/export", tu.Auth{Token: owner}, nil)
	if info.Status != 200 || info.Get(t, "edition") != "standard" || info.Get(t, "format") != "openpurr-export" || info.Get(t, "schema") == nil {
		t.Fatalf("%d %s", info.Status, info.Body)
	}
	if r := env.Admin("POST", "/export", tu.Auth{Token: owner}, jsobj.New("since", 5.0)); r.Status != 200 {
		t.Fatal(r.Status)
	}
	var action string
	env.QueryRow("SELECT action FROM audit_log ORDER BY id DESC LIMIT 1", nil, &action)
	if action != "data.exported" {
		t.Fatal(action)
	}

	// Paged in key order; the cursor round-trips.
	var names []string
	after := ""
	for i := 0; i < 10; i++ {
		q := url.Values{"limit": {"2"}}
		if after != "" {
			q.Set("after", after)
		}
		r := env.Admin("GET", "/export/tables/customer_alias?"+q.Encode(), tu.Auth{Token: owner}, nil)
		if r.Status != 200 {
			t.Fatalf("%d %s", r.Status, r.Body)
		}
		for _, row := range r.Get(t, "rows").([]any) {
			v, _ := jsobj.Prop(row, "app_user_id")
			names = append(names, v.(string))
		}
		next := r.Get(t, "next")
		if next == nil {
			break
		}
		after = jsobj.Stringify(next)
	}
	if strings.Join(names, ",") != "exp_a,exp_b,exp_c" {
		t.Fatal(names)
	}
	r := env.Admin("GET", "/export/tables/store_transaction?limit=1", tu.Auth{Token: owner}, nil)
	if next, _ := r.Get(t, "next").([]any); len(next) != 1 {
		t.Fatalf("%s", r.Body)
	}
	cursor := jsobj.Stringify(r.Get(t, "next"))
	if r := env.Admin("GET", "/export/tables/store_transaction?limit=5&after="+url.QueryEscape(cursor), tu.Auth{Token: owner}, nil); len(r.Get(t, "rows").([]any)) != 2 {
		t.Fatalf("%s", r.Body)
	}
	if r := env.Admin("GET", "/export/tables/nope", tu.Auth{Token: owner}, nil); r.Status != 404 {
		t.Fatal(r.Status)
	}
	if r := env.Admin("GET", "/export/tables/store_transaction?customers=x", tu.Auth{Token: owner}, nil); r.Status != 400 {
		t.Fatal(r.Status)
	}
	if r := env.Admin("GET", "/export/tables/job_state?since=1", tu.Auth{Token: owner}, nil); r.Status != 200 || len(r.Get(t, "rows").([]any)) != 0 {
		t.Fatalf("%s", r.Body)
	}

	// CustomerInfo by customer ID, as the SDK sees it but at the given time.
	id := env.CustomerID("default", "exp_b")
	at := tu.T0 + 10*tu.Day
	ci := env.Admin("GET", "/export/customer-info?ids="+id+",unknown&at="+jsobj.FormatNumber(float64(at)), tu.Auth{Token: owner}, nil)
	list := ci.Get(t, "customers").([]any)
	if ci.Status != 200 || len(list) != 1 {
		t.Fatalf("%d %s", ci.Status, ci.Body)
	}
	got, _ := jsobj.Prop(list[0], "customer_info")
	env.Clock.Store(at)
	sdk := env.Call("/v1/subscribers/exp_b", tu.CallOptions{}).JSON(t).(*jsobj.Object)
	for _, body := range []*jsobj.Object{got.(*jsobj.Object), sdk} {
		sub, _ := body.Get("subscriber")
		sub.(*jsobj.Object).Delete("management_url")
	}
	if jsobj.Stringify(got) != jsobj.Stringify(sdk) {
		t.Fatalf("export:\n%s\nSDK:\n%s", jsobj.Stringify(got), jsobj.Stringify(sdk))
	}
}
