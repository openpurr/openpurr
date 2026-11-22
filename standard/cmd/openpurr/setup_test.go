package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const setupConfig = `version: 1
apps:
  ios:
    store: app_store
    bundle_id: com.example.myapp
    sdk_keys: [appl_replace_with_a_long_random_string]
    products:
      pro_monthly: { type: subscription }
    app_store_server_api:
      issuer_id: 57246542-96fe-1a63-e053-0824d011072a
      key_id: 2X9R4HXF34
  android:
    store: play_store
    package_name: com.example.myapp
    sdk_keys: [goog_replace_with_a_long_random_string]
    products:
      pro: { type: subscription, base_plans: [monthly] }
    google_play_api:
      pubsub_push_account: rtdn-push@my-project.iam.gserviceaccount.com
entitlements:
  pro:
    products:
      ios: [pro_monthly]
      android: [pro]
webhooks:
  - id: backend
    url: https://api.example.com/webhooks/revenuecat
    signing_secret: WEBHOOK_SIGNING_SECRET
`

func TestSetupGCPWritesTheVariables(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "openpurr.config.yaml")
	if err := os.WriteFile(cfg, []byte(setupConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "openpurr.tfvars")
	answers := strings.Join([]string{
		"My Project",                    // refused
		"my-project",                    // project
		"",                              // region: default
		"latest",                        // refused: not pinned
		"v0.3.0",                        // version
		"https://purchases.example.com", // refused
		"Purchases.Example.com",         // domain
		"",                              // secrets: from the config
		"you@example.com, group:ops@example.com",
		"", // Play: yes, from the config
	}, "\n") + "\n"
	var stdout, stderr bytes.Buffer
	if code := runSetup([]string{"gcp", "--config", cfg, "--out", out}, strings.NewReader(answers), &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s\n%s", code, stderr.String(), stdout.String())
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`project_id = "my-project"`,
		`region     = "us-central1"`,
		`image      = "ghcr.io/openpurr/openpurr-standard:0.3.0"`,
		`domain     = "purchases.example.com"`,
		`config_file = "` + cfg + `"`,
		`secrets = ["APPLE_IAP_KEY", "GOOGLE_SERVICE_ACCOUNT", "WEBHOOK_SIGNING_SECRET"]`,
		`iap_members = ["user:you@example.com", "group:ops@example.com"]`,
		`google_play_rtdn = true`,
	} {
		if !strings.Contains(string(got), want) {
			t.Errorf("missing %s in\n%s", want, got)
		}
	}
	if !strings.Contains(stdout.String(), "A project ID is") || !strings.Contains(stdout.String(), "Give a release version") || !strings.Contains(stdout.String(), "A domain looks like") {
		t.Errorf("no retry messages:\n%s", stdout.String())
	}

	// It doesn't overwrite without --force.
	if code := runSetup([]string{"gcp", "--out", out}, strings.NewReader(answers), &stdout, &stderr); code != 1 || !strings.Contains(stderr.String(), "already exists") {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
}

func TestSetupGCPWithoutADomain(t *testing.T) {
	out := filepath.Join(t.TempDir(), "x.tfvars")
	answers := "my-project\neurope-west1\nus-docker.pkg.dev/my-project/images/openpurr-standard:0.3.0\n\n\nAPPLE_IAP_KEY\nn\n"
	var stdout, stderr bytes.Buffer
	if code := runSetup([]string{"gcp", "--out", out}, strings.NewReader(answers), &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	got, _ := os.ReadFile(out)
	for _, want := range []string{`domain     = ""`, `image      = "us-docker.pkg.dev/my-project/images/openpurr-standard:0.3.0"`, `secrets = ["APPLE_IAP_KEY"]`, "google_play_rtdn = false"} {
		if !strings.Contains(string(got), want) {
			t.Errorf("missing %s in\n%s", want, got)
		}
	}
	if strings.Contains(string(got), "iap_members") || strings.Contains(string(got), "config_file") {
		t.Errorf("%s", got)
	}
	if !strings.Contains(stdout.String(), "set one before you ship") {
		t.Errorf("%s", stdout.String())
	}
}

func TestSetupGCPStopsOnEndOfInput(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := runSetup([]string{"gcp", "--out", filepath.Join(t.TempDir(), "x.tfvars")}, strings.NewReader("my-project\n"), &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if code := runSetup([]string{"aws"}, strings.NewReader(""), &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d", code)
	}
}

func TestHCLStringEscapesTemplates(t *testing.T) {
	if got := hclString(`a${b}%{c}"d`); got != `"a$${b}%%{c}\"d"` {
		t.Fatal(got)
	}
}
