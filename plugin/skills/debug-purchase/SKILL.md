---
name: debug-purchase
description: Find out why a customer of an app using openpurr does or doesn't have access, why a purchase didn't unlock anything, or why a subscription looks wrong, and fix it (including a temporary grant as a make-good). Use when the user reports a purchase, restore, renewal, refund or entitlement problem for a specific customer.
---

# Debug a purchase

Work from evidence: look the customer up before guessing. Use the openpurr MCP tools when they're connected (`lookup_customer`, `explain_entitlement` and so on). Otherwise use the CLI (`npx openpurr …`, after `npx openpurr login`). They give the same answers. Never ask the user for store credentials or secret keys; you don't need them.

## 1. Identify the customer

You need the app user ID. If the user has an email or a store transaction ID instead, search: `search_customers` or `npx openpurr customers <query>`. A search matches an app user ID prefix (any alias), an exact email, or an exact store transaction ID. If it finds several customers, ask which one; a reinstall without `logIn` creates a new anonymous customer.

## 2. Ask openpurr why

Run `explain_entitlement` (or `npx openpurr explain <app user ID> <entitlement>`). It answers yes or no, and why: which purchase or grant decides it, what happened to each relevant purchase (expired, refunded, auto-renew off, billing problems, sandbox, not verified), and purchases of products no entitlement includes. This alone resolves most cases.

Then, for the full picture, `lookup_customer` (or `npx openpurr customer <app user ID>`): purchases, subscription states, grants and aliases.

## 3. Common causes

| What you see | Likely cause | Fix |
|---|---|---|
| No purchases at all | The app isn't using openpurr (missing `proxyURL`, or set after `configure`), or the purchase is under another app user ID | Check the app's SDK setup (`integrate` skill). Search by transaction ID |
| Purchase present, entitlement missing | The product isn't in that entitlement in the config | Add it under `entitlements` (Play: `pro` for every base plan or `pro:monthly` for one), then deploy |
| Only sandbox purchases | A TestFlight or license-tester build | Expected: sandbox access works in sandbox builds only |
| Subscription expired, but the store says it renewed | Store notifications aren't arriving | `check_setup` / `npx openpurr doctor`; see the `app-store-setup` or `play-setup` skill |
| Google Play purchase pending in the app | Play API access isn't configured, so openpurr refuses the purchase | `play-setup` skill |
| Access on one device, not another | Different app user IDs (no `logIn`, or a different one) | `logIn` with the same ID everywhere. The customer can also restore purchases |
| Access after a refund | The refund hasn't been reported yet | Apple and Google report refunds through notifications, often days later |
| Purchase moved to another user | Restore by a different user ID transferred it (`TRANSFER` event) | Expected behavior, as in RevenueCat |

If the customer's data doesn't match what the store shows, compare with the store's own records (App Store Connect, Play Console order management) before changing anything.

## 4. Make it right

If the customer should have access and the cause will take time to fix, grant the entitlement. This changes what the customer can use, so confirm with the user first, including the duration.

- `grant_entitlement`, or `npx openpurr grant <app user ID> <entitlement> --duration monthly --note "why"` (`--until YYYY-MM-DD` for a fixed end). Durations: daily, three_day, weekly, monthly, two_month, three_month, six_month, yearly, lifetime.
- The app sees it on its next CustomerInfo refresh, as a promotional entitlement (`store: promotional`).
- End it early with `revoke_grant` or `npx openpurr revoke-grant <app user ID> <grant ID>`.

Grants need the developer role or higher, and with MCP the `write:grants` scope. Every grant is in the audit log (`get_audit_log`, `npx openpurr audit`).

## 5. Report back

Summarize for the user: what the customer has, why, what you changed (if anything), and what to fix so it doesn't happen to other customers.
