// The migration page's copy in each language (see en.ts for the notes). Every locale in
// ../index.ts needs one: the Record type makes a missing language fail astro check.
import type { Locale } from "../index";
import { migrateEn, type MigrateDict } from "./en";
import { migrateDe } from "./de";
import { migrateEs } from "./es";
import { migrateFr } from "./fr";
import { migrateIt } from "./it";
import { migrateNl } from "./nl";
import { migratePl } from "./pl";
import { migratePtBr } from "./pt-br";
import { migrateTr } from "./tr";
import { migrateId } from "./id";
import { migrateVi } from "./vi";
import { migrateAr } from "./ar";
import { migrateHi } from "./hi";
import { migrateJa } from "./ja";
import { migrateKo } from "./ko";
import { migrateZhCn } from "./zh-cn";
import { migrateZhTw } from "./zh-tw";

const MIGRATE: Record<Locale, MigrateDict> = {
  en: migrateEn,
  de: migrateDe,
  es: migrateEs,
  fr: migrateFr,
  it: migrateIt,
  nl: migrateNl,
  pl: migratePl,
  "pt-br": migratePtBr,
  tr: migrateTr,
  id: migrateId,
  vi: migrateVi,
  ar: migrateAr,
  hi: migrateHi,
  ja: migrateJa,
  ko: migrateKo,
  "zh-cn": migrateZhCn,
  "zh-tw": migrateZhTw,
};

export const tm = (locale: Locale): MigrateDict => MIGRATE[locale];
export type { MigrateDict };
