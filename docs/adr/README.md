# Architecture Decision Records (ADRs)

An ADR captures a single architectural decision: its context, the decision, and
its consequences. ADRs are **immutable once accepted** — to change a decision,
add a new ADR that supersedes the old one (don't rewrite history).

New to ADRs? See Michael Nygard's
[original post](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## How to add one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` (next number).
2. Fill in Context / Decision / Consequences. Keep it short and concrete.
3. Set Status (`Proposed` → `Accepted`; later `Superseded by ADR NNNN`).
4. If it changes how contributors work, reflect it in [`../../AGENTS.md`](../../AGENTS.md).

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-single-monorepo.md) | Single monorepo for the CNAB SDK | Accepted (locked) |
| [0002](0002-jsii-single-engine.md) | Author the engine once in jsii-compatible TypeScript | Accepted (locked) |
| [0003](0003-spec-model-catalog-and-standalone-records.md) | Spec model: field catalog + full standalone records | Accepted (locked) |
| [0004](0004-record-level-format-overrides.md) | Record-level overrides for date format / decimals | Accepted |
| [0005](0005-build-and-jsii-toolchain.md) | Build & jsii toolchain conventions | Accepted |

## Decisions expected soon (tracked in issues, ADR to be written when decided)

These are deliberately **not** ADRs yet — record one when the call is made:

- **Spec distribution** (embed `spec.json` in `@cnab/core` vs separate per-language
  packages) — issue #13.
- **Numeric value representation** at the API boundary (string-decimal vs double)
  — issue #9.
- **Where validation rules live** (catalog vs record YAML vs separate rules) — issue #11.
- **Control-field roles** for whole-file generation (counters/totals) — issue #7.
- **Versioning/release strategy** (Changesets vs semantic-release) — issue #14.
