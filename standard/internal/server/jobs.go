package server

// The periodic jobs, in the order lite/src/scheduled.ts runs them: every 5 minutes, webhook
// retries and the snapshot backfill; every hour, storage cleanup, exchange rates, Google Play's
// acknowledgement retries and voided-purchases polling, and last the chart rollup (after the
// exchange rates it converts with). Lite's free-plan usage check (Cloudflare analytics) has no
// Standard counterpart.

import (
	"context"
	"time"

	"github.com/openpurr/openpurr/standard/internal/fx"
	"github.com/openpurr/openpurr/standard/internal/jobs"
	"github.com/openpurr/openpurr/standard/internal/metrics"
	"github.com/openpurr/openpurr/standard/internal/scheduled"
	"github.com/openpurr/openpurr/standard/internal/webhooks"
)

// How many claims of webhooks.RetriesPerRun deliveries one retry run makes at most. Lite retries
// 20 per run (a free-plan subrequest limit); Standard keeps going while there's a full batch.
const retryClaimsPerRun = 25

func (s *server) registerJobs() {
	every5 := 5 * time.Minute
	s.Jobs.Register(jobs.Job{Name: "retry-webhooks", Every: every5, Run: func(ctx context.Context, now int64) error {
		cfg, err := s.Config.Get(ctx)
		if err != nil || !webhooks.AnyWebhooks(cfg) {
			return err
		}
		for range retryClaimsPerRun {
			n, err := s.Webhooks.RetryDue(ctx, cfg, now)
			if err != nil || n < webhooks.RetriesPerRun {
				return err
			}
		}
		return nil
	}})
	s.Jobs.Register(jobs.Job{Name: "backfill-snapshots", Every: every5, Run: func(ctx context.Context, now int64) error {
		cfg, err := s.Config.Get(ctx)
		if err != nil {
			return err
		}
		_, err = scheduled.BackfillSnapshots(ctx, s.Pool, cfg, now)
		return err
	}})

	hourly := func(name string, run func(ctx context.Context, now int64) (int64, error)) {
		s.Jobs.Register(jobs.Job{Name: name, Every: time.Hour, Run: func(ctx context.Context, now int64) error {
			_, err := run(ctx, now)
			return err
		}})
	}
	hourly("prune-notification-payloads", func(ctx context.Context, now int64) (int64, error) {
		return scheduled.PruneNotificationPayloads(ctx, s.Pool, now)
	})
	hourly("prune-captures", func(ctx context.Context, now int64) (int64, error) { return scheduled.PruneCaptures(ctx, s.Pool, now) })
	hourly("prune-inactive-customers", func(ctx context.Context, now int64) (int64, error) {
		return scheduled.PruneInactiveCustomers(ctx, s.Pool, now)
	})
	hourly("prune-expired-apple-chains", func(ctx context.Context, now int64) (int64, error) {
		return scheduled.PruneExpiredChains(ctx, s.Pool, now)
	})
	hourly("prune-oauth", func(ctx context.Context, now int64) (int64, error) { return scheduled.PruneOAuth(ctx, s.Pool, now) })
	hourly("refresh-exchange-rates", func(ctx context.Context, now int64) (int64, error) {
		n, err := fx.Refresh(ctx, s.Pool, s.HTTPClient, now, s.FX)
		return int64(n), err
	})
	s.registerGoogleJobs()
	hourly("rollup-metrics", func(ctx context.Context, now int64) (int64, error) {
		r, err := metrics.Rollup(ctx, s.Pool, now, false)
		if err != nil {
			return 0, err
		}
		return r.Rows, nil
	})
}
