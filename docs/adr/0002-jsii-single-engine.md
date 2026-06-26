# ADR 0002 — Author the engine once in jsii-compatible TypeScript

- Status: Accepted (locked)
- Date: 2026-06

## Context

We must serve Node, .NET, Python and Java consumers. Hand-porting the engine to
each language is exactly the drift problem ADR 0001 set out to kill.

## Decision

Author the engine **once** in TypeScript, constrained to be **jsii-compatible**,
and publish to Node/.NET/Python/Java via [jsii](https://github.com/aws/jsii) +
jsii-pacmak. `packages/core` is the jsii assembly.

To keep the public API jsii-safe, the boundary uses **only**:

- `enum`s for closed sets (e.g. `FieldType`).
- **struct interfaces** (props-only `readonly` interfaces) for data shapes.
- **maps** (`{[key: string]: string}`) for dynamic key/value returns.
- primitives and arrays of the above.

And explicitly **avoids**:

- union / intersection types at the boundary,
- method overloads,
- tuples (so positions are exposed as `start`/`end` numbers, not `[number, number]`).

## Consequences

- `parse` returns `{[name: string]: string}` (raw string values) rather than a
  heterogeneous typed map — uniform map value type is a jsii requirement.
- Internally we may use richer TS; the constraint is only at the public surface.
- A CI job runs `jsii` to fail the build if the API stops being multi-language
  compatible. We do **not** publish from CI.
