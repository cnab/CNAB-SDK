# Contributing

Thanks for helping. This file is the short version; **[`AGENTS.md`](AGENTS.md) is
the real guide** and applies to humans and AI agents alike — build commands, the
binding architectural rules, jsii gotchas, and how to add a bank.

## Getting set up

```bash
npm install
npm test              # compiles + validates the spec, runs Node tests. KEEP GREEN.
npm run report:spec   # coverage: records, code tables, bank matrix, goldens
npm run docs          # multi-language API reference into site/
```

`npm test` covers **Node only**. The Python, Java and .NET suites live in
[`bindings/`](bindings/README.md) and need those toolchains; CI runs all three on
every push.

## The one rule that matters most

**Never author a field position without the bank's official manual open.**

CNAB is fixed-width with no integrity checking. A position that is off by one
produces a syntactically valid file carrying a different, entirely plausible
number — and the bank accepts it. [#28](https://github.com/cnab/CNAB-SDK/issues/28)
is the record of what that costs.

If you cannot obtain the manual, **stop and say so in the issue**. Do not infer
positions from another bank, from a third-party library, or from a similar
layout. An incomplete contribution is fine; a guessed one is not.

## Where things live

```
packages/spec    field catalog + full standalone positioned records -> spec.json
packages/core    the jsii engine (the only place behaviour is implemented)
packages/cli     @cnab/cli
bindings/        per-language unit suites, run against the GENERATED bindings
tools/           build-spec (compiler + validator), build-api-docs, checks
docs/adrs/       architecture decisions — binding, read before proposing changes
```

## Changing the public API

`@cnab/core` is published to four languages from one TypeScript source, so the
public API is constrained (ADR 0002): enums, props-only `readonly` struct
interfaces, string-keyed maps, primitives and arrays of those. **No unions, no
method overloads, no tuples.**

When you change it:

1. `npm run build:jsii --workspace @cnab/core` must pass with **zero warnings** —
   jsii warns rather than fails on some cross-language problems (`params` is a
   reserved word in C#, for instance), and a warning that merges becomes a
   consumer's problem.
2. Regenerate the API snapshot:
   `node packages/core/test/generate-api-surface.cjs`, then review the diff as a
   **breaking-change review**. It is the contract for four published packages.
3. Add coverage in `bindings/` for the new surface. The Node tests cannot see
   projection bugs — that is how two documented helpers ended up inert in three
   languages while 185 Node tests passed.
4. Add a changeset: `npx changeset`.

## Money and dates

Amounts and dates cross the API as **exact strings** — `"1500.00"`,
`"2026-07-15"` — never floats (ADR 0006). If you find yourself reaching for a
`number` to hold a monetary value, stop.

## Commits and pull requests

- One logical change per commit, with a message that explains **why**.
- `npm test` green at every commit.
- PRs are **squash-merged**, so write the description as the commit message it
  will become.
- Add a changeset for anything user-visible.
- Update the root `CHANGELOG.md` with a `## [X.Y.Z]` section before a release —
  the release job refuses to publish empty notes.

## Reporting bugs

Include the layout, bank, record key and, where you can, an **anonymised** line.
Never paste a real CNAB file: they contain CPF/CNPJ, names, addresses and account
numbers. Replace digits rather than truncating, so positions stay aligned.

Security issues go through [`SECURITY.md`](SECURITY.md), not the issue tracker.
Silent data corruption counts as a security issue here.

## Where to start

Pick from EPIC [#2](https://github.com/cnab/CNAB-SDK/issues/2). Each issue is a
self-contained handoff. Anything labelled `good first issue` needs no CNAB
background beyond what its ticket explains.
