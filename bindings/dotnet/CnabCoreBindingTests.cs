using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Cnab.Core;
using Xunit;

namespace Cnab.Core.BindingTests
{
    /// <summary>
    /// Unit tests for the generated .NET binding of <c>@cnab/core</c>.
    ///
    /// These run against the NuGet package produced by jsii-pacmak, not the
    /// TypeScript source, so they cover the projection: PascalCase members,
    /// <c>IDictionary&lt;string,string&gt;</c> marshalling, <c>double</c> for TS
    /// <c>number</c>, and struct classes for props-only interfaces.
    ///
    /// The Node suite cannot see projection bugs. <c>SetDecimal</c> was void +
    /// mutate, which works in Node (objects by reference) and did nothing at all
    /// here, because jsii marshals maps BY VALUE. Keep these aligned with
    /// packages/core/test/*.js.
    /// </summary>
    public class CnabCoreBindingTests
    {
        private const string SegPKey = "cnab240/104/sigcb/remessa/detalhe_segmento_p";
        private const string Det400Key = "cnab400/341/retorno/detalhe";
        private const string HeaderKey = "cnab240/104/sigcb/header_arquivo";

        private readonly CnabSpec _spec = CnabSpec.Bundled();
        private readonly CnabRecord _segP;
        private readonly CnabRecord _det400;
        private readonly CnabRecord _header;

        public CnabCoreBindingTests()
        {
            _segP = _spec.GetRecord(SegPKey);
            _det400 = _spec.GetRecord(Det400Key);
            _header = _spec.GetRecord(HeaderKey);
        }

        private static IDictionary<string, string> Map(params string[] kv)
        {
            var m = new Dictionary<string, string>();
            for (var i = 0; i < kv.Length; i += 2)
            {
                m[kv[i]] = kv[i + 1];
            }
            return m;
        }

        // --- spec registry -------------------------------------------------

        [Fact]
        public void BundledSpecLoadsEveryRecord()
        {
            var keys = _spec.RecordKeys();
            Assert.Equal(92, keys.Length);
            Assert.Contains(SegPKey, keys);
        }

        [Fact]
        public void HasRecordDistinguishesKnownAndUnknown()
        {
            Assert.True(_spec.HasRecord(SegPKey));
            Assert.False(_spec.HasRecord("cnab240/999/nope"));
        }

        [Fact]
        public void GetRecordThrowsForUnknownKey()
        {
            Assert.ThrowsAny<Exception>(() => _spec.GetRecord("cnab240/999/nope"));
        }

        [Fact]
        public void StructsAreProjected()
        {
            var s = _segP.Spec;
            Assert.Equal("cnab240", s.Layout);
            Assert.Equal("104", s.Bank);
            Assert.Equal(240, (int)s.LineLength);
            Assert.NotEmpty(s.Fields);

            var f = s.Fields[0];
            Assert.Equal("codigo_banco", f.Name);
            Assert.Equal(1, (int)f.Start);
            Assert.Equal(3, (int)f.End);
            // FieldType, not Type: `type` is reserved in Go
            Assert.Equal(FieldType.NUM, f.FieldType);
        }

        // --- parse / ToLine -------------------------------------------------

        [Fact]
        public void ToLineProducesTheDeclaredWidth()
        {
            var line = _segP.ToLine(Map("codigo_banco", "104"));
            Assert.Equal(240, line.Length);
            Assert.Equal("104", line.Substring(0, 3));
        }

        [Fact]
        public void ParseRoundTrips()
        {
            var line = _segP.ToLine(Map("codigo_banco", "104", "valor_titulo", "150000"));
            Assert.Equal(line, _segP.ToLine(_segP.Parse(line)));
        }

        [Fact]
        public void ValidateAcceptsAGeneratedLine()
        {
            var r = _segP.Validate(_segP.ToLine(Map("codigo_banco", "104")));
            Assert.True(r.Valid);
            Assert.Empty(r.Errors);
        }

        [Fact]
        public void ValidateRejectsAShortLine()
        {
            var r = _segP.Validate("104");
            Assert.False(r.Valid);
            Assert.NotEmpty(r.Errors);
        }

        // --- strict ToLine (the #28 corruption fix must hold here too) -------

        [Fact]
        public void ToLineRejectsAnOversizedValue()
        {
            var e = Assert.ThrowsAny<Exception>(
                () => _segP.ToLine(Map("valor_titulo", new string('1', 17))));
            Assert.Contains("valor_titulo", e.Message);
        }

        [Fact]
        public void ToLineRejectsADecimalStringInANumericField()
        {
            var e = Assert.ThrowsAny<Exception>(
                () => _segP.ToLine(Map("valor_titulo", "1500.00")));
            Assert.Contains("setDecimal", e.Message);
        }

        [Fact]
        public void ToLineWithOptionsRestoresLenientBehaviour()
        {
            // jsii has no overloads, so the lenient path is a separate method
            // taking a struct.
            var opts = new LineOptions { TruncateOversized = true, StripNonDigits = true };
            var line = _segP.ToLineWithOptions(Map("valor_titulo", new string('1', 17)), opts);
            Assert.Equal(240, line.Length);
        }

        // --- typed values: decimals (ADR 0006) -------------------------------

        [Fact]
        public void GetDecimalInsertsTheImpliedSeparator()
        {
            Assert.Equal("1500.00", _segP.GetDecimal(Map("valor_titulo", "150000"), "valor_titulo"));
            Assert.Equal("0.01", _segP.GetDecimal(Map("valor_titulo", "1"), "valor_titulo"));
            Assert.Equal("0.00", _segP.GetDecimal(Map("valor_titulo", "0"), "valor_titulo"));
        }

        /// <summary>The regression this suite exists to catch.</summary>
        [Fact]
        public void SetDecimalReturnsANewMap()
        {
            var outMap = _segP.SetDecimal(new Dictionary<string, string>(), "valor_titulo", "1500.00");
            Assert.Equal("150000", outMap["valor_titulo"]);
        }

        [Fact]
        public void SetDecimalDoesNotMutateItsInput()
        {
            var original = Map("codigo_banco", "104");
            var outMap = _segP.SetDecimal(original, "valor_titulo", "1500.00");
            Assert.False(original.ContainsKey("valor_titulo"));
            Assert.Equal("104", outMap["codigo_banco"]);
        }

        [Fact]
        public void SetDecimalPadsAShortFraction()
        {
            var outMap = _segP.SetDecimal(new Dictionary<string, string>(), "valor_titulo", "1500.5");
            Assert.Equal("150050", outMap["valor_titulo"]);
        }

        [Theory]
        [InlineData("abc")]
        [InlineData("1.2.3")]
        [InlineData("1500.")]
        [InlineData("-1.00")]
        [InlineData("1,00")]
        public void SetDecimalThrowsOnMalformedInput(string bad)
        {
            Assert.ThrowsAny<Exception>(
                () => _segP.SetDecimal(new Dictionary<string, string>(), "valor_titulo", bad));
        }

        [Fact]
        public void SetDecimalThrowsWhenFractionExceedsFieldDecimals()
        {
            Assert.ThrowsAny<Exception>(
                () => _segP.SetDecimal(new Dictionary<string, string>(), "valor_titulo", "1500.123"));
        }

        [Fact]
        public void DecimalRoundTripsThroughToLineAndParse()
        {
            var values = _segP.SetDecimal(new Dictionary<string, string>(), "valor_titulo", "1234.56");
            var line = _segP.ToLine(values);
            Assert.Equal("000000000123456", line.Substring(85, 15));
            Assert.Equal("1234.56", _segP.GetDecimal(_segP.Parse(line), "valor_titulo"));
        }

        // --- typed values: dates (ADR 0006) ----------------------------------

        [Fact]
        public void GetDateIsoConvertsDdMMyyyy()
        {
            Assert.Equal("2026-07-15", _segP.GetDateIso(Map("vencimento", "15072026"), "vencimento"));
        }

        [Fact]
        public void GetDateIsoAppliesTheCenturyPivot()
        {
            Assert.Equal("1970-07-15", _det400.GetDateIso(Map("data_vencimento", "150770"), "data_vencimento"));
            Assert.Equal("2069-07-15", _det400.GetDateIso(Map("data_vencimento", "150769"), "data_vencimento"));
        }

        [Fact]
        public void GetDateIsoConvertsHhMmSs()
        {
            Assert.Equal("10:30:00", _header.GetDateIso(Map("hora_geracao", "103000"), "hora_geracao"));
        }

        [Fact]
        public void SetDateIsoReturnsANewMapAndDoesNotMutate()
        {
            var original = Map("codigo_banco", "104");
            var outMap = _segP.SetDateIso(original, "vencimento", "2026-07-15");
            Assert.Equal("15072026", outMap["vencimento"]);
            Assert.False(original.ContainsKey("vencimento"));
            Assert.Equal("104", outMap["codigo_banco"]);
        }

        [Fact]
        public void SetDateIsoThrowsOnMalformedInput()
        {
            Assert.ThrowsAny<Exception>(
                () => _segP.SetDateIso(new Dictionary<string, string>(), "vencimento", "15/07/2026"));
        }

        [Fact]
        public void SetDateIsoThrowsOutsideTheDdMMyyWindow()
        {
            Assert.ThrowsAny<Exception>(
                () => _det400.SetDateIso(new Dictionary<string, string>(), "data_vencimento", "2070-01-01"));
        }

        [Fact]
        public void SettersComposeWithoutMutation()
        {
            IDictionary<string, string> v = new Dictionary<string, string>();
            v = _segP.SetDecimal(v, "valor_titulo", "1234.56");
            v = _segP.SetDateIso(v, "vencimento", "2026-07-15");
            Assert.Equal("123456", v["valor_titulo"]);
            Assert.Equal("15072026", v["vencimento"]);
        }

        [Fact]
        public void DateRoundTripsThroughToLineAndParse()
        {
            var values = _segP.SetDateIso(new Dictionary<string, string>(), "vencimento", "2026-07-05");
            var parsed = _segP.Parse(_segP.ToLine(values));
            Assert.Equal("2026-07-05", _segP.GetDateIso(parsed, "vencimento"));
        }

        // --- code tables -----------------------------------------------------

        [Fact]
        public void CodeTablesAreAvailable()
        {
            var keys = _spec.CodeTableKeys();
            Assert.Equal(6, keys.Length);
            var key = keys[0];
            Assert.True(_spec.HasCodeTable(key));
            var table = _spec.GetCodeTable(key);
            Assert.NotEmpty(table);
            var code = table.Keys.First();
            Assert.Equal(table[code], _spec.LookupCode(key, code));
        }

        // --- check digits and boleto -----------------------------------------

        [Fact]
        public void Modulo10MatchesTheNodeSuite()
        {
            Assert.Equal(7, (int)Modulo.Mod10("123456789"));
        }

        [Fact]
        public void Modulo11BoletoIsInRange()
        {
            var dv = (int)Modulo.Mod11Boleto("1234567890");
            Assert.InRange(dv, 1, 9);
        }

        [Fact]
        public void FatorVencimentoUsesThe2025Rollover()
        {
            Assert.Equal("1000", Boleto.FatorVencimento("2025-02-22"));
        }

        private static string SampleBarcode()
        {
            return Boleto.Barcode(new BarcodeParams
            {
                BankCode = "104",
                CurrencyCode = "9",
                DueDateIso = "2026-07-15",
                AmountCents = "150000",
                FreeField = new string('0', 25),
            });
        }

        [Fact]
        public void BarcodeIs44DigitsAndSelfConsistent()
        {
            var barcode = SampleBarcode();
            Assert.Equal(44, barcode.Length);
            Assert.All(barcode, ch => Assert.True(char.IsDigit(ch)));
            Assert.True(Boleto.IsValidBarcode(barcode));
        }

        [Fact]
        public void LinhaDigitavelIs47DigitsAndReversible()
        {
            var barcode = SampleBarcode();
            var linha = Boleto.LinhaDigitavel(barcode);
            Assert.Equal(47, linha.Length);
            Assert.All(linha, ch => Assert.True(char.IsDigit(ch)));
            Assert.Equal(barcode, Boleto.ParseLinhaDigitavel(linha));
        }

        // --- whole-file build and parse ---------------------------------------

        private static string BuildSampleFile(bool withDirectionMarker)
        {
            var b = CnabFileBuilder.ForBankBundled("cnab240", "104", "sigcb", "remessa");
            b.WithHeader(withDirectionMarker
                ? Map("codigo_banco", "104", "codigo_remessa_retorno", "1")
                : Map("codigo_banco", "104"));
            b.StartLote(Map("codigo_banco", "104"));
            b.AddDetail("detalhe_segmento_p", Map("codigo_banco", "104"));
            b.EndLote(Map("codigo_banco", "104"));
            return b.ToFileContent(Map("codigo_banco", "104"));
        }

        [Fact]
        public void BuilderProducesAParseableFile()
        {
            var content = BuildSampleFile(true);
            var lines = content.Split('\n').Where(l => l.Length > 0).ToArray();

            Assert.True(lines.Length >= 5, $"expected >= 5 lines, got {lines.Length}");
            Assert.All(lines, l => Assert.Equal(240, l.Length));

            var parsed = CnabFile.ForBankBundled("cnab240", "104", "sigcb", "remessa").Parse(content);
            Assert.Equal(lines.Length, parsed.Length);
            Assert.EndsWith("header_arquivo", parsed[0].RecordKey);
            Assert.Equal("104", parsed[0].Fields["codigo_banco"]);
        }

        [Fact]
        public void DetectScopeIdentifiesTheFile()
        {
            var scope = CnabFile.DetectScope(CnabSpec.BundledJson(), BuildSampleFile(true));
            Assert.Equal("cnab240", scope.Layout);
            Assert.Equal("104", scope.Bank);
            Assert.Equal("sigcb", scope.Variant);
            Assert.Equal("remessa", scope.Direction);
        }

        [Fact]
        public void DetectScopeRefusesToGuessAnAmbiguousDirection()
        {
            var e = Assert.ThrowsAny<Exception>(
                () => CnabFile.DetectScope(CnabSpec.BundledJson(), BuildSampleFile(false)));
            Assert.Contains("direction", e.Message);
        }

        // --- ParseToJson (the large-file path) --------------------------------
        //
        // `Parse` returns one ParsedLine per line and jsii marshals each one,
        // with its ~40-key field map, individually — milliseconds per line, so
        // a real retorno takes minutes. `ParseToJson` is one crossing of one
        // string that the host decodes itself with System.Text.Json (ADR 0009).
        // These tests exist to pin that the projection hands back an
        // *undecoded* string; nothing in the Node suite could see it change.

        private string Retorno400()
        {
            var lines = new List<string>
            {
                _spec.GetRecord("cnab400/341/retorno/header_arquivo").ToLine(Map()),
            };
            for (var i = 0; i < 3; i++)
            {
                lines.Add(_det400.ToLine(Map(
                    "nosso_numero", $"1234{i}",
                    "nome_sacado", $"CLIENTE {i}")));
            }
            lines.Add(_spec.GetRecord("cnab400/341/retorno/trailer_arquivo").ToLine(Map()));
            return string.Join("\n", lines) + "\n";
        }

        [Fact]
        public void ParseToJsonReturnsAnUndecodedString()
        {
            var payload = CnabFile.ForBankBundled("cnab400", "341", "", "retorno")
                .ParseToJson(Retorno400());
            Assert.StartsWith("[{", payload);
            Assert.EndsWith("}]", payload);
            using var doc = JsonDocument.Parse(payload);
            Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);
        }

        [Fact]
        public void ParseToJsonIsExactlyParseSerialized()
        {
            var file = CnabFile.ForBankBundled("cnab400", "341", "", "retorno");
            var content = Retorno400();

            using var doc = JsonDocument.Parse(file.ParseToJson(content));
            var rows = doc.RootElement;
            var objects = file.Parse(content);
            Assert.Equal(5, rows.GetArrayLength());
            Assert.Equal(objects.Length, rows.GetArrayLength());

            for (var i = 0; i < objects.Length; i++)
            {
                var row = rows[i];
                var obj = objects[i];
                // camelCase keys: this is a data format, not a projected type,
                // so it does NOT use the language's PascalCase convention.
                Assert.Equal(obj.RecordKey, row.GetProperty("recordKey").GetString());
                Assert.Equal(obj.Tipo, row.GetProperty("tipo").GetString());
                Assert.Equal(obj.Segment, row.GetProperty("segment").GetString());

                var fields = row.GetProperty("fields");
                Assert.Equal(obj.Fields.Count, fields.EnumerateObject().Count());
                foreach (var kv in obj.Fields)
                {
                    Assert.Equal(kv.Value, fields.GetProperty(kv.Key).GetString());
                }
            }

            Assert.Equal(Det400Key, rows[1].GetProperty("recordKey").GetString());
            Assert.Equal("12340", rows[1].GetProperty("fields").GetProperty("nosso_numero").GetString());
            Assert.Equal("CLIENTE 0", rows[1].GetProperty("fields").GetProperty("nome_sacado").GetString());
        }

        [Fact]
        public void ParseToJsonEscapesValuesSoThePayloadStaysDecodable()
        {
            var line = _det400.ToLine(Map("nome_sacado", "JOSE \"ZE\" \\ SILVA"));
            using var doc = JsonDocument.Parse(
                CnabFile.ForBankBundled("cnab400", "341", "", "retorno").ParseToJson(line));
            Assert.Equal(
                "JOSE \"ZE\" \\ SILVA",
                doc.RootElement[0].GetProperty("fields").GetProperty("nome_sacado").GetString());
        }

        [Fact]
        public void ParseToJsonOfChunksEqualsTheWholeFile()
        {
            // The recipe for large files is to feed ParseToJson a few thousand
            // lines at a time; correct only because classification is per-line.
            var file = CnabFile.ForBankBundled("cnab400", "341", "", "retorno");
            var content = Retorno400();
            using var wholeDoc = JsonDocument.Parse(file.ParseToJson(content));
            var whole = wholeDoc.RootElement;

            var lines = content.Split('\n').Where(l => l.Length > 0).ToArray();
            var chunked = new List<string>();
            for (var i = 0; i < lines.Length; i += 2)
            {
                var part = string.Join("\n", lines.Skip(i).Take(2));
                using var pageDoc = JsonDocument.Parse(file.ParseToJson(part));
                foreach (var row in pageDoc.RootElement.EnumerateArray())
                {
                    chunked.Add(row.GetRawText());
                }
            }

            Assert.Equal(whole.GetArrayLength(), chunked.Count);
            for (var i = 0; i < chunked.Count; i++)
            {
                Assert.Equal(whole[i].GetRawText(), chunked[i]);
            }
        }

        [Fact]
        public void ParseToJsonReturnsAnEmptyArrayForEmptyContent()
        {
            Assert.Equal("[]",
                CnabFile.ForBankBundled("cnab400", "341", "", "retorno").ParseToJson(""));
        }

        // --- BR Code (PIX copia e cola) ---------------------------------------

        [Fact]
        public void Crc16ReproducesTheCanonicalCheckValue()
        {
            Assert.Equal("29B1", BrCode.Crc16("123456789"));
        }

        private static string SamplePayload()
        {
            return BrCode.Encode(new BrCodeParams
            {
                PixKey = "fulano@example.com",
                MerchantName = "FULANO DE TAL",
                MerchantCity = "BRASILIA",
                Amount = "10.00",
            });
        }

        [Fact]
        public void BrCodeEncodeProducesAValidPayload()
        {
            var p = SamplePayload();
            Assert.StartsWith("000201", p);
            Assert.Contains("BR.GOV.BCB.PIX", p);
            Assert.True(BrCode.IsValid(p));
        }

        [Fact]
        public void BrCodeOptionalStructFieldsMayBeOmitted()
        {
            var p = BrCode.Encode(new BrCodeParams
            {
                PixKey = "fulano@example.com",
                MerchantName = "FULANO DE TAL",
                MerchantCity = "BRASILIA",
            });
            Assert.Equal("", BrCode.Decode(p).Amount);
        }

        [Fact]
        public void BrCodeRoundTripsThroughTheBinding()
        {
            var p = BrCode.Encode(new BrCodeParams
            {
                PixKey = "123e4567-e12b-12d1-a456-426655440000",
                MerchantName = "LOJA EXEMPLO",
                MerchantCity = "RIO DE JANEIRO",
                Amount = "1500.00",
                Txid = "INV0001",
            });
            var f = BrCode.Decode(p);
            Assert.Equal("123e4567-e12b-12d1-a456-426655440000", f.PixKey);
            Assert.Equal("1500.00", f.Amount);
            Assert.Equal("INV0001", f.Txid);
            Assert.True(f.CrcValid);
        }

        [Fact]
        public void BrCodeRejectsANonDecimalAmount()
        {
            Assert.ThrowsAny<Exception>(() => BrCode.Encode(new BrCodeParams
            {
                PixKey = "fulano@example.com",
                MerchantName = "FULANO",
                MerchantCity = "BRASILIA",
                Amount = "10,00",
            }));
        }

        [Fact]
        public void BrCodeDetectsTampering()
        {
            var p = SamplePayload();
            var tampered = p.Replace("540510.00", "540590.00");
            Assert.NotEqual(p, tampered);
            Assert.False(BrCode.IsValid(tampered));
        }
    }
}
