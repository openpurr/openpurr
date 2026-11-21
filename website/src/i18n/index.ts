// The site's languages. English lives at /, the others under /<locale>/. Arabic is right-to-left:
// shared styles use logical properties (inset-inline-start, padding-inline-start), never left/right. Only the home page is
// translated; the privacy page, the migration page and the 404 page are English only.
//
// To add a language: add a dictionary next to en.ts (typed `Dict`) and add it to LOCALES,
// LOCALE_INFO and DICTS below. src/pages/[lang]/ builds its pages, and the sitemap picks it up.
import { en, type Dict } from "./en";
import { de } from "./de";
import { fr } from "./fr";
import { es } from "./es";
import { ptBr } from "./pt-br";
import { ja } from "./ja";
import { ko } from "./ko";
import { zhCn } from "./zh-cn";
import { zhTw } from "./zh-tw";
import { it } from "./it";
import { nl } from "./nl";
import { pl } from "./pl";
import { tr } from "./tr";
import { id } from "./id";
import { vi } from "./vi";
import { ar } from "./ar";
import { hi } from "./hi";

/** Locale keys are the URL folders (/pt-br/). This order is the language menu's. */
export const LOCALES = ["en", "de", "es", "fr", "it", "nl", "pl", "pt-br", "tr", "id", "vi", "ar", "hi", "ja", "ko", "zh-cn", "zh-tw"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Per language: its name in the language menu (in its own language), the short label the menu
 * button shows, the BCP 47 tag for lang and hreflang, and the Open Graph locale.
 */
export const LOCALE_INFO: Record<Locale, { name: string; short: string; tag: string; og: string; dir?: "rtl" }> = {
  en: { name: "English", short: "EN", tag: "en", og: "en_US" },
  de: { name: "Deutsch", short: "DE", tag: "de", og: "de_DE" },
  es: { name: "Español", short: "ES", tag: "es", og: "es_ES" },
  fr: { name: "Français", short: "FR", tag: "fr", og: "fr_FR" },
  it: { name: "Italiano", short: "IT", tag: "it", og: "it_IT" },
  nl: { name: "Nederlands", short: "NL", tag: "nl", og: "nl_NL" },
  pl: { name: "Polski", short: "PL", tag: "pl", og: "pl_PL" },
  "pt-br": { name: "Português (Brasil)", short: "PT", tag: "pt-BR", og: "pt_BR" },
  tr: { name: "Türkçe", short: "TR", tag: "tr", og: "tr_TR" },
  id: { name: "Bahasa Indonesia", short: "ID", tag: "id", og: "id_ID" },
  vi: { name: "Tiếng Việt", short: "VI", tag: "vi", og: "vi_VN" },
  ar: { name: "العربية", short: "AR", tag: "ar", og: "ar_AR", dir: "rtl" },
  hi: { name: "हिन्दी", short: "HI", tag: "hi", og: "hi_IN" },
  ja: { name: "日本語", short: "JA", tag: "ja", og: "ja_JP" },
  ko: { name: "한국어", short: "KO", tag: "ko", og: "ko_KR" },
  "zh-cn": { name: "简体中文", short: "简中", tag: "zh-CN", og: "zh_CN" },
  "zh-tw": { name: "繁體中文", short: "繁中", tag: "zh-TW", og: "zh_TW" },
};

/** Text direction for a locale's <html dir>. */
export const dirOf = (locale: Locale): "ltr" | "rtl" => LOCALE_INFO[locale].dir ?? "ltr";

/** The BCP 47 tag of a locale (zh-CN for zh-cn), for lang, hreflang and inLanguage. */
export const langTag = (locale: Locale): string => LOCALE_INFO[locale].tag;

const DICTS: Record<Locale, Dict> = { en, de, es, fr, it, nl, pl, "pt-br": ptBr, tr, id, vi, ar, hi, ja, ko, "zh-cn": zhCn, "zh-tw": zhTw };

export const t = (locale: Locale): Dict => DICTS[locale];

/** The path of a page in a language: localePath("de", "/") is "/de/". */
export const localePath = (locale: Locale, path = "/"): string => (locale === DEFAULT_LOCALE ? path : `/${locale}${path}`);

/** Fills "{name}" placeholders. */
export const fill = (s: string, vars: Record<string, string>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** A page in every language, keyed by locale: for hreflang links and the language menu. */
export type Alternates = Partial<Record<Locale, string>>;
export const allLocales = (path = "/"): Alternates => Object.fromEntries(LOCALES.map((l) => [l, localePath(l, path)]));
