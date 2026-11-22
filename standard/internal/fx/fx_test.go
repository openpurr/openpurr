package fx

import (
	"math"
	"testing"
)

func TestJSRound(t *testing.T) {
	for in, want := range map[float64]float64{
		0.5: 1, 1.5: 2, 2.5: 3, -0.5: 0, -1.5: -1, -2.5: -2, 998.5: 999, 0.49999999999999994: 0, 1234.4999: 1234,
	} {
		if got := JSRound(in); got != want {
			t.Errorf("JSRound(%v) = %v, want %v", in, got, want)
		}
	}
	if got := JSRound(-0.4); got != 0 || !math.Signbit(got) {
		t.Errorf("JSRound(-0.4) = %v, want -0", got)
	}
}
