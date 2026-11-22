package server

import "testing"

// Mirrors lite/test/experiments.test.ts "gives the chance that a variant beats the control".
func TestExperimentStatistics(t *testing.T) {
	near := func(got any, want, tol float64) bool {
		f, ok := got.(float64)
		return ok && f > want-tol && f < want+tol
	}
	if !near(normalCDF(0), 0.5, 1e-6) || !near(normalCDF(1.96), 0.975, 1e-3) || !near(normalCDF(-1.96), 0.025, 1e-3) {
		t.Error("normal CDF")
	}
	if !near(chanceConversionHigher(1000, 50, 1000, 50), 0.5, 1e-6) {
		t.Error("equal")
	}
	if c := chanceConversionHigher(1000, 50, 1000, 80).(float64); c <= 0.99 {
		t.Error(c)
	}
	if c := chanceConversionHigher(1000, 80, 1000, 50).(float64); c >= 0.01 {
		t.Error(c)
	}
	if c := chanceConversionHigher(40, 2, 40, 3).(float64); c <= 0.5 || c >= 0.8 {
		t.Error(c)
	}
	if c := chanceMeanHigher(100, 100, 1000, 100, 200, 4000).(float64); c <= 0.9 {
		t.Error(c)
	}
	if !near(chanceMeanHigher(100, 100, 1000, 100, 100, 1000), 0.5, 1e-6) {
		t.Error("same mean")
	}
	if chanceConversionHigher(0, 0, 10, 1) != nil {
		t.Error("no data")
	}
}

func TestDateParse(t *testing.T) {
	for in, want := range map[string]float64{
		"2026-01-31":                  1769817600000,
		"2026-01-31T12:00:00Z":        1769860800000,
		"2026-01-31T12:00:00.5+01:00": 1769857200500,
		"2026-01-31T12:00":            1769860800000,
		"+002026-01":                  1767225600000,
	} {
		if got := jsDateParse(in); got != want {
			t.Errorf("%s: %v, want %v", in, got, want)
		}
	}
	for _, bad := range []string{"", "yesterday", "2026-02-30", "2026-13-01", "31/01/2026", "2026-01-31T25:00Z"} {
		if got := jsDateParse(bad); got == got {
			t.Errorf("%s: %v", bad, got)
		}
	}
}
