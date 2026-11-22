package applejws

// The Postgres ChainStore (apple_verified_chain), lite/src/lib/chain-store-d1.ts. Reads are one
// indexed lookup; a write happens only the first time a new Apple signing chain is seen.

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DB is what the store needs from a pool.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type pgStore struct {
	db  DB
	now func() int64
}

// PostgresStore returns a ChainStore on apple_verified_chain. now stamps verified_at.
func PostgresStore(db DB, now func() int64) ChainStore { return &pgStore{db: db, now: now} }

func (s *pgStore) Get(ctx context.Context, fingerprint string) (*VerifiedChain, error) {
	var c VerifiedChain
	err := s.db.QueryRow(ctx, "SELECT leaf_spki, not_before, not_after FROM apple_verified_chain WHERE fingerprint = $1", fingerprint).
		Scan(&c.LeafSPKI, &c.NotBefore, &c.NotAfter)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *pgStore) Put(ctx context.Context, fingerprint string, c VerifiedChain) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO apple_verified_chain (fingerprint, leaf_spki, not_before, not_after, verified_at)
		 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
		fingerprint, c.LeafSPKI, c.NotBefore, c.NotAfter, s.now())
	return err
}
