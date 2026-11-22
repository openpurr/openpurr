package server_test

// The MCP server, the OAuth authorization server and the dashboard's consent and connected-apps
// routes against Lite's own answers (internal/testdata/golden-mcp.ts): the same database (seeded
// with every row Lite's run started from), the same requests in the same order, and the answers
// compared byte for byte (status, the headers that matter, and the body), after normalizing the
// random tokens and UUIDs each edition makes for itself. Then the audit log those requests wrote.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

type goldenMCPCase struct {
	Name            string            `json:"name"`
	Method          string            `json:"method"`
	Path            string            `json:"path"`
	Headers         map[string]string `json:"headers"`
	Body            *string           `json:"body"`
	Status          int               `json:"status"`
	ResponseHeaders map[string]string `json:"response_headers"`
	ResponseBody    string            `json:"response_body"`
}

type goldenMCP struct {
	Origin         string `json:"origin"`
	Now            int64  `json:"now"`
	OperatorSecret string `json:"operator_secret"`
	SessionCookie  string `json:"session_cookie"`
	FetchRoutes    map[string]struct {
		Status int    `json:"status"`
		Body   string `json:"body"`
	} `json:"fetch_routes"`
	Seed []struct {
		Table string                       `json:"table"`
		Rows  []map[string]json.RawMessage `json:"rows"`
	} `json:"seed"`
	Cases      []goldenMCPCase              `json:"cases"`
	AuditAfter []map[string]json.RawMessage `json:"audit_after"`
}

// The headers golden-mcp.ts keeps.
var goldenMCPHeaders = []string{
	"content-type", "www-authenticate", "allow", "cache-control", "pragma", "location",
	"access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-max-age",
}

var (
	goldenRandom = regexp.MustCompile(`(opc_|oat_|ort_|request=|code=|"code":")[A-Za-z0-9_-]{43}`)
	goldenUUID   = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
)

// normalizeGolden is golden-mcp.ts's normalize: random tokens and UUIDs become placeholders.
func normalizeGolden(s string) string {
	s = goldenRandom.ReplaceAllString(s, "${1}<random>")
	return goldenUUID.ReplaceAllString(s, "<uuid>")
}

// fakeNetwork answers the webhook endpoint and the client metadata documents as Lite's run did;
// anything else is a 404.
type fakeNetwork map[string]struct {
	Status int
	Body   string
}

func (f fakeNetwork) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Body != nil {
		_, _ = io.Copy(io.Discard, r.Body)
		_ = r.Body.Close()
	}
	route, ok := f[r.URL.String()]
	if !ok {
		route.Status, route.Body = http.StatusNotFound, "not found"
	}
	return &http.Response{
		StatusCode: route.Status,
		Status:     strconv.Itoa(route.Status) + " " + http.StatusText(route.Status),
		Header:     http.Header{"Content-Type": {"application/json"}},
		Body:       io.NopCloser(strings.NewReader(route.Body)),
		Request:    r,
		Proto:      "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1,
	}, nil
}

// seedValue is a seed column's value for Postgres: integral numbers as int64.
func seedValue(t *testing.T, raw json.RawMessage) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	if n, ok := v.(json.Number); ok {
		if i, err := n.Int64(); err == nil {
			return i
		}
		f, err := n.Float64()
		if err != nil {
			t.Fatal(err)
		}
		return f
	}
	return v
}

func seedGolden(t *testing.T, pool *pgxpool.Pool, g *goldenMCP) {
	t.Helper()
	ctx := context.Background()
	for _, table := range g.Seed {
		for _, row := range table.Rows {
			cols := make([]string, 0, len(row))
			for c := range row {
				cols = append(cols, c)
			}
			sort.Strings(cols)
			params := make([]string, len(cols))
			args := make([]any, len(cols))
			for i, c := range cols {
				params[i] = "$" + strconv.Itoa(i+1)
				args[i] = seedValue(t, row[c])
			}
			sql := "INSERT INTO " + table.Table + " (" + strings.Join(cols, ", ") + ") VALUES (" + strings.Join(params, ", ") + ")"
			if _, err := pool.Exec(ctx, sql, args...); err != nil {
				t.Fatalf("seeding %s: %v", table.Table, err)
			}
		}
	}
	// Identity columns continue after the seeded rows.
	rows, err := pool.Query(ctx, `SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND is_identity = 'YES'`)
	if err != nil {
		t.Fatal(err)
	}
	var identities [][2]string
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			t.Fatal(err)
		}
		identities = append(identities, [2]string{table, column})
	}
	rows.Close()
	for _, id := range identities {
		sql := fmt.Sprintf(`SELECT setval(pg_get_serial_sequence('%s', '%s'), coalesce((SELECT max(%s) FROM %s), 0) + 1, false)`, id[0], id[1], id[1], id[0])
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
}

// shortDiff shows where two strings first differ.
func shortDiff(want, got string) string {
	i := 0
	for i < len(want) && i < len(got) && want[i] == got[i] {
		i++
	}
	from := max(0, i-80)
	clip := func(s string) string {
		end := min(len(s), i+160)
		if from >= end {
			return "…(ends)"
		}
		return s[from:end]
	}
	return fmt.Sprintf("first difference at byte %d:\n  want …%s\n  got  …%s", i, clip(want), clip(got))
}

func TestMCPAndOAuthMatchLite(t *testing.T) {
	var g goldenMCP
	if err := json.Unmarshal(testdata.GoldenMCP, &g); err != nil {
		t.Fatal(err)
	}
	pool := tu.Pool(t)
	seedGolden(t, pool, &g)
	var seededAudit int64
	if err := pool.QueryRow(context.Background(), "SELECT coalesce(max(id), 0) FROM audit_log").Scan(&seededAudit); err != nil {
		t.Fatal(err)
	}

	env := tu.StartOn(t, pool, tu.Options{OperatorSecret: g.OperatorSecret, ClientIPHeader: "CF-Connecting-IP", Secrets: map[string]string{}})
	env.Clock.Store(g.Now)
	network := fakeNetwork{}
	for url, r := range g.FetchRoutes {
		network[url] = struct {
			Status int
			Body   string
		}{r.Status, r.Body}
	}
	client := &http.Client{Transport: network}
	env.Deps.PublicURL = g.Origin
	env.Deps.HTTPClient = client
	env.Deps.MetadataClient = client
	if env.Deps.Webhooks != nil {
		env.Deps.Webhooks.HTTP = client
	}
	env.Loader.Invalidate()
	handler := env.Server.Config.Handler

	for _, c := range g.Cases {
		var body io.Reader
		if c.Body != nil {
			body = strings.NewReader(*c.Body)
		}
		req := httptest.NewRequest(c.Method, g.Origin+c.Path, body)
		req.RemoteAddr = "192.0.2.1:1234"
		for k, v := range c.Headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		env.Deps.Deferred.Wait()

		res := rec.Result()
		gotBody := normalizeGolden(rec.Body.String())
		var problems []string
		if res.StatusCode != c.Status {
			problems = append(problems, fmt.Sprintf("status %d, want %d", res.StatusCode, c.Status))
		}
		for _, h := range goldenMCPHeaders {
			want, wanted := c.ResponseHeaders[h]
			values := res.Header.Values(h)
			got := normalizeGolden(strings.Join(values, ", "))
			switch {
			case wanted && len(values) == 0:
				problems = append(problems, fmt.Sprintf("header %s missing, want %q", h, want))
			case !wanted && len(values) > 0:
				problems = append(problems, fmt.Sprintf("header %s is %q, want none", h, got))
			case wanted && got != want:
				problems = append(problems, fmt.Sprintf("header %s is %q, want %q", h, got, want))
			}
		}
		if gotBody != c.ResponseBody {
			problems = append(problems, "body: "+shortDiff(c.ResponseBody, gotBody))
		}
		if len(problems) > 0 {
			t.Errorf("%s (%s %s):\n%s", c.Name, c.Method, c.Path, strings.Join(problems, "\n"))
		}
	}

	// The audit log the requests wrote.
	rows, err := pool.Query(context.Background(),
		"SELECT at, operator_id, actor, token_id, source, action, target, details, ip FROM audit_log WHERE id > $1 ORDER BY id", seededAudit)
	if err != nil {
		t.Fatal(err)
	}
	cols := []string{"at", "operator_id", "actor", "token_id", "source", "action", "target", "details", "ip"}
	var got []string
	for rows.Next() {
		var at int64
		var operatorID, actor, tokenID, target, details, ip *string
		var source, action string
		if err := rows.Scan(&at, &operatorID, &actor, &tokenID, &source, &action, &target, &details, &ip); err != nil {
			t.Fatal(err)
		}
		str := func(p *string) any {
			if p == nil {
				return nil
			}
			return normalizeGolden(*p)
		}
		values := map[string]any{"at": at, "operator_id": str(operatorID), "actor": str(actor), "token_id": str(tokenID), "source": normalizeGolden(source),
			"action": normalizeGolden(action), "target": str(target), "details": str(details), "ip": str(ip)}
		got = append(got, auditLine(cols, values))
	}
	rows.Close()
	var want []string
	for _, row := range g.AuditAfter {
		values := map[string]any{}
		for _, c := range cols {
			values[c] = seedValue(t, row[c])
		}
		want = append(want, auditLine(cols, values))
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("audit log:\nwant\n%s\ngot\n%s", strings.Join(want, "\n"), strings.Join(got, "\n"))
	}
}

func auditLine(cols []string, values map[string]any) string {
	parts := make([]string, len(cols))
	for i, c := range cols {
		b, _ := json.Marshal(values[c])
		parts[i] = c + "=" + string(b)
	}
	return strings.Join(parts, " ")
}
