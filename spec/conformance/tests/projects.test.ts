// Projects (one per title) and the versioned config: customers, entitlements, offerings and secret
// keys stay inside their project, and the config is validated, saved, versioned and restored
// through the admin API. Ported from lite/test/projects.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { admin, call, createOperator, DAY, now, putConfig, reset, signTransaction, testConfig } from "../src";

const ROSE_KEY = "appl_rose_ios_0123456789";
const GOLD_KEY = "appl_gold_ios_0123456789";
const ROSE_BUNDLE = "com.example.rose";
const GOLD_BUNDLE = "com.example.gold";

/** Two titles, each with its own iOS app and its own "pro" entitlement. */
function twoProjects(ids = { rose: "rose", gold: "gold" }): any {
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

/** The problems POST /config/validate finds in a document (none when it's valid). */
async function problems(document: unknown) {
  const res = await admin("POST", "/config/validate", {}, { body: { document } });
  expect(res.status).toBe(200);
  expect(res.body.valid).toBe(res.body.problems.length === 0);
  return res.body.problems as string[];
}

const roseTransaction = (overrides: object = {}) => signTransaction({ bundleId: ROSE_BUNDLE, productId: "rose_monthly", expiresDate: now() + 20 * DAY, ...overrides });

describe("config documents", () => {
  beforeEach(async () => {
    await reset();
  });

  it("reads a version 1 file as the project 'default', keeping version 1 paths in problems", async () => {
    const projects = (await admin("GET", "/projects")).body.projects;
    expect(projects.map((p: { id: string }) => p.id)).toEqual(["default"]);
    expect((await admin("GET", "/apps")).body.apps.find((a: { id: string }) => a.id === "ios").project_id).toBe("default");
    const { document } = (await admin("GET", "/config")).body;
    expect(document.version).toBe(2);
    expect(document.projects.default.name).toBe("Default");

    const broken = testConfig();
    broken.apps.ios.sdk_keys = ["nope"];
    expect((await problems(broken)).join()).toMatch(/apps\.ios\.sdk_keys\[0\]/);
  });

  it("accepts an empty config and projects without apps", async () => {
    expect(await problems({ version: 2, projects: {} })).toEqual([]);
    await reset({ version: 2, projects: { rose: { name: "Rose" } } });
    expect((await admin("GET", "/projects")).body.projects).toEqual([
      expect.objectContaining({ id: "rose", name: "Rose", apps: [], current_offering_id: null }),
    ]);
  });

  it("keeps app IDs, SDK keys and bundle IDs unique across projects", async () => {
    const check = (mutate: (d: any) => void) => {
      const d = twoProjects();
      mutate(d);
      return problems(d).then((p) => p.join());
    };
    expect(await check(() => {})).toBe("");
    expect(await check((d) => (d.projects.gold.apps.gold_ios.sdk_keys = [ROSE_KEY]))).toMatch(/already used by app rose_ios/);
    expect(await check((d) => (d.projects.gold.apps.gold_ios.bundle_id = ROSE_BUNDLE))).toMatch(/com\.example\.rose is already used by app rose_ios/);
    expect(
      await check((d) => {
        d.projects.gold.apps.rose_ios = d.projects.gold.apps.gold_ios;
        delete d.projects.gold.apps.gold_ios;
      }),
    ).toMatch(/app ID rose_ios is already used in project rose/);
    // An entitlement can only use its own project's apps.
    expect(await check((d) => (d.projects.gold.entitlements.pro.products = { rose_ios: ["rose_monthly"] }))).toMatch(
      /projects\.gold\.entitlements\.pro\.products\.rose_ios\[0\]: unknown app rose_ios/,
    );
    expect(await check((d) => (d.projects["Not OK"] = {}))).toMatch(/project IDs are 1–50 lowercase/);
    expect(await check((d) => (d.projects.rose.name = ""))).toMatch(/projects\.rose\.name/);
  });
});

describe("projects on the SDK API", () => {
  beforeEach(async () => {
    await reset(twoProjects());
  });

  it("keeps the same app user ID in two projects as two customers", async () => {
    const { jws } = await roseTransaction();
    const posted = await call("/v1/receipts", { key: ROSE_KEY, body: { app_user_id: "user_123", fetch_token: jws } });
    expect(posted.status).toBe(200);
    expect(posted.body.subscriber.entitlements.pro).toBeDefined();

    const rose = await call("/v1/subscribers/user_123", { key: ROSE_KEY });
    expect(Object.keys(rose.body.subscriber.entitlements)).toEqual(["pro"]);
    // Gold has its own "pro", and its user_123 bought nothing.
    const gold = await call("/v1/subscribers/user_123", { key: GOLD_KEY });
    expect(gold.body.subscriber.entitlements).toEqual({});

    await call("/v1/subscribers/user_123/attributes", { key: GOLD_KEY, body: { attributes: { $email: { value: "g@example.com", updated_at_ms: 1 } } } });
    const inRose = await admin("GET", "/customers/user_123?project=rose");
    const inGold = await admin("GET", "/customers/user_123?project=gold");
    expect(inRose.body.customer.project_id).toBe("rose");
    expect(inGold.body.customer.project_id).toBe("gold");
    expect(inGold.body.customer.id).not.toBe(inRose.body.customer.id);
    expect(inGold.body.attributes.$email.value).toBe("g@example.com");
    expect(inRose.body.attributes.$email).toBeUndefined();
  });

  it("logs in within the caller's project only", async () => {
    const { jws } = await roseTransaction();
    await call("/v1/receipts", { key: ROSE_KEY, body: { app_user_id: "rose-buyer", fetch_token: jws } });
    // A Gold user logging in as "rose-buyer" is Gold's rose-buyer: a new customer, without Rose's purchase.
    const res = await call("/v1/subscribers/identify", {
      key: GOLD_KEY,
      body: { app_user_id: "$RCAnonymousID:gold0000000000000000000000000000", new_app_user_id: "rose-buyer" },
    });
    expect(res.status).toBe(201);
    expect(res.body.subscriber.entitlements).toEqual({});
  });

  it("refuses another title's transaction", async () => {
    const { jws } = await roseTransaction({ expiresDate: undefined });
    const res = await call("/v1/receipts", { key: GOLD_KEY, body: { app_user_id: "sneaky", fetch_token: jws } });
    expect(res.status).toBe(500); // not this app's bundle: kept on the device, never recorded here
    expect((await admin("GET", "/customers/sneaky?project=gold")).status).toBe(404);
  });

  it("serves each project's offerings", async () => {
    const rose = await call("/v1/subscribers/anyone/offerings", { key: ROSE_KEY });
    const gold = await call("/v1/subscribers/anyone/offerings", { key: GOLD_KEY });
    expect(rose.body.current_offering_id).toBe("rose_ios_default");
    expect(gold.body.current_offering_id).toBe("gold_ios_default");
    expect(gold.body.offerings.map((o: { identifier: string }) => o.identifier)).toEqual(["gold_ios_default"]);
  });

  it("lets a secret key read only its own project's customers", async () => {
    const { jws } = await roseTransaction();
    await call("/v1/receipts", { key: ROSE_KEY, body: { app_user_id: "secret-test", fetch_token: jws } });
    const keyFor = async (project: string) => {
      const res = await admin("POST", "/secret-keys", {}, { body: { name: "test", project } });
      expect(res.status).toBe(201);
      expect(res.body.project_id).toBe(project);
      return res.body.key as string;
    };
    const rose = await call("/v1/subscribers/secret-test", { key: await keyFor("rose") });
    expect(Object.keys(rose.body.subscriber.entitlements)).toEqual(["pro"]);
    const gold = await call("/v1/subscribers/secret-test", { key: await keyFor("gold") });
    expect(gold.body.subscriber.entitlements).toEqual({});
  });
});

describe("config changes", () => {
  it("refuses a save made from an older version", async () => {
    await reset();
    const first = await putConfig(twoProjects());
    expect(first.status).toBe(201);
    const current = (await admin("GET", "/config")).body;
    expect(current.id).toBe(first.body.id);
    const stale = await admin("PUT", "/config", {}, { body: { document: testConfig(), base_id: first.body.id - 1 } });
    expect(stale.status).toBe(409);
    const invalid = await admin("PUT", "/config", {}, { body: { document: { version: 2, projects: { x: { apps: 1 } } }, base_id: first.body.id } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("invalid_config");
  });

  it("won't move an app to another project, or drop a project that has customers", async () => {
    await reset(twoProjects());
    const moved = twoProjects();
    moved.projects.gold.apps.rose_ios = moved.projects.rose.apps.rose_ios;
    moved.projects.rose.apps = {};
    moved.projects.rose.entitlements = {};
    moved.projects.rose.offerings = [];
    expect((await problems(moved)).join()).toMatch(/rose_ios: an app can't move to another project/);

    const dropped = twoProjects();
    delete dropped.projects.gold;
    expect(await problems(dropped)).toEqual([]); // no customers yet
    await call("/v1/subscribers/someone/attributes", { key: GOLD_KEY, body: { attributes: { $email: { value: "s@example.com", updated_at_ms: 1 } } } });
    expect((await problems(dropped)).join()).toMatch(/projects\.gold: this project has customers/);
    expect((await putConfig(dropped)).status).toBe(400);
  });
});

describe("the config API", () => {
  beforeEach(async () => {
    await reset();
  });

  it("saves versions, lists and restores them, and the next request sees the change", async () => {
    const { session } = await createOperator("owner");
    const current = await admin("GET", "/config", { session });
    expect(current.status).toBe(200);
    expect(Object.keys(current.body.document.projects)).toEqual(["default"]);

    const invalid = await admin("PUT", "/config", { session }, { body: { document: { version: 2, projects: { rose: { apps: [] } } }, base_id: current.body.id } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.problems.join()).toMatch(/projects\.rose\.apps/);

    const both = twoProjects();
    both.projects.default = current.body.document.projects.default;
    const saved = await admin("PUT", "/config", { session }, { body: { document: both, base_id: current.body.id, note: "Add Rose and Gold" } });
    expect(saved.status).toBe(201);
    const stale = await admin("PUT", "/config", { session }, { body: { document: both, base_id: current.body.id } });
    expect(stale.status).toBe(409);

    const projects = await admin("GET", "/projects", { session });
    expect(projects.body.projects.map((p: { id: string }) => p.id)).toEqual(["rose", "gold", "default"]);
    // The SDK API sees the new projects at once.
    expect((await call("/v1/subscribers/anyone/offerings", { key: ROSE_KEY })).body.current_offering_id).toBe("rose_ios_default");

    // With several projects, customer requests must say which.
    expect((await admin("GET", "/customers", { session })).status).toBe(400);
    expect((await admin("GET", "/customers?project=rose", { session })).status).toBe(200);
    expect((await admin("GET", "/customers?project=nope", { session })).status).toBe(404);

    // Newest first; the oldest is whatever the reset loaded.
    const versions = (await admin("GET", "/config/versions", { session })).body.versions as { id: number; note: string | null }[];
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.id)).toEqual([saved.body.id, current.body.id]);
    expect(versions[0]!.note).toBe("Add Rose and Gold");

    const restored = await admin("POST", `/config/versions/${current.body.id}/restore`, { session }, { body: { base_id: saved.body.id } });
    expect(restored.status).toBe(201);
    expect((await admin("GET", "/projects", { session })).body.projects.map((p: { id: string }) => p.id)).toEqual(["default"]);
    expect((await call("/v1/subscribers/anyone/offerings", { key: ROSE_KEY })).status).toBe(401);

    const audit = (await admin("GET", "/audit?limit=500")).body.entries as { action: string }[];
    expect(audit.filter((e) => e.action.startsWith("config.")).map((e) => e.action).reverse()).toEqual(["config.saved", "config.restored"]);
  });

  it("lets only admins and owners change the config", async () => {
    const developer = await createOperator("developer");
    const current = (await admin("GET", "/config")).body;
    const res = await admin("PUT", "/config", { session: developer.session }, { body: { document: twoProjects(), base_id: current.id } });
    expect(res.status).toBe(403);
    const adminOp = await createOperator("admin");
    const both = twoProjects();
    both.projects.default = current.document.projects.default;
    expect((await admin("PUT", "/config", { session: adminOp.session }, { body: { document: both, base_id: current.id } })).status).toBe(201);
  });
});
