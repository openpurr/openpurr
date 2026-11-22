package appleroots

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"testing"
)

func TestProductionRootIsAppleRootCAG3(t *testing.T) {
	der := Production()[0]
	sum := sha256.Sum256(der)
	if hex.EncodeToString(sum[:]) != AppleRootCAG3SHA256 {
		t.Fatal("fingerprint mismatch")
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	if cert.Subject.CommonName != "Apple Root CA - G3" {
		t.Fatalf("unexpected subject %q", cert.Subject.CommonName)
	}
}
