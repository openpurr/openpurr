package webhooks_test

// Checks delivery against golden-webhooks.json, what Lite's own code produces: signature headers,
// the request each attempt makes (URL, headers, body), the retry schedule and what each attempt
// records. Also checks that two first attempts racing for the same delivery send it once.

import (
	"context"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

func golden(t *testing.T) any {
	t.Helper()
	g, err := jsobj.Parse(testdata.GoldenWebhooks)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func prop(v any, path ...string) any {
	for _, p := range path {
		v, _ = jsobj.Prop(v, p)
	}
	return v
}

func list(v any) []any {
	l, _ := v.([]any)
	return l
}

func i64(v any) int64 { f, _ := v.(float64); return int64(f) }

func TestGoldenConstants(t *testing.T) {
	g := golden(t)
	var want []int64
	for _, d := range list(prop(g, "retryDelaysMs")) {
		want = append(want, i64(d))
	}
	if !slices.Equal(webhooks.RetryDelaysMs, want) {
		t.Errorf("retry delays %v, want %v", webhooks.RetryDelaysMs, want)
	}
	if webhooks.RetriesPerRun != int(i64(prop(g, "retriesPerRun"))) {
		t.Errorf("retries per run %d", webhooks.RetriesPerRun)
	}
}

func TestGoldenSignatures(t *testing.T) {
	for _, c := range list(prop(golden(t), "signatures")) {
		var secrets []string
		for _, s := range list(prop(c, "secrets")) {
			secrets = append(secrets, s.(string))
		}
		got := webhooks.SignatureHeader(secrets, prop(c, "body").(string), i64(prop(c, "nowMs")))
		if want := prop(c, "header").(string); got != want {
			t.Errorf("%v: got %s, want %s", secrets, got, want)
		}
	}
}

type recorded struct {
	url, method, body string
	headers           map[string]string
}

// fakeTransport records requests and answers from a case's answers.
type fakeTransport struct {
	mu       sync.Mutex
	answers  any
	requests []recorded
}

func (f *fakeTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	body, _ := io.ReadAll(r.Body)
	headers := map[string]string{}
	for k, v := range r.Header {
		headers[strings.ToLower(k)] = strings.Join(v, ", ")
	}
	url := r.URL.String()
	f.mu.Lock()
	f.requests = append(f.requests, recorded{url: url, method: r.Method, body: string(body), headers: headers})
	f.mu.Unlock()
	answer := prop(f.answers, url)
	if msg, ok := prop(answer, "throw").(string); ok {
		return nil, errors.New(msg)
	}
	status := 200
	if s, ok := prop(answer, "status").(float64); ok {
		status = int(s)
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
}

// The documented wording difference: Standard reads secrets from the environment, not Worker
// secrets.
func standardWording(s string) string { return strings.Replace(s, "Worker secret ", "Secret ", 1) }

func TestGoldenDelivery(t *testing.T) {
	g := golden(t)
	cfg, err := config.Parse(prop(g, "config"))
	if err != nil {
		t.Fatal(err)
	}
	now := i64(prop(g, "now"))
	signNow := i64(prop(g, "signNow"))
	secrets := prop(g, "secrets")
	pool := tu.Pool(t)
	ctx := context.Background()

	for _, c := range list(prop(g, "delivery")) {
		name := prop(c, "name").(string)
		t.Run(name, func(t *testing.T) {
			if _, err := pool.Exec(ctx, "TRUNCATE webhook_delivery, webhook_event"); err != nil {
				t.Fatal(err)
			}
			var ids []string
			for _, r := range list(prop(c, "rows")) {
				id := prop(r, "event_id").(string)
				ids = append(ids, id)
				if _, err := pool.Exec(ctx,
					`INSERT INTO webhook_event (id, dedupe_key, type, app_id, customer_id, environment, body, created_at)
					 VALUES ($1, $1, 'INITIAL_PURCHASE', $2, 'c', 'sandbox', $3, $4)`, id, prop(r, "app_id"), prop(r, "body"), now-1000); err != nil {
					t.Fatal(err)
				}
				if _, err := pool.Exec(ctx,
					`INSERT INTO webhook_delivery (event_id, endpoint, status, attempts, next_attempt_at, created_at)
					 VALUES ($1, $2, 'pending', $3, $4, $4)`, id, prop(r, "endpoint"), i64(prop(r, "attempts")), now-1000); err != nil {
					t.Fatal(err)
				}
			}
			transport := &fakeTransport{answers: prop(c, "answers")}
			d := &webhooks.Deliverer{
				DB:   pool,
				HTTP: &http.Client{Transport: transport},
				Secret: func(name string) (string, bool) {
					v, ok := prop(secrets, name).(string)
					return v, ok
				},
				Now: func() int64 { return signNow },
				Log: tu.Quiet,
			}
			var n int
			if prop(c, "kind") == "now" {
				n, err = d.DeliverNow(ctx, cfg, ids, now)
			} else {
				n, err = d.RetryDue(ctx, cfg, now)
			}
			if err != nil {
				t.Fatal(err)
			}
			if n != int(i64(prop(c, "attempted"))) {
				t.Errorf("attempted %d", n)
			}

			// Requests: Lite starts them in an order set by its promise scheduling; Standard sends
			// to different endpoints at once. Compared by URL.
			var want []recorded
			for _, r := range list(prop(c, "requests")) {
				headers := map[string]string{}
				h := prop(r, "headers").(*jsobj.Object)
				for _, k := range h.Keys() {
					v, _ := h.Get(k)
					headers[k] = v.(string)
				}
				want = append(want, recorded{url: prop(r, "url").(string), method: prop(r, "method").(string), body: prop(r, "body").(string), headers: headers})
			}
			got := transport.requests
			byURL := func(a, b recorded) int { return strings.Compare(a.url, b.url) }
			slices.SortStableFunc(got, byURL)
			slices.SortStableFunc(want, byURL)
			if len(got) != len(want) {
				t.Fatalf("%d requests, want %d", len(got), len(want))
			}
			for i := range want {
				if got[i].url != want[i].url || got[i].method != want[i].method || got[i].body != want[i].body {
					t.Errorf("request %s %s %s, want %s %s %s", got[i].method, got[i].url, got[i].body, want[i].method, want[i].url, want[i].body)
				}
				if jsobj.Stringify(toAny(got[i].headers)) != jsobj.Stringify(toAny(want[i].headers)) {
					t.Errorf("headers\n got %v\nwant %v", got[i].headers, want[i].headers)
				}
			}

			// What each attempt recorded.
			for _, u := range list(prop(c, "updates")) {
				args := list(u)
				eventID, endpoint := args[len(args)-2].(string), args[len(args)-1].(string)
				var status string
				var attempts int64
				var lastStatus, next, delivered *int64
				var lastError *string
				if err := pool.QueryRow(ctx,
					`SELECT status, attempts, last_status, last_error, next_attempt_at, delivered_at FROM webhook_delivery WHERE event_id = $1 AND endpoint = $2`,
					eventID, endpoint).Scan(&status, &attempts, &lastStatus, &lastError, &next, &delivered); err != nil {
					t.Fatal(err)
				}
				gotRow := jsobj.Stringify([]any{status, float64(attempts), num(lastStatus), str(lastError), num(next), num(delivered)})
				var wantRow string
				if len(args) == 5 { // delivered: attempts, last_status, delivered_at
					wantRow = jsobj.Stringify([]any{"delivered", args[0], args[1], nil, nil, args[2]})
				} else { // status, attempts, last_status, last_error, next_attempt_at
					wantRow = jsobj.Stringify([]any{args[0], args[1], args[2], standardWording(args[3].(string)), args[4], nil})
				}
				if gotRow != wantRow {
					t.Errorf("%s/%s\n got %s\nwant %s", eventID, endpoint, gotRow, wantRow)
				}
			}
		})
	}
}

func toAny(m map[string]string) *jsobj.Object {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	o := jsobj.New()
	for _, k := range keys {
		o.Set(k, m[k])
	}
	return o
}

func num(p *int64) any {
	if p == nil {
		return nil
	}
	return float64(*p)
}

func str(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// slowTransport answers 200 after the test lets it, counting requests.
type slowTransport struct {
	count   atomic.Int32
	release chan struct{}
}

func (s *slowTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	s.count.Add(1)
	<-s.release
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
}

func TestConcurrentAttemptsSendOnce(t *testing.T) {
	g := golden(t)
	cfg, err := config.Parse(prop(g, "config"))
	if err != nil {
		t.Fatal(err)
	}
	pool := tu.Pool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO webhook_event (id, dedupe_key, type, app_id, customer_id, environment, body, created_at) VALUES ('e1', 'e1', 'RENEWAL', 'ios', 'c', 'sandbox', '{}', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO webhook_delivery (event_id, endpoint, status, attempts, next_attempt_at, created_at) VALUES ('e1', 'plain', 'pending', 0, 1, 1)`); err != nil {
		t.Fatal(err)
	}
	transport := &slowTransport{release: make(chan struct{})}
	d := &webhooks.Deliverer{DB: pool, HTTP: &http.Client{Transport: transport}, Secret: func(string) (string, bool) { return "", false },
		Now: func() int64 { return 2 }, Log: tu.Quiet}

	// The first attempt and the retry job race: whichever claims the delivery first sends it; the
	// other skips it.
	var wg sync.WaitGroup
	var attempted atomic.Int32
	for i := range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var n int
			var err error
			if i == 0 {
				n, err = d.RetryDue(ctx, cfg, 2)
			} else {
				n, err = d.DeliverNow(ctx, cfg, []string{"e1"}, 2)
			}
			if err != nil {
				t.Error(err)
			}
			attempted.Add(int32(n))
		}()
	}
	// Let the winner start sending and the others reach the locked row, then let it finish.
	for transport.count.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond)
	close(transport.release)
	wg.Wait()
	if transport.count.Load() != 1 || attempted.Load() != 1 {
		t.Errorf("%d requests, %d attempted", transport.count.Load(), attempted.Load())
	}
}

func TestClaims(t *testing.T) {
	g := golden(t)
	cfg, err := config.Parse(prop(g, "config"))
	if err != nil {
		t.Fatal(err)
	}
	pool := tu.Pool(t)
	ctx := context.Background()
	insert := func(claimedUntil any) {
		t.Helper()
		for _, sql := range []string{
			"TRUNCATE webhook_delivery, webhook_event",
			`INSERT INTO webhook_event (id, dedupe_key, type, app_id, customer_id, environment, body, created_at) VALUES ('e1', 'e1', 'RENEWAL', 'ios', 'c', 'sandbox', '{}', 1)`,
		} {
			if _, err := pool.Exec(ctx, sql); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO webhook_delivery (event_id, endpoint, status, attempts, next_attempt_at, created_at, claimed_until) VALUES ('e1', 'plain', 'pending', 0, 1, 1, $1)`,
			claimedUntil); err != nil {
			t.Fatal(err)
		}
	}
	row := func() (attempts int, status string, claimed *int64) {
		t.Helper()
		if err := pool.QueryRow(ctx, "SELECT attempts, status, claimed_until FROM webhook_delivery").Scan(&attempts, &status, &claimed); err != nil {
			t.Fatal(err)
		}
		return
	}

	t.Run("a claim left by a server that stopped mid-attempt expires, then the retry job takes it", func(t *testing.T) {
		insert(int64(10_000))
		transport := &slowTransport{release: make(chan struct{})}
		close(transport.release)
		d := &webhooks.Deliverer{DB: pool, HTTP: &http.Client{Transport: transport}, Secret: func(string) (string, bool) { return "", false }, Now: func() int64 { return 0 }, Log: tu.Quiet}
		if n, err := d.RetryDue(ctx, cfg, 9_999); n != 0 || err != nil {
			t.Errorf("%d %v", n, err)
		}
		if n, err := d.DeliverNow(ctx, cfg, []string{"e1"}, 9_999); n != 0 || err != nil {
			t.Errorf("%d %v", n, err)
		}
		if n, err := d.RetryDue(ctx, cfg, 10_000); n != 1 || err != nil {
			t.Errorf("%d %v", n, err)
		}
		if attempts, status, claimed := row(); attempts != 1 || status != "delivered" || claimed != nil {
			t.Errorf("%d %s %v", attempts, status, claimed)
		}
	})

	t.Run("a replay takes over an attempt in progress", func(t *testing.T) {
		insert(nil)
		transport := &slowTransport{release: make(chan struct{})}
		d := &webhooks.Deliverer{DB: pool, HTTP: &http.Client{Transport: transport}, Secret: func(string) (string, bool) { return "", false }, Now: func() int64 { return 0 }, Log: tu.Quiet}
		done := make(chan error)
		go func() {
			_, err := d.DeliverNow(ctx, cfg, []string{"e1"}, 100)
			done <- err
		}()
		for transport.count.Load() == 0 {
			time.Sleep(time.Millisecond)
		}
		if _, _, claimed := row(); claimed == nil {
			t.Fatal("not claimed while sending")
		}
		if err := webhooks.Replay(ctx, pool, "e1", 200); err != nil {
			t.Fatal(err)
		}
		close(transport.release)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		// The first attempt's result isn't recorded over the replay; the replay's own attempt is.
		if attempts, status, _ := row(); attempts != 0 || status != "pending" {
			t.Errorf("%d %s", attempts, status)
		}
		if n, err := d.DeliverNow(ctx, cfg, []string{"e1"}, 300); n != 1 || err != nil {
			t.Errorf("%d %v", n, err)
		}
		if attempts, status, _ := row(); attempts != 1 || status != "delivered" || transport.count.Load() != 2 {
			t.Errorf("%d %s %d", attempts, status, transport.count.Load())
		}
	})
}
