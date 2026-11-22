package iap_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/iap"
	"github.com/openpurr/openpurr/standard/internal/outbound"
	"github.com/openpurr/openpurr/standard/internal/testutil"
)

const t0 = testutil.T0

func setup(t *testing.T) (*iap.Verifier, *testutil.FakeIAP, *clock.Fixed) {
	fake := testutil.NewFakeIAP(t)
	clk := clock.NewFixed(t0)
	return iap.New([]string{testutil.IAPAudience}, clk.Now, outbound.NewClient(fake.Server.URL)), fake, clk
}

func TestVerifiesAGoodAssertion(t *testing.T) {
	v, fake, _ := setup(t)
	id, err := v.Verify(context.Background(), testutil.IAPToken(t0, "Owner@Example.com", nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	if id.Email != "owner@example.com" || id.Subject != "accounts.google.com:1234567890" {
		t.Fatalf("identity: %+v", id)
	}
	// The keys are cached.
	for range 3 {
		if _, err := v.Verify(context.Background(), testutil.IAPToken(t0, "owner@example.com", nil, nil)); err != nil {
			t.Fatal(err)
		}
	}
	if n := fake.Fetches.Load(); n != 1 {
		t.Fatalf("fetched the keys %d times", n)
	}
}

func TestRefusesBadAssertions(t *testing.T) {
	v, _, _ := setup(t)
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	good := testutil.IAPToken(t0, "owner@example.com", nil, nil)
	parts := strings.Split(good, ".")
	cases := map[string]string{
		"not a JWT":            "abc",
		"malformed":            "a.b.c",
		"wrong algorithm":      testutil.IAPToken(t0, "owner@example.com", nil, map[string]any{"alg": "RS256"}),
		"no algorithm":         testutil.IAPToken(t0, "owner@example.com", nil, map[string]any{"alg": "none"}),
		"no kid":               testutil.IAPToken(t0, "owner@example.com", nil, map[string]any{"kid": ""}),
		"unknown kid":          testutil.IAPToken(t0, "owner@example.com", nil, map[string]any{"kid": "other"}),
		"signed by another":    testutil.SignIAP(other, t0, "owner@example.com", nil, nil),
		"claims changed":       parts[0] + "." + strings.Split(testutil.IAPToken(t0, "attacker@example.com", nil, nil), ".")[1] + "." + parts[2],
		"no signature":         parts[0] + "." + parts[1] + ".",
		"wrong issuer":         testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"iss": "https://accounts.google.com"}, nil),
		"no issuer":            testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"iss": nil}, nil),
		"wrong audience":       testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"aud": "/projects/1/global/backendServices/2"}, nil),
		"audience list":        testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"aud": []string{testutil.IAPAudience}}, nil),
		"expired":              testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"exp": t0/1000 - 31}, nil),
		"no expiry":            testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"exp": nil}, nil),
		"issued in the future": testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"iat": t0/1000 + 31}, nil),
		"no iat":               testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"iat": nil}, nil),
		"no email":             testutil.IAPToken(t0, "owner@example.com", testutil.IAPClaims{"email": nil}, nil),
		"identity platform":    testutil.IAPToken(t0, "securetoken.google.com/p/t:owner@example.com", nil, nil),
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := v.Verify(context.Background(), token)
			if err == nil || !iap.IsInvalid(err) {
				t.Fatalf("want an invalid assertion, got %v", err)
			}
		})
	}
}

func TestAllowsThirtySecondsOfSkew(t *testing.T) {
	v, _, _ := setup(t)
	for _, c := range []testutil.IAPClaims{{"exp": t0/1000 - 29}, {"iat": t0/1000 + 29}} {
		if _, err := v.Verify(context.Background(), testutil.IAPToken(t0, "owner@example.com", c, nil)); err != nil {
			t.Fatalf("%v: %v", c, err)
		}
	}
}

func TestRefetchesForANewKeyAtMostOnceAMinute(t *testing.T) {
	v, fake, clk := setup(t)
	if _, err := v.Verify(context.Background(), testutil.IAPToken(t0, "owner@example.com", nil, nil)); err != nil {
		t.Fatal(err)
	}
	// Google rotates: a new key appears.
	rotated, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	fake.SetKeys(testutil.IAPJWKS(rotated, "new-kid"))
	token := testutil.SignIAP(rotated, t0, "owner@example.com", nil, map[string]any{"kid": "new-kid"})
	// Within a minute of the last fetch, an unknown key isn't fetched for.
	if _, err := v.Verify(context.Background(), token); !iap.IsInvalid(err) {
		t.Fatalf("want unknown key, got %v", err)
	}
	if n := fake.Fetches.Load(); n != 1 {
		t.Fatalf("fetched %d times", n)
	}
	clk.Add(60_000)
	if _, err := v.Verify(context.Background(), testutil.SignIAP(rotated, t0+60_000, "owner@example.com", nil, map[string]any{"kid": "new-kid"})); err != nil {
		t.Fatal(err)
	}
	if n := fake.Fetches.Load(); n != 2 {
		t.Fatalf("fetched %d times", n)
	}
	// Made-up key IDs don't cause more fetches within the minute.
	for range 5 {
		_, _ = v.Verify(context.Background(), testutil.SignIAP(rotated, t0+60_000, "owner@example.com", nil, map[string]any{"kid": "made-up"}))
	}
	if n := fake.Fetches.Load(); n != 2 {
		t.Fatalf("fetched %d times", n)
	}
	// The cache expires with Cache-Control's max-age.
	clk.Add(3600_000)
	if _, err := v.Verify(context.Background(), testutil.SignIAP(rotated, t0+3660_000, "owner@example.com", nil, map[string]any{"kid": "new-kid"})); err != nil {
		t.Fatal(err)
	}
	if n := fake.Fetches.Load(); n != 3 {
		t.Fatalf("fetched %d times", n)
	}
}

func TestKeysUnreachableIsNotAnInvalidToken(t *testing.T) {
	fake := testutil.NewFakeIAP(t)
	fake.Server.Close()
	v := iap.New([]string{testutil.IAPAudience}, clock.NewFixed(t0).Now, outbound.NewClient(fake.Server.URL))
	_, err := v.Verify(context.Background(), testutil.IAPToken(t0, "owner@example.com", nil, nil))
	if err == nil || iap.IsInvalid(err) {
		t.Fatalf("want a fetch error, got %v", err)
	}
}

func TestParseAudiences(t *testing.T) {
	got, err := iap.ParseAudiences(" /projects/1/global/backendServices/2 , /projects/1/locations/us-central1/services/openpurr ")
	if err != nil || len(got) != 2 {
		t.Fatalf("%v %v", got, err)
	}
	for _, bad := range []string{"my-project", "https://purchases.example.com", "/projects/my-project/global/backendServices/2"} {
		if _, err := iap.ParseAudiences(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}
