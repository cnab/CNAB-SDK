# CNAB SDK

A modern, multi-language SDK for Brazilian **CNAB 240/400** bank files
(boleto/cobrança remessa & retorno), reformulated from the legacy `cnab_yaml` /
`cnab-json` projects into a single monorepo with one engine and one verifiable
spec.

📖 **Documentation: [cnab.github.io](https://cnab.github.io/)** ·
**[API reference](https://cnab.github.io/api/)**

## Supported languages and versions

One TypeScript engine, projected to each language by
[jsii](https://github.com/aws/jsii) ([ADR 0002](docs/adrs/0002-jsii-single-engine.md)).

| Language | Minimum version | Package | Tested in CI on | Unit tests |
| --- | --- | --- | --- | --- |
| **Node.js / TypeScript** | **18** (`engines`) | `@cnab/core`, `@cnab/spec`, `@cnab/cli` | 22 | 316 |
| **Python** | **3.10** (`Requires-Python`) | `cnab-core` (module `cnab_core`) | 3.11 | 58 |
| **Java** | **8** (compiled `source/target 1.8`) | `org.cnab:cnab-core` | 17 | 46 |
| **.NET** | **6.0** (`net6.0`) | `Cnab.Core` | 8.0 | 50 |
| **Go** | **1.25** | generated + tested, **not distributed** — [#41](https://github.com/cnab/CNAB-SDK/issues/41) | 1.25 | 11 |

The minimums are what the **published artifacts declare**; the CI column is what
is actually exercised on every push. Go is a configured jsii target whose
binding suite runs in CI, but the module is **not published** — `go get` will
not work until [#41](https://github.com/cnab/CNAB-SDK/issues/41) steps 2-3 land
([ADR 0009](docs/adrs/0009-go-module-distribution.md)). Unit suites for the non-Node languages run
against the *generated bindings*, not the TypeScript source — see
[`bindings/`](bindings/README.md).

> [!IMPORTANT]
> **The Python, Java and .NET bindings require Node.js at runtime.** This is how
> jsii works: the engine really is the TypeScript code, and each binding starts
> an embedded Node process (`node`, overridable via `JSII_NODE`) and talks to it.
> Node is a runtime dependency of your application, not just a build tool. jsii's
> own runtime asks for **Node ≥ 20.16**, so that is the practical floor for
> non-Node consumers even though `@cnab/core` itself declares `>=18`.

Built with jsii **6.0.5**; the jsii runtime libraries are pinned to
**1.139.x** (`jsii>=1.139.0,<2` · `software.amazon.jsii:jsii-runtime:1.139.0` ·
`Amazon.JSII.Runtime [1.139.0,2.0.0)`).

**Nothing is published to npm, PyPI, Maven Central or NuGet yet.** Releases are
cut as GitHub Releases with the artifacts attached; registry publishing is
[#14](https://github.com/cnab/CNAB-SDK/issues/14).

## Bank coverage

**5 banks**, **92 records** (74 bank-specific + 18 generic FEBRABAN templates),
**6 code tables** and **318 catalog fields**.

Each cell states both directions, because coverage is not symmetric and a bare
tick would hide that.

| Bank | Code | CNAB 240 | CNAB 400 |
| --- | --- | --- | --- |
| Caixa Econômica Federal | `104` | ✅ remessa + retorno (SIGCB) | ✅ remessa + retorno |
| Santander | `033` | ✅ remessa + retorno | ✅ remessa + retorno |
| Itaú | `341` | ✅ remessa + retorno | ✅ remessa + retorno |
| Banco do Brasil | `001` | ⚠️ **3 records, no trailers** | ✅ remessa + retorno |
| Bradesco | `237` | ⚠️ **draft** — remessa + retorno | ✅ remessa + retorno |

**Every bank can now both read and write CNAB 400.** Two qualifiers still matter:

- **Bradesco CNAB240 is a draft.** It was transcribed from version 02 of
  Bradesco's manual, dated 2013; the bank publishes version 09. The positions
  are faithful to that document, but two defaults most likely to have moved
  (`versao_layout_arquivo` and `versao_layout_lote`) will be accepted or
  rejected wholesale by the bank, and anything Bradesco has since carved out of
  what 2013 called filler will be blank in generated files. Review it against a
  current manual before generating a real remessa. See
  [#71](https://github.com/cnab/CNAB-SDK/issues/71). **Bradesco CNAB400 is not
  affected** — it comes from a late revision of its own manual series.
- **Banco do Brasil CNAB240 is three records** — header arquivo, header lote
  and remessa segmento P, with no trailers, so a file cannot be closed with
  bank-specific records alone. Its CNAB400 is complete in both directions.
- Where a bank record is missing, the `generic` FEBRABAN templates can usually
  stand in, since trailers in particular are standard. That substitution is not
  yet tested or documented, so treat it as unverified.

Two CNAB400 remessa layouts are scoped by the manual they came from, and the
scope is not a property the spec can express — read this before relying on them:

- **Banco do Brasil** is transcribed from the manual for **convênios numbered
  above 1.000.000**. Convênios at or below that number place the convênio field
  differently and are not covered.
- **Caixa** carries a Caixa-specific split the generic template does not have:
  nosso número is 17 positions, of which the first two are the *modalidade*
  (`modalidade_carteira` 57-58, `nosso_numero` 59-73), and carteira is 2
  positions rather than 1.

Every shipped record is verified by the compiler for full, gapless,
non-overlapping line coverage, and has a golden-line test plus round-trip
property tests. More banks are tracked in
[#5](https://github.com/cnab/CNAB-SDK/issues/5); each one needs the bank's
official manual, because a guessed position does not throw — it produces a
plausible, wrong number.

## Layout

```
packages/spec    field catalog + full standalone record specs -> compiled JSON
packages/core    jsii engine: parse / build / validate (Node/.NET/Python/Java)
packages/cli     @cnab/cli — command-line tool
bindings/        per-language unit suites (pytest / JUnit 5 / xUnit) run against
                 the GENERATED bindings, not the TypeScript source
tools/           build-spec.mjs (compiler/validator), migrate-legacy.mjs,
                 fetch-layouts.mjs (rebuilds the bank manuals we transcribe from)
docs/            REFORMULATION plan, ADRs (0001-0010), layouts/ (manual
                 provenance), see also CONTEXT.md
```

Every position in the spec comes from a bank manual, and
[`docs/layouts/`](docs/layouts/README.md) records which one. The manuals are not
committed — `node tools/fetch-layouts.mjs` reconstructs them from pinned
upstream commits, verified by sha256.

## Quick start

```bash
npm install
npm test               # compiles + validates the spec, runs all Node tests

# CLI
node packages/cli/bin/cnab.mjs records --bank 104
echo '{"codigo_banco":"104"}' \
  | node packages/cli/bin/cnab.mjs build --record cnab240/104/sigcb/header_arquivo
```

`npm test` covers Node only. To exercise the other three languages you need
their toolchains and the generated bindings — see
[`bindings/README.md`](bindings/README.md).

## Contributing / working in this repo

Start with [`AGENTS.md`](AGENTS.md) — the canonical guide for humans and AI
agents (build/test commands, the binding rules, jsii gotchas, and how to add a
bank/record). Domain terms are in [`CONTEXT.md`](CONTEXT.md).

## Design

Locked architectural decisions live in [`docs/adrs`](docs/adrs) (see the
[ADR index](docs/adrs/README.md)):

1. [Single monorepo](docs/adrs/0001-single-monorepo.md).
2. [Author the engine once in jsii-compatible TypeScript](docs/adrs/0002-jsii-single-engine.md);
   publish to Node/.NET/Python/Java via jsii.
3. [Hybrid spec model](docs/adrs/0003-spec-model-catalog-and-standalone-records.md):
   a field-library catalog (semantics by canonical name) + full standalone
   records (each lists its complete positioned field set; no inheritance), with
   build-time full-line coverage validation.
4. [Record-level format overrides](docs/adrs/0004-record-level-format-overrides.md)
   for polymorphic fields (e.g. 6- vs 8-digit dates).

See [`docs/REFORMULATION.md`](docs/REFORMULATION.md) for the roadmap and status.
