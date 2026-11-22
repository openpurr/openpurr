package apple

// App Store Server API client: the calls openpurr needs, nothing more (lite/src/stores/apple-api.ts
// and the App Store part of lite/src/lib/store-tokens.ts). Endpoints and base URLs match Apple's
// app-store-server-library-node.
//
// Signed data in API responses is decoded, not re-verified: the response comes straight from
// Apple's API host over TLS, which already authenticates it. Signed data that arrives from devices
// or notifications is always verified (internal/applejws).

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"

	"github.com/openpurr/openpurr/standard/internal/applejws"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// Base URLs per environment.
var APIURLs = map[string]string{
	"production": "https://api.storekit.apple.com",
	"sandbox":    "https://api.storekit-sandbox.apple.com",
}

// Apple error codes acted on.
const (
	ErrTransactionIDNotFound         = 4040010
	ErrOriginalTransactionIDNotFound = 4040005
	ErrRateLimitExceeded             = 4290000
)

// APIError is an error answer from the App Store Server API.
type APIError struct {
	Status int
	// Apple's errorCode, 0 when it sent none.
	ErrorCode int
	Msg       string
}

func (e *APIError) Error() string { return e.Msg }

// NotFound: Apple doesn't know the transaction (in this environment).
func (e *APIError) NotFound() bool {
	return e.ErrorCode == ErrTransactionIDNotFound || e.ErrorCode == ErrOriginalTransactionIDNotFound
}

// Retryable: rate limits and Apple-side failures, worth retrying later.
func (e *APIError) Retryable() bool { return e.Status == 429 || e.Status >= 500 }

// Credentials for the API: the In-App Purchase key and who it belongs to.
type Credentials struct {
	IssuerID      string
	KeyID         string
	BundleID      string
	PrivateKeyPEM string
}

// SubscriptionStatus is the latest transaction and renewal info of one subscription.
type SubscriptionStatus struct {
	OriginalTransactionID string
	// 1 active, 2 expired, 3 billing retry, 4 billing grace period, 5 revoked.
	Status      int
	Transaction any
	Renewal     any
}

// Client talks to one environment.
type Client struct {
	Environment string
	creds       Credentials
	http        *http.Client
	tokens      *Tokens
}

// NewClient returns a client for "production" or "sandbox".
func NewClient(creds Credentials, environment string, httpClient *http.Client, tokens *Tokens) *Client {
	return &Client{Environment: environment, creds: creds, http: httpClient, tokens: tokens}
}

func (c *Client) request(ctx context.Context, method, path string, query url.Values) (any, error) {
	token, err := c.tokens.Mint(c.creds)
	if err != nil {
		return nil, err
	}
	u := APIURLs[c.Environment] + path
	if len(query) > 0 {
		u += "?" + encodeQuery(query)
	}
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
		v, err := jsobj.Parse(data)
		if err != nil {
			return nil, fmt.Errorf("App Store Server API %s %s: response isn't JSON", method, path)
		}
		return v, nil
	}
	errorCode := 0
	errorMessage := ""
	if body, err := jsobj.Parse(data); err == nil {
		if f, ok := Num(body, "errorCode"); ok {
			errorCode = int(f)
		}
		if m, ok := present(body, "errorMessage"); ok {
			errorMessage = jsobj.String(m, true)
		}
	}
	msg := fmt.Sprintf("App Store Server API %d", res.StatusCode)
	if errorCode != 0 {
		msg += fmt.Sprintf(" %d", errorCode)
	}
	if errorMessage == "" {
		errorMessage = method + " " + path
	}
	return nil, &APIError{Status: res.StatusCode, ErrorCode: errorCode, Msg: msg + ": " + errorMessage}
}

// encodeQuery keeps the insertion order URLSearchParams would (sort, then revision).
func encodeQuery(q url.Values) string {
	var parts []string
	for _, k := range []string{"sort", "revision"} {
		for _, v := range q[k] {
			parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(parts, "&")
}

// decodeJWS decodes a JWS payload without verifying it (see the note at the top of this file).
func decodeJWS(v any) (any, error) {
	jws := jsobj.String(v, true)
	parts := strings.Split(jws, ".")
	if len(parts) < 2 || parts[1] == "" {
		return nil, &APIError{Status: 502, Msg: "Apple returned malformed signed data"}
	}
	data, err := applejws.DecodeBase64URL(parts[1])
	if err != nil {
		return nil, errors.New("Apple returned signed data that isn't base64url")
	}
	payload, err := jsobj.Parse(data)
	if err != nil {
		return nil, errors.New("Apple returned signed data that isn't JSON")
	}
	return payload, nil
}

// TransactionHistory returns the transaction history, newest first, up to maxPages pages of 20,
// and whether it's complete.
func (c *Client) TransactionHistory(ctx context.Context, anyTransactionID string, maxPages int) ([]any, bool, error) {
	var transactions []any
	revision := ""
	for page := 0; page < maxPages; page++ {
		query := url.Values{"sort": {"DESCENDING"}}
		if revision != "" {
			query.Set("revision", revision)
		}
		res, err := c.request(ctx, http.MethodGet, "/inApps/v2/history/"+encodeURIComponent(anyTransactionID), query)
		if err != nil {
			return nil, false, err
		}
		if list, ok := present(res, "signedTransactions"); ok {
			items, _ := list.([]any)
			for _, jws := range items {
				tx, err := decodeJWS(jws)
				if err != nil {
					return nil, false, err
				}
				transactions = append(transactions, tx)
			}
		}
		more, _ := get(res, "hasMore")
		rev, _ := get(res, "revision")
		if !Truthy(more) || !Truthy(rev) {
			return transactions, true, nil
		}
		revision = jsobj.String(rev, true)
	}
	return transactions, false, nil
}

// SubscriptionStatuses returns the latest transaction and renewal info for every subscription the
// customer has in the app.
func (c *Client) SubscriptionStatuses(ctx context.Context, anyTransactionID string) ([]SubscriptionStatus, error) {
	res, err := c.request(ctx, http.MethodGet, "/inApps/v1/subscriptions/"+encodeURIComponent(anyTransactionID), nil)
	if err != nil {
		return nil, err
	}
	var out []SubscriptionStatus
	groups, _ := present(res, "data")
	groupList, _ := groups.([]any)
	for _, group := range groupList {
		lasts, _ := present(group, "lastTransactions")
		lastList, _ := lasts.([]any)
		for _, last := range lastList {
			txInfo, _ := get(last, "signedTransactionInfo")
			renewalInfo, _ := get(last, "signedRenewalInfo")
			status, hasStatus := get(last, "status")
			if !Truthy(txInfo) || !Truthy(renewalInfo) || !hasStatus {
				continue
			}
			tx, err := decodeJWS(txInfo)
			if err != nil {
				return nil, err
			}
			renewal, err := decodeJWS(renewalInfo)
			if err != nil {
				return nil, err
			}
			code, _ := status.(float64)
			out = append(out, SubscriptionStatus{
				OriginalTransactionID: Str(last, "originalTransactionId"),
				Status:                int(code),
				Transaction:           tx,
				Renewal:               renewal,
			})
		}
	}
	return out, nil
}

// RequestTestNotification asks Apple to send a TEST notification to the app's configured URL.
func (c *Client) RequestTestNotification(ctx context.Context) (string, error) {
	res, err := c.request(ctx, http.MethodPost, "/inApps/v1/notifications/test", nil)
	if err != nil {
		return "", err
	}
	return Str(res, "testNotificationToken"), nil
}

// TestNotificationStatus is Apple's answer about a test notification.
func (c *Client) TestNotificationStatus(ctx context.Context, token string) (any, error) {
	return c.request(ctx, http.MethodGet, "/inApps/v1/notifications/test/"+encodeURIComponent(token), nil)
}

// Clients is one client per environment.
type Clients struct {
	Production *Client
	Sandbox    *Client
}

// For returns the client for an environment.
func (c Clients) For(environment string) *Client {
	if environment == "production" {
		return c.Production
	}
	return c.Sandbox
}

// InEitherEnvironment runs fn against production, then sandbox if Apple says the transaction
// doesn't exist there. Apple keeps the two environments separate, and a StoreKit 1 receipt
// doesn't say which one it came from. It returns the environment that answered.
func InEitherEnvironment[T any](clients Clients, fn func(*Client) (T, error)) (T, string, error) {
	result, err := fn(clients.Production)
	if err == nil {
		return result, "production", nil
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) || !apiErr.NotFound() {
		return result, "", err
	}
	result, err = fn(clients.Sandbox)
	return result, "sandbox", err
}

// --- bearer tokens -------------------------------------------------------------------------------

// Tokens mints App Store Server API bearer tokens: ES256 JWTs signed with the In-App Purchase key,
// valid for 50 minutes (Apple allows up to 60) and reused until 5 minutes before expiry.
type Tokens struct {
	now   func() int64
	mu    sync.Mutex
	keys  map[string]*ecdsa.PrivateKey
	cache map[string]cachedToken
}

type cachedToken struct {
	token string
	exp   int64
}

// NewTokens returns a token minter reading the time (epoch ms) from now.
func NewTokens(now func() int64) *Tokens {
	return &Tokens{now: now, keys: map[string]*ecdsa.PrivateKey{}, cache: map[string]cachedToken{}}
}

// Mint returns a bearer token for the credentials.
func (t *Tokens) Mint(c Credentials) (string, error) {
	now := t.now() / 1000
	cacheKey := c.IssuerID + ":" + c.KeyID + ":" + c.BundleID
	t.mu.Lock()
	cached, ok := t.cache[cacheKey]
	t.mu.Unlock()
	if ok && cached.exp-now > 5*60 {
		return cached.token, nil
	}
	key, err := t.key(c.PrivateKeyPEM)
	if err != nil {
		return "", err
	}
	exp := now + 50*60
	header := jsobj.New("alg", "ES256", "kid", c.KeyID, "typ", "JWT")
	claims := jsobj.New("iss", c.IssuerID, "iat", float64(now), "exp", float64(exp), "aud", "appstoreconnect-v1", "bid", c.BundleID)
	token, err := SignES256(key, header, claims)
	if err != nil {
		return "", err
	}
	t.mu.Lock()
	t.cache[cacheKey] = cachedToken{token: token, exp: exp}
	t.mu.Unlock()
	return token, nil
}

func (t *Tokens) key(pemText string) (*ecdsa.PrivateKey, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if k, ok := t.keys[pemText]; ok {
		return k, nil
	}
	k, err := ParseP256Key(pemText)
	if err != nil {
		return nil, err
	}
	t.keys[pemText] = k
	return k, nil
}

// ParseP256Key reads a PKCS#8 P-256 private key from PEM (an App Store Connect .p8 file).
func ParseP256Key(pemText string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemText))
	var der []byte
	if block != nil {
		der = block.Bytes
	} else {
		// Lite's pemToDer: strip the armor lines and whitespace, then base64.
		body := pemArmor.ReplaceAllString(pemText, "")
		var err error
		if der, err = applejws.Atob(body); err != nil {
			return nil, errors.New("the In-App Purchase key isn't a PEM private key")
		}
	}
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("the In-App Purchase key isn't a PKCS#8 private key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("the In-App Purchase key isn't a P-256 key")
	}
	return key, nil
}

// SignES256 signs a JWT (or JWS) with raw r||s, as JWS requires.
func SignES256(key *ecdsa.PrivateKey, header, claims *jsobj.Object) (string, error) {
	enc := func(o *jsobj.Object) string { return base64.RawURLEncoding.EncodeToString([]byte(jsobj.Stringify(o))) }
	input := enc(header) + "." + enc(claims)
	digest := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return input + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

var pemArmor = regexp.MustCompile(`-----(BEGIN|END) [^-]+-----`)

// encodeURIComponent is JavaScript's: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is escaped.
func encodeURIComponent(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte("-_.!~*'()", c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&15])
	}
	return b.String()
}
