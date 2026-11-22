package metrics

// SQLite's arithmetic, where Lite's rollup leaves it to SQL: sum() over floating-point values
// (Kahan-Babuska-Neumaier summation, SQLite 3.43 and later) and round(x, n). Standard computes the
// rollup in Go so its stored values match Lite's to the last bit.

import (
	"math"
	"strconv"
	"strings"
)

// kbnSum is SQLite's sum() of REAL values. Integer zeros (the ELSE 0 branches of Lite's SQL) don't
// change it and aren't added; any real makes the sum non-NULL.
type kbnSum struct {
	sum, err float64
	any      bool
}

func (k *kbnSum) add(r float64) {
	k.any = true
	s := k.sum
	t := s + r
	if math.Abs(s) > math.Abs(r) {
		k.err += (s - t) + r
	} else {
		k.err += (r - t) + s
	}
	k.sum = t
}

// value is sumFinalize: the running sum plus the accumulated error.
func (k *kbnSum) value() float64 {
	if math.IsInf(k.err, 0) || math.IsNaN(k.err) {
		return k.sum
	}
	return k.sum + k.err
}

// sqliteRound is SQLite's round(x, n) for n > 0: the decimal expansion rounded half away from
// zero at n places (SQLite prints it with "%!.*f" and reads it back).
func sqliteRound(x float64, n int) float64 {
	if x < -4503599627370496 || x > 4503599627370496 || math.IsNaN(x) {
		return x
	}
	neg := math.Signbit(x)
	// Enough places that the digit after the n-th is exact.
	s := strconv.FormatFloat(math.Abs(x), 'f', n+40, 64)
	dot := strings.IndexByte(s, '.')
	keep := []byte(s[:dot+1+n])
	if s[dot+1+n] >= '5' {
		i := len(keep) - 1
		for ; i >= 0; i-- {
			if keep[i] == '.' {
				continue
			}
			if keep[i] < '9' {
				keep[i]++
				break
			}
			keep[i] = '0'
		}
		if i < 0 {
			keep = append([]byte{'1'}, keep...)
		}
	}
	r, _ := strconv.ParseFloat(string(keep), 64)
	if neg {
		r = -r
	}
	return r
}
