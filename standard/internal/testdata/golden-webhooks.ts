// Generates golden-webhooks.json: what Lite's own webhook delivery (lite/src/webhooks.ts) and ECB
// parsing (lite/src/fx.ts) produce for a set of inputs, so the Go tests can check Standard's
// signatures, requests, retry schedule and recorded results byte for byte.
//
// Delivery runs Lite's deliverNow and retryDueDeliveries against a fake D1 (it returns the rows a
// case lists and records the updates) and a fake fetch (it records each request and answers with
// the case's status, or throws the case's error).
//
// Regenerate after changing that code in Lite, from the repo root:
//   lite/node_modules/.bin/esbuild standard/internal/testdata/golden-webhooks.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/golden-webhooks.mjs && node /tmp/golden-webhooks.mjs > standard/internal/testdata/golden-webhooks.json

import { parseConfig } from "../../../lite/src/config";
import type { Env } from "../../../lite/src/env";
import { parseEcbXml } from "../../../lite/src/fx";
import { deliverNow, RETRIES_PER_RUN, RETRY_DELAYS_MS, retryDueDeliveries, signatureHeader } from "../../../lite/src/webhooks";

const NOW = 1_800_000_000_000;
// Signatures use the current time.
const SIGN_NOW = 1_800_000_123_456;
Date.now = () => SIGN_NOW;

const url = (name: string) => `https://hooks.example.com/${name}`;
const config = parseConfig({
  version: 2,
  projects: {
    default: {
      apps: {
        ios: {
          store: "app_store",
          bundle_id: "com.example.openpurr",
          sdk_keys: ["appl_test_ios_0123456789"],
          products: { pro_monthly: { type: "subscription" } },
        },
      },
      entitlements: {},
      offerings: [],
      webhooks: [
        { id: "both", url: url("both"), authorization_secret: "HOOK_AUTH", signing_secret: "HOOK_SIGNING" },
        { id: "signed", url: url("signed"), signing_secret: "HOOK_SIGNING" },
        { id: "auth", url: url("auth"), authorization_secret: "HOOK_AUTH" },
        { id: "plain", url: url("plain") },
        { id: "rotating", url: url("rotating"), signing_secret: "HOOK_ROTATING" },
        { id: "no-auth", url: url("no-auth"), authorization_secret: "UNSET_AUTH", signing_secret: "HOOK_SIGNING" },
        { id: "no-signing", url: url("no-signing"), signing_secret: "UNSET_SIGNING" },
        { id: "empty-keys", url: url("empty-keys"), signing_secret: "HOOK_COMMAS" },
      ],
    },
  },
});

const secrets: Record<string, string> = {
  HOOK_AUTH: "Bearer hook-secret-123",
  HOOK_SIGNING: "whsec_test_signing_key",
  HOOK_ROTATING: " old-key, new-key ,",
  HOOK_COMMAS: " , ,",
  UNSET_SIGNING: "",
};

interface Row {
  event_id: string;
  app_id: string;
  endpoint: string;
  attempts: number;
  body: string;
}

interface Answer {
  status?: number;
  throw?: string;
}

interface Case {
  name: string;
  /** "now" for deliverNow, "retry" for retryDueDeliveries. */
  kind: "now" | "retry";
  rows: Row[];
  /** By endpoint URL; 200 when missing. */
  answers?: Record<string, Answer>;
}

const body = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ api_version: "1.0", event: { id, type: "INITIAL_PURCHASE", app_id: "ios", note: "é ✓ 😀", ...extra } });
const row = (endpoint: string, attempts = 0, id = `evt-${endpoint}-${attempts}`, appId = "ios"): Row => ({
  event_id: id,
  app_id: appId,
  endpoint,
  attempts,
  body: body(id),
});

const cases: Case[] = [
  { name: "delivered, with Authorization and a signature", kind: "now", rows: [row("both")] },
  { name: "signed only", kind: "now", rows: [row("signed")], answers: { [url("signed")]: { status: 204 } } },
  { name: "Authorization only", kind: "now", rows: [row("auth")] },
  { name: "neither", kind: "now", rows: [row("plain")] },
  { name: "two keys during a rotation", kind: "now", rows: [row("rotating")] },
  { name: "a signing secret of only commas", kind: "now", rows: [row("empty-keys")] },
  { name: "the Authorization secret isn't set", kind: "now", rows: [row("no-auth")] },
  { name: "the signing secret is empty", kind: "now", rows: [row("no-signing")] },
  { name: "an endpoint no longer configured", kind: "now", rows: [row("gone")] },
  { name: "an app no longer configured", kind: "now", rows: [row("both", 0, "evt-old-app", "old-app")] },
  { name: "HTTP 500", kind: "now", rows: [row("both")], answers: { [url("both")]: { status: 500 } } },
  { name: "HTTP 404", kind: "now", rows: [row("both")], answers: { [url("both")]: { status: 404 } } },
  { name: "a network error", kind: "now", rows: [row("both")], answers: { [url("both")]: { throw: "connection refused" } } },
  { name: "a long error is cut to 500 characters", kind: "now", rows: [row("both")], answers: { [url("both")]: { throw: "x".repeat(498) + "😀😀" } } },
  ...RETRY_DELAYS_MS.map((_, i) => ({
    name: `retry after ${i + 1} failed attempts`,
    kind: "retry" as const,
    rows: [row("both", i + 1)],
    answers: { [url("both")]: { status: 503 } },
  })),
  { name: "a retry that succeeds", kind: "retry", rows: [row("both", 3)] },
  {
    name: "several deliveries at once",
    kind: "retry",
    rows: [row("both", 1), row("plain", 2), row("gone", 1), row("signed", 9)],
    answers: { [url("plain")]: { status: 502 }, [url("signed")]: { status: 400 } },
  },
];

async function runCase(c: Case) {
  const requests: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const updates: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args;
          return stmt;
        },
        async all() {
          return { results: c.rows };
        },
      };
      return stmt;
    },
    async batch(stmts: { args: unknown[] }[]) {
      for (const s of stmts) updates.push({ sql: "", args: s.args });
      return [];
    },
  };
  const fetchImpl = (async (input: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k.toLowerCase()] = v;
    requests.push({ url: input, method: init.method!, headers, body: String(init.body) });
    const answer = c.answers?.[input] ?? {};
    if (answer.throw) throw new Error(answer.throw);
    return new Response(null, { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  const env = { DB: db, ...secrets } as unknown as Env;
  const n =
    c.kind === "now"
      ? await deliverNow(env, config, fetchImpl, c.rows.map((r) => r.event_id), NOW)
      : await retryDueDeliveries(env, config, fetchImpl, NOW);
  return {
    name: c.name,
    kind: c.kind,
    rows: c.rows,
    answers: c.answers ?? {},
    attempted: n,
    // Requests in the order they were made, which is row order.
    requests,
    // Each update's bound values: [status, attempts, last_status, last_error, next_attempt_at,
    // event_id, endpoint] for a failure, [attempts, last_status, delivered_at, event_id, endpoint]
    // for a success.
    updates: updates.map((u) => u.args),
  };
}

const signatures = [
  { secrets: ["whsec_test_signing_key"], body: "{}", nowMs: 1_700_000_000_000 },
  { secrets: ["old-key", "new-key"], body: "{}", nowMs: 1_700_000_000_000 },
  { secrets: ["k"], body: JSON.stringify({ a: "é ✓ 😀", b: [1, 2.5, null] }), nowMs: 1_800_000_000_999 },
  { secrets: [], body: "{}", nowMs: 1_800_000_000_000 },
  { secrets: ["ключ"], body: "", nowMs: 999 },
].map((s) => ({ ...s }));

const ecbXml = (days: { time: string; rates: Record<string, string> }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><Cube>${days
    .map((d) => `<Cube time='${d.time}'>\n${Object.entries(d.rates).map(([c, r]) => `\t<Cube currency='${c}' rate='${r}'/>`).join("\n")}\n</Cube>`)
    .join("")}</Cube></gesmes:Envelope>`;

const ecbCases = [
  { name: "one day", xml: ecbXml([{ time: "2026-11-18", rates: { USD: "1.25", JPY: "175", GBP: "0.85" } }]) },
  {
    name: "ECB's daily file",
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
\t<gesmes:subject>Reference rates</gesmes:subject>
\t<Cube>
\t\t<Cube time="2026-11-20">
\t\t\t<Cube currency="USD" rate="1.0543"/>
\t\t\t<Cube currency="JPY" rate="163.12"/>
\t\t\t<Cube currency="BGN" rate="1.9558"/>
\t\t\t<Cube currency="CZK" rate="25.272"/>
\t\t\t<Cube currency="DKK" rate="7.4589"/>
\t\t\t<Cube currency="GBP" rate="0.83283"/>
\t\t\t<Cube currency="HUF" rate="410.43"/>
\t\t\t<Cube currency="IDR" rate="16759.46"/>
\t\t\t<Cube currency="KRW" rate="1474.86"/>
\t\t</Cube>
\t</Cube>
</gesmes:Envelope>`,
  },
  {
    name: "several days, newest first",
    xml: ecbXml([
      { time: "2026-11-20", rates: { USD: "1.0543", CHF: "0.9312" } },
      { time: "2026-11-19", rates: { USD: "1.0512", CHF: "0.9301", EUR: "2" } },
      { time: "2026-11-18", rates: { JPY: "175" } },
    ]),
  },
  { name: "malformed rates", xml: ecbXml([{ time: "2026-11-18", rates: { USD: "1", XYZ: "0", ABC: "1.2.3", DEF: "5.", GHI: ".5", JKL: "." } }]) },
  { name: "a repeated currency", xml: ecbXml([{ time: "2026-11-18", rates: { USD: "1.1", GBP: "0.8", gbp: "1", GBP2: "1" } }]).replace("GBP2", "GBP") },
  { name: "no USD", xml: ecbXml([{ time: "2026-11-18", rates: { JPY: "175" } }]) },
  { name: "nothing", xml: "<html>Service unavailable</html>" },
];

const out = {
  now: NOW,
  signNow: SIGN_NOW,
  retryDelaysMs: RETRY_DELAYS_MS,
  retriesPerRun: RETRIES_PER_RUN,
  config: config.document,
  secrets,
  signatures: await Promise.all(signatures.map(async (s) => ({ ...s, header: await signatureHeader(s.secrets, s.body, s.nowMs) }))),
  delivery: [] as unknown[],
  ecb: ecbCases.map((c) => ({ ...c, days: parseEcbXml(c.xml) })),
};
for (const c of cases) out.delivery.push(await runCase(c));
console.log(JSON.stringify(out, null, 1));
