// The dashboard's translatable strings (see office-ui/js/i18n.js): lists them from the code and
// checks the translations in office-ui/locales/<code>.json against them.
//
//   node scripts/office-strings.mjs            summary per language; fails if a translation has
//                                              different {placeholders} than the English (that
//                                              would show broken text); missing or outdated
//                                              strings are only reported
//   node scripts/office-strings.mjs --source   every string, as JSON: {"Save": "Save",
//                                              "{n} customers": {"one": "{n} customer", "other": "{n} customers"}}
//   node scripts/office-strings.mjs --missing de   the strings de.json lacks, in the same JSON shape
//
// Strings are found as the first argument of t(), tx() and tk(), and the two English forms of
// tn(n, one, other); they must be plain double-quoted literals. The chart catalog the server sends
// (names, descriptions, series and status labels, fixed notes in src/metrics.ts) is included too:
// the charts page shows those with t().

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const UI = new URL("../office-ui/", import.meta.url).pathname;
const LOCALES_DIR = join(UI, "locales");

function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "vendor" ? [] : jsFiles(p);
    return f.endsWith(".js") && f !== "i18n.js" ? [p] : [];
  });
}

/** A double-quoted JS string literal starting at s[i] ('"'); returns [value, indexAfter]. */
function readString(s, i) {
  let j = i + 1;
  let raw = "";
  while (j < s.length && s[j] !== '"') {
    if (s[j] === "\\") {
      raw += s[j] + s[j + 1];
      j += 2;
    } else raw += s[j++];
  }
  return [JSON.parse(`"${raw.replace(/\\'/g, "'")}"`), j + 1];
}

/** The top-level arguments of a call whose "(" is at s[open], as raw source strings. */
function callArgs(s, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < s.length && s[i] !== q; i++) if (s[i] === "\\") i++;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) {
        args.push(s.slice(start, i));
        return args;
      }
      depth--;
    } else if (c === "," && depth === 0) {
      args.push(s.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

const literal = (arg) => {
  const a = arg.trim();
  return a.startsWith('"') ? readString(a, 0)[0] : null;
};

export function sourceStrings() {
  const strings = new Map(); // key -> string | { one, other }
  for (const file of jsFiles(join(UI, "js"))) {
    const s = readFileSync(file, "utf8");
    // Not method calls (x.t(…)), but spread arguments (...tx(…)) count.
    for (const m of s.matchAll(/(?<![\w$])(?<![^.]\.)(t|tx|tk|tn)\(/g)) {
      const args = callArgs(s, m.index + m[0].length - 1);
      if (m[1] === "tn") {
        const one = literal(args[1] ?? "");
        const other = literal(args[2] ?? "");
        if (one !== null && other !== null) strings.set(other, { one, other });
      } else {
        const key = literal(args[0] ?? "");
        if (key !== null && !strings.has(key)) strings.set(key, key);
      }
    }
  }
  // The server's chart text: `label: "…"` and `description: "…"` in the chart catalog, and the
  // fixed notes.
  const metrics = readFileSync(new URL("../src/metrics.ts", import.meta.url), "utf8");
  for (const m of metrics.matchAll(/(?:\blabel|\bdescription): "((?:[^"\\]|\\.)*)"|notes(?:\.push\(|: \[)"((?:[^"\\]|\\.)*)"/g)) {
    const key = JSON.parse(`"${m[1] ?? m[2]}"`);
    if (!strings.has(key)) strings.set(key, key);
  }
  return new Map([...strings].sort(([a], [b]) => a.localeCompare(b)));
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

function main() {
  const source = sourceStrings();
  const arg = process.argv[2];
  if (arg === "--source") return void console.log(JSON.stringify(Object.fromEntries(source), null, 2));
  if (arg === "--missing") {
    const code = process.argv[3];
    const have = JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), "utf8"));
    return void console.log(JSON.stringify(Object.fromEntries([...source].filter(([k]) => !have[k])), null, 2));
  }

  let broken = 0;
  const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).sort();
  console.log(`${source.size} strings in the code.`);
  for (const f of files) {
    const tr = JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8"));
    let missing = 0;
    const problems = [];
    for (const [key, en] of source) {
      const v = tr[key];
      if (!v) {
        missing++;
        continue;
      }
      const want = placeholders(typeof en === "string" ? en : en.other);
      const forms = typeof v === "string" ? [v] : Object.values(v);
      if (typeof en === "object" && typeof v === "object" && !v.other) problems.push(`${JSON.stringify(key)}: plural forms need "other"`);
      for (const form of forms) {
        // A plural's "one" form may leave out {n} ("one customer"); every other placeholder must stay.
        const got = placeholders(form);
        const ok = got === want || (typeof en === "object" && got === want.split(",").filter((p) => p !== "n").join(","));
        if (!ok) problems.push(`${JSON.stringify(key)}: placeholders {${got}} instead of {${want}}`);
      }
    }
    const stale = Object.keys(tr).filter((k) => !source.has(k)).length;
    console.log(`${f.padEnd(11)} ${String(source.size - missing).padStart(4)}/${source.size} translated${missing ? `, ${missing} missing` : ""}${stale ? `, ${stale} no longer used` : ""}${problems.length ? `, ${problems.length} broken` : ""}`);
    for (const p of problems.slice(0, 10)) console.log(`  ${p}`);
    broken += problems.length;
  }
  if (broken) {
    console.error(`\n${broken} translation(s) would show broken text: fix their {placeholders}.`);
    process.exit(1);
  }
}

main();
