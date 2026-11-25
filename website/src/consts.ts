export const REPO_URL = "https://github.com/openpurr/openpurr";
export const ROADMAP_URL = `${REPO_URL}/blob/main/ROADMAP.md`;
/** The step-by-step migration guide (in the repo), and the website's overview page. */
export const MIGRATION_GUIDE_URL = `${REPO_URL}/blob/main/docs/migrating-from-revenuecat.md`;
export const MIGRATION_PAGE = "/migrate-from-revenuecat/";
/** Adding purchases to a new app, without a revenue share. */
export const START_PAGE = "/add-in-app-purchases/";
/** When the migration page last changed in substance: shown on it, and in its structured data and the sitemap. */
export const MIGRATION_UPDATED = "2026-11-21";
/** The "Where your 1% goes" page: what RevenueCat's pricing pays for. */
export const PRICING_PAGE = "/revenuecat-pricing/";
/** How much RevenueCat's CEO posts on X; linked from the pricing page. */
export const CEO_PAGE = "/revenuecat-ceo/";
/** The guide for moving from Adapty (in the repo). */
export const ADAPTY_GUIDE_URL = `${REPO_URL}/blob/main/docs/migrating-from-adapty.md`;
export const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;
/** Where each cloud's setup is explained, for the provider logos. */
export const CLOUD_GUIDES = {
  cloudflare: `${REPO_URL}#getting-started`,
  gcp: `${REPO_URL}/blob/main/docs/standard-on-gcp.md`,
  aws: `${REPO_URL}/blob/main/docs/standard-on-aws.md`,
  digitalocean: `${REPO_URL}/blob/main/docs/standard-on-digitalocean.md`,
} as const;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const SPONSOR_URL = "https://buymeacoffee.com/openpurr";
/** The footer's Contact link opens a mail to this address. The READMEs list it too. */
export const CONTACT_EMAIL = "hello@openpurr.org";
export const PRIVACY_URL = "/privacy/";
/** Where privacy requests go. Empty: the privacy page points to GitHub instead. */
export const PRIVACY_EMAIL = "";
/** The latest release, shown on the roadmap and in the structured data and llms.txt. Bump on each release. */
export const RELEASE = { version: "0.4.0", date: "2026-11-24" };
