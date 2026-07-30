"""Unit tests for the generated Python binding of @cnab/core.

These run against the INSTALLED wheel (`pip install packages/core/dist/python/*.whl`),
not the TypeScript source, so they test what a PyPI consumer would actually get:
the jsii projection, its snake_case naming, and the marshalling of maps, structs,
enums and exceptions across the runtime boundary.

Why this exists as a real suite and not a smoke test: the Node suite cannot see
projection bugs. `set_decimal` was `void` + mutate, which works in Node (objects
by reference) and silently did nothing here (jsii marshals maps BY VALUE). Two
documented helpers were inert in Python, Java and .NET and every Node test passed.

Keep the assertions aligned with `packages/core/test/values.test.js` and friends,
so a divergence between languages shows up as a failure rather than as a gap.
"""

import json

import pytest

import cnab_core as c

SEG_P = "cnab240/104/sigcb/remessa/detalhe_segmento_p"
DET_400 = "cnab400/341/retorno/detalhe"
HEADER = "cnab240/104/sigcb/header_arquivo"


@pytest.fixture(scope="module")
def spec():
    return c.CnabSpec.bundled()


@pytest.fixture(scope="module")
def seg_p(spec):
    return spec.get_record(SEG_P)


@pytest.fixture(scope="module")
def det400(spec):
    return spec.get_record(DET_400)


@pytest.fixture(scope="module")
def header(spec):
    return spec.get_record(HEADER)


# --- spec registry ---------------------------------------------------------


def test_bundled_spec_loads_every_record(spec):
    keys = spec.record_keys()
    assert len(keys) == 55
    assert SEG_P in keys


def test_has_record_and_get_record(spec):
    assert spec.has_record(SEG_P) is True
    assert spec.has_record("cnab240/999/nope") is False


def test_get_record_raises_for_unknown_key(spec):
    with pytest.raises(Exception):
        spec.get_record("cnab240/999/nope")


def test_record_spec_struct_is_projected(seg_p):
    s = seg_p.spec
    assert s.layout == "cnab240"
    assert s.bank == "104"
    assert s.line_length == 240
    assert len(s.fields) > 0
    f = s.fields[0]
    # `fieldType` is named that because `type` is reserved in Go; in Python the
    # projection is snake_case.
    assert f.name == "codigo_banco"
    assert f.start == 1
    assert f.end == 3
    assert f.field_type == c.FieldType.NUM


def test_field_type_enum_projects(seg_p):
    types = {f.field_type for f in seg_p.spec.fields}
    assert c.FieldType.NUM in types
    assert all(isinstance(t, c.FieldType) for t in types)


# --- parse / to_line -------------------------------------------------------


def test_to_line_produces_the_declared_width(seg_p):
    line = seg_p.to_line({"codigo_banco": "104"})
    assert len(line) == 240
    assert line[:3] == "104"


def test_parse_round_trips(seg_p):
    line = seg_p.to_line({"codigo_banco": "104", "valor_titulo": "150000"})
    assert seg_p.to_line(seg_p.parse(line)) == line


def test_parse_returns_a_mapping_of_field_names(seg_p):
    parsed = seg_p.parse(seg_p.to_line({"codigo_banco": "104"}))
    assert parsed["codigo_banco"] == "104"
    assert "valor_titulo" in parsed


def test_validate_accepts_a_generated_line(seg_p):
    result = seg_p.validate(seg_p.to_line({"codigo_banco": "104"}))
    assert result.valid is True
    assert result.errors == []


def test_validate_rejects_a_short_line(seg_p):
    result = seg_p.validate("104")
    assert result.valid is False
    assert len(result.errors) > 0


# --- strict to_line (the #28 corruption fix must hold in Python too) -------


def test_to_line_rejects_an_oversized_value(seg_p):
    # valor_titulo is 15 wide; 17 digits must raise, not silently truncate.
    with pytest.raises(Exception) as e:
        seg_p.to_line({"valor_titulo": "1" * 17})
    assert "valor_titulo" in str(e.value)


def test_to_line_rejects_a_decimal_string_in_a_numeric_field(seg_p):
    with pytest.raises(Exception) as e:
        seg_p.to_line({"valor_titulo": "1500.00"})
    # the error is expected to point the caller at the right helper
    assert "setDecimal" in str(e.value) or "set_decimal" in str(e.value)


def test_to_line_with_options_restores_lenient_truncation(seg_p):
    # jsii has no overloads, so the lenient path is a separate method taking a
    # LineOptions struct -- flattened into keyword arguments in Python.
    line = seg_p.to_line_with_options(
        {"valor_titulo": "1" * 17}, truncate_oversized=True, strip_non_digits=True
    )
    assert len(line) == 240


def test_line_options_struct_is_constructible():
    opts = c.LineOptions(truncate_oversized=True, strip_non_digits=False)
    assert opts.truncate_oversized is True
    assert opts.strip_non_digits is False


# --- typed values: decimals (ADR 0006) -------------------------------------


def test_get_decimal_inserts_the_implied_separator(seg_p):
    assert seg_p.get_decimal({"valor_titulo": "150000"}, "valor_titulo") == "1500.00"
    assert seg_p.get_decimal({"valor_titulo": "1"}, "valor_titulo") == "0.01"
    assert seg_p.get_decimal({"valor_titulo": "0"}, "valor_titulo") == "0.00"


def test_get_decimal_returns_decimals_zero_fields_unchanged(seg_p):
    assert seg_p.get_decimal({"codigo_banco": "104"}, "codigo_banco") == "104"


def test_get_decimal_raises_for_unknown_field(seg_p):
    with pytest.raises(Exception):
        seg_p.get_decimal({}, "nope")


def test_set_decimal_returns_a_new_map(seg_p):
    """The regression this whole suite was written to catch.

    `set_decimal` must RETURN the updated map. jsii marshals maps by value, so
    a void+mutate signature cannot work here -- it silently did nothing.
    """
    out = seg_p.set_decimal({}, "valor_titulo", "1500.00")
    assert out["valor_titulo"] == "150000"


def test_set_decimal_does_not_mutate_its_input(seg_p):
    original = {"codigo_banco": "104"}
    out = seg_p.set_decimal(original, "valor_titulo", "1500.00")
    assert "valor_titulo" not in original, "input must be left untouched"
    assert out["codigo_banco"] == "104", "other keys must be carried over"


def test_set_decimal_pads_a_short_fraction(seg_p):
    assert seg_p.set_decimal({}, "valor_titulo", "1500.5")["valor_titulo"] == "150050"


def test_set_decimal_accepts_a_missing_fraction(seg_p):
    assert seg_p.set_decimal({}, "valor_titulo", "1500")["valor_titulo"] == "150000"


def test_set_decimal_raises_on_malformed_input(seg_p):
    for bad in ["abc", "1.2.3", "1500.", "-1.00", "1,00"]:
        with pytest.raises(Exception):
            seg_p.set_decimal({}, "valor_titulo", bad)


def test_set_decimal_raises_when_fraction_exceeds_field_decimals(seg_p):
    with pytest.raises(Exception):
        seg_p.set_decimal({}, "valor_titulo", "1500.123")


def test_decimal_round_trips_through_to_line_and_parse(seg_p):
    values = seg_p.set_decimal({}, "valor_titulo", "1234.56")
    line = seg_p.to_line(values)
    assert line[85:100] == "000000000123456"
    assert seg_p.get_decimal(seg_p.parse(line), "valor_titulo") == "1234.56"


# --- typed values: dates (ADR 0006) ----------------------------------------


def test_get_date_iso_converts_ddmmyyyy(seg_p):
    assert seg_p.get_date_iso({"vencimento": "15072026"}, "vencimento") == "2026-07-15"


def test_get_date_iso_applies_the_century_pivot(det400):
    assert det400.get_date_iso({"data_vencimento": "150770"}, "data_vencimento") == "1970-07-15"
    assert det400.get_date_iso({"data_vencimento": "150769"}, "data_vencimento") == "2069-07-15"


def test_get_date_iso_converts_hhmmss(header):
    assert header.get_date_iso({"hora_geracao": "103000"}, "hora_geracao") == "10:30:00"


def test_get_date_iso_returns_empty_for_unset(seg_p):
    assert seg_p.get_date_iso({"vencimento": "0"}, "vencimento") == ""


def test_set_date_iso_returns_a_new_map(seg_p):
    out = seg_p.set_date_iso({}, "vencimento", "2026-07-15")
    assert out["vencimento"] == "15072026"


def test_set_date_iso_does_not_mutate_its_input(seg_p):
    original = {"codigo_banco": "104"}
    out = seg_p.set_date_iso(original, "vencimento", "2026-07-15")
    assert "vencimento" not in original
    assert out["codigo_banco"] == "104"


def test_set_date_iso_raises_on_malformed_input(seg_p):
    with pytest.raises(Exception):
        seg_p.set_date_iso({}, "vencimento", "15/07/2026")


def test_set_date_iso_raises_outside_the_ddmmyy_window(det400):
    with pytest.raises(Exception):
        det400.set_date_iso({}, "data_vencimento", "2070-01-01")


def test_setters_compose_without_mutation(seg_p):
    v = {}
    v = seg_p.set_decimal(v, "valor_titulo", "1234.56")
    v = seg_p.set_date_iso(v, "vencimento", "2026-07-15")
    assert v["valor_titulo"] == "123456"
    assert v["vencimento"] == "15072026"


def test_date_round_trips_through_to_line_and_parse(seg_p):
    values = seg_p.set_date_iso({}, "vencimento", "2026-07-05")
    parsed = seg_p.parse(seg_p.to_line(values))
    assert seg_p.get_date_iso(parsed, "vencimento") == "2026-07-05"


# --- code tables -----------------------------------------------------------


def test_code_tables_are_available(spec):
    keys = spec.code_table_keys()
    assert len(keys) == 6
    assert spec.has_code_table(keys[0]) is True


def test_lookup_code_returns_a_description(spec):
    key = spec.code_table_keys()[0]
    table = spec.get_code_table(key)
    assert len(table) > 0
    code = next(iter(table))
    assert spec.lookup_code(key, code) == table[code]


# --- check digits and boleto ----------------------------------------------


def test_modulo_10():
    assert c.Modulo.mod10("123456789") == 7


def test_modulo_11_and_boleto_variant():
    assert isinstance(c.Modulo.mod11("123456789"), (int, float))
    dv = c.Modulo.mod11_boleto("1234567890")
    assert 1 <= dv <= 9


def test_fator_vencimento_uses_the_2025_rollover():
    # The FEBRABAN base date rolled over on 2025-02-22 back to 1000.
    assert c.Boleto.fator_vencimento("2025-02-22") == "1000"


def test_barcode_is_44_digits_and_self_consistent():
    barcode = c.Boleto.barcode(
        bank_code="104",
        currency_code="9",
        due_date_iso="2026-07-15",
        amount_cents="150000",
        free_field="0" * 25,
    )
    assert len(barcode) == 44
    assert barcode.isdigit()
    assert c.Boleto.is_valid_barcode(barcode) is True


def test_barcode_params_struct_is_constructible():
    params = c.BarcodeParams(
        bank_code="104",
        currency_code="9",
        due_date_iso="2026-07-15",
        amount_cents="150000",
        free_field="0" * 25,
    )
    assert params.bank_code == "104"


def test_linha_digitavel_is_47_digits_and_reversible():
    barcode = c.Boleto.barcode(
        bank_code="104",
        currency_code="9",
        due_date_iso="2026-07-15",
        amount_cents="150000",
        free_field="0" * 25,
    )
    linha = c.Boleto.linha_digitavel(barcode)
    assert len(linha) == 47
    assert linha.isdigit()
    assert c.Boleto.parse_linha_digitavel(linha) == barcode


def test_linha_digitavel_formatted_has_separators():
    barcode = c.Boleto.barcode(
        bank_code="104",
        currency_code="9",
        due_date_iso="2026-07-15",
        amount_cents="150000",
        free_field="0" * 25,
    )
    formatted = c.Boleto.linha_digitavel_formatted(barcode)
    assert " " in formatted or "." in formatted


# --- whole-file parse and build -------------------------------------------


def test_file_builder_produces_a_parseable_file():
    builder = c.CnabFileBuilder.for_bank_bundled("cnab240", "104", "sigcb", "remessa")
    builder.with_header({"codigo_banco": "104"})
    builder.start_lote({"codigo_banco": "104"})
    builder.add_detail("detalhe_segmento_p", {"codigo_banco": "104"})
    builder.end_lote({"codigo_banco": "104"})
    content = builder.to_file_content({"codigo_banco": "104"})

    lines = [l for l in content.split("\n") if l]
    assert len(lines) >= 5
    assert all(len(l) == 240 for l in lines)

    parsed = c.CnabFile.for_bank_bundled("cnab240", "104", "sigcb", "remessa").parse(content)
    assert len(parsed) == len(lines)
    assert parsed[0].record_key.endswith("header_arquivo")


def test_parsed_line_struct_is_projected():
    builder = c.CnabFileBuilder.for_bank_bundled("cnab240", "104", "sigcb", "remessa")
    builder.with_header({"codigo_banco": "104"})
    builder.start_lote({"codigo_banco": "104"})
    builder.add_detail("detalhe_segmento_p", {"codigo_banco": "104"})
    builder.end_lote({"codigo_banco": "104"})
    parsed = c.CnabFile.for_bank_bundled("cnab240", "104", "sigcb", "remessa").parse(
        builder.to_file_content({"codigo_banco": "104"})
    )
    line = parsed[0]
    assert isinstance(line.record_key, str)
    assert isinstance(line.fields, dict)
    assert line.fields["codigo_banco"] == "104"


def test_detect_scope_identifies_the_file():
    builder = c.CnabFileBuilder.for_bank_bundled("cnab240", "104", "sigcb", "remessa")
    # `codigo_remessa_retorno` at position 143 is what direction detection reads;
    # without it detect_scope correctly refuses to guess.
    builder.with_header({"codigo_banco": "104", "codigo_remessa_retorno": "1"})
    builder.start_lote({"codigo_banco": "104"})
    builder.add_detail("detalhe_segmento_p", {"codigo_banco": "104"})
    builder.end_lote({"codigo_banco": "104"})
    content = builder.to_file_content({"codigo_banco": "104"})

    scope = c.CnabFile.detect_scope(c.CnabSpec.bundled_json(), content)
    assert scope.layout == "cnab240"
    assert scope.bank == "104"
    assert scope.variant == "sigcb"
    assert scope.direction == "remessa"


def test_detect_scope_refuses_to_guess_an_ambiguous_direction():
    builder = c.CnabFileBuilder.for_bank_bundled("cnab240", "104", "sigcb", "remessa")
    builder.with_header({"codigo_banco": "104"})  # no direction marker
    builder.start_lote({"codigo_banco": "104"})
    builder.add_detail("detalhe_segmento_p", {"codigo_banco": "104"})
    builder.end_lote({"codigo_banco": "104"})
    content = builder.to_file_content({"codigo_banco": "104"})

    with pytest.raises(Exception) as e:
        c.CnabFile.detect_scope(c.CnabSpec.bundled_json(), content)
    assert "direction" in str(e.value)


# --- parse_to_json (the large-file path) -----------------------------------
#
# `parse` returns one ParsedLine per line and jsii marshals each one, with its
# ~40-key field map, individually: ~1.5 ms per line here versus ~0.014 ms in
# Node. `parse_to_json` is the whole reason a non-Node caller can process a real
# retorno at all (ADR 0009), so its projection is worth pinning explicitly —
# especially that it comes back as a plain `str` and NOT as something the jsii
# runtime has already tried to decode.


@pytest.fixture(scope="module")
def retorno_400(spec):
    """A small cnab400/341 retorno file: header + three detalhe + trailer."""
    header = spec.get_record("cnab400/341/retorno/header_arquivo").to_line({})
    trailer = spec.get_record("cnab400/341/retorno/trailer_arquivo").to_line({})
    detalhe = spec.get_record(DET_400)
    lines = [header]
    for i in range(3):
        lines.append(
            detalhe.to_line({"nosso_numero": f"1234{i}", "nome_sacado": f"CLIENTE {i}"})
        )
    lines.append(trailer)
    return "\n".join(lines) + "\n"


def test_parse_to_json_returns_a_plain_string(retorno_400):
    payload = c.CnabFile.for_bank_bundled("cnab400", "341", "", "retorno").parse_to_json(
        retorno_400
    )
    # A `str`, not a list and not a dict: the point is that the jsii runtime
    # treats it as one opaque scalar and does no per-line marshalling at all.
    assert isinstance(payload, str)
    assert payload.startswith("[{") and payload.endswith("}]")


def test_parse_to_json_matches_parse_exactly(retorno_400):
    cnab_file = c.CnabFile.for_bank_bundled("cnab400", "341", "", "retorno")
    rows = json.loads(cnab_file.parse_to_json(retorno_400))
    objects = cnab_file.parse(retorno_400)

    assert len(rows) == len(objects) == 5
    for row, obj in zip(rows, objects):
        # The JSON keys are the TypeScript/camelCase spellings, NOT the
        # snake_case the struct projection uses. That is deliberate and
        # documented — it is a data format, not a projected type — so assert it
        # rather than let a future "helpful" rename go unnoticed.
        assert set(row) == {"recordKey", "tipo", "segment", "fields"}
        assert row["recordKey"] == obj.record_key
        assert row["tipo"] == obj.tipo
        assert row["segment"] == obj.segment
        assert row["fields"] == dict(obj.fields)

    assert rows[1]["recordKey"] == DET_400
    assert rows[1]["fields"]["nosso_numero"] == "12340"
    assert rows[1]["fields"]["nome_sacado"] == "CLIENTE 0"


def test_parse_to_json_handles_empty_and_unclassifiable_content():
    cnab_file = c.CnabFile.for_bank_bundled("cnab400", "341", "", "retorno")
    assert json.loads(cnab_file.parse_to_json("")) == []

    rows = json.loads(cnab_file.parse_to_json("Z" * 400))
    assert len(rows) == 1
    assert rows[0]["recordKey"] == ""
    assert rows[0]["fields"] == {}


def test_parse_to_json_escapes_values_so_the_payload_stays_decodable(spec):
    # Alpha fields carry arbitrary text. If the engine's hand-rolled JSON missed
    # an escape the payload would fail to decode here and nowhere else — Node
    # never sees the string form.
    line = spec.get_record(DET_400).to_line({"nome_sacado": 'JOSE "ZE" \\ SILVA'})
    rows = json.loads(
        c.CnabFile.for_bank_bundled("cnab400", "341", "", "retorno").parse_to_json(line)
    )
    assert rows[0]["fields"]["nome_sacado"] == 'JOSE "ZE" \\ SILVA'


def test_parse_to_json_of_chunks_equals_the_whole_file(retorno_400):
    # The documented recipe for large files is to feed parse_to_json a few
    # thousand lines at a time; it is only correct because classification is
    # per-line and stateless. Pin that here too, in the language it matters for.
    cnab_file = c.CnabFile.for_bank_bundled("cnab400", "341", "", "retorno")
    whole = json.loads(cnab_file.parse_to_json(retorno_400))

    lines = [l for l in retorno_400.split("\n") if l]
    chunked = []
    for i in range(0, len(lines), 2):
        chunked.extend(json.loads(cnab_file.parse_to_json("\n".join(lines[i : i + 2]))))

    assert chunked == whole


# --- BR Code (PIX copia e cola) --------------------------------------------


def test_crc16_canonical_check_value():
    # CRC-16/CCITT-FALSE's published check value. Pins the algorithm across the
    # jsii boundary, where a string→bytes marshalling slip would change it.
    assert c.BrCode.crc16("123456789") == "29B1"


def test_brcode_encode_and_validate():
    payload = c.BrCode.encode(
        pix_key="fulano@example.com",
        merchant_name="FULANO DE TAL",
        merchant_city="BRASILIA",
        amount="10.00",
    )
    assert payload.startswith("000201")
    assert "BR.GOV.BCB.PIX" in payload
    assert c.BrCode.is_valid(payload) is True


def test_brcode_round_trips_through_the_binding():
    payload = c.BrCode.encode(
        pix_key="123e4567-e12b-12d1-a456-426655440000",
        merchant_name="LOJA EXEMPLO",
        merchant_city="RIO DE JANEIRO",
        amount="1500.00",
        txid="INV0001",
    )
    f = c.BrCode.decode(payload)
    assert f.pix_key == "123e4567-e12b-12d1-a456-426655440000"
    assert f.amount == "1500.00"
    assert f.txid == "INV0001"
    assert f.crc_valid is True


def test_brcode_optional_struct_fields_may_be_omitted():
    # amount/txid/description are optional in the struct; Python projects them
    # as keyword args defaulting to None.
    payload = c.BrCode.encode(
        pix_key="fulano@example.com",
        merchant_name="FULANO DE TAL",
        merchant_city="BRASILIA",
    )
    assert c.BrCode.decode(payload).amount == ""


def test_brcode_rejects_a_non_decimal_amount():
    with pytest.raises(Exception):
        c.BrCode.encode(
            pix_key="fulano@example.com",
            merchant_name="FULANO",
            merchant_city="BRASILIA",
            amount="10,00",
        )


def test_brcode_detects_tampering():
    payload = c.BrCode.encode(
        pix_key="fulano@example.com",
        merchant_name="FULANO DE TAL",
        merchant_city="BRASILIA",
        amount="10.00",
    )
    tampered = payload.replace("540510.00", "540590.00")
    assert tampered != payload
    assert c.BrCode.is_valid(tampered) is False
