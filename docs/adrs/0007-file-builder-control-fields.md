# ADR 0007 — File builder control fields by name convention

- Status: Accepted
- Date: 2026-07

## Context

Issue #7 adds whole-file generation (`CnabFileBuilder` in `@cnab/core`): header,
lotes, detail segments and trailers, with the layout's control fields —
lote numbering, per-lote record sequences, record/lote counters — computed by
the builder instead of by every caller. The builder must know **which** fields
of a record are control fields. Two options:

1. Add role metadata to the spec (catalog and/or record YAML), e.g.
   `role: lote_sequence`.
2. Identify control fields by **name convention** per layout, in a table
   inside the builder.

Option 1 would touch every record of every bank (and the compiler, and the
ADR 0003 spec model) for what is today a handful of well-known FEBRABAN field
names that the catalog already uses consistently.

## Decision

Control fields are identified by **name convention per layout**, implemented as
a small per-layout table inside `packages/core/src/builder.ts`. No new catalog
or record metadata. A control field is only auto-filled when the record
actually **has** a field with that name (skipped silently otherwise).
User-supplied values in the value maps win over auto-computed counters/totals,
**except pure sequence counters, which the builder always owns** (a wrong
hand-written sequence can never be right).

The exact conventions implemented:

### CNAB240

| Field name | Record(s) | Behaviour | Ownership |
| --- | --- | --- | --- |
| `lote_servico` | header_arquivo | `0000` | builder-owned |
| `lote_servico` | header_lote, details, trailer_lote | lote number, 1-based per lote, zero-padded 4 | builder-owned |
| `lote_servico` | trailer_arquivo | `9999` | builder-owned |
| `numero_sequencial_lote` (aliases: `numero_sequencial_registro`, `numero_sequencial`) | detail segments (pos 9-13) | detail sequence within the lote, 1-based, padded 5 | builder-owned |
| `qtde_registro_lote` | trailer_lote | header_lote + details + trailer_lote count, padded 6 | user wins |
| `qtde_lotes` | trailer_arquivo | number of lotes, padded 6 | user wins |
| `qtde_registros` | trailer_arquivo | total line count of the file, padded 6 | user wins |

The `numero_sequencial_lote` aliases exist because retorno segments name the
same positions 9-13 differently in the current spec: segment U records use
`numero_sequencial_registro` and generic segment W uses `numero_sequencial`.
The first of the three names present on the record is filled. Note that
`numero_sequencial_arquivo` (the remessa file sequence number on
header_arquivo/header_lote) is deliberately **not** a control field — it is
business data supplied by the caller.

### CNAB400

| Field name | Record(s) | Behaviour | Ownership |
| --- | --- | --- | --- |
| `numero_sequencial` | every record that has it | line sequence over the whole file, header = 1, 1-based, padded 6 | builder-owned |

### Explicitly out of scope (future work)

- **Monetary totals** (e.g. `valor_total_titulo_simples`,
  `qtde_titulo_cobranca_simples` on trailer_lote) are **not** auto-summed:
  which detail values roll up into which trailer total depends on per-bank
  carteira semantics (simples/caucionada/descontada). The builder accepts them
  via the trailer value maps; auto-summing needs a per-bank rule and should be
  revisited when more banks demand it.
- Richer per-field **roles in the spec** (option 1) are deferred until the
  name convention demonstrably breaks for a bank we need to support.

### jsii naming note

The header method is `withHeader` (not `setHeader`): jsii prohibits `setXxx`
method names because they conflict with Java property setters (JSII5001) —
same family of constraint as `build` → `toFileContent`/`toLine` (ADR 0002/0005
gotchas).

## Consequences

- Adding a bank whose records reuse the FEBRABAN field names gets whole-file
  generation for free; no spec change, no builder change.
- A bank that names a control field differently needs either a rename in its
  record YAML (preferred — the catalog is canonical) or a new alias in the
  builder's table; the alias list is the ADR-tracked escape hatch.
- The spec stays free of generation-specific metadata (keeps ADR 0003's model
  intact).
- Risk accepted: a business field that *happens* to collide with a convention
  name on some future record would be auto-filled; catalog review on new
  records must keep control-field names reserved for their FEBRABAN meaning.
