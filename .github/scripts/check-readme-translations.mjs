// Flags README translations that have fallen behind README.md.
//
// Each README.<lang>.md starts with a marker recording which version of README.md it was
// translated from: <!-- translated-from: README.md sha256:<hash> -->. The hash covers README.md
// without its language bar (between <!-- languages --> and <!-- /languages -->), so adding a
// language doesn't mark every translation stale. Prints a GitHub warning per stale or broken file;
// never fails the build. `--hash` prints the current hash, to put in a refreshed translation.
//
// Usage: node .github/scripts/check-readme-translations.mjs [--hash]

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const BAR = /<!-- languages -->[\s\S]*?<!-- \/languages -->\n?/;
const MARKER = /^<!-- translated-from: README\.md sha256:([0-9a-f]{12,64}) -->/;

export const sourceHash = (text) => createHash("sha256").update(text.replace(BAR, "").replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);

const current = sourceHash(readFileSync("README.md", "utf8"));
if (process.argv.includes("--hash")) {
  console.log(current);
  process.exit(0);
}

const files = readdirSync(".").filter((f) => /^README\.[A-Za-z-]+\.md$/.test(f)).sort();
const linked = [...readFileSync("README.md", "utf8").matchAll(/href="(README\.[A-Za-z-]+\.md)"/g)].map((m) => m[1]);
let problems = 0;
const warn = (file, message) => {
  problems++;
  console.log(`::warning file=${file}::${message}`);
};

for (const file of linked) if (!existsSync(file)) warn("README.md", `The language bar links ${file}, which doesn't exist.`);
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const marker = MARKER.exec(text);
  if (!marker) warn(file, "No translated-from marker on the first line, so it can't be checked for staleness.");
  else if (marker[1] !== current) warn(file, `Translated from an older README.md (${marker[1]}; now ${current}). Update it, then set the marker's hash to ${current}.`);
  if (!linked.includes(file)) warn("README.md", `${file} isn't in the language bar.`);
}
console.log(problems ? `${problems} README translation problem(s); see the warnings above.` : `All ${files.length} README translations match README.md (${current}).`);
