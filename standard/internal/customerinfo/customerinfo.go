// Package customerinfo builds the CustomerInfo body from ledger rows, and keeps it precomputed in
// customer_snapshot. A port of lite/src/customer-info.ts and lite/src/snapshot.ts.
//
// Field requirements come from the SDK sources; see the CustomerInfo section of
// spec/sdk-wire-contract.md. Notable cross-platform constraints:
//   - iOS requires request_date and subscriber.original_app_user_id.
//   - Android requires subscriptions and non_subscriptions objects, purchase_date on each
//     entitlement, and original_purchase_date/store/is_sandbox on the purchase it points to.
//   - Android drops an entitlement whose product_identifier isn't a key in subscriptions or
//     non_subscriptions.
//   - iOS requires is_sandbox on every non_subscriptions entry, and finishes a consumable only
//     when its store_transaction_id appears there.
//   - Both SDKs decide whether an entitlement is active from its expires_date alone, compared
//     with request_date. grace_period_expires_date is never read.
//
// Value rules:
//   - An entitlement describes the purchase that grants it with the furthest-out expiry.
//     Lifetime (null expiry) beats any subscription. Ties go to the latest purchase.
//   - A subscriptions entry (keyed by product ID; Google base plans share one entry) describes
//     the purchase with the furthest-out expiry.
//   - A refund or revocation ends access at the revocation time: expires_date becomes that time
//     and refunded_at is set. Refunded one-time purchases are left out entirely, so they can't
//     grant an entitlement.
//   - During a store grace period, access continues to the end of grace. Because the SDKs only
//     read expires_date, both the subscription's and the entitlement's expires_date move to the
//     grace end, and grace_period_expires_date is set alongside.
//   - An upgraded transaction (Apple isUpgraded) no longer grants entitlements; the upgrade's own
//     transaction does.
//   - A promotional grant (given by an operator) appears the way RevenueCat shows one: a
//     subscriptions entry with store "promotional" and product "rc_promo_<entitlement>_<duration>"
//     (both SDKs know that store), and the entitlement points at it when the grant gives more
//     access than any purchase: a later expiry, or lifetime. Revoked grants are left out.
//
// The snapshot is built as a jsobj tree so it serializes exactly like Lite's JSON.stringify,
// which keeps snapshot bodies and ETags identical between editions.
package customerinfo

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// Apple subscription status values (App Store Server API), as stored in subscription_state.status.
const (
	AppleStatusActive       = 1
	AppleStatusExpired      = 2
	AppleStatusBillingRetry = 3
	AppleStatusGracePeriod  = 4
	AppleStatusRevoked      = 5
)

const appleManagementURL = "https://apps.apple.com/account/subscriptions"

// ISO formats epoch ms as RFC 3339 in whole seconds, like Lite's iso().
func ISO(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05Z")
}

func isoOrNull(ms *int64) any {
	if ms == nil {
		return nil
	}
	return ISO(*ms)
}

// truncSeconds is what Date.parse(iso(ms)) gives back.
func truncSeconds(ms int64) int64 {
	s := ms / 1000
	if ms < 0 && ms%1000 != 0 {
		s--
	}
	return s * 1000
}

type stateLookup func(t *ledger.Transaction) *ledger.SubscriptionState

// graceEnd is the grace period end that currently extends this transaction, if any.
func graceEnd(t *ledger.Transaction, state *ledger.SubscriptionState) *int64 {
	if t.ProductType != string(config.Subscription) || t.RevokedAt != nil || t.ExpiresAt == nil || state == nil {
		return nil
	}
	end := state.GracePeriodExpiresAt
	// Apple reports the grace end separately (after expires_date); Google extends expiryTime itself
	// to the end of grace, so there the two are equal.
	if state.Status != nil && *state.Status == AppleStatusGracePeriod && end != nil && *end >= *t.ExpiresAt {
		return end
	}
	return nil
}

// effectiveEnd is when access from this transaction ends: its expiry, extended by grace, cut
// short by a refund. Nil = never.
func effectiveEnd(t *ledger.Transaction, state *ledger.SubscriptionState) *int64 {
	if t.RevokedAt != nil {
		if t.ExpiresAt == nil {
			return t.RevokedAt
		}
		v := min(*t.ExpiresAt, *t.RevokedAt)
		return &v
	}
	if t.ProductType != string(config.Subscription) {
		return nil
	}
	if g := graceEnd(t, state); g != nil {
		return g
	}
	return t.ExpiresAt
}

// outlasts reports whether a ends later than b (nil = never ends). Ties go to the later purchase.
func outlasts(a, b *ledger.Transaction, stateOf stateLookup) bool {
	ea := effectiveEnd(a, stateOf(a))
	eb := effectiveEnd(b, stateOf(b))
	if !sameEnd(ea, eb) {
		return eb != nil && (ea == nil || *ea > *eb)
	}
	return a.PurchasedAt > b.PurchasedAt
}

func sameEnd(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// orderedTx is a JavaScript Map from a key to a transaction: insertion order kept.
type orderedTx struct {
	keys []string
	m    map[string]*ledger.Transaction
}

func newOrderedTx() *orderedTx { return &orderedTx{m: map[string]*ledger.Transaction{}} }

func (o *orderedTx) set(k string, t *ledger.Transaction) {
	if _, ok := o.m[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.m[k] = t
}

// Management is a subscription that could make management_url non-null.
type Management struct {
	Store     string
	AppID     string
	ProductID string
	End       int64
}

// PromotionalProductID is the product ID a promotional grant shows under, as RevenueCat names them.
func PromotionalProductID(entitlementID, duration string) string {
	return "rc_promo_" + entitlementID + "_" + duration
}

func price(t *ledger.Transaction) *jsobj.Object {
	if t.PriceMicros == nil || t.Currency == nil || *t.Currency == "" {
		return nil
	}
	return jsobj.New("amount", float64(*t.PriceMicros)/1e6, "currency", *t.Currency)
}

// ComputeSnapshot returns the time-independent part of CustomerInfo: what's stored in
// customer_snapshot. Fields that depend on the request time or the requesting app (request_date,
// last_seen, management_url) are added by Render. now is used for first_seen when there's no
// customer.
func ComputeSnapshot(appUserID string, loaded *ledger.Loaded, project *config.Project, now int64) *jsobj.Object {
	stateMap := map[string]*ledger.SubscriptionState{}
	for i := range loaded.States {
		s := &loaded.States[i]
		stateMap[s.Store+":"+s.OriginalTransactionID] = s
	}
	stateOf := func(t *ledger.Transaction) *ledger.SubscriptionState {
		return stateMap[t.Store+":"+t.OriginalTransactionID]
	}

	// Pick the transaction each subscriptions entry and each entitlement describes.
	subscriptionTx := newOrderedTx()
	entitlementTx := newOrderedTx()
	var nonSubKeys []string
	nonSubTxs := map[string][]*ledger.Transaction{}

	for i := range loaded.Transactions {
		t := &loaded.Transactions[i]
		if t.ProductType == string(config.Subscription) {
			current := subscriptionTx.m[t.ProductID]
			if current == nil || outlasts(t, current, stateOf) {
				subscriptionTx.set(t.ProductID, t)
			}
		} else {
			if t.RevokedAt != nil {
				continue // refunded one-time purchases grant nothing
			}
			if _, ok := nonSubTxs[t.ProductID]; !ok {
				nonSubKeys = append(nonSubKeys, t.ProductID)
			}
			nonSubTxs[t.ProductID] = append(nonSubTxs[t.ProductID], t)
		}
		if t.IsUpgraded != 0 {
			continue // replaced by the upgrade's own transaction
		}
		for _, id := range project.EntitlementsFor(t.AppID, t.ProductID, t.BasePlanID) {
			current := entitlementTx.m[id]
			if current == nil || outlasts(t, current, stateOf) {
				entitlementTx.set(id, t)
			}
		}
	}

	subscriptions := jsobj.New()
	for _, productID := range subscriptionTx.keys {
		t := subscriptionTx.m[productID]
		state := stateOf(t)
		var unsub, billing, resume *int64
		if state != nil {
			unsub, billing, resume = state.UnsubscribeDetectedAt, state.BillingIssueDetectedAt, state.AutoResumeAt
		}
		entry := jsobj.New(
			"purchase_date", ISO(t.PurchasedAt),
			"original_purchase_date", ISO(t.OriginalPurchasedAt),
			"expires_date", isoOrNull(effectiveEnd(t, state)),
			"store", t.Store,
			"is_sandbox", t.Environment == "sandbox",
			"period_type", t.PeriodType,
			"ownership_type", t.OwnershipType,
			"store_transaction_id", t.TransactionID,
			"unsubscribe_detected_at", isoOrNull(unsub),
			"billing_issues_detected_at", isoOrNull(billing),
			"grace_period_expires_date", isoOrNull(graceEnd(t, state)),
			"refunded_at", isoOrNull(t.RevokedAt),
			"auto_resume_date", isoOrNull(resume),
		)
		if p := price(t); p != nil {
			entry.Set("price", p)
		}
		if t.BasePlanID != nil && *t.BasePlanID != "" {
			entry.Set("product_plan_identifier", *t.BasePlanID)
		}
		subscriptions.Set(productID, entry)
	}

	nonSubscriptions := jsobj.New()
	for _, productID := range nonSubKeys {
		list := nonSubTxs[productID]
		sort.SliceStable(list, func(i, j int) bool { return list[i].PurchasedAt < list[j].PurchasedAt })
		entries := make([]any, 0, len(list))
		for _, t := range list {
			entry := jsobj.New(
				"id", t.TransactionID,
				"store_transaction_id", t.TransactionID,
				"purchase_date", ISO(t.PurchasedAt),
				"original_purchase_date", ISO(t.OriginalPurchasedAt),
				"store", t.Store,
				"is_sandbox", t.Environment == "sandbox",
			)
			if p := price(t); p != nil {
				entry.Set("price", p)
			}
			entries = append(entries, entry)
		}
		nonSubscriptions.Set(productID, entries)
	}

	entitlements := jsobj.New()
	// What each entitlement's expires_date reads as, for comparing with grants.
	entitlementEnd := map[string]*int64{}
	for _, id := range entitlementTx.keys {
		t := entitlementTx.m[id]
		end := effectiveEnd(t, stateOf(t))
		entry := jsobj.New(
			"expires_date", isoOrNull(end),
			"grace_period_expires_date", isoOrNull(graceEnd(t, stateOf(t))),
			"product_identifier", t.ProductID,
			"purchase_date", ISO(t.PurchasedAt),
		)
		if t.BasePlanID != nil && *t.BasePlanID != "" {
			entry.Set("product_plan_identifier", *t.BasePlanID)
		}
		entitlements.Set(id, entry)
		if end != nil {
			v := truncSeconds(*end)
			entitlementEnd[id] = &v
		} else {
			entitlementEnd[id] = nil
		}
	}

	// Promotional grants, furthest-out last so it wins a shared product key.
	var grants []*ledger.Grant
	for i := range loaded.Grants {
		g := &loaded.Grants[i]
		if g.RevokedAt == nil && project.HasEntitlement(g.EntitlementID) {
			grants = append(grants, g)
		}
	}
	sort.SliceStable(grants, func(i, j int) bool { return grantEnd(grants[i]) < grantEnd(grants[j]) })
	for _, g := range grants {
		product := PromotionalProductID(g.EntitlementID, g.Duration)
		subscriptions.Set(product, jsobj.New(
			"purchase_date", ISO(g.StartsAt),
			"original_purchase_date", ISO(g.StartsAt),
			"expires_date", isoOrNull(g.ExpiresAt),
			"store", "promotional",
			"is_sandbox", false,
			"period_type", "normal",
			"ownership_type", "PURCHASED",
			"store_transaction_id", g.ID,
			"unsubscribe_detected_at", nil,
			"billing_issues_detected_at", nil,
			"grace_period_expires_date", nil,
			"refunded_at", nil,
			"auto_resume_date", nil,
		))
		currentEnd, has := entitlementEnd[g.EntitlementID]
		moreAccess := !has || (currentEnd != nil && (g.ExpiresAt == nil || *g.ExpiresAt > *currentEnd))
		if moreAccess {
			entitlements.Set(g.EntitlementID, jsobj.New(
				"expires_date", isoOrNull(g.ExpiresAt),
				"grace_period_expires_date", nil,
				"product_identifier", product,
				"purchase_date", ISO(g.StartsAt),
			))
			if g.ExpiresAt != nil {
				v := truncSeconds(*g.ExpiresAt)
				entitlementEnd[g.EntitlementID] = &v
			} else {
				entitlementEnd[g.EntitlementID] = nil
			}
		}
	}

	originalAppUserID := appUserID
	firstSeen := now
	if loaded.Customer != nil {
		originalAppUserID = loaded.Customer.AppUserID
		firstSeen = loaded.Customer.FirstSeen
	}
	management := []any{}
	for _, productID := range subscriptionTx.keys {
		t := subscriptionTx.m[productID]
		if t.RevokedAt != nil {
			continue
		}
		var end float64
		if e := effectiveEnd(t, stateOf(t)); e != nil {
			end = float64(*e)
		}
		management = append(management, jsobj.New("store", t.Store, "app_id", t.AppID, "product_id", t.ProductID, "end", end))
	}

	return jsobj.New(
		"subscriber", jsobj.New(
			"original_app_user_id", originalAppUserID,
			"original_application_version", nil,
			"original_purchase_date", nil,
			"first_seen", ISO(firstSeen),
			"subscriptions", subscriptions,
			"non_subscriptions", nonSubscriptions,
			"other_purchases", jsobj.New(),
			"entitlements", entitlements,
			"subscriber_attributes", jsobj.New(),
		),
		"management", management,
	)
}

// grantEnd orders grants by expiry, lifetime last (JavaScript's `expires_at ?? Infinity`).
func grantEnd(g *ledger.Grant) float64 {
	if g.ExpiresAt == nil {
		return math.Inf(1)
	}
	return float64(*g.ExpiresAt)
}

// RenderOptions are the per-request inputs of CustomerInfo.
type RenderOptions struct {
	Now int64
	// The store of the requesting app ("" for server-to-server reads).
	RequestStore string
}

// Render returns the CustomerInfo body for one request: the snapshot plus the request time and
// management_url.
func Render(snapshot *jsobj.Object, project *config.Project, opts RenderOptions) *jsobj.Object {
	subV, _ := snapshot.Get("subscriber")
	sub, _ := subV.(*jsobj.Object)
	field := func(k string) any {
		v, _ := sub.Get(k)
		return v
	}
	return jsobj.New(
		"request_date", ISO(opts.Now),
		"request_date_ms", float64(opts.Now),
		"subscriber", jsobj.New(
			"original_app_user_id", field("original_app_user_id"),
			"original_application_version", field("original_application_version"),
			"original_purchase_date", field("original_purchase_date"),
			"first_seen", field("first_seen"),
			"last_seen", ISO(opts.Now),
			"management_url", managementURL(project, managementOf(snapshot), opts.Now, opts.RequestStore),
			"subscriptions", field("subscriptions"),
			"non_subscriptions", field("non_subscriptions"),
			"other_purchases", field("other_purchases"),
			"entitlements", field("entitlements"),
			"subscriber_attributes", field("subscriber_attributes"),
		),
	)
}

func managementOf(snapshot *jsobj.Object) []Management {
	v, _ := snapshot.Get("management")
	list, _ := v.([]any)
	out := make([]Management, 0, len(list))
	for _, e := range list {
		str := func(k string) string {
			v, _ := jsobj.Prop(e, k)
			s, _ := v.(string)
			return s
		}
		endV, _ := jsobj.Prop(e, "end")
		end, _ := endV.(float64)
		out = append(out, Management{Store: str("store"), AppID: str("app_id"), ProductID: str("product_id"), End: int64(end)})
	}
	return out
}

// managementURL is the store page where the user manages the active subscription. It prefers the
// requesting platform's store when it has one; otherwise the subscription that ends last. Nil if
// none.
func managementURL(project *config.Project, subs []Management, now int64, requestStore string) any {
	var active []Management
	for _, m := range subs {
		if m.End > now {
			active = append(active, m)
		}
	}
	if len(active) == 0 {
		return nil
	}
	var pick *Management
	for i := range active {
		if active[i].Store == requestStore {
			pick = &active[i]
			break
		}
	}
	if pick == nil {
		pick = &active[0]
		for i := 1; i < len(active); i++ {
			if active[i].End > pick.End {
				pick = &active[i]
			}
		}
	}
	if pick.Store == string(config.AppStore) {
		return appleManagementURL
	}
	q := "sku=" + formEncode(pick.ProductID)
	if app := project.Apps[pick.AppID]; app != nil && app.PackageName != "" {
		q += "&package=" + formEncode(app.PackageName)
	}
	return "https://play.google.com/store/account/subscriptions?" + q
}

// formEncode is URLSearchParams' encoding: only ASCII letters, digits and *-._ stay as they are,
// and spaces become "+".
func formEncode(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '*', c == '-', c == '.', c == '_':
			b.WriteByte(c)
		case c == ' ':
			b.WriteByte('+')
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
