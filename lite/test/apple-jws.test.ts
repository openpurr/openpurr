import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  TEST_JWS_LEAF_WITHOUT_MARKER,
  TEST_JWS_LEAF_WRONG_ISSUER,
  TEST_ROOT_CERT_B64,
  TEST_SIGNED_TRANSACTION,
} from "../src/bench/fixtures.generated";
import { AppleJwsError, type ChainStore, type VerifiedChain, verifyAppleJws } from "../src/lib/apple-jws";
import { d1ChainStore } from "../src/lib/chain-store-d1";
import { base64ToBytes } from "../src/lib/der";

const trustedRoots = [base64ToBytes(TEST_ROOT_CERT_B64)];

function memoryStore() {
  const rows = new Map<string, VerifiedChain>();
  const calls = { get: 0, put: 0 };
  const store: ChainStore = {
    async get(fp) {
      calls.get++;
      return rows.get(fp) ?? null;
    },
    async put(fp, chain) {
      calls.put++;
      rows.set(fp, chain);
    },
  };
  return { store, rows, calls };
}

function tamperPayload(jws: string) {
  const [h, , s] = jws.split(".");
  const forged = btoa(JSON.stringify({ productId: "lifetime" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${h}.${forged}.${s}`;
}

describe("verifyAppleJws", () => {
  it("accepts a valid chain and returns the payload", async () => {
    const tx = await verifyAppleJws<{ productId: string }>(TEST_SIGNED_TRANSACTION, { trustedRoots, noCache: true });
    expect(tx.productId).toBe("pro_monthly");
  });

  it("accepts the same JWS from the warm cache", async () => {
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots });
    const tx = await verifyAppleJws<{ productId: string }>(TEST_SIGNED_TRANSACTION, { trustedRoots });
    expect(tx.productId).toBe("pro_monthly");
  });

  it("rejects a tampered payload, on the cold and warm paths", async () => {
    const forged = tamperPayload(TEST_SIGNED_TRANSACTION);
    await expect(verifyAppleJws(forged, { trustedRoots, noCache: true })).rejects.toThrow("JWS signature invalid");
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots });
    await expect(verifyAppleJws(forged, { trustedRoots })).rejects.toThrow("JWS signature invalid");
  });

  it("rejects a signature that isn't base64url as an invalid JWS", async () => {
    const [h, p] = TEST_SIGNED_TRANSACTION.split(".");
    await expect(verifyAppleJws(`${h}.${p}.%%%`, { trustedRoots, noCache: true })).rejects.toThrow(AppleJwsError);
  });

  it("rejects an untrusted root, even when the chain is cached", async () => {
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots });
    await expect(
      verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots: [new Uint8Array([1, 2, 3])] }),
    ).rejects.toThrow("root certificate is not trusted");
  });

  it("rejects certificates outside their validity period, even when the chain is cached", async () => {
    const at = new Date("2040-01-01");
    await expect(verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, noCache: true, at })).rejects.toThrow(
      "not valid at the requested time",
    );
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots });
    await expect(verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, at })).rejects.toThrow(
      "not valid at the requested time",
    );
  });

  it("rejects a leaf without Apple's marker OID", async () => {
    await expect(verifyAppleJws(TEST_JWS_LEAF_WITHOUT_MARKER, { trustedRoots, noCache: true })).rejects.toThrow(
      "certificate missing extension 1.2.840.113635.100.6.11.1",
    );
  });

  it("rejects a leaf not signed by the intermediate", async () => {
    await expect(verifyAppleJws(TEST_JWS_LEAF_WRONG_ISSUER, { trustedRoots, noCache: true })).rejects.toThrow(
      "certificate chain signature invalid",
    );
  });

  it("rejects malformed input with AppleJwsError", async () => {
    for (const bad of ["", "a.b", "a.b.c", `${btoa('{"alg":"ES256","x5c":["!!","b","c"]}')}.e30.sig`]) {
      await expect(verifyAppleJws(bad, { trustedRoots, noCache: true }), bad).rejects.toBeInstanceOf(AppleJwsError);
    }
    const [, p, s] = TEST_SIGNED_TRANSACTION.split(".");
    const noneAlg = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
    await expect(verifyAppleJws(`${noneAlg}.${p}.${s}`, { trustedRoots })).rejects.toThrow("unexpected alg none");
  });
});

describe("ChainStore", () => {
  it("stores a chain after full verification and reuses it from a fresh isolate", async () => {
    const { store, rows, calls } = memoryStore();
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, store, noIsolateCache: true });
    expect(calls.put).toBe(1);
    expect(rows.size).toBe(1);

    // Second call: the store hit replaces the chain check, so nothing new is written.
    const tx = await verifyAppleJws<{ productId: string }>(TEST_SIGNED_TRANSACTION, {
      trustedRoots,
      store,
      noIsolateCache: true,
    });
    expect(tx.productId).toBe("pro_monthly");
    expect(calls.put).toBe(1);
    expect(calls.get).toBe(2);
  });

  it("never stores a chain that failed verification", async () => {
    const { store, calls } = memoryStore();
    await expect(
      verifyAppleJws(TEST_JWS_LEAF_WRONG_ISSUER, { trustedRoots, store, noIsolateCache: true }),
    ).rejects.toThrow();
    expect(calls.put).toBe(0);
  });

  it("still checks the JWS signature and the root on a store hit", async () => {
    const { store } = memoryStore();
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, store, noIsolateCache: true });
    await expect(
      verifyAppleJws(tamperPayload(TEST_SIGNED_TRANSACTION), { trustedRoots, store, noIsolateCache: true }),
    ).rejects.toThrow("JWS signature invalid");
    await expect(
      verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots: [new Uint8Array([1])], store, noIsolateCache: true }),
    ).rejects.toThrow("root certificate is not trusted");
  });

  it("works against D1", async () => {
    const store = d1ChainStore(env.DB);
    await verifyAppleJws(TEST_SIGNED_TRANSACTION, { trustedRoots, store, noIsolateCache: true });
    const { results } = await env.DB.prepare("SELECT fingerprint, not_before, not_after FROM apple_verified_chain").all<{
      fingerprint: string;
      not_before: number;
      not_after: number;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(results[0]!.not_after).toBe(Date.parse("2036-01-01T00:00:00Z"));
    const tx = await verifyAppleJws<{ productId: string }>(TEST_SIGNED_TRANSACTION, {
      trustedRoots,
      store,
      noIsolateCache: true,
    });
    expect(tx.productId).toBe("pro_monthly");
  });
});
