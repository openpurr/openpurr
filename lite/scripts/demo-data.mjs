// Demo data for screenshots and trying the dashboard: a realistic, reproducible purchase history in
// the LOCAL database only (wrangler dev). There is deliberately no option to write anywhere else.
//
//   pnpm demo:data                 adds 18 months of demo customers and purchases
//   pnpm demo:data --wipe          first deletes ALL customers and purchases in the local database
//   pnpm demo:data --remove        deletes the demo data only
//   options: --months 18  --seed 7  --scale 1 (customers per day multiplier)
//
// Everything is fictional: anonymous IDs, user_… IDs and @example.com emails. Demo customers'
// internal IDs start with "demo-", which is how --remove finds them and their purchases. Apps and products
// come from your openpurr.config.yaml (compiled to src/config.generated.json): monthly and annual
// subscriptions (with a 7-day trial), a lifetime unlock and a consumable, where defined.
// Then open the dashboard's Charts page; it rebuilds the chart totals on first view.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    months: { type: "string", default: "18" },
    seed: { type: "string", default: "7" },
    scale: { type: "string", default: "1" },
    wipe: { type: "boolean", default: false },
    remove: { type: "boolean", default: false },
  },
});

const DAY = 864e5;
const NOW = Date.now();
const months = Math.min(Math.max(Number(args.months) || 18, 1), 36);
const scale = Math.min(Math.max(Number(args.scale) || 1, 0.1), 5);
const START = Math.floor((NOW - months * 30.4375 * DAY) / DAY) * DAY;

// ---- Local database only ------------------------------------------------------------------------

function d1(sqlOrFile, { file = false } = {}) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "openpurr", "--local", "--json", file ? "--file" : "--command", sqlOrFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CI: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out)[0]?.results ?? [];
}

const DEMO_TABLES = `
  DELETE FROM customer_snapshot WHERE customer_id LIKE 'demo-%';
  DELETE FROM subscriber_attribute WHERE customer_id LIKE 'demo-%';
  DELETE FROM subscription_state WHERE (store, original_transaction_id) IN (SELECT store, original_transaction_id FROM purchase_owner WHERE customer_id LIKE 'demo-%');
  DELETE FROM store_transaction WHERE (store, original_transaction_id) IN (SELECT store, original_transaction_id FROM purchase_owner WHERE customer_id LIKE 'demo-%');
  DELETE FROM purchase_owner WHERE customer_id LIKE 'demo-%';
  DELETE FROM customer_alias WHERE customer_id LIKE 'demo-%';
  DELETE FROM customer WHERE id LIKE 'demo-%';
  DELETE FROM fx_rate WHERE source = 'demo';`;
const ALL_TABLES = `
  DELETE FROM webhook_delivery; DELETE FROM webhook_event; DELETE FROM customer_snapshot; DELETE FROM subscriber_attribute;
  DELETE FROM subscription_state; DELETE FROM purchase_owner; DELETE FROM store_transaction; DELETE FROM customer_alias; DELETE FROM customer;
  DELETE FROM fx_rate WHERE source = 'demo';`;
// The chart totals are derived: clearing them makes the next refresh rebuild everything.
const RESET_CHARTS = `DELETE FROM metric_daily; DELETE FROM job_state WHERE key = 'metrics_rollup';`;

if (args.remove) {
  d1(DEMO_TABLES + RESET_CHARTS);
  console.log("Removed the demo data from the local database.");
  process.exit(0);
}
const [{ n: others } = { n: 0 }] = d1("SELECT count(*) AS n FROM customer WHERE id NOT LIKE 'demo-%'");
if (others && !args.wipe) {
  console.error(`The local database has ${others} other customers. Add --wipe to delete them first (local only), or --remove to drop earlier demo data.`);
  process.exit(1);
}

// ---- Deterministic randomness -------------------------------------------------------------------

let seed = Number(args.seed) >>> 0 || 7;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p) => rand() < p;
const pick = (weighted) => {
  const total = weighted.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [v, w] of weighted) if ((r -= w) < 0) return v;
  return weighted.at(-1)[0];
};
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
const digits = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join("");

// ---- Catalog from the config --------------------------------------------------------------------

const config = JSON.parse(readFileSync(new URL("../src/config.generated.json", import.meta.url), "utf8"));
const apps = Object.entries(config.apps).map(([id, a]) => {
  const products = Object.entries(a.products ?? {});
  const subs = products.filter(([, p]) => p.type === "subscription");
  let monthly = null;
  let annual = null;
  for (const [pid, p] of subs) {
    if (a.store === "play_store" && p.base_plans?.length) {
      const plan = (re) => p.base_plans.find((b) => re.test(b));
      if (!monthly && plan(/month/i)) monthly = { product: pid, basePlan: plan(/month/i) };
      if (!annual && plan(/year|annual/i)) annual = { product: pid, basePlan: plan(/year|annual/i) };
    } else if (/year|annual/i.test(pid)) annual ??= { product: pid, basePlan: null };
    else monthly ??= { product: pid, basePlan: null };
  }
  return {
    id,
    store: a.store,
    monthly,
    annual,
    lifetime: products.find(([, p]) => p.type === "non_consumable")?.[0] ?? null,
    consumable: products.find(([, p]) => p.type === "consumable")?.[0] ?? null,
  };
});
const appStore = apps.find((a) => a.store === "app_store");
const playStore = apps.find((a) => a.store === "play_store");
if (!apps.some((a) => a.monthly || a.annual)) {
  console.error("No subscription products in the config; add some to openpurr.config.yaml first.");
  process.exit(1);
}

// Local prices: monthly, annual, lifetime, consumable. Apple storefronts are ISO alpha-3, Google regions alpha-2.
const MARKETS = [
  { weight: 44, a3: "USA", a2: "US", currency: "USD", prices: [9.99, 59.99, 99.99, 1.99], perUsd: 1 },
  { weight: 8, a3: "GBR", a2: "GB", currency: "GBP", prices: [8.99, 54.99, 89.99, 1.99], perUsd: 0.79 },
  { weight: 7, a3: "DEU", a2: "DE", currency: "EUR", prices: [9.99, 59.99, 99.99, 1.99], perUsd: 0.92 },
  { weight: 5, a3: "FRA", a2: "FR", currency: "EUR", prices: [9.99, 59.99, 99.99, 1.99], perUsd: 0.92 },
  { weight: 5, a3: "CAN", a2: "CA", currency: "CAD", prices: [12.99, 79.99, 139.99, 2.79], perUsd: 1.36 },
  { weight: 4, a3: "AUS", a2: "AU", currency: "AUD", prices: [14.99, 89.99, 149.99, 2.99], perUsd: 1.52 },
  { weight: 5, a3: "JPN", a2: "JP", currency: "JPY", prices: [1500, 9000, 15000, 300], perUsd: 150 },
  { weight: 6, a3: "BRA", a2: "BR", currency: "BRL", prices: [34.9, 199.9, 349.9, 6.9], perUsd: 5.0 },
  { weight: 8, a3: "IND", a2: "IN", currency: "INR", prices: [499, 2999, 4999, 99], perUsd: 83 },
  { weight: 4, a3: "MEX", a2: "MX", currency: "MXN", prices: [179, 1099, 1799, 35], perUsd: 17.5 },
  { weight: 4, a3: "ESP", a2: "ES", currency: "EUR", prices: [9.99, 59.99, 99.99, 1.99], perUsd: 0.92 },
];
const FIRST = ["maya", "leo", "nora", "theo", "ava", "sam", "iris", "omar", "lena", "kai", "zoe", "ravi", "ines", "jonah", "mila", "ezra", "tara", "felix", "noa", "arlo"];

// ---- Simulation ---------------------------------------------------------------------------------

const sql = [];
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const row = (table, cols, vals) => sql.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${vals.map(q).join(", ")});`);

let customers = 0;
let purchases = 0;
let txSeq = 0;
// Store IDs and app user IDs must be unique; random ones are retried on the rare collision.
const used = new Set();
const unique = (make) => () => {
  for (;;) {
    const v = make();
    if (!used.has(v)) return used.add(v), v;
  }
};
const ids = {
  appleTx: unique(() => `2000000${digits(9)}`),
  googleOrder: unique(() => `GPA.${digits(4)}-${digits(4)}-${digits(4)}-${digits(5)}`),
  token: unique(() => hex(48)),
  userId: unique(() => `user_${digits(7)}`),
};

function addTx(c, app, t) {
  const store = app.store;
  // Apple: the first transaction's ID is the chain's original ID. Google: order IDs gain ..0, ..1 per renewal.
  const transactionId = store === "app_store" ? (t.renewal ? ids.appleTx() : t.chainId) : `${t.order}${t.renewal ? `..${t.renewal - 1}` : ""}`;
  const updated = Math.min(Math.max(t.revoked ?? t.purchased, t.purchased) + 3600_000, NOW);
  row(
    "store_transaction",
    ["app_id", "store", "environment", "transaction_id", "original_transaction_id", "product_id", "base_plan_id", "product_type", "purchased_at", "original_purchased_at",
      "expires_at", "period_type", "price_micros", "currency", "storefront", "revoked_at", "revocation_reason", "verified", "source", "received_at", "updated_at"],
    [app.id, store, "production", transactionId, t.chainId, t.product, t.basePlan, t.type, t.purchased, t.original, t.expires ?? null, t.period, Math.round(t.price * 1e6),
      c.market.currency, store === "app_store" ? c.market.a3 : c.market.a2, t.revoked ?? null, t.revoked ? "customer_request" : null, 1,
      t.renewal ? "notification" : "sdk", Math.min(t.purchased + 2000, NOW), updated],
  );
  txSeq++;
  purchases++;
}

function subscribe(c, app, kind, at, opts = {}) {
  const plan = app[kind];
  if (!plan) return;
  const [mPrice, aPrice] = c.market.prices;
  // New subscribers after the price increase pay more; existing ones keep their price for now.
  let price = raise(kind === "annual" ? aPrice : mPrice, c.priceFactor);
  let periodDays = kind === "annual" ? 365 : 30.4375;
  let current = { kind, product: plan.product, basePlan: plan.basePlan };
  let raised = c.priceFactor !== 1;
  let cameBack = false;
  const chainId = app.store === "app_store" ? ids.appleTx() : ids.token();
  const order = ids.googleOrder();
  const withTrial = opts.trial ?? chance(0.82);
  let renewP = kind === "annual" ? 0.62 : 0.91;
  row("purchase_owner", ["store", "original_transaction_id", "customer_id", "app_id", "updated_at"], [app.store, chainId, c.id, app.id, Math.min(at + 3600_000, NOW)]);

  let start = at;
  let renewal = 0;
  let autoRenew = 1;
  let unsubscribedAt = null;
  let grace = null;
  let status = 1;
  const base = { chainId, original: at, product: plan.product, basePlan: plan.basePlan, type: "subscription", order };

  if (withTrial) {
    const end = start + 7 * DAY;
    addTx(c, app, { ...base, purchased: start, expires: end, period: "trial", price: 0, renewal: renewal++ });
    if (chance(0.34)) unsubscribedAt = start + rand() * 6 * DAY;
    if (unsubscribedAt !== null && unsubscribedAt >= NOW) unsubscribedAt = null; // hasn't happened yet
    const converts = !unsubscribedAt && chance(opts.convert ?? 0.72);
    if (end > NOW) return finish(1);
    if (!converts) return finish(2, 0);
    start = end;
  }
  // Paid periods until churn or today.
  for (;;) {
    const end = start + periodDays * DAY;
    // Events after today haven't happened yet: they're left out, never moved to today.
    let refunded = chance(0.018) ? start + (1 + rand() * 13) * DAY : null;
    if (refunded !== null && refunded >= NOW) refunded = null;
    addTx(c, app, { ...base, product: current.product, basePlan: current.basePlan, purchased: start, expires: end, period: "normal", price, renewal: renewal++, revoked: refunded && refunded < end ? refunded : null });
    if (refunded && refunded < end) return finish(2, 0);
    if (end > NOW) {
      // Some current subscribers have turned auto-renew off: active until the period ends.
      if (chance(0.13)) unsubscribedAt = Math.max(start, NOW - rand() * 20 * DAY);
      return finish(1);
    }
    if (!chance(renewP)) {
      // A failed renewal sometimes goes through a 16-day grace period first.
      if (chance(0.25)) grace = end + 16 * DAY;
      // Some come back a month or three later, in the same subscription: a reactivation.
      if (!cameBack && chance(0.16)) {
        cameBack = true;
        const back = (grace ?? end) + (25 + rand() * 65) * DAY;
        if (back < NOW) {
          start = back;
          grace = null;
          unsubscribedAt = null;
          continue;
        }
      }
      if (unsubscribedAt === null) unsubscribedAt = end - rand() * 10 * DAY;
      // Apple keeps retrying a failed payment for up to 60 days.
      const retrying = !grace && end > NOW - 60 * DAY && chance(0.35);
      return finish(grace && grace > NOW ? 4 : retrying ? 3 : 2, retrying ? 1 : 0);
    }
    // Existing subscribers move to the new price at their first renewal 60 days after the increase.
    if (!raised && end >= STORY.priceUp + 60 * DAY) {
      price = raise(price, 1.2);
      raised = true;
    }
    // A few monthly App Store subscribers switch to the yearly plan at renewal (cheaper per month).
    if (current.kind === "monthly" && app.store === "app_store" && app.annual && chance(0.04)) {
      current = { kind: "annual", product: app.annual.product, basePlan: app.annual.basePlan };
      price = raise(aPrice, raised ? 1.2 : 1);
      periodDays = 365;
      renewP = 0.62;
    }
    start = end;
  }

  function finish(s, renew = unsubscribedAt ? 0 : autoRenew) {
    status = s;
    row(
      "subscription_state",
      ["store", "original_transaction_id", "status", "auto_renew", "unsubscribe_detected_at", "billing_issue_detected_at", "grace_period_expires_at", "signed_at", "updated_at"],
      [app.store, chainId, status, renew, unsubscribedAt, grace ? grace - 16 * DAY : null, grace, Math.min(start, NOW), Math.min(start + 3600_000, NOW)],
    );
  }
}

function oneTime(c, app, kind, at) {
  const product = app[kind];
  if (!product) return;
  const price = c.market.prices[kind === "lifetime" ? 2 : 3];
  const id = app.store === "app_store" ? ids.appleTx() : ids.token();
  row("purchase_owner", ["store", "original_transaction_id", "customer_id", "app_id", "updated_at"], [app.store, id, c.id, app.id, Math.min(at + 3600_000, NOW)]);
  addTx(c, app, { chainId: id, original: at, product, basePlan: null, type: kind === "lifetime" ? "non_consumable" : "consumable", order: ids.googleOrder(), purchased: at, period: "normal", price, renewal: 0 });
}

// The demo business's story, so revenue doesn't just mirror signups:
//   - a viral moment (22% into the range): a flood of signups who mostly don't buy;
//   - an App Store feature (45%): more signups, converting normally;
//   - a paywall redesign (55%): conversion up a third, with no change in traffic;
//   - a price increase (68%): new subscribers pay 20% more, existing ones keep their price;
//   - a New Year promotion every year (Nov 24 to Jan 7): annual plans sell 2.5 times as well, and
//     those renewals come back as a revenue spike a year later, with no matching signup spike;
//   - fewer signups in July and August;
//   - existing subscribers move to the new price 60 days after the increase (MRR expansion);
//   - a few monthly subscribers switch to yearly at renewal (MRR contraction);
//   - some churned subscribers come back a month or three later (reactivations);
//   - short trial campaigns (an influencer post, a "free week" offer) every few weeks: a burst of
//     trial starts for a few days, converting to paid less often than usual.
const at = (fraction) => START + fraction * (NOW - START);
const STORY = { viral: at(0.22), feature: at(0.45), paywall: at(0.55), priceUp: at(0.68) };
function raise(price, factor) {
  if (factor === 1) return price;
  const p = price * factor;
  return price < 100 ? Math.ceil(p) - 0.01 : Math.round(p / 10) * 10 - (price % 1 ? 0.01 : 0); // charm prices: 11.99, 71.99, 1800
}
const CAMPAIGN_COUNT = Math.max(3, Math.round(months * 0.9));
const CAMPAIGNS = Array.from({ length: CAMPAIGN_COUNT }, (_, i) => at((i + 0.3 + rand() * 0.5) / CAMPAIGN_COUNT));
const inPromo = (ms) => {
  const d = new Date(ms);
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return (m === 10 && day >= 24) || m === 11 || (m === 0 && day <= 7);
};

for (let day = START; day < NOW; day += DAY) {
  const t = (day - START) / (NOW - START);
  const weekday = new Date(day).getUTCDay();
  const month = new Date(day).getUTCMonth();
  const near = (when, widthDays) => Math.exp(-(((day - when) / DAY / widthDays) ** 2));
  const viral = near(STORY.viral, 2.5);
  const traffic =
    (14 + 70 * t ** 1.3) *
    (weekday === 0 || weekday === 6 ? 1.22 : 1) *
    (month === 6 || month === 7 ? 0.82 : 1) *
    (1 + 5.5 * viral) *
    (1 + 1.6 * near(STORY.feature, 4));
  // How likely a new customer is to buy: viral visitors rarely do; the new paywall helps.
  const conversion = (day >= STORY.paywall ? 1.35 : 1) * (1 - 0.75 * (viral * 5.5) / (1 + viral * 5.5));
  const promo = inPromo(day);
  const campaign = CAMPAIGNS.reduce((n, c) => n + near(c, 1.6), 0);
  const priceFactor = day >= STORY.priceUp ? 1.2 : 1;
  const n = Math.round(scale * traffic * (0.85 + rand() * 0.3));
  for (let i = 0; i < n; i++) {
    const firstSeen = day + Math.floor(rand() * DAY);
    if (firstSeen >= NOW) continue;
    const id = `demo-${hex(24)}`;
    const anon = `$RCAnonymousID:${hex(32)}`;
    const market = pick(MARKETS.map((m) => [m, m.weight]));
    const app = !playStore ? appStore : !appStore ? playStore : chance(0.62) ? appStore : playStore;
    const c = { id, market, priceFactor };
    row("customer", ["id", "app_user_id", "first_seen"], [id, anon, firstSeen]);
    row("customer_alias", ["app_user_id", "customer_id", "created_at"], [anon, id, firstSeen]);
    customers++;
    if (chance(0.38)) {
      const userId = ids.userId();
      row("customer_alias", ["app_user_id", "customer_id", "created_at"], [userId, id, Math.min(firstSeen + rand() * 2 * DAY, NOW)]);
      if (chance(0.7)) {
        const email = `${FIRST[Math.floor(rand() * FIRST.length)]}.${hex(4)}@example.com`;
        row("subscriber_attribute", ["customer_id", "key", "value", "updated_at", "received_at"], [id, "$email", email, firstSeen, firstSeen]);
      }
    }
    // What this customer buys, if anything.
    // (Anything that would happen after today is skipped: it hasn't happened yet.)
    const when = firstSeen + rand() * rand() * 5 * DAY;
    const r = when < NOW ? rand() / conversion : Infinity;
    const annualShare = promo ? 0.8 : 0.5;
    if (r < (promo ? 0.17 : 0.075)) subscribe(c, app, chance(annualShare) ? "annual" : "monthly", when);
    else if (r < (promo ? 0.185 : 0.09)) subscribe(c, app, "monthly", when);
    else if (r < (promo ? 0.197 : 0.102)) oneTime(c, app, "lifetime", when);
    // Trial campaigns: extra trial starts on top of the usual buyers.
    if (when < NOW && campaign > 0.05 && chance(0.3 * campaign)) subscribe(c, app, chance(0.5) ? "annual" : "monthly", when, { trial: true, convert: 0.4 });
    const later = firstSeen + rand() * 20 * DAY;
    if (later < NOW && chance(0.03)) oneTime(c, app, "consumable", later);
  }
}

// Exchange rates for every day in range (a gentle random walk around each currency's level).
const walk = new Map(MARKETS.filter((m) => m.currency !== "USD").map((m) => [m.currency, m.perUsd]));
for (let day = START - 7 * DAY; day <= NOW; day += DAY) {
  const date = new Date(day).toISOString().slice(0, 10);
  for (const [currency, level] of walk) {
    const next = level * (1 + (rand() - 0.5) * 0.006);
    walk.set(currency, next);
    sql.push(`INSERT OR IGNORE INTO fx_rate (date, currency, per_usd, source) VALUES (${q(date)}, ${q(currency)}, ${next.toFixed(6)}, 'demo');`);
  }
}

// ---- Write --------------------------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "openpurr-demo-"));
try {
  const statements = [(args.wipe ? ALL_TABLES : DEMO_TABLES) + RESET_CHARTS, ...sql];
  // Several files, so no single import gets too large.
  const CHUNK = 20_000;
  for (let i = 0, part = 0; i < statements.length; i += CHUNK, part++) {
    const file = join(dir, `part-${part}.sql`);
    writeFileSync(file, statements.slice(i, i + CHUNK).join("\n"));
    process.stdout.write(`\rWriting to the local database… ${Math.min(100, Math.round(((i + CHUNK) / statements.length) * 100))}%`);
    d1(file, { file: true });
  }
  console.log(`\n\nAdded ${customers.toLocaleString()} demo customers and ${purchases.toLocaleString()} purchases over ${months} months (seed ${args.seed}).`);
  console.log("Run the back office (wrangler dev --env office) and open /admin: the Charts page rebuilds its totals on first view.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
