package google

// The service-account assertion (lite/test/store-tokens.test.ts), access-token caching, the
// Play Developer API client's requests and errors, and ID token verification.

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/outbound"
)

const now = int64(1_800_000_000_000)

func decodeJWT(t *testing.T, jwt string) (header, claims any, input string, sig []byte) {
	t.Helper()
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatalf("not a JWT: %s", jwt)
	}
	dec := func(s string) []byte {
		b, err := base64.RawURLEncoding.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	header, _ = jsobj.Parse(dec(parts[0]))
	claims, _ = jsobj.Parse(dec(parts[1]))
	return header, claims, parts[0] + "." + parts[1], dec(parts[2])
}

func TestServiceAccountAssertion(t *testing.T) {
	sa := testServiceAccount(t)
	jwt, err := NewTokens(func() int64 { return now }).MintAssertion(sa)
	if err != nil {
		t.Fatal(err)
	}
	header, claims, input, sig := decodeJWT(t, jwt)
	if jsobj.Stringify(header) != `{"alg":"RS256","typ":"JWT"}` {
		t.Errorf("header %s", jsobj.Stringify(header))
	}
	want := `{"iss":"openpurr-test@test-project.iam.gserviceaccount.com","scope":"https://www.googleapis.com/auth/androidpublisher",` +
		`"aud":"https://oauth2.googleapis.com/token","iat":1800000000,"exp":1800003600}`
	if jsobj.Stringify(claims) != want {
		t.Errorf("claims %s", jsobj.Stringify(claims))
	}
	key, _ := ParseRSAKey(sa.PrivateKeyPEM)
	digest := sha256.Sum256([]byte(input))
	if err := rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, digest[:], sig); err != nil {
		t.Error(err)
	}
	if _, err := ParseRSAKey("not a key"); err == nil {
		t.Error("parsed garbage")
	}
}

// fakeAPI is a Play Developer API answering every request with handler, plus the token endpoint.
func fakeAPI(t *testing.T, handler http.HandlerFunc) (*Client, *atomic.Int32, *int64) {
	t.Helper()
	var exchanges atomic.Int32
	clock := now
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/oauth2.googleapis.com/token") {
			exchanges.Add(1)
			_ = r.ParseForm()
			if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" || r.Form.Get("assertion") == "" {
				w.WriteHeader(400)
				return
			}
			_, _ = io.WriteString(w, `{"access_token":"ya29.n`+jsobj.FormatNumber(float64(exchanges.Load()))+`","expires_in":3600}`)
			return
		}
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	return NewClient(testServiceAccount(t), "com.example.openpurr", outbound.NewClient(srv.URL), NewTokens(func() int64 { return clock })), &exchanges, &clock
}

func TestClient(t *testing.T) {
	t.Run("sends the access token, escapes path segments, and reuses the token until two minutes before expiry", func(t *testing.T) {
		var paths, auths []string
		client, exchanges, clock := fakeAPI(t, func(w http.ResponseWriter, r *http.Request) {
			paths = append(paths, r.URL.EscapedPath()+"?"+r.URL.RawQuery)
			auths = append(auths, r.Header.Get("Authorization"))
			_, _ = io.WriteString(w, `{}`)
		})
		ctx := context.Background()
		if _, err := client.Subscription(ctx, "tok/1 x"); err != nil {
			t.Fatal(err)
		}
		if err := client.AcknowledgeProduct(ctx, "life time", "t"); err != nil {
			t.Fatal(err)
		}
		*clock += 3600_000 - 121_000
		if _, err := client.Voided(ctx, 1234); err != nil {
			t.Fatal(err)
		}
		*clock += 2_000
		if _, err := client.Order(ctx, "GPA.1"); err != nil {
			t.Fatal(err)
		}
		const base = "/androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.openpurr"
		want := []string{
			base + "/purchases/subscriptionsv2/tokens/tok%2F1%20x?",
			base + "/purchases/products/life%20time/tokens/t:acknowledge?",
			base + "/purchases/voidedpurchases?startTime=1234&type=1&maxResults=1000",
			base + "/orders/GPA.1?",
		}
		if strings.Join(paths, "\n") != strings.Join(want, "\n") {
			t.Errorf("%v", paths)
		}
		if exchanges.Load() != 2 || auths[2] != "Bearer ya29.n1" || auths[3] != "Bearer ya29.n2" {
			t.Errorf("%d exchanges, %v", exchanges.Load(), auths)
		}
	})

	t.Run("errors carry Google's message and status", func(t *testing.T) {
		status := 404
		body := `{"error":{"code":404,"message":"The purchase token was not found."}}`
		client, _, _ := fakeAPI(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = io.WriteString(w, body)
		})
		_, err := client.Subscription(context.Background(), "x")
		var apiErr *APIError
		if !errors.As(err, &apiErr) || !apiErr.NotFound() || apiErr.Retryable() || err.Error() != "Google Play Developer API 404: The purchase token was not found." {
			t.Errorf("%v", err)
		}
		status, body = 410, ""
		if _, err := client.Subscription(context.Background(), "x"); !errors.As(err, &apiErr) || !apiErr.NotFound() ||
			err.Error() != "Google Play Developer API 410: GET /purchases/subscriptionsv2/tokens/x" {
			t.Errorf("%v", err)
		}
		status = 429
		if _, err := client.Subscription(context.Background(), "x"); !errors.As(err, &apiErr) || !apiErr.Retryable() {
			t.Errorf("%v", err)
		}
		status, body = 200, "not json"
		if _, err := client.Subscription(context.Background(), "x"); err == nil || errors.As(err, &apiErr) {
			t.Errorf("%v", err)
		}
	})

	t.Run("a failed token exchange is an error, not an API error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
		defer srv.Close()
		client := NewClient(testServiceAccount(t), "p", outbound.NewClient(srv.URL), NewTokens(func() int64 { return now }))
		_, err := client.Subscription(context.Background(), "x")
		var apiErr *APIError
		if err == nil || errors.As(err, &apiErr) || err.Error() != "Google token exchange failed: 401" {
			t.Errorf("%v", err)
		}
	})
}

// --- ID tokens -------------------------------------------------------------------------------------

type signer struct {
	key *rsa.PrivateKey
	kid string
}

func newSigner(t *testing.T) *signer {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return &signer{key: key, kid: "kid-1"}
}

func (s *signer) jwks() string {
	b64 := base64.RawURLEncoding.EncodeToString
	return jsobj.Stringify(jsobj.New("keys", []any{
		jsobj.New("kid", "ec-key", "kty", "EC"),
		jsobj.New("kid", s.kid, "kty", "RSA", "alg", "RS256", "n", b64(s.key.N.Bytes()), "e", b64(big.NewInt(int64(s.key.E)).Bytes())),
	}))
}

func (s *signer) token(t *testing.T, header, claims *jsobj.Object) string {
	t.Helper()
	tok, err := SignRS256(s.key, header, claims)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func claimsAt(secs float64) *jsobj.Object {
	return jsobj.New("iss", "https://accounts.google.com", "aud", "https://push.example/notifications/google",
		"email", "push@p.iam.gserviceaccount.com", "email_verified", true, "iat", secs, "exp", secs+3600)
}

func TestVerifyIDToken(t *testing.T) {
	s := newSigner(t)
	var fetches atomic.Int32
	keyStatus := 200
	cacheControl := "public, max-age=600"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/www.googleapis.com/oauth2/v3/certs" {
			w.WriteHeader(404)
			return
		}
		fetches.Add(1)
		w.Header().Set("Cache-Control", cacheControl)
		w.WriteHeader(keyStatus)
		_, _ = io.WriteString(w, s.jwks())
	}))
	defer srv.Close()
	clock := now
	keys := NewKeys(func() int64 { return clock }, outbound.NewClient(srv.URL))
	auds := []string{"https://push.example/notifications/google"}
	header := jsobj.New("alg", "RS256", "kid", "kid-1", "typ", "JWT")
	secs := float64(now / 1000)
	ctx := context.Background()

	claims, err := keys.Verify(ctx, s.token(t, header, claimsAt(secs)), auds)
	if err != nil || jsobj.Stringify(claims) != jsobj.Stringify(claimsAt(secs)) {
		t.Fatalf("%v %s", err, jsobj.Stringify(claims))
	}

	with := func(k string, v any) *jsobj.Object {
		c := claimsAt(secs)
		if v == nil {
			c.Delete(k)
		} else {
			c.Set(k, v)
		}
		return c
	}
	good := s.token(t, header, claimsAt(secs))
	parts := strings.Split(good, ".")
	other := newSigner(t)
	cases := []struct{ token, msg string }{
		{"a.b", "Not a JWT"},
		{"%%%." + parts[1] + "." + parts[2], "Malformed JWT"},
		{parts[0] + "." + parts[1] + ".%%%", "Malformed JWT"},
		{parts[0] + "." + parts[1] + ".AAAA", "Bad token signature"},
		{s.token(t, jsobj.New("alg", "HS256", "kid", "kid-1"), claimsAt(secs)), "Unexpected token algorithm HS256"},
		{s.token(t, jsobj.New("alg", "RS256"), claimsAt(secs)), "Unexpected token algorithm RS256"},
		{s.token(t, jsobj.New("kid", "kid-1"), claimsAt(secs)), "Unexpected token algorithm undefined"},
		{other.token(t, header, claimsAt(secs)), "Bad token signature"},
		{s.token(t, header, with("iss", "https://evil.example")), "Unexpected issuer https://evil.example"},
		{s.token(t, header, with("iss", nil)), "Unexpected issuer undefined"},
		{s.token(t, header, with("iss", "accounts.google.com")), ""},
		{s.token(t, header, with("exp", secs-301)), "Token expired"},
		{s.token(t, header, with("exp", secs-300)), ""},
		{s.token(t, header, with("exp", "later")), "Token expired"},
		{s.token(t, header, with("aud", "https://elsewhere.example")), "Unexpected audience https://elsewhere.example"},
		{s.token(t, header, with("aud", []any{auds[0]})), "Unexpected audience https://push.example/notifications/google"},
		{s.token(t, header, with("email_verified", "true")), "Token email isn't verified"},
		{s.token(t, header, with("email_verified", nil)), "Token email isn't verified"},
	}
	for _, c := range cases {
		_, err := keys.Verify(ctx, c.token, auds)
		got := ""
		if err != nil {
			if !IsIDTokenError(err) {
				t.Errorf("%s: not an IDTokenError: %v", c.msg, err)
			}
			got = err.Error()
		}
		if got != c.msg {
			t.Errorf("got %q, want %q", got, c.msg)
		}
	}
	if fetches.Load() != 1 {
		t.Errorf("%d key fetches", fetches.Load())
	}

	// An unknown kid refetches once; a number kid never matches.
	for _, kid := range []any{"rotated", 7.0} {
		before := fetches.Load()
		_, err := keys.Verify(ctx, s.token(t, jsobj.New("alg", "RS256", "kid", kid), claimsAt(secs)), auds)
		if err == nil || err.Error() != "Token signed with an unknown key" || fetches.Load() != before+1 {
			t.Errorf("%v: %v, %d fetches", kid, err, fetches.Load()-before)
		}
	}

	// Keys are kept for Cache-Control's max-age.
	before := fetches.Load()
	clock += 599_000
	if _, err := keys.Verify(ctx, good, auds); err != nil || fetches.Load() != before {
		t.Errorf("%v %d", err, fetches.Load()-before)
	}
	clock += 2_000
	if _, err := keys.Verify(ctx, good, auds); err != nil || fetches.Load() != before+1 {
		t.Errorf("%v %d", err, fetches.Load()-before)
	}

	// Google's keys unavailable: the token can't be checked, so it's refused.
	keys.Forget()
	keyStatus = 503
	if _, err := keys.Verify(ctx, good, auds); !IsIDTokenError(err) || err.Error() != "Couldn't fetch Google's signing keys (503)" {
		t.Errorf("%v", err)
	}

	// A null header is a TypeError in Lite: a 500, not a 401.
	keyStatus = 200
	null := base64.RawURLEncoding.EncodeToString([]byte("null"))
	if _, err := keys.Verify(ctx, null+"."+parts[1]+"."+parts[2], auds); err == nil || IsIDTokenError(err) {
		t.Errorf("%v", err)
	}
}
