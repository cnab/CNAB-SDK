---
"@cnab/core": minor
"@cnab/spec": minor
"@cnab/cli": minor
---

**BREAKING: `CnabRecord.setDecimal` and `setDateIso` now return the updated map
instead of mutating in place.**

They previously returned `void` and mutated the value map. That works in Node,
where objects are passed by reference, but jsii marshals maps **by value** — so
in Python, Java and .NET the mutation landed on a copy that was thrown away and
the caller got nothing back. Both documented helpers were inert in three of the
four languages the SDK ships, and all 185 Node tests passed the whole time.

```diff
- record.setDecimal(values, 'valor_titulo', '1500.00');   // Node-only
+ values = record.setDecimal(values, 'valor_titulo', '1500.00');
```

The input map is no longer modified. Adds per-language unit suites under
`bindings/` (pytest, JUnit 5, xUnit) that run against the generated artifacts,
which is the only way this class of projection bug is visible.
