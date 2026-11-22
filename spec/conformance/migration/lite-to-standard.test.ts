// Moving a deployment from Lite to Standard, end to end (docs/migrating-from-lite-to-standard.md),
// started by scripts/run-migration.mjs: seed Lite, export with the CLI, import with Standard's
// binary, verify with the CLI (no differences), a delta, then requests through Lite's Workers in
// forward mode, answered by Standard.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The CLI, as `npx @openpurr/cli` runs it (plain JavaScript, without type declarations).
// @ts-ignore
import { main as cli } from "../../../cli/src/main.js";
import {
  admin,
  ANON,
  call,
  CONFORMANCE_TOKEN,
  createOperator,
  DAY,
  fake,
  fixtures,
  jobs,
  now,
  owner,
  playSubscription,
  postAppleTransaction,
  postNotification,
  reset,
  serverSecrets,
  settle,
  signNotification,
  STORE_BASE,
  TARGET,
  withGooglePlay,
  withWebhooks,
} from "../src";

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} isn't set: run this through scripts/run-migration.mjs`);
  return v;
};
const BIN = env("MIGRATION_STANDARD_BIN");
const DATABASE_URL = env("MIGRATION_DATABASE_URL");
const STANDARD = `http://127.0.0.1:${env("MIGRATION_STANDARD_PORT")}`;
const FORWARD_SDK = env("MIGRATION_FORWARD_SDK");
const FORWARD_OFFICE = env("MIGRATION_FORWARD_OFFICE");

let standard: ChildProcess | null = null;
const work = mkdtempSync(join(tmpdir(), "openpurr-migration-"));

/** Runs the CLI in-process; returns its exit code and output. */
async function openpurr(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await cli([...argv, "--token", owner()], {
    env: { XDG_CONFIG_HOME: work },
    stdout: { write: (s: string) => ((stdout += s), true), isTTY: false },
    stderr: { write: (s: string) => ((stderr += s), true) },
    stdin: { isTTY: false },
  });
  return { code, stdout, stderr };
}

/** `openpurr migrate import` with Standard's binary. */
function importBundle(dir: string, ...flags: string[]) {
  const r = spawnSync(BIN, ["migrate", "import", "--bundle", dir, ...flags], { env: { ...process.env, DATABASE_URL }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`import failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

async function startStandard() {
  standard = spawn(BIN, [], {
    env: {
      ...process.env,
      ...serverSecrets(),
      DATABASE_URL,
      PORT: new URL(STANDARD).port,
      OPENPURR_CONFORMANCE: "1",
      CONFORMANCE_TOKEN,
      CONFORMANCE_STORE_BASE: STORE_BASE,
      CONFORMANCE_APPLE_ROOT_B64: fixtures.appleRootB64,
      FORWARD_SECRET: env("MIGRATION_FORWARD_SECRET"),
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${STANDARD}/healthz`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Standard didn't start");
}

/** A request to another server, with the owner token. */
async function at(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${owner()}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, text };
}

/** An SDK request to another server, as the iOS SDK makes it. */
const sdk = (base: string, path: string, body?: unknown) =>
  at(base, body === undefined ? "GET" : "POST", path, body, {
    authorization: "Bearer appl_test_ios_0123456789",
    "x-platform": "iOS",
    "x-version": "5.103.1",
    "x-revenuecat-etag": "",
    "x-is-sandbox": "true",
  });

const withoutTime = (body: any) => {
  const { request_date, request_date_ms, ...rest } = body;
  delete rest.subscriber.last_seen;
  return rest;
};

const setAttributes = (user: string, attributes: Record<string, unknown>) => call(`/v1/subscribers/${encodeURIComponent(user)}/attributes`, { body: { attributes } });

let bundle = "";
let operator: { email: string; password: string } = { email: "", password: "" };
let secretKey = "";

beforeAll(async () => {
  await reset(withWebhooks(withGooglePlay()));

  // App Store: a subscription renewed by notification, a lifetime purchase, a refund, an
  // anonymous buyer.
  const alice = await postAppleTransaction("alice");
  expect(alice.res.status).toBe(200);
  const renewal = await signNotification({
    type: "DID_RENEW",
    status: 1,
    transaction: { ...alice.payload, transactionId: `${alice.payload.transactionId}9`, purchaseDate: now(), expiresDate: now() + 30 * DAY },
  });
  expect((await postNotification(renewal.signedPayload)).status).toBe(200);
  expect((await postAppleTransaction("bob", { productId: "lifetime", type: "Non-Consumable" })).res.status).toBe(200);
  const carol = await postAppleTransaction("carol", { productId: "pro_annual" });
  const refund = await signNotification({ type: "REFUND", transaction: { ...carol.payload, revocationDate: now(), revocationReason: 0 } });
  expect((await postNotification(refund.signedPayload)).status).toBe(200);
  expect((await postAppleTransaction(ANON, { productId: "pro_monthly" })).res.status).toBe(200);

  // Google Play, verified with the (fake) Play Developer API.
  fake.google({
    "GET /purchases/subscriptionsv2/tokens/tok-mig": () => ({ body: playSubscription({ ack: true, expiry: now() + 30 * DAY, orderId: "GPA.9000-0000-0000-00001" }) }),
    "GET /orders/GPA.9000-0000-0000-00001": () => ({ body: { orderId: "GPA.9000-0000-0000-00001", total: { currencyCode: "EUR", units: "4", nanos: 490000000 } } }),
  });
  const gina = await call("/v1/receipts", {
    platform: "android",
    body: { app_user_id: "gina", fetch_token: "tok-mig", product_ids: ["pro"], platform_product_ids: [{ product_id: "pro", base_plan_id: "monthly", offer_id: null }] },
  });
  expect(gina.status).toBe(200);

  // Attributes, a promotional grant, a secret key and an operator with a password.
  await setAttributes("alice", { $email: { value: "alice@example.com", updated_at_ms: 1000 } });
  expect((await admin("POST", "/customers/bob/grants", {}, { body: { entitlement_id: "annual_perks", duration: "monthly" } })).status).toBe(201);
  const key = await admin("POST", "/secret-keys", {}, { body: { name: "backend" } });
  expect(key.status).toBe(201);
  secretKey = key.body.key;
  operator = await createOperator("viewer");

  // Webhooks delivered, chart totals rolled up.
  await settle();
  await jobs();
  expect(fake.events("backend").length).toBeGreaterThan(0);
});

afterAll(() => {
  standard?.kill("SIGTERM");
});

describe("moving from Lite to Standard", () => {
  it("exports Lite with the CLI and imports it into Standard", async () => {
    bundle = join(work, "full");
    const started = Date.now();
    const exported = await openpurr("export", "--url", TARGET, "--out", bundle);
    expect(exported.code, exported.stderr).toBe(0);
    const exportMs = Date.now() - started;
    const out = importBundle(bundle, "--replace");
    expect(out).toMatch(/Imported \d+ rows/);
    console.log(`migration: export ${exportMs} ms; ${out.trim().split("\n").at(-2)}`);
    await startStandard();
  });

  it("verifies: every customer and chart is the same on both", async () => {
    const r = await openpurr("migrate", "verify", "--from", TARGET, "--to", STANDARD, "--json");
    const report = JSON.parse(r.stdout);
    console.log(`migration: verify compared ${report.customers} customers and ${report.charts} charts`);
    expect(report.customer_differences).toEqual([]);
    expect(report.only_on_from).toEqual([]);
    expect(report.only_on_to).toEqual([]);
    expect(report.chart_differences).toEqual([]);
    expect(report.customers).toBe(5); // alice, bob, carol, gina and the anonymous buyer
    expect(r.code).toBe(0);
  });

  it("keeps keys, tokens and passwords working", async () => {
    // The owner's access token (its hash moved).
    expect((await at(STANDARD, "GET", "/admin/v1/me")).status).toBe(200);
    // The secret key.
    const viaKey = await at(STANDARD, "GET", "/v1/subscribers/alice", undefined, { authorization: `Bearer ${secretKey}` });
    expect(viaKey.status).toBe(200);
    expect(viaKey.body.subscriber.entitlements.pro).toBeTruthy();
    // The operator's password (same OPERATOR_SECRET).
    const login = await at(STANDARD, "POST", "/admin/v1/auth/login", { email: operator.email, password: operator.password }, { authorization: "", origin: STANDARD });
    expect(login.status, login.text).toBe(200);
    // The public SDK key, and what the SDK sees.
    const lite = await sdk(TARGET, "/v1/subscribers/carol");
    const std = await sdk(STANDARD, "/v1/subscribers/carol");
    expect(withoutTime(std.body)).toEqual(withoutTime(lite.body));
  });

  it("carries a delta: purchases, a merge and attributes after the export", async () => {
    expect((await postAppleTransaction("dan")).res.status).toBe(200);
    await setAttributes("alice", { $displayName: { value: "Alice", updated_at_ms: 2000 } });
    // The anonymous buyer logs in as bob: merged into bob, the anonymous customer is gone.
    const login = await call("/v1/subscribers/identify", { body: { app_user_id: ANON, new_app_user_id: "bob" } });
    expect(login.status).toBe(200);
    await settle();

    // Before the delta, verify sees the changes.
    const before = await openpurr("migrate", "verify", "--from", TARGET, "--to", STANDARD, "--json");
    expect(before.code).toBe(1);

    const delta = join(work, "delta");
    const exported = await openpurr("export", "--url", TARGET, "--out", delta, "--since", bundle);
    expect(exported.code, exported.stderr).toBe(0);
    expect(importBundle(delta)).toMatch(/customers changed, 1 deleted/);

    const after = await openpurr("migrate", "verify", "--from", TARGET, "--to", STANDARD, "--json");
    const report = JSON.parse(after.stdout);
    expect(report.customer_differences).toEqual([]);
    expect(report.only_on_from).toEqual([]);
    expect(report.only_on_to).toEqual([]);
    expect(report.chart_differences).toEqual([]);
    expect(after.code).toBe(0);
    expect((await at(STANDARD, "GET", "/admin/v1/customers/dan")).status).toBe(200);
  });

  it("forward mode: Lite's Workers send every request to Standard", async () => {
    // An SDK read through Lite's SDK Worker is Standard's answer.
    const through = await sdk(FORWARD_SDK, "/v1/subscribers/alice");
    const direct = await sdk(STANDARD, "/v1/subscribers/alice");
    expect(through.status).toBe(200);
    expect(withoutTime(through.body)).toEqual(withoutTime(direct.body));

    // A purchase through it lands on Standard, not Lite.
    const erin = await postAppleTransactionTo(FORWARD_SDK, "erin");
    expect(erin.status).toBe(200);
    expect((await at(STANDARD, "GET", "/admin/v1/customers/erin")).status).toBe(200);
    expect((await admin("GET", "/customers/erin")).status).toBe(404);

    // A store notification through the back-office Worker, and the admin API.
    const renewal = await signNotification({ type: "DID_RENEW", status: 1, transaction: { ...erin.payload, transactionId: `${erin.payload.transactionId}9`, expiresDate: now() + 60 * DAY } });
    const notified = await fetch(`${FORWARD_OFFICE}/notifications/apple`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedPayload: renewal.signedPayload }) });
    expect(notified.status).toBe(200);
    const customer = await at(FORWARD_OFFICE, "GET", "/admin/v1/customers/erin");
    expect(customer.status).toBe(200);
    expect(customer.body.transactions.length).toBe(2);
    expect((await admin("GET", "/customers/erin")).status).toBe(404);

    // The dashboard's same-origin check passes for the address the browser used (Lite's).
    expect((await at(FORWARD_OFFICE, "POST", "/admin/v1/auth/login", { email: "nobody@example.com", password: "wrong password here" }, { authorization: "", origin: FORWARD_OFFICE })).status).toBe(401);
  });
});

/** postAppleTransaction against another server. */
async function postAppleTransactionTo(base: string, appUserId: string) {
  const { signTransaction } = await import("../src");
  const { jws, payload } = await signTransaction();
  const res = await sdk(base, "/v1/receipts", {
    app_user_id: appUserId,
    fetch_token: jws,
    product_id: payload.productId,
    transaction_id: payload.transactionId,
    is_restore: false,
    initiation_source: "purchase",
  });
  return { status: res.status, payload };
}
