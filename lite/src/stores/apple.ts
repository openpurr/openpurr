// App Store: turns a verified JWSTransaction payload into a ledger row.
// Field reference: Apple's JWSTransactionDecodedPayload (App Store Server API docs).

import type { AppConfig, ProductConfig } from "../config";
import type { NewTransaction } from "../ledger";

/** The JWSTransactionDecodedPayload fields we use. */
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
  /** 1 introductory, 2 promotional, 3 offer code, 4 win-back. */
  offerType?: number;
  offerDiscountType?: "FREE_TRIAL" | "PAY_AS_YOU_GO" | "PAY_UP_FRONT";
  environment: "Sandbox" | "Production" | "Xcode" | "LocalTesting";
  /** Milliunits of the currency: 9990 = 9.99. */
  price?: number;
  currency?: string;
  storefront?: string;
  subscriptionGroupIdentifier?: string;
}

const APPLE_TYPE: Record<ProductConfig["type"], AppleTransaction["type"]> = {
  subscription: "Auto-Renewable Subscription",
  non_consumable: "Non-Consumable",
  consumable: "Consumable",
};

export class AppleMappingError extends Error {}

export function appleTransactionRow(tx: AppleTransaction, app: AppConfig, product: ProductConfig): NewTransaction {
  if (tx.bundleId !== app.bundleId) {
    throw new AppleMappingError(`transaction is for bundle ${tx.bundleId}, but app ${app.id} is ${app.bundleId}`);
  }
  if (APPLE_TYPE[product.type] !== tx.type) {
    throw new AppleMappingError(`Apple says ${tx.productId} is "${tx.type}", but the config says ${product.type}`);
  }
  for (const field of ["transactionId", "originalTransactionId", "purchaseDate"] as const) {
    if (tx[field] === undefined || tx[field] === null) throw new AppleMappingError(`transaction has no ${field}`);
  }

  return {
    app_id: app.id,
    store: "app_store",
    environment: tx.environment === "Production" ? "production" : "sandbox",
    transaction_id: String(tx.transactionId),
    original_transaction_id: String(tx.originalTransactionId),
    product_id: tx.productId,
    base_plan_id: null,
    product_type: product.type,
    purchased_at: tx.purchaseDate,
    original_purchased_at: tx.originalPurchaseDate ?? tx.purchaseDate,
    expires_at: product.type === "subscription" ? (tx.expiresDate ?? null) : null,
    period_type: periodType(tx),
    ownership_type: tx.inAppOwnershipType === "FAMILY_SHARED" ? "FAMILY_SHARED" : "PURCHASED",
    price_micros: typeof tx.price === "number" ? tx.price * 1000 : null,
    currency: tx.currency ?? null,
    storefront: tx.storefront ?? null,
    revoked_at: tx.revocationDate ?? null,
    revocation_reason: tx.revocationReason === undefined ? null : String(tx.revocationReason),
    is_upgraded: tx.isUpgraded ? 1 : 0,
    verified: 1,
    source: "sdk",
    subscription_group: tx.subscriptionGroupIdentifier ?? null,
  };
}

/**
 * RevenueCat's CustomerInfo only has normal, trial and intro. Free offers of any kind
 * (introductory, promotional, offer code, win-back) map to trial and paid ones to intro.
 */
function periodType(tx: AppleTransaction): NewTransaction["period_type"] {
  if (!tx.offerType) return "normal";
  return tx.offerDiscountType === "FREE_TRIAL" ? "trial" : "intro";
}

// --- App Store Server Notifications V2 --------------------------------------------------------

/** responseBodyV2DecodedPayload: the fields we use. */
export interface AppleNotification {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  version?: string;
  signedDate: number;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    environment?: "Sandbox" | "Production";
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    /** 1 active, 2 expired, 3 billing retry, 4 billing grace period, 5 revoked. */
    status?: number;
  };
}

/** JWSRenewalInfoDecodedPayload: the fields we use. */
export interface AppleRenewalInfo {
  originalTransactionId: string;
  productId: string;
  autoRenewProductId?: string;
  /** 1 on, 0 off. */
  autoRenewStatus?: number;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  signedDate: number;
  environment?: string;
}

/** Apple's status codes, which the ledger uses for both stores. PAUSED (Google Play only) is ours. */
export const APPLE_STATUS = { ACTIVE: 1, EXPIRED: 2, BILLING_RETRY: 3, GRACE_PERIOD: 4, REVOKED: 5, PAUSED: 6 } as const;

export interface SubscriptionStateUpdate {
  store: "app_store" | "play_store";
  original_transaction_id: string;
  status: number | null;
  auto_renew: number | null;
  auto_renew_product_id: string | null;
  expiration_intent: number | null;
  /** Whether a billing problem is current; the ledger keeps the first time it was seen. */
  billing_issue: boolean;
  grace_period_expires_at: number | null;
  /** Google Play pause: when it resumes. */
  auto_resume_at?: number | null;
  signed_at: number;
}

/**
 * Subscription status from renewal info. `status` comes from the notification when present;
 * otherwise it's inferred from the renewal info's billing-retry and grace-period fields.
 */
export function appleSubscriptionState(renewal: AppleRenewalInfo, status: number | undefined): SubscriptionStateUpdate {
  const inGrace = renewal.gracePeriodExpiresDate !== undefined && renewal.gracePeriodExpiresDate > renewal.signedDate;
  const resolved =
    status ?? (inGrace ? APPLE_STATUS.GRACE_PERIOD : renewal.isInBillingRetryPeriod ? APPLE_STATUS.BILLING_RETRY : null);
  const billingIssue = resolved === APPLE_STATUS.BILLING_RETRY || resolved === APPLE_STATUS.GRACE_PERIOD;
  return {
    store: "app_store",
    original_transaction_id: String(renewal.originalTransactionId),
    status: resolved,
    auto_renew: renewal.autoRenewStatus === undefined ? null : renewal.autoRenewStatus === 1 ? 1 : 0,
    auto_renew_product_id: renewal.autoRenewProductId ?? null,
    expiration_intent: renewal.expirationIntent ?? null,
    billing_issue: billingIssue,
    grace_period_expires_at: resolved === APPLE_STATUS.GRACE_PERIOD ? (renewal.gracePeriodExpiresDate ?? null) : null,
    signed_at: renewal.signedDate,
  };
}
