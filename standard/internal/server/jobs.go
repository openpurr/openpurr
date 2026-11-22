package server

// The periodic jobs, in the order lite/src/scheduled.ts runs them: every 5 minutes, webhook
// retries; every hour, Google Play's acknowledgement retries and voided-purchases polling.

import (
	"context"
	"time"

	"github.com/openpurr/openpurr/standard/internal/jobs"
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
	s.registerGoogleJobs()
}
