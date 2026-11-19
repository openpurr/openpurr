// Projects (one per title) and the config in D1: customers, entitlements, offerings and secret keys
// stay inside their project, and the config is loaded, saved and versioned in D1.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ConfigError, parseConfig, upgradeConfig } from "../src/config";
import { changeProblems, ConfigConflict, configLoader, currentVersion, importConfig, saveConfig } from "../src/config-store";
import type { Deps } from "../src/env";
import { SESSION_COOKIE } from "../src/office/auth";
import { hashPassword, randomToken, sha256Hex } from "../src/office/auth-crypto";
import { mountOffice } from "../src/office/app";
import { mountSdk } from "../src/sdk-app";
import { hashKey } from "../src/secret-keys";
import { DAY, rawTestConfig, signTransaction } from "./helpers";
import { TEST_ROOT_CERT_B64 } from "../src/bench/fixtures.generated";
import { base64ToBytes } from "../src/lib/der";

const ROSE_KEY = "appl_rose_ios_0123456789";
const GOLD_KEY = "appl_gold_ios_0123456789";
const ROSE_BUNDLE = "com.example.rose";
const GOLD_BUNDLE = "com.example.gold";

/** Two titles, each with its own iOS app and its own "pro" entitlement. */
function twoProjects(ids = { rose: "rose", gold: "gold" }) {
  const project = (name: string, appId: string, bundle: string, key: string, product: string) => ({
    name,
    apps: { [appId]: { store: "app_store", bundle_id: bundle, sdk_keys: [key], products: { [product]: { type: "subscription" } } } },
    entitlements: { pro: { products: { [appId]: [product] } } },
    offerings: [{ id: `${appId}_default`, current: true, packages: [{ id: "$rc_monthly", [appId]: product }] }],
  });
  return {
    version: 2,
    projects: {
      [ids.rose]: project("Rose", "rose_ios", ROSE_BUNDLE, ROSE_KEY, "rose_monthly"),
      [ids.gold]: project("Gold", "gold_ios", GOLD_BUNDLE, GOLD_KEY, "gold_monthly"),
    },
  };
}

const appleRoots = [base64ToBytes(TEST_ROOT_CERT_B64)];
const appFor = (deps: Partial<Deps>) =>
  createApp({ appleRoots, rateLimiters: () => ({}), ...deps }, (app) => {
    mountSdk(app);
    mountOffice(app);
  });

async function request(app: ReturnType<typeof appFor>, path: string, opts: { key?: string; body?: unknown; method?: string; cookie?: string } = {}) {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`https://openpurr.test${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        origin: "https://openpurr.test",
        "x-platform": "iOS",
        ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
        ...(opts.cookie ? { cookie: `${SESSION_COOKIE}=${opts.cookie}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    { ...env, OPERATOR_SECRET: "test-operator-secret-0123456789abcdef" },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.json<any>() };
}

async function ownerSession() {
  const id = crypto.randomUUID();
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO operator (id, email, name, role, password_hash, totp_enabled, created_at) VALUES (?, ?, 'Owner', 'owner', ?, 0, ?)").bind(
      id,
      `owner-${id}@example.com`,
      await hashPassword("test-operator-secret-0123456789abcdef", "a long test passphrase"),
      Date.now(),
    ),
    env.DB.prepare("INSERT INTO session (token_hash, operator_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, 'full', ?, ?, ?)").bind(
      await sha256Hex(session),
      id,
      Date.now(),
      Date.now() + 3600_000,
      Date.now(),
    ),
  ]);
  return session;
}

describe("config documents", () => {
  it("reads a version 1 file as the project 'default', keeping version 1 paths in problems", () => {
    const config = parseConfig(rawTestConfig);
    expect([...config.projects.keys()]).toEqual(["default"]);
    expect(config.apps.get("ios")?.projectId).toBe("default");
    expect(config.document.version).toBe(2);
    expect((upgradeConfig(rawTestConfig) as any).projects.default.name).toBe("Default");

    const broken = structuredClone(rawTestConfig) as any;
    broken.apps.ios.sdk_keys = ["nope"];
    expect(() => parseConfig(broken)).toThrow(/apps\.ios\.sdk_keys\[0\]/);
  });

  it("accepts an empty config and projects without apps", () => {
    expect(parseConfig({ version: 2, projects: {} }).projects.size).toBe(0);
    const config = parseConfig({ version: 2, projects: { rose: { name: "Rose" } } });
    expect(config.projects.get("rose")).toMatchObject({ id: "rose", name: "Rose", currentOffering: null });
  });

  it("keeps app IDs, SDK keys and bundle IDs unique across projects", () => {
    const problems = (mutate: (d: any) => void) => {
      const d = twoProjects() as any;
      mutate(d);
      try {
        parseConfig(d);
        return [];
      } catch (err) {
        if (err instanceof ConfigError) return err.problems;
        throw err;
      }
    };
    expect(problems(() => {})).toEqual([]);
    expect(problems((d) => (d.projects.gold.apps.gold_ios.sdk_keys = [ROSE_KEY])).join()).toMatch(/already used by app rose_ios/);
    expect(problems((d) => (d.projects.gold.apps.gold_ios.bundle_id = ROSE_BUNDLE)).join()).toMatch(/com\.example\.rose is already used by app rose_ios/);
    expect(
      problems((d) => {
        d.projects.gold.apps.rose_ios = d.projects.gold.apps.gold_ios;
        delete d.projects.gold.apps.gold_ios;
      }).join(),
    ).toMatch(/app ID rose_ios is already used in project rose/);
    // An entitlement can only use its own project's apps.
    expect(problems((d) => (d.projects.gold.entitlements.pro.products = { rose_ios: ["rose_monthly"] })).join()).toMatch(
      /projects\.gold\.entitlements\.pro\.products\.rose_ios\[0\]: unknown app rose_ios/,
    );
    expect(problems((d) => (d.projects["Not OK"] = {})).join()).toMatch(/project IDs are 1–50 lowercase/);
    expect(problems((d) => (d.projects.rose.name = "")).join()).toMatch(/projects\.rose\.name/);
  });

  it("versions each project separately, so a change to one project leaves the other's snapshots alone", () => {
    const a = parseConfig(twoProjects());
    const changed = twoProjects() as any;
    changed.projects.gold.entitlements.vip = { products: { gold_ios: ["gold_monthly"] } };
    const b = parseConfig(changed);
    expect(b.projects.get("rose")!.version).toBe(a.projects.get("rose")!.version);
    expect(b.projects.get("gold")!.version).not.toBe(a.projects.get("gold")!.version);
  });
});

describe("projects on the SDK API", () => {
  const app = appFor({ config: parseConfig(twoProjects()) });

  it("keeps the same app user ID in two projects as two customers", async () => {
    const { jws } = await signTransaction({ bundleId: ROSE_BUNDLE, productId: "rose_monthly", expiresDate: Date.now() + 20 * DAY });
    const posted = await request(app, "/v1/receipts", { key: ROSE_KEY, body: { app_user_id: "user_123", fetch_token: jws } });
    expect(posted.status).toBe(200);
    expect(posted.body.subscriber.entitlements.pro).toBeDefined();

    const rose = await request(app, "/v1/subscribers/user_123", { key: ROSE_KEY });
    expect(Object.keys(rose.body.subscriber.entitlements)).toEqual(["pro"]);
    // Gold has its own "pro", and its user_123 bought nothing.
    const gold = await request(app, "/v1/subscribers/user_123", { key: GOLD_KEY });
    expect(gold.body.subscriber.entitlements).toEqual({});

    await request(app, "/v1/subscribers/user_123/attributes", { key: GOLD_KEY, body: { attributes: { $email: { value: "g@example.com", updated_at_ms: 1 } } } });
    const { results } = await env.DB.prepare("SELECT c.project_id FROM customer_alias a JOIN customer c ON c.id = a.customer_id WHERE a.app_user_id = 'user_123' ORDER BY c.project_id").all();
    expect(results.map((r) => r.project_id)).toEqual(["gold", "rose"]);
  });

  it("logs in within the caller's project only", async () => {
    const { jws } = await signTransaction({ bundleId: ROSE_BUNDLE, productId: "rose_monthly", expiresDate: Date.now() + 20 * DAY });
    await request(app, "/v1/receipts", { key: ROSE_KEY, body: { app_user_id: "rose-buyer", fetch_token: jws } });
    // A Gold user logging in as "rose-buyer" is Gold's rose-buyer: a new customer, without Rose's purchase.
    const res = await request(app, "/v1/subscribers/identify", { key: GOLD_KEY, body: { app_user_id: "$RCAnonymousID:gold0000000000000000000000000000", new_app_user_id: "rose-buyer" } });
    expect(res.status).toBe(201);
    expect(res.body.subscriber.entitlements).toEqual({});
  });

  it("refuses another title's transaction", async () => {
    const { jws } = await signTransaction({ bundleId: ROSE_BUNDLE, productId: "rose_monthly" });
    const res = await request(app, "/v1/receipts", { key: GOLD_KEY, body: { app_user_id: "sneaky", fetch_token: jws } });
    expect(res.status).toBe(500); // not this app's bundle: kept on the device, never recorded here
    expect(await env.DB.prepare("SELECT 1 FROM customer_alias WHERE app_user_id = 'sneaky' AND project_id = 'gold'").first()).toBeNull();
  });

  it("serves each project's offerings", async () => {
    const rose = await request(app, "/v1/subscribers/anyone/offerings", { key: ROSE_KEY });
    const gold = await request(app, "/v1/subscribers/anyone/offerings", { key: GOLD_KEY });
    expect(rose.body.current_offering_id).toBe("rose_ios_default");
    expect(gold.body.current_offering_id).toBe("gold_ios_default");
    expect(gold.body.offerings.map((o: { identifier: string }) => o.identifier)).toEqual(["gold_ios_default"]);
  });

  it("lets a secret key read only its own project's customers", async () => {
    const { jws } = await signTransaction({ bundleId: ROSE_BUNDLE, productId: "rose_monthly", expiresDate: Date.now() + 20 * DAY });
    await request(app, "/v1/receipts", { key: ROSE_KEY, body: { app_user_id: "secret-test", fetch_token: jws } });
    const keyFor = async (project: string) => {
      const key = `sk_${project}_${randomToken()}`;
      await env.DB.prepare("INSERT INTO api_key (id, project_id, key_hash, key_prefix, name, scopes, created_at) VALUES (?, ?, ?, ?, 'test', '[\"customers:read\"]', ?)")
        .bind(crypto.randomUUID(), project, await hashKey(key), key.slice(0, 10), Date.now())
        .run();
      return key;
    };
    const rose = await request(app, "/v1/subscribers/secret-test", { key: await keyFor("rose") });
    expect(Object.keys(rose.body.subscriber.entitlements)).toEqual(["pro"]);
    const gold = await request(app, "/v1/subscribers/secret-test", { key: await keyFor("gold") });
    expect(gold.body.subscriber.entitlements).toEqual({});
  });
});

describe("the config in D1", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM config_version").run();
  });

  it("imports the bundled config once, then serves what's in D1", async () => {
    const load = configLoader({ maxAgeMs: 0, seed: rawTestConfig });
    const first = await load(env.DB);
    expect([...first.projects.keys()]).toEqual(["default"]);
    const stored = await currentVersion(env.DB);
    expect(stored).toMatchObject({ id: expect.any(Number), created_by: "import" });
    expect(await importConfig(env.DB, rawTestConfig)).toBe(false); // never twice

    await saveConfig(env.DB, twoProjects(), { baseId: stored!.id, by: "test@example.com" });
    const second = await load(env.DB);
    expect([...second.projects.keys()]).toEqual(["rose", "gold"]);
  });

  it("starts empty without a bundled config", async () => {
    const config = await configLoader({ maxAgeMs: 0 })(env.DB);
    expect(config.projects.size).toBe(0);
  });

  it("checks D1 for a newer version only after maxAgeMs", async () => {
    const { id } = await saveConfig(env.DB, rawTestConfig, { baseId: 0, by: null });
    const load = configLoader({ maxAgeMs: 60_000 });
    const t = 1_000_000;
    expect((await load(env.DB, t)).projects.has("default")).toBe(true);
    await saveConfig(env.DB, twoProjects(), { baseId: id, by: null });
    expect((await load(env.DB, t + 30_000)).projects.has("default")).toBe(true); // still cached
    expect((await load(env.DB, t + 61_000)).projects.has("rose")).toBe(true);
  });

  it("refuses a save made from an older version", async () => {
    const { id } = await saveConfig(env.DB, rawTestConfig, { baseId: 0, by: null });
    await saveConfig(env.DB, twoProjects(), { baseId: id, by: null });
    await expect(saveConfig(env.DB, rawTestConfig, { baseId: id, by: null })).rejects.toBeInstanceOf(ConfigConflict);
    await expect(saveConfig(env.DB, { version: 2, projects: { x: { apps: 1 } } }, { baseId: id + 1, by: null })).rejects.toBeInstanceOf(ConfigError);
  });

  it("won't move an app to another project, or drop a project that has customers", async () => {
    // Fresh project IDs: the SDK tests above gave rose and gold customers.
    const ids = { rose: "rose2", gold: "gold2" };
    const before = parseConfig(twoProjects(ids));
    const moved = twoProjects(ids) as any;
    moved.projects.gold2.apps.rose_ios = moved.projects.rose2.apps.rose_ios;
    moved.projects.rose2.apps = {};
    moved.projects.rose2.entitlements = {};
    moved.projects.rose2.offerings = [];
    expect((await changeProblems(env.DB, before, parseConfig(moved))).join()).toMatch(/rose_ios: an app can't move to another project/);

    const dropped = twoProjects(ids) as any;
    delete dropped.projects.gold2;
    expect(await changeProblems(env.DB, before, parseConfig(dropped))).toEqual([]); // no customers yet
    await env.DB.prepare("INSERT INTO customer (id, project_id, app_user_id, first_seen) VALUES (?, 'gold2', 'someone', ?)").bind(crypto.randomUUID(), Date.now()).run();
    expect((await changeProblems(env.DB, before, parseConfig(dropped))).join()).toMatch(/projects\.gold2: this project has customers/);
  });
});

describe("the config API", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM config_version").run();
  });

  it("saves versions, lists and restores them, and the next request sees the change", async () => {
    const app = appFor({ loadConfig: configLoader({ maxAgeMs: 0, seed: rawTestConfig }) });
    const cookie = await ownerSession();

    const current = await request(app, "/admin/v1/config", { cookie });
    expect(current.status).toBe(200);
    expect(Object.keys(current.body.document.projects)).toEqual(["default"]);

    const invalid = await request(app, "/admin/v1/config", { cookie, method: "PUT", body: { document: { version: 2, projects: { rose: { apps: [] } } }, base_id: current.body.id } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.problems.join()).toMatch(/projects\.rose\.apps/);

    // Fresh project IDs, without customers, so restoring the old version may remove them again.
    const both = twoProjects({ rose: "rose3", gold: "gold3" }) as any;
    both.projects.default = current.body.document.projects.default;
    const saved = await request(app, "/admin/v1/config", { cookie, method: "PUT", body: { document: both, base_id: current.body.id, note: "Add Rose and Gold" } });
    expect(saved.status).toBe(201);
    const stale = await request(app, "/admin/v1/config", { cookie, method: "PUT", body: { document: both, base_id: current.body.id } });
    expect(stale.status).toBe(409);

    const projects = await request(app, "/admin/v1/projects", { cookie });
    expect(projects.body.projects.map((p: { id: string }) => p.id)).toEqual(["rose3", "gold3", "default"]);

    // With several projects, customer requests must say which.
    expect((await request(app, "/admin/v1/customers", { cookie })).status).toBe(400);
    expect((await request(app, "/admin/v1/customers?project=rose3", { cookie })).status).toBe(200);
    expect((await request(app, "/admin/v1/customers?project=nope", { cookie })).status).toBe(404);

    const versions = await request(app, "/admin/v1/config/versions", { cookie });
    expect(versions.body.versions.map((v: { note: string | null }) => v.note)).toEqual(["Add Rose and Gold", "Imported from openpurr.config.yaml"]);

    const restored = await request(app, `/admin/v1/config/versions/${current.body.id}/restore`, { cookie, body: { base_id: saved.body.id } });
    expect(restored.status).toBe(201);
    expect((await request(app, "/admin/v1/projects", { cookie })).body.projects.map((p: { id: string }) => p.id)).toEqual(["default"]);

    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'config.%' ORDER BY id").all();
    expect(audit.results.map((r) => r.action)).toEqual(["config.saved", "config.restored"]);
  });

  it("lets only admins and owners change the config", async () => {
    const app = appFor({ loadConfig: configLoader({ maxAgeMs: 0, seed: rawTestConfig }) });
    const cookie = await ownerSession();
    await env.DB.prepare("UPDATE operator SET role = 'developer' WHERE id = (SELECT operator_id FROM session WHERE token_hash = ?)").bind(await sha256Hex(cookie)).run();
    const res = await request(app, "/admin/v1/config", { cookie, method: "PUT", body: { document: twoProjects(), base_id: 0 } });
    expect(res.status).toBe(403);
  });
});
