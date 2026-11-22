package testutil

// App Store test fixtures: a certificate chain shaped like Apple's (root, intermediate and leaf,
// with Apple's marker extensions), made once per test binary, and helpers that sign transactions
// and notifications with it the way lite/test/helpers.ts does. Plus a fake App Store Server API.

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/testdata"
)

const (
	BundleID    = "com.example.openpurr"
	APIIssuerID = "57246542-96fe-1a63-e053-0824d011072a"
	APIKeyID    = "TESTKEY123"
)

// Chain is a test signing chain.
type Chain struct {
	RootDER []byte
	// x5c: leaf, intermediate, root (base64 DER).
	X5C     []string
	LeafKey *ecdsa.PrivateKey
}

// Fixtures are the App Store test keys and chains.
type Fixtures struct {
	Chain
	// A leaf without Apple's marker extension, and one not signed by the intermediate.
	X5CLeafWithoutMarker []string
	X5CLeafWrongIssuer   []string
	// A complete chain under a root nobody trusts.
	Stray Chain
	// The App Store Connect In-App Purchase key (PKCS#8 PEM) and its key.
	APIKeyPEM string
	APIKey    *ecdsa.PrivateKey
}

var (
	fixturesOnce sync.Once
	fixtures     *Fixtures
)

var (
	oidLeafMarker         = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 11, 1}
	oidIntermediateMarker = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}
)

// ChainNotBefore and ChainNotAfter bound the test chain's validity.
var (
	ChainNotBefore = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	ChainNotAfter  = time.Date(2036, 1, 1, 0, 0, 0, 0, time.UTC)
)

func mustKey(curve elliptic.Curve) *ecdsa.PrivateKey {
	k, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		panic(err)
	}
	return k
}

var serial atomic.Int64

func mustCert(name string, pub, signerKey any, parent *x509.Certificate, ca bool, marker asn1.ObjectIdentifier) (*x509.Certificate, []byte) {
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(serial.Add(1)),
		Subject:               pkix.Name{CommonName: name, Organization: []string{"openpurr tests"}},
		NotBefore:             ChainNotBefore,
		NotAfter:              ChainNotAfter,
		BasicConstraintsValid: true,
		IsCA:                  ca,
	}
	if marker != nil {
		tmpl.ExtraExtensions = []pkix.Extension{{Id: marker, Value: []byte{0x05, 0x00}}}
	}
	if parent == nil {
		parent = tmpl
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, signerKey)
	if err != nil {
		panic(err)
	}
	c, err := x509.ParseCertificate(der)
	if err != nil {
		panic(err)
	}
	return c, der
}

func makeChain() (Chain, *x509.Certificate, *ecdsa.PrivateKey, []byte) {
	rootKey := mustKey(elliptic.P384())
	root, rootDER := mustCert("Test Apple Root", &rootKey.PublicKey, rootKey, nil, true, nil)
	interKey := mustKey(elliptic.P256())
	inter, interDER := mustCert("Test WWDR", &interKey.PublicKey, rootKey, root, true, oidIntermediateMarker)
	leafKey := mustKey(elliptic.P256())
	_, leafDER := mustCert("Test Prod ECC Mac App Store", &leafKey.PublicKey, interKey, inter, false, oidLeafMarker)
	b64 := base64.StdEncoding.EncodeToString
	return Chain{RootDER: rootDER, X5C: []string{b64(leafDER), b64(interDER), b64(rootDER)}, LeafKey: leafKey}, inter, interKey, interDER
}

// AppleFixtures returns the test chains and keys.
func AppleFixtures() *Fixtures {
	fixturesOnce.Do(func() {
		chain, inter, interKey, interDER := makeChain()
		b64 := base64.StdEncoding.EncodeToString
		f := &Fixtures{Chain: chain}
		_, noMarker := mustCert("No marker", &chain.LeafKey.PublicKey, interKey, inter, false, nil)
		f.X5CLeafWithoutMarker = []string{b64(noMarker), b64(interDER), chain.X5C[2]}
		otherKey := mustKey(elliptic.P256())
		// Names the intermediate as its issuer but is signed by another key.
		impostor := *inter
		impostor.PublicKey = &otherKey.PublicKey
		_, wrong := mustCert("Wrong issuer", &chain.LeafKey.PublicKey, otherKey, &impostor, false, oidLeafMarker)
		f.X5CLeafWrongIssuer = []string{b64(wrong), b64(interDER), chain.X5C[2]}
		f.Stray, _, _, _ = makeChain()
		f.APIKey = mustKey(elliptic.P256())
		der, err := x509.MarshalPKCS8PrivateKey(f.APIKey)
		if err != nil {
			panic(err)
		}
		f.APIKeyPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
		fixtures = f
	})
	return fixtures
}

// SignJWS signs any payload as an App Store JWS with the test chain (or the given x5c and key).
func SignJWS(payload any) string {
	f := AppleFixtures()
	return SignJWSWith(payload, f.X5C, f.LeafKey)
}

// SignJWSWith signs with a specific x5c and key.
func SignJWSWith(payload any, x5c []string, key *ecdsa.PrivateKey) string {
	list := make([]any, len(x5c))
	for i, c := range x5c {
		list[i] = c
	}
	enc := func(v any) string { return base64.RawURLEncoding.EncodeToString([]byte(jsobj.Stringify(v))) }
	input := enc(jsobj.New("alg", "ES256", "x5c", list)) + "." + enc(payload)
	digest := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		panic(err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}

var nextID atomic.Int64

func init() { nextID.Store(2000000000000000) }

// Fields are payload overrides; a nil value removes the field (Lite's `expiresDate: undefined`).
type Fields map[string]any

// Transaction builds a signed-transaction payload like Lite's signTransaction, with overrides
// applied in place (new fields at the end), at server time now.
func Transaction(now int64, overrides Fields) *jsobj.Object {
	id := strconv.FormatInt(nextID.Add(1), 10)
	purchase := float64(now - Day)
	if v, ok := overrides["purchaseDate"].(float64); ok {
		purchase = v
	} else if v, ok := overrides["purchaseDate"].(int64); ok {
		purchase = float64(v)
	}
	tx := jsobj.New(
		"transactionId", id,
		"originalTransactionId", id,
		"bundleId", BundleID,
		"productId", "pro_monthly",
		"purchaseDate", purchase,
		"originalPurchaseDate", purchase,
		"expiresDate", purchase+float64(30*Day),
		"type", "Auto-Renewable Subscription",
		"inAppOwnershipType", "PURCHASED",
		"environment", "Sandbox",
		"price", 9990.0,
		"currency", "USD",
		"storefront", "USA",
	)
	apply(tx, overrides)
	return tx
}

// apply sets overrides in a stable order (Go maps aren't ordered): the keys of Lite's payload
// first, then the rest alphabetically.
func apply(o *jsobj.Object, overrides Fields) {
	keys := make([]string, 0, len(overrides))
	for k := range overrides {
		keys = append(keys, k)
	}
	sortStrings(keys)
	for _, k := range keys {
		v := overrides[k]
		switch x := v.(type) {
		case nil:
			o.Delete(k)
			continue
		case int64:
			v = float64(x)
		case int:
			v = float64(x)
		}
		o.Set(k, v)
	}
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// Copy returns a copy of a payload with overrides (Lite's `{ ...payload, ...overrides }`).
func Copy(payload *jsobj.Object, overrides Fields) *jsobj.Object {
	c := payload.Clone()
	apply(c, overrides)
	return c
}

// NotificationSpec is lite/test/helpers.ts signNotification's argument.
type NotificationSpec struct {
	Type, Subtype string
	Transaction   *jsobj.Object
	// Renewal overrides; set (even empty) to include renewal info without a transaction.
	Renewal    Fields
	HasRenewal bool
	Status     *int
	BundleID   string
	UUID       string
	SignedDate int64
}

// Status is a helper for NotificationSpec.Status.
func Status(n int) *int { return &n }

// SignNotification signs an App Store Server Notification V2 in three layers like Apple's: the
// outer payload, and the transaction and renewal info inside it. now is the server's time.
func SignNotification(now int64, n NotificationSpec) (string, *jsobj.Object) {
	signed := n.SignedDate
	if signed == 0 {
		signed = now
	}
	var renewal *jsobj.Object
	if n.Renewal != nil || n.HasRenewal || n.Transaction != nil {
		orig, product := "", ""
		var autoRenewProduct any
		if n.Transaction != nil {
			o, _ := n.Transaction.Get("originalTransactionId")
			p, _ := n.Transaction.Get("productId")
			orig, product = o.(string), p.(string)
			autoRenewProduct = product
		}
		renewal = jsobj.New("originalTransactionId", orig, "productId", product)
		if autoRenewProduct != nil {
			renewal.Set("autoRenewProductId", autoRenewProduct)
		}
		renewal.Set("autoRenewStatus", 1.0)
		renewal.Set("signedDate", float64(signed))
		apply(renewal, n.Renewal)
	}
	uuid := n.UUID
	if uuid == "" {
		uuid = ledger.NewUUID()
	}
	bundle := n.BundleID
	if bundle == "" {
		bundle = BundleID
	}
	payload := jsobj.New("notificationType", n.Type)
	if n.Subtype != "" {
		payload.Set("subtype", n.Subtype)
	}
	payload.Set("notificationUUID", uuid)
	payload.Set("version", "2.0")
	payload.Set("signedDate", float64(signed))
	data := jsobj.New("appAppleId", 1234567890.0, "bundleId", bundle, "environment", "Sandbox")
	if n.Transaction != nil {
		data.Set("signedTransactionInfo", SignJWS(n.Transaction))
	}
	if renewal != nil {
		data.Set("signedRenewalInfo", SignJWS(renewal))
	}
	if n.Status != nil {
		data.Set("status", float64(*n.Status))
	}
	payload.Set("data", data)
	return SignJWS(payload), payload
}

// PostAppleTransaction signs a transaction (Transaction's overrides) and posts it for a user.
func (e *Env) PostAppleTransaction(appUserID string, overrides Fields) (*Response, *jsobj.Object) {
	e.T.Helper()
	tx := Transaction(e.Clock.Now(), overrides)
	res := e.Call("/v1/receipts", CallOptions{Body: jsobj.New("app_user_id", appUserID, "fetch_token", SignJWS(tx))})
	return res, tx
}

// PostNotification delivers a signed notification the way Apple does.
func (e *Env) PostNotification(signedPayload string) *Response {
	e.T.Helper()
	return e.Request(http.MethodPost, "/notifications/apple", jsobj.Stringify(jsobj.New("signedPayload", signedPayload)))
}

// Request is a plain HTTP request to the test server.
func (e *Env) Request(method, path, body string) *Response {
	e.T.Helper()
	req, err := http.NewRequest(method, e.Server.URL+path, strings.NewReader(body))
	if err != nil {
		e.T.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
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

// --- fake App Store Server API -----------------------------------------------------------------

// FakeRequest is one request the fake App Store Server API received.
type FakeRequest struct {
	Environment string
	Method      string
	Path        string
	// The path as sent, still percent-encoded.
	EscapedPath   string
	Query         string
	Authorization string
}

// AppleRoute answers one request: status (0 means 200) and a JSON body.
type AppleRoute func(r *http.Request) (int, any)

// FakeApple is a fake App Store Server API. Routes are "<environment> <METHOD> <path>", without
// the query; anything else answers 404 4040010, as Apple does for an unknown transaction.
type FakeApple struct {
	mu       sync.Mutex
	routes   map[string]AppleRoute
	requests []FakeRequest
	Server   *httptest.Server
}

// NewFakeApple starts a fake. Point the server's outbound client at it with Options.StoreBase.
func NewFakeApple(t interface{ Cleanup(func()) }) *FakeApple {
	f := &FakeApple{routes: map[string]AppleRoute{}}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Server.Close)
	return f
}

// Set replaces the routes.
func (f *FakeApple) Set(routes map[string]AppleRoute) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.routes = routes
}

// Requests are the requests received so far.
func (f *FakeApple) Requests() []FakeRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]FakeRequest(nil), f.requests...)
}

func (f *FakeApple) serve(w http.ResponseWriter, r *http.Request) {
	// The outbound rewrite sends https://<host>/<path> to <base>/<host>/<path>.
	rest := strings.TrimPrefix(r.URL.Path, "/")
	host, path, _ := strings.Cut(rest, "/")
	path = "/" + path
	env := "unknown"
	switch host {
	case "api.storekit.apple.com":
		env = "production"
	case "api.storekit-sandbox.apple.com":
		env = "sandbox"
	}
	f.mu.Lock()
	escaped := strings.TrimPrefix(r.URL.EscapedPath(), "/"+host)
	f.requests = append(f.requests, FakeRequest{Environment: env, Method: r.Method, Path: path, EscapedPath: escaped, Query: r.URL.RawQuery,
		Authorization: r.Header.Get("Authorization")})
	route := f.routes[env+" "+r.Method+" "+path]
	f.mu.Unlock()
	status, body := 404, any(jsobj.New("errorCode", 4040010.0, "errorMessage", "Transaction id not found."))
	if route != nil {
		status, body = route(r)
		if status == 0 {
			status = 200
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(jsobj.Stringify(body)))
}

// VerifyES256 checks a raw r||s ES256 signature over input.
func VerifyES256(key *ecdsa.PublicKey, input string, sig []byte) bool {
	digest := sha256.Sum256([]byte(input))
	return ecdsa.Verify(key, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:]))
}

// TestApp is the test config's iOS app, with App Store Server API access (key APPLE_IAP_KEY) when
// withAPI is set.
func TestApp(t testing.TB, withAPI bool) *config.App {
	t.Helper()
	raw := testdata.TestConfig()
	if withAPI {
		ios, _ := jsobj.Prop(raw, "apps")
		ios, _ = jsobj.Prop(ios, "ios")
		ios.(*jsobj.Object).Set("app_store_server_api", jsobj.New("issuer_id", APIIssuerID, "key_id", APIKeyID))
	}
	cfg, err := config.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return cfg.Apps["ios"]
}
