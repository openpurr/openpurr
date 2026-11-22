// Package iap verifies the identity Google Cloud's Identity-Aware Proxy (IAP) signs for each
// request it lets through: the JWT in the x-goog-iap-jwt-assertion header. It's Standard's
// counterpart to Cloudflare Access (project plan section 8.2): an optional, additional way for
// operators to sign in to the dashboard and the admin API.
//
// Every request's token is checked here; the header's presence alone is never trusted. Checks, as
// Google documents them (https://cloud.google.com/iap/docs/signed-headers-howto):
//
//   - alg is ES256 and kid names one of IAP's public keys (https://www.gstatic.com/iap/verify/public_key-jwk);
//   - the ECDSA P-256 signature over the header and payload;
//   - iss is https://cloud.google.com/iap;
//   - aud is one of the configured audiences (IAP_AUDIENCE), such as
//     /projects/<number>/global/backendServices/<id> behind a load balancer, or
//     /projects/<number>/locations/<region>/services/<name> for IAP on Cloud Run itself;
//   - exp is in the future and iat in the past, each with 30 seconds of clock skew;
//   - email is a plain address. Identity Platform identities, whose email claim carries an issuer
//     prefix ("securetoken.google.com/...:someone@example.com") and may not be verified, are refused.
//
// Keys are cached for as long as Google's Cache-Control allows (at most a day), and fetched again
// when a token names a key not in the cache (Google rotates them), at most once a minute so a
// stream of made-up key IDs can't turn into a stream of fetches.
package iap

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
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
	"time"
)

// Header is the request header IAP puts its signed assertion in.
const Header = "X-Goog-Iap-Jwt-Assertion"

// KeysURL is where Google publishes the keys IAP signs with, as a JWK set.
const KeysURL = "https://www.gstatic.com/iap/verify/public_key-jwk"

// Issuer is the iss of every IAP assertion.
const Issuer = "https://cloud.google.com/iap"

const (
	skewS          = 30
	refetchEveryMs = 60_000
	fetchTimeout   = 10 * time.Second
)

// Identity is who IAP signed in.
type Identity struct {
	Email   string
	Subject string
}

// InvalidError is an assertion that doesn't pass the checks.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

// IsInvalid reports whether err is an InvalidError (as opposed to, say, Google's keys being
// unreachable).
func IsInvalid(err error) bool {
	var e *InvalidError
	return errors.As(err, &e)
}

// Verifier checks IAP assertions for a set of audiences.
type Verifier struct {
	audiences []string
	now       func() int64
	http      *http.Client

	mu        sync.Mutex
	keys      map[string]*ecdsa.PublicKey
	expires   int64
	lastFetch int64
}

// New returns a verifier for tokens issued for one of audiences, reading the time (epoch ms) from
// now and fetching IAP's keys with client.
func New(audiences []string, now func() int64, client *http.Client) *Verifier {
	return &Verifier{audiences: append([]string(nil), audiences...), now: now, http: client}
}

// Audiences are the audiences accepted.
func (v *Verifier) Audiences() []string { return append([]string(nil), v.audiences...) }

// ParseAudiences reads IAP_AUDIENCE: one audience, or several separated by commas. Each must look
// like an IAP audience, so a project ID or a URL put there by mistake stops the server at startup
// rather than silently refusing every token.
func ParseAudiences(s string) ([]string, error) {
	var out []string
	for _, a := range strings.Split(s, ",") {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		if !audienceRE.MatchString(a) {
			return nil, fmt.Errorf("IAP_AUDIENCE %q isn't an IAP audience: expected /projects/<project number>/global/backendServices/<id> "+
				"(behind a load balancer) or /projects/<project number>/locations/<region>/services/<name> (IAP on Cloud Run)", a)
		}
		out = append(out, a)
	}
	return out, nil
}

var audienceRE = regexp.MustCompile(`^/projects/[0-9]+/(global/backendServices/[0-9]+|locations/[a-z0-9-]+/services/[a-z0-9-]+|apps/[a-z0-9-]+)$`)

type jwk struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	Kid string `json:"kid"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

var maxAgeRE = regexp.MustCompile(`max-age=(\d+)`)

func b64(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
}

// load fetches the key set. Callers hold v.mu.
func (v *Verifier) load(ctx context.Context) error {
	v.lastFetch = v.now()
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, KeysURL, nil)
	if err != nil {
		return err
	}
	res, err := v.http.Do(req)
	if err != nil {
		return fmt.Errorf("fetching IAP's keys: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("fetching IAP's keys: HTTP %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("fetching IAP's keys: %w", err)
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.Unmarshal(data, &set); err != nil {
		return errors.New("IAP's keys aren't a JWK set")
	}
	keys := map[string]*ecdsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" || k.Kid == "" {
			continue
		}
		x, err1 := b64(k.X)
		y, err2 := b64(k.Y)
		if err1 != nil || err2 != nil || len(x) != 32 || len(y) != 32 {
			continue
		}
		pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), append(append([]byte{4}, x...), y...))
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}
	maxAge := 3600.0
	if m := maxAgeRE.FindStringSubmatch(res.Header.Get("Cache-Control")); m != nil {
		maxAge, _ = strconv.ParseFloat(m[1], 64)
	}
	v.keys = keys
	v.expires = v.now() + int64(math.Min(maxAge, 86_400)*1000)
	return nil
}

func (v *Verifier) keyFor(ctx context.Context, kid string) (*ecdsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := v.now()
	if v.keys == nil || v.expires <= now {
		if err := v.load(ctx); err != nil {
			return nil, err
		}
	}
	if key, ok := v.keys[kid]; ok {
		return key, nil
	}
	if now-v.lastFetch >= refetchEveryMs {
		if err := v.load(ctx); err != nil {
			return nil, err
		}
		if key, ok := v.keys[kid]; ok {
			return key, nil
		}
	}
	return nil, &InvalidError{"signed with an unknown key"}
}

// Forget drops the cached keys.
func (v *Verifier) Forget() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.keys = nil
	v.lastFetch = 0
}

// Verify checks an assertion and returns who it signs in. A token that fails a check is an
// InvalidError; anything else (IAP's keys unreachable) is another error.
func (v *Verifier) Verify(ctx context.Context, token string) (*Identity, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, &InvalidError{"not a JWT"}
	}
	rawHeader, err1 := b64(parts[0])
	rawClaims, err2 := b64(parts[1])
	sig, err3 := b64(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return nil, &InvalidError{"malformed JWT"}
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if json.Unmarshal(rawHeader, &header) != nil {
		return nil, &InvalidError{"malformed JWT header"}
	}
	if header.Alg != "ES256" {
		return nil, &InvalidError{"unexpected algorithm " + strconv.Quote(header.Alg)}
	}
	if header.Kid == "" {
		return nil, &InvalidError{"no key ID"}
	}
	if len(sig) != 64 {
		return nil, &InvalidError{"bad signature"}
	}
	key, err := v.keyFor(ctx, header.Kid)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(key, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		return nil, &InvalidError{"bad signature"}
	}

	var claims struct {
		Iss   *string         `json:"iss"`
		Aud   json.RawMessage `json:"aud"`
		Exp   *float64        `json:"exp"`
		Iat   *float64        `json:"iat"`
		Email *string         `json:"email"`
		Sub   string          `json:"sub"`
	}
	if json.Unmarshal(rawClaims, &claims) != nil {
		return nil, &InvalidError{"malformed JWT claims"}
	}
	if claims.Iss == nil || *claims.Iss != Issuer {
		return nil, &InvalidError{"unexpected issuer"}
	}
	var aud string
	if json.Unmarshal(claims.Aud, &aud) != nil || !v.accepts(aud) {
		return nil, &InvalidError{"unexpected audience " + strconv.Quote(aud)}
	}
	now := float64(v.now()) / 1000
	if claims.Exp == nil || *claims.Exp+skewS <= now {
		return nil, &InvalidError{"expired"}
	}
	if claims.Iat == nil || *claims.Iat-skewS > now {
		return nil, &InvalidError{"issued in the future"}
	}
	if claims.Email == nil || *claims.Email == "" {
		return nil, &InvalidError{"no email"}
	}
	email := *claims.Email
	if strings.Contains(email, ":") || !strings.Contains(email, "@") {
		return nil, &InvalidError{"not a Google identity's email (Identity Platform identities aren't supported)"}
	}
	return &Identity{Email: strings.ToLower(email), Subject: claims.Sub}, nil
}

func (v *Verifier) accepts(aud string) bool {
	for _, a := range v.audiences {
		if a == aud {
			return true
		}
	}
	return false
}
