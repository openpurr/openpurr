package ledger

// Introductory-offer eligibility for the iOS SDK's StoreKit 1 path
// (POST /v1/subscribers/{id}/intro_eligibility). StoreKit 2 apps compute this on the device. A
// port of lite/src/intro-eligibility.ts.
//
// Apple's rule: a customer can't get an introductory offer in a subscription group if they've ever
// subscribed to any product in that group. The answer per product is true, false, or null
// (unknown), which the SDK maps to eligible, ineligible and unknown.
//
// It's a display hint: Apple enforces the real rule at purchase time. So the unverified product
// IDs in the receipt the SDK sends are used, but only ever to answer "not eligible".

import (
	"context"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// groupsFor returns the subscription group per product: from the config, else learned from the
// ledger.
func groupsFor(ctx context.Context, db DB, app *config.App, productIDs []string) (map[string]string, error) {
	groups := map[string]string{}
	var unknown []string
	for _, id := range productIDs {
		if p := app.Products[id]; p != nil && p.SubscriptionGroup != "" {
			groups[id] = p.SubscriptionGroup
		} else {
			unknown = append(unknown, id)
		}
	}
	if len(unknown) > 0 {
		rows, err := db.Query(ctx,
			`SELECT product_id, max(subscription_group COLLATE "C") FROM store_transaction
			 WHERE store = 'app_store' AND product_id = ANY($1::text[]) AND subscription_group IS NOT NULL
			 GROUP BY product_id`, unknown)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id, group string
			if err := rows.Scan(&id, &group); err != nil {
				return nil, err
			}
			groups[id] = group
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return groups, nil
}

// IntroEligibility answers per requested product. history is the customer's App Store
// transactions; receiptProductIDs are the product IDs listed in the device's receipt (unverified).
func IntroEligibility(ctx context.Context, db DB, app *config.App, requested []string, history []Transaction, receiptProductIDs []string) (*jsobj.Object, error) {
	result := jsobj.New()
	for _, id := range requested {
		result.Set(id, nil)
	}
	if app.Store != config.AppStore {
		return result, nil
	}
	var subscriptions []string
	for _, id := range requested {
		if p := app.Products[id]; p != nil && p.Type == config.Subscription {
			subscriptions = append(subscriptions, id)
		}
	}
	if len(subscriptions) == 0 {
		return result, nil
	}

	var owned []string
	ownedSet := map[string]bool{}
	addOwned := func(id string) {
		if !ownedSet[id] {
			ownedSet[id] = true
			owned = append(owned, id)
		}
	}
	for _, id := range receiptProductIDs {
		addOwned(id)
	}
	for _, t := range history {
		if t.ProductType == string(config.Subscription) {
			addOwned(t.ProductID)
		}
	}
	var lookup []string
	lookupSet := map[string]bool{}
	for _, id := range append(append([]string{}, subscriptions...), owned...) {
		if !lookupSet[id] {
			lookupSet[id] = true
			lookup = append(lookup, id)
		}
	}
	groups, err := groupsFor(ctx, db, app, lookup)
	if err != nil {
		return nil, err
	}
	usedGroups := map[string]bool{}
	for _, t := range history {
		if t.ProductType == string(config.Subscription) && t.SubscriptionGroup != nil && *t.SubscriptionGroup != "" {
			usedGroups[*t.SubscriptionGroup] = true
		}
	}
	for _, id := range owned {
		if g, ok := groups[id]; ok && g != "" {
			usedGroups[g] = true
		}
	}
	for _, id := range subscriptions {
		if g, ok := groups[id]; ok && g != "" {
			result.Set(id, !usedGroups[g])
		}
	}
	return result, nil
}
