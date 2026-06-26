# CNAB SDK — Reformulation plan & roadmap

Goal: replace the fragmented legacy CNAB projects (`cnab_yaml`, `cnab-json`,
language ports) with a single modern, multi-language SDK driven by one engine
and one verifiable spec.

See the locked architectural decisions:

- [ADR 0001](adr/0001-single-monorepo.md) — single monorepo.
- [ADR 0002](adr/0002-jsii-single-engine.md) — author the engine once in
  jsii-compatible TypeScript; publish to Node/.NET/Python/Java via jsii.
- [ADR 0003](adr/0003-spec-model-catalog-and-standalone-records.md) — hybrid
  field catalog + full standalone records; build-time coverage validation.

Domain terms: [CONTEXT.md](../CONTEXT.md).

## Architecture

```
packages/spec    YAML field catalog + full standalone record specs
  fields/catalog.yml          canonical field semantics (no positions)
  src/<layout>/<bank>/[variant/]<record>.yml   full positioned records
  dist/spec.json              compiled, language-neutral output (generated)
packages/core    jsii engine: parse / build / validate a record
packages/cli     @cnab/cli — Node CLI (parse | build | validate)
tools/
  build-spec.mjs   compile YAML -> neutral JSON; resolve refs; parse pictures;
                   convert strftime -> tokens; validate full-line coverage
  migrate-legacy.mjs  one-shot importer from cnab_yaml (overlay assembly)
```

### Data flow

`catalog.yml` + `src/**/*.yml` → `build-spec.mjs` → `dist/spec.json` →
consumed by `@cnab/core` (engine) and `@cnab/cli`.

## Roadmap / progress

- [x] Scaffold monorepo, ADRs, glossary.
- [x] **A. Migrate all specs** from `cnab_yaml` (cnab240/* and cnab400/*) into
  full standalone records; expand the catalog; fix legacy bugs; verify full,
  gapless, non-overlapping coverage in the compiler.
- [x] **B. `@cnab/cli`** — `parse`, `build`, `validate` over the compiled spec.
- [x] **C. Golden-file tests** in `packages/core` (Caixa 104 CNAB240 + Itaú 341
  CNAB400, remessa & retorno) using synthetic anonymized sample lines.
- [x] **D. jsii build** for `packages/core` (dotnet/python/java targets) + a CI
  job running `jsii` to prove multi-language compatibility. (No publishing.)
- [x] **E.** Keep this plan, ADRs and CONTEXT current.

## What was migrated / tested / remains

See the end-of-step summary in the branch history. Status snapshot lives in the
"Migration coverage" section below, regenerated from the build.

### Migration coverage

The build validates every shipped record for full-line coverage. Run:

```
npm run build:spec      # compiles + validates all specs into packages/spec/dist
npm test                # build spec + run engine golden tests
```

### Known legacy fixes applied during migration

- **Caixa 104 CNAB240 SIGCB `header_arquivo`**: legacy defined two fields at
  positions 65–71 (`uso_exclusivo_banco_01` X(7) *and* `uso_exclusivo_caixa_02`
  9(7)) plus leftover SICOB fields `codigo_cedente_dv` (71) and
  `agencia_mais_cedente_dv` (72) overlapping the SIGCB layout. Resolved to the
  SIGCB layout: 65–71 `uso_exclusivo_caixa_02`, 72 `uso_exclusivo_caixa_03`.

Further per-record fixes are noted inline in the record YAML and in commits.

## Remaining / future work

- Add more banks and segments as documentation is sourced.
- Higher-level file orchestration (lote/arquivo assembly, sequence/checksum
  fields) on top of the per-record engine.
- Publish jsii artifacts to npm/NuGet/PyPI/Maven once the API stabilizes.
