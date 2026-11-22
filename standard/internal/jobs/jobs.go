// Package jobs runs background work: periodic jobs (Lite's Cron Trigger, lite/src/scheduled.ts)
// and deferred work started by a request but finished after the response (Lite's waitUntil).
//
// Periodic jobs register here with how often they run. The loop takes a Postgres advisory lock
// per job run, so with several replicas each job runs on one at a time. Conformance mode doesn't
// start the loop; POST /__conformance/jobs runs every job at once with RunAll.
//
// No jobs are registered yet: webhook retries, Google acknowledgements, FX rates, rollups and
// cleanup come in later milestones.
package jobs

import (
	"context"
	"hash/fnv"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openpurr/openpurr/standard/internal/clock"
)

// Job is one periodic task.
type Job struct {
	Name string
	// How often it runs.
	Every time.Duration
	// Run does one round of work. now is the server clock's time in epoch ms.
	Run func(ctx context.Context, now int64) error
}

// Result is the outcome of one job run.
type Result struct {
	Job   string `json:"job"`
	Error string `json:"error,omitempty"`
}

// Registry holds the periodic jobs.
type Registry struct {
	mu    sync.Mutex
	jobs  []Job
	last  map[string]int64
	pool  *pgxpool.Pool
	clock clock.Clock
	log   *slog.Logger
}

func NewRegistry(pool *pgxpool.Pool, clk clock.Clock, log *slog.Logger) *Registry {
	return &Registry{pool: pool, clock: clk, log: log, last: map[string]int64{}}
}

// Register adds a job.
func (r *Registry) Register(j Job) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.jobs = append(r.jobs, j)
}

// Jobs lists the registered jobs.
func (r *Registry) Jobs() []Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Job(nil), r.jobs...)
}

// RunAll runs every job once, in registration order, whether due or not.
func (r *Registry) RunAll(ctx context.Context) []Result {
	results := []Result{}
	for _, j := range r.Jobs() {
		res := Result{Job: j.Name}
		if err := r.runLocked(ctx, j); err != nil {
			res.Error = err.Error()
		}
		results = append(results, res)
	}
	return results
}

// runLocked runs a job while holding its advisory lock; if another replica holds it, it skips.
func (r *Registry) runLocked(ctx context.Context, j Job) error {
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	key := lockKey(j.Name)
	var got bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&got); err != nil {
		return err
	}
	if !got {
		return nil
	}
	defer func() { _, _ = conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", key) }()
	now := r.clock.Now()
	err = j.Run(ctx, now)
	r.mu.Lock()
	r.last[j.Name] = now
	r.mu.Unlock()
	return err
}

func lockKey(name string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("openpurr job " + name))
	return int64(h.Sum64())
}

// Start runs due jobs every `tick` until ctx ends.
func (r *Registry) Start(ctx context.Context, tick time.Duration) {
	t := time.NewTicker(tick)
	go func() {
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				r.runDue(ctx)
			}
		}
	}()
}

func (r *Registry) runDue(ctx context.Context) {
	now := r.clock.Now()
	for _, j := range r.Jobs() {
		r.mu.Lock()
		last, ran := r.last[j.Name]
		r.mu.Unlock()
		if ran && now-last < j.Every.Milliseconds() {
			continue
		}
		if err := r.runLocked(ctx, j); err != nil && ctx.Err() == nil {
			r.log.Error("job failed", "job", j.Name, "error", err.Error())
		}
	}
}

// Deferred runs work after a response has been sent, and lets shutdown and conformance wait for it.
type Deferred struct {
	wg  sync.WaitGroup
	log *slog.Logger
}

func NewDeferred(log *slog.Logger) *Deferred { return &Deferred{log: log} }

// Go runs fn in the background with its own context (the request's ends with the response).
func (d *Deferred) Go(name string, fn func(ctx context.Context) error) {
	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := fn(ctx); err != nil {
			d.log.Error("deferred work failed", "task", name, "error", err.Error())
		}
	}()
}

// Wait blocks until all deferred work has finished.
func (d *Deferred) Wait() { d.wg.Wait() }
