// Generates golden-auth.json: what Lite's own operator credential code (lite/src/office/auth-crypto.ts)
// produces, so the Go tests can check that Standard's password hashes, TOTP codes, encrypted TOTP
// secrets, base32 and recovery-code handling are the same byte for byte, and that credentials
// made by either edition work on the other.
//
// crypto.getRandomValues is replaced by a counter, so salts and IVs are predictable and the Go side
// can make the same hashes from the same bytes.
//
// Regenerate after changing that code in Lite, from the repo root:
//   lite/node_modules/.bin/esbuild standard/internal/testdata/golden-auth.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/golden-auth.mjs && node /tmp/golden-auth.mjs > standard/internal/testdata/golden-auth.json

import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  hashPassword,
  newRecoveryCodes,
  normalizeRecoveryCode,
  operatorKeys,
  otpauthUri,
  PBKDF2_ITERATIONS,
  randomToken,
  sha256Hex,
  totpCode,
  verifyPassword,
  verifyTotp,
} from "../../../lite/src/office/auth-crypto";

let counter = 0;
const realGetRandomValues = crypto.getRandomValues.bind(crypto);
// Predictable "random" bytes: 1, 2, 3, ... (mod 256), continuing across calls.
crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
  const view = new Uint8Array((array as unknown as ArrayBufferView).buffer, (array as unknown as ArrayBufferView).byteOffset, (array as unknown as ArrayBufferView).byteLength);
  for (let i = 0; i < view.length; i++) view[i] = ++counter & 255;
  return array;
}) as typeof crypto.getRandomValues;
void realGetRandomValues;

const SECRET = "golden-operator-secret-0123456789abcdef";
const OTHER_SECRET = "another-operator-secret-0123456789abcdef";
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function main() {
  const keys = await operatorKeys(SECRET);
  const passwords = ["a long test passphrase", "correct horse battery staple", "ünïcödé pässwörd ✓", "x".repeat(128)];
  const hashes = [];
  for (const password of passwords) {
    const start = counter;
    hashes.push({ password, iterations: PBKDF2_ITERATIONS, randomStart: start, hash: await hashPassword(SECRET, password) });
  }
  // An older iteration count: still verifies, and asks for a re-hash.
  const startOld = counter;
  hashes.push({ password: "an old hashed passphrase", iterations: 1000, randomStart: startOld, hash: await hashPassword(SECRET, "an old hashed passphrase", 1000) });
  const otherHash = await hashPassword(OTHER_SECRET, "a long test passphrase");

  const verifyCases = [];
  for (const h of hashes) {
    for (const attempt of [h.password, `${h.password} `, "wrong"]) {
      verifyCases.push({ stored: h.hash, password: attempt, ...(await verifyPassword(SECRET, attempt, h.hash)) });
    }
  }
  verifyCases.push({ stored: otherHash, password: "a long test passphrase", ...(await verifyPassword(SECRET, "a long test passphrase", otherHash)) });
  for (const stored of ["", "bcrypt$1$x$y$z", "pbkdf2-sha256$$x$y$z"]) {
    verifyCases.push({ stored, password: "anything at all", ...(await verifyPassword(SECRET, "anything at all", stored)) });
  }

  const totpSecret = new Uint8Array(Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255));
  const steps = [0, 1, 59, 1_000_000, 59_999_999, 60_000_000];
  const codes = [];
  for (const step of steps) codes.push({ step, code: await totpCode(totpSecret, step) });
  // RFC 6238's SHA-1 test secret ("12345678901234567890").
  const rfc = new TextEncoder().encode("12345678901234567890");
  const rfcCodes = [];
  for (const t of [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000]) rfcCodes.push({ step: Math.floor(t / 30), code: await totpCode(rfc, Math.floor(t / 30)) });

  const now = 1_800_000_015_000;
  const current = Math.floor(now / 1000 / 30);
  const verifyTotpCases = [];
  for (const [code, lastStep] of [
    [await totpCode(totpSecret, current), null],
    [await totpCode(totpSecret, current - 1), null],
    [await totpCode(totpSecret, current + 1), null],
    [await totpCode(totpSecret, current + 2), null],
    [await totpCode(totpSecret, current), current],
    [await totpCode(totpSecret, current + 1), current],
    ["12345", null],
    ["1234567", null],
    ["abcdef", null],
  ] as [string, number | null][]) {
    verifyTotpCases.push({ code, lastStep, now, step: await verifyTotp(totpSecret, code, now, lastStep) });
  }

  const b32Bytes = [new Uint8Array([]), new Uint8Array([0]), new Uint8Array([255]), new Uint8Array([1, 2, 3, 4, 5]), totpSecret, rfc];
  const base32 = b32Bytes.map((b) => ({ hex: hex(b), encoded: base32Encode(b) }));
  const base32Decoded = ["JBSWY3DP", "jbswy3dp", "JBSW Y3DP", "JBSW-Y3DP====", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"].map((s) => ({ input: s, hex: hex(base32Decode(s)) }));

  const startEnc = counter;
  const encrypted = await encryptTotpSecret(SECRET, totpSecret);
  const decrypted = hex(await decryptTotpSecret(SECRET, encrypted));

  const startToken = counter;
  const token = randomToken();
  const startCodes = counter;
  const recoveryCodes = newRecoveryCodes();

  return {
    secret: SECRET,
    otherSecret: OTHER_SECRET,
    pepperId: keys.pepperId,
    iterations: PBKDF2_ITERATIONS,
    hashes,
    verifyCases,
    totpSecretHex: hex(totpSecret),
    codes,
    rfcCodes,
    verifyTotpCases,
    base32,
    base32Decoded,
    encrypted: { randomStart: startEnc, stored: encrypted, rawHex: decrypted },
    randomToken: { randomStart: startToken, token },
    recoveryCodes: { randomStart: startCodes, codes: recoveryCodes },
    normalized: ["k7m2-9qpd", "K7M2 9QPD", "k7m29qpd", " k7m2_9qpd ", "k7m2-9qp", "K7M2-9QPD-X"].map((input) => ({ input, output: normalizeRecoveryCode(input) })),
    otpauth: ["owner@example.com", "Jane Doe+tag@example.com", "a&b=c@example.com"].map((account) => ({ account, secret: base32Encode(totpSecret), uri: otpauthUri(base32Encode(totpSecret), account) })),
    sha256: await Promise.all(["", "pat_abc", "ünïcödé"].map(async (input) => ({ input, hex: await sha256Hex(input) }))),
  };
}

main().then((out) => process.stdout.write(`${JSON.stringify(out, null, 2)}\n`));
