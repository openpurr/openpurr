// Minimal DER reader: just enough X.509 to verify an App Store certificate chain, plus
// conversions between DER and the forms WebCrypto expects.
//
// We read six fields from each certificate (the signed bytes, signature algorithm and value,
// validity, public key, extension OIDs). A full ASN.1 library costs about 5 ms of CPU to load
// in a fresh Worker isolate, half the free plan's per-request budget, so we don't use one.

interface Tlv {
  /** The tag byte. Single-byte tags cover everything X.509 needs. */
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset one past the last content byte. */
  end: number;
}

export class DerError extends Error {}

function readTlv(bytes: Uint8Array, offset: number): Tlv {
  const tag = bytes[offset];
  if (tag === undefined) throw new DerError("DER: truncated tag");
  if ((tag & 0x1f) === 0x1f) throw new DerError("DER: multi-byte tags are not supported");
  let pos = offset + 1;
  const first = bytes[pos++];
  if (first === undefined) throw new DerError("DER: truncated length");
  let length = first;
  if (first & 0x80) {
    const n = first & 0x7f;
    if (n === 0 || n > 4) throw new DerError("DER: unsupported length form");
    length = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[pos++];
      if (b === undefined) throw new DerError("DER: truncated length");
      length = length * 256 + b;
    }
  }
  const end = pos + length;
  if (end > bytes.length) throw new DerError("DER: length past end of input");
  return { tag, start: offset, contentStart: pos, end };
}

function expectTag(tlv: Tlv, tag: number, what: string): Tlv {
  if (tlv.tag !== tag) throw new DerError(`DER: expected ${what}`);
  return tlv;
}

/** The TLVs directly inside a constructed TLV. */
function children(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let pos = parent.contentStart; pos < parent.end; ) {
    const child = readTlv(bytes, pos);
    out.push(child);
    pos = child.end;
  }
  return out;
}

const SEQUENCE = 0x30;
const OID = 0x06;
const BIT_STRING = 0x03;
const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;
const EXPLICIT_0 = 0xa0;
const EXPLICIT_3 = 0xa3;

export interface X509Cert {
  der: Uint8Array;
  /** tbsCertificate exactly as signed. */
  tbs: Uint8Array;
  /** Outer signatureAlgorithm OID. */
  signatureAlgorithm: string;
  /** signatureValue contents (for ECDSA: a DER Ecdsa-Sig-Value). */
  signature: Uint8Array;
  notBefore: number;
  notAfter: number;
  /** SubjectPublicKeyInfo, DER, for crypto.subtle.importKey("spki"). */
  spki: Uint8Array;
  /** Key algorithm parameters OID (the named curve for EC keys), if present. */
  keyParamsOid: string | undefined;
  extensionOids: string[];
}

/** Parses the X.509 fields needed for chain verification. Throws DerError on malformed input. */
export function parseX509(der: Uint8Array): X509Cert {
  const cert = expectTag(readTlv(der, 0), SEQUENCE, "Certificate");
  if (cert.end !== der.length) throw new DerError("DER: trailing bytes after Certificate");
  const [tbs, sigAlg, sigVal] = children(der, cert);
  if (!tbs || !sigAlg || !sigVal) throw new DerError("DER: incomplete Certificate");
  expectTag(tbs, SEQUENCE, "tbsCertificate");
  expectTag(sigVal, BIT_STRING, "signatureValue");

  const fields = children(der, tbs);
  let i = fields[0]?.tag === EXPLICIT_0 ? 1 : 0; // optional version
  i += 2; // serialNumber, signature
  i += 1; // issuer
  const validity = expectTag(fields[i++] ?? missing("validity"), SEQUENCE, "validity");
  i += 1; // subject
  const spki = expectTag(fields[i++] ?? missing("subjectPublicKeyInfo"), SEQUENCE, "subjectPublicKeyInfo");
  const extensions = fields.slice(i).find((f) => f.tag === EXPLICIT_3);

  const [notBefore, notAfter] = children(der, validity).map((t) => parseTime(der, t));
  if (notBefore === undefined || notAfter === undefined) throw new DerError("DER: incomplete validity");

  const [keyAlg] = children(der, spki);
  if (!keyAlg) throw new DerError("DER: incomplete subjectPublicKeyInfo");
  const keyParams = children(der, expectTag(keyAlg, SEQUENCE, "AlgorithmIdentifier"))[1];

  const extensionOids: string[] = [];
  if (extensions) {
    const [list] = children(der, extensions);
    if (!list) throw new DerError("DER: empty extensions");
    for (const ext of children(der, expectTag(list, SEQUENCE, "Extensions"))) {
      const [id] = children(der, ext);
      if (!id) throw new DerError("DER: empty extension");
      extensionOids.push(oidAt(der, id));
    }
  }

  const [sigAlgOid] = children(der, expectTag(sigAlg, SEQUENCE, "signatureAlgorithm"));
  if (!sigAlgOid) throw new DerError("DER: empty signatureAlgorithm");
  if (der[sigVal.contentStart] !== 0) throw new DerError("DER: signature with unused bits");

  return {
    der,
    tbs: der.subarray(tbs.start, tbs.end),
    signatureAlgorithm: oidAt(der, sigAlgOid),
    signature: der.subarray(sigVal.contentStart + 1, sigVal.end),
    notBefore,
    notAfter,
    spki: der.subarray(spki.start, spki.end),
    keyParamsOid: keyParams?.tag === OID ? oidAt(der, keyParams) : undefined,
    extensionOids,
  };
}

function missing(what: string): never {
  throw new DerError(`DER: missing ${what}`);
}

function parseTime(der: Uint8Array, t: Tlv): number {
  const s = new TextDecoder().decode(der.subarray(t.contentStart, t.end));
  let m: RegExpMatchArray | null;
  if (t.tag === UTC_TIME && (m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    const yy = Number(m[1]);
    // RFC 5280: UTCTime years 50–99 are 19xx, 00–49 are 20xx.
    return Date.UTC(yy < 50 ? 2000 + yy : 1900 + yy, Number(m[2]) - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  }
  if (t.tag === GENERALIZED_TIME && (m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    return Date.UTC(+m[1]!, Number(m[2]) - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  }
  throw new DerError("DER: unsupported time format");
}

function oidAt(der: Uint8Array, t: Tlv): string {
  return decodeOid(der.subarray(expectTag(t, OID, "OBJECT IDENTIFIER").start, t.end));
}

/** ECDSA-Sig-Value (DER SEQUENCE of two INTEGERs) to fixed-width r||s. */
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = expectTag(readTlv(sig, 0), SEQUENCE, "Ecdsa-Sig-Value");
  const [r, s] = children(sig, seq);
  if (!r || !s) throw new DerError("DER: incomplete Ecdsa-Sig-Value");
  const out = new Uint8Array(size * 2);
  const put = (tlv: Tlv, at: number) => {
    let v = sig.subarray(tlv.contentStart, tlv.end);
    while (v.length > size && v[0] === 0) v = v.subarray(1); // strip sign padding
    if (v.length > size) throw new DerError("DER: ECDSA integer too large");
    out.set(v, at + size - v.length);
  };
  put(r, 0);
  put(s, size);
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Decodes a DER OBJECT IDENTIFIER (tag 0x06) to dotted form. */
export function decodeOid(der: Uint8Array): string {
  const { contentStart, end } = expectTag(readTlv(der, 0), OID, "OBJECT IDENTIFIER");
  const subs: number[] = [];
  let value = 0;
  for (let i = contentStart; i < end; i++) {
    const b = der[i]!;
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      subs.push(value);
      value = 0;
    }
  }
  const [first, ...rest] = subs;
  if (first === undefined || value !== 0) throw new DerError("DER: malformed OBJECT IDENTIFIER");
  // The first subidentifier packs two arcs: 40 * arc1 + arc2, where arc1 is 0, 1 or 2.
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  return [...head, ...rest].join(".");
}

/** PEM (any label) to DER bytes. */
export function pemToDer(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----(BEGIN|END) [^-]+-----/g, "").replace(/\s+/g, ""));
}
