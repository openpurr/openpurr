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
