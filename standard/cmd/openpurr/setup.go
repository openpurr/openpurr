package main

// `openpurr setup gcp`: asks a few questions and writes the variables file for infra/gcp (see
// docs/standard-on-gcp.md). It only writes a file; it never talks to Google Cloud.
//
//	openpurr setup gcp [--config openpurr.config.yaml] [--out openpurr.tfvars] [--force]
//
// With --config, the config is checked, and the secrets it names and whether it has Google Play
// apps become the defaults.

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/openpurr/openpurr/standard/internal/config"
)

const setupUsage = `Usage: openpurr setup gcp [--config <openpurr.config.yaml>] [--out <file>] [--force]
Writes the variables for infra/gcp (default openpurr.tfvars). See docs/standard-on-gcp.md.`

var (
	gcpProjectRE = regexp.MustCompile(`^[a-z][a-z0-9-]{4,28}[a-z0-9]$`)
	gcpRegionRE  = regexp.MustCompile(`^[a-z]+-[a-z]+[0-9]+$`)
	versionRE    = regexp.MustCompile(`^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`)
	domainRE     = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$`)
	secretNameRE = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)
	memberRE     = regexp.MustCompile(`^(user|group|domain|serviceAccount):[^\s,]+$`)
)

// runSetup runs `openpurr setup ...`; it returns the exit code.
func runSetup(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "gcp" {
		fmt.Fprintln(stderr, setupUsage)
		return 1
	}
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	configPath := fs.String("config", "", "")
	out := fs.String("out", "openpurr.tfvars", "")
	force := fs.Bool("force", false, "")
	if err := fs.Parse(args[1:]); err != nil {
		fmt.Fprintln(stderr, err.Error()+"\n"+setupUsage)
		return 1
	}
	if _, err := os.Stat(*out); err == nil && !*force {
		fmt.Fprintf(stderr, "%s already exists. Pass --force to replace it, or --out for another file.\n", *out)
		return 1
	}
	text, err := askGCP(bufio.NewReader(stdin), stdout, *configPath)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	if err := os.WriteFile(*out, []byte(text), 0o600); err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, "\nWrote %s. Next, from a copy of infra/gcp (docs/standard-on-gcp.md, steps 1 and 2):\n", *out)
	fmt.Fprintf(stdout, "  tofu init\n  tofu apply -var-file=%s -target=google_secret_manager_secret.store\n", *out)
	fmt.Fprintf(stdout, "  gcloud secrets versions add ... (one per secret)\n  tofu apply -var-file=%s\n", *out)
	return 0
}

type prompter struct {
	in  *bufio.Reader
	out io.Writer
}

// ask shows a question with its default and returns the answer, trimmed (the default when empty).
// It asks again while check fails.
func (p *prompter) ask(question, def string, check func(string) error) (string, error) {
	for range 5 {
		if def != "" {
			fmt.Fprintf(p.out, "%s [%s]: ", question, def)
		} else {
			fmt.Fprintf(p.out, "%s: ", question)
		}
		line, err := p.in.ReadString('\n')
		if err != nil && !(errors.Is(err, io.EOF) && line != "") {
			if errors.Is(err, io.EOF) {
				return "", errors.New("\nStopped: no answer")
			}
			return "", err
		}
		answer := strings.TrimSpace(line)
		if answer == "" {
			answer = def
		}
		if check == nil {
			return answer, nil
		}
		if err := check(answer); err != nil {
			fmt.Fprintln(p.out, "  "+err.Error())
			continue
		}
		return answer, nil
	}
	return "", errors.New("Stopped after five tries")
}

func list(s string) []string {
	var out []string
	for _, v := range strings.Split(s, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// configNeeds reads the secret names a config uses and whether it has Google Play apps.
func configNeeds(cfg *config.Config) (secrets []string, play bool) {
	add := func(name string) {
		if name != "" && !slices.Contains(secrets, name) {
			secrets = append(secrets, name)
		}
	}
	for _, pid := range cfg.ProjectOrder {
		project := cfg.Projects[pid]
		for _, aid := range project.AppOrder {
			app := project.Apps[aid]
			if app.AppStoreServerAPI != nil {
				add(app.AppStoreServerAPI.PrivateKeySecret)
			}
			if app.GooglePlayAPI != nil {
				add(app.GooglePlayAPI.ServiceAccountSecret)
				play = true
			}
		}
		for _, w := range project.Webhooks {
			add(w.AuthorizationSecret)
			add(w.SigningSecret)
		}
	}
	return secrets, play
}

func askGCP(in *bufio.Reader, out io.Writer, configPath string) (string, error) {
	p := &prompter{in: in, out: out}
	var secretsDefault []string
	playDefault := "n"
	if configPath != "" {
		_, cfg, err := config.LoadFile(configPath)
		if err != nil {
			return "", err
		}
		var play bool
		secretsDefault, play = configNeeds(cfg)
		if play {
			playDefault = "y"
		}
	}

	fmt.Fprintln(out, "Variables for infra/gcp (openpurr Standard on Google Cloud). Press Enter to take the [default].")
	project, err := p.ask("Google Cloud project ID", "", func(s string) error {
		if !gcpProjectRE.MatchString(s) {
			return errors.New("A project ID is 6 to 30 lowercase letters, digits or hyphens, such as my-project.")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	region, err := p.ask("Region", "us-central1", func(s string) error {
		if !gcpRegionRE.MatchString(s) {
			return errors.New("A region looks like us-central1 or europe-west1.")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	image, err := p.ask("openpurr version to run (such as 0.3.0), or a full image reference", "", func(s string) error {
		if versionRE.MatchString(s) || (strings.Contains(s, "/") && strings.Contains(s, ":") && !strings.ContainsAny(s, " \"")) {
			return nil
		}
		return errors.New("Give a release version such as 0.3.0 (pinned, so upgrades are on purpose), or an image such as ghcr.io/openpurr/openpurr-standard:0.3.0.")
	})
	if err != nil {
		return "", err
	}
	if versionRE.MatchString(image) {
		image = "ghcr.io/openpurr/openpurr-standard:" + strings.TrimPrefix(image, "v")
	}
	fmt.Fprintln(out, "Apps, App Store Connect and Google Play will use this domain, so you can move hosts later without an app update.")
	domain, err := p.ask("Domain for openpurr (such as purchases.example.com; empty for a *.run.app address, for testing)", "", func(s string) error {
		if s != "" && !domainRE.MatchString(strings.ToLower(s)) {
			return errors.New("A domain looks like purchases.example.com (no https://, no path).")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	domain = strings.ToLower(domain)

	configFile := configPath
	if configFile == "" {
		configFile, err = p.ask("Config file to import on the first start (empty to write it on the dashboard)", "", func(s string) error {
			if s == "" {
				return nil
			}
			_, _, err := config.LoadFile(s)
			return err
		})
		if err != nil {
			return "", err
		}
	}
	if configPath == "" && configFile != "" {
		_, cfg, _ := config.LoadFile(configFile)
		var play bool
		secretsDefault, play = configNeeds(cfg)
		if play {
			playDefault = "y"
		}
	}

	secretsAnswer, err := p.ask("Secrets your config names, separated by commas", strings.Join(secretsDefault, ","), func(s string) error {
		for _, name := range list(s) {
			if !secretNameRE.MatchString(name) {
				return fmt.Errorf("%q isn't a secret name: capital letters, digits and underscores, such as APPLE_IAP_KEY.", name)
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}

	var members []string
	if domain != "" {
		answer, err := p.ask("Google accounts to sign in through Identity-Aware Proxy, separated by commas (empty for none)", "", func(s string) error {
			for _, m := range list(s) {
				if !strings.Contains(m, ":") {
					m = "user:" + m
				}
				if !memberRE.MatchString(m) || !strings.Contains(m, "@") && !strings.HasPrefix(m, "domain:") {
					return fmt.Errorf("%q isn't an email (you@example.com) or a member (group:ops@example.com).", m)
				}
			}
			return nil
		})
		if err != nil {
			return "", err
		}
		for _, m := range list(answer) {
			if !strings.Contains(m, ":") {
				m = "user:" + m
			}
			members = append(members, m)
		}
	}
	yesNo := func(s string) error {
		if s := strings.ToLower(s); s != "y" && s != "n" && s != "yes" && s != "no" {
			return errors.New("Answer y or n.")
		}
		return nil
	}
	play, err := p.ask("Set up Pub/Sub for Google Play notifications? (y/n)", playDefault, yesNo)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	q := hclString
	b.WriteString("# Written by `openpurr setup gcp`. Variables for infra/gcp; every one is described in variables.tf.\n")
	b.WriteString("# See docs/standard-on-gcp.md.\n\n")
	fmt.Fprintf(&b, "project_id = %s\nregion     = %s\nimage      = %s\n", q(project), q(region), q(image))
	fmt.Fprintf(&b, "domain     = %s\n", q(domain))
	if configFile != "" {
		fmt.Fprintf(&b, "config_file = %s\n", q(configFile))
	}
	b.WriteString("\n# Add each one's value with `gcloud secrets versions add <name>-<SECRET>` before the full apply.\n")
	fmt.Fprintf(&b, "secrets = %s\n", hclList(list(secretsAnswer)))
	if len(members) > 0 {
		b.WriteString("\n# Signed in through Identity-Aware Proxy as the operator with the same email.\n")
		fmt.Fprintf(&b, "iap_members = %s\n", hclList(members))
	}
	fmt.Fprintf(&b, "\ngoogle_play_rtdn = %t\n", strings.HasPrefix(strings.ToLower(play), "y"))
	if domain == "" {
		fmt.Fprintln(out, "No domain: fine for a test, but set one before you ship an app, since apps keep the address they were built with.")
	}
	return b.String(), nil
}

// hclString is s as an HCL string literal, with template sequences escaped.
func hclString(s string) string {
	return strings.NewReplacer("${", "$${", "%{", "%%{").Replace(strconv.Quote(s))
}

func hclList(items []string) string {
	quoted := make([]string, len(items))
	for i, s := range items {
		quoted[i] = hclString(s)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}
