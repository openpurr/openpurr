// Google Play Developer API client: the calls openpurr needs, nothing more. Paths and fields come
// from the androidpublisher v3 discovery document.
//
// Auth: a service account's RS256 assertion (lib/store-tokens.ts) exchanged for an OAuth access
// token, cached per isolate until shortly before it expires. Responses come straight from Google
// over TLS.

import { exchangeGoogleAssertion, mintGoogleAssertion } from "../lib/store-tokens";

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

export interface Money {
  currencyCode?: string;
  units?: string;
  nanos?: number;
}

/** purchases.subscriptionsv2.get */
export interface SubscriptionPurchaseV2 {
  startTime?: string;
  regionCode?: string;
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  testPurchase?: object;
  pausedStateContext?: { autoResumeTime?: string };
  canceledStateContext?: {
    userInitiatedCancellation?: { cancelTime?: string };
    systemInitiatedCancellation?: object;
    developerInitiatedCancellation?: object;
    replacementCancellation?: object;
  };
  lineItems?: {
    productId: string;
    expiryTime?: string;
    latestSuccessfulOrderId?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean; recurringPrice?: Money };
    prepaidPlan?: object;
    offerDetails?: { basePlanId?: string; offerId?: string };
    offerPhase?: { freeTrial?: object; introductoryPrice?: object; basePrice?: object; prorationPeriod?: object };
  }[];
}

/** purchases.products.get */
export interface ProductPurchase {
  orderId?: string;
  purchaseTimeMillis?: string;
  /** 0 purchased, 1 canceled, 2 pending. */
  purchaseState?: number;
  /** 0 yet to be consumed, 1 consumed. */
  consumptionState?: number;
  /** 0 yet to be acknowledged, 1 acknowledged. */
  acknowledgementState?: number;
  /** Set only for non-standard purchases: 0 test (license testers), 1 promo, 2 rewarded. */
  purchaseType?: number;
  regionCode?: string;
  productId?: string;
  quantity?: number;
}

/** orders.get: what the customer actually paid. */
export interface Order {
  orderId?: string;
  total?: Money;
  lineItems?: { productId?: string; total?: Money; listingPrice?: Money }[];
}

/** purchases.voidedpurchases.list item. */
export interface VoidedPurchase {
  purchaseToken: string;
  orderId: string;
  voidedTimeMillis?: string;
  /** 0 other, 1 remorse, 2 not received, 3 defective, 4 accidental purchase, 5 fraud, 6 friendly fraud, 7 chargeback. */
  voidedReason?: number;
}

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** The purchase token doesn't exist (or is too old): Google answers 404 or 410. */
  get notFound() {
    return this.status === 404 || this.status === 410;
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export interface GoogleServiceAccountKey {
  client_email: string;
  private_key: string;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

export function googlePlayClient(sa: GoogleServiceAccountKey, packageName: string, fetchImpl: typeof fetch = fetch) {
  async function accessToken() {
    const cached = tokenCache.get(sa.client_email);
    if (cached && cached.exp - Date.now() > 120_000) return cached.token;
    const assertion = await mintGoogleAssertion({ clientEmail: sa.client_email, privateKeyPem: sa.private_key });
    const { access_token, expires_in } = await exchangeGoogleAssertion(assertion, fetchImpl);
    tokenCache.set(sa.client_email, { token: access_token, exp: Date.now() + expires_in * 1000 });
    return access_token;
  }

  async function request<T>(method: "GET" | "POST", path: string, query?: Record<string, string>): Promise<T> {
    const url = `${BASE}/${encodeURIComponent(packageName)}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    let message = "";
    try {
      message = (await res.json<{ error?: { message?: string } }>()).error?.message ?? "";
    } catch {
      // Not JSON.
    }
    throw new GoogleApiError(res.status, `Google Play Developer API ${res.status}: ${message || `${method} ${path}`}`);
  }

  const t = encodeURIComponent;
  return {
    packageName,
    subscription: (token: string) => request<SubscriptionPurchaseV2>("GET", `/purchases/subscriptionsv2/tokens/${t(token)}`),
    product: (productId: string, token: string) =>
      request<ProductPurchase>("GET", `/purchases/products/${t(productId)}/tokens/${t(token)}`),
    acknowledgeSubscription: (subscriptionId: string, token: string) =>
      request<object>("POST", `/purchases/subscriptions/${t(subscriptionId)}/tokens/${t(token)}:acknowledge`),
    acknowledgeProduct: (productId: string, token: string) =>
      request<object>("POST", `/purchases/products/${t(productId)}/tokens/${t(token)}:acknowledge`),
    order: (orderId: string) => request<Order>("GET", `/orders/${t(orderId)}`),
    voided: (startTimeMs: number, pageToken?: string) =>
      request<{ voidedPurchases?: VoidedPurchase[]; tokenPagination?: { nextPageToken?: string } }>("GET", "/purchases/voidedpurchases", {
        startTime: String(startTimeMs),
        type: "1", // one-time purchases and subscriptions
        maxResults: "1000",
        ...(pageToken ? { token: pageToken } : {}),
      }),
  };
}

export type GooglePlayClient = ReturnType<typeof googlePlayClient>;

/** Money to micros of its currency, or null. */
export function moneyMicros(m: Money | undefined): { micros: number; currency: string } | null {
  if (!m?.currencyCode) return null;
  return { micros: Number(m.units ?? 0) * 1e6 + Math.round((m.nanos ?? 0) / 1000), currency: m.currencyCode };
}
