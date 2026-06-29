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
