// Package jobs runs background work: periodic jobs (Lite's Cron Trigger, lite/src/scheduled.ts)
// and deferred work started by a request but finished after the response (Lite's waitUntil).
//
// Periodic jobs register here with how often they run. Time is cut into slots of that length
// (every 5 minutes, every hour, on the clock as Lite's cron runs them), and a job runs once per
// slot across all replicas: each run holds a Postgres advisory lock for the job, and the slot it
// last ran in is kept in job_state, so a replica that gets the lock after another has run the
// job in this slot skips it. A failing job is logged and tried again in the next slot; it never
// stops the others.
//
// Conformance mode doesn't start the loop; POST /__conformance/jobs runs every job at once with
// RunAll.
package jobs

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
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
	// Skipped is set when the job didn't run: another replica held it, or (in the loop) it has
	// already run in this slot.
	Skipped bool `json:"skipped,omitempty"`
}

// Registry holds the periodic jobs and runs the loop.
type Registry struct {
	mu    sync.Mutex
	jobs  []Job
	pool  *pgxpool.Pool
	clock clock.Clock
	log   *slog.Logger

	// The loop: stop asks it to end, cancel ends the run in progress, done closes when it has.
	stop   chan struct{}
	cancel context.CancelFunc
	done   chan struct{}
}

func NewRegistry(pool *pgxpool.Pool, clk clock.Clock, log *slog.Logger) *Registry {
	return &Registry{pool: pool, clock: clk, log: log}
}

// Register adds a job. Jobs run in registration order.
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

// RunAll runs every job once, in registration order, whether due or not (Lite's
// runScheduled with all: true).
func (r *Registry) RunAll(ctx context.Context) []Result {
	results := []Result{}
	for _, j := range r.Jobs() {
		results = append(results, r.run(ctx, j, false))
	}
	return results
}

// RunDue runs, in registration order, the jobs that haven't run in their current slot.
func (r *Registry) RunDue(ctx context.Context) []Result {
	results := []Result{}
	for _, j := range r.Jobs() {
		if ctx.Err() != nil {
			break
		}
		res := r.run(ctx, j, true)
		if res.Error != "" && ctx.Err() == nil {
			r.log.Error("job failed", "job", res.Job, "error", res.Error)
		}
		results = append(results, res)
	}
	return results
}

func stateKey(name string) string { return "job_slot:" + name }

// slot is the slot of time `now` falls in, for a job run every `every`.
func slot(now int64, every time.Duration) int64 {
	ms := every.Milliseconds()
	if ms <= 0 {
		return now
	}
	s := now / ms
	if now < 0 && now%ms != 0 {
		s--
	}
	return s
}

// run runs a job while holding its advisory lock; if another replica holds it, it skips. With
// onlyDue it also skips a job that has run in the current slot, and records the slot it ran in.
func (r *Registry) run(ctx context.Context, j Job, onlyDue bool) (res Result) {
	res.Job = j.Name
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer conn.Release()
	// Advisory locks are per database; the key includes the schema, so deployments (or tests)
	// sharing a database in different schemas don't hold each other's jobs.
	key := lockName(j.Name)
	var got bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1 || current_schema(), 0))", key).Scan(&got); err != nil {
		res.Error = err.Error()
		return res
	}
	if !got {
		res.Skipped = true
		return res
	}
	defer func() {
		// Unlocked even when ctx has ended; if that fails, closing the connection releases it.
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(unlockCtx, "SELECT pg_advisory_unlock(hashtextextended($1 || current_schema(), 0))", key); err != nil {
			_ = conn.Hijack().Close(unlockCtx)
		}
	}()

	now := r.clock.Now()
	current := slot(now, j.Every)
	if onlyDue {
		var last string
		err := conn.QueryRow(ctx, "SELECT value FROM job_state WHERE key = $1", stateKey(j.Name)).Scan(&last)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			res.Error = err.Error()
			return res
		}
		if err == nil && last == strconv.FormatInt(current, 10) {
			res.Skipped = true
			return res
		}
	}
	if err := j.Run(ctx, now); err != nil {
		res.Error = err.Error()
	}
	if onlyDue {
		// Recorded whether or not the run failed: a failure is retried in the next slot, as Lite's
		// next cron run would.
		if _, err := conn.Exec(context.WithoutCancel(ctx),
			`INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, $3)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			stateKey(j.Name), strconv.FormatInt(current, 10), now); err != nil && res.Error == "" {
			res.Error = err.Error()
		}
	}
	return res
}

func lockName(name string) string { return "openpurr job " + name + " in " }

// Start runs due jobs every `tick` until Stop.
func (r *Registry) Start(tick time.Duration) {
	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	r.stop = make(chan struct{})
	r.done = make(chan struct{})
	r.cancel = cancel
	stop, done := r.stop, r.done
	r.mu.Unlock()
	go func() {
		defer close(done)
		defer cancel()
		t := time.NewTicker(tick)
		defer t.Stop()
		for {
			r.RunDue(ctx)
			select {
			case <-stop:
				return
			case <-t.C:
			}
		}
	}()
}

// Stop ends the loop: no job starts after it's called, and it waits for the run in progress to
// finish until ctx ends, then cancels it and waits for it to return.
func (r *Registry) Stop(ctx context.Context) {
	r.mu.Lock()
	stop, done, cancel := r.stop, r.done, r.cancel
	r.stop = nil
	r.mu.Unlock()
	if stop == nil {
		return
	}
	close(stop)
	select {
	case <-done:
	case <-ctx.Done():
		r.log.Warn("cancelling the job in progress to shut down")
		cancel()
		<-done
	}
}

// Deferred runs work after a response has been sent, and lets shutdown and conformance wait for it.
type Deferred struct {
	wg  sync.WaitGroup
	log *slog.Logger
}

func NewDeferred(log *slog.Logger) *Deferred { return &Deferred{log: log} }

// DeferredTimeout bounds one piece of deferred work.
const DeferredTimeout = 30 * time.Second

// Go runs fn in the background with its own context (the request's ends with the response),
// which ends after DeferredTimeout.
func (d *Deferred) Go(name string, fn func(ctx context.Context) error) {
	d.GoFor(name, DeferredTimeout, fn)
}

// GoFor is Go with another time limit.
func (d *Deferred) GoFor(name string, timeout time.Duration, fn func(ctx context.Context) error) {
	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		if err := fn(ctx); err != nil {
			d.log.Error("deferred work failed", "task", name, "error", err.Error())
		}
	}()
}

// Wait blocks until all deferred work has finished.
func (d *Deferred) Wait() { d.wg.Wait() }

// WaitContext waits for deferred work until ctx ends, and says whether it all finished.
func (d *Deferred) WaitContext(ctx context.Context) bool {
	done := make(chan struct{})
	go func() {
		d.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return true
	case <-ctx.Done():
		return false
	}
}
