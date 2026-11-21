// The savings calculator's cost model: what RevenueCat's list price and openpurr Lite on Cloudflare
// cost at a given monthly revenue. Used by the home page (build time and in the browser) and by
// scripts/savings-table.mjs, which prints the READMEs' table rows. When a price changes, update it
// here and PRICES_CHECKED, paste the new rows into all 17 READMEs, and re-record their animation
// with scripts/record-savings.mjs.

/** When the prices below were last checked against revenuecat.com/pricing and Cloudflare's pricing pages. */
export const PRICES_CHECKED = "2026-11-21";

/** RevenueCat Pro: nothing below $2,500 of monthly tracked revenue (MTR), then 1% of all of it. */
export const RC = { threshold: 2_500, rate: 0.01 };

/** Cloudflare Workers Paid, per account per month. D1's included reads, writes and storage are far above what Lite uses at these levels. */
export const CF = {
  base: 5,
  includedRequests: 10_000_000,
  perMillionRequests: 0.3,
  includedCpuMs: 30_000_000,
  perMillionCpuMs: 0.02,
  /** The free plan's daily request limit. */
  freeRequestsPerDay: 100_000,
};

/**
 * Usage assumptions that turn revenue into requests. Every app differs; these are deliberately
 * round. The SDKs make about 5 requests each time the app starts or returns to the foreground
 * (spec/sdk-wire-contract.md, "Startup sequence"), so about 10 a day for a user who opens it twice.
 */
export const USAGE = {
  /** Monthly revenue per daily active user, in USD. */
  revenuePerDailyUser: 1.5,
  requestsPerDailyUser: 10,
  /** Average CPU time per request, in ms (Lite is built to stay under 10). */
  cpuMsPerRequest: 3,
  /** Move to Workers Paid when estimated daily requests pass this share of the free limit (the dashboard warns at 75%). */
  headroom: 0.75,
};

const DAYS_PER_MONTH = 30.4;

export const revenueCatCost = (mrr: number): number => (mrr >= RC.threshold ? mrr * RC.rate : 0);

export const requestsPerDay = (mrr: number): number => (mrr / USAGE.revenuePerDailyUser) * USAGE.requestsPerDailyUser;

/** The monthly revenue above which we assume you'd move to Workers Paid. */
export const paidPlanFrom = (): number =>
  ((CF.freeRequestsPerDay * USAGE.headroom) / USAGE.requestsPerDailyUser) * USAGE.revenuePerDailyUser;

export const openpurrCost = (mrr: number): { cost: number; plan: "free" | "paid" } => {
  if (mrr <= paidPlanFrom()) return { cost: 0, plan: "free" };
  const requests = requestsPerDay(mrr) * DAYS_PER_MONTH;
  const cpu = requests * USAGE.cpuMsPerRequest;
  const cost =
    CF.base +
    (Math.max(0, requests - CF.includedRequests) / 1e6) * CF.perMillionRequests +
    (Math.max(0, cpu - CF.includedCpuMs) / 1e6) * CF.perMillionCpuMs;
  return { cost, plan: "paid" };
};

export const savings = (mrr: number) => {
  const rc = revenueCatCost(mrr);
  const op = openpurrCost(mrr);
  return { rc, op: op.cost, plan: op.plan, perMonth: rc - op.cost, perYear: (rc - op.cost) * 12 };
};

/** The revenue levels in the table (and the README's). */
export const LEVELS = [2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];

/** The slider's range: $500 to $250,000 a month, on a log scale. */
export const SLIDER = { min: 500, max: 250_000, initial: 25_000 };
