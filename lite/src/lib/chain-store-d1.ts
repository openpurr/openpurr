// D1 implementation of the Apple ChainStore. Reads are one indexed lookup; a write happens
// only the first time a new Apple signing chain is seen.

import type { ChainStore, VerifiedChain } from "./apple-jws";

export function d1ChainStore(db: D1Database): ChainStore {
  return {
    async get(fingerprint) {
      const row = await db
        .prepare("SELECT leaf_spki, not_before, not_after FROM apple_verified_chain WHERE fingerprint = ?")
        .bind(fingerprint)
        .first<{ leaf_spki: string; not_before: number; not_after: number }>();
      return row ? { leafSpki: row.leaf_spki, notBefore: row.not_before, notAfter: row.not_after } : null;
    },
    async put(fingerprint, chain: VerifiedChain) {
      await db
        .prepare(
          "INSERT OR IGNORE INTO apple_verified_chain (fingerprint, leaf_spki, not_before, not_after, verified_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(fingerprint, chain.leafSpki, chain.notBefore, chain.notAfter, Date.now())
        .run();
    },
  };
}
