---
"@cnab/core": minor
"@cnab/spec": minor
"@cnab/cli": minor
---

0.3.0 — supersedes the withdrawn 0.2.0.

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
