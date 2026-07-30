// Unit tests for the GENERATED Go binding of @cnab/core.
//
// These run against the module `jsii-pacmak --targets go` emits, not against
// the TypeScript source, so they test what a `go get` consumer actually gets:
// the jsii projection, its Go naming, and the marshalling of maps, structs and
// errors across the runtime boundary.
//
// Why this is a real suite and not a smoke test — the same reason the Python,
// Java and .NET suites exist. The Node tests cannot see projection bugs:
// `setDecimal` was once void + mutate, which works in Node (objects by
// reference) and silently did nothing in the other languages, because jsii
// marshals maps BY VALUE. Two documented helpers were inert in three of four
// shipped languages and every Node test passed.
//
// Go additionally uses POINTERS everywhere (*string, *map[string]*string), so
// a nil that should be a value is a whole failure mode the other three cannot
// have. Several assertions below exist only to pin that.
//
// Keep these aligned with bindings/python/test_cnab_core.py and friends, so a
// divergence between languages shows up as a failure rather than as a gap.
package cnabcore_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/cnab/cnab-core-go/cnabcore"
)

const (
	segP      = "cnab240/104/sigcb/remessa/detalhe_segmento_p"
	header240 = "cnab240/104/sigcb/header_arquivo"
	det400    = "cnab400/341/retorno/detalhe"
)

func s(v string) *string { return &v }

// derefOr keeps failure messages readable: %v on a *string prints its address.
func derefOr(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

func strMap(m map[string]string) *map[string]*string {
	out := make(map[string]*string, len(m))
	for k, v := range m {
		vv := v
		out[k] = &vv
	}
	return &out
}

func TestBundledSpecLoadsEveryRecord(t *testing.T) {
	spec := cnabcore.CnabSpec_Bundled()
	keys := spec.RecordKeys()
	if keys == nil {
		t.Fatal("RecordKeys() returned nil")
	}
	if got := len(*keys); got < 50 {
		t.Fatalf("expected the whole bundled spec, got %d record keys", got)
	}
}

func TestToLineProducesTheDeclaredWidth(t *testing.T) {
	rec := cnabcore.CnabSpec_Bundled().GetRecord(s(header240))
	line := rec.ToLine(strMap(map[string]string{"codigo_banco": "104"}))
	if line == nil {
		t.Fatal("ToLine returned nil")
	}
	if len(*line) != 240 {
		t.Fatalf("expected 240 chars, got %d", len(*line))
	}
	if !strings.HasPrefix(*line, "104") {
		t.Fatalf("expected the bank code at position 1-3, got %q", (*line)[:10])
	}
}

func TestParseRoundTrips(t *testing.T) {
	rec := cnabcore.CnabSpec_Bundled().GetRecord(s(header240))
	line := rec.ToLine(strMap(map[string]string{"codigo_banco": "104"}))
	back := rec.ToLine(rec.Parse(line))
	if back == nil || *back != *line {
		t.Fatal("toLine(parse(line)) is not the identity")
	}
}

// The defect that motivated every binding suite. In Go the argument is a
// *map[string]*string, so a mutating implementation would be invisible here
// exactly as it was in Python/Java/.NET.
func TestSetDecimalReturnsANewMapAndDoesNotMutate(t *testing.T) {
	rec := cnabcore.CnabSpec_Bundled().GetRecord(s(segP))
	input := strMap(map[string]string{})
	out := rec.SetDecimal(input, s("valor_titulo"), s("1500.00"))

	if out == nil {
		t.Fatal("SetDecimal returned nil — the helper is inert in Go")
	}
	got := (*out)["valor_titulo"]
	// Deref before printing: %v on a *string prints the ADDRESS, so a failure
	// here would otherwise report 0xc00002a640 instead of the actual value.
	if got == nil {
		t.Fatal(`expected "150000", got nil`)
	}
	if *got != "150000" {
		t.Fatalf(`expected "150000", got %q`, *got)
	}
	if len(*input) != 0 {
		t.Fatalf("SetDecimal mutated its argument: %v", *input)
	}
}

func TestStrictToLineRejectsAnOversizedValue(t *testing.T) {
	rec := cnabcore.CnabSpec_Bundled().GetRecord(s(segP))
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected a 17-digit value to be rejected by a 15-wide field")
		}
		// A bare non-nil check would also pass for a nil dereference or a typo
		// in the record key, so assert this is the error we actually mean.
		msg := fmt.Sprint(r)
		if !strings.Contains(msg, "valor_titulo") || !strings.Contains(msg, "15 wide") {
			t.Fatalf("panicked for the wrong reason: %s", msg)
		}
	}()
	// 17 significant digits into a 15-wide field: silent truncation here would
	// be undetectable financial corruption, so it must fail loudly.
	rec.ToLine(strMap(map[string]string{"valor_titulo": "12345678901234567"}))
}

func TestCheckDigitsAndBarcode(t *testing.T) {
	if got := cnabcore.Modulo_Mod10(s("123456789")); got == nil || *got < 0 || *got > 9 {
		t.Fatalf("mod10 out of range: %v", got)
	}
	barcode := cnabcore.Boleto_Barcode(&cnabcore.BarcodeParams{
		BankCode:     s("104"),
		CurrencyCode: s("9"),
		DueDateIso:   s("2026-07-15"),
		AmountCents:  s("150000"),
		FreeField:    s("0000000000000000000000000"),
	})
	if barcode == nil || len(*barcode) != 44 {
		t.Fatalf("expected a 44-digit barcode, got %v", barcode)
	}
	if !*cnabcore.Boleto_IsValidBarcode(barcode) {
		t.Fatalf("generated barcode failed its own validation: %s", *barcode)
	}
}

func TestBrCodeRoundTripsThroughTheBinding(t *testing.T) {
	if got := cnabcore.BrCode_Crc16(s("123456789")); got == nil || *got != "29B1" {
		t.Fatalf("CRC-16/CCITT-FALSE check value wrong: %v", got)
	}
	payload := cnabcore.BrCode_Encode(&cnabcore.BrCodeParams{
		PixKey:       s("fulano@example.com"),
		MerchantName: s("FULANO DE TAL"),
		MerchantCity: s("BRASILIA"),
		Amount:       s("10.00"),
	})
	if !*cnabcore.BrCode_IsValid(payload) {
		t.Fatalf("encode produced an invalid payload: %s", *payload)
	}
	fields := cnabcore.BrCode_Decode(payload)
	if fields.PixKey == nil || *fields.PixKey != "fulano@example.com" {
		t.Fatalf("pixKey did not survive the round trip: %q", derefOr(fields.PixKey))
	}
	if fields.CrcValid == nil || !*fields.CrcValid {
		t.Fatal("decode reported an invalid CRC for its own encode output")
	}
}

func TestWholeFileParsing(t *testing.T) {
	spec := cnabcore.CnabSpec_Bundled()
	hdr := spec.GetRecord(s("cnab400/341/retorno/header_arquivo")).ToLine(strMap(map[string]string{}))
	det := spec.GetRecord(s(det400)).ToLine(strMap(map[string]string{}))
	content := strings.Join([]string{*hdr, *det, *det}, "\n")

	rows := cnabcore.CnabFile_ForBankBundled(s("cnab400"), s("341"), s(""), s("retorno")).Parse(s(content))
	if rows == nil || len(*rows) != 3 {
		t.Fatalf("expected 3 parsed lines, got %v", rows)
	}
	got := (*rows)[1].RecordKey
	if got == nil || *got != det400 {
		t.Fatalf("second line classified as %q, want %s", derefOr(got), det400)
	}
}
