// @ts-check
import { defineConfig } from "astro/config";

// Fully static output: Cloudflare serves dist/ as Workers static assets (see wrangler.jsonc),
// so no adapter and no Worker code run per request.
export default defineConfig({
  // The main address (www; the apex redirects to it). Used for canonical, Open Graph and sitemap URLs.
  site: "https://www.openpurr.org",
  output: "static",
  trailingSlash: "ignore",
});
