# CNAB SDK

A modern, multi-language SDK for Brazilian **CNAB 240/400** bank files
(boleto/cobrança remessa & retorno), reformulated from the legacy `cnab_yaml` /
`cnab-json` projects into a single monorepo with one engine and one verifiable
spec.

## Supported languages and versions

One TypeScript engine, projected to each language by
[jsii](https://github.com/aws/jsii) ([ADR 0002](docs/adrs/0002-jsii-single-engine.md)).

| Language | Minimum version | Package | Tested in CI on | Unit tests |
| --- | --- | --- | --- | --- |
| **Node.js / TypeScript** | **18** (`engines`) | `@cnab/core`, `@cnab/spec`, `@cnab/cli` | 22 | 215 |
| **Python** | **3.10** (`Requires-Python`) | `cnab-core` (module `cnab_core`) | 3.11 | 47 |
| **Java** | **8** (compiled `source/target 1.8`) | `org.cnab:cnab-core` | 17 | 35 |
| **.NET** | **6.0** (`net6.0`) | `Cnab.Core` | 8.0 | 39 |
| **Go** | — | not generated yet — see [#41](https://github.com/cnab/CNAB-SDK/issues/41) | — | — |

The minimums are what the **published artifacts declare**; the CI column is what
is actually exercised on every push. Unit suites for the non-Node languages run
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

## Layout

```
packages/spec    field catalog + full standalone record specs -> compiled JSON
packages/core    jsii engine: parse / build / validate (Node/.NET/Python/Java)
packages/cli     @cnab/cli — command-line tool
bindings/        per-language unit suites (pytest / JUnit 5 / xUnit) run against
                 the GENERATED bindings, not the TypeScript source
tools/           build-spec.mjs (compiler/validator), migrate-legacy.mjs
docs/            REFORMULATION plan, ADRs (0001-0008), see also CONTEXT.md
```

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
