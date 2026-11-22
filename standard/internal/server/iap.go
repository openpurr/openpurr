package server

// Signing in through Google's Identity-Aware Proxy: Standard's counterpart to Cloudflare Access
// (project plan section 8.2). Off unless IAP_AUDIENCE is set (Deps.IAP).
//
// When IAP sits in front of the dashboard and the admin API, it signs every request it lets
// through with a JWT in x-goog-iap-jwt-assertion. The server verifies that token itself on every
// request (internal/iap), never trusting the header's presence, then maps its email to an active
// operator, who is signed in for that request only: there's no session to steal or expire, and
// removing someone from IAP (or disabling the operator) takes effect on their next request.
//
// Rules:
//   - It's an additional way in, not a replacement: session cookies and personal access tokens work
//     as before, and come first. A missing, invalid or unknown assertion is simply no IAP identity,
//     so a misconfigured audience or IAP being off can't lock the owner out of password sign-in or
//     `openpurr admin login-link`.
//   - It covers the dashboard's API only (/admin/v1, including /admin/v1/auth/me). The SDK API,
//     store notifications, /mcp, /oauth and /.well-known never look at the header.
//   - Writes still need the dashboard's Origin (IAP's own cookie is sent cross-site like any
//     cookie, so the CSRF check matters as much as for sessions).
//   - Two-step sign-in: the operator signed in with their Google account, so IAP (and the Google
//     account's own 2-Step Verification, which a Workspace or Cloud Identity admin can enforce) is
//     the second factor; openpurr's authenticator codes belong to password sign-in. "Require
//     two-step sign-in for everyone" therefore doesn't block IAP sign-ins. Enforce 2-Step
//     Verification for the Google accounts IAP admits.
//   - Audited like other sign-ins: auth.login with {"via": "iap"} when an operator's IAP sign-in
//     is first seen, then at most once an hour (it's stamped in last_login_at, so every replica
//     agrees); an assertion for an email with no active operator is audited as auth.login_failed
//     ({"reason": "unknown", "via": "iap"}) at most once an hour per email and replica. Invalid
//     assertions are logged, not audited: they carry no identity worth recording.

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/openpurr/openpurr/standard/internal/iap"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// How often an IAP operator's sign-in is audited again.
const iapAuditEveryMs = 3600_000

// iapAssertion is the request's IAP assertion, or "".
func iapAssertion(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get(iap.Header))
}

// iapOperator is the operator IAP signed in for this request, or nil (IAP off, no assertion, an
// invalid one, or no active operator with its email). Only database failures are errors.
func (s *server) iapOperator(ctx context.Context, r *http.Request, now int64) (*operator, error) {
	if s.IAP == nil {
		return nil, nil
	}
	token := iapAssertion(r)
	if token == "" {
		return nil, nil
	}
	id, err := s.IAP.Verify(ctx, token)
	if err != nil {
		if iap.IsInvalid(err) {
			s.Log.Warn("ignoring an invalid IAP assertion", "reason", err.Error(), "path", r.URL.EscapedPath())
		} else {
			s.Log.Error("couldn't check an IAP assertion", "error", err.Error())
		}
		return nil, nil
	}
	o, err := findOperator(ctx, s.Pool, "SELECT "+operatorColumns+" FROM operator o WHERE lower(o.email) = lower($1) AND o.disabled_at IS NULL", []any{id.Email})
	if err != nil {
		return nil, err
	}
	var ip *string
	if v := s.clientIP(r); v != "" {
		ip = &v
	}
	if o == nil {
		if s.iapFailureDue(id.Email, now) {
			email := id.Email
			if err := writeAudit(ctx, s.Pool, now, auditEntry{actor: &email, action: "auth.login_failed",
				details: jsobj.New("reason", "unknown", "via", "iap"), ip: ip}); err != nil {
				return nil, err
			}
		}
		return nil, nil
	}
	if o.LastLoginAt == nil || now-*o.LastLoginAt >= iapAuditEveryMs {
		err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
			// Claimed atomically, so replicas seeing the same operator at once audit it once.
			tag, err := tx.Exec(ctx, "UPDATE operator SET last_login_at = $1 WHERE id = $2 AND (last_login_at IS NULL OR last_login_at <= $3)",
				now, o.ID, now-iapAuditEveryMs)
			if err != nil || tag.RowsAffected() == 0 {
				return err
			}
			e := operatorAudit(o, "auth.login", ip)
			e.details = jsobj.New("via", "iap")
			return writeAudit(ctx, tx, now, e)
		})
		if err != nil {
			return nil, err
		}
	}
	return o, nil
}

// iapFailureDue reports whether an unknown email's IAP sign-in should be audited now (at most once
// an hour per email on this replica).
func (s *server) iapFailureDue(email string, now int64) bool {
	s.iapMu.Lock()
	defer s.iapMu.Unlock()
	if s.iapFailures == nil {
		s.iapFailures = map[string]int64{}
	}
	if last, ok := s.iapFailures[email]; ok && now-last < iapAuditEveryMs {
		return false
	}
	if len(s.iapFailures) > 10_000 { // bounded: forget everything rather than grow
		s.iapFailures = map[string]int64{}
	}
	s.iapFailures[email] = now
	return true
}
