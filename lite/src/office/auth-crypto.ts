// Operator credentials, with WebCrypto only.
//
// One Worker secret, OPERATOR_SECRET (at least 32 random characters), feeds two keys through
// HKDF: the password pepper (HMAC-SHA256) and the TOTP secret encryption key (AES-GCM). Neither
// lives in the database, so a stolen D1 database alone can't be used to crack passwords or
// generate TOTP codes.
//
// Passwords: HMAC-SHA256(pepper, password), then PBKDF2-SHA256 with a random 16-byte salt.
// Workers caps PBKDF2 at 100k iterations and the free plan's CPU budget is 10 ms, so the iteration
// count is about 20k (around 5 ms); the pepper is what protects a leaked database. Stored as
//   pbkdf2-sha256$<iterations>$<pepper id>$<salt b64>$<hash b64>
// so the iteration count or pepper can change, with passwords re-hashed at next sign-in.
//
// TOTP: RFC 6238 with SHA-1, 30-second steps and 6 digits (what authenticator apps support),
// accepting one step of clock drift either way.

import { base64ToBytes, bytesEqual, bytesToBase64 } from "../lib/der";

export const PBKDF2_ITERATIONS = 20_000;
const enc = new TextEncoder();

export class OperatorSecretMissing extends Error {}

interface Keys {
  pepper: CryptoKey;
  pepperId: string;
  totp: CryptoKey;
}
const keyCache = new Map<string, Promise<Keys>>();

async function hex(bytes: ArrayBuffer | Uint8Array, n?: number) {
  return Array.from(new Uint8Array(bytes).subarray(0, n), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** The keys derived from OPERATOR_SECRET. */
export function operatorKeys(secret: string | undefined): Promise<Keys> {
  if (!secret || secret.length < 32) {
    return Promise.reject(new OperatorSecretMissing("The Worker secret OPERATOR_SECRET must be set (at least 32 random characters)."));
  }
  let keys = keyCache.get(secret);
  if (!keys) {
    keys = (async () => {
      const master = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
      const derive = (info: string, alg: SubtleCryptoImportKeyAlgorithm, usages: string[]) =>
        crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) }, master, alg, false, usages);
      return {
        pepper: await derive("openpurr password pepper v1", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
        pepperId: (await sha256Hex(`pepper-id:${secret}`)).slice(0, 8),
        totp: await derive("openpurr totp encryption v1", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
      };
    })();
    keyCache.set(secret, keys);
  }
  return keys;
}

async function derivePassword(keys: Keys, password: string, salt: Uint8Array, iterations: number) {
  const peppered = await crypto.subtle.sign("HMAC", keys.pepper, enc.encode(password));
  const base = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256));
}

export async function hashPassword(secret: string | undefined, password: string, iterations = PBKDF2_ITERATIONS) {
  const keys = await operatorKeys(secret);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(keys, password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${keys.pepperId}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

/** The most iterations a stored hash may ask for (Workers' PBKDF2 limit). */
const MAX_ITERATIONS = 100_000;

function base64OrNull(s: string) {
  try {
    return base64ToBytes(s);
  } catch {
    return null;
  }
}

/** Checks a password. `rehash` is true when it matched but was stored with old parameters. */
export async function verifyPassword(secret: string | undefined, password: string, stored: string) {
  const keys = await operatorKeys(secret);
  const [alg, iter, pepperId, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !iter || !salt || !hash) return { ok: false, rehash: false };
  if (pepperId !== keys.pepperId) {
    // Hashed with a different OPERATOR_SECRET: can't be checked any more. Reset via a login link.
    return { ok: false, rehash: false };
  }
  // A damaged hash (an iteration count PBKDF2 refuses, a salt or hash that isn't base64) is a wrong
  // password, not an error: the sign-in fails, and is counted and audited, like any other.
  const iterations = /^\d+$/.test(iter) ? Number(iter) : NaN;
  const saltBytes = base64OrNull(salt);
  const hashBytes = base64OrNull(hash);
  if (!(iterations >= 1 && iterations <= MAX_ITERATIONS) || !saltBytes || !hashBytes) {
    console.warn("A stored operator password hash can't be read; treating it as a wrong password. Reset the operator to set a new one.");
    await derivePassword(keys, password, new Uint8Array(16), PBKDF2_ITERATIONS); // the same CPU as a real check
    return { ok: false, rehash: false };
  }
  const ok = bytesEqual(await derivePassword(keys, password, saltBytes, iterations), hashBytes);
  return { ok, rehash: ok && iterations !== PBKDF2_ITERATIONS };
}

/** Spends the same CPU as a real check, so unknown emails don't answer faster. */
export async function dummyPasswordCheck(secret: string | undefined, password: string) {
  const keys = await operatorKeys(secret);
  await derivePassword(keys, password, new Uint8Array(16), PBKDF2_ITERATIONS);
}

// --- TOTP --------------------------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("Invalid base32");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export const TOTP_STEP_S = 30;

/** The 6-digit code for a time step (RFC 6238 / RFC 4226). */
export async function totpCode(secret: Uint8Array, step: number) {
  const counter = new Uint8Array(8);
  let s = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = s & 255;
    s = Math.floor(s / 256);
  }
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = mac[19]! & 15;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** The step a code matches (within one step of drift), never at or before `lastStep`; else null. */
export async function verifyTotp(secret: Uint8Array, code: string, now: number, lastStep: number | null) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / TOTP_STEP_S);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if ((await totpCode(secret, step)) === code) return step;
  }
  return null;
}

export function newTotpSecret() {
  return crypto.getRandomValues(new Uint8Array(20));
}

export function otpauthUri(secretB32: string, account: string, issuer = "openpurr") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_S}`;
}

export async function encryptTotpSecret(secret: string | undefined, raw: Uint8Array) {
  const keys = await operatorKeys(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys.totp, raw));
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(ct)}`;
}

export async function decryptTotpSecret(secret: string | undefined, stored: string) {
  const keys = await operatorKeys(secret);
  const [v, iv, ct] = stored.split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("Unknown TOTP secret format");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, keys.totp, base64ToBytes(ct)));
}

// --- tokens and recovery codes ------------------------------------------------------------------

/** A random token for sessions and links (base64url, 32 bytes). */
export function randomToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Ten one-time recovery codes like "k7m2-9qpd" (40 bits each; sign-in is rate limited). */
export function newRecoveryCodes(n = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

export { hex };
