# @cnab/core

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
