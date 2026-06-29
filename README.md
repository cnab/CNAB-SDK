# CNAB SDK

A modern, multi-language SDK for Brazilian **CNAB 240/400** bank files
(boleto/cobrança remessa & retorno), reformulated from the legacy `cnab_yaml` /
`cnab-json` projects into a single monorepo with one engine and one verifiable
spec.

## Layout

```
packages/spec    field catalog + full standalone record specs -> compiled JSON
packages/core    jsii engine: parse / build / validate (Node/.NET/Python/Java)
packages/cli     @cnab/cli — command-line tool
tools/           build-spec.mjs (compiler/validator), migrate-legacy.mjs
docs/            REFORMULATION plan, ADRs (0001-0004), see also CONTEXT.md
```

## Quick start

```bash
npm install
npm test               # compiles + validates the spec, runs all tests

# CLI
node packages/cli/bin/cnab.mjs records --bank 104
echo '{"codigo_banco":"104"}' \
  | node packages/cli/bin/cnab.mjs build --record cnab240/104/sigcb/header_arquivo
```

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
