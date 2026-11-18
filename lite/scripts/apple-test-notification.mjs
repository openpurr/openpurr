// Setup check: asks Apple to send a TEST notification to the URL configured in App Store
// Connect, then reports whether it was delivered. Run it after setting the URL to
// https://<your worker>/notifications/apple.
//
//   node scripts/apple-test-notification.mjs --issuer <issuer-id> --key-id <key-id> \
//     --bundle <bundle-id> --key-file AuthKey_XXXXXXXXXX.p8 [--environment sandbox|production]
//
// The .p8 is read from your machine and used only to sign the request; it isn't uploaded.

import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { values: args } = parseArgs({
  options: {
    issuer: { type: "string" },
    "key-id": { type: "string" },
    bundle: { type: "string" },
    "key-file": { type: "string" },
    environment: { type: "string", default: "sandbox" },
  },
});
for (const required of ["issuer", "key-id", "bundle", "key-file"]) {
  if (!args[required]) {
    console.error(`Missing --${required}. See the usage at the top of this script.`);
    process.exit(1);
  }
}
if (!["sandbox", "production"].includes(args.environment)) {
  console.error("--environment must be sandbox or production");
  process.exit(1);
}

// Bundle the Worker's client so this script uses exactly the same code.
const out = join(mkdtempSync(join(tmpdir(), "openpurr-apple-")), "client.mjs");
await build({
  entryPoints: [new URL("../src/stores/apple-api.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: out,
  logLevel: "error",
});
const { appleApiClient, AppleApiError } = await import(pathToFileURL(out).href);

let privateKeyPem;
try {
  privateKeyPem = readFileSync(args["key-file"], "utf8");
} catch {
  console.error(`Can't read the key file ${args["key-file"]}.`);
  process.exit(1);
}
if (!privateKeyPem.includes("PRIVATE KEY")) {
  console.error(`${args["key-file"]} doesn't look like a .p8 key.`);
  process.exit(1);
}

const client = appleApiClient(
  { issuerId: args.issuer, keyId: args["key-id"], bundleId: args.bundle, privateKeyPem },
  args.environment,
);

try {
  const token = await client.requestTestNotification();
  console.log(`Apple accepted the request (${args.environment}). Waiting for delivery...`);
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await client.testNotificationStatus(token).catch((e) => e);
    if (status instanceof AppleApiError && status.notFound) continue; // not sent yet
    if (status instanceof Error) throw status;
    const attempts = status.sendAttempts ?? [];
    const last = attempts.at(-1);
    if (last) {
      console.log(JSON.stringify(status, null, 2));
      if (last.sendAttemptResult === "SUCCESS") {
        console.log("Delivered: your server answered Apple's TEST notification.");
        process.exit(0);
      }
      console.error(`Apple couldn't deliver it: ${last.sendAttemptResult}. Check the notification URL in App Store Connect.`);
      process.exit(1);
    }
  }
  console.error("No delivery attempt reported after 30 seconds. Check the notification URL in App Store Connect.");
  process.exit(1);
} catch (err) {
  if (err instanceof AppleApiError && err.status === 401) {
    console.error("Apple rejected the credentials (401). Check the issuer ID, key ID, bundle ID and .p8 file.");
  } else {
    console.error(err.message ?? err);
  }
  process.exit(1);
}
