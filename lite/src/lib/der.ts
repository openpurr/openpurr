// Minimal DER helpers: just enough to slice the signed portion out of a certificate and
// convert ECDSA signatures between DER and the raw r||s form WebCrypto expects.

interface Tlv {
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset one past the last content byte. */
  end: number;
}

function readTlv(bytes: Uint8Array, offset: number): Tlv {
  let pos = offset + 1; // skip tag (single-byte tags are all X.509 needs here)
  const first = bytes[pos++];
  if (first === undefined) throw new Error("DER: truncated length");
  let length = first;
  if (first & 0x80) {
    const n = first & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER: unsupported length form");
    length = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[pos++];
      if (b === undefined) throw new Error("DER: truncated length");
      length = length * 256 + b;
    }
  }
  const end = pos + length;
  if (end > bytes.length) throw new Error("DER: length past end of input");
  return { start: offset, contentStart: pos, end };
}

/** Returns the raw DER bytes of tbsCertificate, exactly as they were signed. */
export function tbsBytes(certDer: Uint8Array): Uint8Array {
  const outer = readTlv(certDer, 0);
  const tbs = readTlv(certDer, outer.contentStart);
  return certDer.subarray(tbs.start, tbs.end);
}

/** ECDSA-Sig-Value (DER SEQUENCE of two INTEGERs) to fixed-width r||s. */
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = readTlv(sig, 0);
  const r = readTlv(sig, seq.contentStart);
  const s = readTlv(sig, r.end);
  const out = new Uint8Array(size * 2);
  const put = (tlv: Tlv, at: number) => {
    let v = sig.subarray(tlv.contentStart, tlv.end);
    while (v.length > size && v[0] === 0) v = v.subarray(1); // strip sign padding
    if (v.length > size) throw new Error("DER: ECDSA integer too large");
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

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Decodes a DER OBJECT IDENTIFIER (tag 0x06) to dotted form. */
export function decodeOid(der: Uint8Array): string {
  if (der[0] !== 0x06) throw new Error("DER: not an OBJECT IDENTIFIER");
  const { contentStart, end } = readTlv(der, 0);
  const first = der[contentStart]!;
  const arcs = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (let i = contentStart + 1; i < end; i++) {
    const b = der[i]!;
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      arcs.push(value);
      value = 0;
    }
  }
  return arcs.join(".");
}
