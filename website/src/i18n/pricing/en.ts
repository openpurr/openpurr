// The RevenueCat pricing page's English copy (/revenuecat-pricing/). It's the source the translations
// follow: its shape is the `PricingDict` type, so a translation missing a string fails astro check.
//
// Words in {braces} are filled in by the page: keep each one, exactly as written, wherever it fits
// the sentence in your language. Most are amounts the page formats ({fee}, {infra}, {valuation}…);
// in strings marked "HTML" some become highlighted numbers that move with the slider. Keep product
// and company names (openpurr, RevenueCat, Purchases SDK, Cloudflare, openpurr Lite) and investor
// firm names in English. Search results show about 60 characters of a title and 155 of a
// description (CJK: about half).

export const pricingEn = {
  meta: {
    title: "RevenueCat pricing: where your 1% actually goes · openpurr",
    description:
      "RevenueCat charges 1% of your revenue. The servers behind your app cost a rounding error. See what the rest pays for: payroll, sales and venture investors.",
    ogImageAlt: "RevenueCat takes 1% of your revenue; the servers cost a rounding error. What the rest pays for.",
  },
  hero: {
    crumb: "RevenueCat pricing",
    eyebrow: "Where your 1% goes",
    headline: "You're not paying for servers.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "You're paying for a {valuation} company.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat takes 1% of all your tracked revenue once you pass {threshold} a month, and the bill grows every time you do. The servers behind your app cost a rounding error. The rest pays for the company: its payroll, its sales team, and its investors' return.",
    updated: "Updated {date} · Estimates from public figures",
  },
  answer: {
    title: "RevenueCat pricing in one line",
    /** HTML. {threshold} is "$2,500". */
    text: "Free below {threshold} of monthly tracked revenue, then <strong>1% of all of it</strong>. What that comes to in a year, next to what the servers for the same app cost:",
    colRevenue: "Monthly revenue",
    colFee: "RevenueCat, per year",
    colServers: "Servers, per year",
  },
  calc: {
    revenue: "Your app's monthly revenue",
    fee: "RevenueCat takes",
    servers: "The servers actually cost",
    perYear: "a year",
    stackLabel: "Your yearly fee, split into servers and RevenueCat's teams",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Servers: {servers}. Everything else, {rest}, pays for their teams:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "About {people} people · typical salary {salary}",
    ownersTitle: "And more than half of it builds someone else's exit",
    /** {pct} is like "55%". */
    ownersInvestors: "Venture investors · about {pct}",
    ownersRest: "Founders and employees",
    ownersBarLabel: "Venture investors own about {pct} of RevenueCat, our estimate",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Venture investors have put about {funding} into RevenueCat across five rounds, and by the reported valuations they own more than half of it. They don't need a cut of each payment. Every fee you pay makes the company they own worth more, and they collect when it sells. In ownership terms, about {vc} of what you pay each year is building their return.",
    investorsLabel: "RevenueCat's investors",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Your 1% buys about {days} engineer-days a year at RevenueCat. Running the same job yourself costs {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Keep the other {keep}.",
    ctaKeep: "Keep your 1% →",
    ctaGithub: "openpurr on GitHub",
  },
  teams: {
    eng: { name: "Engineering", basis: "Senior SDK engineer posting, $212K" },
    product: { name: "Product, design and data", basis: "Senior product manager postings, $230K; senior data scientist, $220K" },
    sales: { name: "Sales", basis: "Head of Sales posting, $363K; senior sales engineer, $200K; product expert, $133K" },
    growth: { name: "Marketing and growth", basis: "Head of Customer Growth posting, $259K; CRO designer, $205K; product marketing, $168K" },
    support: { name: "Customer success and support", basis: "Developer support engineer posting, $118K" },
    community: { name: "Developer relations and community", basis: "The postings' overall median, about $215K, discounted for a mix of levels" },
    ops: { name: "Operations, finance and people", basis: "Sales and operations specialist posting, $167K; Head of People, $280K" },
    exec: { name: "Executives", basis: "Above the Head of Sales posting ($363K) for some, below for others" },
  },
  faq: {
    title: "Questions people ask",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "How much does RevenueCat cost?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "RevenueCat's Pro plan is free below {threshold} of monthly tracked revenue. From there it costs 1% of all of it, not just the part above {threshold}: {at10k} a year for an app making {m10k} a month, {at100k} a year at {m100k} a month. Large accounts can negotiate Enterprise pricing.",
      },
      pays: {
        q: "What does RevenueCat's 1% fee pay for?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Mostly the company. The servers behind a typical app cost a few dollars a month to run: {servers} a year for an app making {m25k} a month, against {fee} in fees. The rest pays for a team of about {people} people, including engineering, sales, marketing and executives, and builds value for the company's investors.",
      },
      owns: {
        q: "Who owns RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat has raised about {funding} from venture investors in five rounds, including {investors}. Compounding the reported round valuations, investors own an estimated {pct} of the company. The rest belongs to its founders and employees.",
      },
      worth: {
        q: "How much is RevenueCat worth?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat was reported at a {valuation} valuation when it raised its {round} Series C in 2025, with about {revenue} in yearly revenue at the time. These are press and analyst figures, not company disclosures.",
      },
      alternative: {
        q: "Is there a RevenueCat alternative without a revenue share?",
        a: "Yes. openpurr is a free, open-source, self-hosted backend that works with the official RevenueCat Purchases SDK. You set the SDK's proxy URL to your own server and keep your purchase code. It runs on Cloudflare's free plan for small apps, with no revenue share and no per-transaction fees.",
      },
    },
  },
  more: {
    title: "Yes, they do more",
    text: "RevenueCat builds more than a purchase backend: paywalls, experiments, integrations, a support line. If you use all of it, maybe it's worth it to you. If what you need is purchases validated and subscriptions kept current, you're handing over a share of everything you'll ever earn for a job that runs on a few dollars of servers a month.",
  },
  method: {
    title: "How we estimate this",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Your fee:</b> RevenueCat's Pro plan list price, 1% of monthly tracked revenue from {threshold}. Large accounts can negotiate other pricing.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Servers:</b> what openpurr Lite costs on Cloudflare for an app with that revenue, the same model as our {calculator}. RevenueCat's own hosting costs aren't public; this is what the job costs when you run it yourself.",
    calculatorLink: "savings calculator",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Teams:</b> job functions, not people. We assume {used} people (public estimates range from {low} to {high}) and split them across functions ourselves. Salaries come from RevenueCat's public job postings, which list pay; each team's cost is people × salary × {loaded} for taxes, benefits and equipment, without equity. The part of your fee that isn't servers is split in proportion to those costs.",
    /** HTML. Why the split leans to go-to-market. {date} is the date checked; {open}, {gtm} and {eng} are numbers of job openings. */
    split:
      "<b>Why sales and growth outnumber engineering:</b> on {date}, RevenueCat's job board listed {open} open roles: {gtm} in sales, marketing and growth, and {eng} in core engineering. A company at its stage is building out go-to-market, and its new Head of Sales is the highest-paid posting on the board.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investors:</b> five rounds from 2018 to 2025, about {funding} in all. Ownership isn't public, so we compound it from the reported valuations: each round's investors get the amount divided by the post-money valuation, and everyone before is diluted by the same share. That gives about {pct}. Option pools and Y Combinator's accelerator stake aren't counted. Their share is of what the company is worth, not a line in its costs, which is why it's shown separately. At the 2025 round, the company was reported at about {revenue} in yearly revenue, close to break-even.",
    colRound: "Round",
    colRaised: "Raised",
    colValuation: "Valuation",
    colLead: "Led by",
    notReported: "not reported",
    /** HTML. */
    affiliation: "<b>Not affiliated:</b> openpurr isn't affiliated with RevenueCat. These are our estimates, not RevenueCat's figures.",
    assumptions: "The assumptions, team by team",
    colTeam: "Team",
    colPeople: "People",
    colSalary: "Salary",
    colCost: "Yearly cost",
    colBasis: "Salary from",
  },
  sources: {
    title: "Sources",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat pricing: 1% of monthly tracked revenue from $2,500",
      "RevenueCat's job board, with pay ranges (Ashby)",
      "Earlier RevenueCat postings with pay (Greenhouse)",
      "TechCrunch: RevenueCat raises $50M, bringing its total to $100M (May 2025)",
      "TechCrunch: the $40M Series B, led by Y Combinator's Continuity Fund, at a $300M valuation (2021)",
      "TechCrunch: a $12M Series C led by Adjacent (2024)",
      "SaaStr: the 2018 seed at a $7M valuation, and the rounds since",
      "Multiples.vc: about $30M revenue and a $500M valuation at the 2025 round (estimates)",
      "Headcount estimates: TipRanks (185)",
      "Headcount estimates: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Checked on {date}. Spot something out of date? {issue}.",
    issueLink: "Open an issue",
  },
};

export type PricingDict = typeof pricingEn;
