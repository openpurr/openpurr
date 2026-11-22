package main

// Operator management with the deployment's own credentials (DATABASE_URL), so whoever controls
// the infrastructure can always get in: Standard's lite/scripts/admin.mjs. The admin API takes
// over day to day.
//
//	openpurr admin create --email you@example.com [--name "You"] [--role owner] [--url https://purchases.example.com]
//	openpurr admin login-link --email you@example.com [--url ...]   recovery: signs in once, 15 minutes
//	openpurr admin list
//	openpurr admin require-totp on|off
//
// --url (or PUBLIC_URL) is the server's address, used to print the full link. Links carry their
// token in the #fragment, so it never reaches server logs or Referer headers. Only a SHA-256 of
// the token is stored, and each link works once.

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/authcrypto"
	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
)

const adminUsage = `Usage: openpurr admin create --email <email> [--name <name>] [--role owner|admin|developer|viewer]
       openpurr admin login-link --email <email>
       openpurr admin list
       openpurr admin require-totp on|off
Options: --url <server URL> (default $PUBLIC_URL), to print the full link. Needs DATABASE_URL.`

var adminRoles = []string{"owner", "admin", "developer", "viewer"}

// runAdmin runs `openpurr admin ...`; it returns the exit code.
func runAdmin(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, adminUsage)
		return 1
	}
	command := args[0]
	fs := flag.NewFlagSet("admin", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	email := fs.String("email", "", "")
	name := fs.String("name", "", "")
	role := fs.String("role", "", "")
	baseURL := fs.String("url", os.Getenv("PUBLIC_URL"), "")
	if err := fs.Parse(args[1:]); err != nil {
		fmt.Fprintln(stderr, err.Error()+"\n"+adminUsage)
		return 1
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fmt.Fprintln(stderr, "DATABASE_URL must be set.")
		return 1
	}
	ctx := context.Background()
	pool, err := db.Open(ctx, url)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool, nil); err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	a := &adminCLI{pool: pool, out: stdout, base: strings.TrimRight(*baseURL, "/"), now: time.Now().UnixMilli()}
	addr := strings.ToLower(jsobj.Trim(*email))
	switch command {
	case "create":
		err = a.create(ctx, addr, *name, *role)
	case "login-link":
		err = a.loginLink(ctx, addr)
	case "list":
		err = a.list(ctx)
	case "require-totp":
		err = a.requireTOTP(ctx, fs.Arg(0))
	default:
		err = errors.New(adminUsage)
	}
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	return 0
}

type adminCLI struct {
	pool *pgxpool.Pool
	out  io.Writer
	base string
	now  int64
}

func cliAudit(ctx context.Context, tx pgx.Tx, now int64, operatorID *string, action string, target, details *string) error {
	_, err := tx.Exec(ctx, "INSERT INTO audit_log (at, operator_id, actor, source, action, target, details) VALUES ($1, $2, 'cli', 'cli', $3, $4, $5)",
		now, operatorID, action, target, details)
	return err
}

// link stores a setup or recovery link and returns it.
func (a *adminCLI) link(ctx context.Context, tx pgx.Tx, operatorID, purpose string, ttlMs int64) (string, error) {
	token := authcrypto.RandomToken()
	if _, err := tx.Exec(ctx, "INSERT INTO login_link (token_hash, operator_id, purpose, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)",
		authcrypto.SHA256Hex(token), operatorID, purpose, a.now+ttlMs, a.now); err != nil {
		return "", err
	}
	if err := cliAudit(ctx, tx, a.now, &operatorID, "auth."+purpose+"_link_created", nil, nil); err != nil {
		return "", err
	}
	if a.base == "" {
		return "<server URL>/admin/link#token=" + token + "   (pass --url to print the full link)", nil
	}
	return a.base + "/admin/link#token=" + token, nil
}

var cliEmail = regexp.MustCompile(`^[^@\s]+@[^@\s]+$`)

func (a *adminCLI) create(ctx context.Context, email, name, role string) error {
	if !cliEmail.MatchString(email) {
		return errors.New("--email is required, e.g. --email you@example.com")
	}
	var link string
	err := pgx.BeginFunc(ctx, a.pool, func(tx pgx.Tx) error {
		var existing int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM operator").Scan(&existing); err != nil {
			return err
		}
		if role == "" && existing == 0 {
			role = "owner"
		}
		valid := false
		for _, r := range adminRoles {
			valid = valid || r == role
		}
		if !valid {
			return errors.New("--role must be one of: " + strings.Join(adminRoles, ", "))
		}
		if name == "" {
			name = email
		}
		id := ledger.NewUUID()
		if _, err := tx.Exec(ctx, "INSERT INTO operator (id, email, name, role, created_at) VALUES ($1, $2, $3, $4, $5)", id, email, name, role, a.now); err != nil {
			if strings.Contains(err.Error(), "SQLSTATE 23505") {
				return errors.New("That email already has an account.")
			}
			return err
		}
		if err := cliAudit(ctx, tx, a.now, &id, "operator.created", &email, nil); err != nil {
			return err
		}
		var err error
		link, err = a.link(ctx, tx, id, "setup", 24*3600_000)
		return err
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(a.out, "Created %s %s. Open this link within 24 hours to set a password:\n\n  %s\n\n", role, email, link)
	return nil
}

func (a *adminCLI) loginLink(ctx context.Context, email string) error {
	var link, role string
	err := pgx.BeginFunc(ctx, a.pool, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, "SELECT id, role FROM operator WHERE lower(email) = lower($1) AND disabled_at IS NULL", email).Scan(&id, &role)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("No active operator with email " + email + ".")
		}
		if err != nil {
			return err
		}
		link, err = a.link(ctx, tx, id, "recovery", 15*60_000)
		return err
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(a.out, "One-time sign-in link for %s (%s), valid for 15 minutes. Use it to reset a password or authenticator:\n\n  %s\n\n", email, role, link)
	return nil
}

func (a *adminCLI) list(ctx context.Context) error {
	rows, err := a.pool.Query(ctx, `SELECT email, role, app_ids, totp_enabled, password_hash IS NOT NULL, disabled_at, last_login_at
		FROM operator ORDER BY created_at, id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var email, role string
		var appIDs *string
		var totp int
		var hasPassword bool
		var disabled, lastLogin *int64
		if err := rows.Scan(&email, &role, &appIDs, &totp, &hasPassword, &disabled, &lastLogin); err != nil {
			return err
		}
		n++
		line := email + "  " + role
		if appIDs != nil {
			if v, err := jsobj.Parse([]byte(*appIDs)); err == nil {
				line += " (apps " + jsobj.String(v, true) + ")"
			}
		}
		line += map[bool]string{true: "  password set", false: "  setup pending"}[hasPassword]
		line += map[bool]string{true: "  2-step on", false: "  2-step off"}[totp != 0]
		at := "never"
		if lastLogin != nil {
			at = time.UnixMilli(*lastLogin).UTC().Format("2006-01-02 15:04")
		}
		line += "  last sign-in " + at
		if disabled != nil {
			line += "  DISABLED"
		}
		fmt.Fprintln(a.out, line)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if n == 0 {
		fmt.Fprintln(a.out, "No operators yet. Create the owner with: openpurr admin create --email <email>")
	}
	return nil
}

func (a *adminCLI) requireTOTP(ctx context.Context, arg string) error {
	if arg != "on" && arg != "off" {
		return errors.New("Usage: openpurr admin require-totp on|off")
	}
	value := "false"
	if arg == "on" {
		value = "true"
	}
	err := pgx.BeginFunc(ctx, a.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO setting (key, value, updated_at) VALUES ('require_totp', $1, $2)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, value, a.now); err != nil {
			return err
		}
		details := `{"value":` + value + `}`
		return cliAudit(ctx, tx, a.now, nil, "setting.require_totp", nil, &details)
	})
	if err != nil {
		return err
	}
	if arg == "on" {
		fmt.Fprintln(a.out, "Two-step sign-in is now required for everyone.")
	} else {
		fmt.Fprintln(a.out, "Two-step sign-in is now optional.")
	}
	return nil
}
