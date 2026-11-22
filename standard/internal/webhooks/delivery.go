package webhooks

// Delivery (the delivery half of lite/src/webhooks.ts):
//   - The first attempt runs right after the write commits (Deliverer.DeliverNow, from deferred
//     work). Failures are retried by the retry-webhooks job with backoff (RetryDelaysMs) for about
//     72 hours, then marked failed.
//   - At-least-once: consumers should deduplicate on event.id.
//   - Authorization: an optional fixed header value from a secret, as RevenueCat does.
//   - Signature: X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>, HMAC-SHA256 over
//     "<t>.<raw body>", the same scheme as RevenueCat. Recomputed on every attempt.
//
// Each attempt claims its deliveries (FOR UPDATE SKIP LOCKED, then a lease in claimed_until) and
// records the results afterwards, so with several replicas, or the first attempt racing the retry
// job, a delivery is attempted once at a time, and no database connection waits on an endpoint.
// If a server stops mid-attempt, the lease runs out and the retry job takes the delivery.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// Timeout bounds one delivery request.
const Timeout = 15 * time.Second

// RetriesPerRun is how many due deliveries one claim takes (Lite's RETRIES_PER_RUN).
const RetriesPerRun = 20

// ReplayDelayMs is when a replayed event's deliveries become due for the retry job, should the
// immediate attempt not run.
const ReplayDelayMs = 300_000

// Deliverer sends webhook deliveries.
type Deliverer struct {
	DB   ledger.TxDB
	HTTP *http.Client
	// Secret looks up a secret the config names.
	Secret func(name string) (string, bool)
	// Now is the server clock (signatures use it, as Lite signs with Date.now()).
	Now func() int64
	Log *slog.Logger
}

// SignatureHeader is the signature header value: t=<unix>,v1=<hex>[,v1=<hex>] (two during a key
// rotation).
func SignatureHeader(secrets []string, body string, nowMs int64) string {
	t := floorDiv(nowMs, 1000)
	parts := []string{"t=" + strconv.FormatInt(t, 10)}
	for _, s := range secrets {
		mac := hmac.New(sha256.New, []byte(s))
		mac.Write([]byte(strconv.FormatInt(t, 10) + "." + body))
		parts = append(parts, "v1="+hex.EncodeToString(mac.Sum(nil)))
	}
	return strings.Join(parts, ",")
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

func (d *Deliverer) secret(name string) string {
	if name == "" || d.Secret == nil {
		return ""
	}
	v, _ := d.Secret(name)
	return v
}

// Result is the outcome of one attempt: the HTTP status (0 when no response) and an error, ""
// on success.
type Result struct {
	Status int
	Error  string
}

// Send makes one delivery attempt of a raw event body to an endpoint.
func (d *Deliverer) Send(ctx context.Context, endpoint *config.Webhook, body string) Result {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("User-Agent", "openpurr-webhooks")
	auth := d.secret(endpoint.AuthorizationSecret)
	if auth != "" {
		header.Set("Authorization", auth)
	}
	signing := d.secret(endpoint.SigningSecret)
	if signing != "" {
		var keys []string
		for _, k := range strings.Split(signing, ",") {
			if k = strings.TrimSpace(k); k != "" {
				keys = append(keys, k)
			}
		}
		header.Set("X-Revenuecat-Webhook-Signature", SignatureHeader(keys, body, d.Now()))
	}
	if endpoint.AuthorizationSecret != "" && auth == "" {
		return Result{Error: "Secret " + endpoint.AuthorizationSecret + " isn't set"}
	}
	if endpoint.SigningSecret != "" && signing == "" {
		return Result{Error: "Secret " + endpoint.SigningSecret + " isn't set"}
	}

	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL, strings.NewReader(body))
	if err != nil {
		return Result{Error: requestError(err)}
	}
	req.Header = header
	res, err := d.HTTP.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) && ctx.Err() != nil {
			return Result{Error: "The operation was aborted due to timeout"}
		}
		return Result{Error: requestError(err)}
	}
	// The body isn't read.
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return Result{Status: res.StatusCode}
	}
	return Result{Status: res.StatusCode, Error: "HTTP " + strconv.Itoa(res.StatusCode)}
}

// requestError is the message of a failed request, without Go's `Post "<url>":` prefix.
func requestError(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	return err.Error()
}

type dueDelivery struct {
	eventID  string
	appID    string
	endpoint string
	attempts int
	body     string
}

// endpointFor is the endpoint a delivery goes to: webhook IDs are unique within a project, so
// it's looked up in the event's app's project. nil when it's no longer configured.
func endpointFor(cfg *config.Config, appID, id string) *config.Webhook {
	app := cfg.Apps[appID]
	if app == nil {
		return nil
	}
	project := cfg.Projects[app.ProjectID]
	if project == nil {
		return nil
	}
	for _, w := range project.Webhooks {
		if w.ID == id {
			return w
		}
	}
	return nil
}

// claimLease is how long an attempt's claim on a delivery lasts at least; longer when it sends
// several requests one after another.
const claimLease = 2 * time.Minute

// attempt claims the deliveries a query selects, attempts them, and records each result. It
// returns how many were attempted. The claim and the results are short transactions: no
// connection is held while waiting for an endpoint. Results are written only while the claim is
// still the attempt's own (a replay in between takes the delivery over).
//
// With inOrder, deliveries to the same endpoint go one after another in eventIDs' order (several
// events from one write arrive in the order they were written); otherwise every attempt runs at
// once, as Lite's retries do.
func (d *Deliverer) attempt(ctx context.Context, cfg *config.Config, now int64, inOrder bool, lease time.Duration, query string, args ...any) (int, error) {
	if lease < claimLease {
		lease = claimLease
	}
	claim := now + lease.Milliseconds()
	rows, err := d.DB.Query(ctx, query, append([]any{claim, now}, args...)...)
	if err != nil {
		return 0, err
	}
	due, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (dueDelivery, error) {
		var x dueDelivery
		err := r.Scan(&x.eventID, &x.appID, &x.endpoint, &x.attempts, &x.body)
		return x, err
	})
	if err != nil {
		return 0, err
	}
	if inOrder {
		// RETURNING has no order: put deliveries back in the order the events were written.
		position := map[string]int{}
		for i, id := range args[0].([]string) {
			if _, ok := position[id]; !ok {
				position[id] = i
			}
		}
		slices.SortStableFunc(due, func(a, b dueDelivery) int {
			if c := position[a.eventID] - position[b.eventID]; c != 0 {
				return c
			}
			return strings.Compare(a.endpoint, b.endpoint)
		})
	}

	results := make([]Result, len(due))
	endpoints := make([]*config.Webhook, len(due))
	// Indexes of the deliveries each worker sends, in order.
	var queues [][]int
	byEndpoint := map[*config.Webhook]int{}
	for i, row := range due {
		endpoints[i] = endpointFor(cfg, row.appID, row.endpoint)
		if endpoints[i] == nil {
			// The endpoint was removed from the config: stop trying.
			results[i] = Result{Error: "endpoint no longer configured"}
			continue
		}
		if q, ok := byEndpoint[endpoints[i]]; ok && inOrder {
			queues[q] = append(queues[q], i)
			continue
		}
		byEndpoint[endpoints[i]] = len(queues)
		queues = append(queues, []int{i})
	}
	var wg sync.WaitGroup
	for _, queue := range queues {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for _, i := range queue {
				results[i] = d.Send(ctx, endpoints[i], due[i].body)
			}
		}()
	}
	wg.Wait()

	// Recorded even if ctx ended meanwhile (a request may have gone out).
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	err = pgx.BeginFunc(wctx, d.DB, func(tx pgx.Tx) error {
		for i, row := range due {
			res := results[i]
			attempts := row.attempts + 1
			if res.Error == "" {
				if _, err := tx.Exec(wctx,
					`UPDATE webhook_delivery SET status = 'delivered', attempts = $1, last_status = $2, last_error = NULL,
					   delivered_at = $3, next_attempt_at = NULL, claimed_until = NULL
					 WHERE event_id = $4 AND endpoint = $5 AND claimed_until = $6`,
					attempts, res.Status, now, row.eventID, row.endpoint, claim); err != nil {
					return err
				}
				continue
			}
			status := "failed"
			var next *int64
			if endpoints[i] != nil && attempts-1 < len(RetryDelaysMs) {
				status = "pending"
				at := now + RetryDelaysMs[attempts-1]
				next = &at
			}
			if _, err := tx.Exec(wctx,
				`UPDATE webhook_delivery SET status = $1, attempts = $2, last_status = $3, last_error = $4, next_attempt_at = $5,
				   claimed_until = NULL
				 WHERE event_id = $6 AND endpoint = $7 AND claimed_until = $8`,
				status, attempts, res.Status, truncateUTF16(res.Error, 500), next, row.eventID, row.endpoint, claim); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return len(due), nil
}

// truncateUTF16 is JavaScript's s.slice(0, n): at most n UTF-16 code units (a pair isn't split).
func truncateUTF16(s string, n int) string {
	units := 0
	for i, r := range s {
		w := 1
		if utf16.RuneLen(r) == 2 {
			w = 2
		}
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

// claimDue claims (sets claimed_until = $1) the deliveries the inner query picks, among those not
// claimed at $2, and returns what sending them needs.
func claimDue(pick string) string {
	return `UPDATE webhook_delivery d SET claimed_until = $1
	FROM webhook_event e, (` + pick + ` FOR UPDATE SKIP LOCKED) c
	WHERE d.event_id = c.event_id AND d.endpoint = c.endpoint AND e.id = d.event_id
	RETURNING d.event_id, e.app_id, d.endpoint, d.attempts, e.body`
}

// DeliverNow makes the first attempt for freshly written events (deferred work after the
// response). Deliveries already attempted, or claimed by someone else, are left alone.
func (d *Deliverer) DeliverNow(ctx context.Context, cfg *config.Config, eventIDs []string, now int64) (int, error) {
	var ids []string
	for _, id := range eventIDs {
		if id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return 0, nil
	}
	return d.attempt(ctx, cfg, now, true, time.Duration(len(ids)+1)*Timeout, claimDue(
		`SELECT event_id, endpoint FROM webhook_delivery
		 WHERE event_id = ANY($3::text[]) AND status = 'pending' AND attempts = 0 AND (claimed_until IS NULL OR claimed_until <= $2)`), ids)
}

// RetryDue retries up to RetriesPerRun deliveries that are due, oldest due first.
func (d *Deliverer) RetryDue(ctx context.Context, cfg *config.Config, now int64) (int, error) {
	return d.attempt(ctx, cfg, now, false, 0, claimDue(
		`SELECT event_id, endpoint FROM webhook_delivery
		 WHERE status = 'pending' AND next_attempt_at <= $2 AND (claimed_until IS NULL OR claimed_until <= $2)
		 ORDER BY next_attempt_at LIMIT `+strconv.Itoa(RetriesPerRun)))
}

// AnyWebhooks says whether any project has a webhook endpoint (the retry job has nothing to do
// otherwise).
func AnyWebhooks(cfg *config.Config) bool {
	for _, p := range cfg.Projects {
		if len(p.Webhooks) > 0 {
			return true
		}
	}
	return false
}

// --- for the admin API ---------------------------------------------------------------------------

// EventApp is the app of an event, so the caller can check the principal may see it. found is
// false for an unknown event.
func EventApp(ctx context.Context, db ledger.DB, eventID string) (appID, eventType string, found bool, err error) {
	err = db.QueryRow(ctx, "SELECT app_id, type FROM webhook_event WHERE id = $1", eventID).Scan(&appID, &eventType)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	return appID, eventType, err == nil, err
}

// Replay queues every delivery of an event again: the same event (same id and body) goes out
// again, and consumers deduplicate on event.id. Run it in the transaction that audits the replay,
// then call DeliverNow with the event ID after the commit. An attempt in progress loses its claim,
// so its result isn't recorded over the replay's.
func Replay(ctx context.Context, tx ledger.DB, eventID string, now int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE webhook_delivery SET status = 'pending', attempts = 0, next_attempt_at = $1, last_error = NULL, claimed_until = NULL
		 WHERE event_id = $2`,
		now+ReplayDelayMs, eventID)
	return err
}

// DeliveryStatuses are the values of webhook_delivery.status.
var DeliveryStatuses = []string{"pending", "delivered", "failed"}

// ListDeliveries is GET /admin/v1/webhooks/deliveries' query: the newest deliveries, optionally of
// one status, with their event's type, app and environment, as objects with Lite's column names
// and order. limit is clamped to 1..200 by the caller (Lite: default 50, at most 200).
func ListDeliveries(ctx context.Context, db ledger.DB, status string, limit int) ([]*jsobj.Object, error) {
	query := `SELECT d.event_id, d.endpoint, d.status, d.attempts, d.next_attempt_at, d.last_status, d.last_error, d.delivered_at, d.created_at,
	            e.type, e.app_id, e.environment
	     FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id`
	args := []any{limit}
	if status != "" {
		query += " WHERE d.status = $2"
		args = append(args, status)
	}
	query += " ORDER BY d.created_at DESC, d.event_id, d.endpoint LIMIT $1"
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (*jsobj.Object, error) {
		var eventID, endpoint, st, typ, appID, environment string
		var attempts int64
		var next, lastStatus, delivered *int64
		var lastError *string
		var created int64
		if err := r.Scan(&eventID, &endpoint, &st, &attempts, &next, &lastStatus, &lastError, &delivered, &created, &typ, &appID, &environment); err != nil {
			return nil, err
		}
		return jsobj.New(
			"event_id", eventID, "endpoint", endpoint, "status", st, "attempts", float64(attempts),
			"next_attempt_at", numOrNil(next), "last_status", numOrNil(lastStatus), "last_error", strOrNil(lastError),
			"delivered_at", numOrNil(delivered), "created_at", float64(created),
			"type", typ, "app_id", appID, "environment", environment,
		), nil
	})
}

func numOrNil(p *int64) any {
	if p == nil {
		return nil
	}
	return float64(*p)
}

func strOrNil(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}
