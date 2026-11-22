package config

// The config in the database (config_version): loading it with a cache, saving new versions, and
// the history. A port of lite/src/config-store.ts.
//
// Loading: the server keeps the config it last loaded and checks for a newer version at most every
// MaxAge, so the SDK hot path doesn't pay a query per request and a config change reaches it
// within MaxAge. The check reads only the newest version's id, and the document only when the id
// changed. A save made through this process (Save) is seen at once.
//
// First load: when config_version is empty and a seed file was given (OPENPURR_CONFIG), the file
// is imported once as the first version. After that, the database is the source of truth and the
// file is ignored.

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

// StoredVersion is one row of config_version.
type StoredVersion struct {
	ID        int64
	Document  *jsobj.Object
	CreatedAt int64
	CreatedBy *string
	Note      *string
}

var emptyConfig = mustParse(EmptyDocument())

func mustParse(raw any) *Config {
	c, err := Parse(raw)
	if err != nil {
		panic(err)
	}
	return c
}

// Empty is the config of a deployment with no projects yet.
func Empty() *Config { return emptyConfig }

// Loader loads the current config with a cache. One per process.
type Loader struct {
	pool   *pgxpool.Pool
	clock  clock.Clock
	maxAge int64
	seed   any
	log    *slog.Logger

	mu     sync.Mutex
	cached *cachedConfig
}

type cachedConfig struct {
	config    *Config
	id        int64
	checkedAt int64
}

// NewLoader makes a loader. seed (may be nil) is imported as the first version when there's none.
func NewLoader(pool *pgxpool.Pool, clk clock.Clock, maxAgeMs int64, seed any, log *slog.Logger) *Loader {
	if log == nil {
		log = slog.Default()
	}
	return &Loader{pool: pool, clock: clk, maxAge: maxAgeMs, seed: seed, log: log}
}

// Seed is the config imported on first start (nil without a seed file).
func (l *Loader) Seed() any { return l.seed }

// Get returns the current config.
func (l *Loader) Get(ctx context.Context) (*Config, error) {
	now := l.clock.Now()
	l.mu.Lock()
	c := l.cached
	l.mu.Unlock()
	if c != nil && now-c.checkedAt < l.maxAge {
		return c.config, nil
	}
	cfg, id, err := l.load(ctx, c, true)
	if err != nil {
		return nil, err
	}
	l.mu.Lock()
	l.cached = &cachedConfig{config: cfg, id: id, checkedAt: now}
	l.mu.Unlock()
	return cfg, nil
}

// Invalidate makes the next Get read the database (after a save or a conformance reset).
func (l *Loader) Invalidate() {
	l.mu.Lock()
	l.cached = nil
	l.mu.Unlock()
}

func (l *Loader) load(ctx context.Context, cached *cachedConfig, importSeed bool) (*Config, int64, error) {
	cachedID := int64(-1)
	if cached != nil {
		cachedID = cached.id
	}
	var id int64
	var document *string
	err := l.pool.QueryRow(ctx,
		"SELECT id, CASE WHEN id = $1 THEN NULL ELSE document END FROM config_version ORDER BY id DESC LIMIT 1",
		cachedID).Scan(&id, &document)
	if errors.Is(err, pgx.ErrNoRows) {
		if importSeed && l.seed != nil {
			imported, err := ImportConfig(ctx, l.pool, l.seed, l.clock.Now(), l.log)
			if err != nil {
				return nil, 0, err
			}
			if imported {
				return l.load(ctx, nil, false)
			}
		}
		return emptyConfig, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	if document == nil && cached != nil {
		return cached.config, cached.id, nil
	}
	raw, err := jsobj.Parse([]byte(*document))
	if err != nil {
		return nil, 0, err
	}
	cfg, err := Parse(raw)
	if err != nil {
		return nil, 0, err
	}
	return cfg, id, nil
}

// ImportConfig imports a config file as the first version, if there's no version yet. It returns
// whether it was imported. An invalid file is logged and skipped.
func ImportConfig(ctx context.Context, pool *pgxpool.Pool, raw any, now int64, log *slog.Logger) (bool, error) {
	cfg, err := Parse(raw)
	if err != nil {
		if log != nil {
			log.Error("The seed config isn't valid, so it wasn't imported", "error", err.Error())
		}
		return false, nil
	}
	tag, err := pool.Exec(ctx,
		`INSERT INTO config_version (document, created_at, created_by, note)
		 SELECT $1, $2, 'import', 'Imported from openpurr.config.yaml' WHERE NOT EXISTS (SELECT 1 FROM config_version)`,
		jsobj.Stringify(cfg.Document), now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ErrConflict means the config was saved by someone else since the change was made.
var ErrConflict = errors.New("The config was changed by someone else since you loaded it. Reload and make your change again.")

// configLockKey serializes saves, so two saves from the same base can't both succeed.
const configLockKey int64 = 0x6f70636f6e666967 // "opconfig"

// Save stores a new version. baseID is the version the change was made from (0 when there was
// none); if someone saved in between, nothing is written and ErrConflict is returned. It returns
// an *Error when the document isn't valid.
func Save(ctx context.Context, pool *pgxpool.Pool, raw any, baseID int64, by, note *string, now int64) (int64, *Config, error) {
	cfg, err := Parse(raw)
	if err != nil {
		return 0, nil, err
	}
	var id int64
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", configLockKey); err != nil {
			return err
		}
		err := tx.QueryRow(ctx,
			`INSERT INTO config_version (document, created_at, created_by, note)
			 SELECT $1, $2, $3, $4 WHERE (SELECT coalesce(max(id), 0) FROM config_version) = $5
			 RETURNING id`,
			jsobj.Stringify(cfg.Document), now, by, note, baseID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrConflict
		}
		return err
	})
	if err != nil {
		return 0, nil, err
	}
	return id, cfg, nil
}

func scanVersion(row pgx.Row) (*StoredVersion, error) {
	var v StoredVersion
	var doc string
	if err := row.Scan(&v.ID, &doc, &v.CreatedAt, &v.CreatedBy, &v.Note); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	parsed, err := jsobj.Parse([]byte(doc))
	if err != nil {
		return nil, err
	}
	v.Document, _ = parsed.(*jsobj.Object)
	return &v, nil
}

// CurrentVersion is the newest version, or nil before the first save or import.
func CurrentVersion(ctx context.Context, pool *pgxpool.Pool) (*StoredVersion, error) {
	return scanVersion(pool.QueryRow(ctx, "SELECT id, document, created_at, created_by, note FROM config_version ORDER BY id DESC LIMIT 1"))
}

// GetVersion is one version, or nil.
func GetVersion(ctx context.Context, pool *pgxpool.Pool, id int64) (*StoredVersion, error) {
	return scanVersion(pool.QueryRow(ctx, "SELECT id, document, created_at, created_by, note FROM config_version WHERE id = $1", id))
}

// ListVersions is the history, newest first, without the documents. before = 0 starts at the newest.
func ListVersions(ctx context.Context, pool *pgxpool.Pool, limit int, before int64) ([]StoredVersion, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if before > 0 {
		rows, err = pool.Query(ctx, "SELECT id, created_at, created_by, note FROM config_version WHERE id < $2 ORDER BY id DESC LIMIT $1", limit, before)
	} else {
		rows, err = pool.Query(ctx, "SELECT id, created_at, created_by, note FROM config_version ORDER BY id DESC LIMIT $1", limit)
	}
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (StoredVersion, error) {
		var v StoredVersion
		err := r.Scan(&v.ID, &v.CreatedAt, &v.CreatedBy, &v.Note)
		return v, err
	})
}

// ChangeProblems finds problems with replacing previous by next that validating next alone
// can't see:
//   - an app can't move to another project (its purchases belong to the old project's customers);
//   - a project that has customers can't be removed (they'd be orphaned).
func ChangeProblems(ctx context.Context, pool *pgxpool.Pool, previous, next *Config) ([]string, error) {
	var problems []string
	for _, projectID := range next.ProjectOrder {
		project := next.Projects[projectID]
		for _, appID := range project.AppOrder {
			app := project.Apps[appID]
			if next.Apps[appID] != app {
				continue // a duplicate the parser already refused
			}
			before := previous.Apps[appID]
			if before != nil && before.ProjectID != app.ProjectID {
				problems = append(problems, "apps."+appID+": an app can't move to another project (it's in "+before.ProjectID+"). Add a new app instead.")
			}
		}
	}
	var removed []string
	for _, id := range previous.ProjectOrder {
		if _, ok := next.Projects[id]; !ok {
			removed = append(removed, id)
		}
	}
	if len(removed) > 0 {
		rows, err := pool.Query(ctx,
			`SELECT r.id FROM unnest($1::text[]) WITH ORDINALITY AS r(id, n)
			 WHERE EXISTS (SELECT 1 FROM customer WHERE project_id = r.id) ORDER BY r.n`, removed)
		if err != nil {
			return nil, err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			problems = append(problems, "projects."+id+": this project has customers, so it can't be removed.")
		}
	}
	return problems, nil
}
