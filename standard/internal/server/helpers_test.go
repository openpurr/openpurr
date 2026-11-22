package server_test

import (
	"context"
	"testing"
	"time"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jobs"
	tu "github.com/openpurr/openpurr/standard/internal/testutil"
)

// saveAndLoad saves a new config version and returns what the server now loads.
func saveAndLoad(t *testing.T, env *tu.Env, doc any) (*config.Config, int64, error) {
	t.Helper()
	ctx := t.Context()
	cur, err := config.CurrentVersion(ctx, env.Pool)
	if err != nil {
		return nil, 0, err
	}
	base := int64(0)
	if cur != nil {
		base = cur.ID
	}
	id, _, err := config.Save(ctx, env.Pool, doc, base, nil, nil, env.Clock.Now())
	if err != nil {
		return nil, 0, err
	}
	env.Loader.Invalidate()
	cfg, err := env.Loader.Get(ctx)
	return cfg, id, err
}

func jobForTest(ran *int) jobs.Job {
	return jobs.Job{Name: "test", Every: time.Hour, Run: func(context.Context, int64) error { *ran++; return nil }}
}
