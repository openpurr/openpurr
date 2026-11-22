// Where the server under test is, and how the runner reaches it. All settable from the
// environment (scripts/run.mjs maps --target and friends onto these).

import { readFileSync } from "node:fs";

/** Base URL of the server under test, e.g. http://127.0.0.1:8787. */
export const TARGET = (process.env.CONFORMANCE_TARGET ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
/** Bearer token for /__conformance/*; the server must be started with the same CONFORMANCE_TOKEN. */
export const CONFORMANCE_TOKEN = process.env.CONFORMANCE_TOKEN ?? "conformance-token";
/** "lite" or "standard": edition-specific checks run only on their edition. */
export const EDITION = (process.env.CONFORMANCE_EDITION ?? "lite") as "lite" | "standard";
/** Where the fake store server listens. */
export const STORE_HOST = process.env.CONFORMANCE_STORE_HOST ?? "127.0.0.1";
export const STORE_PORT = Number(process.env.CONFORMANCE_STORE_PORT ?? 9911);
/** The fake store server's URL as the server under test sees it (its CONFORMANCE_STORE_BASE). */
export const STORE_BASE = (process.env.CONFORMANCE_STORE_BASE ?? `http://${STORE_HOST}:${STORE_PORT}`).replace(/\/+$/, "");

export interface Fixtures {
  appleRootB64: string;
  appleX5c: string[];
  appleLeafKeyPem: string;
  appleStrayX5c: string[];
  appleApiKeyPem: string;
  appleApiPublicJwk: Record<string, string>;
  googleServiceAccountEmail: string;
  googleServiceAccountKeyPem: string;
  pubsubKid: string;
  pubsubKeyPem: string;
  pubsubPublicJwk: { kty: string; n: string; e: string };
  operatorSecret: string;
}

/** The test keys and certificates (scripts/gen-fixtures.mjs). */
export const fixtures: Fixtures = JSON.parse(readFileSync(new URL("../fixtures/generated.json", import.meta.url), "utf8"));

/**
 * Secrets the server under test must hold, by name. The configs in src/config.ts refer to them
 * (app_store_server_api, google_play_api, webhooks). OPERATOR_SECRET is Lite's; Standard may name
 * its operator pepper differently.
 */
export function serverSecrets(): Record<string, string> {
  return {
    APPLE_IAP_KEY: fixtures.appleApiKeyPem,
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
      type: "service_account",
      client_email: fixtures.googleServiceAccountEmail,
      private_key: fixtures.googleServiceAccountKeyPem,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
    WEBHOOK_AUTH: "Bearer hook-secret-123",
    WEBHOOK_SECRET: "whsec_test_signing_key",
    OPERATOR_SECRET: fixtures.operatorSecret,
  };
}
