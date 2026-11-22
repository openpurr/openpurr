// Which openpurr serves this dashboard: Lite (Cloudflare Workers + D1) or Standard (Go +
// Postgres). The admin API's usage and settings reports say ("edition"); servers from before that
// are Lite. Before sign-in, it's the one last seen on this browser.

const STORAGE_KEY = "openpurr_edition";
let current = remembered();

function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "standard" ? "standard" : "lite";
  } catch {
    return "lite";
  }
}

/** Sets the edition from a report's `edition` field (anything but "standard" is Lite). */
export function setEdition(edition) {
  current = edition === "standard" ? "standard" : "lite";
  try {
    localStorage.setItem(STORAGE_KEY, current);
  } catch {
    /* private browsing */
  }
}

/** Lite has Cloudflare's free-plan limits, Worker secrets and wrangler; Standard has none of them. */
export const isLite = () => current === "lite";
