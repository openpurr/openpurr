// llms.txt (https://llmstxt.org): a plain-text summary of openpurr for AI assistants, with links to
// the details. Keep it factual and in step with the homepage and the README.
import type { APIRoute } from "astro";
import { CONTRIBUTING_URL, LICENSE_URL, MIGRATION_GUIDE_URL, MIGRATION_PAGE, RELEASE, REPO_URL, ROADMAP_URL } from "../consts";

export const GET: APIRoute = ({ site }) => {
  const text = `# openpurr

> openpurr is a self-hosted, open-source RevenueCat alternative. It's a backend for App Store and Google Play in-app purchases and subscriptions that works with the official, unmodified RevenueCat Purchases SDK: you set the SDK's proxy URL to your own openpurr server, and the rest of your purchase code stays the same. Free under the Apache 2.0 license, with no revenue share.

Latest release: ${RELEASE.version} (${RELEASE.date}). openpurr is early: the Lite edition is usable and in testing, and it isn't yet recommended for production. It's independent and not affiliated with RevenueCat, Inc.

## What it does

- Validates StoreKit 2 transactions and Google Play purchases, and returns the CustomerInfo and entitlements the Purchases SDK expects (iOS, Android, Flutter, React Native).
- Receives App Store Server Notifications V2 and Google Play Real-time Developer Notifications, so renewals, refunds, grace periods and billing problems stay current.
- Sends RevenueCat-shaped webhooks to your backend, signed with HMAC-SHA256 and retried for about 72 hours.
- Dashboard with 16 charts: revenue, MRR and ARR, MRR and subscription movement, active and paid subscriptions, subscription status, churn, trials and trial conversion, new customers, refunds and refund rate, one-time purchases.
- Several apps (projects) in one deployment; config edited in the dashboard, with versions and rollback.
- Operator sign-in with authenticator codes, roles, access tokens, secret keys and an audit log.
- MCP server, a CLI (\`openpurr\`, on npm as @openpurr/cli) and Claude skills for setup and debugging purchases.

## Editions

- Lite: TypeScript on Cloudflare Workers and D1, designed to fit Cloudflare's free plan (100,000 requests a day), with usage alerts before the limits. Available now.
- Standard: Go and Postgres in containers on GCP or AWS. Planned. Both editions pass the same conformance suite; with a custom domain, moving from Lite to Standard needs no app update.

## Not included (for now)

Paywalls, third-party analytics integrations, Customer Center, virtual currencies, web billing, Amazon Appstore, ad events, and a commercial support contract. Price experiments are on the roadmap.

## Links

- [Source code and README](${REPO_URL}): what it is, quick start and setup
- [Migrating from RevenueCat](${new URL(MIGRATION_PAGE, site)}): how moving an app from RevenueCat to openpurr works, and what moves
- [Migration guide](${MIGRATION_GUIDE_URL}): every step and command, including the customer import
- [Roadmap](${ROADMAP_URL}): what's done and what's next
- [Releases](${REPO_URL}/releases): release notes
- [Contributing](${CONTRIBUTING_URL}): how the code is organized, and how to run and test it
- [License](${LICENSE_URL}): Apache 2.0
- [Website](${new URL("/", site)}): overview and FAQ
- [Privacy](${new URL("/privacy/", site)}): what the website and the software collect
`;
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
