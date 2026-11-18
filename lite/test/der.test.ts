import { describe, expect, it } from "vitest";
import { APPLE_ROOT_CA_G3_B64, APPLE_ROOT_CA_G3_SHA256 } from "../src/lib/apple-roots";
import { base64ToBytes, DerError, decodeOid, ecdsaDerToRaw, parseX509 } from "../src/lib/der";

const appleRoot = base64ToBytes(APPLE_ROOT_CA_G3_B64);

describe("parseX509 on Apple Root CA - G3", () => {
  const cert = parseX509(appleRoot);

  it("is the certificate Apple publishes", async () => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", appleRoot));
    expect(Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")).toBe(APPLE_ROOT_CA_G3_SHA256);
  });

  it("reads validity, key and signature algorithm", () => {
    expect(new Date(cert.notBefore).toISOString()).toBe("2014-04-30T18:19:06.000Z");
    expect(new Date(cert.notAfter).toISOString()).toBe("2039-04-30T18:19:06.000Z");
    expect(cert.keyParamsOid).toBe("1.3.132.0.34"); // P-384
    expect(cert.signatureAlgorithm).toBe("1.2.840.10045.4.3.3"); // ecdsa-with-SHA384
    expect(cert.extensionOids).toEqual(expect.arrayContaining(["2.5.29.14", "2.5.29.19", "2.5.29.15"]));
  });

  it("verifies its own self-signature with WebCrypto", async () => {
    const key = await crypto.subtle.importKey("spki", cert.spki, { name: "ECDSA", namedCurve: "P-384" }, false, [
      "verify",
    ]);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-384" },
      key,
      ecdsaDerToRaw(cert.signature, 48),
      cert.tbs,
    );
    expect(ok).toBe(true);
  });
});

describe("DER edge cases", () => {
  it("decodes OIDs, including multi-byte arcs", () => {
    expect(decodeOid(new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]))).toBe("1.2.840.10045.3.1.7");
    expect(decodeOid(new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]))).toBe("1.3.132.0.34");
  });

  it("rejects truncated and trailing input", () => {
    expect(() => parseX509(appleRoot.subarray(0, 100))).toThrow(DerError);
    const padded = new Uint8Array(appleRoot.length + 1);
    padded.set(appleRoot);
    expect(() => parseX509(padded)).toThrow("trailing bytes");
    expect(() => parseX509(new Uint8Array([0x02, 0x01, 0x00]))).toThrow("expected Certificate");
  });
});
