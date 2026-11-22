package server_test

// Google Play's scheduled jobs: acknowledgement retries and voided-purchases polling. Mirrors
// lite/test/google-jobs.test.ts.

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// runJob runs one registered job now.
func runJob(t *testing.T, env *tu.Env, name string) {
	t.Helper()
	for _, j := range env.Deps.Jobs.Jobs() {
		if j.Name == name {
			if err := j.Run(context.Background(), env.Clock.Now()); err != nil {
				t.Fatal(err)
			}
			env.Deps.Deferred.Wait()
			return
		}
	}
	t.Fatalf("no job %s", name)
}

func TestGooglePlayJobs(t *testing.T) {
	t.Run("are registered", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		var names []string
		for _, j := range env.Deps.Jobs.Jobs() {
			names = append(names, j.Name)
		}
		if strings.Join(names, ",") != "retry-play-acknowledgements,poll-play-voided-purchases" {
			t.Errorf("%v", names)
		}
	})

	t.Run("retry failed acknowledgements, and drop ones too old to matter", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		env.Exec(`INSERT INTO play_ack_pending (purchase_token, app_id, product_id, kind, attempts, created_at)
			VALUES ('ack-retry', 'android', 'pro', 'subscription', 1, $1), ('ack-stale', 'android', 'pro', 'subscription', 5, $2),
			('ack-fail', 'android', 'lifetime', 'product', 2, $1)`, now-tu.Day, now-4*tu.Day)
		fake.Route("POST /purchases/products/lifetime/tokens/ack-fail:acknowledge", func(*http.Request) (int, any) { return 500, jsobj.New() })
		runJob(t, env, "retry-play-acknowledgements")
		if fake.Requested("POST /purchases/subscriptions/pro/tokens/ack-retry:acknowledge") != 1 ||
			fake.Requested("POST /purchases/subscriptions/pro/tokens/ack-stale:acknowledge") != 0 {
			t.Errorf("%v", fake.Requests())
		}
		var attempts int
		if err := env.Pool.QueryRow(context.Background(), "SELECT attempts FROM play_ack_pending WHERE purchase_token = 'ack-fail'").Scan(&attempts); err != nil || attempts != 3 {
			t.Errorf("attempts %d %v", attempts, err)
		}
		if n := env.Count("play_ack_pending"); n != 1 {
			t.Errorf("%d left", n)
		}
	})

	t.Run("a failed acknowledgement from a receipt is retried by the job", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		status := 503
		fake.SetSub("ack-later", tu.PlaySubscription(env.Clock.Now(), tu.PlaySub{}))
		fake.Route("POST /purchases/subscriptions/pro/tokens/ack-later:acknowledge", func(*http.Request) (int, any) { return status, jsobj.New() })
		env.PlayReceipt("ack-user", "ack-later", "pro", "monthly")
		if env.Count("play_ack_pending") != 1 {
			t.Fatal("not queued")
		}
		status = 200
		env.Deps.Jobs.RunAll(context.Background())
		if env.Count("play_ack_pending") != 0 || fake.Requested("POST /purchases/subscriptions/pro/tokens/ack-later:acknowledge") != 2 {
			t.Errorf("%v", fake.Requests())
		}
	})

	t.Run("poll voided purchases: refunds a missed order once, with a webhook event, and checkpoints", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, true)
		now := env.Clock.Now()
		orderID := "GPA.9000-0000-0000-00001"
		var voided []any
		fake.SetSub("vp-1", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: orderID, Expiry: now + 30*tu.Day}))
		fake.Route("GET /purchases/voidedpurchases", func(*http.Request) (int, any) { return 200, jsobj.New("voidedPurchases", voided) })
		env.PlayReceipt("vp-user", "vp-1", "pro", "monthly")
		mark := len(events(t, env))

		voidedAt := now - 1000
		voided = []any{jsobj.New("kind", "androidpublisher#voidedPurchase", "purchaseToken", "vp-1", "orderId", orderID,
			"voidedTimeMillis", strconv.FormatInt(voidedAt, 10), "voidedReason", 1.0)}
		version := ledgerVersion(t, env, "vp-user")
		runJob(t, env, "poll-play-voided-purchases")
		got := events(t, env)[mark:]
		if len(got) != 1 || prop(got[0], "type") != "CANCELLATION" || prop(got[0], "cancel_reason") != "CUSTOMER_SUPPORT" || prop(got[0], "transaction_id") != orderID {
			t.Errorf("%s", jsobj.Stringify(got))
		}
		if ledgerVersion(t, env, "vp-user") <= version {
			t.Error("the refund didn't bump the ledger version")
		}
		info := env.Call("/v1/subscribers/vp-user", tu.CallOptions{Platform: "android"}).JSON(t)
		if parseISO(t, prop(info, "subscriber", "entitlements", "pro", "expires_date")) >= now {
			t.Errorf("%s", jsobj.Stringify(info))
		}
		var revoked int64
		var reason string
		if err := env.Pool.QueryRow(context.Background(), "SELECT revoked_at, revocation_reason FROM store_transaction WHERE transaction_id = $1", orderID).Scan(&revoked, &reason); err != nil || revoked != voidedAt || reason != "voided" {
			t.Errorf("%d %s %v", revoked, reason, err)
		}

		// A second run doesn't refund it again, and asks only for what was voided since the last run.
		env.Clock.Add(3600_000)
		runJob(t, env, "poll-play-voided-purchases")
		if n := len(events(t, env)); n != mark+1 {
			t.Errorf("%d events", n)
		}
		var polls []tu.GoogleRequest
		for _, r := range fake.Requests() {
			if r.Path == "/purchases/voidedpurchases" {
				polls = append(polls, r)
			}
		}
		if len(polls) != 2 || polls[0].Query.Get("startTime") != strconv.FormatInt(now-30*tu.Day, 10) ||
			polls[1].Query.Get("startTime") != strconv.FormatInt(now, 10) || polls[0].Query.Get("type") != "1" || polls[0].Query.Get("maxResults") != "1000" {
			t.Errorf("%v", polls)
		}
		var checkpoint string
		if err := env.Pool.QueryRow(context.Background(), "SELECT value FROM job_state WHERE key = 'play_voided_checkpoint:android'").Scan(&checkpoint); err != nil || checkpoint != strconv.FormatInt(now+3600_000, 10) {
			t.Errorf("%q %v", checkpoint, err)
		}
	})

	t.Run("a backlog clears over several runs, oldest first", func(t *testing.T) {
		env, fake := tu.StartGoogle(t, false)
		now := env.Clock.Now()
		var voided []any
		for i := 0; i < 25; i++ {
			order := "GPA.backlog-" + strconv.Itoa(i)
			env.Purchase("default", "backlog-user", tu.Tx{AppID: "android", Store: "play_store", ProductID: "lifetime", ProductType: "non_consumable",
				TransactionID: order, OriginalTransactionID: "tok-" + strconv.Itoa(i)})
			voided = append(voided, jsobj.New("purchaseToken", "tok-"+strconv.Itoa(i), "orderId", order, "voidedTimeMillis", strconv.FormatInt(now-int64(100-i)*1000, 10)))
		}
		// Google answers what was voided since startTime.
		fake.Route("GET /purchases/voidedpurchases", func(r *http.Request) (int, any) {
			since, _ := strconv.ParseInt(r.URL.Query().Get("startTime"), 10, 64)
			var answer []any
			for _, v := range voided {
				at, _ := jsobj.Prop(v, "voidedTimeMillis")
				if n, _ := strconv.ParseInt(at.(string), 10, 64); n >= since {
					answer = append(answer, v)
				}
			}
			return 200, jsobj.New("voidedPurchases", answer)
		})
		runJob(t, env, "poll-play-voided-purchases")
		var revoked int
		_ = env.Pool.QueryRow(context.Background(), "SELECT count(*) FROM store_transaction WHERE revoked_at IS NOT NULL").Scan(&revoked)
		var checkpoint string
		_ = env.Pool.QueryRow(context.Background(), "SELECT value FROM job_state WHERE key = 'play_voided_checkpoint:android'").Scan(&checkpoint)
		if revoked != 20 || checkpoint != strconv.FormatInt(now-81_000, 10) {
			t.Errorf("%d revoked, checkpoint %s", revoked, checkpoint)
		}
		runJob(t, env, "poll-play-voided-purchases")
		_ = env.Pool.QueryRow(context.Background(), "SELECT count(*) FROM store_transaction WHERE revoked_at IS NOT NULL").Scan(&revoked)
		if revoked != 25 {
			t.Errorf("%d revoked", revoked)
		}
	})
}
