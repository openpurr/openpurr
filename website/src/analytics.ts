// The Google tag for this build, or null: PUBLIC_GOOGLE_TAG_ID, set from the repository variable
// GOOGLE_TAG_ID in .github/workflows/website-deploy.yml. Either a Google Tag Manager container
// (GTM-XXXXXXX), whose tags are set up in Tag Manager, or a GA4 measurement ID (G-XXXXXXX).
// Without it (local builds, forks), there's no analytics and no consent banner.
const raw = import.meta.env.PUBLIC_GOOGLE_TAG_ID?.trim();
export const googleTag = raw && /^(GTM|G)-[A-Z0-9]{4,20}$/.test(raw) ? raw : null;
/** Kept for the pages that only need to know whether analytics is on. */
export const gaId = googleTag;
if (raw && !googleTag) console.warn(`PUBLIC_GOOGLE_TAG_ID "${raw}" isn't a Tag Manager container (GTM-…) or GA4 ID (G-…); analytics is off.`);
