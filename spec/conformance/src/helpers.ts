// Helpers mirroring lite/test/helpers.ts, over HTTP: SDK calls, App Store JWS signing, store
// notifications, Google Play answers and Pub/Sub pushes. Times come from now() (the server's
// clock as the runner set it), not Date.now().

import { expect } from "vitest";
import { ANDROID_KEY, BUNDLE_ID, IOS_KEY, PACKAGE, PUSH_ACCOUNT, PUSH_AUDIENCE } from "./config";
import { fixtures, TARGET } from "./env";
import { now } from "./server";

export const DAY = 864e5;
export const ANON = "$RCAnonymousID:0123456789abcdef0123456789abcdef";

// --- encoding -------------------------------------------------------------------------------------

export const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const encJson = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
export const pemToDer = (pem: string) => new Uint8Array(Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64"));
/** The payload of a JWS or JWT, decoded (no verification). */
export const decodeJws = (jws: string) => JSON.parse(Buffer.from(jws.split(".")[1]!, "base64url").toString("utf8"));

// --- HTTP -----------------------------------------------------------------------------------------

export interface Res {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

/** A raw request to the server under test. JSON bodies are encoded; the response body is parsed if JSON. */
export async function request(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; rawBody?: string } = {}): Promise<Res> {
  const res = await fetch(`${TARGET}${path}`, {
    method,
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    redirect: "manual",
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, headers: res.headers, body, text };
}

/** Calls the server the way the SDKs do (headers per spec/sdk-wire-contract.md). POST when there's a body. */
export function call(
  path: string,
  opts: { key?: string | null; body?: unknown; platform?: "ios" | "android"; headers?: Record<string, string>; method?: string } = {},
) {
  const platform = opts.platform ?? "ios";
  const key = opts.key === undefined ? (platform === "ios" ? IOS_KEY : ANDROID_KEY) : opts.key;
  return request(opts.method ?? (opts.body === undefined ? "GET" : "POST"), path, {
    body: opts.body,
    headers: {
      ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      "content-type": "application/json",
      "x-platform": platform === "ios" ? "iOS" : "android",
      "x-version": platform === "ios" ? "5.103.1" : "11.4.0",
      "x-revenuecat-etag": "",
      ...(platform === "ios" ? { "x-is-sandbox": "true" } : {}),
      ...opts.headers,
    },
  });
}

// --- App Store ------------------------------------------------------------------------------------

export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseDate: number;
  originalPurchaseDate: number;
  expiresDate?: number;
  type: "Auto-Renewable Subscription" | "Non-Consumable" | "Consumable" | "Non-Renewing Subscription";
  inAppOwnershipType?: "PURCHASED" | "FAMILY_SHARED";
  revocationDate?: number;
  revocationReason?: number;
  isUpgraded?: boolean;
  offerType?: number;
  offerDiscountType?: "FREE_TRIAL" | "PAY_AS_YOU_GO" | "PAY_UP_FRONT";
  environment: "Sandbox" | "Production" | "Xcode" | "LocalTesting";
  price?: number;
  currency?: string;
  storefront?: string;
  subscriptionGroupIdentifier?: string;
  [extra: string]: unknown;
}

export interface AppleRenewalInfo {
  originalTransactionId: string;
  productId: string;
  autoRenewProductId?: string;
  autoRenewStatus?: number;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  signedDate: number;
  [extra: string]: unknown;
}

let leafKey: Promise<import("node:crypto").webcrypto.CryptoKey> | undefined;
// Unique per runner process, so reruns against the same server don't collide.
let nextId = 2_000_000_000_000_000 + (Date.now() % 1_000_000_000) * 1000;
export const nextTransactionId = () => String(nextId++);

/** Signs any payload as an App Store JWS with the test chain (`x5c` overrides the chain). */
export async function signJws(payload: object, opts: { x5c?: string[] } = {}) {
  leafKey ??= crypto.subtle.importKey("pkcs8", pemToDer(fixtures.appleLeafKeyPem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const input = `${encJson({ alg: "ES256", x5c: opts.x5c ?? fixtures.appleX5c })}.${encJson(payload)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await leafKey, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/** A signed transaction, like the one StoreKit 2 posts as fetch_token. */
export async function signTransaction(overrides: Partial<AppleTransaction> = {}) {
  const id = nextTransactionId();
  const purchaseDate = overrides.purchaseDate ?? now() - DAY;
  const payload: AppleTransaction = {
    transactionId: id,
    originalTransactionId: id,
    bundleId: BUNDLE_ID,
    productId: "pro_monthly",
    purchaseDate,
    originalPurchaseDate: purchaseDate,
    expiresDate: purchaseDate + 30 * DAY,
    type: "Auto-Renewable Subscription",
    inAppOwnershipType: "PURCHASED",
    environment: "Sandbox",
    price: 9990,
    currency: "USD",
    storefront: "USA",
    ...overrides,
  };
  return { jws: await signJws(payload), payload };
}

/** An App Store Server Notification V2, signed in three layers like Apple's. */
export async function signNotification(n: {
  type: string;
  subtype?: string;
  transaction?: AppleTransaction;
  renewal?: Partial<AppleRenewalInfo>;
  status?: number;
  bundleId?: string;
  uuid?: string;
  signedDate?: number;
  environment?: "Sandbox" | "Production";
}) {
  const signedDate = n.signedDate ?? now();
  const tx = n.transaction;
  const renewal: AppleRenewalInfo | undefined =
    n.renewal || tx
      ? {
          originalTransactionId: tx?.originalTransactionId ?? "",
          productId: tx?.productId ?? "",
          autoRenewProductId: tx?.productId,
          autoRenewStatus: 1,
          signedDate,
          ...n.renewal,
        }
      : undefined;
  const payload = {
    notificationType: n.type,
    ...(n.subtype ? { subtype: n.subtype } : {}),
    notificationUUID: n.uuid ?? crypto.randomUUID(),
    version: "2.0",
    signedDate,
    data: {
      appAppleId: 1234567890,
      bundleId: n.bundleId ?? BUNDLE_ID,
      environment: n.environment ?? "Sandbox",
      ...(tx ? { signedTransactionInfo: await signJws(tx) } : {}),
      ...(renewal ? { signedRenewalInfo: await signJws(renewal) } : {}),
      ...(n.status !== undefined ? { status: n.status } : {}),
    },
  };
  return { signedPayload: await signJws(payload), payload };
}

/** Delivers a notification the way Apple does (no SDK key). */
export function postNotification(signedPayload: string) {
  return request("POST", "/notifications/apple", { body: { signedPayload } });
}

/** Posts a StoreKit 2 transaction the way the iOS SDK does. */
export async function postAppleTransaction(appUserId: string, overrides: Partial<AppleTransaction> = {}, opts: { key?: string; body?: object } = {}) {
  const { jws, payload } = await signTransaction(overrides);
  const res = await call("/v1/receipts", {
    key: opts.key,
    body: {
      app_user_id: appUserId,
      fetch_token: jws,
      product_id: payload.productId,
      transaction_id: payload.transactionId,
      is_restore: false,
      initiation_source: "purchase",
      ...opts.body,
    },
  });
  return { res, payload, jws };
}

// --- Google Play ----------------------------------------------------------------------------------

/** A subscriptionsv2 answer. */
export function playSubscription(o: {
  productId?: string;
  basePlanId?: string;
  orderId?: string;
  state?: string;
  expiry?: number;
  start?: number;
  ack?: boolean;
  test?: boolean;
  autoRenew?: boolean;
  phase?: "freeTrial" | "introductoryPrice" | "basePrice";
  linkedPurchaseToken?: string;
  autoResume?: number;
}) {
  return {
    kind: "androidpublisher#subscriptionPurchaseV2",
    startTime: new Date(o.start ?? now() - DAY).toISOString(),
    regionCode: "US",
    subscriptionState: o.state ?? "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: o.ack ? "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" : "ACKNOWLEDGEMENT_STATE_PENDING",
    ...(o.test === false ? {} : { testPurchase: {} }),
    ...(o.linkedPurchaseToken ? { linkedPurchaseToken: o.linkedPurchaseToken } : {}),
    ...(o.autoResume ? { pausedStateContext: { autoResumeTime: new Date(o.autoResume).toISOString() } } : {}),
    lineItems: [
      {
        productId: o.productId ?? "pro",
        expiryTime: new Date(o.expiry ?? now() + 30 * DAY).toISOString(),
        latestSuccessfulOrderId: o.orderId ?? `GPA.${crypto.randomUUID().slice(0, 18)}`,
        autoRenewingPlan: { autoRenewEnabled: o.autoRenew ?? true, recurringPrice: { currencyCode: "USD", units: "4", nanos: 990000000 } },
        offerDetails: { basePlanId: o.basePlanId ?? "monthly" },
        offerPhase: { [o.phase ?? "basePrice"]: {} },
      },
    ],
  };
}

let pubsubKey: Promise<import("node:crypto").webcrypto.CryptoKey> | undefined;

/** A Pub/Sub push token (Google-signed OIDC JWT), signed with the key the fake JWKS publishes. */
export async function pubsubToken(claims: Record<string, unknown> = {}, opts: { kid?: string } = {}) {
  pubsubKey ??= crypto.subtle.importKey("pkcs8", pemToDer(fixtures.pubsubKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const t = Math.floor(now() / 1000);
  const input = `${encJson({ alg: "RS256", kid: opts.kid ?? fixtures.pubsubKid, typ: "JWT" })}.${encJson({
    iss: "https://accounts.google.com",
    aud: PUSH_AUDIENCE,
    email: PUSH_ACCOUNT,
    email_verified: true,
    sub: "1234567890",
    iat: t,
    exp: t + 3600,
    ...claims,
  })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await pubsubKey, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

let messageCounter = 0;

/** Delivers a Developer Notification the way a Pub/Sub push subscription does. */
export async function postGoogleNotification(
  notification: Record<string, unknown>,
  opts: { token?: string | null; messageId?: string; rawData?: string } = {},
) {
  const token = opts.token === undefined ? await pubsubToken() : opts.token;
  const data =
    opts.rawData ?? Buffer.from(JSON.stringify({ version: "1.0", packageName: PACKAGE, eventTimeMillis: String(now()), ...notification })).toString("base64");
  return request("POST", "/notifications/google", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: {
      message: { data, messageId: opts.messageId ?? `msg-${++messageCounter}-${Date.now()}`, publishTime: new Date(now()).toISOString() },
      subscription: "projects/test-project/subscriptions/rtdn-push",
    },
  });
}

// --- assertions -----------------------------------------------------------------------------------

/** The union of what iOS and Android require of a CustomerInfo (wire contract). */
export function expectValidCustomerInfo(body: any) {
  expect(body.request_date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(typeof body.subscriber.original_app_user_id).toBe("string");
  expect(body.subscriber.first_seen).toMatch(/Z$/);
  expect(body.subscriber.subscriptions).toBeTypeOf("object");
  expect(body.subscriber.non_subscriptions).toBeTypeOf("object");
  for (const e of Object.values<any>(body.subscriber.entitlements)) {
    expect(e.purchase_date).toBeTruthy();
    const target = body.subscriber.subscriptions[e.product_identifier] ?? body.subscriber.non_subscriptions[e.product_identifier]?.[0];
    expect(target, `entitlement points at missing product ${e.product_identifier}`).toBeTruthy();
    expect(target.original_purchase_date).toBeTruthy();
    expect(target.store).toBeTruthy();
    expect(typeof target.is_sandbox).toBe("boolean");
  }
  for (const s of Object.values<any>(body.subscriber.subscriptions)) expect(s.period_type).toBeTruthy();
  for (const list of Object.values<any[]>(body.subscriber.non_subscriptions)) {
    for (const n of list) expect(typeof n.is_sandbox).toBe("boolean");
  }
}
