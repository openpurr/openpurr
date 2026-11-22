package server_test

// Webhook delivery: the first attempt after the response, Authorization and signature, retries
// with backoff from the retry job, giving up, missing secrets, removed endpoints and replay.
// Mirrors the delivery parts of lite/test/webhooks.test.ts and spec/conformance's webhooks suite.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/apple"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

func hmacHex(key, message string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

var signatureTime = regexp.MustCompile(`t=(\d+)`)

// checkSignature checks a delivery's signature header against its raw body and returns its time.
func checkSignature(t *testing.T, r tu.WebhookRequest) int64 {
	t.Helper()
	header := r.Header.Get("X-RevenueCat-Webhook-Signature")
	m := signatureTime.FindStringSubmatch(header)
	if m == nil {
		t.Fatalf("signature %q", header)
	}
	if want := "t=" + m[1] + ",v1=" + hmacHex(tu.WebhookSigningKey, m[1]+"."+r.Raw); header != want {
		t.Errorf("signature\n got %s\nwant %s", header, want)
	}
	n, _ := strconv.ParseInt(m[1], 10, 64)
	return n
}

type deliveryRow struct {
	status         string
	attempts       int
	lastStatus     *int
	lastError      *string
	nextAttemptAt  *int64
	deliveredAt    *int64
	endpoint, kind string
}

func deliveriesOf(t *testing.T, env *tu.Env) []deliveryRow {
	t.Helper()
	rows, err := env.Pool.Query(context.Background(),
		`SELECT d.status, d.attempts, d.last_status, d.last_error, d.next_attempt_at, d.delivered_at, d.endpoint, e.type
		 FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id ORDER BY d.created_at, e.type`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []deliveryRow
	for rows.Next() {
		var d deliveryRow
		if err := rows.Scan(&d.status, &d.attempts, &d.lastStatus, &d.lastError, &d.nextAttemptAt, &d.deliveredAt, &d.endpoint, &d.kind); err != nil {
			t.Fatal(err)
		}
		out = append(out, d)
	}
	return out
}

func startWithReceiver(t *testing.T, extra ...any) (*tu.Env, *tu.WebhookReceiver) {
	t.Helper()
	receiver := tu.NewWebhookReceiver(t)
	env := tu.Start(t, tu.Options{Config: receiver.WebhookConfig(nil, extra...), Secrets: tu.WebhookSecrets()})
	return env, receiver
}

func TestWebhookDelivery(t *testing.T) {
	t.Run("sends a RevenueCat-shaped INITIAL_PURCHASE, with Authorization and a verifiable signature", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		now := env.Clock.Now()
		tx := tu.Transaction(now, tu.Fields{"productId": "pro_annual", "expiresDate": now + 365*tu.Day})
		receipt(env, "wh-buyer", tu.SignJWS(tx), "attributes", jsobj.New("$email", jsobj.New("value", "b@example.com", "updated_at_ms", 1.0)))

		got := receiver.Received()
		if len(got) != 1 {
			t.Fatalf("%d deliveries", len(got))
		}
		req := got[0]
		if req.URL != receiver.URL("backend") || req.Method != http.MethodPost || req.Header.Get("Authorization") != tu.WebhookAuth ||
			req.Header.Get("Content-Type") != "application/json" || req.Header.Get("User-Agent") != "openpurr-webhooks" {
			t.Errorf("%s %s %v", req.Method, req.URL, req.Header)
		}
		// The body is the recorded event, as is.
		var stored string
		if err := env.Pool.QueryRow(context.Background(), "SELECT body FROM webhook_event").Scan(&stored); err != nil || stored != req.Raw {
			t.Errorf("sent %s\nstored %s (%v)", req.Raw, stored, err)
		}
		e := prop(req.Body, "event")
		if prop(req.Body, "api_version") != "1.0" || prop(e, "type") != "INITIAL_PURCHASE" || prop(e, "app_user_id") != "wh-buyer" ||
			prop(e, "price") != 9.99 || jsobj.Stringify(prop(e, "entitlement_ids")) != `["pro","annual_perks"]` ||
			jsobj.Stringify(prop(e, "subscriber_attributes")) != `{"$email":{"value":"b@example.com","updated_at_ms":1}}` {
			t.Errorf("%s", req.Raw)
		}
		if ts := checkSignature(t, req); ts != now/1000 {
			t.Errorf("signed at %d, now %d", ts, now)
		}
		d := deliveriesOf(t, env)
		if len(d) != 1 || d[0].status != "delivered" || d[0].attempts != 1 || *d[0].lastStatus != 200 || d[0].lastError != nil ||
			d[0].nextAttemptAt != nil || *d[0].deliveredAt != now {
			t.Errorf("%+v", d)
		}
	})

	t.Run("events from one change arrive in the order they were recorded", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		tx := subscribed(env, "wh-order", tu.Fields{"expiresDate": env.Clock.Now() - tu.Day})
		notify(env, tu.NotificationSpec{Type: "DID_FAIL_TO_RENEW", Transaction: tx, Status: tu.Status(apple.StatusBillingRetry)})
		var types []string
		for _, e := range receiver.Events() {
			types = append(types, prop(e, "type").(string))
		}
		if !slices.Equal(types, []string{"INITIAL_PURCHASE", "BILLING_ISSUE", "CANCELLATION", "EXPIRATION"}) {
			t.Errorf("%v", types)
		}
	})

	t.Run("a purchase reported by both the receipt and Apple's notification is sent once", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		tx := tu.Transaction(env.Clock.Now(), nil)
		receipt(env, "wh-dedupe", tu.SignJWS(tx))
		notify(env, tu.NotificationSpec{Type: "SUBSCRIBED", Subtype: "INITIAL_BUY", Transaction: tx, Status: tu.Status(1)})
		if n := len(receiver.Received()); n != 1 {
			t.Errorf("%d deliveries", n)
		}
	})

	t.Run("filters by environment", func(t *testing.T) {
		env, receiver := startWithReceiver(t, "environments", []any{"production"})
		env.PostAppleTransaction("wh-filter", nil) // a sandbox purchase
		if n := len(receiver.Received()); n != 0 {
			t.Errorf("%d deliveries", n)
		}
	})
}

func TestWebhookRetries(t *testing.T) {
	t.Run("retries failed deliveries from the scheduled job until they succeed", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		status := 500
		receiver.SetStatus(func(tu.WebhookRequest) int { return status })
		receipt(env, "wh-retry-delivery", tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
		first := deliveriesOf(t, env)[0]
		if first.status != "pending" || first.attempts != 1 || *first.lastStatus != 500 || *first.lastError != "HTTP 500" ||
			*first.nextAttemptAt != env.Clock.Now()+5*60_000 {
			t.Fatalf("%+v", first)
		}

		// Not due yet: nothing happens.
		env.Clock.Store(*first.nextAttemptAt - 1000)
		env.Deps.Jobs.RunAll(context.Background())
		if d := deliveriesOf(t, env)[0]; d.attempts != 1 {
			t.Errorf("%+v", d)
		}

		status = 200
		env.Clock.Store(*first.nextAttemptAt)
		env.Deps.Jobs.RunAll(context.Background())
		d := deliveriesOf(t, env)[0]
		if d.status != "delivered" || d.attempts != 2 || *d.lastStatus != 200 || d.nextAttemptAt != nil || d.lastError != nil {
			t.Errorf("%+v", d)
		}
		got := receiver.Received()
		if len(got) != 2 || prop(got[0].Body, "event", "id") != prop(got[1].Body, "event", "id") {
			t.Fatalf("%v", got)
		}
		// Each attempt is signed afresh.
		if ts := checkSignature(t, got[1]); ts != *first.nextAttemptAt/1000 {
			t.Errorf("signed at %d", ts)
		}
	})

	t.Run("gives up after about 72 hours of failures", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		receiver.SetStatus(func(tu.WebhookRequest) int { return 503 })
		receipt(env, "wh-give-up", tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
		last := env.Clock.Now()
		var total int64
		for _, delay := range webhooks.RetryDelaysMs {
			d := deliveriesOf(t, env)[0]
			if *d.nextAttemptAt-last != delay {
				t.Errorf("waited %d, want %d", *d.nextAttemptAt-last, delay)
			}
			total += delay
			last = *d.nextAttemptAt
			env.Clock.Store(last)
			env.Deps.Jobs.RunAll(context.Background())
		}
		d := deliveriesOf(t, env)[0]
		if d.status != "failed" || d.attempts != len(webhooks.RetryDelaysMs)+1 || d.nextAttemptAt != nil || *d.lastError != "HTTP 503" {
			t.Errorf("%+v", d)
		}
		if n := len(receiver.Received()); n != len(webhooks.RetryDelaysMs)+1 {
			t.Errorf("%d attempts", n)
		}
		if total != 72*3600_000 {
			t.Errorf("%d ms in all", total)
		}
	})

	t.Run("doesn't send at all when a configured secret is missing, and says why", func(t *testing.T) {
		receiver := tu.NewWebhookReceiver(t)
		env := tu.Start(t, tu.Options{Config: receiver.WebhookConfig(nil), Secrets: map[string]string{"WEBHOOK_SECRET": tu.WebhookSigningKey}})
		receipt(env, "wh-no-secret", tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
		d := deliveriesOf(t, env)[0]
		if len(receiver.Received()) != 0 || d.status != "pending" || *d.lastError != "Secret WEBHOOK_AUTH isn't set" || *d.lastStatus != 0 {
			t.Errorf("%+v", d)
		}
	})

	t.Run("stops when the endpoint is removed from the config", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		receiver.SetStatus(func(tu.WebhookRequest) int { return 500 })
		receipt(env, "wh-removed", tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
		if _, _, err := saveAndLoad(t, env, testdata.TestConfig()); err != nil {
			t.Fatal(err)
		}
		env.Clock.Add(5 * 60_000)
		if _, err := env.Deps.Webhooks.RetryDue(context.Background(), mustConfig(t, env), env.Clock.Now()); err != nil {
			t.Fatal(err)
		}
		d := deliveriesOf(t, env)[0]
		if d.status != "failed" || d.attempts != 2 || *d.lastError != "endpoint no longer configured" || d.nextAttemptAt != nil || len(receiver.Received()) != 1 {
			t.Errorf("%+v", d)
		}
	})

	t.Run("a backlog is retried oldest first, many per run", func(t *testing.T) {
		env, receiver := startWithReceiver(t)
		receiver.SetStatus(func(tu.WebhookRequest) int { return 500 })
		for i := range 45 {
			receipt(env, "wh-backlog-"+strconv.Itoa(i), tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
		}
		receiver.SetStatus(nil)
		receiver.Clear()
		env.Clock.Add(5 * 60_000)
		env.Deps.Jobs.RunAll(context.Background())
		if n := len(receiver.Received()); n != 45 {
			t.Errorf("%d retried", n)
		}
	})
}

func mustConfig(t *testing.T, env *tu.Env) *config.Config {
	t.Helper()
	cfg, err := env.Loader.Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestWebhookReplay(t *testing.T) {
	env, receiver := startWithReceiver(t)
	ctx := context.Background()
	receipt(env, "wh-replay", tu.SignJWS(tu.Transaction(env.Clock.Now(), nil)))
	original := receiver.Received()[0]
	id := prop(original.Body, "event", "id").(string)

	app, typ, found, err := webhooks.EventApp(ctx, env.Pool, id)
	if err != nil || !found || app != "ios" || typ != "INITIAL_PURCHASE" {
		t.Fatalf("%s %s %v %v", app, typ, found, err)
	}
	if _, _, found, err := webhooks.EventApp(ctx, env.Pool, "no-such-event"); found || err != nil {
		t.Errorf("%v %v", found, err)
	}

	env.Clock.Add(1000)
	if err := webhooks.Replay(ctx, env.Pool, id, env.Clock.Now()); err != nil {
		t.Fatal(err)
	}
	d := deliveriesOf(t, env)[0]
	if d.status != "pending" || d.attempts != 0 || *d.nextAttemptAt != env.Clock.Now()+300_000 || d.lastError != nil {
		t.Errorf("%+v", d)
	}
	if _, err := env.Deps.Webhooks.DeliverNow(ctx, mustConfig(t, env), []string{id}, env.Clock.Now()); err != nil {
		t.Fatal(err)
	}
	got := receiver.Received()
	if len(got) != 2 || got[1].Raw != original.Raw {
		t.Errorf("%v", got)
	}
	if d := deliveriesOf(t, env)[0]; d.status != "delivered" || d.attempts != 1 {
		t.Errorf("%+v", d)
	}

	list, err := webhooks.ListDeliveries(ctx, env.Pool, "delivered", 50)
	if err != nil || len(list) != 1 {
		t.Fatalf("%v %v", list, err)
	}
	want := `{"event_id":"` + id + `","endpoint":"backend","status":"delivered","attempts":1,"next_attempt_at":null,"last_status":200,` +
		`"last_error":null,"delivered_at":` + itoa(env.Clock.Now()) + `,"created_at":` + itoa(tu.T0) + `,"type":"INITIAL_PURCHASE","app_id":"ios","environment":"sandbox"}`
	if got := jsobj.Stringify(list[0]); got != want {
		t.Errorf("\n got %s\nwant %s", got, want)
	}
	if list, _ := webhooks.ListDeliveries(ctx, env.Pool, "failed", 50); len(list) != 0 {
		t.Errorf("%v", list)
	}
}

func TestGoogleWebhookDelivery(t *testing.T) {
	t.Run("a Play purchase and a refund found by the voided-purchases job are sent at once", func(t *testing.T) {
		receiver := tu.NewWebhookReceiver(t)
		fake := tu.NewFakeGoogle(t)
		env := tu.Start(t, tu.Options{Config: receiver.WebhookConfig(tu.GoogleConfig(false)), StoreBase: fake.Server.URL,
			Secrets: tu.MergeSecrets(tu.GoogleSecrets(), tu.WebhookSecrets())})
		now := env.Clock.Now()
		orderID := "GPA.9000-0000-0000-00002"
		var voided []any
		fake.SetSub("wh-play", tu.PlaySubscription(now, tu.PlaySub{Ack: true, OrderID: orderID, Expiry: now + 30*tu.Day}))
		fake.Route("GET /purchases/voidedpurchases", func(*http.Request) (int, any) { return 200, jsobj.New("voidedPurchases", voided) })
		env.PlayReceipt("wh-play-user", "wh-play", "pro", "monthly")
		voided = []any{jsobj.New("purchaseToken", "wh-play", "orderId", orderID, "voidedTimeMillis", strconv.FormatInt(now-1000, 10))}
		runJob(t, env, "poll-play-voided-purchases")
		var types []string
		for _, e := range receiver.Events() {
			types = append(types, prop(e, "type").(string)+"/"+jsobj.Stringify(prop(e, "store")))
		}
		if !slices.Equal(types, []string{`INITIAL_PURCHASE/"PLAY_STORE"`, `CANCELLATION/"PLAY_STORE"`}) {
			t.Errorf("%v", types)
		}
		for _, d := range deliveriesOf(t, env) {
			if d.status != "delivered" {
				t.Errorf("%+v", d)
			}
		}
	})
}
