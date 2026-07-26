# @cnab/spec

## 0.3.0

### Minor Changes

- b31e424: 0.3.0 — supersedes the withdrawn 0.2.0.

  **Do not use `v0.2.0`.** Its GitHub Release was tagged on a commit whose
  manifests still said `0.1.0`, so every artifact attached to it is a `0.1.0`
  build: it does not contain the breaking `setDecimal`/`setDateIso` change or the
  per-language test suites that its notes describe. The release-gate bug that
  produced it is fixed here, so 0.3.0 is the first release that actually carries
  those changes.

  Everything listed under 0.2.0 is included in 0.3.0, including the breaking
  change to the typed-value setters:

  ```diff
  - record.setDecimal(values, 'valor_titulo', '1500.00');
  + values = record.setDecimal(values, 'valor_titulo', '1500.00');
  ```

  Also in 0.3.0: the documentation site moved to cnab.github.io, and the release
  pipeline gained guards for the gate ordering and lockfile drift.

## 0.2.0

### Minor Changes

- 2dded41: **BREAKING: `CnabRecord.setDecimal` and `setDateIso` now return the updated map
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

## 0.1.0

### Minor Changes

- First versioned release: 0.1.0.

  Establishes the versioning baseline for the whole SDK. All three packages move in
  lockstep — `@cnab/core`'s version is what jsii projects to PyPI/Maven/NuGet, and
  `@cnab/cli` pins its siblings by exact version, so version skew across four
  registries is not worth the flexibility.

  Deliberately 0.x: the jsii assembly is `stability: experimental`, `toLine`
  recently became strict, and catalog field names may still move as the ADR 0008
  picture-size cleanup lands.
