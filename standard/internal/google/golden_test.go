package google

// Checks the Google Play mapping, status, event planning, event bodies and purchase verification
// against what Lite's own code produces (internal/testdata/golden-google.json, made by
// golden-google.ts).

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/outbound"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

type golden struct {
	Now    int64           `json:"now"`
	Config json.RawMessage `json:"config"`
	Money  []struct {
		Name   string
		Money  *string
		Result string
	} `json:"money"`
	SubscriptionRows []struct {
		Name, Sub, ProductID, Row, Error string
		Order                            *string
	} `json:"subscriptionRows"`
	SubscriptionStates []struct {
		Name, Sub, State string
	} `json:"subscriptionStates"`
	ProductRows []struct {
		Name, Product, ProductID, Row, Error string
		Order                                *string
	} `json:"productRows"`
	SubscriptionEvents []struct {
		Name, Type, Sub, Row, PreviousPeriodType, ReplacedProductID, Events string
	} `json:"subscriptionEvents"`
	OtherEvents []struct {
		Name, Row, Events string
	} `json:"otherEvents"`
	EventBodies []struct {
		Name, Type, Environment, Transaction, Body string
		Extra                                      *string
		NegativePrice                              bool
		PriceUSD                                   *float64 `json:"priceUsd"`
	} `json:"eventBodies"`
	Verifications []struct {
		Name, ProductID, Answers, Result, Error string
	} `json:"verifications"`
}

func parse(t *testing.T, s string) any {
	t.Helper()
	v, err := jsobj.Parse([]byte(s))
	if err != nil {
		t.Fatalf("%s: %v", s, err)
	}
	return v
}

func ptrVal[T any](p *T) any {
	if p == nil {
		return nil
	}
	switch v := any(*p).(type) {
	case int64:
		return float64(v)
	case int:
		return float64(v)
	}
	return *p
}

func rowValue(r ledger.NewTransaction) *jsobj.Object {
	return jsobj.New(
		"app_id", r.AppID, "store", r.Store, "environment", r.Environment, "transaction_id", r.TransactionID,
		"original_transaction_id", r.OriginalTransactionID, "product_id", r.ProductID, "base_plan_id", ptrVal(r.BasePlanID),
		"product_type", r.ProductType, "purchased_at", float64(r.PurchasedAt), "original_purchased_at", float64(r.OriginalPurchasedAt),
		"expires_at", ptrVal(r.ExpiresAt), "period_type", r.PeriodType, "ownership_type", r.OwnershipType,
		"price_micros", ptrVal(r.PriceMicros), "currency", ptrVal(r.Currency), "storefront", ptrVal(r.Storefront),
		"revoked_at", ptrVal(r.RevokedAt), "revocation_reason", ptrVal(r.RevocationReason), "is_upgraded", float64(r.IsUpgraded),
		"verified", float64(r.Verified), "source", r.Source, "subscription_group", ptrVal(r.SubscriptionGroup),
	)
}

func stateValue(s ledger.StateUpdate) *jsobj.Object {
	return jsobj.New(
		"store", s.Store, "original_transaction_id", s.OriginalTransactionID, "status", ptrVal(s.Status),
		"auto_renew", ptrVal(s.AutoRenew), "auto_renew_product_id", ptrVal(s.AutoRenewProductID),
		"expiration_intent", ptrVal(s.ExpirationIntent), "billing_issue", s.BillingIssue,
		"grace_period_expires_at", ptrVal(s.GracePeriodExpiresAt), "auto_resume_at", ptrVal(s.AutoResumeAt),
		"signed_at", float64(s.SignedAt),
	)
}

func eventsJSON(events []apple.PlannedEvent) string {
	list := []any{}
	for _, e := range events {
		o := jsobj.New("type", e.Type, "dedupeKey", e.DedupeKey)
		if e.Extra != nil {
			o.Set("extra", e.Extra)
		}
		if e.NegativePrice {
			o.Set("negativePrice", true)
		}
		list = append(list, o)
	}
	return jsobj.Stringify(list)
}

// rowFrom reads a Lite TransactionRow.
func rowFrom(t *testing.T, s string) ledger.Transaction {
	t.Helper()
	v := parse(t, s)
	str := func(k string) string { x, _ := jsobj.Prop(v, k); return jsobj.String(x, true) }
	optStr := func(k string) *string {
		if x, _ := jsobj.Prop(v, k); x != nil {
			s := jsobj.String(x, true)
			return &s
		}
		return nil
	}
	optMs := func(k string) *int64 {
		if x, _ := jsobj.Prop(v, k); x != nil {
			n := int64(x.(float64))
			return &n
		}
		return nil
	}
	n := func(k string) int64 { x, _ := jsobj.Prop(v, k); return int64(x.(float64)) }
	return ledger.Transaction{
		AppID: str("app_id"), Store: str("store"), Environment: str("environment"), TransactionID: str("transaction_id"),
		OriginalTransactionID: str("original_transaction_id"), ProductID: str("product_id"), BasePlanID: optStr("base_plan_id"),
		ProductType: str("product_type"), PurchasedAt: n("purchased_at"), OriginalPurchasedAt: n("original_purchased_at"),
		ExpiresAt: optMs("expires_at"), PeriodType: str("period_type"), OwnershipType: str("ownership_type"),
		PriceMicros: optMs("price_micros"), Currency: optStr("currency"), Storefront: optStr("storefront"),
		RevokedAt: optMs("revoked_at"), RevocationReason: optStr("revocation_reason"), IsUpgraded: int(n("is_upgraded")),
		Verified: int(n("verified")), SubscriptionGroup: optStr("subscription_group"),
	}
}

func loadGolden(t *testing.T) (*golden, *config.Config) {
	t.Helper()
	var g golden
	if err := json.Unmarshal(testdata.GoldenGoogle, &g); err != nil {
		t.Fatal(err)
	}
	raw, _ := jsobj.Parse(g.Config)
	cfg, err := config.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return &g, cfg
}

func optional(t *testing.T, s *string) any {
	if s == nil {
		return nil
	}
	return parse(t, *s)
}

func TestGolden(t *testing.T) {
	g, cfg := loadGolden(t)
	android := cfg.Apps["android"]
	project := cfg.Projects["default"]

	t.Run("money", func(t *testing.T) {
		for _, c := range g.Money {
			var got any
			if m := MoneyMicros(optional(t, c.Money)); m != nil {
				got = jsobj.New("micros", float64(m.Micros), "currency", m.Currency)
			}
			if s := jsobj.Stringify(got); s != c.Result {
				t.Errorf("%s\n got %s\nwant %s", c.Name, s, c.Result)
			}
		}
	})

	t.Run("subscription rows", func(t *testing.T) {
		for _, c := range g.SubscriptionRows {
			row, err := SubscriptionRow(parse(t, c.Sub), "tok-1", android, android.Products[c.ProductID], g.Now, optional(t, c.Order))
			got, want := "", c.Row
			if err != nil {
				got, want = "error: "+err.Error(), "error: "+c.Error
			} else {
				got = jsobj.Stringify(rowValue(row))
			}
			if got != want {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, want)
			}
		}
	})

	t.Run("subscription states", func(t *testing.T) {
		for _, c := range g.SubscriptionStates {
			s, err := SubscriptionState(parse(t, c.Sub), "tok-1", g.Now)
			if err != nil {
				t.Fatal(err)
			}
			if got := jsobj.Stringify(stateValue(s)); got != c.State {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.State)
			}
		}
	})

	t.Run("product rows", func(t *testing.T) {
		for _, c := range g.ProductRows {
			row, err := ProductRow(parse(t, c.Product), "tok-2", android, android.Products[c.ProductID], g.Now, optional(t, c.Order))
			got, want := "", c.Row
			switch {
			case err != nil:
				got, want = "error: "+err.Error(), "error: "+c.Error
			case row == nil:
				got = "null"
			default:
				got = jsobj.Stringify(rowValue(*row))
			}
			if got != want {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, want)
			}
		}
	})

	t.Run("subscription events", func(t *testing.T) {
		for _, c := range g.SubscriptionEvents {
			tx := rowFrom(t, c.Row)
			opts := EventOptions{PreviousPeriodType: c.PreviousPeriodType, ReplacedProductID: c.ReplacedProductID}
			if got := eventsJSON(SubscriptionEvents(parse(t, c.Type), "msg-1", parse(t, c.Sub), &tx, opts)); got != c.Events {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.Events)
			}
		}
	})

	t.Run("refund and one-time events", func(t *testing.T) {
		for _, c := range g.OtherEvents {
			tx := rowFrom(t, c.Row)
			e := OneTimePurchaseEvent(&tx)
			if c.Name == "refund" {
				e = RefundEvent(&tx)
			}
			if got := eventsJSON([]apple.PlannedEvent{e}); got != c.Events {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.Events)
			}
		}
	})

	t.Run("event bodies", func(t *testing.T) {
		for _, c := range g.EventBodies {
			customer := &webhooks.Customer{
				ID: "c1", AppUserID: "user@example", OriginalAppUserID: "$RCAnonymousID:abc",
				Aliases:    []string{"$RCAnonymousID:abc", "user@example"},
				Attributes: jsobj.New("$email", jsobj.New("value", "a@example.com", "updated_at_ms", 5.0)),
			}
			tx := rowFrom(t, c.Transaction)
			in := webhooks.Input{Type: c.Type, DedupeKey: "k", AppID: "android", Environment: c.Environment, Store: "play_store",
				Customer: customer, Transaction: &tx, NegativePrice: c.NegativePrice, Now: g.Now}
			if c.Extra != nil {
				in.Extra = parse(t, *c.Extra).(*jsobj.Object)
			}
			if got := jsobj.Stringify(webhooks.Body(project, in, "event-id", c.PriceUSD)); got != c.Body {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.Body)
			}
		}
	})

	t.Run("verifications", func(t *testing.T) {
		sa := testServiceAccount(t)
		for _, c := range g.Verifications {
			answers := parse(t, c.Answers)
			fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if strings.HasPrefix(r.URL.Path, "/oauth2.googleapis.com/") {
					_, _ = io.WriteString(w, `{"access_token":"ya29.test","expires_in":3600}`)
					return
				}
				key := ""
				switch {
				case strings.Contains(r.URL.Path, "/subscriptionsv2/"):
					key = "sub"
				case strings.Contains(r.URL.Path, "/purchases/products/"):
					key = "product"
				case strings.Contains(r.URL.Path, "/orders/"):
					key = "order"
				}
				a, ok := jsobj.Prop(answers, key)
				status := 404.0
				if ok {
					status = 200
					if s, has := jsobj.Prop(a, "status"); has {
						status = s.(float64)
					}
				}
				if status != 200 {
					w.WriteHeader(int(status))
					_, _ = io.WriteString(w, `{"error":{"message":"GET"}}`)
					return
				}
				body, _ := jsobj.Prop(a, "body")
				_, _ = io.WriteString(w, jsobj.Stringify(body))
			}))
			client := NewClient(sa, android.PackageName, outbound.NewClient(fake.URL), NewTokens(func() int64 { return g.Now }))
			p, err := VerifyPurchase(context.Background(), client, android, "tok-v", c.ProductID, g.Now, slog.New(slog.NewTextHandler(io.Discard, nil)))
			fake.Close()
			got, want := "", c.Result
			if err != nil {
				var apiErr *APIError
				var pending *PendingError
				var mapping *MappingError
				kind := "other"
				switch {
				case errors.As(err, &apiErr):
					kind = "api " + jsobj.FormatNumber(float64(apiErr.Status))
				case errors.As(err, &pending):
					kind = "pending"
				case errors.As(err, &mapping):
					kind = "mapping"
				}
				got, want = kind+": "+err.Error(), c.Error
			} else {
				txs, states := []any{}, []any{}
				for _, x := range p.Transactions {
					txs = append(txs, rowValue(x))
				}
				for _, s := range p.States {
					states = append(states, stateValue(s))
				}
				var ack, replaces any
				if p.Ack != nil {
					ack = jsobj.New("kind", p.Ack.Kind, "productId", p.Ack.ProductID, "purchaseToken", p.Ack.PurchaseToken)
				}
				if p.Replaces != "" {
					replaces = p.Replaces
				}
				got = jsobj.Stringify(jsobj.New("transactions", txs, "states", states, "postedTransactionId", p.PostedTransactionID, "ack", ack, "replaces", replaces))
			}
			if got != want {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, want)
			}
		}
	})
}

// testServiceAccount is a service account with a fresh RSA key.
func testServiceAccount(t *testing.T) ServiceAccount {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return ServiceAccount{
		ClientEmail:   "openpurr-test@test-project.iam.gserviceaccount.com",
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
	}
}
