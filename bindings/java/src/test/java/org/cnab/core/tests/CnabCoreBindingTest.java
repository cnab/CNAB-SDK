package org.cnab.core.tests;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.cnab.core.BarcodeParams;
import org.cnab.core.Boleto;
import org.cnab.core.BrCode;
import org.cnab.core.BrCodeFields;
import org.cnab.core.BrCodeParams;
import org.cnab.core.CnabFile;
import org.cnab.core.CnabFileBuilder;
import org.cnab.core.CnabRecord;
import org.cnab.core.CnabSpec;
import org.cnab.core.FieldSpec;
import org.cnab.core.FieldType;
import org.cnab.core.LineOptions;
import org.cnab.core.Modulo;
import org.cnab.core.ParsedLine;
import org.cnab.core.RecordSpec;
import org.cnab.core.ValidationResult;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the generated Java binding of {@code @cnab/core}.
 *
 * <p>These run against the jar produced by jsii-pacmak, not the TypeScript
 * source, so they cover the projection itself: camelCase naming, struct
 * builders, {@code Number} for TS {@code number}, and map/list marshalling.
 *
 * <p>The Node suite cannot see projection bugs. {@code setDecimal} was
 * {@code void} + mutate, which works in Node (objects by reference) and did
 * nothing at all here, because jsii marshals maps <b>by value</b>. Keep these
 * assertions aligned with {@code packages/core/test/*.js}.
 */
class CnabCoreBindingTest {

    private static final String SEG_P = "cnab240/104/sigcb/remessa/detalhe_segmento_p";
    private static final String DET_400 = "cnab400/341/retorno/detalhe";
    private static final String HEADER = "cnab240/104/sigcb/header_arquivo";

    private static CnabSpec spec;
    private static CnabRecord segP;
    private static CnabRecord det400;
    private static CnabRecord header;

    @BeforeAll
    static void loadSpec() {
        spec = CnabSpec.bundled();
        segP = spec.getRecord(SEG_P);
        det400 = spec.getRecord(DET_400);
        header = spec.getRecord(HEADER);
    }

    private static Map<String, String> map(String... kv) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put(kv[i], kv[i + 1]);
        }
        return m;
    }

    // --- spec registry -----------------------------------------------------

    @Test
    @DisplayName("the bundled spec loads every record")
    void bundledSpecLoads() {
        List<String> keys = spec.recordKeys();
        assertEquals(92, keys.size());
        assertTrue(keys.contains(SEG_P));
    }

    @Test
    void hasRecordDistinguishesKnownAndUnknown() {
        assertTrue(spec.hasRecord(SEG_P));
        assertFalse(spec.hasRecord("cnab240/999/nope"));
    }

    @Test
    void getRecordThrowsForUnknownKey() {
        assertThrows(RuntimeException.class, () -> spec.getRecord("cnab240/999/nope"));
    }

    @Test
    @DisplayName("RecordSpec and FieldSpec structs are projected")
    void structsAreProjected() {
        RecordSpec s = segP.getSpec();
        assertAll(
            () -> assertEquals("cnab240", s.getLayout()),
            () -> assertEquals("104", s.getBank()),
            () -> assertEquals(240, s.getLineLength().intValue()),
            () -> assertFalse(s.getFields().isEmpty()));

        FieldSpec f = s.getFields().get(0);
        assertAll(
            () -> assertEquals("codigo_banco", f.getName()),
            () -> assertEquals(1, f.getStart().intValue()),
            () -> assertEquals(3, f.getEnd().intValue()),
            // named fieldType, not type, because `type` is reserved in Go
            () -> assertEquals(FieldType.NUM, f.getFieldType()));
    }

    // --- parse / toLine ----------------------------------------------------

    @Test
    void toLineProducesTheDeclaredWidth() {
        String line = segP.toLine(map("codigo_banco", "104"));
        assertEquals(240, line.length());
        assertEquals("104", line.substring(0, 3));
    }

    @Test
    void parseRoundTrips() {
        String line = segP.toLine(map("codigo_banco", "104", "valor_titulo", "150000"));
        assertEquals(line, segP.toLine(segP.parse(line)));
    }

    @Test
    void validateAcceptsAGeneratedLine() {
        ValidationResult r = segP.validate(segP.toLine(map("codigo_banco", "104")));
        assertTrue(r.getValid());
        assertTrue(r.getErrors().isEmpty());
    }

    @Test
    void validateRejectsAShortLine() {
        ValidationResult r = segP.validate("104");
        assertFalse(r.getValid());
        assertFalse(r.getErrors().isEmpty());
    }

    // --- strict toLine (the #28 corruption fix must hold here too) ---------

    @Test
    @DisplayName("toLine throws on an oversized value instead of truncating")
    void toLineRejectsOversizedValue() {
        StringBuilder tooLong = new StringBuilder();
        for (int i = 0; i < 17; i++) {
            tooLong.append('1');
        }
        RuntimeException e = assertThrows(
            RuntimeException.class,
            () -> segP.toLine(map("valor_titulo", tooLong.toString())));
        assertTrue(e.getMessage().contains("valor_titulo"), e.getMessage());
    }

    @Test
    void toLineRejectsADecimalStringInANumericField() {
        RuntimeException e = assertThrows(
            RuntimeException.class,
            () -> segP.toLine(map("valor_titulo", "1500.00")));
        assertTrue(e.getMessage().contains("setDecimal"), e.getMessage());
    }

    @Test
    @DisplayName("toLineWithOptions restores the lenient behaviour via a struct builder")
    void lenientOptOut() {
        StringBuilder tooLong = new StringBuilder();
        for (int i = 0; i < 17; i++) {
            tooLong.append('1');
        }
        LineOptions opts = LineOptions.builder()
            .truncateOversized(true)
            .stripNonDigits(true)
            .build();
        String line = segP.toLineWithOptions(map("valor_titulo", tooLong.toString()), opts);
        assertEquals(240, line.length());
    }

    // --- typed values: decimals (ADR 0006) ---------------------------------

    @Test
    void getDecimalInsertsTheImpliedSeparator() {
        assertAll(
            () -> assertEquals("1500.00", segP.getDecimal(map("valor_titulo", "150000"), "valor_titulo")),
            () -> assertEquals("0.01", segP.getDecimal(map("valor_titulo", "1"), "valor_titulo")),
            () -> assertEquals("0.00", segP.getDecimal(map("valor_titulo", "0"), "valor_titulo")));
    }

    @Test
    @DisplayName("setDecimal RETURNS the updated map (jsii marshals maps by value)")
    void setDecimalReturnsANewMap() {
        Map<String, String> out = segP.setDecimal(new HashMap<>(), "valor_titulo", "1500.00");
        assertEquals("150000", out.get("valor_titulo"));
    }

    @Test
    @DisplayName("setDecimal does not mutate its input")
    void setDecimalDoesNotMutateInput() {
        Map<String, String> original = map("codigo_banco", "104");
        Map<String, String> out = segP.setDecimal(original, "valor_titulo", "1500.00");
        assertFalse(original.containsKey("valor_titulo"), "input must be left untouched");
        assertEquals("104", out.get("codigo_banco"), "other keys must be carried over");
    }

    @Test
    void setDecimalPadsAShortFraction() {
        assertEquals("150050", segP.setDecimal(new HashMap<>(), "valor_titulo", "1500.5").get("valor_titulo"));
    }

    @Test
    void setDecimalThrowsOnMalformedInput() {
        for (String bad : Arrays.asList("abc", "1.2.3", "1500.", "-1.00", "1,00")) {
            assertThrows(
                RuntimeException.class,
                () -> segP.setDecimal(new HashMap<>(), "valor_titulo", bad),
                "expected a throw for " + bad);
        }
    }

    @Test
    void setDecimalThrowsWhenFractionExceedsFieldDecimals() {
        assertThrows(
            RuntimeException.class,
            () -> segP.setDecimal(new HashMap<>(), "valor_titulo", "1500.123"));
    }

    @Test
    void decimalRoundTripsThroughToLineAndParse() {
        Map<String, String> values = segP.setDecimal(new HashMap<>(), "valor_titulo", "1234.56");
        String line = segP.toLine(values);
        assertEquals("000000000123456", line.substring(85, 100));
        assertEquals("1234.56", segP.getDecimal(segP.parse(line), "valor_titulo"));
    }

    // --- typed values: dates (ADR 0006) ------------------------------------

    @Test
    void getDateIsoConvertsDdMMyyyy() {
        assertEquals("2026-07-15", segP.getDateIso(map("vencimento", "15072026"), "vencimento"));
    }

    @Test
    void getDateIsoAppliesTheCenturyPivot() {
        assertAll(
            () -> assertEquals("1970-07-15", det400.getDateIso(map("data_vencimento", "150770"), "data_vencimento")),
            () -> assertEquals("2069-07-15", det400.getDateIso(map("data_vencimento", "150769"), "data_vencimento")));
    }

    @Test
    void getDateIsoConvertsHhMmSs() {
        assertEquals("10:30:00", header.getDateIso(map("hora_geracao", "103000"), "hora_geracao"));
    }

    @Test
    @DisplayName("setDateIso RETURNS the updated map and does not mutate")
    void setDateIsoReturnsANewMap() {
        Map<String, String> original = map("codigo_banco", "104");
        Map<String, String> out = segP.setDateIso(original, "vencimento", "2026-07-15");
        assertEquals("15072026", out.get("vencimento"));
        assertFalse(original.containsKey("vencimento"));
        assertEquals("104", out.get("codigo_banco"));
    }

    @Test
    void setDateIsoThrowsOnMalformedInput() {
        assertThrows(
            RuntimeException.class,
            () -> segP.setDateIso(new HashMap<>(), "vencimento", "15/07/2026"));
    }

    @Test
    void setDateIsoThrowsOutsideTheDdMMyyWindow() {
        assertThrows(
            RuntimeException.class,
            () -> det400.setDateIso(new HashMap<>(), "data_vencimento", "2070-01-01"));
    }

    @Test
    void settersComposeWithoutMutation() {
        Map<String, String> v = new HashMap<>();
        v = segP.setDecimal(v, "valor_titulo", "1234.56");
        v = segP.setDateIso(v, "vencimento", "2026-07-15");
        assertEquals("123456", v.get("valor_titulo"));
        assertEquals("15072026", v.get("vencimento"));
    }

    @Test
    void dateRoundTripsThroughToLineAndParse() {
        Map<String, String> values = segP.setDateIso(new HashMap<>(), "vencimento", "2026-07-05");
        assertEquals("2026-07-05", segP.getDateIso(segP.parse(segP.toLine(values)), "vencimento"));
    }

    // --- code tables -------------------------------------------------------

    @Test
    void codeTablesAreAvailable() {
        List<String> keys = spec.codeTableKeys();
        assertEquals(6, keys.size());
        String key = keys.get(0);
        assertTrue(spec.hasCodeTable(key));
        Map<String, String> table = spec.getCodeTable(key);
        assertFalse(table.isEmpty());
        String code = table.keySet().iterator().next();
        assertEquals(table.get(code), spec.lookupCode(key, code));
    }

    // --- check digits and boleto -------------------------------------------

    @Test
    @DisplayName("mod10 matches the Node suite (TS number projects to Number)")
    void modulo10() {
        assertEquals(7, Modulo.mod10("123456789").intValue());
    }

    @Test
    void modulo11BoletoIsInRange() {
        int dv = Modulo.mod11Boleto("1234567890").intValue();
        assertTrue(dv >= 1 && dv <= 9, "dv=" + dv);
    }

    @Test
    @DisplayName("fatorVencimento uses the 2025-02-22 rollover")
    void fatorVencimentoRollover() {
        assertEquals("1000", Boleto.fatorVencimento("2025-02-22"));
    }

    private static String sampleBarcode() {
        StringBuilder free = new StringBuilder();
        for (int i = 0; i < 25; i++) {
            free.append('0');
        }
        return Boleto.barcode(BarcodeParams.builder()
            .bankCode("104")
            .currencyCode("9")
            .dueDateIso("2026-07-15")
            .amountCents("150000")
            .freeField(free.toString())
            .build());
    }

    @Test
    void barcodeIs44DigitsAndSelfConsistent() {
        String barcode = sampleBarcode();
        assertEquals(44, barcode.length());
        assertTrue(barcode.matches("\\d{44}"));
        assertTrue(Boleto.isValidBarcode(barcode));
    }

    @Test
    void linhaDigitavelIs47DigitsAndReversible() {
        String barcode = sampleBarcode();
        String linha = Boleto.linhaDigitavel(barcode);
        assertEquals(47, linha.length());
        assertTrue(linha.matches("\\d{47}"));
        assertEquals(barcode, Boleto.parseLinhaDigitavel(linha));
    }

    // --- whole-file build and parse ----------------------------------------

    private static String buildSampleFile(boolean withDirectionMarker) {
        CnabFileBuilder b = CnabFileBuilder.forBankBundled("cnab240", "104", "sigcb", "remessa");
        b.withHeader(withDirectionMarker
            ? map("codigo_banco", "104", "codigo_remessa_retorno", "1")
            : map("codigo_banco", "104"));
        b.startLote(map("codigo_banco", "104"));
        b.addDetail("detalhe_segmento_p", map("codigo_banco", "104"));
        b.endLote(map("codigo_banco", "104"));
        return b.toFileContent(map("codigo_banco", "104"));
    }

    @Test
    void builderProducesAParseableFile() {
        String content = buildSampleFile(true);

        List<String> lines = new ArrayList<>();
        for (String l : content.split("\n")) {
            if (!l.isEmpty()) {
                lines.add(l);
            }
        }
        assertTrue(lines.size() >= 5, "expected at least 5 lines, got " + lines.size());
        for (String l : lines) {
            assertEquals(240, l.length());
        }

        List<ParsedLine> parsed =
            CnabFile.forBankBundled("cnab240", "104", "sigcb", "remessa").parse(content);
        assertEquals(lines.size(), parsed.size());
        assertTrue(parsed.get(0).getRecordKey().endsWith("header_arquivo"));
        assertEquals("104", parsed.get(0).getFields().get("codigo_banco"));
    }

    @Test
    void detectScopeIdentifiesTheFile() {
        var scope = CnabFile.detectScope(CnabSpec.bundledJson(), buildSampleFile(true));
        assertAll(
            () -> assertEquals("cnab240", scope.getLayout()),
            () -> assertEquals("104", scope.getBank()),
            () -> assertEquals("sigcb", scope.getVariant()),
            () -> assertEquals("remessa", scope.getDirection()));
    }

    @Test
    @DisplayName("detectScope refuses to guess an ambiguous direction")
    void detectScopeRefusesToGuess() {
        RuntimeException e = assertThrows(
            RuntimeException.class,
            () -> CnabFile.detectScope(CnabSpec.bundledJson(), buildSampleFile(false)));
        assertTrue(e.getMessage().contains("direction"), e.getMessage());
    }

    // --- parseToJson (the large-file path) ---------------------------------
    //
    // `parse` returns one ParsedLine per line and jsii marshals each one, with
    // its ~40-key field map, individually. That costs milliseconds per line
    // outside Node, so a real retorno is measured in minutes. `parseToJson` is
    // one crossing of one string that the host decodes itself (ADR 0009).
    // These tests are what proves the projection returns an *undecoded*
    // String — if the jsii runtime ever started interpreting it, the whole
    // point would be lost and nothing in the Node suite would notice.

    private static final ObjectMapper JSON = new ObjectMapper();

    private static String retorno400() {
        CnabRecord detalhe = spec.getRecord(DET_400);
        StringBuilder sb = new StringBuilder();
        sb.append(spec.getRecord("cnab400/341/retorno/header_arquivo").toLine(map())).append('\n');
        for (int i = 0; i < 3; i++) {
            sb.append(detalhe.toLine(map(
                "nosso_numero", "1234" + i,
                "nome_sacado", "CLIENTE " + i))).append('\n');
        }
        sb.append(spec.getRecord("cnab400/341/retorno/trailer_arquivo").toLine(map())).append('\n');
        return sb.toString();
    }

    @Test
    @DisplayName("parseToJson returns an undecoded JSON String")
    void parseToJsonReturnsAString() throws Exception {
        String payload =
            CnabFile.forBankBundled("cnab400", "341", "", "retorno").parseToJson(retorno400());
        assertTrue(payload.startsWith("[{"), payload.substring(0, Math.min(40, payload.length())));
        assertTrue(payload.endsWith("}]"));
        assertTrue(JSON.readTree(payload).isArray());
    }

    @Test
    @DisplayName("parseToJson is exactly parse, serialized")
    void parseToJsonMatchesParse() throws Exception {
        CnabFile file = CnabFile.forBankBundled("cnab400", "341", "", "retorno");
        String content = retorno400();

        JsonNode rows = JSON.readTree(file.parseToJson(content));
        List<ParsedLine> objects = file.parse(content);
        assertEquals(5, rows.size());
        assertEquals(objects.size(), rows.size());

        for (int i = 0; i < objects.size(); i++) {
            JsonNode row = rows.get(i);
            ParsedLine obj = objects.get(i);
            // camelCase keys: this is a data format, not a projected struct, so
            // it does NOT follow the language's naming convention.
            assertEquals(obj.getRecordKey(), row.get("recordKey").asText());
            assertEquals(obj.getTipo(), row.get("tipo").asText());
            assertEquals(obj.getSegment(), row.get("segment").asText());
            Map<String, String> fields = obj.getFields();
            assertEquals(fields.size(), row.get("fields").size());
            for (Map.Entry<String, String> e : fields.entrySet()) {
                assertEquals(e.getValue(), row.get("fields").get(e.getKey()).asText(),
                    "field " + e.getKey());
            }
        }

        assertEquals(DET_400, rows.get(1).get("recordKey").asText());
        assertEquals("12340", rows.get(1).get("fields").get("nosso_numero").asText());
        assertEquals("CLIENTE 0", rows.get(1).get("fields").get("nome_sacado").asText());
    }

    @Test
    @DisplayName("parseToJson escapes alpha values so the payload stays decodable")
    void parseToJsonEscapesValues() throws Exception {
        String line = spec.getRecord(DET_400).toLine(map("nome_sacado", "JOSE \"ZE\" \\ SILVA"));
        JsonNode rows = JSON.readTree(
            CnabFile.forBankBundled("cnab400", "341", "", "retorno").parseToJson(line));
        assertEquals("JOSE \"ZE\" \\ SILVA", rows.get(0).get("fields").get("nome_sacado").asText());
    }

    @Test
    @DisplayName("parseToJson of chunks equals the whole file")
    void parseToJsonChunksEqualWhole() throws Exception {
        // The recipe for large files is to feed parseToJson a few thousand lines
        // at a time; it is correct only because classification is per-line.
        CnabFile file = CnabFile.forBankBundled("cnab400", "341", "", "retorno");
        String content = retorno400();
        JsonNode whole = JSON.readTree(file.parseToJson(content));

        List<String> lines = new ArrayList<>();
        for (String l : content.split("\n")) {
            if (!l.isEmpty()) {
                lines.add(l);
            }
        }
        List<JsonNode> chunked = new ArrayList<>();
        for (int i = 0; i < lines.size(); i += 2) {
            String part = String.join("\n", lines.subList(i, Math.min(i + 2, lines.size())));
            JSON.readTree(file.parseToJson(part)).forEach(chunked::add);
        }

        assertEquals(whole.size(), chunked.size());
        for (int i = 0; i < chunked.size(); i++) {
            assertEquals(whole.get(i), chunked.get(i));
        }
    }

    @Test
    @DisplayName("parseToJson returns an empty array for empty content")
    void parseToJsonEmpty() {
        assertEquals("[]",
            CnabFile.forBankBundled("cnab400", "341", "", "retorno").parseToJson(""));
    }

    // --- BR Code (PIX copia e cola) ---------------------------------------

    @Test
    @DisplayName("crc16 reproduces the canonical CCITT-FALSE check value")
    void brCodeCrc16CanonicalVector() {
        assertEquals("29B1", BrCode.crc16("123456789"));
    }

    private static String samplePayload() {
        return BrCode.encode(BrCodeParams.builder()
            .pixKey("fulano@example.com")
            .merchantName("FULANO DE TAL")
            .merchantCity("BRASILIA")
            .amount("10.00")
            .build());
    }

    @Test
    void brCodeEncodeProducesAValidPayload() {
        String p = samplePayload();
        assertTrue(p.startsWith("000201"), p);
        assertTrue(p.contains("BR.GOV.BCB.PIX"), p);
        assertTrue(BrCode.isValid(p));
    }

    @Test
    @DisplayName("optional struct fields may be omitted in the builder")
    void brCodeOptionalFieldsMayBeOmitted() {
        String p = BrCode.encode(BrCodeParams.builder()
            .pixKey("fulano@example.com")
            .merchantName("FULANO DE TAL")
            .merchantCity("BRASILIA")
            .build());
        assertEquals("", BrCode.decode(p).getAmount());
    }

    @Test
    void brCodeRoundTripsThroughTheBinding() {
        String p = BrCode.encode(BrCodeParams.builder()
            .pixKey("123e4567-e12b-12d1-a456-426655440000")
            .merchantName("LOJA EXEMPLO")
            .merchantCity("RIO DE JANEIRO")
            .amount("1500.00")
            .txid("INV0001")
            .build());
        BrCodeFields f = BrCode.decode(p);
        assertAll(
            () -> assertEquals("123e4567-e12b-12d1-a456-426655440000", f.getPixKey()),
            () -> assertEquals("1500.00", f.getAmount()),
            () -> assertEquals("INV0001", f.getTxid()),
            () -> assertTrue(f.getCrcValid()));
    }

    @Test
    void brCodeRejectsANonDecimalAmount() {
        assertThrows(RuntimeException.class, () -> BrCode.encode(BrCodeParams.builder()
            .pixKey("fulano@example.com")
            .merchantName("FULANO")
            .merchantCity("BRASILIA")
            .amount("10,00")
            .build()));
    }

    @Test
    void brCodeDetectsTampering() {
        String p = samplePayload();
        String tampered = p.replace("540510.00", "540590.00");
        assertNotEquals(p, tampered);
        assertFalse(BrCode.isValid(tampered));
    }
}
