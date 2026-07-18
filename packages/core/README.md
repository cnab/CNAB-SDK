# @cnab/core

The CNAB 240/400 engine for parsing, building and validating Brazilian bank
files. Authored once in jsii-compatible TypeScript and published to
Node/.NET/Python/Java via [jsii](https://github.com/aws/jsii) (see
[ADR 0002](../../docs/adrs/0002-jsii-single-engine.md)).

## API

- `CnabSpec.fromJson(json)` — load the compiled `spec.json`.
  - `recordKeys()`, `hasRecord(key)`, `getRecord(key)`.
- `CnabRecord.fromJson(json)` — load a single record spec.
  - `parse(line)` → `{ [name]: value }`
  - `toLine(values)` → fixed-width line (named `toLine`, not `build`, because
    `build` is a reserved member name in jsii)
  - `validate(line)` → `{ valid, errors }`
  - `spec` — the underlying `RecordSpec`
- `CnabFile.forBank(json, layout, bank, variant, direction)` — a whole-file
  parser scoped to one bank.
  - `parse(content)` → `ParsedLine[]` (auto-detects each line's record type from
    its discriminator positions: CNAB240 pos 8 + segment pos 14, CNAB400 pos 1).

`parse` normalizes values (alpha right-trimmed, numerics left-stripped) so that
`toLine(parse(line))` reproduces a well-formed line.

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
