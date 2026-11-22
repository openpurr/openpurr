package config_test

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/clock"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
	"github.com/openpurr/openpurr/standard/internal/testutil"
)

func twoProjects(ids ...string) *jsobj.Object {
	var doc *jsobj.Object
	for _, c := range testdata.Load().ConfigCases {
		if c.Name == "two_projects" {
			doc = testdata.Value(c.Document).(*jsobj.Object)
		}
	}
	if len(ids) == 2 {
		projects := get(doc, "projects").(*jsobj.Object)
		renamed := jsobj.New()
		for i, old := range []string{"rose", "gold"} {
			v, _ := projects.Get(old)
			renamed.Set(ids[i], v)
		}
		doc.Set("projects", renamed)
	}
	return doc
}

// Mirrors "the config in D1" in lite/test/projects.test.ts.
func TestConfigStore(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := t.Context()
	clk := clock.NewFixed(1_000_000)
	wipe := func() {
		if _, err := pool.Exec(ctx, "DELETE FROM config_version"); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("imports the seed once, then serves what's in the database", func(t *testing.T) {
		wipe()
		load := config.NewLoader(pool, clk, 0, testdata.TestConfig(), testutil.Quiet)
		first, err := load.Get(ctx)
		if err != nil || !slices.Equal(first.ProjectOrder, []string{"default"}) {
			t.Fatal(first, err)
		}
		stored, err := config.CurrentVersion(ctx, pool)
		if err != nil || stored == nil || *stored.CreatedBy != "import" || *stored.Note != "Imported from openpurr.config.yaml" {
			t.Fatal(stored, err)
		}
		if imported, _ := config.ImportConfig(ctx, pool, testdata.TestConfig(), 0, nil); imported {
			t.Fatal("imported twice")
		}
		by := "test@example.com"
		if _, _, err := config.Save(ctx, pool, twoProjects(), stored.ID, &by, nil, clk.Now()); err != nil {
			t.Fatal(err)
		}
		second, err := load.Get(ctx)
		if err != nil || !slices.Equal(second.ProjectOrder, []string{"rose", "gold"}) {
			t.Fatal(second.ProjectOrder, err)
		}
	})

	t.Run("starts empty without a seed, and skips an invalid seed", func(t *testing.T) {
		wipe()
		cfg, err := config.NewLoader(pool, clk, 0, nil, testutil.Quiet).Get(ctx)
		if err != nil || len(cfg.Projects) != 0 {
			t.Fatal(err)
		}
		cfg, err = config.NewLoader(pool, clk, 0, jsobj.New("version", 7.0), testutil.Quiet).Get(ctx)
		if err != nil || len(cfg.Projects) != 0 {
			t.Fatal(err)
		}
	})

	t.Run("checks for a newer version only after the max age", func(t *testing.T) {
		wipe()
		id, _, err := config.Save(ctx, pool, testdata.TestConfig(), 0, nil, nil, clk.Now())
		if err != nil {
			t.Fatal(err)
		}
		load := config.NewLoader(pool, clk, 60_000, nil, testutil.Quiet)
		if cfg, _ := load.Get(ctx); cfg.Projects["default"] == nil {
			t.Fatal("default missing")
		}
		if _, _, err := config.Save(ctx, pool, twoProjects(), id, nil, nil, clk.Now()); err != nil {
			t.Fatal(err)
		}
		clk.Add(30_000)
		if cfg, _ := load.Get(ctx); cfg.Projects["default"] == nil {
			t.Fatal("should still be cached")
		}
		clk.Add(31_000)
		if cfg, _ := load.Get(ctx); cfg.Projects["rose"] == nil {
			t.Fatal("should have reloaded")
		}
	})

	t.Run("refuses a save made from an older version", func(t *testing.T) {
		wipe()
		id, _, err := config.Save(ctx, pool, testdata.TestConfig(), 0, nil, nil, clk.Now())
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := config.Save(ctx, pool, twoProjects(), id, nil, nil, clk.Now()); err != nil {
			t.Fatal(err)
		}
		if _, _, err := config.Save(ctx, pool, testdata.TestConfig(), id, nil, nil, clk.Now()); !errors.Is(err, config.ErrConflict) {
			t.Fatal(err)
		}
		bad := jsobj.New("version", 2.0, "projects", jsobj.New("x", jsobj.New("apps", 1.0)))
		var ce *config.Error
		if _, _, err := config.Save(ctx, pool, bad, id+1, nil, nil, clk.Now()); !errors.As(err, &ce) {
			t.Fatal(err)
		}
		versions, err := config.ListVersions(ctx, pool, 50, 0)
		if err != nil || len(versions) != 2 || versions[0].ID <= versions[1].ID {
			t.Fatal(versions, err)
		}
		v, err := config.GetVersion(ctx, pool, id)
		if err != nil || v == nil || v.Document == nil {
			t.Fatal(v, err)
		}
	})

	t.Run("won't move an app to another project, or drop a project that has customers", func(t *testing.T) {
		before, _ := config.Parse(twoProjects("rose2", "gold2"))
		moved := twoProjects("rose2", "gold2")
		app := get(moved, "projects", "rose2", "apps", "rose_ios")
		get(moved, "projects", "gold2", "apps").(*jsobj.Object).Set("rose_ios", app)
		rose := get(moved, "projects", "rose2").(*jsobj.Object)
		rose.Set("apps", jsobj.New())
		rose.Set("entitlements", jsobj.New())
		rose.Set("offerings", []any{})
		next, err := config.Parse(moved)
		if err != nil {
			t.Fatal(err)
		}
		problems, err := config.ChangeProblems(ctx, pool, before, next)
		if err != nil || !strings.Contains(strings.Join(problems, ","), "rose_ios: an app can't move to another project") {
			t.Fatal(problems, err)
		}
		dropped := twoProjects("rose2", "gold2")
		get(dropped, "projects").(*jsobj.Object).Delete("gold2")
		next, _ = config.Parse(dropped)
		if problems, _ := config.ChangeProblems(ctx, pool, before, next); len(problems) != 0 {
			t.Fatal(problems)
		}
		if _, err := pool.Exec(ctx, "INSERT INTO customer (id, project_id, app_user_id, first_seen) VALUES ('c1', 'gold2', 'someone', 1)"); err != nil {
			t.Fatal(err)
		}
		if problems, _ := config.ChangeProblems(ctx, pool, before, next); !slices.Equal(problems, []string{"projects.gold2: this project has customers, so it can't be removed."}) {
			t.Fatal(problems)
		}
	})
}
