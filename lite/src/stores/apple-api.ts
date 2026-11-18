// App Store Server API client: the calls openpurr needs, nothing more.
// Endpoints and base URLs match Apple's app-store-server-library-node.
//
// Signed data in API responses is DECODED, NOT RE-VERIFIED. The response comes straight from
// Apple's API host over TLS, which already authenticates it, and verifying every transaction
// in a 20-transaction history page would cost about 20 ms of CPU, twice the free plan's
// per-request budget. Signed data that arrives from devices or notifications is always
// verified (lib/apple-jws.ts).

import { base64UrlToBytes } from "../lib/der";
import { mintAppleApiToken } from "../lib/store-tokens";
import type { AppleRenewalInfo, AppleTransaction } from "./apple";

export const APPLE_API_URLS = {
  production: "https://api.storekit.apple.com",
  sandbox: "https://api.storekit-sandbox.apple.com",
} as const;
export type AppleEnvironment = keyof typeof APPLE_API_URLS;

/** Apple error codes we act on. */
export const APPLE_API_ERRORS = {
  TRANSACTION_ID_NOT_FOUND: 4040010,
  ORIGINAL_TRANSACTION_ID_NOT_FOUND: 4040005,
  RATE_LIMIT_EXCEEDED: 4290000,
} as const;

export class AppleApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: number | null,
    message: string,
  ) {
    super(message);
  }
  get notFound() {
    return (
      this.errorCode === APPLE_API_ERRORS.TRANSACTION_ID_NOT_FOUND ||
      this.errorCode === APPLE_API_ERRORS.ORIGINAL_TRANSACTION_ID_NOT_FOUND
    );
  }
  /** Worth retrying later: rate limits and Apple-side failures. */
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export interface AppleApiCredentials {
  issuerId: string;
  keyId: string;
  bundleId: string;
  /** The In-App Purchase key (.p8), PEM. */
  privateKeyPem: string;
}

export interface SubscriptionStatus {
  originalTransactionId: string;
  /** 1 active, 2 expired, 3 billing retry, 4 billing grace period, 5 revoked. */
  status: number;
  transaction: AppleTransaction;
  renewal: AppleRenewalInfo;
}

export interface AppleApiClient {
  readonly environment: AppleEnvironment;
  /** Transaction history, newest first, up to maxPages pages of 20. */
  transactionHistory(anyTransactionId: string, maxPages?: number): Promise<{ transactions: AppleTransaction[]; complete: boolean }>;
  /** The latest transaction and renewal info for every subscription the customer has in the app. */
  subscriptionStatuses(anyTransactionId: string): Promise<SubscriptionStatus[]>;
  /** Asks Apple to send a TEST notification to the app's configured URL. */
  requestTestNotification(): Promise<string>;
  testNotificationStatus(token: string): Promise<unknown>;
}

/** Decodes a JWS payload without verifying it (see the note at the top of this file). */
function decodeJws<T>(jws: string): T {
  const payload = jws.split(".")[1];
  if (!payload) throw new AppleApiError(502, null, "Apple returned malformed signed data");
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as T;
}

export function appleApiClient(
  creds: AppleApiCredentials,
  environment: AppleEnvironment,
  fetchImpl: typeof fetch = fetch,
): AppleApiClient {
  const base = APPLE_API_URLS[environment];

  async function request<T>(method: "GET" | "POST", path: string, query?: URLSearchParams): Promise<T> {
    const token = await mintAppleApiToken(creds);
    const url = `${base}${path}${query && [...query].length ? `?${query}` : ""}`;
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (res.ok) return (await res.json()) as T;
    let errorCode: number | null = null;
    let errorMessage = "";
    try {
      const body = await res.json<{ errorCode?: number; errorMessage?: string }>();
      errorCode = body.errorCode ?? null;
      errorMessage = body.errorMessage ?? "";
    } catch {
      // Not JSON; keep the status.
    }
    throw new AppleApiError(res.status, errorCode, `App Store Server API ${res.status}${errorCode ? ` ${errorCode}` : ""}: ${errorMessage || method + " " + path}`);
  }

  const id = (s: string) => encodeURIComponent(s);

  return {
    environment,

    async transactionHistory(anyTransactionId, maxPages = 3) {
      const transactions: AppleTransaction[] = [];
      let revision: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const query = new URLSearchParams({ sort: "DESCENDING" });
        if (revision) query.set("revision", revision);
        const res = await request<{ signedTransactions?: string[]; hasMore?: boolean; revision?: string }>(
          "GET",
          `/inApps/v2/history/${id(anyTransactionId)}`,
          query,
        );
        for (const jws of res.signedTransactions ?? []) transactions.push(decodeJws<AppleTransaction>(jws));
        if (!res.hasMore || !res.revision) return { transactions, complete: true };
        revision = res.revision;
      }
      return { transactions, complete: false };
    },

    async subscriptionStatuses(anyTransactionId) {
      const res = await request<{
        data?: {
          lastTransactions?: { originalTransactionId?: string; status?: number; signedTransactionInfo?: string; signedRenewalInfo?: string }[];
        }[];
      }>("GET", `/inApps/v1/subscriptions/${id(anyTransactionId)}`);
      const out: SubscriptionStatus[] = [];
      for (const group of res.data ?? []) {
        for (const last of group.lastTransactions ?? []) {
          if (!last.signedTransactionInfo || !last.signedRenewalInfo || last.status === undefined) continue;
          out.push({
            originalTransactionId: String(last.originalTransactionId),
            status: last.status,
            transaction: decodeJws<AppleTransaction>(last.signedTransactionInfo),
            renewal: decodeJws<AppleRenewalInfo>(last.signedRenewalInfo),
          });
        }
      }
      return out;
    },

    async requestTestNotification() {
      const res = await request<{ testNotificationToken: string }>("POST", "/inApps/v1/notifications/test");
      return res.testNotificationToken;
    },

    async testNotificationStatus(token) {
      return request("GET", `/inApps/v1/notifications/test/${id(token)}`);
    },
  };
}

/**
 * Runs `fn` against production, then sandbox if Apple says the transaction doesn't exist there.
 * Apple keeps the two environments separate, and a StoreKit 1 receipt doesn't say which one
 * it came from. Returns the environment that answered.
 */
export async function inEitherEnvironment<T>(
  clients: { production: AppleApiClient; sandbox: AppleApiClient },
  fn: (client: AppleApiClient) => Promise<T>,
): Promise<{ result: T; environment: AppleEnvironment }> {
  try {
    return { result: await fn(clients.production), environment: "production" };
  } catch (err) {
    if (!(err instanceof AppleApiError && err.notFound)) throw err;
  }
  return { result: await fn(clients.sandbox), environment: "sandbox" };
}
