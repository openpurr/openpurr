package apple

// Checks the App Store mapping, status, event planning, event bodies and API sync against what
// Lite's own code produces (internal/testdata/golden-apple.json, made by golden-apple.ts).

import (
	"encoding/json"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

var goldenJSON = testdata.GoldenApple

type golden struct {
	Now             int64           `json:"now"`
	Config          json.RawMessage `json:"config"`
	TransactionRows []struct {
		Name, Payload, Row, Error string
	} `json:"transactionRows"`
	SubscriptionStates []struct {
		Name, Renewal, State string
		Status               *int
	} `json:"subscriptionStates"`
	NotificationEvents []struct {
		Type, Subtype, Previous, Events string
		HasTransaction, ExpiresNull     bool
		Renewal                         *string
	} `json:"notificationEvents"`
	ReceiptEvents []struct {
		Name, Row, Events string
	} `json:"receiptEvents"`
	EventBodies []struct {
		Name, Type, AppID, Environment, Store, Body string
		Transaction, Extra, Experiments             *string
		NegativePrice                               bool
		PriceUSD                                    *float64 `json:"priceUsd"`
	} `json:"eventBodies"`
	Syncs []struct {
		Name, History, Statuses, Result, StatusesResult string
	} `json:"syncs"`
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

// rowJSON is a row as Lite's NewTransaction object.
func rowJSON(r ledger.NewTransaction) string {
	return jsobj.Stringify(jsobj.New(
		"app_id", r.AppID, "store", r.Store, "environment", r.Environment, "transaction_id", r.TransactionID,
		"original_transaction_id", r.OriginalTransactionID, "product_id", r.ProductID, "base_plan_id", ptrVal(r.BasePlanID),
		"product_type", r.ProductType, "purchased_at", float64(r.PurchasedAt), "original_purchased_at", float64(r.OriginalPurchasedAt),
		"expires_at", ptrVal(r.ExpiresAt), "period_type", r.PeriodType, "ownership_type", r.OwnershipType,
		"price_micros", ptrVal(r.PriceMicros), "currency", ptrVal(r.Currency), "storefront", ptrVal(r.Storefront),
		"revoked_at", ptrVal(r.RevokedAt), "revocation_reason", ptrVal(r.RevocationReason), "is_upgraded", float64(r.IsUpgraded),
		"verified", float64(r.Verified), "source", r.Source, "subscription_group", ptrVal(r.SubscriptionGroup),
	))
}

func stateJSON(s ledger.StateUpdate) *jsobj.Object {
	return jsobj.New(
		"store", s.Store, "original_transaction_id", s.OriginalTransactionID, "status", ptrVal(s.Status),
		"auto_renew", ptrVal(s.AutoRenew), "auto_renew_product_id", ptrVal(s.AutoRenewProductID),
		"expiration_intent", ptrVal(s.ExpirationIntent), "billing_issue", s.BillingIssue,
		"grace_period_expires_at", ptrVal(s.GracePeriodExpiresAt), "signed_at", float64(s.SignedAt),
	)
}

func eventsJSON(events []PlannedEvent) string {
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

func TestGolden(t *testing.T) {
	var g golden
	if err := json.Unmarshal(goldenJSON, &g); err != nil {
		t.Fatal(err)
	}
	raw, _ := jsobj.Parse(g.Config)
	cfg, err := config.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	ios := cfg.Apps["ios"]
	project := cfg.Projects["default"]

	t.Run("transaction rows", func(t *testing.T) {
		for _, c := range g.TransactionRows {
			payload := parse(t, c.Payload)
			pid, _ := jsobj.Prop(payload, "productId")
			row, err := TransactionRow(payload, ios, ios.Products[pid.(string)])
			got, want := "", c.Row
			if err != nil {
				got, want = "error: "+err.Error(), "error: "+c.Error
			} else {
				got = rowJSON(row)
			}
			if got != want {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, want)
			}
		}
	})

	t.Run("subscription states", func(t *testing.T) {
		for _, c := range g.SubscriptionStates {
			s, err := SubscriptionState(parse(t, c.Renewal), c.Status)
			if err != nil {
				t.Fatal(err)
			}
			if got := jsobj.Stringify(stateJSON(s)); got != c.State {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.State)
			}
		}
	})

	t.Run("notification events", func(t *testing.T) {
		const uuid = "11111111-2222-4333-8444-555555555555"
		base := `{"app_id":"ios","store":"app_store","environment":"sandbox","transaction_id":"2000000000000002",` +
			`"original_transaction_id":"2000000000000001","product_id":"pro_monthly","base_plan_id":null,"product_type":"subscription",` +
			`"purchased_at":` + jsobj.FormatNumber(float64(g.Now-86_400_000)) + `,"original_purchased_at":0,"expires_at":` +
			jsobj.FormatNumber(float64(g.Now+29*86_400_000)) + `,"period_type":"normal","ownership_type":"PURCHASED","price_micros":9990000,` +
			`"currency":"USD","storefront":"USA","revoked_at":null,"revocation_reason":null,"is_upgraded":0,"verified":1,"subscription_group":null}`
		for _, c := range g.NotificationEvents {
			var tx *ledger.Transaction
			if c.HasTransaction {
				r := rowFrom(t, base)
				if c.ExpiresNull {
					r.ExpiresAt = nil
				}
				tx = &r
			}
			var renewal any
			if c.Renewal != nil {
				renewal = parse(t, *c.Renewal)
			}
			got := eventsJSON(NotificationEvents(Notification{Type: c.Type, Subtype: c.Subtype, UUID: uuid}, tx, renewal, c.Previous))
			if got != c.Events {
				t.Errorf("%s %s\n got %s\nwant %s", c.Type, c.Subtype, got, c.Events)
			}
		}
	})

	t.Run("receipt events", func(t *testing.T) {
		for _, c := range g.ReceiptEvents {
			r := rowFrom(t, c.Row)
			if got := eventsJSON(ReceiptPurchaseEvents(&r, g.Now)); got != c.Events {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.Events)
			}
		}
	})

	t.Run("event bodies", func(t *testing.T) {
		attrs := jsobj.New("$email", jsobj.New("value", "a@example.com", "updated_at_ms", 5.0))
		attrs.Set("10", jsobj.New("value", "x", "updated_at_ms", 6.0))
		for _, c := range g.EventBodies {
			customer := &webhooks.Customer{
				ID: "c1", AppUserID: "user@example", OriginalAppUserID: "$RCAnonymousID:abc",
				Aliases: []string{"$RCAnonymousID:abc", "user@example"}, Attributes: attrs,
			}
			if c.Experiments != nil {
				customer.Experiments = parse(t, *c.Experiments).([]any)
			}
			in := webhooks.Input{Type: c.Type, DedupeKey: "k", AppID: "ios", Environment: c.Environment, Store: c.Store,
				Customer: customer, NegativePrice: c.NegativePrice, Now: g.Now}
			if c.Transaction != nil {
				r := rowFrom(t, *c.Transaction)
				in.Transaction = &r
			}
			if c.Extra != nil {
				in.Extra = parse(t, *c.Extra).(*jsobj.Object)
			}
			if got := jsobj.Stringify(webhooks.Body(project, in, "event-id", c.PriceUSD)); got != c.Body {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.Body)
			}
		}
	})

	t.Run("syncs", func(t *testing.T) {
		syncJSON := func(r *SyncResult, environment bool) string {
			txs := []any{}
			for _, x := range r.Transactions {
				v, _ := jsobj.Parse([]byte(rowJSON(x)))
				txs = append(txs, v)
			}
			states := []any{}
			for _, s := range r.States {
				states = append(states, stateJSON(s))
			}
			skipped := []any{}
			for _, s := range r.Skipped {
				skipped = append(skipped, s)
			}
			o := jsobj.New("transactions", txs, "states", states, "skipped", skipped)
			if environment {
				o.Set("environment", r.Environment)
			}
			return jsobj.Stringify(o)
		}
		for _, c := range g.Syncs {
			history := parse(t, c.History).([]any)
			var statuses []SubscriptionStatus
			var txs []any
			for _, s := range parse(t, c.Statuses).([]any) {
				st, _ := jsobj.Prop(s, "status")
				tx, _ := jsobj.Prop(s, "transaction")
				ren, _ := jsobj.Prop(s, "renewal")
				statuses = append(statuses, SubscriptionStatus{OriginalTransactionID: Str(s, "originalTransactionId"), Status: int(st.(float64)), Transaction: tx, Renewal: ren})
				txs = append(txs, tx)
			}
			res, err := toLedger(ios, append(txs, history...), statuses)
			if err != nil {
				t.Fatal(err)
			}
			res.Environment = "sandbox"
			if got := syncJSON(res, true); got != c.Result {
				t.Errorf("%s\n got %s\nwant %s", c.Name, got, c.Result)
			}
			only, err := toLedger(ios, txs, statuses)
			if err != nil {
				t.Fatal(err)
			}
			if got := syncJSON(only, false); got != c.StatusesResult {
				t.Errorf("%s (statuses only)\n got %s\nwant %s", c.Name, got, c.StatusesResult)
			}
		}
	})
}
