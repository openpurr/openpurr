// Secret API keys (sk_...) for server-to-server calls, such as reading full CustomerInfo from
// your backend. Unlike public SDK keys, these are secrets: only a SHA-256 hash is stored
// (migrations/0009_api_keys.sql), and a key is shown once, when created
// (scripts/secret-keys.mjs; the admin API takes over in M4a).
//
// Lookups are cached per isolate for a minute, so a busy backend doesn't cost a D1 read per
// request; revoking a key therefore takes effect within a minute. last_used_at is written at most
// once an hour per key, to keep writes off the read path.

export const SECRET_KEY_PREFIX = "sk_";
export const SCOPES = ["customers:read"] as const;
export type Scope = (typeof SCOPES)[number];

export interface SecretKey {
  id: string;
  /** A secret key reads one project's customers. */
  projectId: string;
  name: string;
  scopes: Set<string>;
  lastUsedAt: number | null;
}

const CACHE_MS = 60_000;
const LAST_USED_EVERY_MS = 3600_000;
const cache = new Map<string, { key: SecretKey | null; at: number }>();

export async function hashKey(key: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The secret key for a presented token, or null if unknown, revoked or expired. */
export async function verifySecretKey(db: D1Database, token: string, now = Date.now()): Promise<SecretKey | null> {
  if (!token.startsWith(SECRET_KEY_PREFIX) || token.length < 20 || token.length > 200) return null;
  const hash = await hashKey(token);
  const cached = cache.get(hash);
  if (cached && now - cached.at < CACHE_MS) return cached.key;

  const row = await db
    .prepare(
      `SELECT id, project_id, name, scopes, last_used_at FROM api_key
       WHERE key_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .bind(hash, now)
    .first<{ id: string; project_id: string; name: string; scopes: string; last_used_at: number | null }>();
  const key = row ? { id: row.id, projectId: row.project_id, name: row.name, scopes: new Set<string>(JSON.parse(row.scopes)), lastUsedAt: row.last_used_at } : null;
  if (cache.size > 1000) cache.clear();
  cache.set(hash, { key, at: now });
  return key;
}

/** Records use at most hourly. Returns a statement to run (in waitUntil), or null if not due. */
export function touchSecretKey(db: D1Database, key: SecretKey, now = Date.now()) {
  if (key.lastUsedAt !== null && now - key.lastUsedAt < LAST_USED_EVERY_MS) return null;
  key.lastUsedAt = now; // also updates the cached copy
  return db.prepare("UPDATE api_key SET last_used_at = ? WHERE id = ?").bind(now, key.id);
}

/** Forget cached lookups (tests). */
export function clearSecretKeyCache() {
  cache.clear();
}
