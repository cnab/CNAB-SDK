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
    **Node only for files of any size** — see "Large files" below.
  - `parseToJson(content)` → the same result as **one JSON string**. The path
    for Python/Java/.NET, and the one that keeps Node's heap flat.
- `CnabFile.detectScope(json, content)` → `DetectedScope`
  (`{ layout, bank, variant, direction }`) inferred from the first line;
  `CnabFile.detect(json, content)` → a `CnabFile` already scoped to it.

`parse` normalizes values (alpha right-trimmed, numerics left-stripped) so that
`toLine(parse(line))` reproduces a well-formed line.

## Large files — what this engine can and cannot do

Real retorno files get big: a mid-size issuer's daily retorno is routinely six
figures of lines. `parse` does not scale to that, and the reason is structural
rather than a bug to be fixed later. Read this before you point the SDK at a
production file. The numbers below are from `tools/bench-parse.mjs` and
`tools/bench_parse.py` (committed, run by hand — they are slow); full analysis
in [ADR 0010](../../docs/adrs/0010-large-file-parsing-across-the-jsii-boundary.md).

**`parse` returns one object per line, and outside Node every one of those
objects is marshalled across the jsii kernel individually.** That costs roughly
1.4 ms *per line* in Python, Java and .NET — about 100x what Node pays — so a
200,000-line file takes minutes. In Node the cost is memory instead: the parsed
result retains ~6x the input size.

| 200,000-line CNAB400 retorno (76 MB) | wall | memory |
| --- | --- | --- |
| Node, `parse` | 2.8 s | 615 MB retained |
| Python, `parse` | **353 s** | — |
| Python, `parseToJson` in one call | 37 s | 184 MB payload |
| Python, `parseToJson` fed 2,000 lines at a time | **7.5 s** | bounded by the chunk |
| Node, `parseToJson` fed 2,000 lines at a time | 4.5 s | **4 MB peak** |

Those lines are built with default values, which understates the payload. On a
file carrying real values (`--filled`) the same 200,000 lines take **9.1 s** in
Python. Budget for that, not for 7.5 s.

### The rule

- **Small files (up to a few thousand lines):** use whatever is comfortable.
  `parse` in Node; `parseToJson` outside it.
- **Anything larger:** use `parseToJson`, and **feed it a few thousand lines at
  a time**. Two thousand is a good default; throughput is flat between 2,000 and
  10,000 and degrades above that.
- **Do not** hand a whole large file to a single call in any language. The jsii
  boundary degrades sharply on large strings *in both directions* — passing 76 MB
  in costs ~18 s by itself, before any parsing.

Chunking is exactly equivalent to one call: record classification is per line
and carries no state, so the concatenation of the chunks' results is the
whole-file result. Every language's test suite pins that.

### `parseToJson`'s output

A JSON array of objects shaped like `ParsedLine`, with **camelCase** keys — it
is a data format, not a projected type, so it does not follow the host
language's naming convention:

```json
[{ "recordKey": "cnab400/341/retorno/detalhe", "tipo": "1", "segment": "",
   "fields": { "nosso_numero": "12345", "valor_titulo": "150000" } }]
```

Field names inside `fields` are the canonical spec names, unchanged. Values are
identical to what `parse` produces. An unclassifiable line yields an empty
`recordKey` and an empty `fields` object, exactly as with `parse`.

```python
import json
lines = content.splitlines()
cnab_file = CnabFile.for_bank_bundled("cnab400", "341", "", "retorno")
for i in range(0, len(lines), 2000):
    for row in json.loads(cnab_file.parse_to_json("\n".join(lines[i : i + 2000]))):
        print(row["recordKey"], row["fields"]["nosso_numero"])
```

```ts
// Node: `parse` is fine, but chunking parseToJson is what bounds the heap.
const lines = content.split('\n');
for (let i = 0; i < lines.length; i += 2000) {
  for (const row of JSON.parse(file.parseToJson(lines.slice(i, i + 2000).join('\n')))) {
    // ...
  }
}
```

Java (`ObjectMapper`/`JsonNode`) and .NET (`System.Text.Json`) follow the same
shape; see the suites in [`bindings/`](../../bindings/README.md).

### The honest ceiling

Even at its best this is ~0.04 ms/line outside Node, because the jsii kernel
serialises over stdio and nothing in this repo can change that. If you need to
go faster than that, run the engine in Node. The input must also fit in one
string in the host language before you chunk it, so streaming a file that does
not fit in memory is not supported today.

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
