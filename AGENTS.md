# AGENTS.md — working guide for AI agents & contributors

This is the **canonical entry point** for anyone (human or AI) working in this
repo. Read this first, then [`CONTEXT.md`](CONTEXT.md) (domain glossary) and the
ADRs in [`docs/adrs/`](docs/adrs/). The roadmap of remaining work is **issue #2**
(the EPIC) and its sub-issues.

## What this project is

A modern, multi-language SDK to **parse and generate** Brazilian **CNAB 240/400**
bank files (boleto/cobrança, remessa & retorno), built from **one** TypeScript
engine and **one** verifiable spec, published to Node/.NET/Python/Java(/Go) via
[jsii](https://github.com/aws/jsii).

## Repository map

```
packages/spec    field catalog + full standalone record specs -> compiled JSON
  fields/catalog.yml                 canonical field SEMANTICS (no positions)
  src/<layout>/<bank>/[variant/][direction/]<record>.yml   full positioned records
  dist/spec.json                     compiled, language-neutral output (generated)
packages/core    jsii engine: CnabRecord, CnabSpec, CnabFile (parse/build/validate)
packages/cli     @cnab/cli — Node CLI (records | parse | build | validate |
                 detect | parse-file | tables | code | boleto); reads/writes
                 latin1 by default (--encoding, --crlf, --trailing-newline)
tools/
  build-spec.mjs    compile + VALIDATE specs -> packages/spec/dist/spec.json
  migrate-legacy.mjs ONE-SHOT importer from ../cnab_yaml (do not re-run blindly)
docs/
  REFORMULATION.md  plan & status
  adrs/             architecture decisions (READ THESE — they are binding)
CONTEXT.md          domain glossary
```

## Build / test / verify (always do this)

```bash
npm install
npm run build:spec   # compile + validate all specs; fails on coverage gaps/overlaps
npm test             # build:spec + all workspace tests (node --test). KEEP GREEN.
npm run report:spec  # coverage summary: records, code tables, bank matrix, goldens
# Prove the public API stays multi-language compatible:
cd packages/core && npx -y jsii@^6 --tsconfig tsconfig.json --validate-tsconfig minimal --no-fix-peer-dependencies
```

`npm test` must be green at every commit.

## Binding rules (ADRs — do not relitigate)

1. **Single monorepo** ([ADR 0001](docs/adrs/0001-single-monorepo.md)).
2. **Author the engine once in jsii-compatible TS** ([ADR 0002](docs/adrs/0002-jsii-single-engine.md)).
   The public API may use **only**: enums, struct interfaces (props-only
   `readonly`), string-keyed maps (`{[k:string]: string}`), primitives, and
   arrays of those. **No** union/intersection types, **no** method overloads,
   **no** tuples (positions are exposed as `start`/`end` numbers).
3. **Hybrid spec model** ([ADR 0003](docs/adrs/0003-spec-model-catalog-and-standalone-records.md)):
   catalog = semantics by canonical name (no positions); records = full
   standalone positioned field sets that `ref` the catalog. No inheritance/
   overlay at author/build/runtime. The build validates **full, gapless,
   non-overlapping** line coverage for bank records.
4. **Record-level overrides** ([ADR 0004](docs/adrs/0004-record-level-format-overrides.md)):
   a record field may override `picture`/`decimals`/`date_format`.
5. **Build & jsii toolchain** ([ADR 0005](docs/adrs/0005-build-and-jsii-toolchain.md)):
   `tsc` for tests, `jsii` for the assembly; the gotchas below are recorded there.

## jsii gotchas (learned the hard way — keep them)

- Method **`build` is prohibited** by jsii → the builder method is `toLine`
  (and `CnabFileBuilder`'s terminal method is `toFileContent`).
- Method names **`setXxx` are prohibited** by jsii (Java setter conflict,
  JSII5001) → `CnabFileBuilder.withHeader`, not `setHeader`.
- **`type` is a Go reserved word** → the field-type property is `fieldType`.
- `packages/core/tsconfig.json` uses **`module`/`moduleResolution: node16`** so
  both `tsc` (local) and jsii's bundled TS accept it (avoids `ignoreDeprecations`
  version mismatch). Don't switch back to `module: commonjs` + `node`.
- The jsii assembly file `.jsii` is a **dotfile**; the CI artifact upload needs
  `include-hidden-files: true`.
- Private members / internal types are fine; jsii only constrains the **public**
  API surface. Re-run `jsii` after any public-API change.

## How to add a bank / record / segment (the common task)

1. Find the official bank/FEBRABAN manual. The legacy specs in `../cnab_yaml`
   (read-only) and the `generic` templates under `packages/spec/src/.../generic/`
   are good copy-from starting points.
2. Add any new fields to `packages/spec/fields/catalog.yml`
   (`<name>: { picture, date_format?, description }`). Reuse existing canonical
   names where semantics match. Field **names are map keys → unique per record**.
3. Author the record YAML as a **full standalone** record:
   ```yaml
   meta: { layout: cnab240, bank: "104", variant: sigcb, direction: remessa,
           record: detalhe_segmento_p, lineLength: 240 }
   fields:
     - { ref: codigo_banco, pos: [1, 3] }
     - { ref: tipo_registro, pos: [8, 8], default: "3" }
     # picture/decimals/date_format overrides allowed per ADR 0004
   ```
4. `node tools/build-spec.mjs` until coverage validation passes (no gaps/overlaps).
5. Add/refresh golden tests (`packages/core/test/`); regenerate goldens with
   `node packages/core/test/generate-golden.cjs` after an intentional change.
   Every **shipped** record gets a golden line automatically (a deterministic
   case derived by `defaultCaseFor` in `test/cases.cjs`), so a new record only
   needs the regeneration step — add a hand-written case in `cases.cjs` when you
   can assert real positions/values, which is far more valuable. Generic
   round-trip invariants for all shipped records live in `test/property.test.js`.
6. `npm test` green; commit.

## Engine API (current)

- `CnabRecord.fromJson(json)` → `parse(line)`, `toLine(values)`, `validate(line)`, `spec`.
  `toLine` is **strict** (throws on oversized / non-digit values); the lenient
  legacy behaviour is opt-in via `toLineWithOptions(values, LineOptions)`.
- `CnabSpec.fromJson(json)` → `recordKeys()`, `hasRecord(key)`, `getRecord(key)`.
- `CnabFile.forBank(specJson, layout, bank, variant, direction)` → `parse(content): ParsedLine[]`.
- `CnabFileBuilder.forBank(specJson, layout, bank, variant, direction)` →
  `withHeader`, `startLote`/`addDetail`/`endLote` (cnab240), `addDetail` (cnab400),
  `toFileContent(trailerValues)`. Control fields auto-computed per ADR 0007.

Record keys look like `cnab240/104/sigcb/header_arquivo`.

## Conventions

- Commit per logical step with a clear message; keep `npm test` green.
- Develop on a feature branch; do **not** open a PR unless asked.
- **Always squash-merge PRs into `main`.** `main` keeps one commit per PR, so its
  history reads as a list of changes rather than a list of keystrokes. Two
  consequences worth knowing before you hit merge:
  - The branch commits are **not** ancestors of `main` afterwards, even though
    the tree is identical. Do not try to re-push or "catch up" a merged branch —
    start the next piece of work from `origin/main` instead.
  - The squash commit message is the durable record. Write the PR description as
    if it were that message.
- Generated artifacts (`lib/`, `dist/`, `.jsii`) are gitignored; goldens under
  `packages/core/test/golden/` are committed fixtures.
- `tools/migrate-legacy.mjs` is a one-shot importer — the generated files under
  `packages/spec/` are now the source of truth; hand-edit them, don't re-run it.
- Do not put model/session identifiers in committed artifacts.

## Where to start

Pick an issue from EPIC **#2**. Each issue is a self-contained handoff (current
state, files, steps, acceptance criteria). Suggested first: **#12** then **#6**,
then **#9**, then the **#7 + #8** generation pair.

## Regression guards (do not delete; understand before changing)

Three invariants are enforced automatically because each one has already been
broken once:

- **Public API snapshot** — `packages/core/test/api-surface.json` is the
  multi-language contract, extracted from the `.jsii` assembly (TS `private` is
  erased at runtime, so the assembly, not `require()`, is the source of truth).
  A diff means four published packages change. If intentional:
  `node packages/core/test/generate-api-surface.cjs`, then review the diff as a
  breaking-change review. The same test re-asserts the naming rules above.
  `packages/core`'s `test` script runs `build:jsii` (not plain `tsc`) so the
  assembly is always fresh and jsii-safety is checked on every local test run.
- **Packaging** — `tools/check-packaging.mjs` runs in `npm test` (declarations:
  `files`, `prepack`, `engines`, `main` coverage) and in CI with `--pack`
  (`npm run check:packaging`, which builds the real tarballs and asserts
  `lib/index.js`, `.jsii` and `dist/spec.json` are inside).
- **CLI surface** — `packages/cli/test/surface.test.cjs` asserts every
  documented command is really dispatched and vice versa, so the CLI cannot
  silently fall behind the engine again.

## Releasing (versioning only — publishing is not wired yet)

Versions are managed by [Changesets](https://github.com/changesets/changesets).
All three packages move in **lockstep** (`fixed` in `.changeset/config.json`):
`@cnab/core`'s version is what jsii projects to PyPI/Maven/NuGet, and
`@cnab/cli` pins its siblings by exact version, so skew is not worth the
flexibility.

```bash
npx changeset          # describe your change; commit the generated .changeset/*.md
npx changeset version  # apply pending bumps + rewrite package changelogs
npm install            # REQUIRED after a version bump — the workspace links are
                       # keyed by version, and node_modules goes stale without it
npm test
```

`.github/workflows/release.yml` opens a "version packages" PR on merge to
`main`, and tags + creates the GitHub Release when that PR merges. It
deliberately does **not** publish: each registry is a separate, approval-gated
job tracked in #14 (#37 npm · #38 PyPI · #39 Maven · #40 NuGet · #41 Go).

`CHANGELOG.md` at the root is the curated narrative; `packages/*/CHANGELOG.md`
are generated by Changesets.
