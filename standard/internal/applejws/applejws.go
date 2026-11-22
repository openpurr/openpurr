// Package applejws verifies App Store signed data (JWS with an x5c chain), the way Apple's
// app-store-server-library does. A port of lite/src/lib/apple-jws.ts, with crypto/x509 in place of
// Lite's DER reader.
//
// Checks: alg is ES256; x5c is [leaf, intermediate, root]; the root is byte-identical to a trusted
// root; each certificate is signed by the next; all three are valid at the given time; the leaf and
// intermediate carry Apple's marker OIDs; the JWS signature verifies with the leaf key.
//
// The chain check is the expensive part, so verified chains are remembered at two levels:
//  1. per process, in memory (the warm path: one ECDSA P-256 verify);
//  2. in a ChainStore (apple_verified_chain), so another replica, or this one after a restart,
//     reads the stored leaf key instead of re-verifying the chain.
//
// Apple signs with a handful of long-lived leaf certificates, so the store stays tiny and almost
// every request is a cache hit.
package applejws

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"
	"sync"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

const (
	oidLeafMarker         = "1.2.840.113635.100.6.11.1"
	oidIntermediateMarker = "1.2.840.113635.100.6.2.1"
)

var (
	curveOIDs = map[string]elliptic.Curve{
		"1.2.840.10045.3.1.7": elliptic.P256(),
		"1.3.132.0.34":        elliptic.P384(),
	}
	sigAlgs = map[string]x509.SignatureAlgorithm{
		"1.2.840.10045.4.3.2": x509.ECDSAWithSHA256,
		"1.2.840.10045.4.3.3": x509.ECDSAWithSHA384,
	}
)

// Error is a JWS that fails verification. Its message is Lite's AppleJwsError message.
type Error struct{ Msg string }

func (e *Error) Error() string { return e.Msg }

func fail(msg string) error { return &Error{Msg: msg} }

// IsError reports whether err is a verification failure (as opposed to, say, a database error).
func IsError(err error) bool {
	var e *Error
	return errors.As(err, &e)
}

// VerifiedChain is a chain that passed full verification. Validity is the intersection of all
// three certificates.
type VerifiedChain struct {
	// The leaf's SubjectPublicKeyInfo, base64 DER.
	LeafSPKI  string
	NotBefore int64
	NotAfter  int64
}

// ChainStore remembers verified chains across processes. Entries are only ever written after full
// verification.
type ChainStore interface {
	Get(ctx context.Context, fingerprint string) (*VerifiedChain, error)
	Put(ctx context.Context, fingerprint string, chain VerifiedChain) error
}

type cachedChain struct {
	key       *ecdsa.PublicKey
	notBefore int64
	notAfter  int64
}

const maxCache = 64

// Verifier holds the in-memory chain cache. One per process.
type Verifier struct {
	mu    sync.Mutex
	cache map[string]cachedChain
}

func NewVerifier() *Verifier { return &Verifier{cache: map[string]cachedChain{}} }

// Options for one verification.
type Options struct {
	// Trusted root certificates, DER. In production: Apple Root CA G3.
	Roots [][]byte
	// Time (epoch ms) at which certificates must be valid.
	At int64
	// Shared store of verified chains; nil for none.
	Store ChainStore
	// Tests: skip the in-memory cache.
	NoMemoryCache bool
	// Tests: skip both caches and always verify the full chain.
	NoCache bool
}

// Verify checks a compact JWS and returns its payload, parsed with JavaScript semantics. A
// verification failure is an *Error; anything else (a ChainStore failure, a signature that isn't
// base64url) is returned as is, as Lite lets such errors escape as internal errors.
func (v *Verifier) Verify(ctx context.Context, jws string, opts Options) (any, error) {
	parts := strings.Split(jws, ".")
	if len(parts) != 3 {
		return nil, fail("not a compact JWS")
	}
	h, p, s := parts[0], parts[1], parts[2]

	headerBytes, err := DecodeBase64URL(h)
	if err != nil {
		return nil, fail("malformed JWS header")
	}
	header, err := jsobj.Parse(headerBytes)
	if err != nil {
		return nil, fail("malformed JWS header")
	}
	alg, hasAlg := jsobj.Prop(header, "alg")
	if alg != "ES256" {
		return nil, fail("unexpected alg " + jsobj.String(alg, hasAlg))
	}
	x5cV, _ := jsobj.Prop(header, "x5c")
	list, ok := x5cV.([]any)
	if !ok || len(list) != 3 {
		return nil, fail("x5c must have 3 certificates")
	}
	var x5c [3]string
	for i, c := range list {
		str, isStr := c.(string)
		if !isStr {
			return nil, fail("x5c must have 3 certificates")
		}
		x5c[i] = str
	}

	chain, err := v.resolveChain(ctx, x5c, opts)
	if err != nil {
		return nil, err
	}
	if opts.At < chain.notBefore || opts.At > chain.notAfter {
		return nil, fail("certificate not valid at the requested time")
	}

	sig, err := DecodeBase64URL(s)
	if err != nil {
		// Lite's atob throws here, outside its AppleJwsError handling.
		return nil, errors.New("JWS signature is not base64url")
	}
	digest := sha256.Sum256([]byte(h + "." + p))
	if len(sig) != 64 || !ecdsa.Verify(chain.key, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		return nil, fail("JWS signature invalid")
	}
	payloadBytes, err := DecodeBase64URL(p)
	if err != nil {
		return nil, fail("malformed JWS payload")
	}
	payload, err := jsobj.Parse(payloadBytes)
	if err != nil {
		return nil, fail("malformed JWS payload")
	}
	return payload, nil
}

func (v *Verifier) resolveChain(ctx context.Context, x5c [3]string, opts Options) (cachedChain, error) {
	useMemory := !opts.NoCache && !opts.NoMemoryCache
	useStore := !opts.NoCache && opts.Store != nil

	// The root must be trusted on every path, including cache hits, so that removing a root from
	// the trusted set takes effect immediately.
	rootDER, err := decodeCert(x5c[2])
	if err != nil {
		return cachedChain{}, err
	}
	trusted := false
	for _, r := range opts.Roots {
		if bytes.Equal(r, rootDER) {
			trusted = true
			break
		}
	}
	if !trusted {
		return cachedChain{}, fail("root certificate is not trusted")
	}

	memKey := x5c[0] + "." + x5c[1] + "." + x5c[2]
	if useMemory {
		v.mu.Lock()
		hit, ok := v.cache[memKey]
		v.mu.Unlock()
		if ok {
			return hit, nil
		}
	}

	var fingerprint string
	if useStore {
		fingerprint, err = chainFingerprint(x5c)
		if err != nil {
			return cachedChain{}, err
		}
		stored, err := opts.Store.Get(ctx, fingerprint)
		if err != nil {
			return cachedChain{}, err
		}
		if stored != nil {
			key, err := parseP256SPKI(stored.LeafSPKI)
			if err != nil {
				return cachedChain{}, err
			}
			return v.remember(memKey, cachedChain{key: key, notBefore: stored.NotBefore, notAfter: stored.NotAfter}, useMemory), nil
		}
	}

	verified, leafSPKI, err := verifyChain(x5c, rootDER, opts.At)
	if err != nil {
		return cachedChain{}, err
	}
	if useStore {
		err := opts.Store.Put(ctx, fingerprint, VerifiedChain{
			LeafSPKI:  base64.StdEncoding.EncodeToString(leafSPKI),
			NotBefore: verified.notBefore,
			NotAfter:  verified.notAfter,
		})
		if err != nil {
			return cachedChain{}, err
		}
	}
	return v.remember(memKey, verified, useMemory), nil
}

func (v *Verifier) remember(key string, chain cachedChain, enabled bool) cachedChain {
	if enabled {
		v.mu.Lock()
		if len(v.cache) >= maxCache {
			clear(v.cache)
		}
		v.cache[key] = chain
		v.mu.Unlock()
	}
	return chain
}

// chainFingerprint is SHA-256 over the three certificates' DER, hex. It identifies a chain in the
// ChainStore.
func chainFingerprint(x5c [3]string) (string, error) {
	h := sha256.New()
	for _, c := range x5c {
		der, err := decodeCert(c)
		if err != nil {
			return "", err
		}
		h.Write(der)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func parseP256SPKI(b64 string) (*ecdsa.PublicKey, error) {
	der, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	pub, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return nil, err
	}
	key, ok := pub.(*ecdsa.PublicKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("stored chain key is not P-256")
	}
	return key, nil
}

// cert is a parsed certificate plus the raw OIDs Lite reports in its messages.
type cert struct {
	*x509.Certificate
	sigAlgOID   string
	curveOID    string
	extensionOK map[string]bool
}

func verifyChain(x5c [3]string, rootDER []byte, at int64) (cachedChain, []byte, error) {
	leaf, err := parse(x5c[0], nil)
	if err != nil {
		return cachedChain{}, nil, err
	}
	intermediate, err := parse(x5c[1], nil)
	if err != nil {
		return cachedChain{}, nil, err
	}
	root, err := parse("", rootDER)
	if err != nil {
		return cachedChain{}, nil, err
	}

	notBefore := max(leaf.NotBefore.UnixMilli(), intermediate.NotBefore.UnixMilli(), root.NotBefore.UnixMilli())
	notAfter := min(leaf.NotAfter.UnixMilli(), intermediate.NotAfter.UnixMilli(), root.NotAfter.UnixMilli())
	if at < notBefore || at > notAfter {
		return cachedChain{}, nil, fail("certificate not valid at the requested time")
	}
	if !leaf.extensionOK[oidLeafMarker] {
		return cachedChain{}, nil, fail("certificate missing extension " + oidLeafMarker)
	}
	if !intermediate.extensionOK[oidIntermediateMarker] {
		return cachedChain{}, nil, fail("certificate missing extension " + oidIntermediateMarker)
	}
	leafCurve, err := curveOf(leaf)
	if err != nil {
		return cachedChain{}, nil, err
	}
	if leafCurve != elliptic.P256() {
		return cachedChain{}, nil, fail("leaf key must be P-256 for ES256")
	}
	if err := checkSignedBy(intermediate, root); err != nil {
		return cachedChain{}, nil, err
	}
	if err := checkSignedBy(leaf, intermediate); err != nil {
		return cachedChain{}, nil, err
	}
	key, ok := leaf.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return cachedChain{}, nil, fail("unsupported key curve " + leaf.curveOID)
	}
	return cachedChain{key: key, notBefore: notBefore, notAfter: notAfter}, leaf.RawSubjectPublicKeyInfo, nil
}

func decodeCert(b64 string) ([]byte, error) {
	der, err := Atob(b64)
	if err != nil {
		return nil, fail("x5c entry is not base64")
	}
	return der, nil
}

// rawCert is enough of a certificate's structure to read the OIDs crypto/x509 doesn't expose.
type rawCert struct {
	TBS    asn1.RawValue
	SigAlg pkix.AlgorithmIdentifier
	Sig    asn1.BitString
}

type rawTBS struct {
	Version    int `asn1:"optional,explicit,default:0,tag:0"`
	Serial     asn1.RawValue
	SigAlg     asn1.RawValue
	Issuer     asn1.RawValue
	Validity   asn1.RawValue
	Subject    asn1.RawValue
	PublicKey  rawSPKI
	Extensions asn1.RawValue `asn1:"optional,tag:3"`
}

type rawSPKI struct {
	Algorithm pkix.AlgorithmIdentifier
	PublicKey asn1.BitString
}

func parse(b64 string, der []byte) (*cert, error) {
	if der == nil {
		var err error
		if der, err = decodeCert(b64); err != nil {
			return nil, err
		}
	}
	c, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, fail("malformed certificate: " + err.Error())
	}
	out := &cert{Certificate: c, extensionOK: map[string]bool{}}
	for _, e := range c.Extensions {
		out.extensionOK[e.Id.String()] = true
	}
	var raw rawCert
	if _, err := asn1.Unmarshal(der, &raw); err == nil {
		out.sigAlgOID = raw.SigAlg.Algorithm.String()
		var tbs rawTBS
		if _, err := asn1.Unmarshal(raw.TBS.FullBytes, &tbs); err == nil {
			var curve asn1.ObjectIdentifier
			if _, err := asn1.Unmarshal(tbs.PublicKey.Algorithm.Parameters.FullBytes, &curve); err == nil {
				out.curveOID = curve.String()
			}
		}
	}
	return out, nil
}

func curveOf(c *cert) (elliptic.Curve, error) {
	curve, ok := curveOIDs[c.curveOID]
	if !ok {
		name := c.curveOID
		if name == "" {
			name = "(none)"
		}
		return nil, fail("unsupported key curve " + name)
	}
	return curve, nil
}

func checkSignedBy(child, issuer *cert) error {
	alg, ok := sigAlgs[child.sigAlgOID]
	if !ok {
		return fail("unsupported signature algorithm " + child.sigAlgOID)
	}
	if _, err := curveOf(issuer); err != nil {
		return err
	}
	// CheckSignature, unlike CheckSignatureFrom, doesn't require the issuer to be marked as a CA:
	// Lite checks only the signature.
	if err := issuer.CheckSignature(alg, child.RawTBSCertificate, child.Signature); err != nil {
		return fail("certificate chain signature invalid")
	}
	return nil
}

// Atob is JavaScript's atob (forgiving base64): ASCII whitespace is ignored, padding is optional,
// and bits after the last full byte may be anything.
func Atob(s string) ([]byte, error) {
	s = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\n', '\f', '\r':
			return -1
		}
		return r
	}, s)
	if len(s)%4 == 0 {
		if strings.HasSuffix(s, "==") {
			s = s[:len(s)-2]
		} else if strings.HasSuffix(s, "=") {
			s = s[:len(s)-1]
		}
	}
	if len(s)%4 == 1 || strings.ContainsAny(s, "=-_") {
		return nil, errors.New("not base64")
	}
	return base64.RawStdEncoding.DecodeString(s)
}

// DecodeBase64URL is Lite's base64UrlToBytes: base64url to standard, padded, then atob.
func DecodeBase64URL(s string) ([]byte, error) {
	std := strings.NewReplacer("-", "+", "_", "/").Replace(s)
	return Atob(std + strings.Repeat("=", (4-len(std)%4)%4))
}
