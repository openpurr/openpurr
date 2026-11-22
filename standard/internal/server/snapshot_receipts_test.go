package server_test

// Snapshots and intro eligibility after real purchases. Mirrors the parts of
// lite/test/snapshot.test.ts and lite/test/intro-eligibility.test.ts that post receipts.

import (
	"testing"

	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func TestSnapshotsAfterPurchases(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()
	ctx := t.Context()
	read := func(user string) *customerinfo.Read {
		cfg, err := env.Loader.Get(ctx)
		if err != nil {
			t.Fatal(err)
		}
		r, err := customerinfo.ReadCustomerInfo(ctx, env.Pool, cfg.Projects["default"], user, customerinfo.RenderOptions{Now: now, RequestStore: "app_store"})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	withoutTime := func(body *jsobj.Object) string {
		b := body.Clone()
		b.Delete("request_date")
		b.Delete("request_date_ms")
		sub := prop(b, "subscriber").(*jsobj.Object).Clone()
		sub.Delete("last_seen")
		b.Set("subscriber", sub)
		return jsobj.Stringify(b)
	}

	t.Run("serve reads from one row after a purchase, identical to computing from the ledger", func(t *testing.T) {
		res, _ := env.PostAppleTransaction("snap-1", tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*tu.Day})
		fromSnapshot := read("snap-1")
		if fromSnapshot.Source != customerinfo.FromSnapshot || fromSnapshot.ETag != res.Header.Get("ETag") {
			t.Fatalf("%s %q %q", fromSnapshot.Source, fromSnapshot.ETag, res.Header.Get("ETag"))
		}
		env.Exec("DELETE FROM customer_snapshot")
		computed := read("snap-1")
		if computed.Source != customerinfo.FromComputed || withoutTime(computed.Body) != withoutTime(fromSnapshot.Body) {
			t.Fatalf("%s\n%s\n%s", computed.Source, withoutTime(computed.Body), withoutTime(fromSnapshot.Body))
		}
	})

	t.Run("send an ETag that changes when CustomerInfo does", func(t *testing.T) {
		first, _ := env.PostAppleTransaction("snap-etag", tu.Fields{"productId": "pro_monthly"})
		etag := first.Header.Get("ETag")
		got := env.Call("/v1/subscribers/snap-etag", tu.CallOptions{})
		if got.Status != 200 || got.Header.Get("ETag") != etag || len(etag) != 26 {
			t.Fatalf("%d %q %q", got.Status, got.Header.Get("ETag"), etag)
		}
		env.PostAppleTransaction("snap-etag", tu.Fields{"productId": "lifetime", "type": "Non-Consumable", "expiresDate": nil})
		if env.Call("/v1/subscribers/snap-etag", tu.CallOptions{}).Header.Get("ETag") == etag {
			t.Fatal("same ETag")
		}
	})

	t.Run("are rebuilt for a customer who loses a purchase in a transfer", func(t *testing.T) {
		_, payload := env.PostAppleTransaction("snap-alice", tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*tu.Day})
		receipt(env, "snap-bob", tu.SignJWS(payload), "is_restore", true)
		alice := read("snap-alice")
		if alice.Source != customerinfo.FromSnapshot || len(keys(prop(alice.Body, "subscriber", "entitlements"))) != 0 {
			t.Fatalf("%s %s", alice.Source, jsobj.Stringify(alice.Body))
		}
	})
}

func TestIntroEligibilityFromPurchases(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	// pro_monthly's group is learned from this transaction: the same group as pro_annual.
	env.PostAppleTransaction("elig-subscriber", tu.Fields{"productId": "pro_monthly", "subscriptionGroupIdentifier": "21000000"})
	if got := eligibility(env, "elig-subscriber", []string{"pro_annual", "pro_monthly"}, "", ""); got != `{"pro_annual":false,"pro_monthly":false}` {
		t.Fatal(got)
	}
	if got := eligibility(env, "elig-other", []string{"pro_annual", "pro_monthly"}, "", ""); got != `{"pro_annual":true,"pro_monthly":true}` {
		t.Fatal(got)
	}
}
