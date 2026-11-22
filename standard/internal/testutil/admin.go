package testutil

// Back-office helpers: admin API requests as an operator (session cookie or access token), and
// operators made the way a real owner makes them (lite/test/admin-api.test.ts's helpers).

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

// SessionCookie is the dashboard's session cookie.
const SessionCookie = "__Host-openpurr_session"

// Password is the test operators' password.
const Password = "a long test passphrase"

// Auth is who makes an admin request: a session, a token, or (both empty) nobody.
type Auth struct {
	Session string
	Token   string
	// Origin overrides the Origin header ("-" for none); the server's own by default.
	Origin string
	IP     string
}

// Admin calls /admin/v1{path} (or path itself when it doesn't start with "/"... it always does).
func (e *Env) Admin(method, path string, auth Auth, body any) *Response {
	e.T.Helper()
	var r io.Reader
	if body != nil {
		if s, ok := body.(string); ok {
			r = strings.NewReader(s)
		} else {
			r = strings.NewReader(jsobj.Stringify(body))
		}
	}
	req, err := http.NewRequest(method, e.Server.URL+"/admin/v1"+path, r)
	if err != nil {
		e.T.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if auth.Session != "" {
		req.Header.Set("Cookie", SessionCookie+"="+auth.Session)
	}
	if auth.Token != "" {
		req.Header.Set("Authorization", "Bearer "+auth.Token)
	}
	switch auth.Origin {
	case "":
		req.Header.Set("Origin", e.Server.URL)
	case "-":
	default:
		req.Header.Set("Origin", auth.Origin)
	}
	if auth.IP != "" {
		req.Header.Set("CF-Connecting-IP", auth.IP)
	}
	return e.do(req)
}

var sessionRE = regexp.MustCompile(SessionCookie + `=([^;]*)`)

// SessionFrom is the session token a response set, or "".
func SessionFrom(r *Response) string {
	m := sessionRE.FindStringSubmatch(r.Header.Get("Set-Cookie"))
	if m == nil {
		return ""
	}
	return m[1]
}

// LinkToken is the token in a setup or recovery link (it rides in the #fragment).
func LinkToken(link string) string {
	if i := strings.Index(link, "#token="); i >= 0 {
		return link[i+7:]
	}
	return ""
}

// OwnerToken makes an owner operator directly in the database, with an access token that has every
// scope (like a conformance reset), and returns the token.
func (e *Env) OwnerToken() string {
	e.T.Helper()
	ctx := context.Background()
	id := ledger.NewUUID()
	token := "pat_" + authcrypto.RandomToken()
	e.Exec("INSERT INTO operator (id, email, name, role, created_at) VALUES ($1, $2, 'Owner', 'owner', $3)", id, id+"@owner.test", e.Clock.Now())
	if _, err := e.Pool.Exec(ctx,
		`INSERT INTO access_token (id, operator_id, token_hash, token_prefix, name, scopes, created_at)
		 VALUES ($1, $2, $3, $4, 'test', '["read","write:grants","write:webhooks","write:config","admin"]', $5)`,
		ledger.NewUUID(), id, authcrypto.SHA256Hex(token), token[:10], e.Clock.Now()); err != nil {
		e.T.Fatal(err)
	}
	return token
}

// Operator is a signed-in test operator.
type Operator struct {
	ID, Email, Session string
}

var operatorN atomic.Int64

// CreateOperator invites an operator as the owner token, redeems the setup link and sets the
// password: a signed-in operator with a full session.
func (e *Env) CreateOperator(owner, role string, apps []string) Operator {
	e.T.Helper()
	email := role + "-" + jsobj.FormatNumber(float64(operatorN.Add(1))) + "@example.com"
	var appIDs any
	if apps != nil {
		list := make([]any, len(apps))
		for i, a := range apps {
			list[i] = a
		}
		appIDs = list
	}
	invited := e.Admin("POST", "/operators", Auth{Token: owner}, jsobj.New("email", email, "name", role, "role", role, "app_ids", appIDs))
	if invited.Status != 201 {
		e.T.Fatalf("invite: %d %s", invited.Status, invited.Body)
	}
	link := e.Admin("POST", "/auth/link", Auth{}, jsobj.New("token", LinkToken(invited.Get(e.T, "setup_link").(string))))
	session := SessionFrom(link)
	if session == "" {
		e.T.Fatalf("setup link: %d %s", link.Status, link.Body)
	}
	if pw := e.Admin("POST", "/auth/password", Auth{Session: session}, jsobj.New("new_password", Password)); pw.Status != 200 {
		e.T.Fatalf("password: %d %s", pw.Status, pw.Body)
	}
	return Operator{ID: invited.Get(e.T, "id").(string), Email: email, Session: session}
}

// CreateToken makes an access token for a signed-in operator.
func (e *Env) CreateToken(t testing.TB, session string, scopes ...string) string {
	t.Helper()
	list := make([]any, len(scopes))
	for i, s := range scopes {
		list[i] = s
	}
	res := e.Admin("POST", "/tokens", Auth{Session: session}, jsobj.New("name", "test", "scopes", list))
	if res.Status != 201 {
		t.Fatalf("token: %d %s", res.Status, res.Body)
	}
	return res.Get(t, "token").(string)
}

// Login signs in; it returns the response and its session.
func (e *Env) Login(email, password string, extra ...any) (*Response, string) {
	e.T.Helper()
	body := jsobj.New("email", email, "password", password)
	for i := 0; i+1 < len(extra); i += 2 {
		body.Set(extra[i].(string), extra[i+1])
	}
	res := e.Admin("POST", "/auth/login", Auth{}, body)
	return res, SessionFrom(res)
}

// QueryRow reads one row into dest.
func (e *Env) QueryRow(sql string, args []any, dest ...any) {
	e.T.Helper()
	if err := e.Pool.QueryRow(context.Background(), sql, args...).Scan(dest...); err != nil {
		e.T.Fatal(err)
	}
}
