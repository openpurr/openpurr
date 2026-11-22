-- Keeps a background snapshot rebuild from saving stale CustomerInfo (src/snapshot.ts).
--
-- Every write that changes what a customer's CustomerInfo shows bumps customer.ledger_version in
-- its batch. A rebuild reads the version along with the ledger, and saves its snapshot only if
-- the version is still the same; a snapshot is served only if its version matches the
-- customer's. A write landing between a rebuild's read and its save therefore wins.
--
-- Existing snapshots start at 0 like their customers, so they stay valid.
ALTER TABLE customer ADD COLUMN ledger_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_snapshot ADD COLUMN ledger_version INTEGER NOT NULL DEFAULT 0;
