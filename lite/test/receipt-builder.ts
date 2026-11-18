// Builds StoreKit 1 app receipts for tests: PKCS#7 SignedData around a SET of receipt
// attributes. Unsigned (openpurr never trusts the receipt itself). Can produce Xcode-style BER
// with indefinite lengths and the extra OCTET STRING wrapper.

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function length(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

const tlv = (tag: number, ...content: Uint8Array[]) => {
  const body = concat(content);
  return concat([new Uint8Array([tag, ...length(body.length)]), body]);
};
const indefinite = (tag: number, ...content: Uint8Array[]) =>
  concat([new Uint8Array([tag, 0x80]), ...content, new Uint8Array([0, 0])]);

const int = (n: number) => {
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  if (!bytes.length || bytes[0]! & 0x80) bytes.unshift(0);
  return tlv(0x02, new Uint8Array(bytes));
};
const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
const octets = (b: Uint8Array) => tlv(0x04, b);
const oid = (bytes: number[]) => tlv(0x06, new Uint8Array(bytes));
const attr = (type: number, value: Uint8Array) => tlv(0x30, int(type), int(1), octets(value));

const SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01];

export function buildAppReceipt(opts: {
  bundleId?: string;
  inApp?: { productId: string; transactionId: string; originalTransactionId?: string }[];
  /** Xcode-style: indefinite lengths and an extra OCTET STRING around the payload. */
  xcode?: boolean;
}): string {
  const inApps = (opts.inApp ?? []).map((p) =>
    attr(
      17,
      tlv(
        0x31,
        attr(1701, int(1)),
        attr(1702, utf8(p.productId)),
        attr(1703, utf8(p.transactionId)),
        attr(1705, utf8(p.originalTransactionId ?? p.transactionId)),
      ),
    ),
  );
  const payload = tlv(0x31, attr(2, utf8(opts.bundleId ?? "com.example.openpurr")), attr(3, utf8("1.0")), ...inApps);

  let der: Uint8Array;
  if (opts.xcode) {
    const content = indefinite(0xa0, octets(octets(payload)));
    const encap = indefinite(0x30, oid(DATA), content);
    const signedData = indefinite(0x30, int(1), tlv(0x31), encap);
    der = indefinite(0x30, oid(SIGNED_DATA), indefinite(0xa0, signedData));
  } else {
    const encap = tlv(0x30, oid(DATA), tlv(0xa0, octets(payload)));
    const signedData = tlv(0x30, int(1), tlv(0x31), encap, tlv(0x31));
    der = tlv(0x30, oid(SIGNED_DATA), tlv(0xa0, signedData));
  }
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  return btoa(bin);
}
