import { describe, expect, it } from "vitest";
import { alpha2FromAlpha3 } from "../src/lib/countries";

describe("alpha2FromAlpha3", () => {
  it("maps Apple's alpha-3 storefront codes to alpha-2", () => {
    expect(alpha2FromAlpha3("USA")).toBe("US");
    expect(alpha2FromAlpha3("DEU")).toBe("DE");
    expect(alpha2FromAlpha3("GBR")).toBe("GB");
    expect(alpha2FromAlpha3("JPN")).toBe("JP");
    expect(alpha2FromAlpha3("NAM")).toBe("NA"); // Namibia, not "not available"
    expect(alpha2FromAlpha3("usa")).toBe("US");
  });

  it("returns null for unknown or missing codes", () => {
    expect(alpha2FromAlpha3("XXX")).toBeNull();
    expect(alpha2FromAlpha3(null)).toBeNull();
    expect(alpha2FromAlpha3("")).toBeNull();
  });
});
