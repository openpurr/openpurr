// The site's languages. English lives at /, the others under /<locale>/. Only the home page is
// translated; the privacy page and the 404 page are English only.
//
// To add a language: add a dictionary next to en.ts (typed `Dict`) and add it to LOCALES,
// LOCALE_INFO and DICTS below. src/pages/[lang]/ builds its pages, and the sitemap picks it up.
import { en, type Dict } from "./en";
import { de } from "./de";
import { fr } from "./fr";
import { es } from "./es";

export const LOCALES = ["en", "de", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The name shown in the language menu (in its own language) and the Open Graph locale. */
export const LOCALE_INFO: Record<Locale, { name: string; og: string }> = {
  en: { name: "English", og: "en_US" },
  de: { name: "Deutsch", og: "de_DE" },
  fr: { name: "Français", og: "fr_FR" },
  es: { name: "Español", og: "es_ES" },
};

const DICTS: Record<Locale, Dict> = { en, de, fr, es };

export const t = (locale: Locale): Dict => DICTS[locale];

/** The path of a page in a language: localePath("de", "/") is "/de/". */
export const localePath = (locale: Locale, path = "/"): string => (locale === DEFAULT_LOCALE ? path : `/${locale}${path}`);

/** Fills "{name}" placeholders. */
export const fill = (s: string, vars: Record<string, string>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** A page in every language, keyed by locale: for hreflang links and the language menu. */
export type Alternates = Partial<Record<Locale, string>>;
export const allLocales = (path = "/"): Alternates => Object.fromEntries(LOCALES.map((l) => [l, localePath(l, path)]));
