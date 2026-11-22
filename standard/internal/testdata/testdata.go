// Package testdata holds golden.json, golden-apple.json, golden-google.json, golden-webhooks.json,
// golden-auth.json, golden-metrics.json.gz and golden-mcp.json, generated from Lite's own code by
// the .ts files of the same names, so tests can check that Standard produces the same output byte
// for byte.
package testdata

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"io"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

//go:embed golden.json
var goldenJSON []byte

// GoldenApple is golden-apple.json: Lite's App Store mapping, events and event bodies
// (golden-apple.ts says how to regenerate it).
//
//go:embed golden-apple.json
var GoldenApple []byte

// GoldenGoogle is golden-google.json: Lite's Google Play mapping, events, event bodies and purchase
// verification (golden-google.ts says how to regenerate it).
//
//go:embed golden-google.json
var GoldenGoogle []byte

// GoldenWebhooks is golden-webhooks.json: Lite's webhook signatures, delivery requests, recorded
// results and retry schedule, and its ECB rate parsing (golden-webhooks.ts says how to regenerate
// it).
//
//go:embed golden-webhooks.json
var GoldenWebhooks []byte

// GoldenAuth is golden-auth.json: Lite's operator password hashes, TOTP codes, encrypted TOTP
// secrets, base32 and recovery codes (golden-auth.ts says how to regenerate it).
//
//go:embed golden-auth.json
var GoldenAuth []byte

// GoldenMetrics is golden-metrics.json.gz, uncompressed: Lite's chart rollups (every metric_daily
// row, the rollup state and each run's result) and charts (JSON and CSV) for a set of ledgers
// (golden-metrics.ts says how to regenerate it).
func GoldenMetrics() []byte {
	r, err := gzip.NewReader(bytes.NewReader(goldenMetricsGz))
	if err != nil {
		panic(err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		panic(err)
	}
	return out
}

//go:embed golden-metrics.json.gz
var goldenMetricsGz []byte

// GoldenMCP is golden-mcp.json: Lite's answers from the MCP server, the OAuth authorization server
// and the dashboard's consent and connected-apps routes to a list of requests, from a seeded
// database, and the audit log they wrote (golden-mcp.ts says how to regenerate it).
//
//go:embed golden-mcp.json
var GoldenMCP []byte

// Golden is golden.json.
type Golden struct {
	Now          int64              `json:"now"`
	RenderNow    int64              `json:"renderNow"`
	TestConfig   json.RawMessage    `json:"testConfig"`
	GoldenConfig json.RawMessage    `json:"goldenConfig"`
	ConfigCases  []ConfigCase       `json:"configCases"`
	CustomerInfo []CustomerInfoCase `json:"customerInfoCases"`
}

type ConfigCase struct {
	Name            string            `json:"name"`
	Document        json.RawMessage   `json:"document"`
	Problems        []string          `json:"problems"`
	Version         string            `json:"version"`
	Stored          string            `json:"stored"`
	ProjectVersions map[string]string `json:"projectVersions"`
}

type CustomerInfoCase struct {
	Name         string        `json:"name"`
	AppUserID    string        `json:"appUserId"`
	Customer     *Customer     `json:"customer"`
	Transactions []Transaction `json:"transactions"`
	States       []State       `json:"states"`
	Grants       []Grant       `json:"grants"`
	RequestStore string        `json:"requestStore"`
	Snapshot     string        `json:"snapshot"`
	Rendered     string        `json:"rendered"`
}

type Customer struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	AppUserID string `json:"appUserId"`
	FirstSeen int64  `json:"firstSeen"`
}

type Transaction struct {
	AppID                 string  `json:"app_id"`
	Store                 string  `json:"store"`
	Environment           string  `json:"environment"`
	TransactionID         string  `json:"transaction_id"`
	OriginalTransactionID string  `json:"original_transaction_id"`
	ProductID             string  `json:"product_id"`
	BasePlanID            *string `json:"base_plan_id"`
	ProductType           string  `json:"product_type"`
	PurchasedAt           int64   `json:"purchased_at"`
	OriginalPurchasedAt   int64   `json:"original_purchased_at"`
	ExpiresAt             *int64  `json:"expires_at"`
	PeriodType            string  `json:"period_type"`
	OwnershipType         string  `json:"ownership_type"`
	PriceMicros           *int64  `json:"price_micros"`
	Currency              *string `json:"currency"`
	Storefront            *string `json:"storefront"`
	RevokedAt             *int64  `json:"revoked_at"`
	RevocationReason      *string `json:"revocation_reason"`
	IsUpgraded            int     `json:"is_upgraded"`
	Verified              int     `json:"verified"`
	SubscriptionGroup     *string `json:"subscription_group"`
}

type State struct {
	Store                  string  `json:"store"`
	OriginalTransactionID  string  `json:"original_transaction_id"`
	Status                 *int    `json:"status"`
	AutoRenew              *int    `json:"auto_renew"`
	AutoRenewProductID     *string `json:"auto_renew_product_id"`
	UnsubscribeDetectedAt  *int64  `json:"unsubscribe_detected_at"`
	BillingIssueDetectedAt *int64  `json:"billing_issue_detected_at"`
	GracePeriodExpiresAt   *int64  `json:"grace_period_expires_at"`
	AutoResumeAt           *int64  `json:"auto_resume_at"`
}

type Grant struct {
	ID            string  `json:"id"`
	EntitlementID string  `json:"entitlement_id"`
	Duration      string  `json:"duration"`
	StartsAt      int64   `json:"starts_at"`
	ExpiresAt     *int64  `json:"expires_at"`
	Note          *string `json:"note"`
	GrantedBy     *string `json:"granted_by"`
	Source        string  `json:"source"`
	CreatedAt     int64   `json:"created_at"`
	RevokedAt     *int64  `json:"revoked_at"`
	RevokedBy     *string `json:"revoked_by"`
}

// Load parses golden.json.
func Load() *Golden {
	var g Golden
	if err := json.Unmarshal(goldenJSON, &g); err != nil {
		panic(err)
	}
	return &g
}

// Value parses a raw JSON value with JavaScript semantics (key order kept).
func Value(raw json.RawMessage) any {
	v, err := jsobj.Parse(raw)
	if err != nil {
		panic(err)
	}
	return v
}

// TestConfig is lite/test/helpers.ts's rawTestConfig, as a fresh value.
func TestConfig() any { return Value(Load().TestConfig) }
