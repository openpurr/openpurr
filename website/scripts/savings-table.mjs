// Prints the READMEs' savings table rows from the same cost model as the home page's calculator
// (src/savings.ts), with amounts formatted for a language. Paste the output under each README's
// header row when a price in src/savings.ts changes.
//
//   node scripts/savings-table.mjs [BCP 47 tag, default en]     (Node 22.18 or later, for .ts imports)
import { LEVELS, paidPlanFrom, savings } from "../src/savings.ts";

const tag = process.argv[2] ?? "en";
const usd = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (n) => usd.format(Math.round(n));

for (const level of LEVELS) {
  const r = savings(level);
  console.log(`| ${money(level)} | ${money(r.rc)} | ${money(r.op)} | **${money(r.perYear)}** |`);
}
console.log(`\nWorkers Paid from about ${money(paidPlanFrom())} a month.`);
