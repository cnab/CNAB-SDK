# ADR 0009 — Go module distribution: a separate `cnab/cnab-core-go` repo

- Status: Proposed
- Date: 2026-07
- Issue: [#41](https://github.com/cnab/CNAB-SDK/issues/41) (sub-ticket of #14)

## Context

`@cnab/core` is authored once in jsii-compatible TypeScript
([ADR 0002](0002-jsii-single-engine.md)) and projected to other languages by
`jsii-pacmak`. Python, Java and .NET have been configured targets for a while;
`go` has now been added to `packages/core/package.json` under `jsii.targets`:

```json
"go": {
  "moduleName": "github.com/cnab/cnab-core-go",
  "packageName": "cnabcore"
}
```

`jsii-pacmak --targets go` emits a complete, self-contained Go module at
`packages/core/dist/go/cnabcore/` whose `go.mod` declares

```
module github.com/cnab/cnab-core-go/cnabcore
```

That module path is not a naming preference — **it is the download URL**. This
is what makes Go different from the other four targets and what makes the
distribution question a real, hard-to-reverse decision.

### Why Go forces a decision the other languages do not

npm, PyPI, Maven Central and NuGet are **registries**: an artifact is uploaded,
and the coordinates inside the artifact (`name`, `groupId`, `packageId`) are
metadata the registry indexes. The repository layout of the project that
produced the artifact is invisible to consumers.

Go has no registry. `go get github.com/cnab/cnab-core-go/cnabcore@v0.4.0`
resolves by:

1. fetching the VCS repository at `github.com/cnab/cnab-core-go`,
2. locating the module whose `go.mod` matches the requested path — i.e. the
   `cnabcore/` **subdirectory** of that repo,
3. selecting the commit carrying the tag for that module at that version.

Two consequences follow directly:

- **The declared module path must be a real, publicly fetchable VCS path.**
  There is no way to "publish under a different name".
- **Tags are module-scoped and path-prefixed.** A module living in
  subdirectory `sub/` is versioned by tags named `sub/vX.Y.Z`, not `vX.Y.Z`.

There is also a caching consequence: `proxy.golang.org` and `sum.golang.org`
record the first `(module, version)` pair they ever see and are, by design,
**append-only**. A published path or a published version cannot be withdrawn or
repointed. Getting this wrong is not a rename — it is a permanent artifact on
the public internet.

### Constraints from this repo

- [ADR 0001](0001-single-monorepo.md) commits to a single monorepo for
  *authoring*. It says nothing about *distribution artifacts*, which already
  leave the repo as wheels, jars and nupkgs.
- Generated output is gitignored (`packages/core/dist/`, `lib/`, `.jsii`); this
  repo deliberately does not commit generated code.
- All three packages release in lockstep (`fixed` in `.changeset/config.json`)
  and the release workflow already tags `vX.Y.Z` for the monorepo.

## Decision

**Publish the Go module from a separate repository, `cnab/cnab-core-go`, into
which the release workflow pushes the pacmak-generated source together with a
matching semver tag.**

Concretely, the shape being proposed:

- `cnab/cnab-core-go` is a dedicated, **generated-only** repository. Its
  `README` states that it is produced from `cnab/CNAB-SDK` and that pull
  requests belong upstream.
- The module lives in the `cnabcore/` subdirectory, matching pacmak's
  `moduleName` + `packageName` layout, so the import path is
  `github.com/cnab/cnab-core-go/cnabcore`.
- On each release, the workflow copies `packages/core/dist/go/` into a clean
  checkout of that repo, commits, and pushes the tag `cnabcore/vX.Y.Z` — the
  path-prefixed form Go requires for a module in a subdirectory.
- The version is the same `X.Y.Z` as the npm/PyPI/Maven/NuGet artifacts, keeping
  the lockstep guarantee across all five languages.
- The push is gated behind its own approval-gated environment and a
  cross-repository token, exactly like the other registries.

This is the pattern jsii itself and the AWS CDK use (`aws/aws-cdk-go`), so it is
the path with the most prior art and the one pacmak's defaults already assume.

**This ADR is `Proposed`, not `Accepted`.** Only the `go` target has been
configured (issue #41 step 1). Neither the repository nor the release wiring
exists yet — those are steps 2 and 3, and creating the repository needs an org
admin. Move this to `Accepted` when the repo exists and the release job pushes
to it.

### Options considered

#### Option A — Separate `cnab/cnab-core-go` repo (**decided**)

The generated module gets its own repository; the release job pushes code and a
tag into it.

#### Option B — Subdirectory + tag scheme inside this monorepo

Commit the generated Go under a stable path in `cnab/CNAB-SDK` (e.g.
`go/cnabcore/`) and tag `go/cnabcore/vX.Y.Z` alongside the existing `vX.Y.Z`
release tags.

#### Option C — Do not ship Go

Keep the target configured as a compile-time projection check only, and continue
to describe the SDK as Node/Python/Java/.NET.

## Consequences

### Option A — Separate repo (decided)

- **Easier:** the import path is short and reads like a library
  (`github.com/cnab/cnab-core-go/cnabcore`) rather than exposing this repo's
  internal layout. Generated code stays out of this repo, preserving the
  "nothing generated is committed" rule and keeping `git log` here a log of
  authored change. Go tooling clones only the Go module, not a monorepo carrying
  spec YAML, goldens and four other language toolchains — `go get` stays fast.
  Module-scoped tags live in a repo that has no other tags, so there is no
  interaction with the `vX.Y.Z` release tags. It is the well-trodden jsii/CDK
  path, so pacmak's defaults, and any future consumer's expectations, already
  match.
- **Harder:** a second repository to create, own and protect, and it cannot be
  created by this workflow — it needs an org admin. Cross-repo pushes need a
  token `GITHUB_TOKEN` cannot provide (the same gap as #19 for the docs site),
  so the release job gains a secret and a failure mode that no other target has.
  The two repos can drift: a tag can exist in one and not the other, and only a
  release-time assertion will catch it. Issues filed against the generated repo
  land away from the code that causes them.
- **Accepted trade-off:** operational cost and one more secret, in exchange for
  a distribution shape that matches what Go users expect and that we will not
  have to migrate away from. Since a published module path is permanent, paying
  for the right shape once is cheaper than any later correction.

### Option B — Subdirectory + tag scheme in this monorepo

- **Easier:** no new repository, no cross-repo token, no drift — the tag and the
  code are the same commit, and release stays a single-repo operation.
- **Harder:** the import path becomes
  `github.com/cnab/CNAB-SDK/go/cnabcore`, which leaks the monorepo layout into
  every consumer's import block and is effectively frozen forever. Generated
  code must be **committed**, contradicting the existing convention and making
  every release a large mechanical diff in the authoring repo's history. Two tag
  namespaces (`vX.Y.Z` and `go/cnabcore/vX.Y.Z`) coexist on the same commits,
  which is legal but easy to get wrong and confusing in the release UI. Every
  `go get` clones the entire monorepo. Case is a live hazard: the repository is
  `CNAB-SDK`, and Go module paths are case-sensitive while the module proxy
  applies case-encoding (`!c!n!a!b`) — a workable but consistently surprising
  detail.
- **Accepted trade-off:** would trade a permanent, user-visible wart and a
  convention break for avoidable one-time setup work. Rejected.

### Option C — Do not ship Go

- **Easier:** nothing to build or operate; the target still earns its keep as a
  projection check, since Go's naming rules are the strictest of the five.
- **Harder:** the SDK's premise is one engine, every language. Leaving Go out
  means Go users reimplement CNAB parsing by hand, which is precisely the
  failure mode this project exists to prevent.
- **Accepted trade-off:** acceptable only as the interim state, which is exactly
  what it is today.

### Follow-up work

- Create `cnab/cnab-core-go` (org admin; **not** doable from CI) — #41 step 2.
- Provision the cross-repo push token/environment and wire push + tag into
  `.github/workflows/release.yml`, gated like the other registries — #41 step 3.
- Prove `go get` from a clean module cache plus a smoke program that parses a
  line — #42.
- Until all of the above lands, keep describing the SDK as targeting
  **Node/Python/Java/.NET** — not Go. The target being configured is a
  compile-time guarantee, not a shipped artifact.
- Publish the first Go version as `v0.x`. Go treats `v2+` as a *distinct module
  path* (`.../cnabcore/v2`), so the lockstep version reaching 1.0 and then 2.0
  will require a path change that the other four languages do not need. That
  belongs in its own ADR when it happens.
