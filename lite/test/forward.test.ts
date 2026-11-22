import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import sdkWorker from "../src/index";
import officeWorker from "../src/office/index";

const FORWARD = { FORWARD_TO: "https://origin.example.com/", FORWARD_SECRET: "shared-secret" };

function captureFetch(answer = () => new Response("from the origin", { status: 201, headers: { "x-origin": "yes" } })) {
  const seen: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    expect(init?.redirect ?? req.redirect).toBe("manual");
    return answer();
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forward mode", () => {
  for (const [name, worker] of [
    ["SDK Worker", sdkWorker],
    ["back-office Worker", officeWorker],
  ] as const) {
    it(`${name}: sends the request on unchanged, with the forwarding headers`, async () => {
      const seen = captureFetch();
      const res = await worker.fetch!(
        new Request("https://purchases.example.com/v1/receipts?x=1&y=%24", {
          method: "POST",
          headers: {
            authorization: "Bearer appl_key",
            "x-platform": "iOS",
            "cf-connecting-ip": "203.0.113.7",
            "x-openpurr-forwarded": "forged",
            "x-openpurr-client-ip": "198.51.100.1",
          },
          body: '{"fetch_token":"abc"}',
        }) as any,
        { ...env, ...FORWARD },
        createExecutionContext(),
      );
      expect(res.status).toBe(201);
      expect(res.headers.get("x-origin")).toBe("yes");
      expect(await res.text()).toBe("from the origin");
      expect(seen).toHaveLength(1);
      const out = seen[0]!;
      expect(out.method).toBe("POST");
      expect(out.url).toBe("https://origin.example.com/v1/receipts?x=1&y=%24");
      expect(out.headers.get("authorization")).toBe("Bearer appl_key");
      expect(out.headers.get("x-platform")).toBe("iOS");
      expect(out.headers.get("x-openpurr-forwarded")).toBe("shared-secret");
      expect(out.headers.get("x-openpurr-origin")).toBe("https://purchases.example.com");
      expect(out.headers.get("x-openpurr-client-ip")).toBe("203.0.113.7");
      expect(await out.text()).toBe('{"fetch_token":"abc"}');
    });
  }

  it("never leaves the origin, whatever the path", async () => {
    const seen = captureFetch();
    await sdkWorker.fetch!(new Request("https://purchases.example.com//evil.example/x") as any, { ...env, ...FORWARD }, createExecutionContext());
    expect(new URL(seen[0]!.url).host).toBe("origin.example.com");
  });

  it("passes redirects back to the client", async () => {
    captureFetch(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/cb?code=1" } }));
    const res = await officeWorker.fetch!(new Request("https://office.example.com/oauth/authorize?x=1") as any, { ...env, ...FORWARD }, createExecutionContext());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://elsewhere.example/cb?code=1");
  });

  it("stops the back office's scheduled jobs", async () => {
    const seen = captureFetch();
    const ctx = createExecutionContext();
    const waitUntil = vi.spyOn(ctx, "waitUntil");
    officeWorker.scheduled!({ scheduledTime: Date.now(), cron: "*/5 * * * *", noRetry() {} } as any, { ...env, ...FORWARD }, ctx);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it("is off without FORWARD_TO", async () => {
    const seen = captureFetch();
    const res = await sdkWorker.fetch!(new Request("https://purchases.example.com/v1/subscribers/u1") as any, env, createExecutionContext());
    expect(res.status).toBe(401); // the SDK API itself: no key
    expect(seen).toHaveLength(0);
  });
});
