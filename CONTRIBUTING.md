# Contributing to openpurr

Thanks for your interest. openpurr is at an early stage, so the most useful contributions right now are issues and discussion. See [ROADMAP.md](ROADMAP.md) for what's being built and in what order. This guide also sets out the rules code contributions follow.

## Ways to help today

- **Check our assumptions.** Point out wrong assumptions about the RevenueCat SDKs, the App Store or Google Play, or the Cloudflare free plan.
- **Share real-world cases:** store notification sequences, edge cases in renewals, refunds, grace periods or family sharing, or SDK versions that behave differently.

Open an issue before starting large work, so we can agree on the approach first.

## Ground rules

1. **The spec comes first.** Behavior that both editions share is defined in `spec/` (OpenAPI, JSON schemas, fixtures, scenarios). Change the spec, then the code. A pull request that changes `spec/` must keep every edition passing the conformance suite.
2. **SDK compatibility is the product.** Responses must match what the official RevenueCat SDKs expect. When you change an SDK-facing endpoint, include a golden fixture or scenario that shows the expected response.
3. **Lite must fit the Cloudflare free plan.** That means:
   - Stay under 10 ms of CPU per request, with headroom.
   - Stay under 50 D1 queries and 50 subrequests per invocation.
   - Never write on a read path.
   - Don't require Queues, Durable Objects or other paid-only features. Optional Paid-plan paths are fine.

   CI runs typecheck, tests and a bundle-size budget on every pull request (`.github/workflows/ci.yml`). CPU and D1 budget tests will join them.
4. **Keep Cloudflare behind adapters.** Use the `JobQueue`, `Scheduler`, `RateLimiter`, `Secrets` and `OAuthStore` interfaces rather than calling Workers APIs directly from core logic.
5. **Don't use the Apple or Google Node SDKs.** They don't run in Workers. Call Google's REST APIs directly.
6. **Keep the Worker bundle small.** Every fresh Worker isolate pays to load the bundle, out of the same 10 ms CPU budget as the request. An ASN.1 library alone cost about 5 ms.
   - Verify certificates and JWS signatures with WebCrypto and the DER reader in `lite/src/lib/der.ts`. Sign JWTs with WebCrypto.
   - Don't add runtime dependencies without measuring their load cost. Libraries are fine in `devDependencies`, tests and scripts.
7. **Never leak secrets.** No store credentials, API keys or tokens in logs, admin API responses, MCP tool output or export bundles.
8. **Stay in scope.** Paywalls, ad events and the rest of the README's "Out of scope for now" list are out of scope. Open an issue before working on them.

## Development setup

**Lite (`lite/`):** Node 24 (see `.nvmrc`) and pnpm 12 (pinned in `package.json`; `corepack enable` or `npx pnpm@12.21.0`).

```sh
nvm use
pnpm install
pnpm test          # Vitest inside the Workers runtime (workerd)
pnpm typecheck
pnpm check:bundle  # production bundle stays under its size budget
cp lite/.dev.vars.example lite/.dev.vars
cp lite/openpurr.config.example.yaml lite/openpurr.config.yaml   # apps, products, entitlements, offerings
pnpm --filter @openpurr/lite db:migrate:local
pnpm dev           # wrangler dev
```

Tests and typecheck fall back to the example config, so they work without your own `openpurr.config.yaml`. `wrangler dev` and deploys require it, and validate it first.

Use pnpm, not npm. npm 10 and 11 crash on vitest's peer dependencies. pnpm also refuses packages published in the last 24 hours; keep new pins at least a week old.

**Standard (`standard/`):** Go (latest stable) and Docker for Postgres. Not started yet; see [ROADMAP.md](ROADMAP.md).

**Conformance (`spec/conformance/`):** runs against a local edition over HTTP. Coming with the App Store work in Lite v1.

## Pull requests

- Keep each pull request focused on one change.
- Add or update tests:
  - unit tests for logic;
  - scenarios or fixtures for store and SDK behavior;
  - a migration with both SQLite and Postgres variants for schema changes.
- Update the docs when behavior changes.
- Describe what you tested. For store integrations, say whether you used sandbox, replayed notifications or the simulator.
- Don't include real customer data, receipts or credentials in fixtures. Scrub them, or record them from sandbox accounts.

## Reporting security issues

Please don't open public issues for vulnerabilities. Report them privately through GitHub's vulnerability reporting, as described in [SECURITY.md](SECURITY.md).

## License

openpurr is licensed under the [Apache License 2.0](LICENSE). Contributions you submit are licensed under the same terms, as described in section 5 of the license.
