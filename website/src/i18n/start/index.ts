// The "Add in-app purchases" page's copy in each language (see en.ts for the notes). Every locale in
// ../index.ts needs one: the Record type makes a missing language fail astro check.
import type { Locale } from "../index";
import { startEn, type StartDict } from "./en";
import { startDe } from "./de";
import { startEs } from "./es";
import { startFr } from "./fr";
import { startIt } from "./it";
import { startNl } from "./nl";
import { startPl } from "./pl";
import { startPtBr } from "./pt-br";
import { startTr } from "./tr";
import { startId } from "./id";
import { startVi } from "./vi";
import { startAr } from "./ar";
import { startHi } from "./hi";
import { startJa } from "./ja";
import { startKo } from "./ko";
import { startZhCn } from "./zh-cn";
import { startZhTw } from "./zh-tw";

const START: Record<Locale, StartDict> = {
  en: startEn,
  de: startDe,
  es: startEs,
  fr: startFr,
  it: startIt,
  nl: startNl,
  pl: startPl,
  "pt-br": startPtBr,
  tr: startTr,
  id: startId,
  vi: startVi,
  ar: startAr,
  hi: startHi,
  ja: startJa,
  ko: startKo,
  "zh-cn": startZhCn,
  "zh-tw": startZhTw,
};

export const ts = (locale: Locale): StartDict => START[locale];
export type { StartDict };
