# Roadmap

A high-level view of where openpurr is going. The order is firm, but there are no dates, and scope may shift as we learn. If something here matters to you, say so in an issue.

**Status key:** ✅ done · 🚧 in progress · ⏳ planned

**Latest release:** [0.1.0](https://github.com/openpurr/openpurr/releases/tag/v0.1.0), the first release of the Lite edition.

## Phase 0: Prototype 🚧

Prove that the unmodified RevenueCat SDKs work against a server we control, within Cloudflare's free plan.

- ✅ **Stub server:** answers every endpoint the iOS and Android SDKs call at startup and during a purchase.
- ✅ **Deployed:** running on a free Cloudflare account.
- ✅ **Store crypto fits:** Apple signature checks and store token signing fit the free plan's CPU limit, measured locally.
- 🚧 **Workers CPU:** measured locally (about 7.5 ms for a fresh isolate's first request); still to confirm on Workers, against the free plan's 10 ms.
- 🚧 **Device runs:** sandbox purchases with the iOS and Android purchase tester apps against a real deployment. Until then, testing uses recorded and simulated SDK traffic.

## Lite edition v1 🚧

The lightweight edition for indie apps: TypeScript on Cloudflare Workers and D1, designed to run on the free plan. Released as 0.1.0; 1.0 follows the device runs above and the items still open below.

1. ✅ **App Store:** StoreKit 2 purchase validation (and StoreKit 1 receipts through the App Store Server API), entitlements, offerings, App Store Server Notifications, and public and secret API keys.
2. ✅ **Google Play:** purchase validation and acknowledgement, Real-time Developer Notifications, and refund detection.
3. ✅ **Webhooks:** RevenueCat-shaped events sent to your backend, signed, retried and replayable.
4. **Dashboard and admin:**
   - ✅ operator sign-in with a password and optional authenticator codes;
   - ⏳ sign-in with Cloudflare Access;
   - ✅ roles, access tokens and an audit log;
   - ✅ charts: 16, from revenue and MRR to trials, churn, refunds and subscription status;
   - ✅ projects: several apps in one deployment, each with its own customers, edited in the dashboard with history and rollback.
5. **Cloudflare packaging:**
   - ✅ a guided setup (`pnpm run setup`) and deploys from GitHub Actions;
   - ✅ backups (`pnpm db:backup`, plus D1's own history);
   - ✅ usage alerts before you hit free-plan limits: daily Workers requests, D1 rows read and written, and the database size, in the dashboard and `openpurr doctor`;
   - ⏳ a Deploy to Cloudflare button.
6. ✅ **MCP server:** ask an AI assistant why a customer does or doesn't have an entitlement, look up purchases, grant access and change the configuration. Works from Claude Code and as a Claude.ai connector.
7. ✅ **CLI and Claude skills:** `npx openpurr` for setup and checks, plus skills that walk you through App Store Connect and Play Console configuration.

## Standard edition (coming soon) ⏳

For larger portfolios of apps: Go and Postgres in containers on your own cloud.

- **Same behavior:** the same API and the same behavior as Lite, checked by a shared conformance suite.
- **Clouds:** GCP first, then AWS.
- **Moving from Lite to Standard:** a tested migration that needs no app update, provided your app points at a custom domain you own.

## Later ⏳

Ideas we expect to pick up based on demand:
- **Verified end-user identity**, so customer data can't be read with only a guessable app user ID.
- **Standard extras** for larger teams.

## Not planned for now

See "Out of scope for now" in the [README](README.md). Open an issue if you think something there should move onto this roadmap.
