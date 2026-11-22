package authcrypto

import (
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/testdata"
)

type goldenAuth struct {
	Secret      string `json:"secret"`
	OtherSecret string `json:"otherSecret"`
	PepperID    string `json:"pepperId"`
	Iterations  int    `json:"iterations"`
	Hashes      []struct {
		Password    string `json:"password"`
		Iterations  int    `json:"iterations"`
		RandomStart int    `json:"randomStart"`
		Hash        string `json:"hash"`
	} `json:"hashes"`
	VerifyCases []struct {
		Stored   string `json:"stored"`
		Password string `json:"password"`
		OK       bool   `json:"ok"`
		Rehash   bool   `json:"rehash"`
	} `json:"verifyCases"`
	TOTPSecretHex string `json:"totpSecretHex"`
	Codes         []struct {
		Step int64  `json:"step"`
		Code string `json:"code"`
	} `json:"codes"`
	RFCCodes []struct {
		Step int64  `json:"step"`
		Code string `json:"code"`
	} `json:"rfcCodes"`
	VerifyTOTPCases []struct {
		Code     string `json:"code"`
		LastStep *int64 `json:"lastStep"`
		Now      int64  `json:"now"`
		Step     *int64 `json:"step"`
	} `json:"verifyTotpCases"`
	Base32 []struct {
		Hex     string `json:"hex"`
		Encoded string `json:"encoded"`
	} `json:"base32"`
	Base32Decoded []struct {
		Input string `json:"input"`
		Hex   string `json:"hex"`
	} `json:"base32Decoded"`
	Encrypted struct {
		RandomStart int    `json:"randomStart"`
		Stored      string `json:"stored"`
		RawHex      string `json:"rawHex"`
	} `json:"encrypted"`
	RandomToken struct {
		RandomStart int    `json:"randomStart"`
		Token       string `json:"token"`
	} `json:"randomToken"`
	RecoveryCodes struct {
		RandomStart int      `json:"randomStart"`
		Codes       []string `json:"codes"`
	} `json:"recoveryCodes"`
	Normalized []struct {
		Input  string `json:"input"`
		Output string `json:"output"`
	} `json:"normalized"`
	OTPAuth []struct {
		Account string `json:"account"`
		Secret  string `json:"secret"`
		URI     string `json:"uri"`
	} `json:"otpauth"`
	SHA256 []struct {
		Input string `json:"input"`
		Hex   string `json:"hex"`
	} `json:"sha256"`
}

func load(t *testing.T) *goldenAuth {
	t.Helper()
	var g goldenAuth
	if err := json.Unmarshal(testdata.GoldenAuth, &g); err != nil {
		t.Fatal(err)
	}
	return &g
}

// counting replaces randRead with Lite's golden counter (1, 2, 3, ... mod 256) from start.
func counting(t *testing.T, start int) {
	t.Helper()
	n := start
	old := randRead
	randRead = func(b []byte) {
		for i := range b {
			n++
			b[i] = byte(n)
		}
	}
	t.Cleanup(func() { randRead = old })
}

func TestGoldenPasswords(t *testing.T) {
	g := load(t)
	keys, err := OperatorKeys(g.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if keys.PepperID != g.PepperID || PBKDF2Iterations != g.Iterations {
		t.Fatalf("pepper id %s iterations %d, Lite %s %d", keys.PepperID, PBKDF2Iterations, g.PepperID, g.Iterations)
	}
	for _, h := range g.Hashes {
		counting(t, h.RandomStart)
		got, err := hashPasswordWith(g.Secret, h.Password, h.Iterations)
		if err != nil {
			t.Fatal(err)
		}
		if got != h.Hash {
			t.Errorf("hash of %q:\n got %s\nLite %s", h.Password, got, h.Hash)
		}
	}
	for _, c := range g.VerifyCases {
		ok, rehash, err := VerifyPassword(g.Secret, c.Password, c.Stored)
		if err != nil {
			t.Fatal(err)
		}
		if ok != c.OK || rehash != c.Rehash {
			t.Errorf("verify %q against %q: ok %v rehash %v, Lite %v %v", c.Password, c.Stored, ok, rehash, c.OK, c.Rehash)
		}
	}
	// A hash made by Standard verifies, and isn't asked to re-hash.
	fresh, err := HashPassword(g.Secret, "a long test passphrase")
	if err != nil {
		t.Fatal(err)
	}
	if ok, rehash, _ := VerifyPassword(g.Secret, "a long test passphrase", fresh); !ok || rehash {
		t.Fatalf("fresh hash: ok %v rehash %v", ok, rehash)
	}
	if _, err := OperatorKeys("too short"); err != ErrSecretMissing {
		t.Fatalf("short secret: %v", err)
	}
}

func TestGoldenTOTP(t *testing.T) {
	g := load(t)
	secret, _ := hex.DecodeString(g.TOTPSecretHex)
	for _, c := range g.Codes {
		if got := TOTPCode(secret, c.Step); got != c.Code {
			t.Errorf("step %d: %s, Lite %s", c.Step, got, c.Code)
		}
	}
	for _, c := range g.RFCCodes {
		if got := TOTPCode([]byte("12345678901234567890"), c.Step); got != c.Code {
			t.Errorf("RFC step %d: %s, Lite %s", c.Step, got, c.Code)
		}
	}
	for _, c := range g.VerifyTOTPCases {
		step, ok := VerifyTOTP(secret, c.Code, c.Now, c.LastStep)
		if ok != (c.Step != nil) || (ok && step != *c.Step) {
			t.Errorf("verify %q (last %v): %d %v, Lite %v", c.Code, c.LastStep, step, ok, c.Step)
		}
	}
	for _, c := range g.Base32 {
		b, _ := hex.DecodeString(c.Hex)
		if got := Base32Encode(b); got != c.Encoded {
			t.Errorf("base32 %s: %s, Lite %s", c.Hex, got, c.Encoded)
		}
	}
	for _, c := range g.Base32Decoded {
		b, err := Base32Decode(c.Input)
		if err != nil || hex.EncodeToString(b) != c.Hex {
			t.Errorf("base32 decode %q: %x %v, Lite %s", c.Input, b, err, c.Hex)
		}
	}
	for _, c := range g.OTPAuth {
		if got := OTPAuthURI(c.Secret, c.Account); got != c.URI {
			t.Errorf("otpauth %q:\n got %s\nLite %s", c.Account, got, c.URI)
		}
	}
}

func TestGoldenEncryptedSecretAndTokens(t *testing.T) {
	g := load(t)
	raw, err := DecryptTOTPSecret(g.Secret, g.Encrypted.Stored)
	if err != nil || hex.EncodeToString(raw) != g.Encrypted.RawHex {
		t.Fatalf("decrypting Lite's secret: %x %v", raw, err)
	}
	counting(t, g.Encrypted.RandomStart)
	enc, err := EncryptTOTPSecret(g.Secret, raw)
	if err != nil || enc != g.Encrypted.Stored {
		t.Fatalf("encrypting: %s, Lite %s (%v)", enc, g.Encrypted.Stored, err)
	}
	if _, err := DecryptTOTPSecret(g.OtherSecret, g.Encrypted.Stored); err == nil {
		t.Fatal("decrypted with another secret")
	}
	counting(t, g.RandomToken.RandomStart)
	if got := RandomToken(); got != g.RandomToken.Token {
		t.Fatalf("token %s, Lite %s", got, g.RandomToken.Token)
	}
	counting(t, g.RecoveryCodes.RandomStart)
	codes := NewRecoveryCodes(10)
	for i, c := range codes {
		if c != g.RecoveryCodes.Codes[i] {
			t.Fatalf("recovery codes %v, Lite %v", codes, g.RecoveryCodes.Codes)
		}
	}
	for _, c := range g.Normalized {
		if got := NormalizeRecoveryCode(c.Input); got != c.Output {
			t.Errorf("normalize %q: %q, Lite %q", c.Input, got, c.Output)
		}
	}
	for _, c := range g.SHA256 {
		if got := SHA256Hex(c.Input); got != c.Hex {
			t.Errorf("sha256 %q: %s, Lite %s", c.Input, got, c.Hex)
		}
	}
}
