package jobs_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/jobs"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

const hour = int64(3600_000)

// 10:00 UTC on some day.
const t0 = int64(1_800_000_000_000) / hour * hour

func TestRunDue(t *testing.T) {
	pool := tu.Pool(t)
	ctx := context.Background()
	clk := clock.NewFixed(t0 + 10*60_000)

	t.Run("runs each job once per slot, on every replica together", func(t *testing.T) {
		var hourly, fiveMin, failing atomic.Int32
		replica := func() *jobs.Registry {
			r := jobs.NewRegistry(pool, clk, tu.Quiet)
			r.Register(jobs.Job{Name: "failing", Every: time.Hour, Run: func(context.Context, int64) error { failing.Add(1); return errors.New("boom") }})
			r.Register(jobs.Job{Name: "hourly", Every: time.Hour, Run: func(context.Context, int64) error { hourly.Add(1); return nil }})
			r.Register(jobs.Job{Name: "five", Every: 5 * time.Minute, Run: func(context.Context, int64) error { fiveMin.Add(1); return nil }})
			return r
		}
		a, b := replica(), replica()
		res := a.RunDue(ctx)
		if res[0].Error != "boom" || hourly.Load() != 1 || fiveMin.Load() != 1 {
			t.Fatalf("%+v", res)
		}
		// The other replica, and the same one again, in the same slots: nothing runs.
		b.RunDue(ctx)
		a.RunDue(ctx)
		if failing.Load() != 1 || hourly.Load() != 1 || fiveMin.Load() != 1 {
			t.Errorf("%d %d %d", failing.Load(), hourly.Load(), fiveMin.Load())
		}
		// Five minutes on: a new 5-minute slot, the same hour.
		clk.Add(5 * 60_000)
		b.RunDue(ctx)
		a.RunDue(ctx)
		if failing.Load() != 1 || hourly.Load() != 1 || fiveMin.Load() != 2 {
			t.Errorf("%d %d %d", failing.Load(), hourly.Load(), fiveMin.Load())
		}
		// The next hour: the failed job is tried again with the others.
		clk.Store(t0 + hour)
		b.RunDue(ctx)
		if failing.Load() != 2 || hourly.Load() != 2 || fiveMin.Load() != 3 {
			t.Errorf("%d %d %d", failing.Load(), hourly.Load(), fiveMin.Load())
		}
	})

	t.Run("skips a job another replica is running", func(t *testing.T) {
		release := make(chan struct{})
		started := make(chan struct{})
		var runs atomic.Int32
		job := jobs.Job{Name: "slow", Every: time.Hour, Run: func(context.Context, int64) error {
			if runs.Add(1) == 1 {
				close(started)
				<-release
			}
			return nil
		}}
		a := jobs.NewRegistry(pool, clk, tu.Quiet)
		a.Register(job)
		b := jobs.NewRegistry(pool, clk, tu.Quiet)
		b.Register(job)
		done := make(chan []jobs.Result)
		go func() { done <- a.RunAll(ctx) }()
		<-started
		if res := b.RunAll(ctx); !res[0].Skipped || runs.Load() != 1 {
			t.Errorf("%+v", res)
		}
		close(release)
		if res := <-done; res[0].Skipped || res[0].Error != "" {
			t.Errorf("%+v", res)
		}
		// RunAll ignores slots: it runs again at once.
		b.RunAll(ctx)
		if runs.Load() != 2 {
			t.Errorf("%d runs", runs.Load())
		}
	})
}

func TestStartStop(t *testing.T) {
	pool := tu.Pool(t)

	t.Run("stop waits for the job in progress", func(t *testing.T) {
		r := jobs.NewRegistry(pool, clock.NewFixed(t0), tu.Quiet)
		started := make(chan struct{})
		var finished atomic.Bool
		r.Register(jobs.Job{Name: "wait", Every: time.Hour, Run: func(ctx context.Context, _ int64) error {
			close(started)
			time.Sleep(100 * time.Millisecond)
			finished.Store(ctx.Err() == nil)
			return nil
		}})
		r.Start(time.Hour)
		<-started
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		r.Stop(ctx)
		if !finished.Load() {
			t.Error("stopped before the job finished")
		}
	})

	t.Run("stop cancels a job that outlasts the deadline", func(t *testing.T) {
		r := jobs.NewRegistry(pool, clock.NewFixed(t0), tu.Quiet)
		started := make(chan struct{})
		var cancelled atomic.Bool
		r.Register(jobs.Job{Name: "stuck", Every: time.Hour, Run: func(ctx context.Context, _ int64) error {
			close(started)
			<-ctx.Done()
			cancelled.Store(true)
			return ctx.Err()
		}})
		r.Start(time.Hour)
		<-started
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		r.Stop(ctx)
		if !cancelled.Load() {
			t.Error("the job wasn't cancelled")
		}
		r.Stop(ctx) // a second stop is harmless
	})
}

func TestDeferredWaitContext(t *testing.T) {
	d := jobs.NewDeferred(tu.Quiet)
	release := make(chan struct{})
	d.Go("slow", func(context.Context) error { <-release; return nil })
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if d.WaitContext(ctx) {
		t.Error("reported finished early")
	}
	close(release)
	if !d.WaitContext(context.Background()) {
		t.Error("not finished")
	}
}
