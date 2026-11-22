package server_test

// The scheduled jobs' housekeeping. Mirrors lite/test/scheduled.test.ts, the snapshot backfill of
// lite/test/snapshot.test.ts, and the cleanup parts of spec/conformance's scheduled, attributes
// and admin-api suites.

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// 2026-12-01T00:00:00Z, as in Lite's test.
const schedNow = int64(1_796_083_200_000)

func daysAgo(d int64) int64 { return schedNow - d*tu.Day }

func exists(t *testing.T, env *tu.Env, sql string, args ...any) bool {
	t.Helper()
	var n int
	if err := env.Pool.QueryRow(context.Background(), "SELECT count(*) FROM ("+sql+") x", args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n > 0
}

func insertCustomer(env *tu.Env, id string, firstSeen int64, purchase bool, aliasAt int64) {
	env.Exec("INSERT INTO customer (id, app_user_id, first_seen) VALUES ($1, $2, $3)", id, "user-"+id, firstSeen)
	if aliasAt == 0 {
		aliasAt = firstSeen
	}
	env.Exec("INSERT INTO customer_alias (project_id, app_user_id, customer_id, created_at) VALUES ('default', $1, $2, $3)", "user-"+id, id, aliasAt)
	if purchase {
		env.Exec("INSERT INTO purchase_owner (store, original_transaction_id, customer_id, app_id, updated_at) VALUES ('app_store', $1, $2, 'ios', $3)",
			"otx-"+id, id, firstSeen)
	}
}

func runJobs(env *tu.Env) {
	env.T.Helper()
	for _, r := range env.Deps.Jobs.RunAll(context.Background()) {
		if r.Error != "" {
			env.T.Errorf("job %s: %s", r.Job, r.Error)
		}
	}
	env.Deps.Deferred.Wait()
}

func TestScheduledJobs(t *testing.T) {
	t.Run("are registered in Lite's order, every 5 minutes or hourly", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		var got []string
		for _, j := range env.Deps.Jobs.Jobs() {
			got = append(got, j.Name+"/"+j.Every.String())
		}
		want := []string{"retry-webhooks/5m0s", "backfill-snapshots/5m0s", "prune-notification-payloads/1h0m0s", "prune-captures/1h0m0s",
			"prune-inactive-customers/1h0m0s", "prune-expired-apple-chains/1h0m0s", "prune-oauth/1h0m0s", "refresh-exchange-rates/1h0m0s",
			"retry-play-acknowledgements/1h0m0s", "poll-play-voided-purchases/1h0m0s", "rollup-metrics/1h0m0s"}
		if !slices.Equal(got, want) {
			t.Errorf("%v", got)
		}
	})

	t.Run("drops raw notification payloads after 30 days but keeps the summary row", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		for _, n := range []struct {
			id string
			at int64
		}{{"old", daysAgo(31)}, {"recent", daysAgo(1)}} {
			env.Exec(`INSERT INTO store_notification (store, notification_id, notification_type, environment, signed_at, received_at, payload)
				VALUES ('app_store', $1, 'DID_RENEW', 'sandbox', $2, $2, 'eyJ...')`, n.id, n.at)
		}
		env.Clock.Store(schedNow)
		runJobs(env)
		rows, _ := env.Pool.Query(context.Background(), "SELECT notification_id, coalesce(payload, 'null') FROM store_notification ORDER BY notification_id")
		var got []string
		for rows.Next() {
			var id, payload string
			_ = rows.Scan(&id, &payload)
			got = append(got, id+"="+payload)
		}
		rows.Close()
		if !slices.Equal(got, []string{"old=null", "recent=eyJ..."}) {
			t.Errorf("%v", got)
		}
	})

	t.Run("deletes inactive customers who never purchased, and nobody else", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		insertCustomer(env, "inactive", daysAgo(120), false, 0)
		insertCustomer(env, "buyer", daysAgo(120), true, 0)
		insertCustomer(env, "new", daysAgo(10), false, 0)
		insertCustomer(env, "logged-in-lately", daysAgo(120), false, daysAgo(5))
		insertCustomer(env, "granted", daysAgo(120), false, 0)
		env.Exec(`INSERT INTO promotional_grant (id, customer_id, entitlement_id, duration, starts_at, source, created_at)
			VALUES ('g1', 'granted', 'pro', 'lifetime', $1, 'dashboard', $1)`, daysAgo(120))
		insertCustomer(env, "synced-lately", daysAgo(120), false, 0)
		env.Exec("INSERT INTO subscriber_attribute (customer_id, key, value, updated_at, received_at) VALUES ('synced-lately', 'x', '1', 1, $1)", daysAgo(3))
		insertCustomer(env, "with-everything", daysAgo(200), false, 0)
		env.Exec("INSERT INTO subscriber_attribute (customer_id, key, value, updated_at, received_at) VALUES ('with-everything', 'x', '1', 1, $1)", daysAgo(150))
		env.Exec(`INSERT INTO customer_snapshot (customer_id, body, etag, config_version, updated_at) VALUES ('with-everything', '{}', '"x"', 'v', 1)`)

		env.Clock.Store(schedNow)
		runJobs(env)
		for _, id := range []string{"inactive", "with-everything"} {
			if exists(t, env, "SELECT 1 FROM customer WHERE id = $1", id) || exists(t, env, "SELECT 1 FROM customer_alias WHERE customer_id = $1", id) ||
				exists(t, env, "SELECT 1 FROM subscriber_attribute WHERE customer_id = $1", id) || exists(t, env, "SELECT 1 FROM customer_snapshot WHERE customer_id = $1", id) {
				t.Errorf("%s is still there", id)
			}
		}
		for _, id := range []string{"buyer", "new", "logged-in-lately", "granted", "synced-lately"} {
			if !exists(t, env, "SELECT 1 FROM customer WHERE id = $1", id) {
				t.Errorf("%s was deleted", id)
			}
		}
	})

	t.Run("keeps SDK customers until they've been inactive for 90 days", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		env.Call("/v1/subscribers/identify", tu.CallOptions{Body: jsobj.New("app_user_id", tu.Anon, "new_app_user_id", "user-recent")})
		env.Clock.Add(89 * tu.Day)
		runJobs(env)
		if env.CustomerID("default", "user-recent") == "" {
			t.Fatal("deleted too early")
		}
		env.Clock.Add(2 * tu.Day)
		runJobs(env)
		if env.CustomerID("default", "user-recent") != "" {
			t.Fatal("not deleted")
		}
	})

	t.Run("an attribute sync counts as activity", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		set := func(key string) {
			env.Call("/v1/subscribers/attr-active/attributes", tu.CallOptions{Body: jsobj.New("attributes", jsobj.New(key, jsobj.New("value", "1", "updated_at_ms", 1.0)))})
		}
		set("x")
		env.Clock.Add(110 * tu.Day)
		set("y")
		runJobs(env)
		if env.CustomerID("default", "attr-active") == "" {
			t.Fatal("deleted despite a recent sync")
		}
		env.Clock.Add(100 * tu.Day)
		runJobs(env)
		if env.CustomerID("default", "attr-active") != "" {
			t.Fatal("not deleted")
		}
	})

	t.Run("deletes old spike captures, expired Apple chains and stale OAuth state", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		iso := func(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }
		env.Exec("INSERT INTO capture (ts, method, path, headers) VALUES ($1, 'GET', '/old', '{}'), ($2, 'GET', '/new', '{}')", iso(daysAgo(30)), iso(daysAgo(1)))
		env.Exec(`INSERT INTO apple_verified_chain (fingerprint, leaf_spki, not_before, not_after, verified_at)
			VALUES ('expired', 'x', 0, $1, 0), ('valid', 'x', 0, $2, 0)`, daysAgo(1), schedNow+tu.Day)
		env.Exec(`INSERT INTO oauth_client (id, kind, name, redirect_uris, created_at) VALUES
			('old-unused', 'dcr', 'a', '[]', $1), ('new-unused', 'dcr', 'b', '[]', $2), ('old-used', 'dcr', 'c', '[]', $1)`, daysAgo(10), schedNow-1000)
		env.Exec(`INSERT INTO oauth_request (id, client_id, redirect_uri, code_challenge, scope, resource, created_at, expires_at) VALUES
			('expired', 'old-used', 'x', 'c', 'read', 'r', $1, $1), ('live', 'old-used', 'x', 'c', 'read', 'r', $2, $2)`, daysAgo(2), schedNow+60_000)
		env.Exec(`INSERT INTO operator (id, email, name, role, totp_enabled, created_at) VALUES ('op', 'o@example.com', 'O', 'owner', 0, 0)`)
		env.Exec(`INSERT INTO oauth_grant (id, client_id, operator_id, scopes, resource, refresh_expires_at, created_at, revoked_at) VALUES
			('revoked-long-ago', 'old-used', 'op', 'read', 'r', $2, 0, $1), ('refresh-expired', 'old-used', 'op', 'read', 'r', $1, 0, NULL),
			('active', 'old-used', 'op', 'read', 'r', $2, 0, NULL)`, daysAgo(31), schedNow+tu.Day)
		env.Clock.Store(schedNow)
		runJobs(env)
		column := func(sql string) string {
			rows, err := env.Pool.Query(context.Background(), sql)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var out []string
			for rows.Next() {
				var s string
				_ = rows.Scan(&s)
				out = append(out, s)
			}
			return strings.Join(out, ",")
		}
		for sql, want := range map[string]string{
			"SELECT path FROM capture":                     "/new",
			"SELECT fingerprint FROM apple_verified_chain": "valid",
			"SELECT id FROM oauth_client ORDER BY id":      "new-unused,old-used",
			"SELECT id FROM oauth_request":                 "live",
			"SELECT id FROM oauth_grant":                   "active",
		} {
			if got := column(sql); got != want {
				t.Errorf("%s: %s, want %s", sql, got, want)
			}
		}
	})
}

func TestSnapshotBackfill(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	for _, u := range []string{"bf-1", "bf-2", "bf-3"} {
		env.PostAppleTransaction(u, tu.Fields{"productId": "pro_monthly"})
	}
	etag := func(u string) string {
		return env.Call("/v1/subscribers/"+u, tu.CallOptions{}).Header.Get("ETag")
	}
	if etag("bf-1") == "" {
		t.Fatal("no snapshot after a purchase")
	}

	// Missing, from an older config, or outdated by a write whose rebuild never ran: all rebuilt.
	env.Exec("DELETE FROM customer_snapshot WHERE customer_id = $1", env.CustomerID("default", "bf-1"))
	env.Exec("UPDATE customer_snapshot SET config_version = 'old' WHERE customer_id = $1", env.CustomerID("default", "bf-2"))
	env.Exec("UPDATE customer SET ledger_version = ledger_version + 1 WHERE id = $1", env.CustomerID("default", "bf-3"))
	for _, u := range []string{"bf-1", "bf-2", "bf-3"} {
		if etag(u) != "" {
			t.Fatalf("%s still served from a snapshot", u)
		}
	}
	runJobs(env)
	for _, u := range []string{"bf-1", "bf-2", "bf-3"} {
		if etag(u) == "" {
			t.Errorf("%s wasn't rebuilt", u)
		}
	}
	// Customers of a project no longer in the config are left alone.
	env.Exec("INSERT INTO customer (id, app_user_id, first_seen, project_id) VALUES ('gone', 'gone', 1, 'gone')")
	runJobs(env)
	if exists(t, env, "SELECT 1 FROM customer_snapshot WHERE customer_id = 'gone'") {
		t.Error("built a snapshot for an unknown project")
	}
}
