# Roadmap

A high-level view of where openpurr is going. The order is firm, but there are no dates, and scope may shift as we learn. If something here matters to you, say so in an issue.

**Status key:** ✅ done · 🚧 in progress · ⏳ planned

## Phase 0: Prototype 🚧

Prove that the unmodified RevenueCat SDKs work against a server we control, within Cloudflare's free plan.

- ✅ **Stub server:** answers every endpoint the iOS and Android SDKs call at startup and during a purchase.
- ✅ **Deployed:** running on a free Cloudflare account.
- ✅ **Store crypto fits:** Apple signature checks and store token signing fit the free plan's CPU limit, measured locally.
- 🚧 **Workers CPU:** measuring per-request CPU time on Workers.
- 🚧 **Device runs:** running the iOS and Android purchase tester apps against it.

## Lite edition v1 🚧

The lightweight edition for indie apps: TypeScript on Cloudflare Workers and D1, designed to run on the free plan.

1. **App Store:** StoreKit 2 purchase validation, entitlements, offerings, App Store Server Notifications, and public and secret API keys.
2. **Google Play:** purchase validation and acknowledgement, Real-time Developer Notifications, and refund detection.
3. **Webhooks:** RevenueCat-shaped events sent to your backend, signed, retried and replayable.
4. **Dashboard and admin:**
   - operator sign-in (password with optional authenticator codes, or Cloudflare Access);
   - roles, access tokens and an audit log;
   - light charts (active subscriptions, MRR, trials, conversions, churn).
5. **Cloudflare packaging:** a guided setup from zero to a sandbox purchase, backup guidance, and usage alerts before you hit free-plan limits.
6. **MCP server:** ask an AI assistant why a customer does or doesn't have an entitlement, look up purchases, and grant access. Works from Claude Code and as a Claude.ai connector.
7. **CLI and Claude skills:** `npx openpurr` for setup and checks, plus skills that walk you through App Store Connect and Play Console configuration.

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
