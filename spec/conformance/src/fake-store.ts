// The fake outside world. One HTTP server plays every service the server under test calls:
//
//   <base>/api.storekit.apple.com/...            App Store Server API (production)
//   <base>/api.storekit-sandbox.apple.com/...    App Store Server API (sandbox)
//   <base>/androidpublisher.googleapis.com/...   Google Play Developer API
//   <base>/oauth2.googleapis.com/token           Google OAuth token endpoint (any JWT assertion works)
//   <base>/www.googleapis.com/oauth2/v3/certs    Google's OIDC keys (signs our Pub/Sub push tokens)
//   <base>/www.ecb.europa.eu/...                 ECB exchange rates
//   <base>/api.cloudflare.com/...                Cloudflare API (Lite's usage alerts)
//   <base>/hooks/<name>                          webhook receiver: records deliveries
//
// A server in conformance mode rewrites https://<host>/<path> to <base>/<host>/<path> for the
// hosts above. Tests program answers per test; everything is cleared before each test.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { fixtures, STORE_BASE, STORE_HOST, STORE_PORT } from "./env";

export interface FakeRequest {
  method: string;
  /** The original host, e.g. "api.storekit.apple.com" ("hooks" for the webhook receiver). */
  host: string;
  /** Path on that host, percent-decoded. */
  path: string;
  /** The original URL, e.g. https://api.storekit.apple.com/inApps/v1/... */
  url: URL;
  headers: Headers;
  body: string;
  at: number;
}

export interface FakeResponse {
  status?: number;
  /** Sent as JSON unless `text` is given. */
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

type Handler = (req: FakeRequest) => FakeResponse | Promise<FakeResponse>;
type Route = { host: string; method: string; path: string | RegExp; handler: Handler };

export const APPLE_HOSTS = { production: "api.storekit.apple.com", sandbox: "api.storekit-sandbox.apple.com" } as const;
export const GOOGLE_PACKAGE = "com.example.openpurr";
const PLAY_PREFIX = `/androidpublisher/v3/applications/${GOOGLE_PACKAGE}`;

export interface WebhookDelivery {
  name: string;
  url: string;
  headers: Headers;
  body: any;
  raw: string;
}

class FakeStore {
  readonly requests: FakeRequest[] = [];
  private routes: Route[] = [];
  private hookStatus: (d: WebhookDelivery) => number = () => 200;
  readonly deliveries: WebhookDelivery[] = [];

  /** Clears routes, recorded requests and deliveries (run before each test). */
  reset() {
    this.routes = [];
    this.requests.length = 0;
    this.deliveries.length = 0;
    this.hookStatus = () => 200;
  }

  /** Answers `method path` on `host` (path exact, percent-decoded, no query). Later routes win. */
  on(host: string, route: string, handler: Handler) {
    const [method, path] = route.split(" ", 2) as [string, string];
    this.routes.unshift({ host, method, path, handler });
  }

  /** Like on(), with a regular expression for the (percent-decoded) path. */
  onMatch(host: string, method: string, path: RegExp, handler: (req: FakeRequest, match: RegExpExecArray) => FakeResponse | Promise<FakeResponse>) {
    this.routes.unshift({ host, method, path, handler: (r) => handler(r, path.exec(r.path)!) });
  }

  /**
   * A Play Developer API whose answers tests change as they go: `subs` (subscriptionsv2 by
   * purchase token) and `products` (one-time purchases by token). Acknowledgements answer {}.
   */
  googleStore() {
    const subs = new Map<string, unknown>();
    const products = new Map<string, unknown>();
    const host = "androidpublisher.googleapis.com";
    this.onMatch(host, "GET", new RegExp(`^${PLAY_PREFIX}/purchases/subscriptionsv2/tokens/([^/]+)$`), (_r, m) =>
      subs.has(m[1]!) ? { body: subs.get(m[1]!) } : { status: 404, body: { error: { code: 404, message: "Not found" } } },
    );
    this.onMatch(host, "GET", new RegExp(`^${PLAY_PREFIX}/purchases/products/([^/]+)/tokens/([^/:]+)$`), (_r, m) =>
      products.has(m[2]!) ? { body: products.get(m[2]!) } : { status: 404, body: { error: { code: 404, message: "Not found" } } },
    );
    this.onMatch(host, "POST", /:acknowledge$/, () => ({ body: {} }));
    const play = this.google({});
    return { subs, products, requests: play.requests };
  }

  /**
   * App Store Server API routes keyed "<environment> <METHOD> <path>", as in lite/test/helpers.ts.
   * Unknown routes answer 404 "Transaction id not found." Returns the recorded Apple requests.
   */
  apple(routes: Record<string, (url: URL) => { status?: number; body: unknown }>) {
    for (const [key, fn] of Object.entries(routes)) {
      const [environment, method, path] = key.split(" ") as ["production" | "sandbox", string, string];
      this.on(APPLE_HOSTS[environment], `${method} ${path}`, (r) => fn(r.url));
    }
    return { requests: () => this.requests.filter((r) => r.host === APPLE_HOSTS.production || r.host === APPLE_HOSTS.sandbox) };
  }

  /**
   * Play Developer API routes keyed "<METHOD> <path after /applications/{package}>", e.g.
   * "GET /purchases/subscriptionsv2/tokens/T1". Returns the recorded Play API requests.
   */
  google(routes: Record<string, (url: URL) => { status?: number; body: unknown }>) {
    for (const [key, fn] of Object.entries(routes)) {
      const [method, path] = key.split(" ") as [string, string];
      this.on("androidpublisher.googleapis.com", `${method} ${PLAY_PREFIX}${path}`, (r) => fn(r.url));
    }
    return {
      requests: () =>
        this.requests
          .filter((r) => r.host === "androidpublisher.googleapis.com")
          .map((r) => ({ method: r.method, path: r.path.startsWith(PLAY_PREFIX) ? r.path.slice(PLAY_PREFIX.length) : r.path })),
    };
  }

  /** The URL of a webhook endpoint that records what it receives. */
  webhookUrl(name = "backend") {
    return `${STORE_BASE}/hooks/${name}`;
  }

  /** How the webhook receiver answers (default 200). */
  webhookStatus(fn: (d: WebhookDelivery) => number) {
    this.hookStatus = fn;
  }

  /** Recorded webhook deliveries, oldest first. */
  received(name?: string) {
    return this.deliveries.filter((d) => !name || d.name === name);
  }

  /** The `event` of each recorded delivery. */
  events(name?: string) {
    return this.received(name).map((d) => d.body.event);
  }

  /** Serves ECB rates: `days` of { date, rates per EUR } for both the daily and the 90-day file. */
  ecb(days: { date: string; perEur: Record<string, number> }[]) {
    const xml = ecbXml(days);
    for (const file of ["eurofxref-daily.xml", "eurofxref-hist-90d.xml"]) {
      this.on("www.ecb.europa.eu", `GET /stats/eurofxref/${file}`, () => ({ text: xml, headers: { "content-type": "text/xml" } }));
    }
  }

  async handle(req: IncomingMessage, body: string): Promise<FakeResponse> {
    const local = new URL(req.url ?? "/", "http://fake");
    const [, host = "", ...rest] = local.pathname.split("/");
    const rawPath = `/${rest.join("/")}`;
    const path = safeDecode(rawPath);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const method = req.method ?? "GET";

    if (host === "hooks") {
      const delivery: WebhookDelivery = { name: rest.join("/"), url: `${STORE_BASE}${local.pathname}`, headers, body: tryJson(body), raw: body };
      this.deliveries.push(delivery);
      return { status: this.hookStatus(delivery), text: "ok" };
    }

    const url = new URL(`https://${host}${rawPath}${local.search}`);
    const record: FakeRequest = { method, host, path, url, headers, body, at: Date.now() };
    this.requests.push(record);

    const route = this.routes.find((r) => r.host === host && r.method === method && (typeof r.path === "string" ? r.path === path : r.path.test(path)));
    if (route) return route.handler(record);
    return defaults(record);
  }
}

function defaults(r: FakeRequest): FakeResponse {
  switch (r.host) {
    case APPLE_HOSTS.production:
    case APPLE_HOSTS.sandbox:
      return { status: 404, body: { errorCode: 4040010, errorMessage: "Transaction id not found." } };
    case "oauth2.googleapis.com": {
      const form = new URLSearchParams(r.body);
      const assertion = form.get("assertion") ?? "";
      if (r.path !== "/token" || form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || assertion.split(".").length !== 3) {
        return { status: 400, body: { error: "invalid_grant" } };
      }
      return { body: { access_token: "ya29.test-token", expires_in: 3600, token_type: "Bearer" } };
    }
    case "www.googleapis.com":
      if (r.path === "/oauth2/v3/certs") {
        return {
          body: { keys: [{ kid: fixtures.pubsubKid, alg: "RS256", use: "sig", ...fixtures.pubsubPublicJwk }] },
          headers: { "cache-control": "public, max-age=3600" },
        };
      }
      break;
    case "www.ecb.europa.eu":
      return { text: ecbXml([]), headers: { "content-type": "text/xml" } };
    case "androidpublisher.googleapis.com":
      return { status: 404, body: { error: { code: 404, message: "Not found" } } };
  }
  return { status: 404, body: { error: "not faked" } };
}

export function ecbXml(days: { date: string; perEur: Record<string, number> }[]) {
  const cubes = days
    .map((d) => `<Cube time='${d.date}'>${Object.entries(d.perEur).map(([c, r]) => `<Cube currency='${c}' rate='${r}'/>`).join("")}</Cube>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube>${cubes}</Cube></gesmes:Envelope>`;
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const tryJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

let server: Server | undefined;
export const fake = new FakeStore();

/** Starts the fake server once per test process. */
export async function startFakeStore() {
  if (server) return;
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      try {
        const out = await fake.handle(req, Buffer.concat(chunks).toString("utf8"));
        const text = out.text ?? JSON.stringify(out.body ?? {});
        res.writeHead(out.status ?? 200, { "content-type": out.text !== undefined ? "text/plain" : "application/json", ...out.headers });
        res.end(text);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(STORE_PORT, STORE_HOST, () => resolve());
  });
  server.unref();
}
