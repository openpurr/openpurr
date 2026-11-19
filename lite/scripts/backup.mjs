// Exports the production database to a SQL file in lite/backups/ (git-ignored) with
// `wrangler d1 export`. The file holds every customer, purchase and operator, so keep it somewhere
// private and encrypted, never in a repository.
//
//   pnpm db:backup                      the "openpurr" database (or $OPENPURR_D1_DATABASE_NAME)
//   pnpm db:backup --database NAME
//
// D1 also keeps its own point-in-time history (Time Travel): 7 days on the free plan, 30 days on
// Workers Paid. A file backup covers what Time Travel doesn't: older history, a deleted database,
// or moving to another account. To restore:
//   - Within the Time Travel window: wrangler d1 time-travel restore openpurr --timestamp=<ISO time>
//     It overwrites the database in place, and prints a bookmark that undoes the restore.
//   - From a file, into a new, empty database:
//       wrangler d1 create openpurr-restored
//       wrangler d1 execute openpurr-restored --remote --file backups/<file>.sql
//     then point OPENPURR_D1_DATABASE_NAME (or the database_name in wrangler.jsonc) at it and deploy.

import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { database: { type: "string" } } });
const database = args.database ?? process.env.OPENPURR_D1_DATABASE_NAME ?? "openpurr";

const dir = fileURLToPath(new URL("../backups/", import.meta.url));
mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const file = `${dir}${database}-${stamp}Z.sql`;

console.log(`Exporting the ${database} database. Large databases can be slow to respond while the export runs, so pick a quiet time.`);
try {
  execFileSync("npx", ["wrangler", "d1", "export", database, "--remote", "--output", file], { stdio: "inherit" });
} catch {
  console.error("\nThe export failed. Check `npx wrangler whoami` and the database name (`npx wrangler d1 list`).");
  process.exit(1);
}

const mb = (statSync(file).size / 1e6).toFixed(1);
console.log(`\nSaved ${mb} MB to ${file}
It contains customer data: move it somewhere private and encrypted.
To restore it into a new database: wrangler d1 create ${database}-restored, then
  wrangler d1 execute ${database}-restored --remote --file ${file}`);
