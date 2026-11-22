package server

// Operator sign-in: /admin/v1/auth/*. A port of lite/src/office/auth.ts.
//
// Sessions: a random token in an HttpOnly, Secure, SameSite=Strict cookie; only its SHA-256 is
// stored. Cookie-authenticated requests that change anything must carry an Origin header matching
// this server (CSRF protection; browsers always send Origin on POST).
//
// Sign-in rules (plan section 8.2):
//   - the same answer, with the same CPU cost, for an unknown email and a wrong password;
//   - rate limits per IP and per email, plus a 15-minute lockout after 10 failures in a row;
//   - TOTP when the operator has enabled it (or a one-time recovery code instead);
//   - setup links (24 h) let a new operator set a password; recovery links (15 min) sign in once.
//
// Session kinds:
//
//	full      a normal sign-in (7 days);
//	setup     from a setup link: may only set the first password (30 minutes);
//	recovery  from a recovery link: full access for 30 minutes, and may set a new password or
//	          remove the authenticator without the old ones. Setting a password makes it full.

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// SessionCookie is the dashboard's session cookie.
const SessionCookie = "__Host-openpurr_session"

const (
	sessionMs      = 7 * 86_400_000
	shortSessionMs = 30 * 60_000 // setup and recovery sessions
	lockoutAfter   = 10
	lockoutMs      = 15 * 60_000
	passwordMin    = 12
	passwordMax    = 128
)

// session is a signed-in browser.
type session struct {
	op        *operator
	kind      string // full, setup or recovery
	tokenHash string
}

// sessionCookie is the session token from the Cookie header, as Lite reads it.
func sessionCookie(r *http.Request) string {
	for _, header := range r.Header.Values("Cookie") {
		for _, part := range splitCookie(header) {
			if i := strings.IndexByte(part, '='); i > 0 && part[:i] == SessionCookie {
				return part[i+1:]
			}
		}
	}
	return ""
}

// splitCookie splits a Cookie header on ";" and the whitespace after it (Lite: split(/;\s*/)).
func splitCookie(h string) []string {
	parts := strings.Split(h, ";")
	for i := range parts {
		if i > 0 {
			parts[i] = strings.TrimLeft(parts[i], " \t\n\r\f\v")
		}
	}
	return parts
}

// sessionFor is the signed-in operator for this request's session cookie, or nil.
func (s *server) sessionFor(ctx context.Context, r *http.Request, now int64) (*session, error) {
	token := sessionCookie(r)
	if token == "" {
		return nil, nil
	}
	hash := authcrypto.SHA256Hex(token)
	var kind string
	var expiresAt, lastSeen int64
	o, err := findOperator(ctx, s.Pool,
		`SELECT s.kind, s.expires_at, s.last_seen_at, `+operatorColumns+` FROM session s JOIN operator o ON o.id = s.operator_id
		 WHERE s.token_hash = $1 AND s.expires_at > $2 AND o.disabled_at IS NULL`,
		[]any{hash, now}, &kind, &expiresAt, &lastSeen)
	if err != nil || o == nil {
		return nil, err
	}
	if now-lastSeen > 3600_000 {
		s.Deferred.Go("stamp session", func(ctx context.Context) error {
			_, err := s.Pool.Exec(ctx, "UPDATE session SET last_seen_at = $1 WHERE token_hash = $2", s.Clock.Now(), hash)
			return err
		})
	}
	return &session{op: o, kind: kind, tokenHash: hash}, nil
}

func setSessionCookie(w http.ResponseWriter, token string, maxAgeMs int64) {
	w.Header().Set("Set-Cookie", SessionCookie+"="+token+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+strconv.FormatInt(maxAgeMs/1000, 10))
}

// startSession stores a new session and sets its cookie.
func (s *server) startSession(ctx context.Context, w http.ResponseWriter, operatorID, kind string, now int64) error {
	token := authcrypto.RandomToken()
	ttl := int64(shortSessionMs)
	if kind == "full" {
		ttl = sessionMs
	}
	if _, err := s.Pool.Exec(ctx,
		"INSERT INTO session (token_hash, operator_id, kind, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6)",
		authcrypto.SHA256Hex(token), operatorID, kind, now, now+ttl, now); err != nil {
		return err
	}
	setSessionCookie(w, token, ttl)
	return nil
}

func requireTOTPForEveryone(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (bool, error) {
	var v string
	err := db.QueryRow(ctx, "SELECT value FROM setting WHERE key = 'require_totp'").Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return v == "true", err
}

// officeAuth serves /admin/v1/auth/*.
func (s *server) officeAuth(w http.ResponseWriter, r *http.Request) {
	q := &adminReq{s: s, w: w, r: r, ctx: r.Context(), now: s.Clock.Now()}
	// Every write here needs a same-origin request (login included: no cross-site sign-in forms).
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.sameOrigin(r) {
		q.fail(http.StatusForbidden, "bad_origin", "Requests must come from the openpurr dashboard.")
		return
	}
	if len(s.OperatorSecret) < authcrypto.MinSecretLength {
		q.fail(http.StatusServiceUnavailable, "not_configured", authcrypto.ErrSecretMissing.Error())
		return
	}
	var err error
	path := strings.TrimPrefix(r.URL.EscapedPath(), "/admin/v1/auth")
	switch r.Method + " " + path {
	case "POST /login":
		err = s.authLogin(q)
	case "POST /logout":
		err = s.authLogout(q)
	case "GET /me", "HEAD /me":
		err = s.authMe(q)
	case "POST /link":
		err = s.authLink(q)
	case "POST /password":
		err = s.authPassword(q)
	case "POST /totp/setup":
		err = s.authTOTPSetup(q)
	case "POST /totp/enable":
		err = s.authTOTPEnable(q)
	case "POST /totp/disable":
		err = s.authTOTPDisable(q)
	default:
		// Lite falls through to the admin API, which wants a signed-in caller first.
		s.admin(w, r)
		return
	}
	if err != nil {
		q.internal(err)
	}
}

func (s *server) totpEnrollmentRequired(ctx context.Context, o *operator) (bool, error) {
	if o.TOTPEnabled != 0 {
		return false, nil
	}
	return requireTOTPForEveryone(ctx, s.Pool)
}

func (s *server) authLogin(q *adminReq) error {
	ctx := q.ctx
	email := ""
	if v, ok := q.propString("email"); ok {
		email = strings.ToLower(jsobj.Trim(v))
	}
	password, _ := q.propString("password")
	if email == "" || password == "" {
		q.fail(http.StatusBadRequest, "bad_request", "Email and password are required.")
		return nil
	}
	ip := q.ip()
	if (ip != nil && s.Limiters.IP != nil && !s.Limiters.IP.Allow(ctx, "login:"+*ip)) ||
		(s.Limiters.User != nil && !s.Limiters.User.Allow(ctx, "login:"+email)) {
		q.fail(http.StatusTooManyRequests, "rate_limited", "Too many sign-in attempts. Try again in a minute.")
		return nil
	}
	secret := s.OperatorSecret
	o, err := findOperator(ctx, s.Pool, "SELECT "+operatorColumns+" FROM operator o WHERE lower(o.email) = lower($1) AND o.disabled_at IS NULL", []any{email})
	if err != nil {
		return err
	}
	invalid := func() { q.fail(http.StatusUnauthorized, "invalid_credentials", "Wrong email or password.") }

	if o == nil || o.PasswordHash == nil || *o.PasswordHash == "" {
		if err := authcrypto.DummyPasswordCheck(secret, password); err != nil {
			return err
		}
		if err := writeAudit(ctx, s.Pool, q.now, auditEntry{actor: &email, action: "auth.login_failed", details: jsobj.New("reason", "unknown"), ip: ip}); err != nil {
			return err
		}
		invalid()
		return nil
	}
	if o.LockedUntil != nil && *o.LockedUntil > q.now {
		q.fail(http.StatusTooManyRequests, "locked", "Too many failed sign-ins. Try again in 15 minutes, or use a recovery link.")
		return nil
	}
	ok, rehash, err := authcrypto.VerifyPassword(secret, password, *o.PasswordHash)
	if err != nil {
		return err
	}
	if !ok {
		failures := o.FailedLogins + 1
		lockedUntil := o.LockedUntil
		if failures >= lockoutAfter {
			lockedUntil = new(int64)
			*lockedUntil = q.now + lockoutMs
		}
		err := q.tx(func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "UPDATE operator SET failed_logins = $1, locked_until = $2 WHERE id = $3", failures, lockedUntil, o.ID); err != nil {
				return err
			}
			e := operatorAudit(o, "auth.login_failed", ip)
			e.details = jsobj.New("reason", "password", "failures", float64(failures))
			return writeAudit(ctx, tx, q.now, e)
		})
		if err != nil {
			return err
		}
		invalid()
		return nil
	}

	// Second factor.
	var writes []func(tx pgx.Tx) error
	if o.TOTPEnabled != 0 {
		code := ""
		if v, ok := q.propString("code"); ok {
			code = jsobj.Trim(v)
		}
		recovery := ""
		if v, ok := q.propString("recovery_code"); ok {
			recovery = authcrypto.NormalizeRecoveryCode(v)
		}
		if code == "" && recovery == "" {
			q.fail(http.StatusUnauthorized, "totp_required", "Enter the code from your authenticator app.")
			return nil
		}
		if code != "" {
			step, matched := int64(0), false
			if o.TOTPSecret != nil {
				raw, err := authcrypto.DecryptTOTPSecret(secret, *o.TOTPSecret)
				if err != nil {
					return err
				}
				step, matched = authcrypto.VerifyTOTP(raw, code, q.now, o.TOTPLastStep)
			}
			if matched {
				// Claimed atomically, so one code can't sign in twice even at the same moment.
				tag, err := s.Pool.Exec(ctx, "UPDATE operator SET totp_last_step = $1 WHERE id = $2 AND (totp_last_step IS NULL OR totp_last_step < $1)", step, o.ID)
				if err != nil {
					return err
				}
				matched = tag.RowsAffected() > 0
			}
			if !matched {
				err := q.tx(func(tx pgx.Tx) error {
					if _, err := tx.Exec(ctx, "UPDATE operator SET failed_logins = failed_logins + 1 WHERE id = $1", o.ID); err != nil {
						return err
					}
					e := operatorAudit(o, "auth.login_failed", ip)
					e.details = jsobj.New("reason", "totp")
					return writeAudit(ctx, tx, q.now, e)
				})
				if err != nil {
					return err
				}
				q.fail(http.StatusUnauthorized, "invalid_code", "That code didn't work. Check your authenticator app's time and try again.")
				return nil
			}
		} else {
			tag, err := s.Pool.Exec(ctx, "UPDATE recovery_code SET used_at = $1 WHERE operator_id = $2 AND code_hash = $3 AND used_at IS NULL",
				q.now, o.ID, authcrypto.SHA256Hex(recovery))
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				e := operatorAudit(o, "auth.login_failed", ip)
				e.details = jsobj.New("reason", "recovery_code")
				if err := writeAudit(ctx, s.Pool, q.now, e); err != nil {
					return err
				}
				q.fail(http.StatusUnauthorized, "invalid_code", "That recovery code isn't valid or was already used.")
				return nil
			}
			writes = append(writes, func(tx pgx.Tx) error {
				return writeAudit(ctx, tx, q.now, operatorAudit(o, "auth.recovery_code_used", ip))
			})
		}
	}

	var newHash string
	if rehash {
		if newHash, err = authcrypto.HashPassword(secret, password); err != nil {
			return err
		}
	}
	err = q.tx(func(tx pgx.Tx) error {
		for _, w := range writes {
			if err := w(tx); err != nil {
				return err
			}
		}
		if newHash != "" {
			if _, err := tx.Exec(ctx, "UPDATE operator SET password_hash = $1 WHERE id = $2", newHash, o.ID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, "UPDATE operator SET failed_logins = 0, locked_until = NULL, last_login_at = $1 WHERE id = $2", q.now, o.ID); err != nil {
			return err
		}
		return writeAudit(ctx, tx, q.now, operatorAudit(o, "auth.login", ip))
	})
	if err != nil {
		return err
	}
	if err := s.startSession(ctx, q.w, o.ID, "full", q.now); err != nil {
		return err
	}
	required, err := s.totpEnrollmentRequired(ctx, o)
	if err != nil {
		return err
	}
	q.json(http.StatusOK, jsobj.New("operator", publicOperator(o), "totp_enrollment_required", required))
	return nil
}

func (s *server) authLogout(q *adminReq) error {
	sess, err := s.sessionFor(q.ctx, q.r, q.now)
	if err != nil {
		return err
	}
	if sess != nil {
		err := q.tx(func(tx pgx.Tx) error {
			if _, err := tx.Exec(q.ctx, "DELETE FROM session WHERE token_hash = $1", sess.tokenHash); err != nil {
				return err
			}
			return writeAudit(q.ctx, tx, q.now, operatorAudit(sess.op, "auth.logout", q.ip()))
		})
		if err != nil {
			return err
		}
	}
	q.w.Header().Set("Set-Cookie", SessionCookie+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0")
	q.json(http.StatusOK, jsobj.New())
	return nil
}

func (s *server) authMe(q *adminReq) error {
	sess, err := s.sessionFor(q.ctx, q.r, q.now)
	if err != nil {
		return err
	}
	if sess == nil {
		q.fail(http.StatusUnauthorized, "signed_out", "Not signed in.")
		return nil
	}
	required, err := s.totpEnrollmentRequired(q.ctx, sess.op)
	if err != nil {
		return err
	}
	q.json(http.StatusOK, jsobj.New("operator", publicOperator(sess.op), "session", sess.kind, "totp_enrollment_required", required))
	return nil
}

// authLink redeems a setup or recovery link. Setup links give a short session that can only set a
// password.
func (s *server) authLink(q *adminReq) error {
	token, ok := q.propString("token")
	if !ok {
		q.fail(http.StatusBadRequest, "bad_request", "token is required.")
		return nil
	}
	ctx := q.ctx
	hash := authcrypto.SHA256Hex(token)
	var purpose string
	var o *operator
	err := q.tx(func(tx pgx.Tx) error {
		// Locked, so a link works exactly once even when redeemed twice at the same moment.
		var err error
		o, err = findOperator(ctx, tx,
			`SELECT l.purpose, `+operatorColumns+` FROM login_link l JOIN operator o ON o.id = l.operator_id
			 WHERE l.token_hash = $1 AND l.used_at IS NULL AND l.expires_at > $2 AND o.disabled_at IS NULL FOR UPDATE OF l`,
			[]any{hash, q.now}, &purpose)
		if err != nil || o == nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE login_link SET used_at = $1 WHERE token_hash = $2", q.now, hash); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE operator SET failed_logins = 0, locked_until = NULL WHERE id = $1", o.ID); err != nil {
			return err
		}
		return writeAudit(ctx, tx, q.now, operatorAudit(o, "auth."+purpose+"_link_used", q.ip()))
	})
	if err != nil {
		return err
	}
	if o == nil {
		q.fail(http.StatusUnauthorized, "invalid_link", "This link is invalid, expired or already used. Ask for a new one.")
		return nil
	}
	kind := "recovery"
	if purpose == "setup" {
		kind = "setup"
	}
	if err := s.startSession(ctx, q.w, o.ID, kind, q.now); err != nil {
		return err
	}
	q.json(http.StatusOK, jsobj.New("operator", publicOperator(o), "session", kind))
	return nil
}

func (s *server) authPassword(q *adminReq) error {
	ctx := q.ctx
	sess, err := s.sessionFor(ctx, q.r, q.now)
	if err != nil {
		return err
	}
	if sess == nil {
		q.fail(http.StatusUnauthorized, "signed_out", "Not signed in.")
		return nil
	}
	next, _ := q.propString("new_password")
	if n := jsobj.UTF16Len(next); n < passwordMin || n > passwordMax {
		q.fail(http.StatusBadRequest, "weak_password", "Use 12 to 128 characters. A passphrase or a password manager works well.")
		return nil
	}
	o := sess.op
	// A full session changing an existing password must prove it knows the current one. (Setup and
	// recovery sessions came from a one-time link, which is the proof.)
	if sess.kind == "full" && o.PasswordHash != nil && *o.PasswordHash != "" {
		current, _ := q.propString("current_password")
		ok, _, err := authcrypto.VerifyPassword(s.OperatorSecret, current, *o.PasswordHash)
		if err != nil {
			return err
		}
		if !ok {
			q.fail(http.StatusUnauthorized, "invalid_credentials", "The current password is wrong.")
			return nil
		}
	}
	hash, err := authcrypto.HashPassword(s.OperatorSecret, next)
	if err != nil {
		return err
	}
	err = q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "UPDATE operator SET password_hash = $1, failed_logins = 0, locked_until = NULL WHERE id = $2", hash, o.ID); err != nil {
			return err
		}
		// Other sessions end; this one becomes a full session.
		if _, err := tx.Exec(ctx, "DELETE FROM session WHERE operator_id = $1 AND token_hash <> $2", o.ID, sess.tokenHash); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE session SET kind = 'full', expires_at = $1 WHERE token_hash = $2", q.now+sessionMs, sess.tokenHash); err != nil {
			return err
		}
		return writeAudit(ctx, tx, q.now, operatorAudit(o, "auth.password_changed", q.ip()))
	})
	if err != nil {
		return err
	}
	required, err := s.totpEnrollmentRequired(ctx, o)
	if err != nil {
		return err
	}
	q.json(http.StatusOK, jsobj.New("totp_enrollment_required", required))
	return nil
}

// fullSession is a signed-in session (full or recovery), or nil.
func (s *server) fullSession(q *adminReq) (*session, error) {
	sess, err := s.sessionFor(q.ctx, q.r, q.now)
	if err != nil || sess == nil || sess.kind == "setup" {
		return nil, err
	}
	return sess, nil
}

func (s *server) authTOTPSetup(q *adminReq) error {
	sess, err := s.fullSession(q)
	if err != nil {
		return err
	}
	if sess == nil {
		q.fail(http.StatusUnauthorized, "signed_out", "Not signed in.")
		return nil
	}
	if sess.op.TOTPEnabled != 0 {
		q.fail(http.StatusConflict, "already_enabled", "Two-step sign-in is already on.")
		return nil
	}
	raw := authcrypto.NewTOTPSecret()
	enc, err := authcrypto.EncryptTOTPSecret(s.OperatorSecret, raw)
	if err != nil {
		return err
	}
	if _, err := s.Pool.Exec(q.ctx, "UPDATE operator SET totp_secret = $1 WHERE id = $2", enc, sess.op.ID); err != nil {
		return err
	}
	b32 := authcrypto.Base32Encode(raw)
	q.json(http.StatusOK, jsobj.New("secret", b32, "otpauth_uri", authcrypto.OTPAuthURI(b32, sess.op.Email)))
	return nil
}

func (s *server) authTOTPEnable(q *adminReq) error {
	ctx := q.ctx
	sess, err := s.fullSession(q)
	if err != nil {
		return err
	}
	if sess == nil {
		q.fail(http.StatusUnauthorized, "signed_out", "Not signed in.")
		return nil
	}
	o := sess.op
	if o.TOTPEnabled != 0 {
		q.fail(http.StatusConflict, "already_enabled", "Two-step sign-in is already on.")
		return nil
	}
	if o.TOTPSecret == nil || *o.TOTPSecret == "" {
		q.fail(http.StatusBadRequest, "no_setup", "Start with /totp/setup.")
		return nil
	}
	raw, err := authcrypto.DecryptTOTPSecret(s.OperatorSecret, *o.TOTPSecret)
	if err != nil {
		return err
	}
	v, defined := q.prop("code")
	code := jsobj.String(v, defined)
	if !defined || v == nil {
		code = "" // String(body?.code ?? "")
	}
	step, ok := authcrypto.VerifyTOTP(raw, code, q.now, nil)
	if !ok {
		q.fail(http.StatusBadRequest, "invalid_code", "That code didn't work. Check your authenticator app's time and try again.")
		return nil
	}
	codes := authcrypto.NewRecoveryCodes(10)
	err = q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "UPDATE operator SET totp_enabled = 1, totp_last_step = $1 WHERE id = $2", step, o.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM recovery_code WHERE operator_id = $1", o.ID); err != nil {
			return err
		}
		for _, c := range codes {
			if _, err := tx.Exec(ctx, "INSERT INTO recovery_code (operator_id, code_hash) VALUES ($1, $2)", o.ID, authcrypto.SHA256Hex(c)); err != nil {
				return err
			}
		}
		return writeAudit(ctx, tx, q.now, operatorAudit(o, "auth.totp_enabled", q.ip()))
	})
	if err != nil {
		return err
	}
	// Shown once. Each works one time in place of an authenticator code.
	q.json(http.StatusOK, jsobj.New("recovery_codes", stringsToAny(codes)))
	return nil
}

func (s *server) authTOTPDisable(q *adminReq) error {
	ctx := q.ctx
	sess, err := s.fullSession(q)
	if err != nil {
		return err
	}
	if sess == nil {
		q.fail(http.StatusUnauthorized, "signed_out", "Not signed in.")
		return nil
	}
	o := sess.op
	// A recovery session may remove a lost authenticator even when it's required; the operator then
	// has to enroll a new one before doing anything else (see adminAuthenticate).
	recovering := sess.kind == "recovery"
	if !recovering {
		required, err := requireTOTPForEveryone(ctx, s.Pool)
		if err != nil {
			return err
		}
		if required {
			q.fail(http.StatusForbidden, "required", "The owner requires two-step sign-in for everyone.")
			return nil
		}
		v, defined := q.prop("password")
		password := jsobj.String(v, defined)
		if !defined || v == nil {
			password = ""
		}
		ok := false
		if o.PasswordHash != nil && *o.PasswordHash != "" {
			if ok, _, err = authcrypto.VerifyPassword(s.OperatorSecret, password, *o.PasswordHash); err != nil {
				return err
			}
		}
		if !ok {
			q.fail(http.StatusUnauthorized, "invalid_credentials", "Confirm with your password.")
			return nil
		}
	}
	err = q.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "UPDATE operator SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = $1", o.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM recovery_code WHERE operator_id = $1", o.ID); err != nil {
			return err
		}
		e := operatorAudit(o, "auth.totp_disabled", q.ip())
		if recovering {
			e.details = jsobj.New("via", "recovery_link")
		}
		return writeAudit(ctx, tx, q.now, e)
	})
	if err != nil {
		return err
	}
	q.json(http.StatusOK, jsobj.New())
	return nil
}
