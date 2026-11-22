package server_test

// Snapshots and intro eligibility after real purchases. Mirrors the parts of
// lite/test/snapshot.test.ts and lite/test/intro-eligibility.test.ts that post receipts.

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// beforeFirstExec runs a function just before the first Exec through it: in Refresh, between
// reading the ledger and saving the snapshot.
type beforeFirstExec struct {
	ledger.DB
	run  func()
	done bool
}

func (d *beforeFirstExec) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if !d.done {
		d.done = true
		d.run()
	}
	return d.DB.Exec(ctx, sql, args...)
}

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

func TestSnapshotRebuildRace(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	now := env.Clock.Now()
	ctx := t.Context()
	cfg, err := env.Loader.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	read := func(user string) *customerinfo.Read {
		r, err := customerinfo.ReadCustomerInfo(ctx, env.Pool, cfg.Projects["default"], user, customerinfo.RenderOptions{Now: now, RequestStore: "app_store"})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}

	t.Run("aren't saved by a rebuild that read the ledger before a later write", func(t *testing.T) {
		_, payload := env.PostAppleTransaction("snap-race", tu.Fields{"productId": "pro_annual", "expiresDate": now + 300*tu.Day})
		customerID := env.CustomerID("default", "snap-race")
		app := cfg.Apps["ios"]
		revoked := now - 1000
		refund, err := apple.TransactionRow(tu.Copy(payload, tu.Fields{"revocationDate": revoked, "revocationReason": 0}), app, app.Products["pro_annual"])
		if err != nil {
			t.Fatal(err)
		}

		// The rebuild reads the ledger; a refund commits before it saves.
		db := &beforeFirstExec{DB: env.Pool, run: func() {
			tx, err := env.Pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if err := ledger.UpsertTransaction(ctx, tx, refund, now); err != nil {
				t.Fatal(err)
			}
			if err := customerinfo.Invalidate(ctx, tx, customerID); err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
		}}
		if _, err := customerinfo.Refresh(ctx, db, cfg, customerID, now); err != nil {
			t.Fatal(err)
		}
		if !db.done {
			t.Fatal("the write didn't run")
		}
		want := customerinfo.ISO(revoked)
		if got := read("snap-race"); prop(got.Body, "subscriber", "entitlements", "pro", "expires_date") != want {
			t.Fatalf("stale: %s %s", got.Source, jsobj.Stringify(got.Body))
		}

		// The next rebuild stores the refunded CustomerInfo.
		if _, err := customerinfo.Refresh(ctx, env.Pool, cfg, customerID, now); err != nil {
			t.Fatal(err)
		}
		if got := read("snap-race"); got.Source != customerinfo.FromSnapshot || prop(got.Body, "subscriber", "entitlements", "pro", "expires_date") != want {
			t.Fatalf("%s %s", got.Source, jsobj.Stringify(got.Body))
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
