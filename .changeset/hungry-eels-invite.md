---
'@cnab/core': patch
---

Add `go` to the jsii targets (`github.com/cnab/cnab-core-go`, package
`cnabcore`), so the published assembly declares a Go projection alongside
Python, Java and .NET.

**No public API changed.** The API snapshot in
`packages/core/test/api-surface.json` is byte-identical and no member was
renamed: jsii's JSII5018 reserved-word check already unions the Go keyword list
regardless of configured targets, which is why `type` became `fieldType` long
before Go was a target. Adding the target produced zero new jsii warnings.

The Go module is **not distributed yet** — creating `cnab/cnab-core-go` and
wiring the release push are issue #41 steps 2-3. Until then the SDK is still
Node/Python/Java/.NET. The distribution decision is recorded as
[ADR 0009](https://github.com/cnab/CNAB-SDK/blob/main/docs/adrs/0009-go-module-distribution.md)
with status Proposed.
