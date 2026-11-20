// What an app needs to talk to this deployment: the SDK Worker's address (the SDK's proxyURL) and
// where its store sends notifications. The SDK URL is one deployment-wide setting (one SDK Worker
// serves every project), set on the dashboard's Settings page.

import type { Store } from "../config";

/** The stored SDK URL, or null when it hasn't been set. */
export async function storedSdkUrl(db: D1Database) {
  const row = await db.prepare("SELECT value FROM setting WHERE key = 'sdk_url'").first<{ value: string }>();
  return row?.value || null;
}

/** Checks an SDK URL as typed: a bare https origin (http only for localhost). */
export function parseSdkUrl(input: string): { url: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: "Enter a full address, e.g. https://purchases.example.com." };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    return { error: "The SDK URL must use https (http is allowed only for localhost)." };
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    return { error: "Enter just the address, e.g. https://purchases.example.com, with no path: the SDK adds /v1 itself." };
  }
  return { url: url.origin };
}

/**
 * Without a stored SDK URL, a guess: on a default deploy both Workers sit on the same workers.dev
 * subdomain, <name>-office.<sub>.workers.dev for the back office and <name>.<sub>.workers.dev for the SDK.
 */
export function guessSdkUrl(officeOrigin: string) {
  const m = /^(.+)-office\.([^.]+)\.workers\.dev$/.exec(new URL(officeOrigin).hostname);
  return m ? `https://${m[1]}.${m[2]}.workers.dev` : null;
}

export function notificationUrl(store: Store, officeOrigin: string) {
  return `${officeOrigin}/notifications/${store === "app_store" ? "apple" : "google"}`;
}
