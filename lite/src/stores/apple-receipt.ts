// Pulls a transaction ID out of a StoreKit 1 app receipt, like Apple's
// ReceiptUtility.extractTransactionIdFromAppReceipt (app-store-server-library-node).
//
// NO validation happens here, by design. The ID is only used to ask the App Store Server API
// for the customer's transactions, and Apple's answer is what we trust.
//
// The receipt is PKCS#7 SignedData whose content is a SET of attributes
// SEQUENCE { type INTEGER, version INTEGER, value OCTET STRING }. Attribute 17 is an in-app
// purchase receipt: its value is another SET of attributes, where 1703 is the transaction ID
// and 1705 the original transaction ID (each a UTF8String inside the OCTET STRING).
//
// Unlike the strict DER reader in lib/der.ts, this accepts BER indefinite lengths, because
// Xcode-generated receipts use them.

const SEQUENCE = 0x30;
const SET = 0x31;
const INTEGER = 0x02;
const OCTET_STRING = 0x04;
const OID = 0x06;
const UTF8_STRING = 0x0c;
const CONTEXT_0 = 0xa0;
const PKCS7_SIGNED_DATA_OID = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];

const IN_APP = 17;
const TRANSACTION_ID = 1703;
const ORIGINAL_TRANSACTION_ID = 1705;
const MAX_DEPTH = 32;

export class InvalidReceiptError extends Error {}

interface Element {
  tag: number;
  contentStart: number;
  /** End of the content (before an end-of-contents marker for indefinite lengths). */
  contentEnd: number;
  /** End of the whole element. */
  end: number;
}

function read(bytes: Uint8Array, offset: number, limit: number, depth = 0): Element {
  if (depth > MAX_DEPTH) throw new InvalidReceiptError("receipt nested too deeply");
  const byte = (i: number) => {
    if (i >= limit) throw new InvalidReceiptError("receipt truncated");
    return bytes[i]!;
  };
  const tag = byte(offset);
  if ((tag & 0x1f) === 0x1f) throw new InvalidReceiptError("multi-byte tags are not supported");
  let pos = offset + 1;
  const first = byte(pos++);

  if (first === 0x80) {
    // Indefinite length: children follow until an end-of-contents marker (00 00).
    if (!(tag & 0x20)) throw new InvalidReceiptError("indefinite length on a primitive element");
    const contentStart = pos;
    while (!(byte(pos) === 0 && byte(pos + 1) === 0)) pos = read(bytes, pos, limit, depth + 1).end;
    return { tag, contentStart, contentEnd: pos, end: pos + 2 };
  }

  let length = first;
  if (first & 0x80) {
    const n = first & 0x7f;
    if (n > 4) throw new InvalidReceiptError("length too long");
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + byte(pos++);
  }
  const end = pos + length;
  if (end > limit) throw new InvalidReceiptError("length past end of receipt");
  return { tag, contentStart: pos, contentEnd: end, end };
}

function children(bytes: Uint8Array, parent: Element, depth: number): Element[] {
  const out: Element[] = [];
  for (let pos = parent.contentStart; pos < parent.contentEnd; ) {
    const child = read(bytes, pos, parent.contentEnd, depth + 1);
    out.push(child);
    pos = child.end;
  }
  return out;
}

function expect(el: Element | undefined, tag: number, what: string): Element {
  if (!el || el.tag !== tag) throw new InvalidReceiptError(`expected ${what}`);
  return el;
}

function integer(bytes: Uint8Array, el: Element): number {
  let v = 0;
  for (let i = el.contentStart; i < el.contentEnd; i++) v = v * 256 + bytes[i]!;
  return v;
}

/** The receipt payload (a SET of attributes) inside the PKCS#7 envelope. */
function payload(bytes: Uint8Array): Element {
  const contentInfo = expect(read(bytes, 0, bytes.length), SEQUENCE, "ContentInfo");
  const [type, explicit] = children(bytes, contentInfo, 0);
  const oid = expect(type, OID, "contentType");
  const oidBytes = bytes.subarray(oid.contentStart, oid.contentEnd);
  if (oidBytes.length !== PKCS7_SIGNED_DATA_OID.length || !PKCS7_SIGNED_DATA_OID.every((b, i) => oidBytes[i] === b)) {
    throw new InvalidReceiptError("not PKCS#7 signed data");
  }
  const signedData = expect(children(bytes, expect(explicit, CONTEXT_0, "[0] content"), 1)[0], SEQUENCE, "SignedData");
  const encapContentInfo = expect(children(bytes, signedData, 2)[2], SEQUENCE, "encapContentInfo");
  const content = expect(children(bytes, encapContentInfo, 3)[1], CONTEXT_0, "[0] eContent");
  let inner = children(bytes, content, 4)[0];
  // Xcode wraps the payload in an extra OCTET STRING.
  for (let depth = 5; inner?.tag === OCTET_STRING && depth < 8; depth++) {
    const nested = read(bytes, inner.contentStart, inner.contentEnd, depth);
    if (nested.tag !== OCTET_STRING && nested.tag !== SET) break;
    inner = nested;
  }
  return expect(inner, SET, "receipt attributes");
}

/** Attributes in a receipt SET: [type, value OCTET STRING]. */
function attributes(bytes: Uint8Array, set: Element, depth: number) {
  return children(bytes, set, depth).map((attr) => {
    const [type, , value] = children(bytes, expect(attr, SEQUENCE, "receipt attribute"), depth + 1);
    return { type: integer(bytes, expect(type, INTEGER, "attribute type")), value: expect(value, OCTET_STRING, "attribute value") };
  });
}

/**
 * A transaction ID from the receipt's in-app purchases, or null if the receipt has none (for
 * example, an app that has never sold anything). Throws InvalidReceiptError if malformed.
 */
export function transactionIdFromAppReceipt(receiptBase64: string): string | null {
  let bytes: Uint8Array;
  try {
    const bin = atob(receiptBase64.replace(/\s+/g, ""));
    bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    throw new InvalidReceiptError("receipt is not base64");
  }
  try {
    for (const attr of attributes(bytes, payload(bytes), 6)) {
      if (attr.type !== IN_APP) continue;
      const inApp = expect(read(bytes, attr.value.contentStart, attr.value.contentEnd, 8), SET, "in-app receipt");
      for (const field of attributes(bytes, inApp, 9)) {
        if (field.type !== TRANSACTION_ID && field.type !== ORIGINAL_TRANSACTION_ID) continue;
        const str = expect(read(bytes, field.value.contentStart, field.value.contentEnd, 11), UTF8_STRING, "transaction ID");
        const id = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(str.contentStart, str.contentEnd));
        if (!/^\d{1,30}$/.test(id)) throw new InvalidReceiptError("transaction ID is not numeric");
        return id;
      }
    }
    return null;
  } catch (err) {
    if (err instanceof InvalidReceiptError) throw err;
    throw new InvalidReceiptError("malformed receipt");
  }
}
