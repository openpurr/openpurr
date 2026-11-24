// Measures how much RevenueCat's CEO posts on X, for the /revenuecat-ceo/ page. Read-only.
//
// It reads @jeiting's public posts from the last DAYS full days (UTC): original posts and replies,
// not reposts. For each day it keeps two numbers, the posts and the "active hours" (clock hours
// with at least one post: posts at 9:05, 9:40 and 14:10 make 2 active hours), and it tags each post
// as about RevenueCat or not by the fixed rules below. As a check on those rules, it runs them on
// @RevenueCat's own posts too. Only counts go into src/data/x-ceo.json: no post text, no times.
//
// Token: X_BEARER_TOKEN in ~/.config/openpurr/x.env.
//
//   node scripts/x-ceo.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CEO = "jeiting";
const BASELINE = "RevenueCat";
const DAYS = 90;

/**
 * A post counts as about RevenueCat or its business when it mentions one of these accounts, links
 * to one of these sites, or uses one of these terms. The page lists them.
 */
const RULES = {
  accounts: ["revenuecat", "subclubhq", "appstorepayday"],
  sites: ["revenuecat.com", "subclub.com", "rev.cat"],
  terms: [
    "revenuecat", "revenue cat", "subscription", "subscriptions", "paywall", "paywalls", "in-app purchase",
    "in-app purchases", "iap", "storekit", "play billing", "monetization", "monetisation", "mrr", "arr",
    "ltv", "churn", "free trial", "entitlement", "entitlements", "app store", "google play", "sub club",
  ],
};

const token = readFileSync(join(homedir(), ".config", "openpurr", "x.env"), "utf8").match(/^X_BEARER_TOKEN=(.+)$/m)?.[1].trim();
if (!token) throw new Error("No X_BEARER_TOKEN in ~/.config/openpurr/x.env");

async function get(path, params = {}) {
  const url = new URL("https://api.x.com/2" + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-rate-limit-reset")) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 5_000), 900_000);
      console.error(`Rate limited; waiting ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  }
  throw new Error(`Still rate limited on ${path}`);
}

const terms = new RegExp(`\\b(${RULES.terms.map((t) => t.replace(/-/g, "[- ]?")).join("|")})\\b`, "i");
const onTopic = (t) =>
  (t.entities?.mentions ?? []).some((m) => RULES.accounts.includes(m.username.toLowerCase())) ||
  (t.entities?.urls ?? []).some((u) => RULES.sites.some((s) => (u.expanded_url ?? "").toLowerCase().includes(s))) ||
  terms.test(t.text ?? "");

// The last DAYS full days, in UTC.
const end = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const start = new Date(end.getTime() - DAYS * 86_400_000);

async function measure(handle) {
  const user = (await get(`/users/by/username/${handle}`, { "user.fields": "public_metrics" })).data;
  const days = new Map();
  for (let d = 0; d < DAYS; d++) days.set(new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10), { posts: 0, hours: new Set() });
  let posts = 0, replies = 0, topic = 0, next;
  do {
    const page = await get(`/users/${user.id}/tweets`, {
      max_results: 100,
      exclude: "retweets",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      "tweet.fields": "created_at,entities,referenced_tweets",
      pagination_token: next,
    });
    for (const t of page.data ?? []) {
      const day = days.get(t.created_at.slice(0, 10));
      if (!day) continue;
      posts++;
      if ((t.referenced_tweets ?? []).some((r) => r.type === "replied_to")) replies++;
      if (onTopic(t)) topic++;
      day.posts++;
      day.hours.add(t.created_at.slice(11, 13));
    }
    next = page.meta?.next_token;
  } while (next);
  return { user, days, posts, replies, topic };
}

const ceo = await measure(CEO);
const base = await measure(BASELINE);

const perDay = [...ceo.days].map(([date, d]) => ({ date, posts: d.posts, hours: d.hours.size }));
const activeHours = perDay.reduce((s, d) => s + d.hours, 0);
const data = {
  handle: CEO,
  checked: new Date().toISOString().slice(0, 10),
  start: start.toISOString().slice(0, 10),
  end: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10),
  days: DAYS,
  followers: ceo.user.public_metrics.followers_count,
  posts: ceo.posts,
  replies: ceo.replies,
  onTopic: ceo.topic,
  activeHours,
  daysWithPosts: perDay.filter((d) => d.posts > 0).length,
  perDay,
  baseline: { handle: BASELINE, posts: base.posts, onTopic: base.topic },
  rules: RULES,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "x-ceo.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
const { perDay: _, rules: __, ...summary } = data;
console.log(summary, { postsPerDay: (data.posts / DAYS).toFixed(1), activeHoursPerDay: (activeHours / DAYS).toFixed(1) });
