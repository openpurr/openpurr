---
name: deploy
description: Deploy openpurr Lite to the user's own Cloudflare account (two Workers and a D1 database on the free plan), create the first owner, and connect Claude to the back office. Use when the user wants to install, deploy, set up, upgrade or redeploy openpurr, or asks why a deploy failed.
---

# Deploy openpurr Lite

openpurr Lite is two Cloudflare Workers sharing one D1 database:

- **SDK Worker** (`openpurr`): serves `/v1`, the API the RevenueCat SDKs call. Your app's `proxyURL` points here.
- **Back office** (`openpurr-office`): the dashboard, store notifications (`/notifications/apple`, `/notifications/google`), the admin API, the MCP server (`/mcp`) and the scheduled jobs.

The config (projects, apps, SDK keys, products, entitlements, offerings, webhooks) lives in the database, not in a file: it's edited in the dashboard (Configuration), with `openpurr config pull` / `push`, or with the MCP tools `get_config` and `save_config`. A project is one title; a deployment can hold several, and each has its own customers. Changes need no deploy: the SDK Worker picks them up within a minute.

Everything fits Cloudflare's free plan. Work from the repo's `lite/` directory unless a step says otherwise.

## Before you start

Check, and tell the user what's missing:

- Node 20 or later (`node -v`) and pnpm (`npx -y pnpm@latest -v` works without installing it).
- A Cloudflare account, signed in: `npx wrangler whoami`. If not signed in, ask the user to run `! npx wrangler login` themselves (it opens a browser).
- A clone of github.com/openpurr/openpurr, then `pnpm install` at the repo root.

## Quick path: guided setup

`pnpm run setup` (in `lite/`) does the whole first deploy below in one go: it creates the database, applies migrations, deploys both Workers, generates and sets `OPERATOR_SECRET` without printing it, and creates the first owner. The owner's setup link opens the dashboard, which starts with adding the first app (bundle ID, package name) and shows its SDK keys. It's safe to rerun; finished steps are skipped. It asks questions, so ask the user to run it themselves: `! cd lite && pnpm run setup`. Then go to "Check and connect". Use the steps below when the user wants to see each one, or when the setup stops with an error.

## First deploy

Run these one at a time, and stop to fix anything that fails. Never print or echo secret values.

1. **Create the database.** `npx wrangler d1 create openpurr`. Nothing to copy: `wrangler.jsonc` finds the database by name. If wrangler offers to add the binding or writes a `database_id` into `wrangler.jsonc`, decline or discard that change.
2. **Apply the migrations.** `pnpm db:migrate:remote`.
3. **Set the operator secret** on the back office. It signs sessions and peppers passwords. Ask the user to run it, so the value never passes through this conversation:
   `! openssl rand -base64 48 | npx wrangler secret put OPERATOR_SECRET --env office`
   If they later change it, existing passwords stop working, and everyone has to sign in again with a login link.
4. **Deploy both Workers.** `pnpm run deploy && pnpm deploy:office`. Note the two `*.workers.dev` URLs wrangler prints.
5. **Create the first owner.** `pnpm admin create --email <their email> --name "<their name>" --role owner --url https://<back office URL>`. It prints a one-time setup link (valid 24 hours). The user opens it, sets a password and, ideally, two-step sign-in.
6. **Add the apps.** The dashboard opens on adding the first app: the user enters the bundle ID and/or package name and gets an SDK key per app. Then, under Configuration, the products (exactly as in App Store Connect and Play Console), an entitlement they unlock, and an offering if the paywall uses one. If you're connected (MCP or CLI), you can do this for them; see "Changing the config" below.
7. **Check the setup.** See "Check and connect" below.

Then set up the stores: the `app-store-setup` and `play-setup` skills. Then point the app at the SDK Worker: the `integrate` skill.

## Deploy from GitHub Actions (optional)

Instead of deploying from a laptop, a fork of the repo can deploy itself on every push to `main` with `.github/workflows/lite-deploy.yml`. It applies migrations, then deploys both Workers. In the fork's Settings → Secrets and variables → Actions, add:

- `CLOUDFLARE_API_TOKEN`: a token with Workers Scripts: Edit and D1: Edit (plus Zone: Workers Routes: Edit and DNS: Edit for custom domains).
- `CLOUDFLARE_ACCOUNT_ID`.
- Optional: `OPENPURR_WORKER_NAME`, `OPENPURR_D1_DATABASE_NAME`, `OPENPURR_D1_DATABASE_ID`, `OPENPURR_SDK_DOMAIN`, `OPENPURR_OFFICE_DOMAIN` (see `lite/scripts/deploy-config.mjs`).

The first run creates the database. Then set `OPERATOR_SECRET` (step 3) and create the owner (step 5).

Worker secrets such as `OPERATOR_SECRET` stay in Cloudflare; deploys don't change them. Run the workflow once by hand (Actions → Deploy Lite → Run workflow) to check the secrets.

## Changing the config

Apps, products, entitlements, offerings and webhooks are one JSON document per deployment, `{"version": 2, "projects": {"<id>": {"name", "apps", "entitlements", "offerings", "webhooks"}}}`, saved as versions (Configuration → Projects shows the history, and any version can be restored).

- **With MCP:** `get_config` returns the document and its `version_id`; `save_config` takes the edited `document`, that `base_id` and a short `note`. It needs the admin token scope (admins and owners).
- **With the CLI:** `npx @openpurr/cli config pull > config.json`, edit, `npx @openpurr/cli config push config.json --note "…"`.

Change only what the user asked for and keep everything else as it is. A save is refused, with every problem listed, if the document is invalid; if someone saved in between (pull or get it again and redo the edit); if an app would move to another project; or if a project with customers would disappear. New SDK keys are `appl_` (App Store) or `goog_` (Google Play) plus at least 32 random letters and digits, for example `node -e "console.log('appl_' + require('crypto').randomBytes(24).toString('base64url').replace(/[-_]/g, 'x'))"`. They ship inside the app, so they're identifiers, not secrets. Store credentials never go in the config, only the names of the Worker secrets that hold them.

An `openpurr.config.yaml` in `lite/` (see `openpurr.config.example.yaml`) is optional: a new deployment imports it once, as the project `default`, and ignores it after that.

## Custom domains (recommended)

The `workers.dev` URLs work, but a custom domain is easier to keep if the account changes. In the Cloudflare dashboard: Workers & Pages → each Worker → Settings → Domains & Routes → add a custom domain (for example `purchases.example.com` for the SDK Worker and `office.example.com` for the back office). Use the custom domains for the app's `proxyURL` and the store notification URLs.

## Check and connect

Once the owner can sign in:

- **CLI:** in the dashboard, Developers → Access tokens, create a token. Then `npx @openpurr/cli login --url https://<back office>` (it prompts for the token) and `npx @openpurr/cli doctor`. Every problem comes with its fix.
- **MCP (lets Claude use the openpurr tools directly):** `claude mcp add --transport http openpurr https://<back office>/mcp`. Claude Code then signs in through the dashboard with OAuth; the user approves the connection on the consent page. After that, the `check_setup` tool runs the same checks as `openpurr doctor`.

Walk through each failing or warning check and apply its fix.

**Usage alerts (recommended on the free plan):** the free plan allows 100,000 Workers requests and 100,000 D1 rows written a day per account; past that, requests fail until 00:00 UTC and purchases stay queued on devices. To get warnings from 75% (in the dashboard, Settings → Daily usage, and in `doctor`), the user creates a Cloudflare API token with **Account Analytics: Read** (My Profile → API Tokens) and sets it on the back office: `! npx wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN --env office`. If the token can reach several accounts, also set `CLOUDFLARE_ACCOUNT_ID` the same way. On Workers Paid, set the plan in Settings instead.

## Upgrading

After pulling a new version: `pnpm db:backup`, `pnpm install`, then `pnpm db:migrate:remote`, then `pnpm run deploy && pnpm deploy:office`. Migrations always go first: the new code expects the new tables. `openpurr doctor` reports migrations that are behind (Database check).

## Backups

- **Time Travel:** D1 keeps point-in-time history, 7 days on the free plan and 30 on Workers Paid. `npx wrangler d1 time-travel restore openpurr --timestamp=<ISO time>` overwrites the database in place and prints a bookmark that undoes it. Confirm with the user before restoring.
- **File backups:** `pnpm db:backup` exports everything to `lite/backups/` (git-ignored). The file holds customer data; tell the user to keep it private and encrypted, never in a repo. Suggest one before every upgrade and on a regular schedule.
- **Restoring a file:** into a new database (`npx wrangler d1 create openpurr-restored`, then `npx wrangler d1 execute openpurr-restored --remote --file <file>`), then point the deployment at it with `OPENPURR_D1_DATABASE_NAME`, or by changing `database_name` in `wrangler.jsonc`, and deploy.
- **Size:** `openpurr doctor` warns at 75% of the free plan's 500 MB per database.

## When a deploy fails

- **Config file errors:** only with an `openpurr.config.yaml`, which the deploy validates. The message names the field; fix it, or delete the file and use the dashboard.
- **Bundle size:** the SDK Worker has a budget so cold starts stay fast. Only contributors changing code hit this.
- **`Authentication error`:** wrangler isn't signed in, or into the wrong account. `npx wrangler whoami`.
- **The dashboard says the operator secret is missing:** step 3 was skipped, or set without `--env office`.

## Local development

`pnpm db:migrate:local`, then `npx wrangler dev --env office` for the back office (dashboard at http://localhost:8787) and `pnpm dev` for the SDK Worker. `pnpm admin create --local --email … --name … --role owner` creates a local owner. `pnpm demo:data` fills a local database with a realistic demo business, using the local config's products (add them in the dashboard first); never run it against production.
