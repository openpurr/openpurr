# @openpurr/cli

The command line for [openpurr](https://openpurr.org), a self-hosted, open-source RevenueCat alternative.

**openpurr** is a backend for App Store and Google Play in-app purchases and subscriptions that you run yourself. It works with the official, unmodified RevenueCat Purchases SDK (iOS, Android, Flutter and React Native): you point the SDK at your own openpurr server, and the rest of your purchase code stays the same. It validates purchases, tracks entitlements, receives store notifications, sends webhooks to your backend and charts your subscription metrics. It's free under the Apache 2.0 license, with no revenue share. The Lite edition runs on Cloudflare Workers and D1 and is designed to fit Cloudflare's free plan.

This package is openpurr's companion CLI. It doesn't run a server. Instead it connects to an openpurr deployment you've already set up, so you can check that the deployment is configured correctly, look up customers, see why someone does or doesn't have an entitlement, grant access, read charts, edit the config and manage keys and your team from the terminal. To deploy openpurr itself, start with the [main repository](https://github.com/openpurr/openpurr).

## Install

Requires Node.js 20 or later.

```sh
npm install -g @openpurr/cli
openpurr --help
```

Or run it without installing:

```sh
npx @openpurr/cli --help
```

## Sign in

Create a personal access token in your openpurr dashboard (**Developers → Access tokens**), then:

```sh
openpurr login --url https://<your back office>   # prompts for the token
openpurr doctor                                   # checks the setup; every problem comes with the fix
```

The token is saved in `~/.config/openpurr/credentials.json` (readable only by you). Use `--profile NAME` to keep several deployments, or set `OPENPURR_URL` and `OPENPURR_TOKEN` in CI and scripts.

## Examples

```sh
openpurr customers jane@example.com           # search by app user ID, email or transaction ID
openpurr explain user_123 pro                 # why they do or don't have the "pro" entitlement
openpurr grant user_123 pro --duration monthly --note "Support refund"
openpurr metrics mrr --from 2026-01-01 --interval month
openpurr config pull > config.json            # edit, then:
openpurr config push config.json --note "Add yearly plan"
openpurr webhooks --status failed             # then: openpurr webhooks replay EVENT_ID
openpurr keys create "Backend"                # a secret key for your server
```

Add `--json` to any command for machine-readable output, and `--project ID` when the deployment has several projects (apps or titles).

## Commands

| | |
|---|---|
| **Getting started** | `login`, `logout`, `whoami`, `doctor` |
| **Customers** | `customers`, `customer`, `explain`, `grant`, `revoke-grant` |
| **Charts and config** | `metrics` (revenue, MRR, ARR, churn, trials, refunds and more), `config`, `config pull` / `push` / `history` / `restore` |
| **Operations** | `webhooks`, `webhooks replay`, `audit`, `keys`, `team` |

Run `openpurr --help` for every option.

The CLI is a thin client. Most commands use the same MCP tools that an AI assistant connected to your deployment uses, so both give the same answers. Secret keys and the team go through the admin API, so secrets never pass through MCP.

## Links

- [openpurr on GitHub](https://github.com/openpurr/openpurr): source, setup and documentation
- [Website](https://openpurr.org)
- [Roadmap](https://github.com/openpurr/openpurr/blob/main/ROADMAP.md)
- [Issues](https://github.com/openpurr/openpurr/issues)

openpurr is an independent project, not affiliated with or endorsed by RevenueCat, Inc.

## License

Apache 2.0
