// M0 spike product catalog. M1 replaces this with the YAML config file (plan section 4).
//
// The SDKs refuse to show offerings whose product IDs the store can't resolve, so point this
// at the real products of your test apps: set SPIKE_CONFIG to a JSON string with this shape
// (in .dev.vars locally, or `wrangler secret put SPIKE_CONFIG`), or edit the default below.

export interface SpikeProduct {
  kind: "subscription" | "non_subscription";
  entitlements: string[];
  /** Spike-only: how long a purchase lasts when the store doesn't say. */
  durationDays?: number;
  /** Android: consumables must be marked or the SDK only acknowledges them. */
  consumable?: boolean;
}

export interface SpikePackage {
  identifier: string;
  /** Store product ID (iOS product ID or Play subscription/product ID). */
  productId: string;
  /** Play subscriptions: the base plan to sell. */
  basePlanId?: string;
}

export interface SpikeConfig {
  /** Keyed by store product ID. */
  products: Record<string, SpikeProduct>;
  currentOffering: string;
  offerings: { identifier: string; description: string; ios: SpikePackage[]; android: SpikePackage[] }[];
}

export const defaultSpikeConfig: SpikeConfig = {
  products: {
    pro_monthly: { kind: "subscription", entitlements: ["pro"], durationDays: 30 },
    pro_annual: { kind: "subscription", entitlements: ["pro"], durationDays: 365 },
    lifetime: { kind: "non_subscription", entitlements: ["pro"] },
    coins_100: { kind: "non_subscription", entitlements: [], consumable: true },
  },
  currentOffering: "default",
  offerings: [
    {
      identifier: "default",
      description: "Default offering",
      ios: [
        { identifier: "$rc_monthly", productId: "pro_monthly" },
        { identifier: "$rc_annual", productId: "pro_annual" },
        { identifier: "$rc_lifetime", productId: "lifetime" },
      ],
      android: [
        { identifier: "$rc_monthly", productId: "pro_monthly", basePlanId: "monthly" },
        { identifier: "$rc_annual", productId: "pro_annual", basePlanId: "annual" },
        { identifier: "$rc_lifetime", productId: "lifetime" },
      ],
    },
  ],
};

let parsed: { raw: string | undefined; config: SpikeConfig } | undefined;

export function spikeConfig(raw: string | undefined): SpikeConfig {
  if (parsed && parsed.raw === raw) return parsed.config;
  const config = raw ? (JSON.parse(raw) as SpikeConfig) : defaultSpikeConfig;
  parsed = { raw, config };
  return config;
}
