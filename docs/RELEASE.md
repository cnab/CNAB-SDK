# Release credentials

What has to exist before anything can be published, and under exactly which
names. Issue [#35](https://github.com/cnab/CNAB-SDK/issues/35).

> This file currently covers **credentials only**. The full release runbook —
> ordering, verification matrix, rollback — is
> [#42](https://github.com/cnab/CNAB-SDK/issues/42) and belongs in this same
> file when it lands.

Nothing here is configured by the repository. GitHub Environments, their
reviewers and their secrets are created in **Settings → Environments** by a
repo admin; the workflows only consume them.

## Environments and secrets

Five environments, one per publishing target. Names are exact — the workflows
reference them literally.

**This project uses OIDC wherever the registry supports it.** npm, PyPI and
NuGet therefore store **no secret at all** — they trust a workflow identity
instead. That leaves five secrets in total, and every one of them belongs to
the two targets that have no OIDC path.

| Environment | Secret / variable | Kind | Notes |
| --- | --- | --- | --- |
| `npm` | — | OIDC | Nothing to store. |
| `pypi` | — | OIDC | Nothing to store. |
| `nuget` | `NUGET_USER` | **variable** | The nuget.org username owning the Trusted Publishing policy. Not sensitive — set it under *Variables*, not *Secrets*. |
| `maven-central` | `CENTRAL_TOKEN_USERNAME` | secret | Central Portal user token — *not* your login. |
| `maven-central` | `CENTRAL_TOKEN_PASSWORD` | secret | The other half of the same token pair. |
| `maven-central` | `MAVEN_GPG_PRIVATE_KEY` | secret | ASCII-armoured private key. Central rejects unsigned artifacts. |
| `maven-central` | `MAVEN_GPG_PASSPHRASE` | secret | Passphrase for the above. |
| `go-module` | `GO_MODULE_PUSH_TOKEN` | secret | Write access to `cnab/cnab-core-go`. |

**Maven Central has no OIDC support**, which is why it holds four of the five.
The Go push has none either — there is no OIDC path for pushing git to another
repository.

### Why `go-module` needs a token when Go has no account

Go has no registry. `go get github.com/cnab/cnab-core-go/cnabcore@vX.Y.Z`
fetches the VCS repository directly, so **that repository is the distribution
channel**. Publishing means pushing generated code and a tag to a *different*
repo, and `GITHUB_TOKEN` is scoped to this one — hence a separate credential.
A fine-grained PAT with `contents: write` on `cnab/cnab-core-go` only, or a
deploy key on that repo, is enough. See
[ADR 0009](adrs/0009-go-module-distribution.md) and
[#41](https://github.com/cnab/CNAB-SDK/issues/41).

## Trusted Publishing: what each registry asks for

OIDC means the registry trusts a *workflow identity* rather than a stored
secret. Each registry's form wants the same four things:

| Field | Value |
| --- | --- |
| Owner / organisation | `cnab` |
| Repository | `CNAB-SDK` |
| Workflow filename | the file that runs the publish — see the warning below |
| Environment | `npm`, `pypi` or `nuget` |

> **The workflow filename is part of the trust, and this bites.**
> A trusted publisher authorises *one* workflow file. `publish-auth-check.yml`
> is a different file from whatever eventually publishes, so it will be
> **rejected** unless you register it too. Either add a second trusted
> publisher for `publish-auth-check.yml`, or accept that the OIDC path is first
> exercised for real at the first publish. The auth-check job says which case
> it is rather than guessing.

## Verifying before you publish

```
Actions → "Publish auth check (never publishes)" → Run workflow
```

One job per environment. It uploads nothing. Running it also proves the
environment exists, that its reviewers approve, and that its branch/tag
restrictions permit the job — none of which is visible from the workflow file.

**The checks are not equally strong, and each job prints which it ran:**

| Target | Strength | What it actually proves |
| --- | --- | --- |
| `pypi` | **REAL AUTH** | PyPI accepted the OIDC identity and minted a scoped token. Nothing uploaded. |
| `nuget` | **REAL AUTH** | nuget.org accepted the identity and issued a short-lived key. Nothing uploaded. |
| `maven-central` | **REAL** | The GPG key imports and signs; the Portal token is not rejected. |
| `go-module` | **REAL AUTH** | The token can reach `cnab/cnab-core-go`. Read only — push cannot be proven without pushing. |
| `npm` | **WEAK** | Only that this workflow can mint an OIDC token. See below. |

**npm is the one gap, and going OIDC-only is what exposes it.** PyPI and
NuGet both offer a token-exchange endpoint that validates the trust
configuration without uploading — those were verified to exist and to be
auth-gated. npm performs its exchange *inside* `npm publish` and offers no
equivalent; both plausible paths under `/-/npm/v1/oidc/` return
`ResourceNotFound`. So whether npmjs.com accepts our identity is first
discovered at publish time.

That is a real risk, not a formality: **publish a prerelease to npm first.**
The job prints the `sub` claim it would present, so you can check it against
the Trusted Publisher you registered.

## Every registry here is effectively write-once

- npm, PyPI and NuGet refuse a re-upload of the same version.
- Maven Central is immutable per coordinate.
- `proxy.golang.org` is **append-only** — a published module path or version
  can never be withdrawn or repointed.

So the first publish to each target should be a **prerelease version**, not
`v1.0.0`. A failed publish is recoverable; a wrong one mostly is not. This is
not hypothetical for this project: `v0.2.0` was tagged on a tree whose
manifests said `0.1.0`, and every attached artifact is named `0.1.0`.

## Before the first Maven publish, settle the groupId

`packages/core/package.json` declares `org.cnab:cnab-core`. Central requires
proof of control over the namespace, and for `org.cnab` that means a DNS TXT
record on **`cnab.org`**. If that domain is not yours, the namespace will not
be approved and the alternative is **`io.github.cnab`**, verified through the
GitHub organisation you already own.

Both are unclaimed today. Decide before the first publish — Central is
immutable per coordinate, so changing groupId afterwards means abandoning the
old one and republishing everything.
