// The RevenueCat pricing page's copy in each language (see en.ts for the notes). Every locale in
// ../index.ts needs one: the Record type makes a missing language fail astro check.
import type { Locale } from "../index";
import { pricingEn, type PricingDict } from "./en";
import { pricingDe } from "./de";
import { pricingEs } from "./es";
import { pricingFr } from "./fr";
import { pricingIt } from "./it";
import { pricingNl } from "./nl";
import { pricingPl } from "./pl";
import { pricingPtBr } from "./pt-br";
import { pricingTr } from "./tr";
import { pricingId } from "./id";
import { pricingVi } from "./vi";
import { pricingAr } from "./ar";
import { pricingHi } from "./hi";
import { pricingJa } from "./ja";
import { pricingKo } from "./ko";
import { pricingZhCn } from "./zh-cn";
import { pricingZhTw } from "./zh-tw";

const PRICING: Record<Locale, PricingDict> = {
  en: pricingEn,
  de: pricingDe,
  es: pricingEs,
  fr: pricingFr,
  it: pricingIt,
  nl: pricingNl,
  pl: pricingPl,
  "pt-br": pricingPtBr,
  tr: pricingTr,
  id: pricingId,
  vi: pricingVi,
  ar: pricingAr,
  hi: pricingHi,
  ja: pricingJa,
  ko: pricingKo,
  "zh-cn": pricingZhCn,
  "zh-tw": pricingZhTw,
};

export const tp = (locale: Locale): PricingDict => PRICING[locale];
export type { PricingDict };
