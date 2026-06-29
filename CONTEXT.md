# CONTEXT — CNAB domain glossary

Living glossary for the CNAB-SDK reformulation. Keep terms here current as they
crystallize; code and docs should use these canonical English/Portuguese terms.

> Working in this repo? Start with [`AGENTS.md`](AGENTS.md) (build/test, rules,
> how to add a spec) and the ADRs in [`docs/adrs/`](docs/adrs/).

## CNAB

**CNAB** (Centro Nacional de Automação Bancária) is the FEBRABAN standard for
exchanging fixed-width text files between a company (the *cedente*/biller) and a
bank, used primarily for *cobrança* (boleto/collection) processing.

A CNAB file is a sequence of fixed-length lines (records). Every position in a
line is significant; fields are addressed by 1-based `[start, end]` ranges and
padded by type (numbers right-aligned with leading zeros, text left-aligned with
trailing spaces).

## Layouts

- **CNAB240** — 240-character lines. Structured as Arquivo → Lotes → Registros.
  Record kinds: `header_arquivo`, `header_lote`, detail `segmento_*` records
  (P, Q, R, T, U, W…), `trailer_lote`, `trailer_arquivo`.
- **CNAB400** — 400-character lines. Flatter: `header_arquivo`, `detalhe`
  records, `trailer_arquivo`. Itaú's 400 layout is the historical reference.

## Direction

- **remessa** — file sent *company → bank* (instructions: register titles, etc).
- **retorno** — file sent *bank → company* (status: paid, bounced, etc).

## Key entities / fields (canonical names)

- **codigo_banco** — bank code in the clearing system (Caixa = `104`,
  Santander = `033`, Bradesco = `237`, Itaú = `341`, Banco do Brasil = `001`).
- **cedente / beneficiario** — the biller receiving payment.
- **sacado / pagador** — the payer.
- **nosso_numero** — the bank's identifier for a title (boleto).
- **codigo_ocorrencia** — movement/occurrence code (remessa instruction or
  retorno status). Per-bank lookup tables live as *code tables* in the spec.
- **carteira** — collection portfolio/modality.

## Spec model terms (this repo)

- **catalog** — `packages/spec/fields/catalog.yml`. The field *library*: maps a
  canonical field name to its SEMANTICS (type, decimals, date format,
  description). Never contains positions.
- **record (full standalone)** — a YAML file under `packages/spec/src/...` that
  lists the COMPLETE, positioned field set for one record, covering the entire
  240/400 line. Each field `ref`s a catalog entry and carries its own `pos`.
  There is NO inheritance/overlay at author, build, or runtime.
- **generic** — reference template records used only as a copy-from source while
  authoring; not shipped as a runnable bank record.
- **picture** — legacy COBOL-style type notation: `9(n)` numeric, `X(n)`
  alphanumeric, `V9(n)` implied decimal places. Used in the catalog to convey
  type + decimals; the field's actual size comes from each record's `pos`.
- **code table** — a non-positioned lookup (e.g. `codigo_ocorrencia`) mapping a
  code to a human description.

## Field types (neutral, compiled output)

- `num` — numeric, right-aligned, zero-padded.
- `alpha` — text, left-aligned, space-padded.
- `num_decimal` — numeric with implied decimals (`decimals > 0`); the decimal
  separator is implied, not stored.

## Date formats (neutral tokens)

Legacy strftime is converted at build time to language-neutral tokens:
`%d%m%Y → ddMMyyyy`, `%d%m%y → ddMMyy`, `%H%M%S → HHmmss`.

## Check digits & boleto (planned — see issue #8)

- **DV / DAC** — dígito verificador / dígito de autoconferência: a check digit
  computed by módulo 10 or módulo 11 over a field (agência, conta, nosso número,
  código de barras…). Rules vary per bank.
- **código de barras** — the 44-digit barcode payload of a boleto.
- **linha digitável** — the 47-digit human-typeable representation of the barcode.
- **fator de vencimento** — days since a fixed base date, encoding the due date
  inside the barcode.

## Cross-references

- Build/test/authoring workflow and jsii rules: [`AGENTS.md`](AGENTS.md).
- Architecture decisions: [`docs/adrs/`](docs/adrs/).
- Plan & status: [`docs/REFORMULATION.md`](docs/REFORMULATION.md).
- Remaining work: GitHub EPIC issue #2 and its sub-issues.
