// Package jsobj holds JSON values the way JavaScript does, so that Standard produces the same bytes
// as Lite's JSON.stringify: object keys keep JavaScript's property order (integer-like keys first,
// in ascending order, then the rest in insertion order), numbers are float64 and are written the
// way JavaScript writes them, and strings are escaped like JSON.stringify.
//
// Byte-identical output matters in three places: SDK responses (some clients compare bodies),
// config versions (an FNV-1a hash of the stringified document, as in lite/src/config.ts) and
// CustomerInfo snapshot ETags (a SHA-256 of the stringified snapshot).
//
// Values are nil (null), bool, float64, string, []any and *Object. Stringify also accepts int,
// int64 and Raw.
package jsobj

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Object is a JSON object with JavaScript's property order.
type Object struct {
	keys []string
	vals map[string]any
}

// Raw is JSON text written as is by Stringify.
type Raw string

// New builds an object from alternating keys and values.
func New(kv ...any) *Object {
	o := &Object{vals: make(map[string]any, len(kv)/2)}
	for i := 0; i+1 < len(kv); i += 2 {
		o.Set(kv[i].(string), kv[i+1])
	}
	return o
}

// Set adds or replaces a property. A replaced property keeps its position, as in JavaScript.
func (o *Object) Set(k string, v any) {
	if o.vals == nil {
		o.vals = map[string]any{}
	}
	if _, ok := o.vals[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.vals[k] = v
}

// Get returns a property and whether it exists (JavaScript's undefined is "doesn't exist").
func (o *Object) Get(k string) (any, bool) {
	if o == nil {
		return nil, false
	}
	v, ok := o.vals[k]
	return v, ok
}

// Has reports whether the property exists.
func (o *Object) Has(k string) bool {
	_, ok := o.Get(k)
	return ok
}

// Delete removes a property.
func (o *Object) Delete(k string) {
	if o == nil {
		return
	}
	if _, ok := o.vals[k]; !ok {
		return
	}
	delete(o.vals, k)
	for i, key := range o.keys {
		if key == k {
			o.keys = append(o.keys[:i], o.keys[i+1:]...)
			break
		}
	}
}

// Len is the number of properties.
func (o *Object) Len() int {
	if o == nil {
		return 0
	}
	return len(o.keys)
}

// Keys returns the property names in JavaScript order (Object.keys).
func (o *Object) Keys() []string {
	if o == nil {
		return nil
	}
	var ints []string
	var rest []string
	for _, k := range o.keys {
		if _, ok := arrayIndex(k); ok {
			ints = append(ints, k)
		} else {
			rest = append(rest, k)
		}
	}
	if len(ints) == 0 {
		return rest
	}
	sort.Slice(ints, func(i, j int) bool {
		a, _ := arrayIndex(ints[i])
		b, _ := arrayIndex(ints[j])
		return a < b
	})
	return append(ints, rest...)
}

// Clone copies the object and, recursively, every object and array in it.
func (o *Object) Clone() *Object {
	if o == nil {
		return nil
	}
	c := &Object{keys: append([]string(nil), o.keys...), vals: make(map[string]any, len(o.vals))}
	for k, v := range o.vals {
		c.vals[k] = CloneValue(v)
	}
	return c
}

// CloneValue deep-copies a value.
func CloneValue(v any) any {
	switch x := v.(type) {
	case *Object:
		return x.Clone()
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = CloneValue(e)
		}
		return out
	}
	return v
}

// arrayIndex reports whether k is a canonical array index ("0", "1", ... below 2^32 - 1), which
// JavaScript orders before every other key.
func arrayIndex(k string) (uint64, bool) {
	if k == "" || len(k) > 10 || (len(k) > 1 && k[0] == '0') {
		return 0, false
	}
	var n uint64
	for i := 0; i < len(k); i++ {
		c := k[i]
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + uint64(c-'0')
	}
	return n, n < 4294967295
}

// IsObject is JavaScript's `typeof v === "object" && v !== null && !Array.isArray(v)`.
func IsObject(v any) bool {
	o, ok := v.(*Object)
	return ok && o != nil
}

// Prop reads a property the way JavaScript's `v?.k` does: undefined (false) for anything that
// isn't an object.
func Prop(v any, k string) (any, bool) {
	o, ok := v.(*Object)
	if !ok {
		return nil, false
	}
	return o.Get(k)
}

// --- parsing -----------------------------------------------------------------------------------

// ErrSyntax is returned for anything JSON.parse would reject.
var ErrSyntax = errors.New("invalid JSON")

// Parse is JSON.parse: objects keep their key order, numbers become float64.
func Parse(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := parseValue(dec)
	if err != nil {
		return nil, ErrSyntax
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, ErrSyntax
	}
	return v, nil
}

func parseValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			o := &Object{vals: map[string]any{}}
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				k, ok := kt.(string)
				if !ok {
					return nil, ErrSyntax
				}
				v, err := parseValue(dec)
				if err != nil {
					return nil, err
				}
				o.Set(k, v)
			}
			if _, err := dec.Token(); err != nil {
				return nil, err
			}
			return o, nil
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := parseValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			if _, err := dec.Token(); err != nil {
				return nil, err
			}
			return arr, nil
		}
		return nil, ErrSyntax
	case json.Number:
		return ParseNumber(string(t)), nil
	case string, bool, nil:
		return t, nil
	}
	return nil, ErrSyntax
}

// ParseNumber converts a JSON number to float64 as JavaScript does (out of range: ±Infinity or 0).
func ParseNumber(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		var ne *strconv.NumError
		if errors.As(err, &ne) && ne.Err == strconv.ErrRange {
			return f
		}
		return math.NaN()
	}
	return f
}

// --- stringifying ------------------------------------------------------------------------------

// Stringify is JSON.stringify(v).
func Stringify(v any) string {
	var b strings.Builder
	write(&b, v)
	return b.String()
}

// StringifyBytes is Stringify as bytes.
func StringifyBytes(v any) []byte { return []byte(Stringify(v)) }

func write(b *strings.Builder, v any) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			b.WriteString("null")
		} else {
			b.WriteString(FormatNumber(x))
		}
	case int:
		b.WriteString(strconv.Itoa(x))
	case int64:
		b.WriteString(strconv.FormatInt(x, 10))
	case string:
		writeString(b, x)
	case Raw:
		b.WriteString(string(x))
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			write(b, e)
		}
		b.WriteByte(']')
	case []string:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeString(b, e)
		}
		b.WriteByte(']')
	case *Object:
		if x == nil {
			b.WriteString("null")
			return
		}
		b.WriteByte('{')
		for i, k := range x.Keys() {
			if i > 0 {
				b.WriteByte(',')
			}
			writeString(b, k)
			b.WriteByte(':')
			write(b, x.vals[k])
		}
		b.WriteByte('}')
	default:
		panic("jsobj: unsupported type in Stringify")
	}
}

const hexDigits = "0123456789abcdef"

func writeString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch c {
			case '"':
				b.WriteString(`\"`)
			case '\\':
				b.WriteString(`\\`)
			case '\b':
				b.WriteString(`\b`)
			case '\f':
				b.WriteString(`\f`)
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				if c < 0x20 {
					b.WriteString(`\u00`)
					b.WriteByte(hexDigits[c>>4])
					b.WriteByte(hexDigits[c&0xf])
				} else {
					b.WriteByte(c)
				}
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			// Not valid UTF-8; JavaScript strings can't hold this, so write the replacement character.
			b.WriteString("�")
		} else {
			b.WriteString(s[i : i+size])
		}
		i += size
	}
	b.WriteByte('"')
}

// FormatNumber is JavaScript's Number.prototype.toString() for finite numbers.
func FormatNumber(f float64) string {
	if f == 0 {
		return "0"
	}
	if math.IsNaN(f) {
		return "NaN"
	}
	if math.IsInf(f, 1) {
		return "Infinity"
	}
	if math.IsInf(f, -1) {
		return "-Infinity"
	}
	sign := ""
	if f < 0 {
		sign = "-"
		f = -f
	}
	// Shortest round-trip digits, as "d.ddde±x".
	e := strconv.FormatFloat(f, 'e', -1, 64)
	mant, expPart, _ := strings.Cut(e, "e")
	exp, _ := strconv.Atoi(expPart)
	digits := strings.Replace(mant, ".", "", 1)
	k := len(digits)
	n := exp + 1
	var out string
	switch {
	case k <= n && n <= 21:
		out = digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		out = digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		out = "0." + strings.Repeat("0", -n) + digits
	default:
		es := "+"
		if n-1 < 0 {
			es = "-"
		}
		ae := n - 1
		if ae < 0 {
			ae = -ae
		}
		if k == 1 {
			out = digits + "e" + es + strconv.Itoa(ae)
		} else {
			out = digits[:1] + "." + digits[1:] + "e" + es + strconv.Itoa(ae)
		}
	}
	return sign + out
}

// String is JavaScript's String(v), for messages.
func String(v any, defined bool) string {
	if !defined {
		return "undefined"
	}
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return FormatNumber(x)
	case string:
		return x
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = String(e, true)
			}
		}
		return strings.Join(parts, ",")
	case *Object:
		return "[object Object]"
	}
	return ""
}

// UTF16Len is JavaScript's string length (UTF-16 code units).
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// FNV1a is lite/src/config.ts's fnv1a: 32-bit FNV-1a over UTF-16 code units, as 8 hex digits.
func FNV1a(s string) string {
	h := uint32(0x811c9dc5)
	for _, u := range utf16.Encode([]rune(s)) {
		h ^= uint32(u)
		h *= 0x01000193
	}
	out := strconv.FormatUint(uint64(h), 16)
	return strings.Repeat("0", 8-len(out)) + out
}

// Trim is String.prototype.trim: JavaScript's whitespace includes U+FEFF, Go's doesn't.
func Trim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
			return true
		}
		return r >= 0x2000 && r <= 0x200A
	})
}

// EncodeURIComponent is JavaScript's: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is escaped.
func EncodeURIComponent(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte("-_.!~*'()", c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&15])
	}
	return b.String()
}
