# @cnab/core

The CNAB 240/400 engine for parsing, building and validating Brazilian bank
files. Authored once in jsii-compatible TypeScript and published to
Node/.NET/Python/Java via [jsii](https://github.com/aws/jsii) (see
[ADR 0002](../../docs/adrs/0002-jsii-single-engine.md)).

## API

- `CnabSpec.fromJson(json)` — load the compiled `spec.json`.
  - `recordKeys()`, `hasRecord(key)`, `getRecord(key)`.
  - `codeTableKeys()`, `hasCodeTable(key)`, `getCodeTable(key)` →
    `{ [code]: description }` (throws when the key is missing).
  - `lookupCode(key, code)` → description or `''` when unknown. The code is
    normalized during lookup (as-is, then leading zeros stripped, then
    zero-padded to 2), since legacy tables use unpadded keys like `"2"` while
    CNAB fields carry `"02"`.
- `CnabRecord.fromJson(json)` — load a single record spec.
  - `parse(line)` → `{ [name]: value }`
  - `toLine(values)` → fixed-width line (named `toLine`, not `build`, because
    `build` is a reserved member name in jsii)
  - `validate(line)` → `{ valid, errors }`
  - `spec` — the underlying `RecordSpec`
  - Typed value helpers (see [ADR 0006](../../docs/adrs/0006-typed-value-representation.md):
    numeric values cross the API boundary as **decimal strings**, never floats;
    dates as **ISO** strings). They read/write the same `{ [name]: value }` map
    that `parse` returns and `toLine` consumes:
    - `getDecimal(values, name)` → decimal string with the field's implied
      decimals inserted (raw `"150000"` with 2 decimals → `"1500.00"`,
      `"0"` → `"0.00"`; decimals-0 fields pass through unchanged).
    - `setDecimal(values, name, decimalValue)` — inverse (`"1500.00"` →
      `"150000"`); accepts a missing/short fractional part (`"1500"`,
      `"1500.5"`), throws on malformed input or too many fraction digits.
    - `getDateIso(values, name)` → `YYYY-MM-DD` for `ddMMyyyy`/`ddMMyy` fields
      (`ddMMyy` century pivot: `yy >= 70` → `19yy`, else `20yy`), `HH:mm:ss`
      for `HHmmss`; `''` when the raw value is all zeros (unset). Throws for
      fields with no `dateFormat`.
    - `setDateIso(values, name, iso)` — inverse (`"2026-07-15"` → `"15072026"`
      / `"150726"`; `"10:30:00"` → `"103000"`); `''` stores the all-zeros
      unset value; throws on malformed input.
- `CnabFile.forBank(json, layout, bank, variant, direction)` — a whole-file
  parser scoped to one bank.
  - `parse(content)` → `ParsedLine[]` (auto-detects each line's record type from
    its discriminator positions: CNAB240 pos 8 + segment pos 14, CNAB400 pos 1).
- `CnabFile.detectScope(json, content)` → `DetectedScope`
  (`{ layout, bank, variant, direction }`) inferred from the first line;
  `CnabFile.detect(json, content)` → a `CnabFile` already scoped to it.

`parse` normalizes values (alpha right-trimmed, numerics left-stripped) so that
`toLine(parse(line))` reproduces a well-formed line.

## Encoding & line endings — the contract for callers

The engine works on **strings**, never on bytes. It has no opinion about how
those strings were produced, which makes the encoding boundary the **caller's**
responsibility in every language:

> **Decode bytes → string before calling the engine, and encode string → bytes
> after.**

What you need to know:

- Real CNAB files are **Latin-1 (ISO-8859-1) / Windows-1252**, not UTF-8.
  Accented names (`JOSÉ`, `SÃO PAULO`, `CAIXA ECONÔMICA`) are one byte per
  character there, which is exactly what keeps the fixed-width positions valid:
  **in latin1 one char == one byte**, so a 240-byte line decodes to a 240-char
  string and `start`/`end` positions line up. Decode the same bytes as UTF-8
  and every accented character either becomes a replacement char or shifts the
  rest of the line — parsing silently produces garbage.
- Encode the output with the **same** charset you decoded with, so the file you
  write back is byte-compatible with what the bank expects.
- Per language: Node `buf.toString('latin1')` / `Buffer.from(s, 'latin1')`;
  .NET `Encoding.Latin1`; Java `new String(bytes, StandardCharsets.ISO_8859_1)`
  / `s.getBytes(ISO_8859_1)`; Python `bytes.decode('latin-1')` /
  `str.encode('latin-1')`.
- Characters that do not exist in Latin-1 cannot be written to a CNAB file at
  all; strip or transliterate them before building a line.

The engine is tolerant about the two remaining file-shape quirks:

- **Line endings** — `CnabFile.parse`, `CnabFile.detectScope`/`detect` accept
  both `LF` and `CRLF`, and ignore a trailing newline. `CnabFileBuilder`
  *emits* `LF`-joined lines with no trailing newline; convert if the bank wants
  `CRLF` (`content.split('\n').join('\r\n')`).
- **BOM** — a leading UTF-8 byte-order mark (`U+FEFF`) is stripped by
  `CnabFile.parse` and `CnabFile.detectScope`/`detect`; without that it would
  shift every position of the first line by one and break detection. Note that
  the *byte* sequence `EF BB BF` only decodes to `U+FEFF` when you decode as
  UTF-8 — when reading a latin1 file, drop those three bytes before decoding
  (the CLI does both).

The `@cnab/cli` tool implements this contract: `--encoding latin1|utf8`
(default `latin1`) applies to reading and writing, plus `--crlf` and
`--trailing-newline` for the output shape.

## CnabFileBuilder — whole-file generation

`CnabFileBuilder.forBank(json, layout, bank, variant, direction)` builds a
complete file (header + lotes/details + trailer) and owns the layout's control
fields — CNAB240 `lote_servico` sequencing (`0000` / per-lote `0001`… / `9999`),
`numero_sequencial_lote` within each lote, `qtde_registro_lote` /
`qtde_lotes` / `qtde_registros`, and the CNAB400 `numero_sequencial` line
counter. Counters/totals you pass explicitly win over auto-computation; pure
sequence counters are always builder-owned. Monetary totals (e.g.
`valor_total_titulo_simples`) are not auto-summed — pass them in the trailer
values. See [ADR 0007](../../docs/adrs/0007-file-builder-control-fields.md).

```ts
const b = CnabFileBuilder.forBank(specJson, 'cnab240', '104', 'sigcb', 'remessa');
b.withHeader({ codigo_banco: '104', nome_empresa: 'ACME LTDA', /* ... */ });
b.startLote({ codigo_banco: '104', tipo_operacao: 'R', /* ... */ });
b.addDetail('detalhe_segmento_p', { numero_documento: 'DOC1', valor_titulo: '150000', /* ... */ });
b.addDetail('detalhe_segmento_r', { codigo_ocorrencia: '01' });
b.endLote({ codigo_banco: '104', valor_total_titulo_simples: '150000' });
const content = b.toFileContent({ codigo_banco: '104' }); // '\n'-joined lines

// CNAB400: no lotes — withHeader / addDetail('detalhe', ...) / toFileContent.
```

(Terminal method is `toFileContent`, not `build`, and the header setter is
`withHeader`, not `setHeader` — both names are prohibited by jsii.)

## Boleto helpers

Pure, stateless check-digit and boleto helpers (FEBRABAN cobrança layout):

- `Modulo.mod10(digits)` — boleto módulo 10 (weights 2,1 right-to-left,
  products > 9 sum their digits; DV = `(10 - sum % 10) % 10`).
- `Modulo.mod11(digits)` — generic CNAB módulo 11 (weights 2..9 cycling;
  DV = `11 - sum % 11`, with 0/10/11 → 0).
- `Modulo.mod11Boleto(digits)` — FEBRABAN barcode DAC variant (0/1/10/11 → 1).
- `Boleto.fatorVencimento(dateIso)` — 4-digit due-date factor (base
  1997-10-07; rolls over to 1000 after 9999 / 2025-02-21).
- `Boleto.barcode({ bankCode, currencyCode, dueDateIso, amountCents, freeField })`
  — compose the 44-digit barcode (DV at position 5).
- `Boleto.barcodeCheckDigit(barcode)` / `Boleto.isValidBarcode(barcode)`.
- `Boleto.linhaDigitavel(barcode)` — the 47-digit linha digitável;
  `linhaDigitavelFormatted` applies the standard
  `#####.##### #####.###### #####.###### # ##############` mask.
- `Boleto.parseLinhaDigitavel(linha)` — validate all check digits and
  reconstruct the 44-digit barcode (accepts plain or formatted input).

Per-bank *nosso número* DV rules are intentionally not implemented (they vary
per bank manual); compose them from `Modulo.mod10`/`Modulo.mod11`.

## Example

```ts
import { CnabSpec } from '@cnab/core';
import { readFileSync } from 'node:fs';

const spec = CnabSpec.fromJson(readFileSync('spec.json', 'utf8'));
const rec = spec.getRecord('cnab240/104/sigcb/header_arquivo');
const fields = rec.parse(line);
const rebuilt = rec.toLine(fields);
```

## Build

```
npm run build        # tsc -> lib/ (used by tests)
npm run build:jsii   # jsii  -> dist/ + .jsii assembly (multi-language proof)
npm test
```
