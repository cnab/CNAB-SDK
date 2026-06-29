# CNAB SDK — Developer API

The CNAB SDK parses and generates Brazilian **CNAB 240/400** bank files
(boleto/cobrança, *remessa* & *retorno*). The engine is authored once in
TypeScript and published to multiple languages via
[jsii](https://github.com/aws/jsii).

This site is the **API reference** for the `@cnab/core` engine. Use the sidebar
to browse classes (`CnabRecord`, `CnabSpec`, `CnabFile`), enums and interfaces.

## Install (Node / TypeScript)

```bash
npm install @cnab/core @cnab/spec
```

> Other languages (Python, .NET, Java) are produced from the same engine via
> jsii — see the project roadmap (publishing is tracked in the repo issues).

## Quickstart

### Parse a single line

```ts
import { CnabSpec } from '@cnab/core';
import { readFileSync } from 'node:fs';

// the compiled, language-neutral spec
const spec = CnabSpec.fromJson(readFileSync(require.resolve('@cnab/spec'), 'utf8'));

const record = spec.getRecord('cnab240/104/sigcb/header_arquivo');
const fields = record.parse(line);     // { codigo_banco: '104', ... }
const rebuilt = record.toLine(fields); // round-trips back to the fixed-width line
const result = record.validate(line);  // { valid, errors }
```

### Build a line

```ts
const line = record.toLine({ codigo_banco: '104', nome_empresa: 'EMPRESA LTDA' });
// missing fields fall back to their spec defaults
```

### Parse a whole file (auto-detect record types)

```ts
import { CnabFile } from '@cnab/core';

const file = CnabFile.forBank(specJson, 'cnab240', '104', 'sigcb', 'remessa');
for (const parsed of file.parse(fileContent)) {
  console.log(parsed.recordKey, parsed.fields);
}
```

## CLI

```bash
npm install -g @cnab/cli
cnab records --bank 104
echo '{"codigo_banco":"104"}' | cnab build --record cnab240/104/sigcb/header_arquivo
```

## Key types

- **`CnabRecord`** — one record spec: `parse` / `toLine` / `validate` / `spec`.
- **`CnabSpec`** — registry of records: `recordKeys` / `hasRecord` / `getRecord`.
- **`CnabFile`** — whole-file parser with record auto-detection.
- **`FieldType`**, **`FieldSpec`**, **`RecordSpec`**, **`ValidationResult`**,
  **`ParsedLine`** — the data shapes.

## Notes

- `parse` returns a `{ [fieldName]: string }` map; values are normalized so that
  `toLine(parse(line))` reproduces a well-formed line.
- The builder method is `toLine` (not `build`) and the field-type property is
  `fieldType` (not `type`) to stay multi-language compatible.

---

Source & contribution guide: <https://github.com/cnab/CNAB-SDK> ·
Architecture decisions: `docs/adrs/` · Domain glossary: `CONTEXT.md`.
