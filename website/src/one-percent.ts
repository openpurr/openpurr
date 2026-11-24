// The "Where your 1% goes" page's model: an estimate of what RevenueCat's revenue share pays for,
// built from public figures only. Teams are job functions, never people: no names, and no one's
// pay. Every number here is an estimate; the page says so and lists the sources.
//
// Headcount by function is our assumption, scaled to the public total; salaries are from RevenueCat's
// public job board where it lists the function, and otherwise from its other postings. When you
// update a figure, update SOURCES_CHECKED too.

/** When the figures below were last checked. */
export const SOURCES_CHECKED = "2026-11-22";

/** Public estimates of RevenueCat's headcount range (aggregators), and the figure we use. */
export const HEADCOUNT = { low: 130, high: 185, used: 150 };

/** Total venture funding, as reported when the Series C was announced (TechCrunch, May 2025). */
export const FUNDING_USD = 100_000_000;

/**
 * RevenueCat's funding rounds, from press coverage. `post` is the reported post-money valuation
 * where there is one; `lead` only where a source names it.
 */
export interface Round {
  name: string;
  year: number;
  amount: number;
  post: number | null;
  lead: string | null;
  investors: string[];
}

export const ROUNDS: Round[] = [
  { name: "Seed", year: 2018, amount: 1_500_000, post: 7_000_000, lead: "SaaStr Fund", investors: ["SaaStr Fund", "Y Combinator"] },
  // SaaStr gives both $15M and $60M for the Series A valuation; $60M fits a $15M round. Clay names Index Ventures.
  { name: "Series A", year: 2020, amount: 15_000_000, post: 60_000_000, lead: null, investors: ["Index Ventures"] },
  { name: "Series B", year: 2021, amount: 40_000_000, post: 300_000_000, lead: "Y Combinator Continuity", investors: ["Y Combinator Continuity", "Index Ventures", "SaaStr Fund", "Oakhouse", "Adjacent", "FundersClub"] },
  { name: "Series C (first close)", year: 2024, amount: 12_000_000, post: null, lead: "Adjacent", investors: ["Adjacent"] },
  { name: "Series C", year: 2025, amount: 50_000_000, post: 500_000_000, lead: "Bain Capital Ventures", investors: ["Bain Capital Ventures", "Index Ventures", "Y Combinator", "Adjacent", "Volo Ventures", "SaaStr Fund"] },
];

/** Every firm that has invested, in order of first appearance. */
export const INVESTORS = [...new Set(ROUNDS.flatMap((r) => r.investors))];

/**
 * The share of RevenueCat its investors own, compounded round by round: each round's investors get
 * amount / post-money, and everyone before is diluted by the same share. The 2024 round has no
 * reported valuation; we assume the Series B's. Employee option pools and Y Combinator's
 * accelerator stake aren't counted, so the real figure is likely a little different.
 */
export const investorOwnership = () =>
  ROUNDS.reduce((owned, r) => {
    const share = r.amount / (r.post ?? 300_000_000);
    return owned * (1 - share) + share;
  }, 0);

/** Rounded down to the nearest 5%, which is what the page shows. */
export const INVESTOR_OWNERSHIP = Math.floor(investorOwnership() * 20) / 20;

/** Reported revenue and valuation at the 2025 round (Multiples.vc estimate, not company figures). */
export const REVENUE_2025 = 30_000_000;
export const VALUATION_2025 = 500_000_000;

/**
 * Salary to cost: payroll taxes, benefits, equipment and software per person. Equity isn't
 * included, though every posting offers it.
 */
export const LOADED = 1.3;

/**
 * What RevenueCat's job board listed when we checked: why the split leans to sales, marketing and
 * growth (a Series C company building out go-to-market) rather than engineering.
 */
export const JOB_BOARD = { open: 10, gtm: 4, coreEngineering: 0 };

/** Teams by key; their names and where each salary comes from are in i18n/pricing (`teams`). */
export interface Team {
  key: string;
  /** People in this function (our assumption; they add up to HEADCOUNT.used). */
  people: number;
  /** Typical base salary in USD, from public postings. */
  salary: number;
}

// Go-to-market teams first: at its stage, that is where most of the money goes.
export const TEAMS: Team[] = [
  { key: "growth", people: 30, salary: 200_000 },
  { key: "sales", people: 26, salary: 200_000 },
  { key: "community", people: 8, salary: 180_000 },
  { key: "eng", people: 36, salary: 210_000 },
  { key: "product", people: 12, salary: 225_000 },
  { key: "support", people: 14, salary: 135_000 },
  { key: "ops", people: 16, salary: 170_000 },
  { key: "exec", people: 8, salary: 350_000 },
];

/** Yearly cost of each team, loaded. */
export const teamCost = (t: Team) => t.people * t.salary * LOADED;
export const TOTAL_TEAM_COST = TEAMS.reduce((s, t) => s + teamCost(t), 0);

/** Each team's share of the people costs, which is how we split the part of your fee that isn't servers. */
export const shareOf = (t: Team) => teamCost(t) / TOTAL_TEAM_COST;

/** A RevenueCat employee's public post about their company skateboard (shown as a screenshot). */
export const SWAG_POST = { date: "2026-11-24", url: "https://x.com/drbarnard/status/2125297380887294231" };

/** The sources, in the order of i18n/pricing's `sources.items` labels. */
export const SOURCES = [
  { url: "https://www.revenuecat.com/pricing/" },
  { url: "https://jobs.ashbyhq.com/revenuecat" },
  { url: "https://job-boards.greenhouse.io/revenuecat" },
  { url: "https://techcrunch.com/2025/05/22/revenuecat-raises-50m-as-it-expands-beyond-mobile-app-monetization" },
  { url: "https://techcrunch.com/?p=2157127" },
  { url: "https://techcrunch.com/2024/04/25/revenuecat-raises-12m-series-c-as-it-expands-its-subscription-management-to-the-web/" },
  { url: "https://www.saastr.com/how-saastr-fund-backed-revenuecat-went-from-a-1-5m-round-at-7m-valuation-in-2018-to-500m-today" },
  { url: "https://multiples.vc/private-comps/revenuecat" },
  { url: "https://www.tipranks.com/private-companies/revenuecat" },
  { url: "https://trueup.io/co/revenuecat" },
];
