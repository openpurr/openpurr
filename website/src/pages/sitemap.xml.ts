// The sitemap, built with the site. Add each new page here. A page that exists in several languages
// lists each version with xhtml:link alternates, as Google asks for translated pages.
import type { APIRoute } from "astro";
import { MIGRATION_PAGE, MIGRATION_UPDATED, PRICING_PAGE } from "../consts";
import { SOURCES_CHECKED } from "../one-percent";
import { allLocales, langTag, type Alternates, type Locale } from "../i18n";

/** lastmod only where it's kept accurate (Google ignores it once it's been wrong). */
const PAGES: { path: string; alternates?: Alternates; lastmod?: string }[] = [
  { path: "/", alternates: allLocales("/") },
  { path: MIGRATION_PAGE, alternates: allLocales(MIGRATION_PAGE), lastmod: MIGRATION_UPDATED },
  { path: PRICING_PAGE, alternates: allLocales(PRICING_PAGE), lastmod: SOURCES_CHECKED },
  { path: "/privacy/" },
];

export const GET: APIRoute = ({ site }) => {
  const abs = (p: string) => new URL(p, site).href;
  const urls = PAGES.flatMap(({ path, alternates, lastmod }) => {
    const mod = lastmod ? `<lastmod>${lastmod}</lastmod>` : "";
    const versions = Object.entries(alternates ?? {});
    if (versions.length < 2) return [`  <url><loc>${abs(path)}</loc>${mod}</url>`];
    const links = [
      ...versions.map(([l, p]) => `<xhtml:link rel="alternate" hreflang="${langTag(l as Locale)}" href="${abs(p)}"/>`),
      `<xhtml:link rel="alternate" hreflang="x-default" href="${abs(path)}"/>`,
    ];
    return versions.map(([, p]) => `  <url>\n    <loc>${abs(p)}</loc>${mod}\n    ${links.join("\n    ")}\n  </url>`);
  }).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8" } },
  );
};
