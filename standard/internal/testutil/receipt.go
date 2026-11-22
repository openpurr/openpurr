package testutil

import (
	"bytes"
	"encoding/base64"
)

// ReceiptInApp is one in-app purchase in a test receipt.
type ReceiptInApp struct {
	ProductID, TransactionID, OriginalTransactionID string
}

// BuildAppReceipt builds a StoreKit 1 app receipt: PKCS#7 SignedData around a SET of receipt
// attributes, unsigned (openpurr never trusts the receipt itself). With xcode, it uses BER
// indefinite lengths and the extra OCTET STRING wrapper, like Xcode does. A port of
// lite/test/receipt-builder.ts.
func BuildAppReceipt(bundleID string, inApp []ReceiptInApp, xcode bool) string {
	if bundleID == "" {
		bundleID = "com.example.openpurr"
	}
	var inApps [][]byte
	for _, p := range inApp {
		orig := p.OriginalTransactionID
		if orig == "" {
			orig = p.TransactionID
		}
		inApps = append(inApps, attr(17, tlv(0x31,
			attr(1701, asn1Int(1)),
			attr(1702, utf8(p.ProductID)),
			attr(1703, utf8(p.TransactionID)),
			attr(1705, utf8(orig)),
		)))
	}
	payload := tlv(0x31, append([][]byte{attr(2, utf8(bundleID)), attr(3, utf8("1.0"))}, inApps...)...)

	var der []byte
	if xcode {
		content := indefinite(0xa0, octets(octets(payload)))
		encap := indefinite(0x30, oid(dataOID), content)
		signedData := indefinite(0x30, asn1Int(1), tlv(0x31), encap)
		der = indefinite(0x30, oid(signedDataOID), indefinite(0xa0, signedData))
	} else {
		encap := tlv(0x30, oid(dataOID), tlv(0xa0, octets(payload)))
		signedData := tlv(0x30, asn1Int(1), tlv(0x31), encap, tlv(0x31))
		der = tlv(0x30, oid(signedDataOID), tlv(0xa0, signedData))
	}
	return base64.StdEncoding.EncodeToString(der)
}

var (
	signedDataOID = []byte{0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02}
	dataOID       = []byte{0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01}
)

func length(n int) []byte {
	if n < 0x80 {
		return []byte{byte(n)}
	}
	var b []byte
	for v := n; v > 0; v >>= 8 {
		b = append([]byte{byte(v)}, b...)
	}
	return append([]byte{0x80 | byte(len(b))}, b...)
}

func tlv(tag byte, content ...[]byte) []byte {
	body := bytes.Join(content, nil)
	return append(append([]byte{tag}, length(len(body))...), body...)
}

func indefinite(tag byte, content ...[]byte) []byte {
	out := []byte{tag, 0x80}
	out = append(out, bytes.Join(content, nil)...)
	return append(out, 0, 0)
}

func asn1Int(n int) []byte {
	var b []byte
	for v := n; v > 0; v >>= 8 {
		b = append([]byte{byte(v)}, b...)
	}
	if len(b) == 0 || b[0]&0x80 != 0 {
		b = append([]byte{0}, b...)
	}
	return tlv(0x02, b)
}

func utf8(s string) []byte          { return tlv(0x0c, []byte(s)) }
func octets(b []byte) []byte        { return tlv(0x04, b) }
func oid(b []byte) []byte           { return tlv(0x06, b) }
func attr(typ int, v []byte) []byte { return tlv(0x30, asn1Int(typ), asn1Int(1), octets(v)) }
