// openpurr import against a fake back office: CSV columns, skipping covered rows, reporting
// problems, stopping on limits and resuming.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { mapHeader, parseCsv, toRow } from "../src/import.js";
import { main } from "../src/main.js";

const signedIn = { OPENPURR_URL: "https://office.example.com", OPENPURR_TOKEN: "pat_testtoken" };

/** A back office whose POST /admin/v1/import answers with `answer(row, body)` → { status, body }. */
function office(answer) {
  const rows = [];
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    rows.push(body);
    const { status = 200, body: data, headers = {} } = answer(body.row, body);
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
  };
  return { fetch: fetchImpl, rows };
}

const ok = (row, extra = {}) => ({
  body: { app_user_id: row.app_user_id, created: true, transactions: 1, transaction_ids: [row.transaction_id ?? row.purchase_token], kept_owner: [], skipped_products: [], aliases_skipped: [], ...extra },
});

async function run(argv, fetch) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    env: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "openpurr-cli-")), ...signedIn },
    stdout: { write: (s) => (stdout += s), isTTY: false },
    stderr: { write: (s) => (stderr += s) },
    stdin: { isTTY: false },
    fetch,
    sleep: async () => {},
  });
  return { code, stdout, stderr };
}

function csv(text) {
  const file = join(mkdtempSync(join(tmpdir(), "openpurr-import-")), "export.csv");
  writeFileSync(file, text);
  return file;
}

describe("reading the file", () => {
  it("parses quoted CSV and recognizes RevenueCat-style columns and attributes", () => {
    const [header, ...rows] = parseCsv('﻿App User ID,Store,Original Store Transaction ID,Store Transaction ID,purchase_token,Product Identifier,$email,attr:plan\r\n"jane, 1",APP_STORE,100,105,,pro_annual,"jane@example.com",gold\nbob,PLAY_STORE,GPA.1,GPA.2,tok-1,pro:monthly,,\n\n');
    const mapping = mapHeader(header);
    assert.deepEqual(toRow(rows[0], mapping, {}), { app_user_id: "jane, 1", store: "APP_STORE", product_id: "pro_annual", transaction_id: "100", attributes: { $email: "jane@example.com", plan: "gold" } });
    // A token wins: the transaction column holds Google's order ID, which can't be looked up.
    assert.deepEqual(toRow(rows[1], mapping, { app: "android" }), { app_user_id: "bob", store: "PLAY_STORE", product_id: "pro:monthly", purchase_token: "tok-1", app: "android" });
  });

  it("needs an app_user_id column", async () => {
    const r = await run(["import", csv("user,token\na,b\n")], office(ok).fetch);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /app_user_id column/);
  });
});

describe("openpurr import", () => {
  it("imports each row, skips rows another row already covered, and reports problems", async () => {
    const back = office((row) => {
      if (row.app_user_id === "gone") return { status: 422, body: { code: "not_found_at_store", message: "Apple doesn't know transaction 3." } };
      if (row.app_user_id === "a") return ok(row, { transaction_ids: ["1", "2"], kept_owner: [{ original_transaction_id: "1", app_user_id: "device" }] });
      return ok(row);
    });
    const file = csv("app_user_id,original_transaction_id\na,1\na,2\ngone,3\nb,4\n");
    const r = await run(["import", file, "--concurrency", "1"], back.fetch);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /4 of 4 rows: imported 2 \(2 new customers\), 1 already covered by another row, 1 problems\./);
    assert.deepEqual(back.rows.map((b) => b.row.transaction_id), ["1", "3", "4"]);
    const report = readFileSync(`${file}.report.csv`, "utf8");
    assert.match(report, /^row,app_user_id,result,message\n/);
    assert.match(report, /2,"a",imported_with_notes,"kept 1 with device, who already has it"/);
    assert.match(report, /4,"gone",not_found_at_store,"Apple doesn't know transaction 3\."/);
    // Done: running again does nothing.
    assert.match((await run(["import", file], back.fetch)).stdout, /already imported/);
  });

  it("stops at a daily limit and resumes from that row", async () => {
    let limited = true;
    const back = office((row) => (row.app_user_id === "c" && limited ? { status: 429, body: { code: "daily_limit", message: "Stopped to keep your app working." } } : ok(row)));
    const file = csv("app_user_id,original_transaction_id\na,1\nb,2\nc,3\nd,4\n");
    const first = await run(["import", file, "--concurrency", "1"], back.fetch);
    assert.equal(first.code, 1);
    assert.match(first.stdout, /Stopped at row 4: Stopped to keep your app working\./);
    assert.match(first.stdout, /run the same command again/);
    assert.equal(JSON.parse(readFileSync(`${file}.openpurr-import.json`, "utf8")).next, 2);

    limited = false;
    back.rows.length = 0;
    const second = await run(["import", file, "--json"], back.fetch);
    assert.equal(second.code, 0);
    assert.deepEqual(back.rows.map((b) => b.row.app_user_id), ["c", "d"]);
    assert.equal(JSON.parse(second.stdout).imported, 4);
  });

  it("retries while the store is busy, and stops on a config problem", async () => {
    let busy = 2;
    const back = office((row) => {
      if (row.app_user_id === "x") return { status: 409, body: { code: "store_not_configured", message: "The Worker secret APPLE_IAP_KEY isn't set." } };
      if (busy-- > 0) return { status: 503, body: { code: "store_unavailable", message: "busy" }, headers: { "retry-after": "1" } };
      return ok(row);
    });
    const r = await run(["import", csv("app_user_id,original_transaction_id\na,1\nx,2\n"), "--concurrency", "1"], back.fetch);
    assert.equal(r.code, 1);
    assert.equal(back.rows.filter((b) => b.row.app_user_id === "a").length, 3);
    assert.match(r.stdout, /APPLE_IAP_KEY/);
  });

  it("does a dry run without saving progress, honoring --limit and --app", async () => {
    const back = office(ok);
    const file = csv("app_user_id,purchase_token,product_id\na,t1,pro\nb,t2,pro\nc,t3,pro\n");
    const r = await run(["import", file, "--dry-run", "--limit", "2", "--app", "android", "--project", "games"], back.fetch);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Dry run: 2 of 3 rows: would import 2 \(2 new customers\)/);
    assert.deepEqual(back.rows[0], { row: { app_user_id: "a", product_id: "pro", purchase_token: "t1", app: "android" }, dry_run: true, project: "games" });
    assert.equal(existsSync(`${file}.openpurr-import.json`), false);
  });
});
