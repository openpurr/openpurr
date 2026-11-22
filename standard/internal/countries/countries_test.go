package countries

import "testing"

func TestAlpha2FromAlpha3(t *testing.T) {
	for in, want := range map[string]string{"USA": "US", "usa": "US", "DEU": "DE", "GBR": "GB", "ZWE": "ZW", "ABW": "AW", "XXX": "", "": ""} {
		if got := Alpha2FromAlpha3(in); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}
