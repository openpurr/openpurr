<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><b>English</b> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

A self-hosted, open source RevenueCat alternative backend.

Using RevenueCat's open source Purchases SDKs, point your app's `Purchases.proxyURL` at your own server. openpurr validates App Store and Google Play purchases, tracks entitlements, receives store notifications, sends webhooks to your backend, and charts your core subscription metrics. It runs on infrastructure you control.

openpurr is an independent project. It is not affiliated with or endorsed by RevenueCat, Inc.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="The openpurr Lite dashboard's charts, clicked through with tooltips: MRR, MRR movement, Revenue, Active subscriptions, Churn">
</picture>

## Who it's for

App developers who:

- **Want to control their own purchase infrastructure.** Your purchase records, entitlements and store credentials live on servers you run, in a database you can query, back up and export. No outside service sits between your app and your customers.
- **Don't want to share a percentage of their revenue.** openpurr has no revenue share and no per-transaction fees. The Lite edition is designed to fit Cloudflare's free plan, so a small app can run it for nothing.
- **Don't want to depend on a commercial service.** It's open source: you can read the code, change it, and move it between Cloudflare and your own cloud.

It's also a good fit if you already use the RevenueCat SDKs and want to keep them. openpurr works with the official, unmodified SDKs, so switching starts with changing one URL, not rewriting your purchase code. To bring your existing customers over, see [Moving from RevenueCat](docs/migrating-from-revenuecat.md).

**It may not be for you (yet)** if you need paywall builders, A/B experiments, third-party analytics integrations or a support contract. Commercial platforms offer those today. See the [roadmap](ROADMAP.md) for what's coming.

## What it does

- **Purchases:** validates StoreKit 2 transactions and Google Play purchases, and returns the `CustomerInfo` and entitlements the SDK expects.
- **Store notifications:** receives App Store Server Notifications V2 and Google Play Real-time Developer Notifications.
- **Webhooks:** sends RevenueCat-shaped events to your backend, signed with HMAC-SHA256 and retried for about 72 hours.
- **Charts:** 16 charts in the dashboard, which you can filter by project, app, store, product and environment, and downloadable as CSV:
  - **Revenue:** revenue, refunds, refund rate and non-subscription purchases.
  - **Recurring revenue:** MRR, ARR and MRR movement.
  - **Subscriptions:** active subscriptions, paid subscriptions, subscription movement, subscription status and churn.
  - **Trials:** active trials, new trials and trial movement.
  - **Customers:** new customers.
- **Auth:** SDK keys and secret keys, operator login (password with optional authenticator codes; Cloudflare Access is planned), roles, and an audit log.
- **MCP server and Claude skills:** an AI assistant can look up customers, explain why someone does or doesn't have an entitlement, and walk you through App Store and Play Console setup.

**Out of scope for now:** paywalls, ad events, Customer Center, virtual currencies, web billing, Amazon, and third-party analytics integrations. Price experiments are on the [roadmap](ROADMAP.md#later-).

## Two editions

| | Lite | Standard |
|---|---|---|
| Language | TypeScript | Go |
| Runs on | Cloudflare Workers + D1 | Containers + Postgres on GCP or AWS |
| Cost | Designed to fit the Cloudflare free plan | Your cloud bill |
| For | Indie apps: lightweight and cheap to run | Larger portfolios of apps (coming soon) |

Both editions pass the same conformance suite in `spec/`. You can move from Lite to Standard without shipping an app update, as long as your app points at a custom domain you own.

## SDK compatibility

Day one uses the official, unmodified SDKs (all MIT licensed):

| SDK | How to point it at openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Set the proxy URL before calling `configure`. Leave entitlement verification at its default (disabled), because signed responses rely on RevenueCat's own key.

**Known gap on Android:** the SDK sends diagnostics, paywall and ad traffic to three RevenueCat hosts directly, even when a proxy URL is set. openpurr turns diagnostics off through remote config. Don't use RevenueCatUI paywalls or ads on Android with openpurr.

## Planned repo layout

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Getting started

Lite is at 0.1.0, its first release, so expect changes before 1.0. To try it on your own Cloudflare account (the free plan is enough), with Node 22.12 or later:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

The setup is safe to run again if it stops halfway. It ends with a link to the dashboard, which opens on adding your first app: its bundle ID and package name, then products, entitlements and offerings. One deployment can run several apps as separate projects, each with its own customers. Afterwards:

- **Check your setup:** run `npx @openpurr/cli login`, then `npx @openpurr/cli doctor`. It reports what's missing and how to fix each item.
- **Get usage alerts:** add a Cloudflare API token with Account Analytics: Read as the `CLOUDFLARE_ANALYTICS_TOKEN` secret, and the dashboard warns you before the free plan's daily limits stop requests.
- **Back up your data:** `npx pnpm db:backup` exports the database to a file. D1 also keeps 7 days of history on the free plan (30 on Workers Paid).
- **Deploy on every push:** fork the repo and add your Cloudflare details as repository secrets. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) lists them.

Using Claude Code? The [openpurr plugin](plugin/) walks through the same steps, plus App Store Connect and Play Console setup.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Right now the most useful help is feedback in issues: wrong assumptions about the SDKs or the stores, and real-world edge cases.

For anything else, email [hello@openpurr.org](mailto:hello@openpurr.org).

## Star History

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## License

[Apache License 2.0](LICENSE). Copyright 2026 openpurr contributors.
