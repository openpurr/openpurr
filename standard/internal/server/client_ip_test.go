package server_test

import (
	"net/http"
	"strings"
	"testing"

	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// The client IP (rate limits, the audit log) behind proxies that append to X-Forwarded-For, such
// as Google's front ends: only the entries they add can be believed.
func TestClientIPFromTheEndOfXForwardedFor(t *testing.T) {
	cases := []struct {
		hops    int
		headers []string
		want    string
	}{
		{0, []string{"203.0.113.7, 198.51.100.1"}, "203.0.113.7"},
		{1, []string{"203.0.113.7"}, "203.0.113.7"},
		{1, []string{"6.6.6.6, 203.0.113.7"}, "203.0.113.7"},
		{2, []string{"6.6.6.6,203.0.113.7, 34.120.0.1"}, "203.0.113.7"},
		{2, []string{"6.6.6.6", "203.0.113.7, 34.120.0.1"}, "203.0.113.7"},
		{2, []string{"203.0.113.7"}, "127.0.0.1"}, // didn't come through both proxies
		{1, nil, "127.0.0.1"},
	}
	for _, c := range cases {
		env := tu.Start(t, tu.Options{ClientIPHeader: "X-Forwarded-For", ClientIPHops: c.hops})
		req, _ := http.NewRequest("POST", env.Server.URL+"/admin/v1/auth/login", strings.NewReader(`{"email":"nobody@example.com","password":"wrong password here"}`))
		req.Header.Set("Origin", env.Server.URL)
		req.Header.Set("Content-Type", "application/json")
		for _, h := range c.headers {
			req.Header.Add("X-Forwarded-For", h)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		var ip string
		env.QueryRow("SELECT ip FROM audit_log WHERE action = 'auth.login_failed'", nil, &ip)
		if ip != c.want {
			t.Errorf("hops %d, %q: got %q, want %q", c.hops, c.headers, ip, c.want)
		}
	}
}
