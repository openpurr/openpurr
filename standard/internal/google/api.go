// Package google is the Google Play side of the ledger: the Play Developer API client and the
// service-account tokens it needs, verifying Pub/Sub push tokens, turning Google's answers into
// ledger rows and subscription status, the webhook events Play facts produce, acknowledgements and
// the scheduled Play jobs. A port of lite/src/stores/google*.ts, lite/src/lib/google-oidc.ts and
// the Google part of lite/src/lib/store-tokens.ts.
//
// Google's answers are read as parsed JSON with JavaScript semantics (jsobj), the way Lite reads
// them, so the same field quirks (`??`, String(), truthiness) give the same rows.
package google

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// Base is the Play Developer API's applications endpoint.
const Base = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"

// TokenURL is Google's OAuth token endpoint.
const TokenURL = "https://oauth2.googleapis.com/token"

// AndroidPublisherScope is the OAuth scope the Play Developer API needs.
const AndroidPublisherScope = "https://www.googleapis.com/auth/androidpublisher"

// APIError is an error answer from the Play Developer API.
type APIError struct {
	Status int
	Msg    string
}

func (e *APIError) Error() string { return e.Msg }

// NotFound: the purchase token doesn't exist (or is too old); Google answers 404 or 410.
func (e *APIError) NotFound() bool { return e.Status == 404 || e.Status == 410 }

// Retryable: rate limits and Google-side failures.
func (e *APIError) Retryable() bool { return e.Status == 429 || e.Status >= 500 }

// ServiceAccount is the part of a service account's JSON key the API needs.
type ServiceAccount struct {
	ClientEmail   string
	PrivateKeyPEM string
}

// Client calls the Play Developer API for one app.
type Client struct {
	PackageName string
	sa          ServiceAccount
	http        *http.Client
	tokens      *Tokens
}

// NewClient returns a client for an app's package.
func NewClient(sa ServiceAccount, packageName string, httpClient *http.Client, tokens *Tokens) *Client {
	return &Client{PackageName: packageName, sa: sa, http: httpClient, tokens: tokens}
}

// requestTimeout bounds each API call, as Lite's AbortSignal.timeout(10_000) does.
const requestTimeout = 10 * time.Second

// query is a URLSearchParams: keys in insertion order.
type query [][2]string

func (q query) encode() string {
	parts := make([]string, len(q))
	for i, kv := range q {
		parts[i] = url.QueryEscape(kv[0]) + "=" + url.QueryEscape(kv[1])
	}
	return strings.Join(parts, "&")
}

func (c *Client) request(ctx context.Context, method, path string, q query) (any, error) {
	token, err := c.tokens.AccessToken(ctx, c.http, c.sa)
	if err != nil {
		return nil, err
	}
	u := Base + "/" + jsobj.EncodeURIComponent(c.PackageName) + path
	if len(q) > 0 {
		u += "?" + q.encode()
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		if len(data) == 0 {
			return jsobj.New(), nil
		}
		v, err := jsobj.Parse(data)
		if err != nil {
			return nil, fmt.Errorf("Google Play Developer API %s %s: response isn't JSON", method, path)
		}
		return v, nil
	}
	message := ""
	if body, err := jsobj.Parse(data); err == nil {
		e, _ := jsobj.Prop(body, "error")
		if m, ok := jsobj.Prop(e, "message"); ok && m != nil {
			message = jsobj.String(m, true)
		}
	}
	if message == "" {
		message = method + " " + path
	}
	return nil, &APIError{Status: res.StatusCode, Msg: fmt.Sprintf("Google Play Developer API %d: %s", res.StatusCode, message)}
}

var enc = jsobj.EncodeURIComponent

// Subscription is purchases.subscriptionsv2.get.
func (c *Client) Subscription(ctx context.Context, token string) (any, error) {
	return c.request(ctx, http.MethodGet, "/purchases/subscriptionsv2/tokens/"+enc(token), nil)
}

// Product is purchases.products.get.
func (c *Client) Product(ctx context.Context, productID, token string) (any, error) {
	return c.request(ctx, http.MethodGet, "/purchases/products/"+enc(productID)+"/tokens/"+enc(token), nil)
}

// AcknowledgeSubscription is purchases.subscriptions.acknowledge.
func (c *Client) AcknowledgeSubscription(ctx context.Context, subscriptionID, token string) error {
	_, err := c.request(ctx, http.MethodPost, "/purchases/subscriptions/"+enc(subscriptionID)+"/tokens/"+enc(token)+":acknowledge", nil)
	return err
}

// AcknowledgeProduct is purchases.products.acknowledge.
func (c *Client) AcknowledgeProduct(ctx context.Context, productID, token string) error {
	_, err := c.request(ctx, http.MethodPost, "/purchases/products/"+enc(productID)+"/tokens/"+enc(token)+":acknowledge", nil)
	return err
}

// Order is orders.get: what the customer actually paid.
func (c *Client) Order(ctx context.Context, orderID string) (any, error) {
	return c.request(ctx, http.MethodGet, "/orders/"+enc(orderID), nil)
}

// Voided is purchases.voidedpurchases.list since startTimeMs: one page of one-time purchases and
// subscriptions.
func (c *Client) Voided(ctx context.Context, startTimeMs float64) (any, error) {
	return c.request(ctx, http.MethodGet, "/purchases/voidedpurchases", query{
		{"startTime", jsobj.FormatNumber(startTimeMs)},
		{"type", "1"}, // one-time purchases and subscriptions
		{"maxResults", "1000"},
	})
}

// Money is a parsed Money value in micros of its currency.
type Money struct {
	Micros   int64
	Currency string
}

// MoneyMicros reads a Money object, or nil when it has no currency code (moneyMicros).
func MoneyMicros(m any) *Money {
	code, _ := jsobj.Prop(m, "currencyCode")
	if !truthy(code) {
		return nil
	}
	units := 0.0
	if u, ok := jsobj.Prop(m, "units"); ok && u != nil {
		units = toNumber(u, true)
	}
	nanos := 0.0
	if n, ok := jsobj.Prop(m, "nanos"); ok && n != nil {
		nanos = toNumber(n, true)
	}
	micros := units*1e6 + jsRound(nanos/1000)
	return &Money{Micros: int64(micros), Currency: jsobj.String(code, true)}
}

// --- service-account tokens ----------------------------------------------------------------------

// Tokens mints service-account assertions (RS256 JWTs) and exchanges them for OAuth access
// tokens, cached per service account until two minutes before they expire. Parsed keys are cached
// too.
type Tokens struct {
	now   func() int64
	mu    sync.Mutex
	keys  map[string]*rsa.PrivateKey
	cache map[string]cachedToken
}

type cachedToken struct {
	token string
	exp   float64
}

// NewTokens returns a token source reading the time (epoch ms) from now.
func NewTokens(now func() int64) *Tokens {
	return &Tokens{now: now, keys: map[string]*rsa.PrivateKey{}, cache: map[string]cachedToken{}}
}

// MintAssertion signs the assertion exchanged at the token endpoint.
func (t *Tokens) MintAssertion(sa ServiceAccount) (string, error) {
	key, err := t.key(sa.PrivateKeyPEM)
	if err != nil {
		return "", err
	}
	now := float64(t.now() / 1000)
	header := jsobj.New("alg", "RS256", "typ", "JWT")
	claims := jsobj.New("iss", sa.ClientEmail, "scope", AndroidPublisherScope, "aud", TokenURL, "iat", now, "exp", now+3600)
	return SignRS256(key, header, claims)
}

// AccessToken returns an OAuth access token for the service account.
func (t *Tokens) AccessToken(ctx context.Context, httpClient *http.Client, sa ServiceAccount) (string, error) {
	t.mu.Lock()
	cached, ok := t.cache[sa.ClientEmail]
	t.mu.Unlock()
	if ok && cached.exp-float64(t.now()) > 120_000 {
		return cached.token, nil
	}
	assertion, err := t.MintAssertion(sa)
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {assertion}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("Google token exchange failed: %d", res.StatusCode)
	}
	body, err := jsobj.Parse(data)
	if err != nil {
		return "", errors.New("Google token exchange: response isn't JSON")
	}
	tokenV, hasToken := jsobj.Prop(body, "access_token")
	token := jsobj.String(tokenV, hasToken)
	// A missing or odd expires_in gives NaN, which is never fresh, as in Lite.
	expiresIn := math.NaN()
	if v, ok := jsobj.Prop(body, "expires_in"); ok {
		expiresIn = toNumber(v, true)
	}
	t.mu.Lock()
	t.cache[sa.ClientEmail] = cachedToken{token: token, exp: float64(t.now()) + expiresIn*1000}
	t.mu.Unlock()
	return token, nil
}

func (t *Tokens) key(pemText string) (*rsa.PrivateKey, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if k, ok := t.keys[pemText]; ok {
		return k, nil
	}
	k, err := ParseRSAKey(pemText)
	if err != nil {
		return nil, err
	}
	t.keys[pemText] = k
	return k, nil
}

var pemArmor = regexp.MustCompile(`-----(BEGIN|END) [^-]+-----`)

// ParseRSAKey reads a PKCS#8 RSA private key from PEM (a service account's private_key).
func ParseRSAKey(pemText string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemText))
	var der []byte
	if block != nil {
		der = block.Bytes
	} else {
		// Lite's pemToDer: strip the armor lines and whitespace, then base64.
		var err error
		if der, err = applejws.Atob(pemArmor.ReplaceAllString(pemText, "")); err != nil {
			return nil, errors.New("the service account's private_key isn't a PEM private key")
		}
	}
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("the service account's private_key isn't a PKCS#8 private key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("the service account's private_key isn't an RSA key")
	}
	return key, nil
}

// SignRS256 signs a JWT with RSASSA-PKCS1-v1_5 and SHA-256.
func SignRS256(key *rsa.PrivateKey, header, claims *jsobj.Object) (string, error) {
	b64 := func(o *jsobj.Object) string { return base64.RawURLEncoding.EncodeToString([]byte(jsobj.Stringify(o))) }
	input := b64(header) + "." + b64(claims)
	digest := sha256.Sum256([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return input + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// --- JavaScript semantics ------------------------------------------------------------------------

// truthy is JavaScript truthiness.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	}
	return true
}

// Number is JavaScript's Number(v) for a defined value.
func Number(v any) float64 { return toNumber(v, true) }

// toNumber is JavaScript's Number(v) (NaN when undefined).
func toNumber(v any, defined bool) float64 {
	if !defined {
		return math.NaN()
	}
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case string:
		s := jsobj.Trim(x)
		if s == "" {
			return 0
		}
		switch s {
		case "Infinity", "+Infinity":
			return math.Inf(1)
		case "-Infinity":
			return math.Inf(-1)
		}
		if strings.Trim(s, "0123456789.eE+-") != "" {
			return math.NaN() // Go would also read "inf", "nan" and hex
		}
		return jsobj.ParseNumber(s)
	case []any:
		if len(x) == 0 {
			return 0
		}
		if len(x) == 1 {
			return toNumber(jsobj.String(x[0], true), true)
		}
	}
	return math.NaN()
}

// jsRound is Math.round: halves round up.
func jsRound(f float64) float64 { return math.Floor(f + 0.5) }
