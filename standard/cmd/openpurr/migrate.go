package main

// Loading an export bundle (spec/export-bundle.md) into this server's database: the import step
// of moving from Lite (docs/migrating-from-lite-to-standard.md). The bundle comes from
// `openpurr export` (the CLI, cli/); this reads it from disk and writes with DATABASE_URL.
//
//	openpurr migrate import --bundle DIR [--replace] [--force] [--skip-snapshots]
//	openpurr migrate rebuild [--skip-snapshots]

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"time"

	"github.com/openpurr/openpurr/standard/internal/db"
	"github.com/openpurr/openpurr/standard/internal/metrics"
	"github.com/openpurr/openpurr/standard/internal/migration"
)

const migrateUsage = `Usage: openpurr migrate import --bundle <dir> [--replace] [--force] [--skip-snapshots]
       openpurr migrate rebuild [--skip-snapshots]

import   Loads a bundle from openpurr export (the CLI). A full bundle goes into an empty database
         (--replace erases one that isn't); a delta bundle goes on top of the bundle before it
         (--force: whatever came before). Then rebuilds the chart totals and CustomerInfo.
rebuild  Rebuilds the chart totals and every CustomerInfo snapshot from the ledger.

Needs DATABASE_URL. Operators' passwords and authenticators work only if this server's
OPERATOR_SECRET is the one the old deployment had.`

// runMigrate runs `openpurr migrate ...`; it returns the exit code.
func runMigrate(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || (args[0] != "import" && args[0] != "rebuild") {
		fmt.Fprintln(stderr, migrateUsage)
		return 1
	}
	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	bundleDir := fs.String("bundle", "", "")
	replace := fs.Bool("replace", false, "")
	force := fs.Bool("force", false, "")
	skipSnapshots := fs.Bool("skip-snapshots", false, "")
	if err := fs.Parse(args[1:]); err != nil {
		fmt.Fprintln(stderr, err.Error()+"\n"+migrateUsage)
		return 1
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fmt.Fprintln(stderr, "DATABASE_URL must be set.")
		return 1
	}
	ctx := context.Background()
	var bundle *migration.Bundle
	if args[0] == "import" {
		if *bundleDir == "" {
			fmt.Fprintln(stderr, "--bundle is required.\n"+migrateUsage)
			return 1
		}
		var err error
		if bundle, err = migration.OpenBundle(*bundleDir); err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 1
		}
	}
	pool, err := db.Open(ctx, url)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool, nil); err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	opts := migration.Options{Replace: *replace, Force: *force, SkipSnapshots: *skipSnapshots, Progress: stdout}

	if args[0] == "rebuild" {
		start := time.Now()
		res, err := metrics.Rollup(ctx, pool, time.Now().UnixMilli(), true)
		if err != nil {
			fmt.Fprintln(stderr, "Rebuilding the chart totals: "+err.Error())
			return 1
		}
		fmt.Fprintf(stdout, "Chart totals rebuilt (%d rows).\n", res.Rows)
		if !*skipSnapshots {
			n, err := migration.RebuildSnapshots(ctx, pool, nil, &opts)
			if err != nil {
				fmt.Fprintln(stderr, err.Error())
				return 1
			}
			fmt.Fprintf(stdout, "%d CustomerInfo snapshots built.\n", n)
		}
		fmt.Fprintf(stdout, "Done in %s.\n", time.Since(start).Round(time.Millisecond))
		return 0
	}

	m := bundle.Manifest
	fmt.Fprintf(stdout, "Importing a %s bundle from %s (%s, %s).\n", m.Kind, m.Source.URL, m.Source.Edition, m.CreatedAt)
	res, err := migration.Import(ctx, pool, bundle, opts)
	if err != nil {
		fmt.Fprintln(stderr, "Nothing was imported: "+err.Error())
		return 1
	}
	var total int64
	names := make([]string, 0, len(res.Rows))
	for name, n := range res.Rows {
		total += n
		names = append(names, name)
	}
	sort.Strings(names)
	fmt.Fprintf(stdout, "Imported %d rows in %s; rebuilt %d chart rows and %d snapshots in %s.\n",
		total, res.LoadTime.Round(time.Millisecond), res.MetricRows, res.Snapshots, res.Rebuild.Round(time.Millisecond))
	if m.Kind == "delta" {
		fmt.Fprintf(stdout, "%d customers changed, %d deleted.\n", res.ChangedCustomers, res.DeletedCustomers)
		if len(res.KeptCustomers) > 0 {
			fmt.Fprintf(stdout, "Kept %d customers the source deleted, because purchases or grants here still belong to them: %v\n", len(res.KeptCustomers), res.KeptCustomers)
		}
	}
	fmt.Fprintln(stdout, "Next: openpurr migrate verify (the CLI) compares the two deployments.")
	return 0
}
