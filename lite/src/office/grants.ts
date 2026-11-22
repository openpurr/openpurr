// Promotional grants: giving a customer an entitlement without a purchase (support, testing,
// partners, make-goods). Used by the admin API, the dashboard and the MCP server.
//
// A grant is part of the ledger (promotional_grant, migration 0016): CustomerInfo shows it the
// way RevenueCat does (src/customer-info.ts). Granting or revoking deletes the customer's
// CustomerInfo snapshot in the same batch, and the caller rebuilds it afterwards, so the SDK
// sees the change on its next fetch. Every change is in the audit log.

import type { Config, ProjectConfig } from "../config";
import { findCustomer } from "../ledger";
import { invalidateSnapshot, refreshSnapshot } from "../snapshot";
import { audit } from "./auth";

const DAY = 864e5;

/** RevenueCat's grant durations. Months and years are calendar months and years. */
export const GRANT_DURATIONS = ["daily", "three_day", "weekly", "monthly", "two_month", "three_month", "six_month", "yearly", "lifetime"] as const;
export type GrantDuration = (typeof GRANT_DURATIONS)[number];
const MAX_CUSTOM_MS = 10 * 365 * DAY;
const MAX_NOTE = 500;

function addMonths(ms: number, months: number) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/** When a grant of `duration` starting at `start` ends; null for lifetime. */
export function grantEnd(duration: GrantDuration, start: number): number | null {
  switch (duration) {
    case "daily":
      return start + DAY;
    case "three_day":
      return start + 3 * DAY;
    case "weekly":
      return start + 7 * DAY;
    case "monthly":
      return addMonths(start, 1);
    case "two_month":
      return addMonths(start, 2);
    case "three_month":
      return addMonths(start, 3);
    case "six_month":
      return addMonths(start, 6);
    case "yearly":
      return addMonths(start, 12);
    case "lifetime":
      return null;
  }
}

export interface Actor {
  email: string;
  operatorId: string;
  source: "dashboard" | "api" | "mcp";
  tokenId: string | null;
  ip: string | null;
}

export class GrantError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
  }
}

/** Gives a customer an entitlement for `duration`, or until `expiresAt` (a custom end). */
export async function grantEntitlement(
  db: D1Database,
  config: ProjectConfig,
  input: { appUserId: string; entitlementId: string; duration?: string; expiresAt?: number; note?: string | null },
  actor: Actor,
  now = Date.now(),
) {
  const entitlement = config.entitlements.find((e) => e.id === input.entitlementId);
  if (!entitlement) throw new GrantError(`No entitlement "${input.entitlementId}". Entitlements: ${config.entitlements.map((e) => e.id).join(", ") || "none configured"}.`);
  let duration: string;
  let expiresAt: number | null;
  if (input.expiresAt !== undefined) {
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now) throw new GrantError("The end date must be in the future.");
    if (input.expiresAt - now > MAX_CUSTOM_MS) throw new GrantError("A custom grant can last at most 10 years; use lifetime instead.");
    duration = "custom";
    expiresAt = input.expiresAt;
  } else {
    if (!GRANT_DURATIONS.includes(input.duration as GrantDuration)) throw new GrantError(`duration must be one of: ${GRANT_DURATIONS.join(", ")} (or give an end date).`);
    duration = input.duration!;
    expiresAt = grantEnd(duration as GrantDuration, now);
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") throw new GrantError("note must be text.");
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_NOTE) throw new GrantError(`The note can be at most ${MAX_NOTE} characters.`);
  const customer = await findCustomer(db, config.id, input.appUserId);
  if (!customer) throw new GrantError(`No customer with app user ID "${input.appUserId}". They need to have opened the app (or be logged in) first.`, 404);

  const grant = {
    id: crypto.randomUUID(),
    entitlement_id: entitlement.id,
    duration,
    starts_at: now,
    expires_at: expiresAt,
    note,
    granted_by: actor.email,
    source: actor.source,
    created_at: now,
    revoked_at: null,
    revoked_by: null,
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO promotional_grant (id, customer_id, entitlement_id, duration, starts_at, expires_at, note, granted_by, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(grant.id, customer.id, grant.entitlement_id, duration, now, expiresAt, note, actor.email, actor.source, now),
    invalidateSnapshot(db, customer.id),
    audit(db, {
      operator: { id: actor.operatorId, email: actor.email },
      action: "grant.created",
      target: input.appUserId,
      details: { grant_id: grant.id, entitlement: entitlement.id, duration, expires_at: expiresAt, note },
      source: actor.source,
      tokenId: actor.tokenId,
      ip: actor.ip,
    }),
  ]);
  return { grant, customerId: customer.id };
}

/** Ends a grant now. The row stays, marked revoked. */
export async function revokeGrant(db: D1Database, input: { projectId: string; appUserId: string; grantId: string }, actor: Actor, now = Date.now()) {
  const row = await db
    .prepare(
      `SELECT g.id, g.customer_id, g.entitlement_id, g.revoked_at FROM promotional_grant g
       JOIN customer_alias a ON a.customer_id = g.customer_id WHERE a.project_id = ? AND a.app_user_id = ? AND g.id = ?`,
    )
    .bind(input.projectId, input.appUserId, input.grantId)
    .first<{ id: string; customer_id: string; entitlement_id: string; revoked_at: number | null }>();
  if (!row) throw new GrantError(`No grant ${input.grantId} for customer "${input.appUserId}".`, 404);
  if (row.revoked_at !== null) throw new GrantError("That grant was already revoked.");
  await db.batch([
    db.prepare("UPDATE promotional_grant SET revoked_at = ?, revoked_by = ? WHERE id = ?").bind(now, actor.email, row.id),
    invalidateSnapshot(db, row.customer_id),
    audit(db, {
      operator: { id: actor.operatorId, email: actor.email },
      action: "grant.revoked",
      target: input.appUserId,
      details: { grant_id: row.id, entitlement: row.entitlement_id },
      source: actor.source,
      tokenId: actor.tokenId,
      ip: actor.ip,
    }),
  ]);
  return { customerId: row.customer_id };
}

/** Rebuilds the snapshot after a grant change; failures are harmless (reads compute without it). */
export function rebuildAfterGrant(db: D1Database, config: Config, customerId: string) {
  return refreshSnapshot(db, config, customerId).catch((err) => console.error("Snapshot rebuild after a grant failed:", err));
}
