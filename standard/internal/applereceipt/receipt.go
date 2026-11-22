// Package applereceipt pulls the in-app purchases out of a StoreKit 1 app receipt, like Apple's
// ReceiptUtility.extractTransactionIdFromAppReceipt. A port of lite/src/stores/apple-receipt.ts.
//
// NO validation happens here, by design. The transaction ID is only used to ask the App Store
// Server API for the customer's transactions, and Apple's answer is what we trust; the product IDs
// are only used to answer "not eligible" for intro offers.
//
// The receipt is PKCS#7 SignedData whose content is a SET of attributes
// SEQUENCE { type INTEGER, version INTEGER, value OCTET STRING }. Attribute 17 is an in-app
// purchase receipt: its value is another SET of attributes, where 1702 is the product ID, 1703 the
// transaction ID and 1705 the original transaction ID (each a UTF8String inside the OCTET STRING).
//
// BER indefinite lengths are accepted, because Xcode-generated receipts use them.
package applereceipt

import (
	"bytes"
	"encoding/base64"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	tagSequence    = 0x30
	tagSet         = 0x31
	tagInteger     = 0x02
	tagOctetString = 0x04
	tagOID         = 0x06
	tagUTF8String  = 0x0c
	tagContext0    = 0xa0

	inApp                 = 17
	productID             = 1702
	transactionID         = 1703
	originalTransactionID = 1705
	maxDepth              = 32
)

var pkcs7SignedDataOID = []byte{0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02}

// InvalidError is a malformed receipt.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalid(msg string) *InvalidError { return &InvalidError{Msg: msg} }

type element struct {
	tag          byte
	contentStart int
	// End of the content (before an end-of-contents marker for indefinite lengths).
	contentEnd int
	// End of the whole element.
	end int
}

type parser struct{ b []byte }

func (p *parser) byteAt(i, limit int) byte {
	if i >= limit || i >= len(p.b) {
		panic(invalid("receipt truncated"))
	}
	return p.b[i]
}

func (p *parser) read(offset, limit, depth int) element {
	if depth > maxDepth {
		panic(invalid("receipt nested too deeply"))
	}
	tag := p.byteAt(offset, limit)
	if tag&0x1f == 0x1f {
		panic(invalid("multi-byte tags are not supported"))
	}
	pos := offset + 1
	first := p.byteAt(pos, limit)
	pos++
	if first == 0x80 {
		// Indefinite length: children follow until an end-of-contents marker (00 00).
		if tag&0x20 == 0 {
			panic(invalid("indefinite length on a primitive element"))
		}
		contentStart := pos
		for !(p.byteAt(pos, limit) == 0 && p.byteAt(pos+1, limit) == 0) {
			pos = p.read(pos, limit, depth+1).end
		}
		return element{tag: tag, contentStart: contentStart, contentEnd: pos, end: pos + 2}
	}
	length := int(first)
	if first&0x80 != 0 {
		n := int(first & 0x7f)
		if n > 4 {
			panic(invalid("length too long"))
		}
		length = 0
		for i := 0; i < n; i++ {
			length = length*256 + int(p.byteAt(pos, limit))
			pos++
		}
	}
	end := pos + length
	if end > limit {
		panic(invalid("length past end of receipt"))
	}
	return element{tag: tag, contentStart: pos, contentEnd: end, end: end}
}

func (p *parser) children(parent element, depth int) []element {
	var out []element
	for pos := parent.contentStart; pos < parent.contentEnd; {
		child := p.read(pos, parent.contentEnd, depth+1)
		out = append(out, child)
		pos = child.end
	}
	return out
}

func expect(els []element, i int, tag byte, what string) element {
	if i >= len(els) || els[i].tag != tag {
		panic(invalid("expected " + what))
	}
	return els[i]
}

func (p *parser) integer(el element) int {
	v := 0
	for i := el.contentStart; i < el.contentEnd; i++ {
		v = v*256 + int(p.b[i])
	}
	return v
}

// payload is the receipt payload (a SET of attributes) inside the PKCS#7 envelope.
func (p *parser) payload() element {
	contentInfo := expect([]element{p.read(0, len(p.b), 0)}, 0, tagSequence, "ContentInfo")
	ci := p.children(contentInfo, 0)
	oid := expect(ci, 0, tagOID, "contentType")
	if !bytes.Equal(p.b[oid.contentStart:oid.contentEnd], pkcs7SignedDataOID) {
		panic(invalid("not PKCS#7 signed data"))
	}
	explicit := expect(ci, 1, tagContext0, "[0] content")
	signedData := expect(p.children(explicit, 1), 0, tagSequence, "SignedData")
	encap := expect(p.children(signedData, 2), 2, tagSequence, "encapContentInfo")
	content := expect(p.children(encap, 3), 1, tagContext0, "[0] eContent")
	kids := p.children(content, 4)
	if len(kids) == 0 {
		panic(invalid("expected receipt attributes"))
	}
	inner := kids[0]
	// Xcode wraps the payload in an extra OCTET STRING.
	for depth := 5; inner.tag == tagOctetString && depth < 8; depth++ {
		nested := p.read(inner.contentStart, inner.contentEnd, depth)
		if nested.tag != tagOctetString && nested.tag != tagSet {
			break
		}
		inner = nested
	}
	return expect([]element{inner}, 0, tagSet, "receipt attributes")
}

type attribute struct {
	typ   int
	value element
}

func (p *parser) attributes(set element, depth int) []attribute {
	var out []attribute
	for _, attr := range p.children(set, depth) {
		kids := p.children(expect([]element{attr}, 0, tagSequence, "receipt attribute"), depth+1)
		typ := expect(kids, 0, tagInteger, "attribute type")
		value := expect(kids, 2, tagOctetString, "attribute value")
		out = append(out, attribute{typ: p.integer(typ), value: value})
	}
	return out
}

var numericID = regexp.MustCompile(`^\d{1,30}$`)

// Receipt is what an app receipt lists.
type Receipt struct {
	// A transaction ID from the in-app purchases, or "" if there are none.
	TransactionID string
	ProductIDs    []string
}

// Parse reads an app receipt (base64). It returns an *InvalidError if it's malformed.
func Parse(receiptBase64 string) (r *Receipt, err error) {
	clean := strings.Map(func(c rune) rune {
		switch c {
		case ' ', '\t', '\n', '\r', '\f', '\v':
			return -1
		}
		return c
	}, receiptBase64)
	data, decErr := decodeBase64(clean)
	if decErr != nil {
		return nil, invalid("receipt is not base64")
	}
	p := &parser{b: data}
	defer func() {
		if rec := recover(); rec != nil {
			if ie, ok := rec.(*InvalidError); ok {
				err = ie
				return
			}
			err = invalid("malformed receipt")
		}
	}()
	text := func(el element, depth int) string {
		str := expect([]element{p.read(el.contentStart, el.contentEnd, depth)}, 0, tagUTF8String, "string")
		s := p.b[str.contentStart:str.contentEnd]
		if !utf8.Valid(s) {
			panic(invalid("malformed receipt"))
		}
		return string(s)
	}
	out := &Receipt{}
	seen := map[string]bool{}
	for _, attr := range p.attributes(p.payload(), 6) {
		if attr.typ != inApp {
			continue
		}
		set := expect([]element{p.read(attr.value.contentStart, attr.value.contentEnd, 8)}, 0, tagSet, "in-app receipt")
		for _, field := range p.attributes(set, 9) {
			if field.typ == productID {
				id := text(field.value, 11)
				if !seen[id] {
					seen[id] = true
					out.ProductIDs = append(out.ProductIDs, id)
				}
			}
			if out.TransactionID == "" && (field.typ == transactionID || field.typ == originalTransactionID) {
				id := text(field.value, 11)
				if !numericID.MatchString(id) {
					panic(invalid("transaction ID is not numeric"))
				}
				out.TransactionID = id
			}
		}
	}
	return out, nil
}

// decodeBase64 is atob: standard alphabet, padding optional.
func decodeBase64(s string) ([]byte, error) {
	if strings.ContainsAny(s, "-_") {
		return nil, invalid("not base64")
	}
	return base64.StdEncoding.WithPadding(base64.NoPadding).DecodeString(strings.TrimRight(s, "="))
}
