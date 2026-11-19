import { describe, expect, it } from "vitest";
import { ConfigError, entitlementsFor, parseConfig } from "../src/config";
import { rawTestConfig } from "./helpers";

const clone = () => structuredClone(rawTestConfig) as any;
function problems(mutate: (c: any) => void): string[] {
  const c = clone();
  mutate(c);
  try {
    parseConfig(c);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
}

describe("parseConfig", () => {
  it("accepts the test config and the shipped example's shape", () => {
    const config = parseConfig(clone());
    expect([...config.apps.keys()]).toEqual(["ios", "android"]);
    expect(config.keys.get("appl_test_ios_0123456789")?.id).toBe("ios");
    expect(config.projects.get("default")?.currentOffering).toBe("default");
  });

  it("refuses test_ keys, which switch the SDKs to RevenueCat's simulated store", () => {
    expect(problems((c) => (c.apps.ios.sdk_keys = ["test_abcdefghijklmnopqrst"])).join()).toMatch(/must not start with test_/);
  });

  it("checks key prefixes per store and key uniqueness", () => {
    expect(problems((c) => (c.apps.ios.sdk_keys = ["goog_abcdefghijklmnopqrst"])).join()).toMatch(/must start with appl_/);
    expect(problems((c) => (c.apps.android.sdk_keys = c.apps.ios.sdk_keys)).join()).toMatch(/must start with goog_/);
  });

  it("reports unknown products, apps, base plans and keys with their location", () => {
    const found = problems((c) => {
      c.entitlements.pro.products.ios.push("pro_weekly");
      c.entitlements.pro.products.tvos = ["x"];
      c.offerings[0].packages[0].android = "pro:weekly";
      c.apps.ios.colour = "blue";
    });
    expect(found).toEqual(
      expect.arrayContaining([
        "entitlements.pro.products.ios[3]: pro_weekly is not a product of app ios",
        "entitlements.pro.products.tvos[0]: unknown app tvos",
        "offerings[0].packages[0].android: pro:weekly: base plan weekly isn't listed in pro.base_plans",
        expect.stringMatching(/^apps\.ios\.colour: unknown key/),
      ]),
    );
  });

  it("requires a unique bundle ID or package name per store, since notifications are routed by it", () => {
    const dupe = (c: any) => {
      c.apps.ios2 = { ...structuredClone(c.apps.ios), sdk_keys: ["appl_second_ios_app_0000"] };
    };
    expect(problems(dupe)).toContain("apps.ios2.bundle_id: com.example.openpurr is already used by app ios");
    const dupePlay = (c: any) => {
      c.apps.android2 = { ...structuredClone(c.apps.android), sdk_keys: ["goog_second_play_app_0000"] };
    };
    expect(problems(dupePlay)).toContain("apps.android2.package_name: com.example.openpurr is already used by app android");
    // The same ID on different stores is normal (iOS bundle ID = Android package name).
    expect(problems(() => {})).toEqual([]);
  });

  it("requires exactly one current offering", () => {
    expect(problems((c) => (c.offerings[0].current = false)).join()).toMatch(/mark one offering as current/);
    expect(
      problems((c) => c.offerings.push({ ...c.offerings[0], id: "other", current: true })).join(),
    ).toMatch(/only one offering can be current/);
  });

  it("only allows base plans on Play subscriptions", () => {
    expect(problems((c) => (c.entitlements.pro.products.ios = ["pro_monthly:monthly"])).join()).toMatch(
      /only Google Play subscriptions have base plans/,
    );
  });
});

describe("entitlementsFor", () => {
  const config = parseConfig(clone()).projects.get("default")!;
  it("matches a bare Play product against every base plan, and a qualified one against one", () => {
    expect(entitlementsFor(config, "android", "pro", "monthly")).toEqual(["pro"]);
    expect(entitlementsFor(config, "android", "pro", "annual")).toEqual(["pro", "annual_perks"]);
    expect(entitlementsFor(config, "ios", "coins_100", null)).toEqual([]);
  });
});
