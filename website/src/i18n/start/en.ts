// The "Add in-app purchases" page's English copy (/add-in-app-purchases/), for developers who haven't
// added purchases to their app yet. It's the source the translations follow: its shape is the
// `StartDict` type, so a translation missing a string fails astro check.
//
// Words in {braces} are filled in by the page; keep each one, exactly as written, wherever it fits
// the sentence in your language. Keep product and company names (openpurr, openpurr Lite,
// RevenueCat, Purchases SDK, Cloudflare, App Store, Google Play, Claude Code) in English. Search
// results show about 60 characters of a title and 155 of a description (CJK: about half).

export const startEn = {
  meta: {
    title: "Add in-app purchases and subscriptions, free - openpurr",
    description:
      "Starting a new app? Add in-app purchases and subscriptions with the official Purchases SDK and an open-source backend you run yourself. No revenue share, ever.",
    ogImageAlt: "Starting a new app? Start without a revenue share. Keep your 1% and invest it in your business.",
  },
  hero: {
    crumb: "Add in-app purchases",
    eyebrow: "For new apps",
    headline: "Starting a new app?",
    headlineAccent: "Start without a revenue share.",
    /** {threshold} is "$2,500". */
    lede: "Most purchase backends take 1% of your revenue once you pass {threshold} a month, and the bill grows every time you do. It's easiest to avoid before your first sale. openpurr is a free, open-source backend for in-app purchases and subscriptions that you run yourself, with the same official SDK the big platforms use.",
    ctaStart: "Get started on GitHub",
    ctaHow: "How it works",
  },
  growth: {
    title: "Your 1%, from day one",
    text: "Pick where you expect your app to be in three years. Here's what a 1% revenue share would add up to on the way there, assuming steady growth from zero.",
    target: "Monthly revenue in three years",
    /** Labels for the totals. */
    fee: "1% revenue share, over 3 years",
    servers: "Running it yourself, over 3 years",
    after: "And after that, every year",
    /** The chart's accessible description. */
    chartLabel: "The revenue share adding up month by month over three years",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "That's <b>{fee}</b> you'd hand over before year four, against <b>{servers}</b> for your own servers. Keep it, and put it into the business instead.",
  },
  invest: {
    title: "Invest it in your business, and in you",
    text: "What a year of your 1% buys when you keep it:",
  },
  how: {
    title: "How it works",
    lede: "Four steps, and the code you write is the same as on any RevenueCat tutorial.",
    steps: [
      {
        title: "Deploy openpurr",
        /** HTML. */
        text: "Run the setup on your Cloudflare account. Lite fits the <b>free plan</b> for small apps, and the setup is safe to run again if it stops halfway.",
      },
      {
        title: "Add your app and products",
        text: "The dashboard opens on adding your first app: its bundle ID and package name, then products, entitlements and offerings.",
      },
      {
        title: "Add the Purchases SDK",
        /** HTML. */
        text: "Install the official RevenueCat Purchases SDK, which is open source under the MIT license, and set <b>one proxy URL</b> before you configure it.",
      },
      {
        title: "Ship",
        text: "Purchases are validated with Apple and Google, renewals and refunds arrive by store notification, and your backend gets webhooks. Using Claude Code? The openpurr plugin walks you through App Store Connect and Play Console setup.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Setup, on your machine",
  },
  includes: {
    title: "What you get",
    yes: [
      "Purchases and subscriptions on the App Store and Google Play",
      "Entitlements and offerings",
      "Webhooks to your backend, signed and retried",
      "16 charts: revenue, MRR, churn, trials and more",
      "Price experiments",
      "Your data in your own database",
    ],
    notYetTitle: "Not yet",
    notYet: "Paywall builders, third-party analytics integrations, ad events, web billing and Amazon. If you need those on day one, commercial platforms offer them today.",
  },
  lockin: {
    title: "No lock-in, either way",
    text: "Because openpurr uses the standard Purchases SDK, your purchase code works with either backend. If you outgrow openpurr, or want what the commercial platforms add, switching is a configuration change and a customer import, not a rewrite.",
  },
  pricingLink: {
    text: "Curious where the 1% goes when you do pay it?",
    link: "See RevenueCat's pricing, broken down →",
  },
  faq: {
    title: "Questions people ask",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "Do I need a backend for in-app purchases?",
        a: "Not strictly: StoreKit and Google Play Billing run on the device. But a backend keeps subscriptions honest. It validates purchases with Apple and Google, follows renewals, cancellations and refunds through store notifications, and tells your app and your server who has access. openpurr is that backend, and you run it yourself.",
      },
      cheapest: {
        q: "What's the cheapest way to add subscriptions to an iOS or Android app?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Run the backend yourself. openpurr Lite fits Cloudflare's free plan for small apps and works with the free, open-source Purchases SDK, so what you pay is the servers: about {servers} a year for an app making {m25k} a month in our model, with no revenue share.",
      },
      free: {
        q: "Is openpurr really free?",
        a: "Yes. It's open source under the Apache 2.0 license, with no revenue share and no per-transaction fees. You pay for your own servers, and small apps fit Cloudflare's free plan.",
      },
      switch: {
        q: "Can I switch to RevenueCat later?",
        a: "Yes. openpurr uses the official RevenueCat Purchases SDK, so your app's purchase code works with either backend and your products stay the same in the stores. Switching is a configuration change plus moving your customer records.",
      },
      missing: {
        q: "What doesn't openpurr do yet?",
        a: "Paywall builders, third-party analytics integrations, ad events, web billing and Amazon. Price experiments are built in. If you need the rest on day one, a commercial platform offers it today.",
      },
    },
  },
};

export type StartDict = typeof startEn;
