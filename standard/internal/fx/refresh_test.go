package fx_test

// Mirrors lite/test/fx.test.ts: ECB parsing (checked against golden-webhooks.json, Lite's own
// parser's output), refreshing rates, and converting with them.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/outbound"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func TestGoldenECB(t *testing.T) {
	g, err := jsobj.Parse(testdata.GoldenWebhooks)
	if err != nil {
		t.Fatal(err)
	}
	cases, _ := jsobj.Prop(g, "ecb")
	for _, c := range cases.([]any) {
		name, _ := jsobj.Prop(c, "name")
		xml, _ := jsobj.Prop(c, "xml")
		want, _ := jsobj.Prop(c, "days")
		got := []any{}
		for _, d := range fx.ParseECB(xml.(string)) {
			per := jsobj.New()
			for _, cur := range d.Currencies {
				per.Set(cur, d.PerUSD[cur])
			}
			got = append(got, jsobj.New("date", d.Date, "perUsd", per))
		}
		if jsobj.Stringify(got) != jsobj.Stringify(want) {
			t.Errorf("%s:\n got %s\nwant %s", name, jsobj.Stringify(got), jsobj.Stringify(want))
		}
	}
}

type fakeProvider struct {
	history, latest []fx.DailyRates
	calls           []string
}

func (f *fakeProvider) Name() string { return "test" }
func (f *fakeProvider) Latest(context.Context, *http.Client) ([]fx.DailyRates, error) {
	f.calls = append(f.calls, "latest")
	return f.latest, nil
}
func (f *fakeProvider) History(context.Context, *http.Client) ([]fx.DailyRates, error) {
	f.calls = append(f.calls, "history")
	return f.history, nil
}

func rates(date string, kv ...any) fx.DailyRates {
	d := fx.DailyRates{Date: date, PerUSD: map[string]float64{}}
	for i := 0; i+1 < len(kv); i += 2 {
		d.Currencies = append(d.Currencies, kv[i].(string))
		d.PerUSD[kv[i].(string)] = kv[i+1].(float64)
	}
	return d
}

func at(t *testing.T, iso string) int64 {
	t.Helper()
	tm, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		t.Fatal(err)
	}
	return tm.UnixMilli()
}

func TestRefreshRates(t *testing.T) {
	t.Run("loads history first, then the latest rates once they're due", func(t *testing.T) {
		pool := tu.Pool(t)
		ctx := context.Background()
		p := &fakeProvider{
			history: []fx.DailyRates{rates("2026-11-16", "USD", 1.0, "EUR", 0.9), rates("2026-11-17", "USD", 1.0, "EUR", 0.91)},
			latest:  []fx.DailyRates{rates("2026-11-18", "USD", 1.0, "EUR", 0.92)},
		}
		steps := []struct {
			at   string
			want int
		}{
			{"2026-11-18T09:00:00Z", 4}, // empty table: history
			{"2026-11-18T10:00:00Z", 0}, // before publication
			{"2026-11-18T16:00:00Z", 2}, // today's rates
			{"2026-11-18T17:00:00Z", 0}, // already have today
		}
		for _, s := range steps {
			n, err := fx.Refresh(ctx, pool, http.DefaultClient, at(t, s.at), p)
			if err != nil || n != s.want {
				t.Errorf("%s: %d %v, want %d", s.at, n, err, s.want)
			}
		}
		if !slices.Equal(p.calls, []string{"history", "latest"}) {
			t.Errorf("%v", p.calls)
		}
		var n int
		_ = pool.QueryRow(ctx, "SELECT count(*) FROM fx_rate WHERE source = 'test'").Scan(&n)
		if n != 6 {
			t.Errorf("%d rows", n)
		}
	})

	t.Run("fetches the ECB's files (through the conformance rewrite) and says when it can't", func(t *testing.T) {
		pool := tu.Pool(t)
		ctx := context.Background()
		var paths []string
		status := 200
		ecb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			paths = append(paths, r.URL.Path)
			w.WriteHeader(status)
			day := "2026-11-17"
			if strings.HasSuffix(r.URL.Path, "daily.xml") {
				day = "2026-11-18"
			}
			_, _ = w.Write([]byte(`<Cube><Cube time="` + day + `"><Cube currency="USD" rate="1.25"/><Cube currency="JPY" rate="175"/></Cube></Cube>`))
		}))
		defer ecb.Close()
		client := outbound.NewClient(ecb.URL)
		if n, err := fx.Refresh(ctx, pool, client, at(t, "2026-11-18T09:00:00Z"), fx.ECB); n != 3 || err != nil {
			t.Errorf("%d %v", n, err)
		}
		status = 503
		_, err := fx.Refresh(ctx, pool, client, at(t, "2026-11-18T16:00:00Z"), fx.ECB)
		if err == nil || err.Error() != "Exchange rates: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml answered 503" {
			t.Errorf("%v", err)
		}
		want := []string{"/www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml", "/www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"}
		if !slices.Equal(paths, want) {
			t.Errorf("%v", paths)
		}
		var source string
		var jpy float64
		if err := pool.QueryRow(ctx, "SELECT source, per_usd FROM fx_rate WHERE currency = 'JPY'").Scan(&source, &jpy); err != nil || source != "ecb" || jpy != 140 {
			t.Errorf("%s %v %v", source, jpy, err)
		}
	})
}

func TestToUSD(t *testing.T) {
	pool := tu.Pool(t)
	ctx := context.Background()
	if err := fx.StoreRates(ctx, pool, "test", []fx.DailyRates{
		rates("2026-10-02", "USD", 1.0, "EUR", 0.8, "JPY", 150.0), // a Friday
		rates("2026-10-05", "USD", 1.0, "EUR", 0.9, "JPY", 160.0), // the next Monday
	}); err != nil {
		t.Fatal(err)
	}
	// Existing rows are kept.
	if err := fx.StoreRates(ctx, pool, "other", []fx.DailyRates{rates("2026-10-02", "EUR", 0.5)}); err != nil {
		t.Fatal(err)
	}
	check := func(amount float64, currency, iso string, want *float64) {
		t.Helper()
		got, err := fx.ToUSD(ctx, pool, amount, currency, at(t, iso))
		if err != nil || (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Errorf("%v %s at %s: %v %v", amount, currency, iso, got, err)
		}
	}
	ten := 10.0
	check(8, "EUR", "2026-10-02T12:00:00Z", &ten)
	check(8, "EUR", "2026-10-04T12:00:00Z", &ten) // Sunday: Friday's rate
	check(9, "EUR", "2026-10-05T12:00:00Z", &ten)
	check(1500, "JPY", "2026-10-02T12:00:00Z", &ten)
	check(37.99, "SAR", "2026-10-05T12:00:00Z", nil) // the ECB doesn't publish SAR
	check(8, "EUR", "2001-01-01T00:00:00Z", nil)     // before any rate
	usd := 9.99
	check(9.99, "USD", "2026-10-05T12:00:00Z", &usd)
}
