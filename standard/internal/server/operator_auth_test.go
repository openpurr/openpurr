package server_test

// Operator sign-in over /admin/v1/auth. Mirrors lite/test/operator-auth.test.ts (the credential
// crypto is in internal/authcrypto), plus sign-in with credentials Lite made.

import (
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

func expectStatus(t *testing.T, res *tu.Response, status int) *tu.Response {
	t.Helper()
	if res.Status != status {
		t.Fatalf("status %d, want %d: %s", res.Status, status, res.Body)
	}
	return res
}

func code(t *testing.T, res *tu.Response) string {
	t.Helper()
	c, _ := res.Get(t, "code").(string)
	return c
}

// invite makes an operator who hasn't used their setup link yet; it returns the link token.
func invite(t *testing.T, env *tu.Env, owner, role string) (id, email, token string) {
	t.Helper()
	email = role + "-invite-" + strings.ToLower(t.Name()[len(t.Name())-6:]) + "@example.com"
	email = strings.ReplaceAll(strings.ReplaceAll(email, "/", ""), " ", "")
	res := expectStatus(t, env.Admin("POST", "/operators", tu.Auth{Token: owner}, jsobj.New("email", email, "role", role)), 201)
	return res.Get(t, "id").(string), email, tu.LinkToken(res.Get(t, "setup_link").(string))
}

// recoveryLink writes a recovery link straight into the database, as `openpurr admin login-link` does.
func recoveryLink(env *tu.Env, operatorID string) string {
	token := authcrypto.RandomToken()
	env.Exec("INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES ($1, $2, 'recovery', $3, $4)",
		authcrypto.SHA256Hex(token), operatorID, env.Clock.Now()+15*60_000, env.Clock.Now())
	return token
}

func enrollTOTP(t *testing.T, env *tu.Env, session string) (secret []byte, codes []string) {
	t.Helper()
	setup := expectStatus(t, env.Admin("POST", "/auth/totp/setup", tu.Auth{Session: session}, jsobj.New()), 200)
	if uri := setup.Get(t, "otpauth_uri").(string); !strings.HasPrefix(uri, "otpauth://totp/openpurr%3A") {
		t.Fatalf("uri %s", uri)
	}
	secret, err := authcrypto.Base32Decode(setup.Get(t, "secret").(string))
	if err != nil {
		t.Fatal(err)
	}
	enable := expectStatus(t, env.Admin("POST", "/auth/totp/enable", tu.Auth{Session: session},
		jsobj.New("code", authcrypto.TOTPCode(secret, env.Clock.Now()/30_000))), 200)
	for _, c := range enable.Get(t, "recovery_codes").([]any) {
		codes = append(codes, c.(string))
	}
	if len(codes) != 10 {
		t.Fatalf("codes %v", codes)
	}
	return secret, codes
}

func TestSetupLinksAndPasswords(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	owner := env.OwnerToken()

	t.Run("a setup link gives a setup-only session; setting a password makes it a full session", func(t *testing.T) {
		_, email, token := invite(t, env, owner, "owner")
		link := expectStatus(t, env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", token)), 200)
		if link.Get(t, "session") != "setup" || !strings.Contains(link.Header.Get("Set-Cookie"), "HttpOnly; Secure; SameSite=Strict; Max-Age=1800") {
			t.Fatalf("%s %s", link.Body, link.Header.Get("Set-Cookie"))
		}
		session := tu.SessionFrom(link)
		expectStatus(t, env.Admin("POST", "/auth/totp/setup", tu.Auth{Session: session}, jsobj.New()), 401)
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Session: session}, nil), 401)
		if c := code(t, env.Admin("POST", "/auth/password", tu.Auth{Session: session}, jsobj.New("new_password", "short"))); c != "weak_password" {
			t.Fatal(c)
		}
		expectStatus(t, env.Admin("POST", "/auth/password", tu.Auth{Session: session}, jsobj.New("new_password", "a perfectly fine passphrase")), 200)
		me := expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{Session: session}, nil), 200)
		want := `{"operator":{"id":`
		if !strings.HasPrefix(string(me.Body), want) || me.Get(t, "session") != "full" || me.Get(t, "operator", "email") != email ||
			me.Get(t, "operator", "has_password") != true || me.Get(t, "operator", "totp_enabled") != false {
			t.Fatalf("%s", me.Body)
		}
		// A full session changing its password must know the current one.
		expectStatus(t, env.Admin("POST", "/auth/password", tu.Auth{Session: session}, jsobj.New("new_password", "another fine passphrase", "current_password", "wrong")), 401)
		expectStatus(t, env.Admin("POST", "/auth/password", tu.Auth{Session: session},
			jsobj.New("new_password", "another fine passphrase", "current_password", "a perfectly fine passphrase")), 200)
	})

	t.Run("links work once, and not after they expire", func(t *testing.T) {
		_, _, token := invite(t, env, owner, "viewer")
		expectStatus(t, env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", token)), 200)
		if c := code(t, env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", token))); c != "invalid_link" {
			t.Fatal(c)
		}
		_, _, expired := invite(t, env, owner, "developer")
		env.Clock.Add(24*3600_000 + 60_000)
		if c := code(t, env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", expired))); c != "invalid_link" {
			t.Fatal(c)
		}
	})
}

func TestSignIn(t *testing.T) {
	t.Run("signs in with the password and sets a session cookie; signs out", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		res, session := env.Login(strings.ToUpper(op.Email), tu.Password)
		expectStatus(t, res, 200)
		if res.Get(t, "operator", "email") != op.Email || res.Get(t, "totp_enrollment_required") != false {
			t.Fatalf("%s", res.Body)
		}
		var last *int64
		env.QueryRow("SELECT last_login_at FROM operator WHERE id = $1", []any{op.ID}, &last)
		if last == nil || *last != env.Clock.Now() {
			t.Fatalf("last_login_at %v", last)
		}
		out := env.Admin("POST", "/auth/logout", tu.Auth{Session: session}, jsobj.New())
		if !strings.Contains(out.Header.Get("Set-Cookie"), "Max-Age=0") {
			t.Fatal(out.Header)
		}
		expectStatus(t, env.Admin("GET", "/auth/me", tu.Auth{Session: session}, nil), 401)
	})

	t.Run("gives the same answer for an unknown email and a wrong password", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		wrong, _ := env.Login(op.Email, "not the password at all")
		unknown, _ := env.Login("nobody@example.com", "not the password at all")
		if wrong.Status != 401 || string(wrong.Body) != string(unknown.Body) {
			t.Fatalf("%s / %s", wrong.Body, unknown.Body)
		}
		if c := code(t, env.Admin("POST", "/auth/login", tu.Auth{}, jsobj.New("email", op.Email))); c != "bad_request" {
			t.Fatal(c)
		}
	})

	t.Run("locks the account for 15 minutes after 10 failures; a recovery link still works", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		for i := 0; i < 10; i++ {
			env.Login(op.Email, "wrong password")
		}
		locked, _ := env.Login(op.Email, tu.Password)
		if locked.Status != 429 || code(t, locked) != "locked" {
			t.Fatalf("%d %s", locked.Status, locked.Body)
		}
		link := expectStatus(t, env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", recoveryLink(env, op.ID))), 200)
		if link.Get(t, "session") != "recovery" {
			t.Fatalf("%s", link.Body)
		}
		ok, _ := env.Login(op.Email, tu.Password)
		expectStatus(t, ok, 200)

		// The lockout also runs out on its own.
		for i := 0; i < 10; i++ {
			env.Login(op.Email, "wrong password")
		}
		env.Clock.Add(14 * 60_000)
		again, _ := env.Login(op.Email, tu.Password)
		expectStatus(t, again, 429)
		env.Clock.Add(61_000)
		after, _ := env.Login(op.Email, tu.Password)
		expectStatus(t, after, 200)
	})

	t.Run("rate limits sign-in attempts per IP", func(t *testing.T) {
		limit := 3
		env := tu.Start(t, tu.Options{IPLimit: &limit})
		for i := 0; i < 3; i++ {
			expectStatus(t, env.Admin("POST", "/auth/login", tu.Auth{IP: "203.0.113.9"}, jsobj.New("email", "x@example.com", "password", "whatever it is")), 401)
		}
		res := env.Admin("POST", "/auth/login", tu.Auth{IP: "203.0.113.9"}, jsobj.New("email", "x@example.com", "password", "whatever it is"))
		if res.Status != 429 || code(t, res) != "rate_limited" || env.Counts["ip:login:203.0.113.9"] != 4 {
			t.Fatalf("%d %s %v", res.Status, res.Body, env.Counts)
		}
	})

	t.Run("rejects cross-site requests (no matching Origin), including sign-in", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		body := jsobj.New("email", op.Email, "password", tu.Password)
		expectStatus(t, env.Admin("POST", "/auth/login", tu.Auth{Origin: "-"}, body), 403)
		expectStatus(t, env.Admin("POST", "/auth/login", tu.Auth{Origin: "https://evil.example"}, body), 403)
		// The scheme counts too.
		res := env.Admin("POST", "/auth/login", tu.Auth{Origin: strings.Replace(env.Server.URL, "http://", "https://", 1)}, body)
		expectStatus(t, res, 403)
	})

	t.Run("answers 503 when OPERATOR_SECRET isn't set", func(t *testing.T) {
		env := tu.Start(t, tu.Options{OperatorSecret: "-"})
		res := env.Admin("POST", "/auth/login", tu.Auth{}, jsobj.New("email", "a@example.com", "password", "whatever it is"))
		if res.Status != 503 || code(t, res) != "not_configured" {
			t.Fatalf("%d %s", res.Status, res.Body)
		}
	})
}

func TestTwoStepSignIn(t *testing.T) {
	t.Run("requires a code after the password, and refuses a code that was already used", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		secret, _ := enrollTOTP(t, env, op.Session)
		res, _ := env.Login(op.Email, tu.Password)
		if code(t, res) != "totp_required" {
			t.Fatalf("%s", res.Body)
		}
		// The enrollment used the current step.
		used, _ := env.Login(op.Email, tu.Password, "code", authcrypto.TOTPCode(secret, env.Clock.Now()/30_000))
		if code(t, used) != "invalid_code" {
			t.Fatalf("%s", used.Body)
		}
		env.Clock.Add(30_000)
		c := authcrypto.TOTPCode(secret, env.Clock.Now()/30_000)
		ok, _ := env.Login(op.Email, tu.Password, "code", c)
		expectStatus(t, ok, 200)
		again, _ := env.Login(op.Email, tu.Password, "code", c)
		if code(t, again) != "invalid_code" {
			t.Fatalf("%s", again.Body)
		}
	})

	t.Run("accepts each recovery code once instead of a TOTP code", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		_, codes := enrollTOTP(t, env, op.Session)
		typed := strings.ReplaceAll(strings.ToUpper(codes[0]), "-", " ")
		ok, _ := env.Login(op.Email, tu.Password, "recovery_code", typed)
		expectStatus(t, ok, 200)
		again, _ := env.Login(op.Email, tu.Password, "recovery_code", typed)
		if code(t, again) != "invalid_code" {
			t.Fatalf("%s", again.Body)
		}
	})

	t.Run("a recovery link replaces a lost password and authenticator, even when two-step is required", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		enrollTOTP(t, env, op.Session)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: op.Session}, jsobj.New("require_totp", true)), 200)
		link := expectStatus(t, env.Admin("POST", "/auth/link", tu.Auth{}, jsobj.New("token", recoveryLink(env, op.ID))), 200)
		session := tu.SessionFrom(link)
		expectStatus(t, env.Admin("POST", "/auth/totp/disable", tu.Auth{Session: session}, jsobj.New()), 200)
		// Without an authenticator, only /me until a new one is enrolled.
		expectStatus(t, env.Admin("GET", "/me", tu.Auth{Session: session}, nil), 200)
		if c := code(t, env.Admin("GET", "/operators", tu.Auth{Session: session}, nil)); c != "totp_enrollment_required" {
			t.Fatal(c)
		}
		expectStatus(t, env.Admin("POST", "/auth/password", tu.Auth{Session: session}, jsobj.New("new_password", "a brand new passphrase")), 200)
		enrollTOTP(t, env, session)
		expectStatus(t, env.Admin("GET", "/operators", tu.Auth{Session: session}, nil), 200)
		var details *string
		env.QueryRow("SELECT details FROM audit_log WHERE action = 'auth.totp_disabled'", nil, &details)
		if details == nil || *details != `{"via":"recovery_link"}` {
			t.Fatalf("%v", details)
		}
	})

	t.Run("can't be turned off when the owner requires it for everyone", func(t *testing.T) {
		env := tu.Start(t, tu.Options{})
		op := env.CreateOperator(env.OwnerToken(), "owner", nil)
		enrollTOTP(t, env, op.Session)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: op.Session}, jsobj.New("require_totp", true)), 200)
		expectStatus(t, env.Admin("POST", "/auth/totp/disable", tu.Auth{Session: op.Session}, jsobj.New("password", tu.Password)), 403)
		expectStatus(t, env.Admin("PUT", "/settings", tu.Auth{Session: op.Session}, jsobj.New("require_totp", false)), 200)
		expectStatus(t, env.Admin("POST", "/auth/totp/disable", tu.Auth{Session: op.Session}, jsobj.New("password", "wrong")), 401)
		expectStatus(t, env.Admin("POST", "/auth/totp/disable", tu.Auth{Session: op.Session}, jsobj.New("password", tu.Password)), 200)
	})
}

func TestAuditOfSignIns(t *testing.T) {
	env := tu.Start(t, tu.Options{})
	op := env.CreateOperator(env.OwnerToken(), "owner", nil)
	env.Login(op.Email, "definitely wrong pw")
	env.Login(op.Email, tu.Password)
	rows, err := env.Pool.Query(t.Context(), "SELECT action, details FROM audit_log WHERE operator_id = $1 ORDER BY id", op.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var action string
		var details *string
		_ = rows.Scan(&action, &details)
		if details != nil {
			action += " " + *details
		}
		got = append(got, action)
	}
	want := []string{"auth.setup_link_used", "auth.password_changed", `auth.login_failed {"reason":"password","failures":1}`, "auth.login"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("%v", got)
	}
}

// TestCredentialsFromLite signs in with a password hash, an encrypted TOTP secret and recovery
// codes made by Lite's code (golden-auth.json), as after a move from Lite.
func TestCredentialsFromLite(t *testing.T) {
	var g struct {
		Secret string `json:"secret"`
		Hashes []struct {
			Password string `json:"password"`
			Hash     string `json:"hash"`
		} `json:"hashes"`
		TOTPSecretHex string `json:"totpSecretHex"`
		Encrypted     struct {
			Stored string `json:"stored"`
		} `json:"encrypted"`
	}
	if err := json.Unmarshal(testdata.GoldenAuth, &g); err != nil {
		t.Fatal(err)
	}
	env := tu.Start(t, tu.Options{OperatorSecret: g.Secret})
	env.Exec(`INSERT INTO operator (id, email, name, role, password_hash, totp_secret, totp_enabled, created_at)
		VALUES ('lite-op', 'lite@example.com', 'Lite', 'owner', $1, $2, 1, 0)`, g.Hashes[0].Hash, g.Encrypted.Stored)
	env.Exec("INSERT INTO recovery_code (operator_id, code_hash) VALUES ('lite-op', $1)", authcrypto.SHA256Hex("k7m2-9qpd"))
	secret, _ := hex.DecodeString(g.TOTPSecretHex)
	res, _ := env.Login("lite@example.com", g.Hashes[0].Password, "code", authcrypto.TOTPCode(secret, env.Clock.Now()/30_000))
	expectStatus(t, res, 200)
	rec, _ := env.Login("lite@example.com", g.Hashes[0].Password, "recovery_code", "K7M2 9QPD")
	expectStatus(t, rec, 200)

	// A hash with Lite's older iteration count works and is re-hashed with the current one.
	old := g.Hashes[len(g.Hashes)-1]
	env.Exec("UPDATE operator SET password_hash = $1, totp_enabled = 0 WHERE id = 'lite-op'", old.Hash)
	expectStatus(t, func() *tu.Response { r, _ := env.Login("lite@example.com", old.Password); return r }(), 200)
	var stored string
	env.QueryRow("SELECT password_hash FROM operator WHERE id = 'lite-op'", nil, &stored)
	if !strings.HasPrefix(stored, "pbkdf2-sha256$20000$") {
		t.Fatalf("not re-hashed: %s", stored)
	}
}
