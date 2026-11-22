package google

// Verifies the OIDC ID token Pub/Sub attaches to authenticated push requests:
// "Authorization: Bearer <JWT>", RS256, signed with Google's keys (lite/src/lib/google-oidc.ts).
//
// Checks: RS256 signature against Google's JWKS (https://www.googleapis.com/oauth2/v3/certs, from
// accounts.google.com's OpenID configuration); iss is https://accounts.google.com or
// accounts.google.com; aud is one we expect; exp hasn't passed (allowing a little clock skew);
// email is verified. The caller checks the email is the configured push service account.
// Keys are cached for as long as Google's Cache-Control allows (at most a day), and refetched once
// when a token names a key we haven't seen (Google rotates keys).

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// JWKSURL is where Google publishes the keys that sign its ID tokens.
const JWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

const skewS = 300

// IDTokenError is a push token that isn't valid: the request is answered 401.
type IDTokenError struct{ Msg string }

func (e *IDTokenError) Error() string { return e.Msg }

// IsIDTokenError reports whether err is an IDTokenError.
func IsIDTokenError(err error) bool {
	var e *IDTokenError
	return errors.As(err, &e)
}

// Keys verifies Google ID tokens, caching Google's signing keys.
type Keys struct {
	now  func() int64
	http *http.Client

	mu      sync.Mutex
	loaded  bool
	keys    map[string]*rsa.PublicKey
	expires int64
}

// NewKeys returns a verifier reading the time (epoch ms) from now and fetching keys with httpClient.
func NewKeys(now func() int64, httpClient *http.Client) *Keys {
	return &Keys{now: now, http: httpClient}
}

var maxAgeRE = regexp.MustCompile(`max-age=(\d+)`)

func (k *Keys) load(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, JWKSURL, nil)
	if err != nil {
		return err
	}
	res, err := k.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &IDTokenError{fmt.Sprintf("Couldn't fetch Google's signing keys (%d)", res.StatusCode)}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	body, err := jsobj.Parse(data)
	if err != nil {
		return errors.New("Google's signing keys aren't JSON")
	}
	maxAge := 3600.0
	if m := maxAgeRE.FindStringSubmatch(res.Header.Get("Cache-Control")); m != nil {
		maxAge, _ = strconv.ParseFloat(m[1], 64)
	}
	keys := map[string]*rsa.PublicKey{}
	list, _ := jsobj.Prop(body, "keys")
	items, _ := list.([]any)
	for _, item := range items {
		if kty, _ := jsobj.Prop(item, "kty"); kty != "RSA" {
			continue
		}
		pub, err := rsaKey(item)
		if err != nil {
			return err
		}
		kid, hasKid := jsobj.Prop(item, "kid")
		keys[jsobj.String(kid, hasKid)] = pub
	}
	k.keys = keys
	k.loaded = true
	k.expires = k.now() + int64(math.Min(maxAge, 86_400)*1000)
	return nil
}

// rsaKey is an RSA public key from a JWK's n and e.
func rsaKey(jwk any) (*rsa.PublicKey, error) {
	n, _ := jsobj.Prop(jwk, "n")
	e, _ := jsobj.Prop(jwk, "e")
	ns, nOK := n.(string)
	es, eOK := e.(string)
	if !nOK || !eOK {
		return nil, errors.New("Google published a signing key without n and e")
	}
	nb, err1 := base64.RawURLEncoding.DecodeString(strings.TrimRight(ns, "="))
	eb, err2 := base64.RawURLEncoding.DecodeString(strings.TrimRight(es, "="))
	if err1 != nil || err2 != nil || len(eb) == 0 || len(eb) > 4 {
		return nil, errors.New("Google published a signing key that isn't a valid RSA key")
	}
	exp := 0
	for _, b := range eb {
		exp = exp<<8 | int(b)
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: exp}, nil
}

func (k *Keys) keyFor(ctx context.Context, kid any) (*rsa.PublicKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.loaded || k.expires <= k.now() {
		if err := k.load(ctx); err != nil {
			return nil, err
		}
	}
	// Lite's keys are a Map keyed by the JWK's kid, so only a string kid can match.
	id, isStr := kid.(string)
	if key, ok := k.keys[id]; ok && isStr {
		return key, nil
	}
	// Maybe rotated since we cached.
	if err := k.load(ctx); err != nil {
		return nil, err
	}
	if key, ok := k.keys[id]; ok && isStr {
		return key, nil
	}
	return nil, &IDTokenError{"Token signed with an unknown key"}
}

// Forget drops the cached keys.
func (k *Keys) Forget() {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.loaded = false
	k.keys = nil
}

// decodePart is a token part as JSON (TextDecoder replaces bad UTF-8 instead of failing).
func decodePart(part string) (any, error) {
	b, err := applejws.DecodeBase64URL(part)
	if err != nil {
		return nil, err
	}
	return jsobj.Parse([]byte(string([]rune(string(b)))))
}

var issuers = map[string]bool{"https://accounts.google.com": true, "accounts.google.com": true}

// Verify checks a token's signature, issuer, expiry, audience (one of audiences) and verified
// email, and returns its claims. A bad token is an IDTokenError; anything else (Google's keys
// unreachable) is another error.
func (k *Keys) Verify(ctx context.Context, token string, audiences []string) (any, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, &IDTokenError{"Not a JWT"}
	}
	header, err1 := decodePart(parts[0])
	claims, err2 := decodePart(parts[1])
	signature, err3 := applejws.DecodeBase64URL(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return nil, &IDTokenError{"Malformed JWT"}
	}
	if header == nil {
		// Lite reads header.alg off null and fails with a TypeError.
		return nil, errors.New("Google ID token header is null")
	}
	alg, hasAlg := jsobj.Prop(header, "alg")
	kid, _ := jsobj.Prop(header, "kid")
	if alg != "RS256" || !truthy(kid) {
		return nil, &IDTokenError{"Unexpected token algorithm " + jsobj.String(alg, hasAlg)}
	}
	key, err := k.keyFor(ctx, kid)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature) != nil {
		return nil, &IDTokenError{"Bad token signature"}
	}
	if claims == nil {
		return nil, errors.New("Google ID token claims are null")
	}

	now := float64(k.now() / 1000)
	iss, hasIss := jsobj.Prop(claims, "iss")
	if s, ok := iss.(string); !ok || !issuers[s] {
		return nil, &IDTokenError{"Unexpected issuer " + jsobj.String(iss, hasIss)}
	}
	exp, _ := jsobj.Prop(claims, "exp")
	if f, ok := exp.(float64); !ok || !(f+skewS >= now) {
		return nil, &IDTokenError{"Token expired"}
	}
	aud, hasAud := jsobj.Prop(claims, "aud")
	audStr, audIsStr := aud.(string)
	found := false
	for _, a := range audiences {
		if audIsStr && a == audStr {
			found = true
		}
	}
	if !found {
		return nil, &IDTokenError{"Unexpected audience " + jsobj.String(aud, hasAud)}
	}
	if v, _ := jsobj.Prop(claims, "email_verified"); v != true {
		return nil, &IDTokenError{"Token email isn't verified"}
	}
	return claims, nil
}
