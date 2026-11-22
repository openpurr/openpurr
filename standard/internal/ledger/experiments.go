package ledger

// Price experiments, the part the SDK API needs: which variant's offering a customer sees as the
// current one. A port of lite/src/experiments.ts (results and the admin API come later).
//
// Who is in it: anyone who fetches offerings while the experiment runs and wasn't a customer
// before it started (an app user ID never seen, or a customer first seen since). Existing
// customers keep seeing the current offering. Each person gets one variant, at random by the
// weights, and keeps it: by app user ID, and after logIn by any of the customer's IDs (the
// earliest enrollment wins). One experiment runs per project at a time.

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/jackc/pgx/v5"
)

type Variant struct {
	// "a" (the control), "b", "c", "d".
	ID         string  `json:"id"`
	OfferingID string  `json:"offering_id"`
	Weight     float64 `json:"weight"`
}

type Experiment struct {
	ID        string
	ProjectID string
	Variants  []Variant
	StartedAt *int64
}

// The running experiment is looked up on every getOfferings, so it's kept in memory briefly: a
// start or stop reaches the SDK within runningCacheMs.
const runningCacheMs = 30_000

// Experiments caches the running experiment per project.
type Experiments struct {
	mu      sync.Mutex
	running map[string]runningEntry
}

type runningEntry struct {
	at  int64
	exp *Experiment
}

func NewExperiments() *Experiments { return &Experiments{running: map[string]runningEntry{}} }

// Forget clears the cache (after a change made in this process, conformance resets and tests).
func (e *Experiments) Forget() {
	e.mu.Lock()
	e.running = map[string]runningEntry{}
	e.mu.Unlock()
}

// Running returns the project's running experiment, or nil.
func (e *Experiments) Running(ctx context.Context, db DB, projectID string, now int64) (*Experiment, error) {
	e.mu.Lock()
	hit, ok := e.running[projectID]
	e.mu.Unlock()
	if ok && now-hit.at < runningCacheMs {
		return hit.exp, nil
	}
	var exp Experiment
	var variants string
	err := db.QueryRow(ctx, "SELECT id, project_id, variants, started_at FROM experiment WHERE project_id = $1 AND status = 'running'", projectID).
		Scan(&exp.ID, &exp.ProjectID, &variants, &exp.StartedAt)
	var found *Experiment
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal([]byte(variants), &exp.Variants); err != nil {
			return nil, err
		}
		found = &exp
	}
	e.mu.Lock()
	e.running[projectID] = runningEntry{at: now, exp: found}
	e.mu.Unlock()
	return found, nil
}

// PickVariant puts the same person in the same variant: a hash of the experiment and the person,
// split by weight.
func PickVariant(experimentID, who string, variants []Variant) Variant {
	h := uint32(0x811c9dc5)
	for _, r := range experimentID + ":" + who {
		h ^= uint32(r)
		h *= 0x01000193
	}
	// Mix the low bits (FNV's are weak) before taking a bucket out of 10,000.
	h ^= h >> 16
	h *= 0x85ebca6b
	h ^= h >> 13
	bucket := float64(h%10_000) / 100
	edge := 0.0
	for _, v := range variants {
		edge += v.Weight
		if bucket < edge {
			return v
		}
	}
	return variants[len(variants)-1]
}

// Assignment is a customer's variant in the running experiment.
type Assignment struct {
	ExperimentID string
	Variant      Variant
	// The enrollment to record when it's new (after responding); nil if already enrolled.
	Write func(ctx context.Context, db DB) error
}

// AssignVariant returns the running experiment's variant for an app user, enrolling them if they
// qualify; nil when no experiment is running or they don't qualify (an existing customer).
func (e *Experiments) AssignVariant(ctx context.Context, db DB, projectID, appUserID string, now int64) (*Assignment, error) {
	exp, err := e.Running(ctx, db, projectID, now)
	if err != nil || exp == nil || len(exp.Variants) == 0 {
		return nil, err
	}
	var customerID, variant *string
	var firstSeen *int64
	err = db.QueryRow(ctx,
		`WITH me AS (SELECT c.id, c.first_seen FROM customer_alias a JOIN customer c ON c.id = a.customer_id WHERE a.project_id = $1 AND a.app_user_id = $2),
		      ids AS (SELECT $2::text AS app_user_id UNION SELECT a.app_user_id FROM customer_alias a WHERE a.customer_id = (SELECT id FROM me))
		 SELECT (SELECT id FROM me), (SELECT first_seen FROM me),
		        (SELECT e.variant FROM experiment_enrollment e WHERE e.experiment_id = $3 AND e.app_user_id IN (SELECT app_user_id FROM ids)
		         ORDER BY e.enrolled_at LIMIT 1)`,
		projectID, appUserID, exp.ID).Scan(&customerID, &firstSeen, &variant)
	if err != nil {
		return nil, err
	}
	if variant != nil && *variant != "" {
		for _, v := range exp.Variants {
			if v.ID == *variant {
				return &Assignment{ExperimentID: exp.ID, Variant: v}, nil
			}
		}
	}
	if customerID != nil && firstSeen != nil && exp.StartedAt != nil && *firstSeen < *exp.StartedAt {
		return nil, nil
	}
	who := appUserID
	if customerID != nil {
		who = *customerID
	}
	v := PickVariant(exp.ID, who, exp.Variants)
	expID := exp.ID
	write := func(ctx context.Context, db DB) error {
		_, err := db.Exec(ctx,
			"INSERT INTO experiment_enrollment (experiment_id, app_user_id, variant, enrolled_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
			expID, appUserID, v.ID, now)
		return err
	}
	return &Assignment{ExperimentID: exp.ID, Variant: v, Write: write}, nil
}
