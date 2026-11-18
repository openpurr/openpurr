import { describe, expect, it } from "vitest";
import { cloudflareRateLimiters } from "../src/lib/rate-limit";
import { ANON, appWithRateLimits, call, signTransaction } from "./helpers";

const fromIp = (ip: string) => ({ "cf-connecting-ip": ip });

describe("rate limits", () => {
  it("answers 429 with a JSON body and Retry-After once an IP is over its limit", async () => {
    const { app } = appWithRateLimits({ ip: 2 });
    for (let i = 0; i < 2; i++) expect((await call("/v1/subscribers/u1", { app, headers: fromIp("1.1.1.1") })).status).toBe(200);
    const res = await call("/v1/subscribers/u1", { app, headers: fromIp("1.1.1.1") });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toMatchObject({ message: "Too many requests." });
    // Other IPs are unaffected.
    expect((await call("/v1/subscribers/u1", { app, headers: fromIp("2.2.2.2") })).status).toBe(200);
  });

  it("limits by IP before checking the API key, which slows down key guessing", async () => {
    const { app } = appWithRateLimits({ ip: 1 });
    expect((await call("/v1/subscribers/u1", { app, key: "appl_guess_0000000000", headers: fromIp("3.3.3.3") })).status).toBe(401);
    expect((await call("/v1/subscribers/u1", { app, key: "appl_guess_0000000001", headers: fromIp("3.3.3.3") })).status).toBe(429);
  });

  it("answers 503, never 429, on /receipts, so Android keeps the purchase queued", async () => {
    const { app } = appWithRateLimits({ user: 0 });
    const { jws } = await signTransaction();
    const res = await call("/v1/receipts", { app, body: { app_user_id: "rl-receipt", fetch_token: jws } });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toMatchObject({ code: 7110 });
  });

  it("limits per app user, counting iOS's raw and Android's encoded IDs as one user", async () => {
    const { app, counts } = appWithRateLimits({ user: 2 });
    expect((await call(`/v1/subscribers/${ANON}`, { app })).status).toBe(200);
    expect((await call(`/v1/subscribers/${encodeURIComponent(ANON)}/offerings`, { app })).status).toBe(200);
    expect((await call(`/v1/subscribers/${ANON}`, { app })).status).toBe(429);
    expect(counts.get(`user:ios:${ANON}`)).toBe(3);
    // Another user, and logIn (keyed by the body's app_user_id), have their own budgets.
    expect((await call("/v1/subscribers/someone-else", { app })).status).toBe(200);
    const login = await call("/v1/subscribers/identify", { app, body: { app_user_id: "fresh-anon", new_app_user_id: "fresh@example" } });
    expect(login.status).toBe(201);
  });

  it("fails open when the limiter itself errors", async () => {
    const broken = { limit: async () => { throw new Error("binding unavailable"); } } as unknown as RateLimit;
    const limiters = cloudflareRateLimiters({ RATE_LIMIT_IP: broken } as never);
    expect(await limiters.ip!.allow("1.2.3.4")).toBe(true);
    expect(limiters.user).toBeUndefined();
  });
});
