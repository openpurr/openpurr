package applereceipt_test

import (
	"encoding/base64"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/openpurr/openpurr/standard/internal/applereceipt"
	"github.com/openpurr/openpurr/standard/internal/testutil"
)

var inApp = []testutil.ReceiptInApp{{ProductID: "pro_monthly", TransactionID: "2000000444", OriginalTransactionID: "2000000111"}}

func TestReadsDERReceipts(t *testing.T) {
	r, err := applereceipt.Parse(testutil.BuildAppReceipt("", inApp, false))
	if err != nil {
		t.Fatal(err)
	}
	if r.TransactionID != "2000000444" || !slices.Equal(r.ProductIDs, []string{"pro_monthly"}) {
		t.Fatalf("%+v", r)
	}
}

func TestReadsXcodeReceipts(t *testing.T) {
	r, err := applereceipt.Parse(testutil.BuildAppReceipt("", inApp, true))
	if err != nil {
		t.Fatal(err)
	}
	if r.TransactionID != "2000000444" {
		t.Fatalf("%+v", r)
	}
}

func TestNoInAppPurchases(t *testing.T) {
	for _, xcode := range []bool{false, true} {
		r, err := applereceipt.Parse(testutil.BuildAppReceipt("", nil, xcode))
		if err != nil || r.TransactionID != "" {
			t.Fatalf("%+v %v", r, err)
		}
	}
}

func TestRejectsMalformedReceipts(t *testing.T) {
	good, _ := base64.StdEncoding.DecodeString(testutil.BuildAppReceipt("", inApp, false))
	enc := base64.StdEncoding.EncodeToString
	for _, bad := range []string{"not base64!!", enc([]byte("hello")), enc(good[:40]), enc(good[:len(good)-3])} {
		_, err := applereceipt.Parse(bad)
		var ie *applereceipt.InvalidError
		if !errors.As(err, &ie) {
			t.Errorf("%q: expected InvalidError, got %v", bad, err)
		}
	}
}

func TestRejectsDeepNesting(t *testing.T) {
	nested := "\x04\x00"
	for i := 0; i < 40; i++ {
		nested = "\x30\x80" + nested + "\x00\x00"
	}
	_, err := applereceipt.Parse(base64.StdEncoding.EncodeToString([]byte(nested)))
	if err == nil || !strings.Contains(err.Error(), "deeply") {
		t.Fatalf("got %v", err)
	}
}
