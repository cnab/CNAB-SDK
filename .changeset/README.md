# Changesets

This directory is **required** — `changesets/action` in
`.github/workflows/release.yml` fails the release job outright with
"There is no .changeset directory in this project" if it is missing, which is
exactly how it broke once already. Do not delete it, and make sure `git add`
picks it up (it is a dotfile directory; a plain `git add` on named paths misses
it easily).

`config.json` keeps all three packages `fixed`, i.e. in lockstep: `@cnab/core`'s
version is what jsii projects to PyPI/Maven/NuGet and `@cnab/cli` pins its
siblings by exact version, so skew is not worth the flexibility.

See the "Releasing" section of `AGENTS.md` for the workflow.
