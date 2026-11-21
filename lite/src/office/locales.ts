// The dashboard's languages: the same 17 as the website. The strings live in office-ui/locales/
// (English is the source, in the code itself); keep this list in step with office-ui/js/i18n.js.
export const OFFICE_LOCALES = ["en", "de", "es", "fr", "it", "nl", "pl", "pt-br", "tr", "id", "vi", "ar", "hi", "ja", "ko", "zh-cn", "zh-tw"] as const;
export type OfficeLocale = (typeof OFFICE_LOCALES)[number];
export const isOfficeLocale = (v: unknown): v is OfficeLocale => typeof v === "string" && (OFFICE_LOCALES as readonly string[]).includes(v);
