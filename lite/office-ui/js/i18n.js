// The dashboard's languages. English is written in the code, and is also the key:
//
//   t("Save")                                → the current language's text, or "Save"
//   t("Saved {name}.", { name })             → placeholders in {braces}
//   tn(n, "{n} customer", "{n} customers")   → plural forms, chosen by Intl.PluralRules
//   tx("Run {cmd} first.", { cmd: node })    → a sentence with elements in it (returns an array)
//   tk("Charts")                             → marks text that's translated later with t()
//
// Each language is a flat JSON file, /locales/<code>.json, mapping the English text to the
// translation; a counted string maps the English plural ("{n} customers") to its forms
// ({"one": …, "other": …}, plus "few"/"many"/… where the language has them). Anything missing
// falls back to English, so an untranslated string is never broken. lite/scripts/office-strings.mjs
// lists every string in the code and checks the files against it.
//
// The language: the operator's choice (Your account), or else the browser's, matched to the
// closest one here; before sign-in, the last one used on this browser. Keep the list in step with
// src/office/locales.ts.

export const LOCALES = [
  { code: "en", name: "English", tag: "en" },
  { code: "de", name: "Deutsch", tag: "de" },
  { code: "es", name: "Español", tag: "es" },
  { code: "fr", name: "Français", tag: "fr" },
  { code: "it", name: "Italiano", tag: "it" },
  { code: "nl", name: "Nederlands", tag: "nl" },
  { code: "pl", name: "Polski", tag: "pl" },
  { code: "pt-br", name: "Português (Brasil)", tag: "pt-BR" },
  { code: "tr", name: "Türkçe", tag: "tr" },
  { code: "id", name: "Bahasa Indonesia", tag: "id" },
  { code: "vi", name: "Tiếng Việt", tag: "vi" },
  { code: "ar", name: "العربية", tag: "ar", dir: "rtl" },
  { code: "hi", name: "हिन्दी", tag: "hi" },
  { code: "ja", name: "日本語", tag: "ja" },
  { code: "ko", name: "한국어", tag: "ko" },
  { code: "zh-cn", name: "简体中文", tag: "zh-CN" },
  { code: "zh-tw", name: "繁體中文", tag: "zh-TW" },
];

const STORAGE_KEY = "openpurr_locale";
const byCode = new Map(LOCALES.map((l) => [l.code, l]));
const loaded = new Map([["en", {}]]);
let current = "en";
let strings = {};

/** The current language's code ("pt-br") and BCP 47 tag ("pt-BR", for Intl and lang=). */
export const locale = () => current;
export const localeTag = () => byCode.get(current).tag;
export const isLocale = (code) => byCode.has(code);

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : s);

/** The translation of `text` (English), with {placeholders} filled in. */
export function t(text, vars) {
  const entry = strings[text];
  return fill(typeof entry === "string" && entry ? entry : text, vars);
}

/** A counted string: `one` and `other` are the English forms; {n} is the count, formatted. */
export function tn(n, one, other, vars) {
  const all = { n: formatNumber(n), ...vars };
  const entry = strings[other];
  if (entry && typeof entry === "object") {
    const form = entry[new Intl.PluralRules(localeTag()).select(n)] ?? entry.other;
    if (form) return fill(form, all);
  }
  if (typeof entry === "string" && entry) return fill(entry, all);
  return fill(n === 1 ? one : other, all);
}

/**
 * A sentence with elements in it: translates `text` as one string, then puts `parts` (DOM nodes or
 * strings) where its {placeholders} are. Returns an array for h(): tx("Run {cmd} first.", { cmd: h("code", null, "doctor") }).
 */
export function tx(text, parts) {
  return t(text)
    .split(/(\{\w+\})/)
    .filter((piece) => piece !== "")
    .map((piece) => {
      const key = /^\{(\w+)\}$/.exec(piece)?.[1];
      return key && parts[key] !== undefined ? parts[key] : piece;
    });
}

/** Marks English text to be translated where it's shown (route labels and other constants). */
export const tk = (text) => text;

export const formatNumber = (n, opts) => new Intl.NumberFormat(localeTag(), opts).format(n);

function stored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The closest supported language for a BCP 47 tag ("de-AT" → de, "zh-HK" → zh-tw), or null. */
export function match(tag) {
  const t = String(tag || "").toLowerCase();
  if (!t) return null;
  if (byCode.has(t)) return t;
  const [lang, ...rest] = t.split("-");
  if (lang === "zh") return rest.some((p) => ["tw", "hk", "mo", "hant"].includes(p)) ? "zh-tw" : "zh-cn";
  if (lang === "pt") return "pt-br";
  if (lang === "nb" || lang === "nn") return null;
  return byCode.has(lang) ? lang : null;
}

/** The browser's preferred supported language, or English. */
export function browserLocale() {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const m = match(tag);
    if (m) return m;
  }
  return "en";
}

/**
 * The language to use: `chosen` (the operator's setting) if it's one of ours; before sign-in
 * (chosen undefined) the last one used here; otherwise the browser's.
 */
export function detect(chosen) {
  if (isLocale(chosen)) return chosen;
  if (chosen === undefined && isLocale(stored())) return stored();
  return browserLocale();
}

/** Loads a language's strings and switches to it (lang and dir on <html> too). */
export async function setLocale(code) {
  if (!isLocale(code)) code = "en";
  if (!loaded.has(code)) {
    try {
      const res = await fetch(`/locales/${code}.json`, { cache: "no-cache" });
      loaded.set(code, res.ok ? await res.json() : {});
    } catch {
      loaded.set(code, {}); // offline or missing: English, rather than nothing
    }
  }
  current = code;
  strings = loaded.get(code);
  const l = byCode.get(code);
  document.documentElement.lang = l.tag;
  document.documentElement.dir = l.dir ?? "ltr";
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private mode: fine, the account setting and the browser still decide.
  }
}
