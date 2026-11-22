package customerinfo

import (
	"testing"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/testdata"
)

// LoadedFrom turns a golden case's rows into what the ledger returns.
func loadedFrom(c testdata.CustomerInfoCase) *ledger.Loaded {
	l := &ledger.Loaded{}
	if c.Customer != nil {
		l.Customer = &ledger.Customer{ID: c.Customer.ID, ProjectID: c.Customer.ProjectID, AppUserID: c.Customer.AppUserID, FirstSeen: c.Customer.FirstSeen}
	}
	for _, t := range c.Transactions {
		l.Transactions = append(l.Transactions, ledger.Transaction{
			AppID: t.AppID, Store: t.Store, Environment: t.Environment, TransactionID: t.TransactionID,
			OriginalTransactionID: t.OriginalTransactionID, ProductID: t.ProductID, BasePlanID: t.BasePlanID,
			ProductType: t.ProductType, PurchasedAt: t.PurchasedAt, OriginalPurchasedAt: t.OriginalPurchasedAt,
			ExpiresAt: t.ExpiresAt, PeriodType: t.PeriodType, OwnershipType: t.OwnershipType, PriceMicros: t.PriceMicros,
			Currency: t.Currency, Storefront: t.Storefront, RevokedAt: t.RevokedAt, RevocationReason: t.RevocationReason,
			IsUpgraded: t.IsUpgraded, Verified: t.Verified, SubscriptionGroup: t.SubscriptionGroup,
		})
	}
	for _, s := range c.States {
		l.States = append(l.States, ledger.SubscriptionState{
			Store: s.Store, OriginalTransactionID: s.OriginalTransactionID, Status: s.Status, AutoRenew: s.AutoRenew,
			AutoRenewProductID: s.AutoRenewProductID, UnsubscribeDetectedAt: s.UnsubscribeDetectedAt,
			BillingIssueDetectedAt: s.BillingIssueDetectedAt, GracePeriodExpiresAt: s.GracePeriodExpiresAt, AutoResumeAt: s.AutoResumeAt,
		})
	}
	for _, g := range c.Grants {
		l.Grants = append(l.Grants, ledger.Grant{
			ID: g.ID, EntitlementID: g.EntitlementID, Duration: g.Duration, StartsAt: g.StartsAt, ExpiresAt: g.ExpiresAt,
			Note: g.Note, GrantedBy: g.GrantedBy, Source: g.Source, CreatedAt: g.CreatedAt, RevokedAt: g.RevokedAt, RevokedBy: g.RevokedBy,
		})
	}
	return l
}

// Every golden case: the same snapshot bytes (and so the same ETag) and the same rendered body as
// Lite's computeSnapshot and renderCustomerInfo.
func TestCustomerInfoMatchesLite(t *testing.T) {
	g := testdata.Load()
	cfg, err := config.Parse(testdata.Value(g.GoldenConfig))
	if err != nil {
		t.Fatal(err)
	}
	project := cfg.Projects["default"]
	for _, c := range g.CustomerInfo {
		t.Run(c.Name, func(t *testing.T) {
			snapshot := ComputeSnapshot(c.AppUserID, loadedFrom(c), project, g.Now)
			if got := jsobj.Stringify(snapshot); got != c.Snapshot {
				t.Fatalf("snapshot differs\n got: %s\nwant: %s", got, c.Snapshot)
			}
			// What's stored and read back renders the same as the fresh value.
			stored, err := jsobj.Parse([]byte(c.Snapshot))
			if err != nil {
				t.Fatal(err)
			}
			for _, s := range []*jsobj.Object{snapshot, stored.(*jsobj.Object)} {
				rendered := Render(s, project, RenderOptions{Now: g.RenderNow, RequestStore: c.RequestStore})
				if got := jsobj.Stringify(rendered); got != c.Rendered {
					t.Fatalf("rendered differs\n got: %s\nwant: %s", got, c.Rendered)
				}
			}
		})
	}
}

func TestETagFormat(t *testing.T) {
	if got := ETagOf("{}"); got != `"44136fa355b3678a1146ad16"` {
		t.Fatal(got)
	}
}

func TestISO(t *testing.T) {
	if got := ISO(1_800_000_000_999); got != "2027-01-15T08:00:00Z" {
		t.Fatal(got)
	}
}
