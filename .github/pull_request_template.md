<!-- What changes, and why. Link the issue if there is one (for example "Fixes #12"). -->



## Tested

<!-- What you ran or tried. For store integrations, say whether you used sandbox, replayed notifications or the simulator. -->



## Checklist

- [ ] One focused change.
- [ ] Tests added or updated: unit tests for logic, scenarios or fixtures for store and SDK behavior.
- [ ] SDK-facing changes include a golden fixture or scenario, and `spec/` changes keep the conformance suite passing.
- [ ] Schema changes have a migration with both SQLite and Postgres variants.
- [ ] Lite still fits the free plan: no new runtime dependencies without measuring their load cost, no writes on a read path.
- [ ] Docs, CLI help and plugin skills updated if behavior changed.
- [ ] No real customer data, receipts, keys or credentials in code, fixtures or logs.
