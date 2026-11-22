package jsobj

import (
	"math"
	"testing"
)

func TestFormatNumberMatchesJavaScript(t *testing.T) {
	cases := map[float64]string{
		0:                    "0",
		math.Copysign(0, -1): "0",
		1:                    "1",
		-1.5:                 "-1.5",
		9.99:                 "9.99",
		123456789:            "123456789",
		1e21:                 "1e+21",
		1e20:                 "100000000000000000000",
		1.5e21:               "1.5e+21",
		0.000001:             "0.000001",
		0.0000001:            "1e-7",
		1.25e-7:              "1.25e-7",
		1800000000000:        "1800000000000",
		9007199254740993:     "9007199254740992",
		21000000:             "21000000",
		4.99:                 "4.99",
		1e300 * 10:           "1e+301",
		math.MaxFloat64:      "1.7976931348623157e+308",
		5e-324:               "5e-324",
	}
	a, b := 0.1, 0.2
	cases[a+b] = "0.30000000000000004"
	for f, want := range cases {
		if got := FormatNumber(f); got != want {
			t.Errorf("FormatNumber(%v) = %q, want %q", f, got, want)
		}
	}
}

func TestObjectKeyOrderIsJavaScripts(t *testing.T) {
	o := New("b", 1, "10", 2, "a", 3, "2", 4, "01", 5, "4294967295", 6)
	o.Set("b", 7) // replacing keeps the position
	got := Stringify(o)
	want := `{"2":4,"10":2,"b":7,"a":3,"01":5,"4294967295":6}`
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestParseAndStringifyRoundTrip(t *testing.T) {
	in := `{"z":1,"a":[true,null,"x\u0001\"\\/é😀"],"n":-0.5,"big":1e400,"o":{}}`
	v, err := Parse([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	got := Stringify(v)
	want := `{"z":1,"a":[true,null,"x\u0001\"\\/é😀"],"n":-0.5,"big":null,"o":{}}`
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
	for _, bad := range []string{"", "{", "{} x", "[1,]", "{'a':1}", "nul"} {
		if _, err := Parse([]byte(bad)); err == nil {
			t.Errorf("Parse(%q) should fail", bad)
		}
	}
}

func TestFNV1aMatchesLite(t *testing.T) {
	// Values from lite/src/config.ts's fnv1a.
	if got := FNV1a(""); got != "811c9dc5" {
		t.Errorf("empty: %s", got)
	}
	if got := FNV1a("a"); got != "e40c292c" {
		t.Errorf("a: %s", got)
	}
}

func TestStringOfValues(t *testing.T) {
	if got := String([]any{1.0, "x", nil}, true); got != "1,x," {
		t.Errorf("array: %q", got)
	}
	if got := String(nil, false); got != "undefined" {
		t.Errorf("undefined: %q", got)
	}
	if UTF16Len("a😀") != 3 {
		t.Error("UTF16Len")
	}
}
