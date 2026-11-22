// Package db opens the Postgres pool and applies the schema migrations.
//
// Migrations are SQL files embedded in the binary (migrations/NNNN_name.sql), applied in order at
// startup. A Postgres advisory lock makes several replicas starting at once take turns: the first
// applies what's pending, the others then find nothing to do. Each migration runs in its own
// transaction together with its row in schema_migrations, so a failed one leaves no trace.
package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// MigrationsTable records the applied migrations. Conformance resets keep it.
const MigrationsTable = "schema_migrations"

// An arbitrary constant: the advisory lock key for migrations ("openpurr" in ASCII).
const migrationLockKey int64 = 0x6f70656e70757272

// Open connects to Postgres and checks the connection.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connecting to Postgres: %w", err)
	}
	return pool, nil
}

type migration struct {
	version string
	sql     string
}

func migrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		body, err := migrationFiles.ReadFile("migrations/" + name)
		if err != nil {
			return nil, err
		}
		out = append(out, migration{version: strings.TrimSuffix(name, ".sql"), sql: string(body)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

// Migrate applies every pending migration. Safe to run from several processes at once.
func Migrate(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) error {
	all, err := migrations()
	if err != nil {
		return err
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	// A session lock, held on this one connection until released.
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", migrationLockKey); err != nil {
		return fmt.Errorf("taking the migration lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", migrationLockKey)
	}()

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS `+MigrationsTable+` (
		version     text   PRIMARY KEY,
		applied_at  bigint NOT NULL
	)`); err != nil {
		return err
	}
	applied := map[string]bool{}
	rows, err := conn.Query(ctx, "SELECT version FROM "+MigrationsTable)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, m := range all {
		if applied[m.version] {
			continue
		}
		err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, m.sql); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "INSERT INTO "+MigrationsTable+" (version, applied_at) VALUES ($1, $2)", m.version, time.Now().UnixMilli())
			return err
		})
		if err != nil {
			return fmt.Errorf("migration %s: %w", m.version, err)
		}
		if log != nil {
			log.Info("applied migration", "version", m.version)
		}
	}
	return nil
}

// DataTables lists every table except the migrations table, for conformance resets and tests.
func DataTables(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> $1 ORDER BY tablename`, MigrationsTable)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Truncate empties every data table and restarts identity columns. The migrations table stays.
func Truncate(ctx context.Context, pool *pgxpool.Pool) error {
	tables, err := DataTables(ctx, pool)
	if err != nil {
		return err
	}
	if len(tables) == 0 {
		return nil
	}
	quoted := make([]string, len(tables))
	for i, t := range tables {
		quoted[i] = pgx.Identifier{t}.Sanitize()
	}
	_, err = pool.Exec(ctx, "TRUNCATE "+strings.Join(quoted, ", ")+" RESTART IDENTITY CASCADE")
	return err
}
