// Two-step sign-in from the runner's side: RFC 6238 TOTP codes (SHA-1, 30 s, 6 digits) computed
// from the base32 secret /auth/totp/setup returns, on the server's clock (now()). Used by
// tests/operator-auth.test.ts and tests/admin-api.test.ts.

import { createHmac } from "node:crypto";
import { expect } from "vitest";
import { admin, createOperator } from "./admin";
import { now } from "./server";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, without padding. */
export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = BASE32.indexOf(ch);
    if (i < 0) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The 30-second TOTP step at `at` (default: the server's now). */
export const totpStep = (at = now()) => Math.floor(at / 30_000);

/** The 6-digit TOTP code for a base32 secret at `step`. */
export function totpCode(secretB32: string, step = totpStep()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** Turns on two-step sign-in for a signed-in operator: { secret, otpauthUri, recoveryCodes }. */
export async function enrollTotp(session: string) {
  const setup = await admin("POST", "/auth/totp/setup", { session }, { body: {} });
  expect(setup.status).toBe(200);
  const secret = setup.body.secret as string;
  const enable = await admin("POST", "/auth/totp/enable", { session }, { body: { code: totpCode(secret) } });
  expect(enable.status).toBe(200);
  return { secret, otpauthUri: setup.body.otpauth_uri as string, recoveryCodes: enable.body.recovery_codes as string[] };
}

/** An owner who uses two-step sign-in (only they may require it for everyone). */
export async function totpOwner() {
  const owner = await createOperator("owner");
  return { ...owner, ...(await enrollTotp(owner.session)) };
}

/** Requires two-step sign-in for everyone, as an owner who uses it. Returns that owner. */
export async function requireTotp(value = true, by?: { session: string }) {
  const owner = by ?? (await totpOwner());
  const res = await admin("PUT", "/settings", { session: owner.session }, { body: { require_totp: value } });
  expect(res.status).toBe(200);
  return owner;
}
