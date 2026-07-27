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
| [0006](0006-typed-value-representation.md) | Typed value representation: decimal strings & ISO dates | Accepted |
| [0007](0007-file-builder-control-fields.md) | File builder control fields by name convention | Accepted |
| [0008](0008-canonical-field-naming.md) | Canonical field naming: one spelling per concept | Accepted |
| [0009](0009-go-module-distribution.md) | Go module distribution: a separate `cnab/cnab-core-go` repo | Proposed |

## Decisions expected soon (tracked in issues, ADR to be written when decided)

These are deliberately **not** ADRs yet — record one when the call is made:

- **Spec distribution** (embed `spec.json` in `@cnab/core` vs separate per-language
  packages) — issue #13.
- **Where validation rules live** (catalog vs record YAML vs separate rules) — issue #11.
- **Versioning/release strategy** (Changesets vs semantic-release) — issue #14.
