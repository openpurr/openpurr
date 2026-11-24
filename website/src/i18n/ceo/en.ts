// The "RevenueCat's CEO on X" page's English copy (/revenuecat-ceo/). It's the source the
// translations follow: its shape is the `CeoDict` type, so a translation missing a string fails
// astro check.
//
// Words in {braces} are filled in by the page; keep each one, exactly as written, wherever it fits
// the sentence in your language. {handle} is "@jeiting". Keep names (Jacob Eiting, RevenueCat, X,
// openpurr) in English. Search results show about 60 characters of a title and 155 of a description
// (CJK: about half).

export const ceoEn = {
  meta: {
    /** {perDay} is like "10.4". */
    title: "RevenueCat CEO Jacob Eiting: {perDay} posts a day on X",
    /** {posts} like "932", {hours} like "5.4", {pct} like "8%". */
    description:
      "RevenueCat CEO Jacob Eiting posted {posts} times on X in 90 days, in {hours} different hours a day. About {pct} mentions RevenueCat. Your 1% helps pay for it.",
    ogImageAlt: "RevenueCat's CEO posts on X about 10 times a day, every day. Your 1% pays for his social media.",
  },
  hero: {
    crumb: "CEO on X",
    eyebrow: "Where your 1% goes",
    /** {perDay} is like "10.4". */
    headline: "RevenueCat's CEO, Jacob Eiting, posts on X {perDay} times a day.",
    headlineAccent: "Your 1% helps pay for it.",
    /** {days} "90", {handle} "@jeiting", {posts} "932", {perDay} "10.4", {hours} "5.4", {active} "89". */
    lede: "In the last {days} days, RevenueCat's CEO, Jacob Eiting ({handle}), posted {posts} times on X. That's about {perDay} posts a day, spread over {hours} different hours a day, on {active} of {days} days.",
    updated: "Updated {date} - Counted from public posts",
  },
  stats: {
    /** {days} is "90". */
    posts: "posts in {days} days",
    perDay: "posts a day",
    hours: "active hours a day",
    /** {days} is "90". */
    active: "days with a post, of {days}",
  },
  calendar: {
    /** {days} is "90". */
    title: "{days} days of posting",
    note: "Each square is a day. The darker it is, the more hours that day had a post.",
    less: "No posts",
    more: "More hours",
    /** A square's tooltip. {date} a date, {posts} and {hours} numbers. */
    cell: "{date}: {posts} posts in {hours} hours",
  },
  topic: {
    title: "How much of it is about RevenueCat?",
    /** HTML. {pct} like "8%", {onTopic} and {posts} numbers, {basePct} like "46%", {base} "@RevenueCat". */
    text: "By the rules below, <b>{pct}</b> of his posts mention RevenueCat or its business: {onTopic} of {posts}. The same rules find {basePct} on {base}'s own posts, so they miss some. Even so, most of what he posts is about something else.",
    ceo: "His posts",
    /** {base} is "@RevenueCat". */
    base: "{base}'s posts",
    about: "About RevenueCat",
  },
  pays: {
    title: "Your 1% pays for his social media, too",
    /** {threshold} is "$2,500"; {perDay} is like "10.4". */
    text: "RevenueCat takes 1% of all your revenue once you pass {threshold} a month. That money runs the company, including what it pays its CEO. So part of your 1% pays for {perDay} posts a day on X.",
    link: "See where the rest of your 1% goes →",
    ctaKeep: "Keep your 1% →",
    ctaGithub: "openpurr on GitHub",
  },
  faq: {
    title: "Questions people ask",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      who: {
        q: "Who is RevenueCat's CEO?",
        /** {handle} "@jeiting", {followers} like "14,476". */
        a: "Jacob Eiting is RevenueCat's co-founder and CEO. He posts on X as {handle}, where about {followers} people follow him.",
      },
      often: {
        q: "How often does RevenueCat's CEO post on X?",
        /** {days} "90", {end} a date, {posts} "932", {perDay} "10.4", {hours} "5.4", {active} "89". */
        a: "In the {days} days to {end}, Jacob Eiting posted {posts} times on X, counting replies but not reposts. That's about {perDay} posts a day, in {hours} different hours a day, on {active} of {days} days.",
      },
      about: {
        q: "What does RevenueCat's CEO post about on X?",
        /** {pct} like "8%", {basePct} like "46%", {base} "@RevenueCat". */
        a: "Mostly things other than RevenueCat. By our keyword rules, {pct} of his posts mention RevenueCat or its business, against {basePct} of {base}'s own posts. The rules miss some posts, so treat {pct} as a floor.",
      },
      pays: {
        q: "Does RevenueCat's 1% fee pay for its CEO?",
        /** {threshold} "$2,500". */
        a: "In part. RevenueCat charges 1% of all your revenue once you pass {threshold} a month, and that money runs the company, including what it pays its leadership. RevenueCat doesn't publish what it pays its executives.",
      },
    },
  },
  method: {
    title: "How we counted",
    /** HTML. {handle}, {start} and {end} dates, {checked} the date read. */
    posts: "<b>Posts:</b> every public post and reply from {handle} from {start} to {end}, read from X's API on {checked}. Reposts aren't counted, and deleted posts can't be.",
    /** HTML. */
    hours: "<b>Active hours:</b> clock hours with at least one post. Posts at 9:05, 9:40 and 14:10 make 2 active hours. It counts hours with a post, not time spent. Days run midnight to midnight, UTC.",
    /** HTML. {accounts}, {sites} and {terms} are lists. */
    rules: "<b>About RevenueCat:</b> a post that mentions {accounts}, links to {sites}, or uses one of these terms: {terms}.",
    /** HTML. */
    limits: "<b>What this doesn't say:</b> posting can be part of a CEO's job, and these numbers don't show when he works. They show how often he posts, and what about.",
    /** HTML. {script} becomes a link labelled with `scriptLink`. */
    data: "<b>Data:</b> we keep counts only, no post text. The script that counted them is {script}.",
    scriptLink: "in our repository",
    /** HTML. */
    affiliation: "<b>Not affiliated:</b> openpurr isn't affiliated with RevenueCat.",
  },
};

export type CeoDict = typeof ceoEn;
