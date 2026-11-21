// The migration page's English copy (/migrate-from-revenuecat/). It's the source the translations
// follow: its shape is the `MigrateDict` type, so a translation missing a string fails astro check.
//
// Strings marked "HTML" are rendered with set:html, for the <code> inside them. Keep product, API
// and command names (openpurr, RevenueCat, Purchases SDK, syncPurchases, configure, openpurr import,
// openpurr doctor, Workers Paid) in English. "{date}" is filled in with the page's updated date.
// Search results show about 60 characters of a title and 155 of a description (CJK: about half).

export const migrateEn = {
  meta: {
    title: "How to migrate from RevenueCat to openpurr, step by step",
    description:
      "Move your app from RevenueCat to openpurr, the open-source RevenueCat alternative: keep the Purchases SDK, import every subscriber, and keep their access.",
    ogImageAlt:
      "Move from RevenueCat to openpurr without losing a subscriber: keep the Purchases SDK, import every customer, and old app versions keep working.",
  },
  hero: {
    crumb: "Migrate from RevenueCat",
    eyebrow: "Migration guide",
    headline: "Move from RevenueCat to openpurr without losing a subscriber",
    lede: "Keep the Purchases SDK your app already uses. Import your existing customers from RevenueCat's export: openpurr fetches every purchase from Apple and Google itself. Old app versions keep working while people update.",
    /** Links to the full guide, which is in English: mark that in other languages. */
    guide: "Read the step-by-step guide",
    steps: "See the steps",
    updated: "Updated {date}",
  },
  summary: {
    title: "In short",
    /** HTML. The answer-first summary: the facts an assistant or a skimming reader needs. */
    items: [
      "openpurr is a self-hosted, open-source RevenueCat alternative. It works with the official, unmodified RevenueCat Purchases SDK.",
      "Your app adds one line (the SDK's proxy URL) and a one-time <code>syncPurchases</code> call. The rest of your purchase code stays the same.",
      "<code>openpurr import</code> brings existing customers over from RevenueCat's export. The purchases themselves are fetched from Apple and Google, not copied.",
      "App Store apps can use RevenueCat's Scheduled Data Export. Google Play needs a migration export from RevenueCat Support, the only one with purchase tokens.",
      "Both backends stay up to date until most people have updated the app, so nobody loses access.",
      "On Cloudflare's free plan, the import handles about 2,500 customers a day. On Workers Paid, a large import takes hours.",
    ],
  },
  how: {
    eyebrow: "How it works",
    title: "How a RevenueCat migration works",
    lede: "openpurr doesn't copy purchase records out of RevenueCat. It only needs to know who owns which purchase, then asks the stores, exactly as it does when your app posts a purchase.",
    /** Bodies are HTML. */
    ways: [
      {
        title: "The import",
        body: "RevenueCat's export says which app user owns which store purchase. <code>openpurr import</code> asks Apple and Google for each purchase and records the store's answer for that user. It brings everyone over at once, including people who never open the app again.",
      },
      {
        title: "The app update",
        body: "The new version points the Purchases SDK at openpurr and sends each customer's purchases once with <code>syncPurchases</code>. That catches anyone the export missed, and anyone who bought after it was made.",
      },
      {
        title: "Both backends, for a while",
        body: "Old app versions keep talking to RevenueCat until people update. RevenueCat forwards Apple's notifications to openpurr, and a second Pub/Sub subscription does the same for Google, so both stay current.",
      },
    ],
  },
  app: {
    eyebrow: "In your app",
    title: "What changes in your app",
    lede: "Set the proxy URL before configure, and send each customer's purchases once. The same two changes work on Android, Flutter and React Native; the guide has the code for each.",
    codeLabel: "Swift example: the proxy URL and a one-time sync",
    /** Comments inside the Swift example (the code itself stays as it is). */
    proxyComment: "Before configure(): the only line most apps add",
    syncComment: "Once per install: send this customer's purchases to openpurr",
  },
  import: {
    eyebrow: "The import",
    title: "Importing customers from RevenueCat",
    /** HTML */
    lede: "The openpurr CLI reads RevenueCat's columns as they are: app user IDs, App Store transaction IDs, Google Play purchase tokens, and attributes such as <code>$email</code>.",
    codeLabel: "Terminal: importing RevenueCat's export",
    /** Comments inside the terminal example. */
    dryRunComment: "Check the first rows: asks Apple and Google, writes nothing",
    importComment: "Import everyone. Stop any time; run it again to carry on.",
    /** Title and text of each safeguard. */
    safeguards: [
      ["Nobody loses access", "A purchase the app has already sent for a customer stays theirs; the import never moves it."],
      ["No duplicate webhooks", "Imported purchases aren't new, so openpurr sends no events for them."],
      ["Honest charts", "Imported customers are dated from their first purchase, not counted as new on import day."],
      ["Your app keeps working", "On Cloudflare's free plan, the import stops at 90% of a daily limit and carries on the next day."],
      ["Stop and resume", "Progress is saved. Importing a row twice changes nothing, so a newer export can be run again."],
      ["Try it first", "A dry run asks the stores and reports what would happen, writing nothing."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Step by step",
    title: "How to migrate from RevenueCat in seven steps",
    lede: "Both backends keep running until you're ready to switch, so customers on older app versions keep their access.",
    /** In order; bodies are HTML. Steps 2 and 3 get a source link to RevenueCat's docs (in English). */
    items: [
      {
        title: "Set up openpurr",
        body: "Deploy openpurr Lite to your Cloudflare account, give it App Store and Google Play API access, and recreate your products, entitlements and offerings with the same identifiers. You can even keep your RevenueCat public SDK keys.",
      },
      {
        title: "Keep both backends informed",
        body: "Set openpurr as RevenueCat's Apple Server Notification Forwarding URL, and add openpurr's push subscription to your Play notifications topic.",
      },
      {
        title: "Get your export",
        body: "App Store only: RevenueCat's Scheduled Data Export has what's needed. With Google Play, ask RevenueCat Support for a migration export, since only that one has purchase tokens. The guide has a request you can copy.",
      },
      { title: "Import", body: "Run <code>openpurr import</code>, with a dry run first. Problems with single rows go to a report and don't stop the import." },
      { title: "Ship the app update", body: "Add the proxy URL and a one-time <code>syncPurchases</code>. Release it once the import has finished." },
      {
        title: "Check",
        body: "<code>openpurr doctor</code> checks the setup. Look up customers you know, and compare active subscriptions with RevenueCat's charts.",
      },
      {
        title: "Finish the switch",
        body: "Once most customers have updated, point Apple and Google straight at openpurr, turn on openpurr's webhooks, and turn off RevenueCat's.",
      },
    ],
    source: "Source:",
    /** Labels of the RevenueCat documentation links (the pages are in English). */
    sourceNotifications: "RevenueCat: Apple server notifications",
    sourceExports: "RevenueCat: exporting data or migrating away",
    /** Ends with an arrow in the reading direction (← in right-to-left languages). */
    more: "Every command and setting is in the full guide →",
  },
  moves: {
    eyebrow: "What moves",
    title: "What moves from RevenueCat, and what doesn't",
    rows: [
      ["Subscriptions and purchases, with renewals, refunds, grace periods and expiry", "Yes, fetched from Apple and Google"],
      ["Who owns which purchase", "Yes, from RevenueCat's export"],
      ["App user IDs, including anonymous ones", "Yes, unchanged"],
      ["Customer attributes ($email, $displayName and your own)", "Yes, from an Audience export"],
      ["Products, entitlements and offerings", "You recreate them, with the same identifiers"],
      ["Chart history before the switch", "Partly: keep RevenueCat's chart CSVs for your records"],
      ["Paywalls, experiments, integrations, Customer Center", "No: openpurr doesn't have them"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "RevenueCat migration FAQ",
    items: [
      {
        q: "Do I have to change my purchase code?",
        a: "No. openpurr works with the official, unmodified RevenueCat Purchases SDK. The app update adds the proxy URL before configure, and a one-time syncPurchases call. getOfferings, purchase, restorePurchases, logIn and the rest stay as they are.",
      },
      {
        q: "Do I need RevenueCat's help to migrate?",
        a: "For App Store apps, no: RevenueCat's Scheduled Data Export has the transaction IDs openpurr needs. For Google Play, yes: according to RevenueCat's documentation, only a migration export prepared by RevenueCat Support includes the purchase tokens Google requires.",
      },
      {
        q: "What about customers who never update the app?",
        a: "The import covers them: their purchases are fetched from Apple and Google and assigned to the same app user IDs. While they're still on an old app version, that version talks to RevenueCat, which is why both backends stay informed until most people have updated.",
      },
      {
        q: "How long does an import take?",
        a: "Each customer takes about 30 database row writes. On Cloudflare's free plan, that's about 2,500 customers a day, and the import pauses itself at the daily limit and resumes the next day. On Workers Paid ($5 a month), a large import takes hours.",
      },
      {
        q: "Is my data copied from RevenueCat?",
        a: "Only the mapping of app users to store purchases, plus attributes if you import them. The purchases themselves come straight from Apple and Google, so openpurr records the stores' current truth, renewals and refunds included.",
      },
    ],
  },
  cta: {
    title: "Ready to switch?",
    body: "The guide walks through every step. If something in your setup doesn't fit, open an issue: migrations shape what gets built next.",
    /** Links to the English guide: mark that in other languages. */
    guide: "Read the guide",
    github: "openpurr on GitHub",
    issue: "Open an issue",
  },
};

export type MigrateDict = typeof migrateEn;
