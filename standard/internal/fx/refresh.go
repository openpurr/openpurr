package fx

// Fetching exchange rates (lite/src/fx.ts). Default provider: the European Central Bank's euro
// reference rates. Free, no API key, published around 16:00 CET on euro-area business days, about
// 30 currencies. Reuse is allowed with the source acknowledged: "Source: European Central Bank".
// Currencies the ECB doesn't publish have no rate, and their USD price is null. Another provider
// can be plugged in through Provider.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// DailyRates are the rates for one date: units of each currency per 1 USD, in the order the
// source listed them (EUR first for the ECB).
type DailyRates struct {
	Date       string
	Currencies []string
	PerUSD     map[string]float64
}

func (d *DailyRates) set(currency string, rate float64) {
	if _, ok := d.PerUSD[currency]; !ok {
		d.Currencies = append(d.Currencies, currency)
	}
	d.PerUSD[currency] = rate
}

// Provider supplies exchange rates.
type Provider interface {
	Name() string
	// Latest is the latest published rates.
	Latest(ctx context.Context, client *http.Client) ([]DailyRates, error)
	// History is recent history, to fill the table on first run.
	History(ctx context.Context, client *http.Client) ([]DailyRates, error)
}

const ecbBase = "https://www.ecb.europa.eu/stats/eurofxref"

// ECB is the European Central Bank provider.
var ECB Provider = ecb{}

type ecb struct{}

func (ecb) Name() string { return "ecb" }

func (ecb) Latest(ctx context.Context, client *http.Client) ([]DailyRates, error) {
	xml, err := fetchText(ctx, client, ecbBase+"/eurofxref-daily.xml")
	if err != nil {
		return nil, err
	}
	return ParseECB(xml), nil
}

func (ecb) History(ctx context.Context, client *http.Client) ([]DailyRates, error) {
	xml, err := fetchText(ctx, client, ecbBase+"/eurofxref-hist-90d.xml")
	if err != nil {
		return nil, err
	}
	return ParseECB(xml), nil
}

func fetchText(ctx context.Context, client *http.Client, url string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", fmt.Errorf("Exchange rates: %s answered %d", url, res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	return string(body), err
}

var (
	ecbDay  = regexp.MustCompile(`<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)</Cube>`)
	ecbRate = regexp.MustCompile(`<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*/>`)
)

// ParseECB parses ECB eurofxref XML (rates per 1 EUR) into rates per 1 USD. Days without a USD
// rate are skipped, and so are rates that aren't positive numbers.
func ParseECB(xml string) []DailyRates {
	var days []DailyRates
	for _, day := range ecbDay.FindAllStringSubmatch(xml, -1) {
		perEUR := DailyRates{PerUSD: map[string]float64{}}
		perEUR.set("EUR", 1)
		for _, r := range ecbRate.FindAllStringSubmatch(day[2], -1) {
			rate, err := strconv.ParseFloat(r[2], 64)
			if err == nil && rate > 0 {
				perEUR.set(r[1], rate)
			}
		}
		usd := perEUR.PerUSD["USD"]
		if usd == 0 {
			continue // can't express anything in USD without the USD rate
		}
		out := DailyRates{Date: day[1], PerUSD: map[string]float64{}}
		for _, c := range perEUR.Currencies {
			out.set(c, perEUR.PerUSD[c]/usd)
		}
		out.set("USD", 1)
		days = append(days, out)
	}
	return days
}

// StoreRates inserts rates; existing rows are kept.
func StoreRates(ctx context.Context, db interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}, source string, days []DailyRates) error {
	var dates, currencies []string
	var rates []float64
	for _, d := range days {
		for _, c := range d.Currencies {
			dates = append(dates, d.Date)
			currencies = append(currencies, c)
			rates = append(rates, d.PerUSD[c])
		}
	}
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO fx_rate (date, currency, per_usd, source)
			 SELECT d, c, r, $4 FROM unnest($1::text[], $2::text[], $3::float8[]) AS x(d, c, r)
			 ON CONFLICT (currency, date) DO NOTHING`,
			dates, currencies, rates, source)
		return err
	})
}

// Refresh is the refresh-exchange-rates job: it fills the table on first run (90 days of
// history), then fetches the latest rates once today's are due and missing. The ECB publishes
// around 16:00 CET, so it checks from 15:00 UTC. It returns how many rows it offered to the table.
func Refresh(ctx context.Context, db interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Begin(ctx context.Context) (pgx.Tx, error)
}, client *http.Client, now int64, provider Provider) (int, error) {
	var latest *string
	if err := db.QueryRow(ctx, "SELECT max(date) FROM fx_rate").Scan(&latest); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	at := time.UnixMilli(now).UTC()
	today := at.Format("2006-01-02")
	var days []DailyRates
	var err error
	switch {
	case latest == nil || *latest == "":
		days, err = provider.History(ctx, client)
	case *latest < today && at.Hour() >= 15:
		days, err = provider.Latest(ctx, client)
	default:
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	var fresh []DailyRates
	for _, d := range days {
		if latest == nil || *latest == "" || d.Date > *latest {
			fresh = append(fresh, d)
		}
	}
	if len(fresh) == 0 {
		return 0, nil // weekend or holiday: nothing new published
	}
	if err := StoreRates(ctx, db, provider.Name(), fresh); err != nil {
		return 0, err
	}
	n := 0
	for _, d := range fresh {
		n += len(d.Currencies)
	}
	return n, nil
}
