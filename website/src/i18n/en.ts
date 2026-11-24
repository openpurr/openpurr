// The site's English copy. It's the source the translations follow: its shape is the `Dict` type, so
// a translation missing a string (or with an extra one) fails `astro check`.
//
// A FAQ item's `link` is the label of a link to the migration page (MIGRATION_PAGE in consts.ts), or
// with `linkTo: "adapty"`, to the guide for moving from Adapty (ADAPTY_GUIDE_URL).
//
// Strings marked "HTML" are rendered with set:html, for the <span> and <code> inside them. Keep
// product and API names (openpurr, RevenueCat, Purchases SDK, StoreKit, CustomerInfo, configure,
// Workers, D1) and code in English in every language.

export const en = {
  meta: {
    title: "openpurr: a self-hosted, open-source RevenueCat alternative",
    description:
      "openpurr is a self-hosted, open-source RevenueCat alternative. Keep the Purchases SDK you already use, point it at your own server, and pay no revenue share.",
    ogImageAlt: "openpurr: a self-hosted, open-source RevenueCat alternative, next to its subscription charts dashboard",
  },
  header: {
    home: "openpurr home",
    nav: { features: "Features", editions: "Editions", roadmap: "Roadmap", faq: "FAQ", migrate: "Migrate" },
    language: "Language",
  },
  footer: {
    tagline: "Open-source purchase infrastructure you run yourself.",
    roadmap: "Roadmap",
    contributing: "Contributing",
    sponsor: "Sponsor",
    contact: "Contact",
    privacy: "Privacy",
    disclaimer:
      "openpurr is an independent project. It is not affiliated with or endorsed by RevenueCat, Inc. App Store is a trademark of Apple Inc. Google Play is a trademark of Google LLC.",
    copyright: "Copyright {year} openpurr contributors.",
    cookieSettings: "Cookie settings",
  },
  consent: {
    label: "Cookie consent",
    text: "We'd like to use Google Analytics cookies to count visits and see which pages help. Nothing is set unless you accept, and you can change your mind any time under Cookie settings.",
    privacy: "Privacy",
    decline: "Decline",
    accept: "Accept",
  },
  snippet: {
    tabs: "SDK platform",
    note: "One line. Same SDK, same purchase code.",
  },
  home: {
    hero: {
      /** HTML */
      title: 'A <span class="nowrap">self-hosted,</span> open-source <span class="accent">RevenueCat alternative</span>',
      lede: "Control your own purchase infrastructure, share none of your revenue, and depend on no commercial service. Keep the Purchases SDK you already use: change one URL, not your purchase code.",
      star: "Star on GitHub",
      how: "How it works",
      /** Before the logos of the clouds it runs on. */
      runsOn: "Runs on",
      shotAlt:
        "The openpurr Lite dashboard, showing 12 months of MRR movement, active subscriptions, churn, new customers, new trials and active trials",
    },
    why: {
      eyebrow: "Who it's for",
      title: "For app developers who'd rather run it themselves",
      lede: "openpurr works with the official, unmodified SDKs. Switching starts with changing one URL, not rewriting your purchase code.",
      reasons: [
        {
          title: "Your data, your servers",
          body: "Purchase records, entitlements and store credentials live in a database you run, query, back up and export. No outside service sits between your app and your customers.",
        },
        {
          title: "No revenue share",
          body: "No percentage of revenue and no per-transaction fees. The Lite edition is designed to fit Cloudflare's free plan, so a small app can run it for nothing.",
        },
        {
          title: "No vendor to depend on",
          body: "It's open source under Apache 2.0. Read the code, change it, and move it between Cloudflare and your own cloud.",
        },
      ],
    },
    how: {
      eyebrow: "How it works",
      title: "Your server sits where the vendor used to",
      lede: "Your app keeps the open-source Purchases SDK it already ships with. The SDK talks to openpurr. openpurr talks to the stores, keeps the subscription state, and tells your backend what changed.",
      flowLabel: "Request flow",
      app: "Your app",
      sdkLicense: "Official, unmodified, MIT licensed",
      sdkPlatforms: "iOS, Android, Flutter or React Native",
      coreWhere: "On Cloudflare Workers or your own cloud",
      appStoreApi: "Server API and notifications",
      playApi: "Developer API and RTDN",
      backend: "Your backend",
      backendHooks: "Signed webhooks",
      steps: [
        {
          title: "Deploy",
          /** HTML */
          body: "Run openpurr Lite on your own Cloudflare account. A guided setup, <code>pnpm run setup</code>, creates the database, deploys both Workers and your owner account.",
        },
        {
          title: "Point the SDK",
          /** HTML */
          body: "Set the proxy URL before <code>configure</code>. Use a custom domain you own so you can move later.",
        },
        {
          title: "Connect the stores",
          /** HTML */
          body: "Add your store credentials and notification URLs. The setup check, <code>openpurr doctor</code>, verifies them and says how to fix anything that's missing.",
        },
      ],
    },
    features: {
      eyebrow: "What it does",
      title: "The subscription backend, without the extras you don't use",
      items: [
        {
          title: "Purchases and store notifications",
          body: "Validates StoreKit 2 transactions and Google Play purchases, returns the CustomerInfo and entitlements the SDK expects, and keeps renewals, refunds and grace periods current from App Store and Google Play notifications.",
        },
        {
          title: "Webhooks",
          body: "Sends RevenueCat-shaped events to your backend, signed with HMAC-SHA256 and retried for about 72 hours.",
        },
        {
          title: "Charts",
          body: "16 charts: revenue, MRR and ARR, MRR and subscription movement, active and paid subscriptions, subscription status, churn, trials and trial conversion, new customers, refunds and refund rate, and one-time purchases. Filter by app, store, product and environment, with revenue converted to USD.",
        },
        {
          title: "Price experiments",
          body: "Show customers new to your app different offerings, then compare conversion and revenue per customer, with the chance that each variant beats the control. No app update.",
        },
        {
          title: "Auth and audit",
          body: "SDK keys and secret keys, operator sign-in with optional authenticator codes, roles, access tokens and an audit log.",
        },
        {
          title: "MCP server and Claude skills",
          body: "Ask an AI assistant why a customer does or doesn't have an entitlement, look up purchases, or get walked through App Store and Play Console setup.",
        },
      ],
    },
    editions: {
      eyebrow: "Two editions",
      title: "Start small, move up without an app update",
      lede: "Both editions pass the same conformance suite. If your app points at a custom domain you own, moving from Lite to Standard needs no app release.",
      lite: {
        badge: "For indie apps",
        price: "$0",
        priceNote: "on Cloudflare's free plan",
        items: ["TypeScript on Cloudflare Workers and D1", "Lightweight and cheap to run", "Usage alerts before you hit free-plan limits"],
      },
      standard: {
        badge: "For larger portfolios",
        price: "Your cloud bill",
        priceNote: "nothing more",
        items: ["Go and Postgres in containers", "GCP, AWS or DigitalOcean", "A deployment template for each"],
      },
    },
    /** The savings section, after the editions. "{amount}" is a price; in method, "{paidFrom}" is a monthly revenue and "{date}" a date. */
    savings: {
      eyebrow: "Cost",
      title: "What you'd keep compared with RevenueCat",
      lede: "RevenueCat's Pro plan is free below $2,500 a month in tracked revenue, then charges 1% of all of it. Lite runs on Cloudflare's free plan, and on Workers Paid, from $5 a month, once your app outgrows it.",
      revenue: "Monthly revenue",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Saved per year",
      perMonth: "{amount} a month",
      free: "Cloudflare free plan",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Monthly cost by monthly revenue: RevenueCat's rises with revenue, openpurr Lite's stays near zero",
      gapLegend: "What you keep",
      tableSummary: "Compare at other revenue levels",
      colRevenue: "Monthly revenue",
      colRc: "RevenueCat, monthly",
      colOp: "openpurr Lite, monthly",
      colSaved: "Saved per year",
      methodSummary: "How we estimate this",
      /** A link to the (English) page on what RevenueCat's 1% pays for. Ends with an arrow in the reading direction. */
      pricingLink: "Where does RevenueCat's 1% go? →",
      method: [
        "RevenueCat: the Pro plan's list price, 1% of monthly tracked revenue from $2,500. Tracked revenue counts annual plans and one-time purchases in the month they're paid, so it can be higher than MRR. Large accounts can negotiate Enterprise pricing.",
        "openpurr Lite: Cloudflare's prices for Workers and D1. We assume about $1.50 of monthly revenue and about 10 SDK requests a day per daily active user. On that basis the free plan's 100,000 requests a day cover up to about {paidFrom} of monthly revenue, with room to spare. Above that we count Workers Paid: $5 a month, plus $0.30 per million requests over 10 million.",
        "Not included: your time to run it. Store fees are the same either way.",
        "Prices checked on {date}. openpurr isn't affiliated with RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "Being upfront",
      title: "It may not be for you yet",
      lede: "If you need paywall builders, third-party analytics integrations or a support contract, commercial platforms offer those today.",
      outTitle: "Out of scope for now",
      tags: ["Paywalls", "Ad events", "Customer Center", "Virtual currencies", "Web billing", "Amazon", "Analytics integrations"],
    },
    roadmap: {
      eyebrow: "Roadmap",
      title: "Where it's headed",
      lede: "The order is firm, but there are no dates. If something matters to you, say so in an issue.",
      status: { done: "Done", wip: "In progress", planned: "Planned", later: "Your call" },
      /** In order: Lite, Standard, then the community phase. "{version}" is the latest release. */
      phases: [
        {
          phase: "Lite",
          items: [
            "Latest release: {version}",
            "Designed for Cloudflare's free plan",
            "App Store and Google Play",
            "Webhooks, dashboard and admin",
            "Several apps in one deployment",
            "Price experiments",
            "MCP server, CLI and Claude skills",
            "Next: device testing, then 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["Go and Postgres in containers", "GCP, AWS and DigitalOcean", "Same conformance suite as Lite", "Move from Lite with no app update"],
        },
        {
          phase: "Shaped by the community",
          items: ["Verified end-user identity", "Standard extras for larger teams", "A mobile app for charts, with an alert when sales stop", "The same alerts in Slack, Discord and Telegram", "Whatever you ask for in issues"],
        },
      ],
      more: "Read the full roadmap →",
    },
    cta: {
      title: "Help shape it",
      body: "The most useful help right now is feedback: wrong assumptions about the SDKs or the stores, and real-world edge cases in renewals, refunds and grace periods.",
      star: "Star on GitHub",
      issue: "Open an issue",
      coffee: "Buy us a coffee",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr as a RevenueCat alternative",
    lede: "What changes when you run your own subscription backend, and what doesn't.",
    items: [
      {
        q: "What is openpurr?",
        a: "openpurr is an open-source, self-hosted alternative to RevenueCat. It's a backend for in-app purchases and subscriptions that works with the official RevenueCat Purchases SDK. It validates App Store and Google Play purchases, tracks entitlements, receives store notifications, sends webhooks to your backend, and charts your core subscription metrics, all on infrastructure you control.",
      },
      {
        q: "How is openpurr different from RevenueCat?",
        a: "RevenueCat is a hosted commercial service that charges a share of revenue above a free tier. openpurr is software you run yourself: your purchase records, entitlements and store credentials live in your own database, and there's no revenue share or per-transaction fee. RevenueCat offers more features today, such as paywalls and analytics integrations. openpurr focuses on the core subscription backend.",
      },
      {
        q: "Do I have to rewrite my purchase code to switch from RevenueCat?",
        a: "No. openpurr works with the official, unmodified Purchases SDK. You set the SDK's proxy URL to your openpurr server before calling configure, and the rest of your purchase code stays the same. Point it at a custom domain you own so you can move servers later without an app update.",
      },
      {
        q: "How do I move my existing customers from RevenueCat?",
        a: "Import them. Ask RevenueCat for a migration export, and openpurr import fetches each customer's purchases from Apple and Google and gives them to the same app user IDs. The new version of your app also sends each customer's purchases once, and both backends stay up to date while people update, so nobody loses access.",
        link: "How to migrate",
      },
      {
        q: "Can I move from Adapty?",
        a: "Yes, with an app update. Adapty's SDK can't be pointed at another server, so the update replaces it with the Purchases SDK, which openpurr works with. Your products stay the same in the stores. openpurr imports your App Store customers from Adapty's event export, the new version of your app brings everyone else over the first time it runs, and both backends stay up to date while people update.",
        link: "Read the Adapty guide",
        linkTo: "adapty",
      },
      {
        q: "Which platforms and stores does openpurr support?",
        a: "The Purchases SDK for iOS, Android, Flutter and React Native, with purchases from the App Store and Google Play. Amazon and web billing are out of scope for now.",
      },
      {
        q: "How much does openpurr cost?",
        a: "openpurr is free and open source under the Apache 2.0 license. You pay only for the infrastructure it runs on. The Lite edition is designed to run on Cloudflare's free plan, so a small app can run it for nothing. The Standard edition runs in containers on your own cloud, so its cost is your cloud bill.",
      },
      {
        q: "Where is my data stored?",
        a: "In your own database. The Lite edition uses Cloudflare D1 in your Cloudflare account. The Standard edition uses Postgres on GCP, AWS or DigitalOcean. You can query, back up and export it, and no outside service sits between your app and your customers.",
      },
      {
        q: "Does openpurr send webhooks like RevenueCat does?",
        a: "Yes. openpurr sends RevenueCat-shaped events to your backend, signed with HMAC-SHA256 and retried for about 72 hours, so existing webhook handlers need few or no changes.",
      },
      {
        q: "What doesn't openpurr do that RevenueCat does?",
        a: "Paywalls, third-party analytics integrations, Customer Center, virtual currencies, web billing, Amazon, ad events and a commercial support contract are out of scope for now. Price experiments are built in. If you need the others today, a commercial platform is a better fit.",
      },
      {
        q: "Is openpurr ready for production?",
        a: "Not yet. openpurr is early: both editions work and pass the same conformance suite, but they haven't yet been tested end to end with purchases on real devices. Follow the roadmap on GitHub, and open an issue if something matters to you.",
      },
      {
        q: "Is openpurr affiliated with RevenueCat?",
        a: "No. openpurr is an independent open-source project, not affiliated with or endorsed by RevenueCat, Inc. It works with RevenueCat's official Purchases SDK, which is MIT licensed.",
      },
    ],
  },
  /** The SoftwareApplication structured data. */
  structured: {
    description:
      "A self-hosted, open-source RevenueCat alternative: a backend for App Store and Google Play in-app purchases and subscriptions that works with the official, unmodified Purchases SDK. It validates purchases, tracks entitlements, receives store notifications, sends webhooks and charts subscription metrics.",
    subCategory: "In-app purchase and subscription backend",
    features: [
      "Works with the official RevenueCat Purchases SDK for iOS, Android, Flutter and React Native",
      "StoreKit 2 and Google Play purchase validation",
      "App Store Server Notifications V2 and Google Play Real-time Developer Notifications",
      "RevenueCat-shaped webhooks signed with HMAC-SHA256",
      "16 subscription charts, including MRR, churn and trial conversion",
      "Price experiments on offerings, with results by variant",
      "MCP server, CLI and Claude skills",
    ],
  },
};

export type Dict = typeof en;
