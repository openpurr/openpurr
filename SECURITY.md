# Security Policy

openpurr handles purchase records, store credentials and API keys, so we take security reports seriously. Thank you for helping keep openpurr and its users safe.

## Reporting a vulnerability

**Please don't report security issues in public issues, discussions or pull requests.**

Report them privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**, or use [this link](https://github.com/openpurr/openpurr/security/advisories/new). Only the maintainers can see the report.

Please include:

- **Affected code:** which edition and component are affected (for example, the Lite edition's receipt validation or the admin API), and the commit or version.
- **What you found:** a description of the issue, and what an attacker could do with it.
- **How to reproduce it:** steps or a proof of concept. Requests and responses are especially helpful.
- **Your environment:** for example, a free or paid Cloudflare plan, and which SDK version.
- **Credit:** whether, and how, you'd like to be credited.

Please use test data. Don't include real customer data, receipts, store credentials or API keys in your report.

## What to expect

openpurr is maintained by a small team, so these are targets, not guarantees:

- **Acknowledgement** within 5 business days.
- **An initial assessment** within 10 business days: whether we can reproduce the issue, how severe it is, and the next steps.
- **Updates** at least every two weeks until the issue is resolved.
- **Coordinated disclosure:** we'll agree a disclosure date with you, normally within 90 days of the report and sooner once a fix ships. We publish fixes with a GitHub security advisory, and credit you unless you'd rather stay anonymous.

There is no bug bounty.

## Supported versions

openpurr hasn't had a first release yet. Until it does, security fixes go to the `main` branch only. Once releases begin, this section will list which versions receive fixes.

## Scope

**In scope:** code in this repository, including:

- the Lite edition (`lite/`) and the Standard edition (`standard/`);
- the CLI, Claude skills and MCP server;
- deployment templates.

Examples of issues we especially want to hear about:

- reading or changing another app user's CustomerInfo or entitlements beyond what the public-key threat model allows (see below);
- forged or replayed purchases, store notifications or webhooks being accepted;
- bypassing operator authentication, roles, access-token scopes or Cloudflare Access verification;
- store credentials, API keys, tokens or password hashes leaking through logs, admin API responses, MCP tool output or exports;
- requests that predictably push a free-plan deployment over its limits in a way rate limits don't stop.

**Out of scope:**

- **RevenueCat's own services and SDKs.** Report those to RevenueCat.
- **Cloudflare, Apple, Google and other platform vulnerabilities.** Report those to the vendor. If one affects openpurr deployments, we'd still like to know.
- **Issues that need an already compromised operator account, Cloudflare account or server.**
- **Deployments that ignore the documented setup,** such as committing secrets or disabling verification.
- **Volumetric denial of service.**
- **Missing hardening headers or best-practice findings** with no demonstrated impact. Feel free to open a regular issue for these.

### The public-key threat model

Like RevenueCat, openpurr gives apps a public SDK key that ships inside the app. Anyone who has that key and a user's app user ID can read that user's CustomerInfo. This is a known, documented limitation, not a vulnerability. We recommend random, non-guessable app user IDs. Reports showing access *beyond* this model are in scope.

## Safe harbor

We won't pursue or support legal action against anyone who researches and reports vulnerabilities in good faith under this policy. That means you:

- test only against deployments you own, or that you have permission to test;
- avoid privacy violations, data destruction and service disruption;
- don't access, change or keep data that isn't yours beyond the minimum needed to show the issue;
- give us reasonable time to fix the issue before disclosing it.

If you're unsure whether something is in scope or allowed, ask in your private report first.
