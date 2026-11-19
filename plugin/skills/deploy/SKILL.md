---
name: deploy
description: Deploy openpurr Lite to the user's own Cloudflare account (two Workers and a D1 database on the free plan), create the first owner, and connect Claude to the back office. Use when the user wants to install, deploy, set up, upgrade or redeploy openpurr, or asks why a deploy failed.
---

# Deploy openpurr Lite

openpurr Lite is two Cloudflare Workers sharing one D1 database:

- **SDK Worker** (`openpurr`): serves `/v1`, the API the RevenueCat SDKs call. Your app's `proxyURL` points here.
- **Back office** (`openpurr-office`): the dashboard, store notifications (`/notifications/apple`, `/notifications/google`), the admin API, the MCP server (`/mcp`) and the scheduled jobs.

Everything fits Cloudflare's free plan. Work from the repo's `lite/` directory unless a step says otherwise.

## Before you start

Check, and tell the user what's missing:

- Node 20 or later (`node -v`) and pnpm (`npx -y pnpm@latest -v` works without installing it).
- A Cloudflare account, signed in: `npx wrangler whoami`. If not signed in, ask the user to run `! npx wrangler login` themselves (it opens a browser).
- A clone of github.com/openpurr/openpurr, then `pnpm install` at the repo root.

## Quick path: guided setup

`pnpm run setup` (in `lite/`) does the whole first deploy below in one go: it asks for the bundle ID and package name, writes `openpurr.config.yaml` with fresh SDK keys, creates the database, applies migrations, deploys both Workers, generates and sets `OPERATOR_SECRET` without printing it, and creates the first owner. It's safe to rerun; finished steps are skipped. It asks questions, so ask the user to run it themselves: `! cd lite && pnpm run setup`. Then go to "Check and connect". Use the steps below when the user wants to see each one, or when the setup stops with an error.

## First deploy

Run these one at a time, and stop to fix anything that fails. Never print or echo secret values.

1. **Create the database.** `npx wrangler d1 create openpurr`. Nothing to copy: `wrangler.jsonc` finds the database by name. If wrangler offers to add the binding or writes a `database_id` into `wrangler.jsonc`, decline or discard that change.
2. **Write the config.** `cp openpurr.config.example.yaml openpurr.config.yaml`, then edit it with the user: their apps (bundle ID, package name), products, entitlements and offerings. Generate each SDK key as `appl_` or `goog_` plus at least 32 random characters, for example `node -e "console.log('appl_' + require('crypto').randomBytes(24).toString('base64url'))"`. SDK keys ship inside the app, so they're identifiers, not secrets. Store credentials never go in this file. The deploy validates it and says what's wrong.
3. **Apply the migrations.** `pnpm db:migrate:remote`.
4. **Set the operator secret** on the back office. It signs sessions and peppers passwords. Ask the user to run it, so the value never passes through this conversation:
   `! openssl rand -base64 48 | npx wrangler secret put OPERATOR_SECRET --env office`
   If they later change it, existing passwords stop working, and everyone has to sign in again with a login link.
5. **Deploy both Workers.** `pnpm run deploy && pnpm deploy:office`. Note the two `*.workers.dev` URLs wrangler prints.
6. **Create the first owner.** `pnpm admin create --email <their email> --name "<their name>" --role owner --url https://<back office URL>`. It prints a one-time setup link (valid 24 hours). The user opens it, sets a password and, ideally, two-step sign-in.
7. **Check the setup.** See "Check and connect" below.

Then set up the stores: the `app-store-setup` and `play-setup` skills. Then point the app at the SDK Worker: the `integrate` skill.

## Deploy from GitHub Actions (optional)

Instead of deploying from a laptop, a fork of the repo can deploy itself on every push to `main` with `.github/workflows/lite-deploy.yml`. It applies migrations, then deploys both Workers. Do the first deploy above first (or at least steps 1, 2 and 4), then in the fork's Settings → Secrets and variables → Actions, add:

- `CLOUDFLARE_API_TOKEN`: a token with Workers Scripts: Edit and D1: Edit (plus Zone: Workers Routes: Edit and DNS: Edit for custom domains).
- `CLOUDFLARE_ACCOUNT_ID`.
- `OPENPURR_CONFIG_YAML`: the whole contents of `openpurr.config.yaml`, which isn't committed.
- Optional: `OPENPURR_WORKER_NAME`, `OPENPURR_D1_DATABASE_NAME`, `OPENPURR_D1_DATABASE_ID`, `OPENPURR_SDK_DOMAIN`, `OPENPURR_OFFICE_DOMAIN` (see `lite/scripts/deploy-config.mjs`).

Worker secrets such as `OPERATOR_SECRET` stay in Cloudflare; deploys don't change them. Run the workflow once by hand (Actions → Deploy Lite → Run workflow) to check the secrets.

## Custom domains (recommended)

The `workers.dev` URLs work, but a custom domain is easier to keep if the account changes. In the Cloudflare dashboard: Workers & Pages → each Worker → Settings → Domains & Routes → add a custom domain (for example `purchases.example.com` for the SDK Worker and `office.example.com` for the back office). Use the custom domains for the app's `proxyURL` and the store notification URLs.

## Check and connect

Once the owner can sign in:

- **CLI:** in the dashboard, Developers → Access tokens, create a token. Then `npx openpurr login --url https://<back office>` (it prompts for the token) and `npx openpurr doctor`. Every problem comes with its fix.
- **MCP (lets Claude use the openpurr tools directly):** `claude mcp add --transport http openpurr https://<back office>/mcp`. Claude Code then signs in through the dashboard with OAuth; the user approves the connection on the consent page. After that, the `check_setup` tool runs the same checks as `openpurr doctor`.

Walk through each failing or warning check and apply its fix.

## Upgrading

After pulling a new version: `pnpm db:backup`, `pnpm install`, then `pnpm db:migrate:remote`, then `pnpm run deploy && pnpm deploy:office`. Migrations always go first: the new code expects the new tables. `openpurr doctor` reports migrations that are behind (Database check).

## Backups

- **Time Travel:** D1 keeps point-in-time history, 7 days on the free plan and 30 on Workers Paid. `npx wrangler d1 time-travel restore openpurr --timestamp=<ISO time>` overwrites the database in place and prints a bookmark that undoes it. Confirm with the user before restoring.
- **File backups:** `pnpm db:backup` exports everything to `lite/backups/` (git-ignored). The file holds customer data; tell the user to keep it private and encrypted, never in a repo. Suggest one before every upgrade and on a regular schedule.
- **Restoring a file:** into a new database (`npx wrangler d1 create openpurr-restored`, then `npx wrangler d1 execute openpurr-restored --remote --file <file>`), then point the deployment at it with `OPENPURR_D1_DATABASE_NAME`, or by changing `database_name` in `wrangler.jsonc`, and deploy.
- **Size:** `openpurr doctor` warns at 75% of the free plan's 500 MB per database.

## When a deploy fails

- **Config errors** (`openpurr.config.yaml`): the message names the field. Fix it and deploy again.
- **Bundle size:** the SDK Worker has a budget so cold starts stay fast. Only contributors changing code hit this.
- **`Authentication error`:** wrangler isn't signed in, or into the wrong account. `npx wrangler whoami`.
- **The dashboard says the operator secret is missing:** step 4 was skipped, or set without `--env office`.

## Local development

`pnpm db:migrate:local`, then `npx wrangler dev --env office` for the back office (dashboard at http://localhost:8787) and `pnpm dev` for the SDK Worker. `pnpm admin create --local --email … --name … --role owner` creates a local owner. `pnpm demo:data` fills a local database with a realistic demo business; never run it against production.
