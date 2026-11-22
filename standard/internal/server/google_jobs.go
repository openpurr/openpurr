package server

// Google Play's periodic jobs (lite/src/scheduled.ts runs them hourly): acknowledgement retries and
// voided-purchases polling.

import (
	"context"
	"time"

	"github.com/openpurr/openpurr/standard/internal/google"
	"github.com/openpurr/openpurr/standard/internal/jobs"
)

func (s *server) registerGoogleJobs() {
	s.Jobs.Register(jobs.Job{Name: "retry-play-acknowledgements", Every: time.Hour, Run: func(ctx context.Context, now int64) error {
		cfg, err := s.Config.Get(ctx)
		if err != nil {
			return err
		}
		_, err = google.RetryAcknowledgements(ctx, s.Pool, cfg, s.googleEnv(), now)
		return err
	}})
	s.Jobs.Register(jobs.Job{Name: "poll-play-voided-purchases", Every: time.Hour, Run: func(ctx context.Context, now int64) error {
		cfg, err := s.Config.Get(ctx)
		if err != nil {
			return err
		}
		_, err = google.PollVoided(ctx, s.Pool, cfg, sortedAppIDs(cfg), s.googleEnv(), now)
		return err
	}})
}
