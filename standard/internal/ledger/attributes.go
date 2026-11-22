package ledger

// Subscriber attributes: what the SDK syncs with POST /v1/subscribers/{id}/attributes and inside
// POST /v1/receipts, as {"<key>": {"value": "...", "updated_at_ms": 1700000000000}}. A port of
// lite/src/attributes.ts.
//
// Rules follow RevenueCat's documentation:
//   - Custom keys start with a letter and use only letters, digits, "-" and "_", up to 40
//     characters; at most 50 custom attributes per customer.
//   - Keys starting with "$" are reserved ($email, $displayName, attribution keys...).
//   - Values are up to 500 characters. The SDK sends "" to clear an attribute; the row stays with
//     a NULL value so an older update can't bring it back.
//   - Attribution keys can't change once set, so the original install's attribution sticks.
// Updates apply only if their updated_at_ms is newer than what's stored, because the SDK can sync
// out of order.

import (
	"context"
	"math"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

type AttributeUpdate struct {
	Key string
	// Nil when cleared.
	Value     *string
	UpdatedAt int64
}

type AttributeError struct {
	KeyName string
	Message string
}

// JSON is the error as the SDK API reports it.
func (e AttributeError) JSON() *jsobj.Object {
	return jsobj.New("key_name", e.KeyName, "message", e.Message)
}

var (
	customKeyRE   = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,39}$`)
	reservedKeyRE = regexp.MustCompile(`^\$[A-Za-z][A-Za-z0-9_]{0,39}$`)
)

const maxValue = 500

// MaxCustomAttributes is the most custom attributes a customer can have.
const MaxCustomAttributes = 50

// AttributionKeys are kept from the original install, never overwritten.
var AttributionKeys = []string{
	"$mediaSource",
	"$campaign",
	"$adGroup",
	"$ad",
	"$keyword",
	"$creative",
	"$appleAdsCampaignId",
	"$appleAdsAdGroupId",
	"$appleAdsKeywordId",
	"$claimType",
	"$conversionType",
	"$appleAdsCountryOrRegion",
	"$supplyPlacement",
	"$appleAdsOrgId",
	"$appleAdsAdId",
}

func isCustom(key string) bool { return !strings.HasPrefix(key, "$") }

// Updates is an ordered set of attribute updates, by key.
type Updates struct {
	list []AttributeUpdate
}

func (u *Updates) Len() int                { return len(u.list) }
func (u *Updates) List() []AttributeUpdate { return u.list }
func (u *Updates) set(a AttributeUpdate)   { u.list = append(u.list, a) }
func (u *Updates) get(key string) *AttributeUpdate {
	for i := range u.list {
		if u.list[i].Key == key {
			return &u.list[i]
		}
	}
	return nil
}
func (u *Updates) remove(key string) {
	for i := range u.list {
		if u.list[i].Key == key {
			u.list = append(u.list[:i], u.list[i+1:]...)
			return
		}
	}
}

// ParseAttributes splits a request's attributes into valid updates and per-key errors.
func ParseAttributes(raw any, defined bool, now int64) (*Updates, []AttributeError) {
	updates := &Updates{}
	var errs []AttributeError
	if !defined || raw == nil {
		return updates, errs
	}
	obj, ok := raw.(*jsobj.Object)
	if !ok {
		return updates, append(errs, AttributeError{KeyName: "", Message: "attributes must be an object"})
	}
	for _, key := range obj.Keys() {
		entry, _ := obj.Get(key)
		re := reservedKeyRE
		if isCustom(key) {
			re = customKeyRE
		}
		if !re.MatchString(key) {
			errs = append(errs, AttributeError{KeyName: key, Message: "Invalid key: use letters, digits, - and _, up to 40 characters, starting with a letter."})
			continue
		}
		v, vOK := jsobj.Prop(entry, "value")
		var value *string
		if vOK && v != nil && v != "" {
			s, isStr := v.(string)
			if !isStr {
				errs = append(errs, AttributeError{KeyName: key, Message: "Value must be a string."})
				continue
			}
			if jsobj.UTF16Len(s) > maxValue {
				errs = append(errs, AttributeError{KeyName: key, Message: "Value is longer than 500 characters."})
				continue
			}
			value = &s
		}
		updatedAt := now
		if t, ok := jsobj.Prop(entry, "updated_at_ms"); ok {
			if f, isNum := t.(float64); isNum && !math.IsInf(f, 0) && !math.IsNaN(f) {
				updatedAt = clampInt64(f)
			}
		}
		if existing := updates.get(key); existing != nil {
			existing.Value, existing.UpdatedAt = value, updatedAt
		} else {
			updates.set(AttributeUpdate{Key: key, Value: value, UpdatedAt: updatedAt})
		}
	}
	return updates, errs
}

// clampInt64 converts an updated_at_ms to the bigint column (fractions dropped).
func clampInt64(f float64) int64 {
	if f >= math.MaxInt64 {
		return math.MaxInt64
	}
	if f <= math.MinInt64 {
		return math.MinInt64
	}
	return int64(f)
}

// EnforceCustomLimit drops new custom keys that would take the customer past the
// 50-custom-attribute limit. Existing keys can always be updated.
func EnforceCustomLimit(ctx context.Context, db DB, customerID string, updates *Updates) ([]AttributeError, error) {
	var errs []AttributeError
	var incoming []string
	for _, u := range updates.list {
		if isCustom(u.Key) {
			incoming = append(incoming, u.Key)
		}
	}
	if len(incoming) == 0 {
		return errs, nil
	}
	rows, err := db.Query(ctx, "SELECT key FROM subscriber_attribute WHERE customer_id = $1 AND key NOT LIKE '$%' AND value IS NOT NULL", customerID)
	if err != nil {
		return nil, err
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	existing := map[string]bool{}
	for _, k := range keys {
		existing[k] = true
	}
	count := len(existing)
	for _, key := range incoming {
		if existing[key] || updates.get(key).Value == nil {
			continue
		}
		if count >= MaxCustomAttributes {
			updates.remove(key)
			errs = append(errs, AttributeError{KeyName: key, Message: "Customers can have at most 50 custom attributes."})
		} else {
			count++
		}
	}
	return errs, nil
}

// WriteAttributes upserts every update in one statement.
func WriteAttributes(ctx context.Context, db DB, customerID string, updates *Updates, now int64) error {
	if updates.Len() == 0 {
		return nil
	}
	keys := make([]string, 0, updates.Len())
	values := make([]*string, 0, updates.Len())
	times := make([]int64, 0, updates.Len())
	for _, u := range updates.list {
		keys = append(keys, u.Key)
		values = append(values, u.Value)
		times = append(times, u.UpdatedAt)
	}
	_, err := db.Exec(ctx,
		`INSERT INTO subscriber_attribute (customer_id, key, value, updated_at, received_at)
		 SELECT $1, j.key, j.value, j.updated_at, $2 FROM unnest($3::text[], $4::text[], $5::bigint[]) AS j(key, value, updated_at)
		 ON CONFLICT (customer_id, key) DO UPDATE SET
		   value = excluded.value, updated_at = excluded.updated_at, received_at = excluded.received_at
		 WHERE excluded.updated_at > subscriber_attribute.updated_at
		   AND NOT (subscriber_attribute.key = ANY($6::text[]) AND subscriber_attribute.value IS NOT NULL)`,
		customerID, now, keys, values, times, AttributionKeys)
	return err
}

// ReadAttributes returns a customer's current attributes (for secret-key reads, webhooks and the
// admin API), as {"<key>": {"value": "...", "updated_at_ms": n}}.
func ReadAttributes(ctx context.Context, db DB, customerID string) (*jsobj.Object, error) {
	rows, err := db.Query(ctx, `SELECT key, value, updated_at FROM subscriber_attribute
		WHERE customer_id = $1 AND value IS NOT NULL ORDER BY key COLLATE "C"`, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := jsobj.New()
	for rows.Next() {
		var key, value string
		var updatedAt int64
		if err := rows.Scan(&key, &value, &updatedAt); err != nil {
			return nil, err
		}
		out.Set(key, jsobj.New("value", value, "updated_at_ms", float64(updatedAt)))
	}
	return out, rows.Err()
}
