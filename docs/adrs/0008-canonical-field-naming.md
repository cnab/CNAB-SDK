# ADR 0008 — Canonical field naming: one spelling per concept

- Status: Proposed
- Date: 2026-07

## Context

[ADR 0003](0003-spec-model-catalog-and-standalone-records.md) makes
`packages/spec/fields/catalog.yml` the **field library**: a canonical field name
maps to its semantics, and every record `ref`s that name. The premise is that a
name *is* the concept, so a consumer can write bank-agnostic code —
`record.get('codigo_banco')` should mean the same thing for Itaú and for Caixa.

That premise does not currently hold. The catalog was assembled by
`tools/migrate-legacy.mjs` from `../cnab_yaml`, where different bank files spell
the same concept differently (`codigo_banco` vs `codigo_do_banco`,
`nome_empresa` vs `nome_da_empresa`, …). The importer preserved both spellings
verbatim, so the catalog ships **two canonical names for one concept**.

### Measured duplication (spec.json, 2026-07)

Normalizing each catalog key by dropping the connectives `_de_` / `_do_` /
`_da_` / `_dos_` / `_das_` and all underscores, then grouping:

- **297** catalog fields → **21** collision clusters
- **42** of the 297 names (14 %) are one half of a duplicated pair
- those 42 names are referenced **361** times across all **55** records — i.e.
  every shipped record contains at least one field from a duplicated cluster

| normalized key | catalog names (record references) |
| --- | --- |
| `codigobanco` | `codigo_banco` (38) / `codigo_do_banco` (15) |
| `codigoinscricao` | `codigo_de_inscricao` (4) / `codigo_inscricao` (12) |
| `codigoocorrencia` | `codigo_de_ocorrencia` (5) / `codigo_ocorrencia` (11) |
| `codigoservico` | `codigo_de_servico` (5) / `codigo_servico` (2) |
| `datacredito` | `data_credito` (9) / `data_de_credito` (2) |
| `datageracao` | `data_de_geracao` (5) / `data_geracao` (12) |
| `dataocorrencia` | `data_de_ocorrencia` (5) / `data_ocorrencia` (3) |
| `literalservico` | `literal_de_servico` (5) / `literal_servico` (2) |
| `mensagem1` | `mensagem1` (1) / `mensagem_1` (4) |
| `mensagem2` | `mensagem2` (1) / `mensagem_2` (4) |
| `nomebanco` | `nome_banco` (7) / `nome_do_banco` (5) |
| `nomeempresa` | `nome_da_empresa` (5) / `nome_empresa` (13) |
| `nomesacado` | `nome_do_sacado` (1) / `nome_sacado` (4) |
| `numerodocumento` | `numero_do_documento` (5) / `numero_documento` (10) |
| `numeroinscricao` | `numero_de_inscricao` (4) / `numero_inscricao` (16) |
| `tiporegistro` | `tipo_de_registro` (15) / `tipo_registro` (40) |
| `usobanco` | `uso_banco` (2) / `uso_do_banco` (1) |
| `usoempresa` | `uso_da_empresa` (4) / `uso_empresa` (10) |
| `usoexclusivofebraban01` | `uso_exclusivo_febraban01` (2) / `uso_exclusivo_febraban_01` (31) |
| `usoexclusivofebraban02` | `uso_exclusivo_febraban02` (2) / `uso_exclusivo_febraban_02` (24) |
| `valortitulo` | `valor_do_titulo` (5) / `valor_titulo` (10) |

Reproduce with: normalize `Object.keys(spec.catalog)` as above and group.

Every cluster above is a genuine synonym pair — same concept, same picture
family, descriptions that restate each other (e.g. `codigo_banco` = "Caixa =
104, Santander = 033" vs `codigo_do_banco` = "Número do banco na câmara de
compensação"). None encodes a real semantic distinction.

### Why it hurts

1. **Bank-agnostic code is impossible.** Reading the bank code from a parsed
   line requires `values['codigo_banco'] ?? values['codigo_do_banco']`. The
   burden grows with every bank added.
2. **The catalog stops being a library.** Two entries for one concept means two
   descriptions to keep in sync; they already disagree in tone and detail.
3. **The problem is self-reproducing.** Nothing stops the next contributor from
   adding `codigo_da_ocorrencia`; the build validates positions, not names.
4. **It leaks into every language binding.** Field names are the map keys in the
   jsii-published API, so the duplication reaches Node/.NET/Python/Java users.

### Constraints

- Field names are **map keys inside record YAML** and inside the parsed-value
  maps returned by the engine — renaming is a breaking change for consumers.
- Goldens under `packages/core/test/golden/` are committed fixtures keyed by
  field name; a bulk rename invalidates them.
- ADR 0003 forbids inheritance/overlay, so there is no place to "alias" a name
  at record level today.

## Decision

**Not yet decided — this ADR is Proposed and needs a human call.** The options
considered, with a recommendation:

### Option A — Do nothing (status quo)

Accept both spellings; document the pairs so consumers can defend against them.

### Option B — Hard rename now

Pick one spelling per cluster and rewrite all 361 references plus the goldens in
one commit.

### Option C — Canonical name + `aliases`, incremental migration (**recommended**)

1. **Pick one canonical spelling per cluster.** Default rule: prefer the form
   **without** the connective (`codigo_banco`, `nome_empresa`,
   `data_geracao`, `numero_documento`, `tipo_registro`, `valor_titulo`, …) and
   the form **with** an underscore before a trailing index
   (`mensagem_1`, `uso_exclusivo_febraban_01`). Where the two spellings are
   near-tied in usage the higher reference count wins; the table above records
   the counts.

2. **Add an `aliases:` list to the catalog entry** for the surviving name:

   ```yaml
   codigo_banco:
     picture: "9(3)"
     aliases: [codigo_do_banco]
     description: "Número do banco na câmara de compensação."
   ```

   Alias names are **not** separate catalog entries. `tools/build-spec.mjs`
   resolves a record's `ref` through the alias map, so existing record YAML
   keeps working unchanged and the compiled `spec.json` emits only the canonical
   name. Aliases are exported in `spec.json` so a runtime lookup helper can
   accept a legacy name.

3. **Migrate records incrementally.** Rewrite `ref:`s cluster by cluster, one
   commit per cluster, regenerating goldens with
   `node packages/core/test/generate-golden.cjs` each time. When a cluster has
   no remaining references, the alias stays (for consumer compatibility) but the
   record tree is clean.

4. **Make the build reject new collisions.** `tools/build-spec.mjs` gains a
   check: normalize every catalog key (drop `_de_`/`_do_`/`_da_`/`_dos_`/`_das_`
   and underscores) and **fail the build** if a *new* name normalizes onto an
   existing name or alias. The 21 pre-existing clusters go into an explicit,
   shrinking allow-list in the tool so the check is green on day one and the
   remaining debt is visible in one place.

5. **Record the naming rule in `AGENTS.md`** ("How to add a bank / record") and
   in `CONTEXT.md` so the convention is discoverable at authoring time.

Nothing in this ADR changes ADR 0003: records stay full and standalone, and
alias resolution happens at **compile** time, not as record inheritance.

## Consequences

### Option A — Do nothing

- Easier: zero work, zero risk to goldens or published APIs.
- Harder: every consumer writes `a ?? b` fallbacks forever; the catalog's
  "canonical name" promise in ADR 0003 stays false, and duplication grows with
  each new bank.
- Accepted trade-off: the SDK's central value proposition (one bank-agnostic
  vocabulary) is not delivered.

### Option B — Hard rename now

- Easier: one clean catalog, immediately; no alias machinery to build or carry.
- Harder: a single large commit touching 361 references in 55 record files plus
  every golden — hard to review, and any mistake is a silently wrong line
  position. Breaks every existing consumer at once with no deprecation path,
  across five language bindings.
- Accepted trade-off: only defensible before the first public release.

### Option C — Canonical name + aliases (recommended)

- Easier: consumers get one name per concept immediately (the compiled
  `spec.json` is canonical from the first commit); legacy names keep resolving,
  so nothing breaks; each migration commit is small and independently
  reviewable with its own regenerated goldens.
- Harder: `tools/build-spec.mjs` grows an alias-resolution step and a collision
  check; the catalog schema grows an optional `aliases` key that the record
  authoring docs must explain. The normalization heuristic is a heuristic — it
  would flag a legitimate future pair such as `valor_desconto` vs
  `valor_do_desconto` if they ever meant different things, which is why the
  allow-list is explicit rather than automatic.
- Accepted trade-off: aliases are permanent surface area. They are the price of
  not breaking consumers, and the allow-list makes the remaining debt countable.
- Follow-up work: choose the 21 winners (mechanical, given the table above);
  implement alias resolution + the collision gate; then 21 small migration
  commits; then update `AGENTS.md` and `CONTEXT.md`.
