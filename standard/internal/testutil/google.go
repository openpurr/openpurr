package testutil

// Google Play for tests (lite/test/helpers.ts): a fake Google (OAuth token endpoint, Play Developer
// API, the keys that sign Pub/Sub push tokens), subscriptionsv2 answers, push tokens and
// notifications.

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/google"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
)

const (
	GoogleSAEmail = "openpurr-test@test-project.iam.gserviceaccount.com"
	Package       = "com.example.openpurr"
	PushAccount   = "rtdn-push@test-project.iam.gserviceaccount.com"
	PushKid       = "test-kid-1"
)

var googleKeys struct {
	once     sync.Once
	sa, push *rsa.PrivateKey
	saPEM    string
}

func keys() {
	googleKeys.once.Do(func() {
		var err error
		if googleKeys.sa, err = rsa.GenerateKey(rand.Reader, 2048); err != nil {
			panic(err)
		}
		if googleKeys.push, err = rsa.GenerateKey(rand.Reader, 2048); err != nil {
			panic(err)
		}
		der, err := x509.MarshalPKCS8PrivateKey(googleKeys.sa)
		if err != nil {
			panic(err)
		}
		googleKeys.saPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	})
}

// ServiceAccountPEM is the test service account's private key.
func ServiceAccountPEM() string {
	keys()
	return googleKeys.saPEM
}

// ServiceAccountPublicKey is the test service account's public key.
func ServiceAccountPublicKey() *rsa.PublicKey {
	keys()
	return &googleKeys.sa.PublicKey
}

// GoogleSecrets holds the service account JSON key as GOOGLE_SERVICE_ACCOUNT.
func GoogleSecrets() map[string]string {
	return map[string]string{"GOOGLE_SERVICE_ACCOUNT": jsobj.Stringify(jsobj.New(
		"type", "service_account", "client_email", GoogleSAEmail, "private_key", ServiceAccountPEM()))}
}

// GoogleConfig is the test config with Play Developer API access for the Android app (and no
// unverified purchases), plus a webhook endpoint when webhook is set.
func GoogleConfig(webhook bool) any {
	raw := testdata.TestConfig()
	apps, _ := jsobj.Prop(raw, "apps")
	android, _ := jsobj.Prop(apps, "android")
	a := android.(*jsobj.Object)
	a.Delete("allow_unverified_purchases")
	a.Set("google_play_api", jsobj.New("service_account_secret", "GOOGLE_SERVICE_ACCOUNT", "pubsub_push_account", PushAccount))
	if webhook {
		raw.(*jsobj.Object).Set("webhooks", []any{jsobj.New("id", "backend", "url", "http://localhost:9/hooks/backend")})
	}
	return raw
}

// GoogleRoute answers one request: status (0 means 200) and a JSON body.
type GoogleRoute func(r *http.Request) (int, any)

// GoogleRequest is one Play Developer API request the fake received.
type GoogleRequest struct {
	Method string
	// The path after /applications/{package}, decoded.
	Path  string
	Query url.Values
}

// FakeGoogle plays Google: the OAuth token endpoint, the Play Developer API (routes keyed
// "<METHOD> <path after /applications/{package}>", plus Subs and Products answers tests change
// between calls; anything else is 404) and the JWKS that signs push tokens.
type FakeGoogle struct {
	mu       sync.Mutex
	routes   map[string]GoogleRoute
	subs     map[string]any
	products map[string]any
	requests []GoogleRequest
	// Requests for the signing keys and for access tokens.
	KeyFetches, TokenFetches atomic.Int32
	Server                   *httptest.Server
}

// NewFakeGoogle starts a fake. Point the server's outbound client at it with Options.StoreBase.
func NewFakeGoogle(t interface{ Cleanup(func()) }) *FakeGoogle {
	keys()
	f := &FakeGoogle{routes: map[string]GoogleRoute{}, subs: map[string]any{}, products: map[string]any{}}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Server.Close)
	return f
}

// Route adds or replaces a route.
func (f *FakeGoogle) Route(key string, route GoogleRoute) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.routes[key] = route
}

// SetSub sets the subscriptionsv2 answer for a purchase token.
func (f *FakeGoogle) SetSub(token string, sub any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.subs[token] = sub
}

// SetProduct sets the products answer for a purchase token (any product ID).
func (f *FakeGoogle) SetProduct(token string, p any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.products[token] = p
}

// Requests are the Play Developer API requests received so far.
func (f *FakeGoogle) Requests() []GoogleRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]GoogleRequest(nil), f.requests...)
}

// Requested reports whether "<METHOD> <path>" was requested.
func (f *FakeGoogle) Requested(key string) int {
	n := 0
	for _, r := range f.Requests() {
		if r.Method+" "+r.Path == key {
			n++
		}
	}
	return n
}

func (f *FakeGoogle) serve(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/")
	host, path, _ := strings.Cut(rest, "/")
	path = "/" + path
	switch host {
	case "oauth2.googleapis.com":
		f.TokenFetches.Add(1)
		writeFake(w, 200, jsobj.New("access_token", "ya29.test-token", "expires_in", 3600.0, "token_type", "Bearer"))
		return
	case "www.googleapis.com":
		f.KeyFetches.Add(1)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		writeFake(w, 200, PushJWKS())
		return
	}
	path = strings.TrimPrefix(path, "/androidpublisher/v3/applications/"+Package)
	f.mu.Lock()
	f.requests = append(f.requests, GoogleRequest{Method: r.Method, Path: path, Query: r.URL.Query()})
	route := f.routes[r.Method+" "+path]
	var answer any
	if r.Method == http.MethodGet {
		if token, ok := strings.CutPrefix(path, "/purchases/subscriptionsv2/tokens/"); ok {
			answer = f.subs[token]
		} else if strings.HasPrefix(path, "/purchases/products/") {
			answer = f.products[path[strings.LastIndex(path, "/")+1:]]
		}
	}
	f.mu.Unlock()
	switch {
	case route != nil:
		status, body := route(r)
		if status == 0 {
			status = 200
		}
		writeFake(w, status, body)
	case answer != nil:
		writeFake(w, 200, answer)
	case r.Method == http.MethodPost && strings.HasSuffix(path, ":acknowledge"):
		writeFake(w, 200, jsobj.New())
	default:
		writeFake(w, 404, jsobj.New("error", jsobj.New("code", 404.0, "message", "Not found")))
	}
}

func writeFake(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(jsobj.Stringify(body)))
}

// PushJWKS is the key set that verifies push tokens.
func PushJWKS() *jsobj.Object {
	keys()
	pub := googleKeys.push.PublicKey
	b64 := base64.RawURLEncoding.EncodeToString
	return jsobj.New("keys", []any{jsobj.New("kid", PushKid, "kty", "RSA", "alg", "RS256", "use", "sig",
		"n", b64(pub.N.Bytes()), "e", b64(big.NewInt(int64(pub.E)).Bytes()))})
}

// Fields override payload fields; nil values delete them.
type GoogleFields map[string]any

// PushToken is a Pub/Sub push token for audience, signed at now (epoch ms). Claims overrides
// replace or (with nil) remove claims; kid "" means the published key's.
func PushToken(now int64, audience string, overrides GoogleFields, kid string) string {
	keys()
	if kid == "" {
		kid = PushKid
	}
	secs := float64(now / 1000)
	claims := jsobj.New("iss", "https://accounts.google.com", "aud", audience, "email", PushAccount, "email_verified", true,
		"sub", "1234567890", "iat", secs, "exp", secs+3600)
	for k, v := range overrides {
		if v == nil {
			claims.Delete(k)
		} else {
			claims.Set(k, v)
		}
	}
	token, err := google.SignRS256(googleKeys.push, jsobj.New("alg", "RS256", "kid", kid, "typ", "JWT"), claims)
	if err != nil {
		panic(err)
	}
	return token
}

// PushAudience is the default audience for the test server: its notification URL, as https.
func (e *Env) PushAudience() string {
	u, _ := url.Parse(e.Server.URL)
	return "https://" + u.Host + "/notifications/google"
}

var messageCounter atomic.Int64

// NotifyOptions change a pushed notification.
type NotifyOptions struct {
	// The bearer token; "" signs a valid one, "-" sends none.
	Token string
	// Pub/Sub's message ID; "" for a fresh one.
	MessageID string
	// The message data as sent, instead of the encoded notification.
	RawData *string
}

// PostGoogleNotification delivers a Developer Notification the way a Pub/Sub push subscription
// does: version, packageName and eventTimeMillis, then n's fields.
func (e *Env) PostGoogleNotification(n *jsobj.Object, opts NotifyOptions) *Response {
	e.T.Helper()
	now := e.Clock.Now()
	payload := jsobj.New("version", "1.0", "packageName", Package, "eventTimeMillis", jsobj.FormatNumber(float64(now)))
	for _, k := range n.Keys() {
		v, _ := n.Get(k)
		payload.Set(k, v)
	}
	data := base64.StdEncoding.EncodeToString([]byte(jsobj.Stringify(payload)))
	if opts.RawData != nil {
		data = *opts.RawData
	}
	id := opts.MessageID
	if id == "" {
		id = "msg-" + jsobj.FormatNumber(float64(messageCounter.Add(1)))
	}
	body := jsobj.Stringify(jsobj.New(
		"message", jsobj.New("data", data, "messageId", id, "publishTime", time.UnixMilli(now).UTC().Format(time.RFC3339Nano)),
		"subscription", "projects/test-project/subscriptions/rtdn-push"))
	req, err := http.NewRequest(http.MethodPost, e.Server.URL+"/notifications/google", strings.NewReader(body))
	if err != nil {
		e.T.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	switch opts.Token {
	case "":
		req.Header.Set("Authorization", "Bearer "+PushToken(now, e.PushAudience(), nil, ""))
	case "-":
	default:
		req.Header.Set("Authorization", "Bearer "+opts.Token)
	}
	return e.do(req)
}

// do sends a request and waits for deferred work.
func (e *Env) do(req *http.Request) *Response {
	e.T.Helper()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.T.Fatal(err)
	}
	defer res.Body.Close()
	var b strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := res.Body.Read(buf)
		b.Write(buf[:n])
		if err != nil {
			break
		}
	}
	e.Deps.Deferred.Wait()
	return &Response{Status: res.StatusCode, Header: res.Header, Body: []byte(b.String())}
}

// PlaySub describes a subscriptionsv2 answer (lite/test/helpers.ts playSubscription).
type PlaySub struct {
	ProductID, BasePlanID, OrderID, State, Phase, LinkedPurchaseToken string
	Expiry, Start, AutoResume                                         int64
	Ack, Production, AutoRenewOff                                     bool
}

var orderCounter atomic.Int64

// PlaySubscription builds a subscriptionsv2 answer at now (epoch ms).
func PlaySubscription(now int64, o PlaySub) *jsobj.Object {
	isoTime := func(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }
	def := func(s *string, v string) {
		if *s == "" {
			*s = v
		}
	}
	def(&o.ProductID, "pro")
	def(&o.BasePlanID, "monthly")
	def(&o.State, "SUBSCRIPTION_STATE_ACTIVE")
	def(&o.Phase, "basePrice")
	// Google order IDs are unique; the ledger keys transactions by them.
	def(&o.OrderID, "GPA.test-"+jsobj.FormatNumber(float64(orderCounter.Add(1))))
	if o.Start == 0 {
		o.Start = now - Day
	}
	if o.Expiry == 0 {
		o.Expiry = now + 30*Day
	}
	ack := "ACKNOWLEDGEMENT_STATE_PENDING"
	if o.Ack {
		ack = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
	}
	sub := jsobj.New("kind", "androidpublisher#subscriptionPurchaseV2", "startTime", isoTime(o.Start), "regionCode", "US",
		"subscriptionState", o.State, "acknowledgementState", ack)
	if !o.Production {
		sub.Set("testPurchase", jsobj.New())
	}
	if o.LinkedPurchaseToken != "" {
		sub.Set("linkedPurchaseToken", o.LinkedPurchaseToken)
	}
	if o.AutoResume != 0 {
		sub.Set("pausedStateContext", jsobj.New("autoResumeTime", isoTime(o.AutoResume)))
	}
	sub.Set("lineItems", []any{jsobj.New(
		"productId", o.ProductID,
		"expiryTime", isoTime(o.Expiry),
		"latestSuccessfulOrderId", o.OrderID,
		"autoRenewingPlan", jsobj.New("autoRenewEnabled", !o.AutoRenewOff, "recurringPrice", jsobj.New("currencyCode", "USD", "units", "4", "nanos", 990000000.0)),
		"offerDetails", jsobj.New("basePlanId", o.BasePlanID),
		"offerPhase", jsobj.New(o.Phase, jsobj.New()),
	)})
	return sub
}

// StartGoogle runs a server whose Android app has Play Developer API access, talking to a fake
// Google, with a webhook endpoint when webhook is set.
func StartGoogle(t testing.TB, webhook bool) (*Env, *FakeGoogle) {
	t.Helper()
	fake := NewFakeGoogle(t)
	env := Start(t, Options{Config: GoogleConfig(webhook), StoreBase: fake.Server.URL, Secrets: GoogleSecrets()})
	return env, fake
}

// PlayReceipt posts a Play purchase token for a product (and base plan, for a subscription).
func (e *Env) PlayReceipt(appUserID, token, productID, basePlanID string) *Response {
	e.T.Helper()
	body := jsobj.New("app_user_id", appUserID, "fetch_token", token, "product_ids", []any{productID})
	if basePlanID != "" {
		body.Set("platform_product_ids", []any{jsobj.New("product_id", productID, "base_plan_id", basePlanID, "offer_id", nil)})
	}
	return e.Call("/v1/receipts", CallOptions{Platform: "android", Body: body})
}
