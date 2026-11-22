# Export bundle, format version 1

An export bundle holds a deployment's data, so it can move between editions (Lite on Cloudflare
D1, Standard on Postgres) with no app update. `openpurr export` (the CLI) writes it through the
export API below; Standard's `openpurr migrate import` loads it into Postgres, and
`openpurr migrate sql` turns it into SQL for a new D1 database. Both editions use the same table
and column names, so rows map one to one.

The how-to is [`docs/migrating-from-lite-to-standard.md`](../docs/migrating-from-lite-to-standard.md).

## Layout

A bundle is a directory:

```
manifest.json                 written last: a directory without one is an unfinished export
tables/<table>.ndjson         one file per table
customer-index.ndjson         deltas only: every customer's ID and ledger version
deleted-customers.ndjson      deltas only: customers that are gone since the previous bundle
```

Files are UTF-8, one JSON object per line (newline-delimited JSON), each line ending in `\n`.

## The manifest

`manifest.json` ([JSON Schema](export-bundle.schema.json)):

| Field | |
|---|---|
| `format` | `"openpurr-export"` |
| `version` | `1`. A reader refuses other versions. A change that an older reader would misread (a renamed table or column, a new meaning) takes a new version; new tables and new columns don't (see "Reading a bundle"). |
| `id` | A random UUID. An importer applies each bundle once. |
| `kind` | `full` (everything) or `delta` (changes since the previous bundle) |
| `created_at` | ISO 8601, the source's clock when the export began |
| `source` | `{ url, edition, schema }`: where it came from, `lite` or `standard`, and the source's last schema migration |
| `started_at_ms` | The source's clock when the export began (epoch ms): the next delta's watermark |
| `since_ms` | Deltas: the watermark they start from, the previous bundle's `started_at_ms` minus 60 seconds (writes in flight, clock skew); `null` for a full bundle |
| `previous_id` | Deltas: the `id` of the bundle this one follows; `null` for a full bundle |
| `options` | `{ optional_columns }`: whether optional columns (raw store notifications) were included |
| `tables` | `[{ name, file, rows, sha256 }]`, in import order |
| `customer_index`, `deleted_customers` | Deltas: `{ file, rows, sha256 }`; `null` for a full bundle |

`sha256` is the lowercase hex SHA-256 of the file's bytes, and `rows` its number of lines. Readers
check both and refuse a bundle that doesn't match.

## Rows

Each line is one row: an object from column name to value, exactly as the source database holds it.

- Integers (epoch-millisecond timestamps, 0/1 flags, IDs) are JSON numbers; floating-point columns
  (`fx_rate.per_usd`) are JSON numbers too.
- Text is a JSON string; JSON held in text columns (config documents, webhook bodies, scopes) stays
  a string.
- SQL NULL is `null`. A row has every column of its table on the source.
- D1 may hold a fraction in an integer column (a device's `updated_at_ms`); Postgres keeps the whole
  part.

## Tables

[`export-tables.json`](export-tables.json) lists the tables, in import order (parents before
children), with each one's primary key, the rows a delta takes, and which belong to a customer.
Both editions' exporters and importers check their lists against it in their tests. In short:

- **Moved:** the config and its history, settings, operators, recovery codes, sessions, personal
  access tokens and secret keys (as SHA-256 hashes), OAuth clients and grants, the audit log,
  customers, aliases, attributes, the ledger (`store_transaction`, `purchase_owner`), store-reported
  subscription status (`subscription_state`), processed store notifications (the raw payload only
  with `--optional`), promotional grants, webhook events and deliveries (pending ones are the
  outbox), Play acknowledgements still to retry, exchange rates, job state, experiments and
  enrollments, and the `new_customers` chart rows.
- **Rebuilt on the target, not moved:** CustomerInfo snapshots (`customer_snapshot`) and the other
  chart totals (`metric_daily`, Standard's `metric_daily_country`), all derived from the ledger.
  `new_customers` moves because it can't be rebuilt: the cleanup job deletes old customers who
  never bought.
  `subscription_state` moves because it isn't derived: it's what Apple and Google last reported
  about renewals, billing problems and grace periods.
- **Left out:** short-lived rows (`login_link`, `oauth_request`), caches (`apple_verified_chain`),
  the spike's `capture` table and each database's own migration bookkeeping.
- **Never in a bundle:** store credentials (the App Store In-App Purchase key, the Google service
  account), webhook secrets and `OPERATOR_SECRET`. They're secrets of the deployment; set them on the
  target. Password hashes and authenticator secrets only work with the same `OPERATOR_SECRET`.

## Deltas

A delta holds what changed after the previous bundle began, so the move can be finished with a
short final step (see the migration guide). For each table, the rows its `delta` filter takes
(`:since` is `since_ms`, `:since_day` its UTC date), the whole table for `"all"`, nothing for
`null`. Merges (an anonymous customer logging in) move rows to another customer without new
timestamps, so on top of that:

- `customer.ndjson` holds the customers that are new or whose `ledger_version` changed, compared
  with the previous bundle (every write that changes a customer's CustomerInfo bumps it);
- the tables with a `customer_column` also hold every row of those customers;
- `deleted-customers.ndjson` lists, as `{"id": …}`, the customers of the previous bundle the source
  no longer has (merged away, or deleted as inactive);
- `customer-index.ndjson` lists every customer as `{"id", "ledger_version"}`, the base of the
  next delta.

Rows a delta can't see: deletions other than customers' (a signed-out session, regenerated
recovery codes, an acknowledged Play purchase), and changes that update no timestamp outside a
customer (an operator's name, a key's name, an experiment's status).

## Reading a bundle

- Check `format`, `version`, every file's row count and checksum, and that every table is one the
  reader knows.
- A column the target table doesn't have is an error (the bundle is from a newer edition), except
  for columns known to belong to the other edition only (Standard's
  `webhook_delivery.claimed_until`, dropped on the way to Lite). A column the bundle lacks gets the
  target's default.
- A full bundle goes into an empty database, all in one transaction. IDs are kept, and identity
  sequences (`store_transaction`, `audit_log`, `config_version`) continue after the largest.
- A delta goes on top of the bundle named by `previous_id`, in one transaction. The newer fact wins:
  rows with an `updated_at` replace the target's only if newer; a webhook delivery only if it has
  more attempts or was delivered; revocations, disabled operators and expiries are kept whichever
  side set them; aliases, purchase owners and grants follow their customer. Rows whose IDs the
  target hands out itself (`store_transaction`, `audit_log`, `config_version`) get new IDs, matched
  on `(store, transaction_id)` or on their content. Customers in `deleted-customers.ndjson` are
  deleted unless purchases or grants on the target still belong to them.
- Then rebuild what's derived: the chart totals in full, and the CustomerInfo snapshots of every
  customer (full) or of the changed ones (delta).

## The export API

Both editions serve it under `/admin/v1`, for owners who see every app (a personal access token
needs the `admin` scope); anyone else gets 403.

- `GET /export`: `{ format, version, edition, schema, now, tables: [{ name, key, delta, customer_column }] }`,
  where `now` is the server's clock and `delta` says whether deltas include the table. `POST` does
  the same and records `data.exported` in the audit log (with `{"since": …}`); the CLI starts an
  export with it.
- `GET /export/tables/{table}?limit=&after=&since=&customers=&optional=`: one page of a table in
  primary-key order, `{ rows, next }`. `next` is the last row's key (a JSON array), passed back as
  `after`; `null` on the last page. `limit` is at most 1000 on Lite (each page stays within a
  Worker's CPU limit and costs about as many D1 row reads as it returns) and 5000 on Standard.
  `since` (epoch ms) applies the table's delta filter; `customers` (up to 100 comma-separated
  customer IDs) returns every row of those customers instead; `optional=1` includes optional
  columns, which are otherwise `null`.
- `GET /export/customer-info?ids=&at=`: for up to 100 customer IDs, `{ at, customers: [{ id,
  project_id, app_user_id, customer_info }] }`, the CustomerInfo body the SDK would get at `at`
  (epoch ms), from the snapshot when it's current, else computed. Unknown IDs are left out.
  `openpurr migrate verify` compares these between two deployments.
