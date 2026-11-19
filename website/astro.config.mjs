// @ts-check
import { defineConfig } from "astro/config";

// Fully static output: Cloudflare serves dist/ as Workers static assets (see wrangler.jsonc),
// so no adapter and no Worker code run per request.
export default defineConfig({
  // Set to the production domain once there is one; used for canonical and Open Graph URLs.
  site: "https://openpurr.org",
  output: "static",
  trailingSlash: "ignore",
});
