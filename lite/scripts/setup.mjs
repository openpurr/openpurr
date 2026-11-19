// Guided setup: from a fresh clone to a running openpurr Lite and a signed-in owner, on your own
// Cloudflare account. Safe to run again: every step checks what's already done and skips it, so it
// also finishes a setup that stopped halfway.
//
//   pnpm run setup
//
// Steps: check Node and the Cloudflare login, create the D1 database, apply migrations, deploy both
// Workers, set the operator secret, and create the first owner. Secrets are generated here and
// piped straight to wrangler; none of them are printed. Apps, products and entitlements come
// after, in the dashboard: it opens on adding your first app. (An openpurr.config.yaml, if you
// have one, is imported instead on the first start.)

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const DATABASE = "openpurr";
const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
/** Created when setup runs, so importing this file doesn't hold stdin open. */
let rl;

// wrangler runs non-interactively (CI=1): no prompts of its own, and no edits to wrangler.jsonc.
const childEnv = { ...process.env, CI: "1" };

class SetupError extends Error {}

function step(title) {
  console.log(`\n▸ ${title}`);
}

/** Runs wrangler. With `capture`, returns stdout and shows it only on failure. */
function wrangler(args, { capture = false, input, allowFail = false } = {}) {
  const r = spawnSync("npx", ["wrangler", ...args], {
    cwd: here("."),
    env: childEnv,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
  });
  if (r.status !== 0 && !allowFail) {
    if (capture) process.stderr.write(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    throw new SetupError(`wrangler ${args.join(" ")} failed.`);
  }
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

async function ask(question, { fallback = "", validate } = {}) {
  for (;;) {
    const answer = (await rl.question(`  ${question}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback;
    const problem = validate?.(answer);
    if (!problem) return answer;
    console.log(`  ${problem}`);
  }
}

async function confirm(question) {
  const answer = (await rl.question(`  ${question} [Y/n]: `)).trim().toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}

const firstUrl = (text) => text.match(/https:\/\/[^\s"']+/)?.[0]?.replace(/\/+$/, "") ?? null;

// ── 1. Prerequisites ────────────────────────────────────────────────────────────────────────────

function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new SetupError(`Node ${process.versions.node} is too old: wrangler needs 22.12 or later (the repo's .nvmrc says which).`);
  }
}

async function checkLogin() {
  step("Cloudflare account");
  const r = wrangler(["whoami", "--json"], { capture: true, allowFail: true });
  let who = null;
  try {
    who = JSON.parse(r.out);
  } catch {}
  if (!r.ok || !who?.loggedIn) {
    throw new SetupError("Not signed in to Cloudflare. Run `npx wrangler login` (it opens a browser), then run this again.");
  }
  const accounts = who.accounts ?? [];
  let account = accounts.find((a) => a.id === process.env.CLOUDFLARE_ACCOUNT_ID) ?? (accounts.length === 1 ? accounts[0] : null);
  if (!account && accounts.length > 1) {
    console.log("  Your login can reach several accounts:");
    accounts.forEach((a, i) => console.log(`    ${i + 1}. ${a.name}`));
    const n = await ask("Deploy to which one? Number", { validate: (v) => (accounts[Number(v) - 1] ? null : "Pick a number from the list.") });
    account = accounts[Number(n) - 1];
  }
  if (account) childEnv.CLOUDFLARE_ACCOUNT_ID = account.id;
  console.log(`  Signed in${who.email ? ` as ${who.email}` : ""}${account ? `, deploying to "${account.name}"` : ""}.`);
  console.log("  This creates (or updates) two Workers named openpurr and openpurr-office and a D1 database named openpurr, all within the free plan.");
  if (!(await confirm("Continue?"))) throw new SetupError("Stopped. Nothing was changed.");
}

// ── 2. Database ─────────────────────────────────────────────────────────────────────────────────

function database() {
  step("Database");
  if (wrangler(["d1", "info", DATABASE], { capture: true, allowFail: true }).ok) {
    console.log(`  The ${DATABASE} database exists.`);
  } else {
    wrangler(["d1", "create", DATABASE], { capture: true });
    console.log(`  Created the ${DATABASE} database.`);
  }
  // Migrations go before code: the new code expects the new tables.
  wrangler(["d1", "migrations", "apply", DATABASE, "--remote"]);
}

// ── 3. Workers ──────────────────────────────────────────────────────────────────────────────────

function deploy(env, label) {
  step(`Deploying the ${label}`);
  const { out } = wrangler(["deploy", `--env=${env}`], { capture: true });
  const url = firstUrl(out.slice(out.indexOf("Deployed")));
  console.log(url ? `  Live at ${url}` : "  Deployed (no URL in wrangler's output; see Workers & Pages in the dashboard).");
  return url;
}

function operatorSecret() {
  step("Operator secret");
  const { ok, out } = wrangler(["secret", "list", "--env", "office"], { capture: true, allowFail: true });
  let names = [];
  try {
    names = JSON.parse(out).map((s) => s.name);
  } catch {}
  if (ok && names.includes("OPERATOR_SECRET")) {
    console.log("  Already set. (Changing it later signs everyone out and invalidates passwords.)");
    return;
  }
  // Signs sessions and peppers passwords. Generated here, piped to wrangler, never shown.
  wrangler(["secret", "put", "OPERATOR_SECRET", "--env", "office"], { capture: true, input: randomBytes(48).toString("base64") });
  console.log("  Generated and set OPERATOR_SECRET on the back office.");
}

// ── 4. First owner ──────────────────────────────────────────────────────────────────────────────

async function firstOwner(officeUrl) {
  step("First owner");
  const { out } = wrangler(["d1", "execute", DATABASE, "--remote", "--json", "--command", "SELECT count(*) AS n FROM operator"], { capture: true });
  const n = JSON.parse(out)[0]?.results?.[0]?.n ?? 0;
  if (n > 0) {
    console.log(`  ${n} operator${n === 1 ? "" : "s"} already exist. Lost access? pnpm admin login-link --email <you> --url ${officeUrl ?? "<back office>"}`);
    return;
  }
  const email = await ask("Your email (to sign in to the dashboard)", { validate: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : "Enter an email address.") });
  const name = await ask("Your name", { fallback: email.split("@")[0] });
  const args = [here("scripts/admin.mjs"), "create", "--email", email, "--name", name, "--role", "owner"];
  if (officeUrl) args.push("--url", officeUrl);
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env: childEnv, cwd: here(".") });
  if (r.status !== 0) throw new SetupError("Couldn't create the owner. Run it yourself: pnpm admin create --email <you> --role owner --url <back office>");
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("openpurr Lite setup");
    checkNode();
    await checkLogin();
    // Validates and bundles openpurr.config.yaml if there is one (it's imported on the first start).
    const built = spawnSync(process.execPath, [here("scripts/build-config.mjs")], { stdio: "inherit", env: childEnv });
    if (built.status !== 0) throw new SetupError("Fix openpurr.config.yaml as described above (or remove it and set up the apps in the dashboard), then run this again.");
    database();
    const sdkUrl = deploy("", "SDK Worker");
    const officeUrl = deploy("office", "back office");
    operatorSecret();
    await firstOwner(officeUrl);

    const office = officeUrl ?? "<back office URL>";
    console.log(`
Done. openpurr is running.

  SDK Worker   ${sdkUrl ?? "<SDK Worker URL>"}   ← your app's Purchases.proxyURL
  Back office  ${office}   ← the dashboard

Next:
  1. Open the setup link above, set a password, and turn on two-step sign-in.
  2. ${existsSync(here("openpurr.config.yaml")) ? "Your openpurr.config.yaml is imported on the first start; check it under Configuration." : "The dashboard opens on adding your first app: its bundle ID and package name. You get the SDK keys there."}
     Then add the products, an entitlement and an offering (Configuration).
  3. Check the setup: create an access token in the dashboard (Developers → Access tokens), then
       npx openpurr login --url ${office}
       npx openpurr doctor
     Every problem it finds comes with the fix.
  4. Store notifications: App Store → ${office}/notifications/apple, Google Play → ${office}/notifications/google
  5. Usage alerts (free plan): create a Cloudflare API token with Account Analytics: Read, then
       npx wrangler secret put CLOUDFLARE_ANALYTICS_TOKEN --env office
     The dashboard then warns you before the daily limits stop requests.
  6. Back up the database now and then: pnpm db:backup
  7. Optional: deploy from GitHub Actions on every push (see .github/workflows/lite-deploy.yml).`);
  } catch (err) {
    if (!(err instanceof SetupError)) throw err;
    console.error(`\n✗ ${err.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
