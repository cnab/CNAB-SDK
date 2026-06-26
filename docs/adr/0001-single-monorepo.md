# ADR 0001 — Single monorepo for the CNAB SDK

- Status: Accepted (locked)
- Date: 2026-06

## Context

The legacy CNAB ecosystem is fragmented across separate repositories:
`cnab_yaml` (specs as YAML), `cnab-json` (a YAML→JSON converter), language
ports (CnabPHP, cnab_python, …) and assorted consumers. Specs, parsing logic,
and language bindings drift independently; a fix in one place rarely reaches the
others.

## Decision

Consolidate into a **single monorepo** with a fixed top-level shape:

```
packages/spec    # field catalog + full standalone record YAML + compiled JSON
packages/core    # the parsing/building/validation engine (authored once)
packages/cli     # Node CLI over the compiled spec
tools/           # build-spec.mjs (compiler/validator) + migration helpers
docs/            # REFORMULATION plan, ADRs
```

npm workspaces tie the packages together; `npm test` builds the spec and runs
every package's tests.

## Consequences

- One source of truth for specs and engine; atomic cross-cutting changes.
- Language bindings are generated from one engine (see ADR 0002), not hand-ported.
- Slightly heavier root tooling; acceptable for the consistency gained.
