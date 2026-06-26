# ADR 0003 — Spec model: hybrid field catalog + full standalone records

- Status: Accepted (locked)
- Date: 2026-06

## Context

In `cnab_yaml`, a bank's record is a **partial overlay** on a `generic`
template: the bank file lists only the fields that differ, and consumers must
merge bank-over-generic *by field name* at runtime. This overlay is implicit,
order-sensitive, and silently produces broken lines when a bank redefines a
position without removing the generic field that used to occupy it (e.g. the
Caixa SIGCB header ends up with two fields claiming positions 65–71).

## Decision

A **hybrid** model:

1. **Field-library catalog** — `packages/spec/fields/catalog.yml` maps each
   canonical field name to its SEMANTICS only: `type` (via picture),
   `decimals`, `date_format`, `description`. **Never positions.**

2. **Full standalone records** — each record YAML under `packages/spec/src/`
   lists its COMPLETE, positioned field set covering the whole 240/400 line.
   Every field `ref`s a catalog entry and carries its own `pos`. There is **no
   inheritance/overlay** at author, build, or runtime.

`generic` records are kept only as reference templates to copy from; they are
not shipped as runnable bank records.

The compiler (`tools/build-spec.mjs`) resolves catalog refs and **validates
that every record covers its full line with no gaps and no overlaps**, failing
the build otherwise. This makes the SIGCB-style bug impossible to ship.

## Consequences

- Records are verbose (every field listed) but self-contained and verifiable.
- Migration from the legacy overlays is a one-shot assembly step (bank fields
  win on position; overlapping/redefined generic fields are dropped), after
  which the assembled records are the source of truth.
- Legacy data bugs are fixed at migration time and noted in commit messages.
