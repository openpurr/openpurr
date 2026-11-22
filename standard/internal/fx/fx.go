// Package fx converts prices to USD with the daily exchange rates in fx_rate, and fetches the
// rates (lite/src/fx.ts). Conversion uses the rate for the purchase's date, or the most recent
// earlier business day (weekends, holidays, and today before publication).
package fx

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// DB is what fx needs from a pool or transaction.
type DB interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ToUSD converts an amount to USD at the rate for at (epoch ms), or the most recent earlier
// business day. It returns nil when there's no rate for that currency on or before that date.
// Rounded to cents, the way JavaScript's Math.round does.
func ToUSD(ctx context.Context, db DB, amount float64, currency string, at int64) (*float64, error) {
	if currency == "" {
		return nil, nil
	}
	if currency == "USD" {
		return &amount, nil
	}
	var perUSD float64
	day := time.UnixMilli(at).UTC().Format("2006-01-02")
	err := db.QueryRow(ctx, "SELECT per_usd FROM fx_rate WHERE currency = $1 AND date <= $2 ORDER BY date DESC LIMIT 1",
		strings.ToUpper(currency), day).Scan(&perUSD)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	usd := JSRound(amount/perUSD*100) / 100
	return &usd, nil
}

// JSRound is JavaScript's Math.round: halves round toward +Infinity.
func JSRound(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	if r == 0 && math.Signbit(x) {
		return math.Copysign(0, -1)
	}
	return r
}
