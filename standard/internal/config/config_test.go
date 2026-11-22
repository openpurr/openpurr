package config_test

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/testdata"
)

func problems(t *testing.T, raw any) []string {
	t.Helper()
	_, err := config.Parse(raw)
	if err == nil {
		return nil
	}
	var ce *config.Error
	if !errors.As(err, &ce) {
		t.Fatalf("unexpected error %v", err)
	}
	return ce.Problems
}

// Every case in golden.json: the same problems, in the same order, and for valid documents the
// same versions and stored document as Lite's parseConfig.
func TestParseMatchesLite(t *testing.T) {
	g := testdata.Load()
	for _, c := range g.ConfigCases {
		t.Run(c.Name, func(t *testing.T) {
			raw := testdata.Value(c.Document)
			got := problems(t, raw)
			if !slices.Equal(got, c.Problems) {
				t.Fatalf("problems differ\n got: %q\nwant: %q", got, c.Problems)
			}
			if len(c.Problems) > 0 {
				return
			}
			cfg, err := config.Parse(raw)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.Version != c.Version {
				t.Errorf("version %s, want %s", cfg.Version, c.Version)
			}
			if got := jsobj.Stringify(cfg.Document); got != c.Stored {
				t.Errorf("stored document differs\n got: %s\nwant: %s", got, c.Stored)
			}
			for id, v := range c.ProjectVersions {
				if cfg.Projects[id].Version != v {
					t.Errorf("project %s version %s, want %s", id, cfg.Projects[id].Version, v)
				}
			}
		})
	}
}

func clone() *jsobj.Object { return testdata.TestConfig().(*jsobj.Object) }

func get(o any, path ...string) any {
	for _, p := range path {
		o, _ = jsobj.Prop(o, p)
	}
	return o
}

func TestParseTestConfig(t *testing.T) {
	cfg, err := config.Parse(clone())
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.Projects["default"].AppOrder; !slices.Equal(got, []string{"ios", "android"}) {
		t.Errorf("apps %v", got)
	}
	if cfg.Keys["appl_test_ios_0123456789"].ID != "ios" {
		t.Error("key lookup")
	}
	if p := cfg.Projects["default"]; p.CurrentOffering == nil || *p.CurrentOffering != "default" || p.Name != "Default" {
		t.Error("current offering or name")
	}
	if cfg.Apps["ios"].ProjectID != "default" {
		t.Error("project of app")
	}
	if v, _ := cfg.Document.Get("version"); v != 2.0 {
		t.Error("document version")
	}
}

func TestVersionOneProblemsKeepVersionOnePaths(t *testing.T) {
	c := clone()
	get(c, "apps", "ios").(*jsobj.Object).Set("sdk_keys", []any{"nope"})
	got := strings.Join(problems(t, c), "\n")
	if !strings.Contains(got, "apps.ios.sdk_keys[0]") {
		t.Fatal(got)
	}
}

func TestProjectsAreVersionedSeparately(t *testing.T) {
	g := testdata.Load()
	var doc any
	for _, c := range g.ConfigCases {
		if c.Name == "two_projects" {
			doc = testdata.Value(c.Document)
		}
	}
	a, err := config.Parse(doc)
	if err != nil {
		t.Fatal(err)
	}
	changed := jsobj.CloneValue(doc)
	get(changed, "projects", "gold", "entitlements").(*jsobj.Object).Set("vip", jsobj.New("products", jsobj.New("gold_ios", []any{"gold_monthly"})))
	b, err := config.Parse(changed)
	if err != nil {
		t.Fatal(err)
	}
	if a.Projects["rose"].Version != b.Projects["rose"].Version {
		t.Error("rose's version changed")
	}
	if a.Projects["gold"].Version == b.Projects["gold"].Version {
		t.Error("gold's version didn't change")
	}
	// The input isn't kept: changing it after parsing changes nothing.
	get(doc, "projects", "rose").(*jsobj.Object).Set("name", "Changed")
	if a.Projects["rose"].Name != "Rose" || strings.Contains(jsobj.Stringify(a.Document), "Changed") {
		t.Error("parse kept a reference to its input")
	}
}

func TestEntitlementsFor(t *testing.T) {
	cfg, err := config.Parse(clone())
	if err != nil {
		t.Fatal(err)
	}
	p := cfg.Projects["default"]
	monthly, annual := "monthly", "annual"
	if got := p.EntitlementsFor("android", "pro", &monthly); !slices.Equal(got, []string{"pro"}) {
		t.Errorf("monthly: %v", got)
	}
	if got := p.EntitlementsFor("android", "pro", &annual); !slices.Equal(got, []string{"pro", "annual_perks"}) {
		t.Errorf("annual: %v", got)
	}
	if got := p.EntitlementsFor("ios", "coins_100", nil); len(got) != 0 {
		t.Errorf("coins: %v", got)
	}
}

func TestYAMLUsesTheCoreSchema(t *testing.T) {
	raw, err := config.ParseYAML([]byte(`
version: 1
apps:
  ios:
    store: app_store
    bundle_id: com.example.app
    sdk_keys: [appl_abcdefghijklmnopqrst]
    products:
      pro: { type: subscription, subscription_group: 21000000 }
      "2024": { type: non_consumable }
entitlements:
  pro: { description: yes, products: { ios: [pro, "2024"] } }
offerings:
  - id: default
    current: true
    metadata: { when: 2026-01-01, n: 0x1F, f: 1.50, nothing: ~ }
    packages:
      - { id: $rc_monthly, ios: pro }
`))
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	p := cfg.Projects["default"]
	if p.Entitlements[0].Description != "yes" {
		t.Errorf("yes should stay a string, got %q", p.Entitlements[0].Description)
	}
	if got := cfg.Apps["ios"].Products["pro"].SubscriptionGroup; got != "21000000" {
		t.Errorf("subscription group %q", got)
	}
	if got := jsobj.Stringify(p.Offerings[0].Metadata); got != `{"when":"2026-01-01","n":31,"f":1.5,"nothing":null}` {
		t.Errorf("metadata %s", got)
	}
	// Integer-like keys come first, as in JavaScript.
	if got := cfg.Apps["ios"].ProductOrder; !slices.Equal(got, []string{"2024", "pro"}) {
		t.Errorf("product order %v", got)
	}

	if _, err := config.ParseYAML([]byte("apps: [unclosed")); err == nil {
		t.Error("syntax error expected")
	}
	empty, err := config.ParseYAML(nil)
	if err != nil || empty != nil {
		t.Errorf("empty file: %v %v", empty, err)
	}
	if got := problems(t, empty); !slices.Equal(got, []string{"the config must be a mapping"}) {
		t.Errorf("empty file problems %v", got)
	}
}

func TestErrorMessage(t *testing.T) {
	err := &config.Error{Problems: []string{"a: b", "c: d"}}
	if err.Error() != "Invalid openpurr config:\n  - a: b\n  - c: d" {
		t.Fatal(err.Error())
	}
}
