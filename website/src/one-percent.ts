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
 * Salary to cost: payroll taxes, benefits, equipment and software per person. Equity isn't
 * included, though every posting offers it.
 */
export const LOADED = 1.3;

export interface Team {
  key: string;
  name: string;
  /** People in this function (our assumption; they add up to HEADCOUNT.used). */
  people: number;
  /** Typical base salary in USD, from public postings. */
  salary: number;
  /** Where the salary figure comes from. */
  basis: string;
}

export const TEAMS: Team[] = [
  { key: "eng", name: "Engineering", people: 50, salary: 210_000, basis: "Senior SDK engineer posting, $212K" },
  { key: "product", name: "Product, design and data", people: 15, salary: 225_000, basis: "Senior product manager postings, $230K; senior data scientist, $220K" },
  { key: "sales", name: "Sales", people: 14, salary: 200_000, basis: "Head of Sales posting, $363K; senior sales engineer, $200K; product expert, $133K" },
  { key: "growth", name: "Marketing and growth", people: 16, salary: 200_000, basis: "Head of Customer Growth posting, $259K; CRO designer, $205K; product marketing, $168K" },
  { key: "support", name: "Customer success and support", people: 16, salary: 135_000, basis: "Developer support engineer posting, $118K" },
  { key: "community", name: "Developer relations and community", people: 9, salary: 180_000, basis: "The postings' overall median, about $215K, discounted for a mix of levels" },
  { key: "ops", name: "Operations, finance and people", people: 22, salary: 170_000, basis: "Sales and operations specialist posting, $167K; Head of People, $280K" },
  { key: "exec", name: "Executives", people: 8, salary: 350_000, basis: "Above the Head of Sales posting ($363K) for some, below for others" },
];

/** Yearly cost of each team, loaded. */
export const teamCost = (t: Team) => t.people * t.salary * LOADED;
export const TOTAL_TEAM_COST = TEAMS.reduce((s, t) => s + teamCost(t), 0);

/** Each team's share of the people costs, which is how we split the part of your fee that isn't servers. */
export const shareOf = (t: Team) => teamCost(t) / TOTAL_TEAM_COST;

/** Working days in a year, to turn money into days of someone's time. */
export const WORKDAYS = 230;
export const engineerDayCost = () => (TEAMS.find((t) => t.key === "eng")!.salary * LOADED) / WORKDAYS;

export const SOURCES = [
  { label: "RevenueCat pricing: 1% of monthly tracked revenue from $2,500", url: "https://www.revenuecat.com/pricing/" },
  { label: "RevenueCat's job board, with pay ranges (Ashby)", url: "https://jobs.ashbyhq.com/revenuecat" },
  { label: "Earlier RevenueCat postings with pay (Greenhouse)", url: "https://job-boards.greenhouse.io/revenuecat" },
  { label: "TechCrunch: RevenueCat raises $50M, bringing its total to $100M (May 2025)", url: "https://techcrunch.com/2025/05/22/revenuecat-raises-50m-as-it-expands-beyond-mobile-app-monetization" },
  { label: "Headcount estimates: TipRanks (185)", url: "https://www.tipranks.com/private-companies/revenuecat" },
  { label: "Headcount estimates: TrueUp (130)", url: "https://trueup.io/co/revenuecat" },
];
