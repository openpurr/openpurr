// The config in D1 (config_version, migrations/0018_projects.sql): loading it with a per-isolate
// cache, saving new versions, and the history.
//
// Loading: each Worker keeps the config it last loaded and checks D1 for a newer version at most
// every `maxAgeMs`. The SDK Worker checks once a minute, so its hot path doesn't pay a D1 read per
// request and a config change reaches the SDK within a minute. The back office checks on every
// request (one small indexed read), so the dashboard always shows what was just saved. The check
// reads only the newest version's id, and the document only when the id changed.
//
// First load: when config_version is empty and the Worker was built with a config file
// (openpurr.config.yaml, compiled by scripts/build-config.mjs), that file is imported once as the
// first version. After that, D1 is the source of truth and the file is ignored.

import { type Config, ConfigError, type ConfigDocument, EMPTY_DOCUMENT, parseConfig } from "./config";

export interface ConfigLoaderOptions {
  /** How long a loaded config is used before checking D1 for a newer version. */
  maxAgeMs: number;
  /** Imported as the first version when there is none yet. */
  seed?: unknown;
}

export interface StoredVersion {
  id: number;
  document: ConfigDocument;
  created_at: number;
  created_by: string | null;
  note: string | null;
}

const EMPTY = parseConfig(EMPTY_DOCUMENT);

/**
 * A loader with its own cache (one per Worker). Every request awaits its own read: promises that
 * do I/O can't be shared between requests in Workers.
 */
export function configLoader(opts: ConfigLoaderOptions) {
  let cached: { config: Config; id: number; checkedAt: number } | null = null;

  async function load(db: D1Database, importSeed: boolean): Promise<{ config: Config; id: number }> {
    const row = await db
      .prepare("SELECT id, CASE WHEN id = ? THEN NULL ELSE document END AS document FROM config_version ORDER BY id DESC LIMIT 1")
      .bind(cached?.id ?? -1)
      .first<{ id: number; document: string | null }>();
    if (!row) {
      if (importSeed && opts.seed != null && (await importConfig(db, opts.seed))) return load(db, false);
      return { config: EMPTY, id: 0 };
    }
    if (row.document === null && cached) return cached;
    return { config: parseConfig(JSON.parse(row.document!)), id: row.id };
  }

  return async function getConfig(db: D1Database, now = Date.now()): Promise<Config> {
    if (cached && now - cached.checkedAt < opts.maxAgeMs) return cached.config;
    const loaded = await load(db, true);
    cached = { ...loaded, checkedAt: now };
    return loaded.config;
  };
}

/**
 * Imports a config file as the first version, if there's no version yet. Returns whether it was
 * imported. An invalid file is logged and skipped (the build already checks it).
 */
export async function importConfig(db: D1Database, raw: unknown, now = Date.now()) {
  let config: Config;
  try {
    config = parseConfig(raw);
  } catch (err) {
    console.error("The bundled config isn't valid, so it wasn't imported:", err);
    return false;
  }
  const res = await db
    .prepare(
      `INSERT INTO config_version (document, created_at, created_by, note)
       SELECT ?, ?, 'import', 'Imported from openpurr.config.yaml' WHERE NOT EXISTS (SELECT 1 FROM config_version)`,
    )
    .bind(JSON.stringify(config.document), now)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export class ConfigConflict extends Error {}

/**
 * Saves a new version. `baseId` is the version the change was made from (0 when there was none);
 * if someone saved in between, nothing is written and ConfigConflict is thrown. Throws
 * ConfigError when the document isn't valid.
 */
export async function saveConfig(
  db: D1Database,
  raw: unknown,
  opts: { baseId: number; by: string | null; note?: string | null },
  now = Date.now(),
): Promise<{ id: number; config: Config }> {
  const config = parseConfig(raw);
  const insert = await db
    .prepare(
      `INSERT INTO config_version (document, created_at, created_by, note)
       SELECT ?1, ?2, ?3, ?4 WHERE (SELECT coalesce(max(id), 0) FROM config_version) = ?5`,
    )
    .bind(JSON.stringify(config.document), now, opts.by, opts.note ?? null, opts.baseId)
    .run();
  if (!insert.meta.changes) throw new ConfigConflict("The config was changed by someone else since you loaded it. Reload and make your change again.");
  return { id: Number(insert.meta.last_row_id), config };
}

/** The current version, or null before the first save or import. */
export async function currentVersion(db: D1Database): Promise<StoredVersion | null> {
  const row = await db
    .prepare("SELECT id, document, created_at, created_by, note FROM config_version ORDER BY id DESC LIMIT 1")
    .first<Omit<StoredVersion, "document"> & { document: string }>();
  return row ? { ...row, document: JSON.parse(row.document) as ConfigDocument } : null;
}

export async function getVersion(db: D1Database, id: number): Promise<StoredVersion | null> {
  const row = await db
    .prepare("SELECT id, document, created_at, created_by, note FROM config_version WHERE id = ?")
    .bind(id)
    .first<Omit<StoredVersion, "document"> & { document: string }>();
  return row ? { ...row, document: JSON.parse(row.document) as ConfigDocument } : null;
}

/** The history, newest first, without the documents. */
export async function listVersions(db: D1Database, limit = 50, before?: number) {
  const { results } = await db
    .prepare(`SELECT id, created_at, created_by, note FROM config_version ${before ? "WHERE id < ?2" : ""} ORDER BY id DESC LIMIT ?1`)
    .bind(...(before ? [limit, before] : [limit]))
    .all<Omit<StoredVersion, "document">>();
  return results;
}

/**
 * Problems with replacing `previous` by `next` that validation of `next` alone can't see:
 *   - an app can't move to another project (its purchases belong to the old project's customers);
 *   - a project that has customers can't be removed (they'd be orphaned).
 */
export async function changeProblems(db: D1Database, previous: Config, next: Config): Promise<string[]> {
  const problems: string[] = [];
  for (const [appId, app] of next.apps) {
    const before = previous.apps.get(appId);
    if (before && before.projectId !== app.projectId) {
      problems.push(`apps.${appId}: an app can't move to another project (it's in ${before.projectId}). Add a new app instead.`);
    }
  }
  const removed = [...previous.projects.keys()].filter((id) => !next.projects.has(id));
  if (removed.length) {
    const { results } = await db
      // One index probe per project, not a scan of its customers.
      .prepare("SELECT value AS project_id FROM json_each(?) WHERE EXISTS (SELECT 1 FROM customer WHERE project_id = value)")
      .bind(JSON.stringify(removed))
      .all<{ project_id: string }>();
    for (const { project_id } of results) {
      problems.push(`projects.${project_id}: this project has customers, so it can't be removed.`);
    }
  }
  return problems;
}

export { ConfigError };
