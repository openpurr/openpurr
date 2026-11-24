// The "RevenueCat's CEO on X" page's copy in each language (see en.ts for the notes). Every locale in
// ../index.ts needs one: the Record type makes a missing language fail astro check.
import type { Locale } from "../index";
import { ceoEn, type CeoDict } from "./en";
import { ceoDe } from "./de";
import { ceoEs } from "./es";
import { ceoFr } from "./fr";
import { ceoIt } from "./it";
import { ceoNl } from "./nl";
import { ceoPl } from "./pl";
import { ceoPtBr } from "./pt-br";
import { ceoTr } from "./tr";
import { ceoId } from "./id";
import { ceoVi } from "./vi";
import { ceoAr } from "./ar";
import { ceoHi } from "./hi";
import { ceoJa } from "./ja";
import { ceoKo } from "./ko";
import { ceoZhCn } from "./zh-cn";
import { ceoZhTw } from "./zh-tw";

const CEO: Record<Locale, CeoDict> = {
  en: ceoEn,
  de: ceoDe,
  es: ceoEs,
  fr: ceoFr,
  it: ceoIt,
  nl: ceoNl,
  pl: ceoPl,
  "pt-br": ceoPtBr,
  tr: ceoTr,
  id: ceoId,
  vi: ceoVi,
  ar: ceoAr,
  hi: ceoHi,
  ja: ceoJa,
  ko: ceoKo,
  "zh-cn": ceoZhCn,
  "zh-tw": ceoZhTw,
};

export const tc = (locale: Locale): CeoDict => CEO[locale];
export type { CeoDict };
