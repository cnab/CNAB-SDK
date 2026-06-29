# ADR 0005 — Build & jsii toolchain conventions

- Status: Accepted
- Date: 2026-06

## Context

`packages/core` must compile both as ordinary TypeScript (fast local tests
without heavy deps) and as a **jsii** assembly (the multi-language contract per
[ADR 0002](0002-jsii-single-engine.md)). jsii bundles its own TypeScript, which
differs in version from a locally installed `typescript`, and jsii imposes
naming rules that ordinary `tsc` does not. These mismatches caused real build
failures during the initial implementation, so the working configuration is
recorded here.

## Decision

1. **Two compilers, one source.** `npm run build`/`test` uses local `tsc`
   (devDependency `typescript`) emitting CommonJS to `lib/` for `node --test`.
   `jsii` is run separately (`npx jsii` in CI, see [ADR 0001 CI]) to produce the
   `.jsii` assembly. `jsii` is **not** a runtime/dev dependency of the package;
   CI invokes it via `npx -y jsii@^6`.
2. **tsconfig uses `node16`.** `packages/core/tsconfig.json` sets
   `module: "node16"` and `moduleResolution: "node16"`. This avoids the
   deprecated `module: commonjs` + `moduleResolution: node` combo, whose
   `ignoreDeprecations` value (`"5.0"` vs `"6.0"`) differs between the local TS
   and jsii's bundled TS and cannot satisfy both at once.
3. **jsii-imposed names are honored in the public API:**
   - no public member named `build` → the builder method is `toLine`;
   - no public property named `type` (Go reserved word) → it is `fieldType`.
4. **CI runs `jsii` with** `--validate-tsconfig minimal --no-fix-peer-dependencies`
   and uploads the `.jsii` assembly with `include-hidden-files: true` (it is a
   dotfile; `upload-artifact@v4` skips hidden files by default).
5. **Packaging** (`jsii-pacmak`) and publishing are deferred to issues #13/#14
   and are **not** part of the test pipeline.

## Consequences

- Local test loop stays lightweight (no jsii install needed to run `npm test`).
- The public API is continuously checked for multi-language compatibility in CI.
- Contributors must re-run `jsii` after any public-API change and respect the
  reserved-name rules; these are documented in [`../../AGENTS.md`](../../AGENTS.md).
- If jsii's bundled TypeScript major version changes, revisit the `node16`
  setting.
