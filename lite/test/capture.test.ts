import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call } from "./helpers";

describe("capture (spike tooling)", () => {
  it("records SDK requests with the API key redacted", async () => {
    await call("/v1/subscribers/capture-me");
    const row = await env.DB.prepare("SELECT * FROM capture WHERE app_user_id = 'capture-me'").first<any>();
    expect(row.platform).toBe("iOS");
    expect(JSON.parse(row.headers).authorization).toBe("Bearer appl_…6789");
  });
});
