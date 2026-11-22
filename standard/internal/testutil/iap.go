package testutil

// Identity-Aware Proxy for tests: a key pair standing in for IAP's, a fake www.gstatic.com serving
// its public half as a JWK set, and assertions signed with it.

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
)

const (
	// IAPAudience is the tests' IAP_AUDIENCE.
	IAPAudience = "/projects/123456789/global/backendServices/987654321"
	IAPKid      = "test-iap-kid"
)

var iapKeys struct {
	once sync.Once
	key  *ecdsa.PrivateKey
}

// IAPKey is the private key the fake IAP signs with.
func IAPKey() *ecdsa.PrivateKey {
	iapKeys.once.Do(func() {
		k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			panic(err)
		}
		iapKeys.key = k
	})
	return iapKeys.key
}

// IAPJWKS is a JWK set with the public half of key under kid.
func IAPJWKS(key *ecdsa.PrivateKey, kid string) map[string]any {
	raw, err := key.PublicKey.Bytes() // 0x04 || X || Y
	if err != nil {
		panic(err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	return map[string]any{"keys": []any{map[string]any{
		"kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": kid,
		"x": enc(raw[1:33]), "y": enc(raw[33:]),
	}}}
}

// FakeIAP serves IAP's key set at /www.gstatic.com/iap/verify/public_key-jwk (the path the
// outbound client's conformance rewrite produces).
type FakeIAP struct {
	Server  *httptest.Server
	Fetches atomic.Int32

	mu   sync.Mutex
	jwks map[string]any
}

// NewFakeIAP starts a fake serving IAPKey under IAPKid.
func NewFakeIAP(t interface{ Cleanup(func()) }) *FakeIAP {
	f := &FakeIAP{jwks: IAPJWKS(IAPKey(), IAPKid)}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/www.gstatic.com/iap/verify/public_key-jwk" {
			http.NotFound(w, r)
			return
		}
		f.Fetches.Add(1)
		f.mu.Lock()
		body, _ := json.Marshal(f.jwks)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_, _ = w.Write(body)
	}))
	t.Cleanup(f.Server.Close)
	return f
}

// SetKeys replaces the key set served.
func (f *FakeIAP) SetKeys(jwks map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.jwks = jwks
}

// IAPClaims are an assertion's claims; nil values are left out.
type IAPClaims map[string]any

// IAPToken signs an assertion for email at nowMs (epoch ms) for IAPAudience with IAPKey, with
// changes from override (a nil value removes the claim) and header changes from headerOverride.
func IAPToken(nowMs int64, email string, override IAPClaims, headerOverride map[string]any) string {
	return SignIAP(IAPKey(), nowMs, email, override, headerOverride)
}

// SignIAP is IAPToken with another key.
func SignIAP(key *ecdsa.PrivateKey, nowMs int64, email string, override IAPClaims, headerOverride map[string]any) string {
	s := nowMs / 1000
	claims := map[string]any{
		"iss": "https://cloud.google.com/iap", "aud": IAPAudience, "iat": s, "exp": s + 600,
		"sub": "accounts.google.com:1234567890", "email": email, "hd": "example.com",
	}
	for k, v := range override {
		if v == nil {
			delete(claims, k)
		} else {
			claims[k] = v
		}
	}
	header := map[string]any{"alg": "ES256", "typ": "JWT", "kid": IAPKid}
	for k, v := range headerOverride {
		header[k] = v
	}
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	enc := base64.RawURLEncoding.EncodeToString
	signing := enc(h) + "." + enc(c)
	digest := sha256.Sum256([]byte(signing))
	r, sv, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		panic(err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	sv.FillBytes(sig[32:])
	return signing + "." + enc(sig)
}
