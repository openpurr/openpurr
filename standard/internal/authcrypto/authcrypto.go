// Package authcrypto holds operator credentials, in the formats of lite/src/office/auth-crypto.ts,
// so operators and their passwords, authenticators and recovery codes carry over from Lite.
//
// One secret, OPERATOR_SECRET (at least 32 random characters), feeds two keys through HKDF-SHA256
// (32 zero bytes of salt): the password pepper (HMAC-SHA256) and the TOTP secret encryption key
// (AES-256-GCM). Neither lives in the database, so a stolen database alone can't be used to crack
// passwords or generate TOTP codes.
//
// Passwords: HMAC-SHA256(pepper, password), then PBKDF2-SHA256 with a random 16-byte salt and
// PBKDF2Iterations, stored as
//
//	pbkdf2-sha256$<iterations>$<pepper id>$<salt b64>$<hash b64>
//
// so the iteration count or pepper can change, with passwords re-hashed at the next sign-in.
//
// TOTP: RFC 6238 with SHA-1, 30-second steps and 6 digits, accepting one step of drift either way.
package authcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// PBKDF2Iterations is Lite's iteration count. The pepper is what protects a leaked database; the
// count stays Lite's so hashes made by either edition verify on the other without a re-hash.
const PBKDF2Iterations = 20_000

// MinSecretLength is the shortest OPERATOR_SECRET accepted.
const MinSecretLength = 32

// ErrSecretMissing means OPERATOR_SECRET isn't set or is too short.
var ErrSecretMissing = errors.New("The secret OPERATOR_SECRET must be set (at least 32 random characters).")

// Keys are what OPERATOR_SECRET derives.
type Keys struct {
	pepper   []byte
	PepperID string
	totp     cipher.AEAD
}

var keyCache sync.Map // secret -> *Keys

// randRead fills b with random bytes; tests replace it to make salts and IVs predictable.
var randRead = func(b []byte) { _, _ = rand.Read(b) }

// OperatorKeys derives (once per secret) the keys from OPERATOR_SECRET.
func OperatorKeys(secret string) (*Keys, error) {
	if len(secret) < MinSecretLength {
		return nil, ErrSecretMissing
	}
	if k, ok := keyCache.Load(secret); ok {
		return k.(*Keys), nil
	}
	salt := make([]byte, 32)
	pepper, err := hkdf.Key(sha256.New, []byte(secret), salt, "openpurr password pepper v1", 32)
	if err != nil {
		return nil, err
	}
	totpKey, err := hkdf.Key(sha256.New, []byte(secret), salt, "openpurr totp encryption v1", 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(totpKey)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	k := &Keys{pepper: pepper, PepperID: SHA256Hex("pepper-id:" + secret)[:8], totp: aead}
	actual, _ := keyCache.LoadOrStore(secret, k)
	return actual.(*Keys), nil
}

// SHA256Hex is the lowercase hex SHA-256 of a string's UTF-8 bytes (how tokens, links, sessions
// and recovery codes are stored).
func SHA256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (k *Keys) derivePassword(password string, salt []byte, iterations int) ([]byte, error) {
	mac := hmac.New(sha256.New, k.pepper)
	mac.Write([]byte(password))
	return pbkdf2.Key(sha256.New, string(mac.Sum(nil)), salt, iterations, 32)
}

// HashPassword hashes a password with a fresh salt.
func HashPassword(secret, password string) (string, error) {
	return hashPasswordWith(secret, password, PBKDF2Iterations)
}

func hashPasswordWith(secret, password string, iterations int) (string, error) {
	k, err := OperatorKeys(secret)
	if err != nil {
		return "", err
	}
	salt := make([]byte, 16)
	randRead(salt)
	hash, err := k.derivePassword(password, salt, iterations)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s$%s", iterations, k.PepperID,
		base64.StdEncoding.EncodeToString(salt), base64.StdEncoding.EncodeToString(hash)), nil
}

// The most iterations a stored hash may ask for (Workers' PBKDF2 limit), so a tampered row can't
// make a sign-in spin.
const maxIterations = 100_000

// VerifyPassword checks a password. rehash is true when it matched but was stored with other
// parameters. A hash made with a different OPERATOR_SECRET can't be checked: reset it with a login
// link.
func VerifyPassword(secret, password, stored string) (ok, rehash bool, err error) {
	k, err := OperatorKeys(secret)
	if err != nil {
		return false, false, err
	}
	parts := strings.Split(stored, "$")
	get := func(i int) string {
		if i < len(parts) {
			return parts[i]
		}
		return ""
	}
	alg, iter, pepperID, salt, hash := get(0), get(1), get(2), get(3), get(4)
	if alg != "pbkdf2-sha256" || iter == "" || salt == "" || hash == "" {
		return false, false, nil
	}
	if pepperID != k.PepperID {
		return false, false, nil
	}
	iterations, convErr := strconv.Atoi(iter)
	saltBytes, err1 := base64.StdEncoding.DecodeString(salt)
	want, err2 := base64.StdEncoding.DecodeString(hash)
	if convErr != nil || iterations < 1 || iterations > maxIterations || err1 != nil || err2 != nil {
		return false, false, nil
	}
	got, err := k.derivePassword(password, saltBytes, iterations)
	if err != nil {
		return false, false, err
	}
	ok = subtle.ConstantTimeCompare(got, want) == 1
	return ok, ok && iterations != PBKDF2Iterations, nil
}

// DummyPasswordCheck spends the same CPU as a real check, so unknown emails don't answer faster.
func DummyPasswordCheck(secret, password string) error {
	k, err := OperatorKeys(secret)
	if err != nil {
		return err
	}
	_, err = k.derivePassword(password, make([]byte, 16), PBKDF2Iterations)
	return err
}

// --- TOTP ----------------------------------------------------------------------------------------

const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

// Base32Encode is RFC 4648 base32 without padding.
func Base32Encode(b []byte) string {
	var out strings.Builder
	bits, value := 0, 0
	for _, c := range b {
		value = (value<<8 | int(c)) & 0xffff
		bits += 8
		for bits >= 5 {
			out.WriteByte(b32[(value>>(bits-5))&31])
			bits -= 5
		}
	}
	if bits > 0 {
		out.WriteByte(b32[(value<<(5-bits))&31])
	}
	return out.String()
}

// Base32Decode reads base32, ignoring case, spaces, dashes and padding.
func Base32Decode(s string) ([]byte, error) {
	var out []byte
	bits, value := 0, 0
	for _, ch := range strings.ToUpper(s) {
		switch ch {
		case ' ', '\t', '\n', '\r', '\f', '\v', '=', '-':
			continue
		}
		v := strings.IndexRune(b32, ch)
		if v < 0 {
			return nil, errors.New("Invalid base32")
		}
		value = (value<<5 | v) & 0xffff
		bits += 5
		if bits >= 8 {
			out = append(out, byte(value>>(bits-8)))
			bits -= 8
		}
	}
	return out, nil
}

// TOTPStepSeconds is the TOTP time step.
const TOTPStepSeconds = 30

// TOTPCode is the 6-digit code for a time step (RFC 6238 / RFC 4226).
func TOTPCode(secret []byte, step int64) string {
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, secret)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[19] & 15
	bin := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", bin%1_000_000)
}

var sixDigits = regexp.MustCompile(`^[0-9]{6}$`)

// VerifyTOTP returns the step a code matches (within one step of drift), never at or before
// lastStep (nil: none), and false when it matches none.
func VerifyTOTP(secret []byte, code string, nowMs int64, lastStep *int64) (int64, bool) {
	if !sixDigits.MatchString(code) {
		return 0, false
	}
	current := floorDiv(nowMs, 1000*TOTPStepSeconds)
	for _, step := range []int64{current, current - 1, current + 1} {
		if lastStep != nil && step <= *lastStep {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(TOTPCode(secret, step)), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// NewTOTPSecret is 20 random bytes.
func NewTOTPSecret() []byte {
	b := make([]byte, 20)
	randRead(b)
	return b
}

// OTPAuthURI is the otpauth:// link an authenticator app reads from a QR code.
func OTPAuthURI(secretB32, account string) string {
	const issuer = "openpurr"
	label := jsobj.EncodeURIComponent(issuer + ":" + account)
	return "otpauth://totp/" + label + "?secret=" + secretB32 + "&issuer=" + jsobj.EncodeURIComponent(issuer) +
		"&algorithm=SHA1&digits=6&period=" + strconv.Itoa(TOTPStepSeconds)
}

// EncryptTOTPSecret encrypts a TOTP secret for the database: v1:<iv b64>:<ciphertext b64>.
func EncryptTOTPSecret(secret string, raw []byte) (string, error) {
	k, err := OperatorKeys(secret)
	if err != nil {
		return "", err
	}
	iv := make([]byte, 12)
	randRead(iv)
	ct := k.totp.Seal(nil, iv, raw, nil)
	return "v1:" + base64.StdEncoding.EncodeToString(iv) + ":" + base64.StdEncoding.EncodeToString(ct), nil
}

// DecryptTOTPSecret reverses EncryptTOTPSecret.
func DecryptTOTPSecret(secret, stored string) ([]byte, error) {
	k, err := OperatorKeys(secret)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(stored, ":")
	if len(parts) < 3 || parts[0] != "v1" || parts[1] == "" || parts[2] == "" {
		return nil, errors.New("Unknown TOTP secret format")
	}
	iv, err1 := base64.StdEncoding.DecodeString(parts[1])
	ct, err2 := base64.StdEncoding.DecodeString(parts[2])
	if err1 != nil || err2 != nil || len(iv) != k.totp.NonceSize() {
		return nil, errors.New("Unknown TOTP secret format")
	}
	return k.totp.Open(nil, iv, ct, nil)
}

// --- tokens and recovery codes ---------------------------------------------------------------------

// RandomToken is 32 random bytes, base64url without padding (sessions, links, access tokens).
func RandomToken() string {
	var b [32]byte
	randRead(b[:])
	return base64.RawURLEncoding.EncodeToString(b[:])
}

const recoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

// NewRecoveryCodes are n one-time codes like "k7m2-9qpd" (sign-in is rate limited).
func NewRecoveryCodes(n int) []string {
	codes := make([]string, n)
	for i := range codes {
		var b [8]byte
		randRead(b[:])
		s := make([]byte, 8)
		for j, c := range b {
			s[j] = recoveryAlphabet[int(c)%len(recoveryAlphabet)]
		}
		codes[i] = string(s[:4]) + "-" + string(s[4:])
	}
	return codes
}

// NormalizeRecoveryCode reads a recovery code as typed: any case, any separators.
func NormalizeRecoveryCode(code string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(code) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	s := b.String()
	if len(s) == 8 {
		return s[:4] + "-" + s[4:]
	}
	return s
}
