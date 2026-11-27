package server

// The event list, GET /admin/v1/events and /events/:id (a port of the events section of
// lite/src/office/admin.ts): every purchase event, newest first, the iOS app's feed. The same
// RevenueCat-shaped events the webhooks send, recorded whether or not an endpoint wants them.

import (
	"encoding/base64"
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// eventFields are the fields of event.* listed for each event, in Lite's order (after id, type,
// app_id, environment and created_at); null when the event has none.
var eventFields = []string{
	"app_user_id", "store", "product_id", "period_type", "price", "price_in_purchased_currency",
	"currency", "country_code", "new_product_id", "cancel_reason", "expiration_reason",
}

type eventRow struct {
	id, typ, appID, environment, body string
	createdAt                         int64
}

// listedEvent is an event as the list shows it; with the body for /events/:id.
func listedEvent(cfg *config.Config, row eventRow, withBody bool) (*jsobj.Object, error) {
	parsed, err := jsobj.Parse([]byte(row.body))
	if err != nil {
		return nil, err
	}
	event, _ := jsobj.Prop(parsed, "event")
	out := jsobj.New("id", row.id, "type", row.typ, "app_id", row.appID, "environment", row.environment, "created_at", row.createdAt)
	for _, f := range eventFields {
		v, _ := jsobj.Prop(event, f)
		// SQLite's json_extract gives objects and arrays as JSON text; none of these fields are one.
		out.Set(f, v)
	}
	var projectID any
	if app := cfg.Apps[row.appID]; app != nil {
		projectID = app.ProjectID
	}
	out.Set("project_id", projectID)
	familyShare, _ := jsobj.Prop(event, "is_family_share")
	if b, ok := familyShare.(bool); ok {
		out.Set("is_family_share", b)
	} else {
		out.Set("is_family_share", nil)
	}
	if withBody {
		out.Set("body", parsed)
	}
	return out, nil
}

// eventCursor is Lite's cursor: btoa("<created_at>:<id>") without padding.
func encodeEventCursor(row eventRow) string {
	return strings.TrimRight(base64.StdEncoding.EncodeToString([]byte(strconv.FormatInt(row.createdAt, 10)+":"+row.id)), "=")
}

func decodeEventCursor(cursor string) (int64, string, bool) {
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimRight(cursor, "="))
	if err != nil {
		return 0, "", false
	}
	parts := strings.Split(string(raw), ":")
	if len(parts) < 2 || parts[1] == "" {
		return 0, "", false
	}
	at := jsNumber(parts[0])
	if math.IsNaN(at) || math.IsInf(at, 0) || at != math.Trunc(at) || math.Abs(at) > 1<<53-1 {
		return 0, "", false
	}
	return int64(at), parts[1], true
}

func adminEvents(q *adminReq) {
	environment := q.query("environment")
	if !q.hasQuery("environment") {
		environment = "production"
	}
	if environment != "production" && environment != "sandbox" {
		q.bad("environment must be production or sandbox.")
		return
	}
	var types []string
	if q.hasQuery("type") {
		for _, t := range strings.Split(q.query("type"), ",") {
			if t == "" {
				continue
			}
			if !slices.Contains(config.WebhookEventTypes, t) {
				q.bad("Unknown event type " + t + ".")
				return
			}
			types = append(types, t)
		}
	}
	var cursorAt int64
	var cursorID string
	hasCursor := q.query("cursor") != ""
	if hasCursor {
		var ok bool
		if cursorAt, cursorID, ok = decodeEventCursor(q.query("cursor")); !ok {
			q.bad("cursor isn't one this API returned.")
			return
		}
	}
	limit := q.queryLimit("limit", 50, 200)

	// Which apps: the caller's, narrowed by ?project= and ?app=. nil = every app.
	apps := q.p.apps
	if q.query("project") != "" {
		project := q.project("")
		if project == nil {
			return
		}
		apps = []string{}
		for _, id := range project.AppOrder {
			if q.p.canSeeApp(id) {
				apps = append(apps, id)
			}
		}
	}
	if app := q.query("app"); app != "" {
		if q.cfg.Apps[app] == nil || !q.p.canSeeApp(app) || (apps != nil && !slices.Contains(apps, app)) {
			q.notFound("App")
			return
		}
		apps = []string{app}
	}

	where := []string{"environment = $1"}
	args := []any{environment}
	add := func(cond string, vs ...any) {
		for _, v := range vs {
			args = append(args, v)
			cond = strings.Replace(cond, "?", "$"+strconv.Itoa(len(args)), 1)
		}
		where = append(where, cond)
	}
	if apps != nil {
		add("app_id = ANY(?::text[])", apps)
	}
	if len(types) > 0 {
		add("type = ANY(?::text[])", types)
	}
	if hasCursor {
		add(`(created_at < ? OR (created_at = ? AND id COLLATE "C" < ?))`, cursorAt, cursorAt, cursorID)
	}
	rows, err := q.s.Pool.Query(q.ctx,
		`SELECT id, type, app_id, environment, created_at, body FROM webhook_event WHERE `+strings.Join(where, " AND ")+
			` ORDER BY created_at DESC, id COLLATE "C" DESC LIMIT `+strconv.Itoa(limit+1), args...)
	if err != nil {
		q.internal(err)
		return
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (eventRow, error) {
		var e eventRow
		err := r.Scan(&e.id, &e.typ, &e.appID, &e.environment, &e.createdAt, &e.body)
		return e, err
	})
	if err != nil {
		q.internal(err)
		return
	}
	page := list
	if len(page) > limit {
		page = page[:limit]
	}
	events := []any{}
	for _, row := range page {
		e, err := listedEvent(q.cfg, row, false)
		if err != nil {
			q.internal(err)
			return
		}
		events = append(events, e)
	}
	var next any
	if len(list) > limit {
		next = encodeEventCursor(page[len(page)-1])
	}
	q.json(http.StatusOK, jsobj.New("events", events, "next_cursor", next))
}

func adminEvent(q *adminReq) {
	var row eventRow
	err := q.s.Pool.QueryRow(q.ctx, "SELECT id, type, app_id, environment, created_at, body FROM webhook_event WHERE id = $1", q.params["id"]).
		Scan(&row.id, &row.typ, &row.appID, &row.environment, &row.createdAt, &row.body)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !q.p.canSeeApp(row.appID)) {
		q.notFound("Event")
		return
	}
	if err != nil {
		q.internal(err)
		return
	}
	e, err := listedEvent(q.cfg, row, true)
	if err != nil {
		q.internal(err)
		return
	}
	q.json(http.StatusOK, e)
}
