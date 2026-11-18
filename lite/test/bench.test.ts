import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const get = (path: string, token = "test-bench-token") =>
  exports.default.fetch(new Request(`https://openpurr.test${path}`, { headers: { authorization: `Bearer ${token}` } }));

describe("bench endpoints", () => {
  it("are hidden without the bench token", async () => {
    expect((await get("/__bench", "wrong")).status).toBe(404);
  });

  it("run every op inside the Workers runtime", async () => {
    const { ops } = await (await get("/__bench")).json<{ ops: string[] }>();
    for (const op of ops) {
      const res = await get(`/__bench/${op}?n=2&iter=1000`);
      expect(await res.json(), op).toMatchObject({ op, ok: true });
    }
  });

  it("reports whether PBKDF2 above 100k iterations is allowed", async () => {
    // Workers documents a 100,000-iteration cap; record what the runtime actually does.
    const res = await (await get("/__bench/pbkdf2?iter=600000")).json<{ ok: boolean; error?: string }>();
    console.log("PBKDF2 600k on workerd:", res.ok ? "allowed" : res.error);
  });

  it("reports rate limiter availability", async () => {
    const res = await (await get("/__bench/ratelimit")).json();
    expect(res).toHaveProperty("available");
  });
});
