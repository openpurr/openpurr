// The Google Analytics 4 measurement ID for this build, or null: PUBLIC_GA_ID, set from the
// repository variable GA_MEASUREMENT_ID in .github/workflows/website-deploy.yml. Without it
// (local builds, forks), there's no analytics and no consent banner.
const raw = import.meta.env.PUBLIC_GA_ID?.trim();
export const gaId = raw && /^G-[A-Z0-9]{4,20}$/.test(raw) ? raw : null;
if (raw && !gaId) console.warn(`PUBLIC_GA_ID "${raw}" isn't a GA4 measurement ID (G-XXXXXXX); analytics is off.`);
