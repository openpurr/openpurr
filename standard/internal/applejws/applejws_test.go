package applejws_test

// Mirrors lite/test/apple-jws.test.ts.

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

var at = time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()

func roots() [][]byte { return [][]byte{tu.AppleFixtures().RootDER} }

func signed() string {
	return tu.SignJWS(jsobj.New("transactionId", "1", "productId", "pro_monthly"))
}

func tamper(jws string) string {
	p := strings.Split(jws, ".")
	return p[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(`{"productId":"lifetime"}`)) + "." + p[2]
}

func wantError(t *testing.T, err error, msg string) {
	t.Helper()
	if err == nil || !applejws.IsError(err) || (msg != "" && err.Error() != msg) {
		t.Fatalf("got %v, want %q", err, msg)
	}
}

type memoryStore struct {
	rows     map[string]applejws.VerifiedChain
	gets     int
	puts     int
	failNext bool
}

func (m *memoryStore) Get(_ context.Context, fp string) (*applejws.VerifiedChain, error) {
	m.gets++
	if c, ok := m.rows[fp]; ok {
		return &c, nil
	}
	return nil, nil
}

func (m *memoryStore) Put(_ context.Context, fp string, c applejws.VerifiedChain) error {
	m.puts++
	m.rows[fp] = c
	return nil
}

func newStore() *memoryStore { return &memoryStore{rows: map[string]applejws.VerifiedChain{}} }

func TestVerify(t *testing.T) {
	ctx := context.Background()
	jws := signed()

	t.Run("accepts a valid chain and returns the payload, cold and warm", func(t *testing.T) {
		v := applejws.NewVerifier()
		for _, opts := range []applejws.Options{{Roots: roots(), At: at, NoCache: true}, {Roots: roots(), At: at}, {Roots: roots(), At: at}} {
			p, err := v.Verify(ctx, jws, opts)
			if err != nil {
				t.Fatal(err)
			}
			if pid, _ := jsobj.Prop(p, "productId"); pid != "pro_monthly" {
				t.Fatalf("payload %s", jsobj.Stringify(p))
			}
		}
	})

	t.Run("rejects a tampered payload, on the cold and warm paths", func(t *testing.T) {
		v := applejws.NewVerifier()
		_, err := v.Verify(ctx, tamper(jws), applejws.Options{Roots: roots(), At: at, NoCache: true})
		wantError(t, err, "JWS signature invalid")
		_, _ = v.Verify(ctx, jws, applejws.Options{Roots: roots(), At: at})
		_, err = v.Verify(ctx, tamper(jws), applejws.Options{Roots: roots(), At: at})
		wantError(t, err, "JWS signature invalid")
	})

	t.Run("rejects an untrusted root, even when the chain is cached", func(t *testing.T) {
		v := applejws.NewVerifier()
		_, _ = v.Verify(ctx, jws, applejws.Options{Roots: roots(), At: at})
		_, err := v.Verify(ctx, jws, applejws.Options{Roots: [][]byte{{1, 2, 3}}, At: at})
		wantError(t, err, "root certificate is not trusted")
		f := tu.AppleFixtures()
		stray := tu.SignJWSWith(jsobj.New(), f.Stray.X5C, f.Stray.LeafKey)
		_, err = v.Verify(ctx, stray, applejws.Options{Roots: roots(), At: at})
		wantError(t, err, "root certificate is not trusted")
	})

	t.Run("rejects certificates outside their validity period, even when the chain is cached", func(t *testing.T) {
		v := applejws.NewVerifier()
		later := time.Date(2040, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
		_, err := v.Verify(ctx, jws, applejws.Options{Roots: roots(), At: later, NoCache: true})
		wantError(t, err, "certificate not valid at the requested time")
		_, _ = v.Verify(ctx, jws, applejws.Options{Roots: roots(), At: at})
		_, err = v.Verify(ctx, jws, applejws.Options{Roots: roots(), At: later})
		wantError(t, err, "certificate not valid at the requested time")
	})

	t.Run("rejects a leaf without Apple's marker OID", func(t *testing.T) {
		f := tu.AppleFixtures()
		_, err := applejws.NewVerifier().Verify(ctx, tu.SignJWSWith(jsobj.New(), f.X5CLeafWithoutMarker, f.LeafKey), applejws.Options{Roots: roots(), At: at, NoCache: true})
		wantError(t, err, "certificate missing extension 1.2.840.113635.100.6.11.1")
	})

	t.Run("rejects a leaf not signed by the intermediate", func(t *testing.T) {
		f := tu.AppleFixtures()
		_, err := applejws.NewVerifier().Verify(ctx, tu.SignJWSWith(jsobj.New(), f.X5CLeafWrongIssuer, f.LeafKey), applejws.Options{Roots: roots(), At: at, NoCache: true})
		wantError(t, err, "certificate chain signature invalid")
	})

	t.Run("rejects malformed input with a verification error", func(t *testing.T) {
		v := applejws.NewVerifier()
		badX5C := base64.StdEncoding.EncodeToString([]byte(`{"alg":"ES256","x5c":["!!","b","c"]}`))
		for bad, msg := range map[string]string{
			"":                                "not a compact JWS",
			"a.b":                             "not a compact JWS",
			"a.b.c":                           "malformed JWS header",
			badX5C + ".e30.sig":               "x5c entry is not base64",
			"e30.e30.sig":                     "unexpected alg undefined",
			b64(`{"alg":"ES256"}`) + ".e30.x": "x5c must have 3 certificates",
		} {
			_, err := v.Verify(ctx, bad, applejws.Options{Roots: roots(), At: at, NoCache: true})
			wantError(t, err, msg)
		}
		p := strings.Split(jws, ".")
		_, err := v.Verify(ctx, b64(`{"alg":"none"}`)+"."+p[1]+"."+p[2], applejws.Options{Roots: roots(), At: at})
		wantError(t, err, "unexpected alg none")
	})

	t.Run("a signature that isn't base64url is an invalid JWS", func(t *testing.T) {
		p := strings.Split(jws, ".")
		_, err := applejws.NewVerifier().Verify(ctx, p[0]+"."+p[1]+".!!!", applejws.Options{Roots: roots(), At: at})
		wantError(t, err, "malformed JWS signature")
	})
}

func b64(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }

func TestChainStore(t *testing.T) {
	ctx := context.Background()
	jws := signed()

	t.Run("stores a chain after full verification and reuses it from a fresh process", func(t *testing.T) {
		store := newStore()
		opts := applejws.Options{Roots: roots(), At: at, Store: store, NoMemoryCache: true}
		if _, err := applejws.NewVerifier().Verify(ctx, jws, opts); err != nil {
			t.Fatal(err)
		}
		if store.puts != 1 || len(store.rows) != 1 {
			t.Fatalf("puts %d rows %d", store.puts, len(store.rows))
		}
		// The store hit replaces the chain check, so nothing new is written.
		if _, err := applejws.NewVerifier().Verify(ctx, jws, opts); err != nil {
			t.Fatal(err)
		}
		if store.puts != 1 || store.gets != 2 {
			t.Fatalf("puts %d gets %d", store.puts, store.gets)
		}
	})

	t.Run("never stores a chain that failed verification", func(t *testing.T) {
		store := newStore()
		f := tu.AppleFixtures()
		_, err := applejws.NewVerifier().Verify(ctx, tu.SignJWSWith(jsobj.New(), f.X5CLeafWrongIssuer, f.LeafKey),
			applejws.Options{Roots: roots(), At: at, Store: store, NoMemoryCache: true})
		if err == nil || store.puts != 0 {
			t.Fatalf("err %v puts %d", err, store.puts)
		}
	})

	t.Run("still checks the JWS signature and the root on a store hit", func(t *testing.T) {
		store := newStore()
		opts := applejws.Options{Roots: roots(), At: at, Store: store, NoMemoryCache: true}
		_, _ = applejws.NewVerifier().Verify(ctx, jws, opts)
		_, err := applejws.NewVerifier().Verify(ctx, tamper(jws), opts)
		wantError(t, err, "JWS signature invalid")
		_, err = applejws.NewVerifier().Verify(ctx, jws, applejws.Options{Roots: [][]byte{{1}}, At: at, Store: store, NoMemoryCache: true})
		wantError(t, err, "root certificate is not trusted")
	})

	t.Run("works against Postgres", func(t *testing.T) {
		pool := tu.Pool(t)
		store := applejws.PostgresStore(pool, func() int64 { return at })
		opts := applejws.Options{Roots: roots(), At: at, Store: store, NoMemoryCache: true}
		if _, err := applejws.NewVerifier().Verify(ctx, jws, opts); err != nil {
			t.Fatal(err)
		}
		var fp string
		var notBefore, notAfter, verifiedAt int64
		if err := pool.QueryRow(ctx, "SELECT fingerprint, not_before, not_after, verified_at FROM apple_verified_chain").
			Scan(&fp, &notBefore, &notAfter, &verifiedAt); err != nil {
			t.Fatal(err)
		}
		if len(fp) != 64 || notAfter != tu.ChainNotAfter.UnixMilli() || notBefore != tu.ChainNotBefore.UnixMilli() || verifiedAt != at {
			t.Errorf("%s %d %d %d", fp, notBefore, notAfter, verifiedAt)
		}
		if _, err := applejws.NewVerifier().Verify(ctx, jws, opts); err != nil {
			t.Fatal(err)
		}
	})
}

func TestAtob(t *testing.T) {
	for in, want := range map[string]string{"YQ": "a", "YQ==": "a", "Y Q = =": "a", "YWJj": "abc", "YR==": "a"} {
		got, err := applejws.Atob(in)
		if err != nil || string(got) != want {
			t.Errorf("%q: %q %v", in, got, err)
		}
	}
	for _, in := range []string{"Y", "YQ===", "a-b_", "Y=Q="} {
		if _, err := applejws.Atob(in); err == nil {
			t.Errorf("%q should fail", in)
		}
	}
}
