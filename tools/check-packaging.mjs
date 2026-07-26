#!/usr/bin/env node
// check-packaging.mjs — guard against publishing broken packages.
//
// Both workspace packages once would have published EMPTY of their `main`
// entry point: `lib/` and `dist/` are gitignored, and npm falls back to
// .gitignore when there is no .npmignore, so the compiled output silently
// vanished from the tarball. `.jsii` had the same problem for a different
// reason (it was listed in `files` but `prepack` never built it).
//
// Two modes:
//   (default)  fast, declarative — every package declares what it must.
//              Runs as part of `npm test`.
//   --pack     slow, authoritative — actually runs `npm pack --dry-run` and
//              inspects the real file list (triggers prepack). Runs in CI.
//
// Exits non-zero with an explicit list of problems.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withPack = process.argv.includes('--pack');
const problems = [];

/** What each published package must declare, and must actually ship. */
const EXPECTED = {
  '@cnab/core': {
    dir: 'packages/core',
    // `main`/`types` point into lib/, and jsii consumers need the assembly.
    mustShip: ['lib/index.js', 'lib/index.d.ts', '.jsii'],
    mustDeclareFiles: ['lib', '.jsii'],
    // plain `tsc` does NOT emit .jsii — prepack must build the assembly
    prepackMustMatch: /jsii/,
  },
  '@cnab/spec': {
    dir: 'packages/spec',
    mustShip: ['dist/spec.json', 'fields/catalog.yml'],
    mustDeclareFiles: ['dist'],
    prepackMustMatch: /build-spec/,
  },
  '@cnab/cli': {
    dir: 'packages/cli',
    mustShip: ['bin/cnab.mjs'],
    mustDeclareFiles: ['bin'],
    // the CLI ships only source; its artifacts come from its dependencies
    prepackMustMatch: null,
  },
};

function readPkg(dir) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'));
}

// --- declarative checks ----------------------------------------------------

for (const [name, spec] of Object.entries(EXPECTED)) {
  const pkg = readPkg(spec.dir);
  const files = pkg.files || [];

  if (files.length === 0) {
    problems.push(
      `${name}: no "files" allowlist — npm falls back to .gitignore and would ` +
        `omit build output from the tarball`
    );
  }
  for (const entry of spec.mustDeclareFiles) {
    if (!files.includes(entry)) {
      problems.push(`${name}: "files" must include ${JSON.stringify(entry)}`);
    }
  }
  if (spec.prepackMustMatch) {
    const prepack = (pkg.scripts || {}).prepack;
    if (!prepack) {
      problems.push(
        `${name}: missing "prepack" — its entry point is generated and would be ` +
          `absent when publishing from a clean checkout`
      );
    } else if (!spec.prepackMustMatch.test(prepack)) {
      problems.push(
        `${name}: "prepack" is ${JSON.stringify(prepack)} but must run ` +
          `${spec.prepackMustMatch} to produce everything "files" promises`
      );
    }
  }
  if (!pkg.engines || !pkg.engines.node) {
    problems.push(`${name}: missing "engines.node"`);
  }
  // `main` must be inside something the allowlist ships
  if (pkg.main && !files.some((f) => pkg.main.startsWith(f.replace(/\/$/, '')))) {
    problems.push(`${name}: "main" (${pkg.main}) is not covered by "files"`);
  }
}

const rootPkg = readPkg('.');
if (!rootPkg.engines || !rootPkg.engines.node) {
  problems.push('root: missing "engines.node"');
}

// --- release wiring -------------------------------------------------------
//
// This whole block exists because of one incident. `.changeset/` is a DOTFILE
// directory, so a `git add` on named paths skipped it: the "adopt Changesets"
// commit landed release.yml, AGENTS.md and CHANGELOG.md but neither the config
// nor the version bumps. Every check was green -- packaging never looked at
// versions -- and the breakage only surfaced as a red release job on main,
// after the merge. These three checks would each have caught it pre-merge.

const releaseWorkflow = '.github/workflows/release.yml';
if (fs.existsSync(path.join(ROOT, releaseWorkflow))) {
  if (!fs.existsSync(path.join(ROOT, '.changeset/config.json'))) {
    problems.push(
      `${releaseWorkflow} exists but .changeset/config.json does not — the ` +
        `release job fails with "There is no .changeset directory in this project"`
    );
  }
  const devDeps = rootPkg.devDependencies || {};
  if (!devDeps['@changesets/cli']) {
    problems.push(
      'root: missing "@changesets/cli" devDependency, but the release workflow ' +
        'runs `changeset version`'
    );
  }
}

// Versions move in lockstep (`fixed` in .changeset/config.json), and @cnab/cli
// pins its siblings by EXACT version. A stale pin is how the packages sat at
// "0.0.0" pinning "0.0.0" and no release was possible.
const versions = Object.fromEntries(
  Object.entries(EXPECTED).map(([name, spec]) => [name, readPkg(spec.dir).version])
);
const distinct = [...new Set(Object.values(versions))];
if (distinct.length > 1) {
  problems.push(
    `versions are not in lockstep: ${Object.entries(versions)
      .map(([n, v]) => `${n}@${v}`)
      .join(', ')}`
  );
}
const cliPkg = readPkg(EXPECTED['@cnab/cli'].dir);
for (const [dep, pinned] of Object.entries(cliPkg.dependencies || {})) {
  if (dep in versions && pinned !== versions[dep]) {
    problems.push(
      `@cnab/cli pins ${dep}@${pinned} but ${dep} is at ${versions[dep]} — ` +
        `the published CLI would resolve a version that does not exist`
    );
  }
}

// `changeset version` rewrites package.json but NOT package-lock.json, and the
// version PR it opens gets no CI (pushes made with GITHUB_TOKEN do not trigger
// workflows), so the drift reaches main unnoticed: 0.2.0 landed with a lockfile
// still saying 0.1.0. `npm ci` tolerates it — workspace packages are resolved
// from disk — so nothing failed; the lockfile was just quietly wrong, and every
// later `npm install` produced phantom diff noise. Run `npm install` to fix.
const lockPath = path.join(ROOT, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  for (const [name, spec] of Object.entries(EXPECTED)) {
    const entry = (lock.packages || {})[spec.dir];
    if (!entry) {
      problems.push(`package-lock.json has no entry for ${spec.dir}`);
      continue;
    }
    if (entry.version !== versions[name]) {
      problems.push(
        `package-lock.json says ${spec.dir} is ${entry.version} but package.json ` +
          `says ${versions[name]} — run \`npm install\` and commit the lockfile`
      );
    }
  }
}

// --- authoritative check (CI) ----------------------------------------------

if (withPack) {
  for (const [name, spec] of Object.entries(EXPECTED)) {
    let listed;
    try {
      const raw = execFileSync(
        'npm',
        ['pack', '--dry-run', '--json', '--workspace', name],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
      );
      // `prepack` (tsc/jsii/build-spec) writes to stdout too, so the JSON
      // payload is not the whole output — take it from the first line that
      // starts an array.
      const start = raw.search(/^\[/m);
      if (start === -1) {
        throw new Error(`no JSON array in npm pack output:\n${raw.slice(0, 400)}`);
      }
      listed = JSON.parse(raw.slice(start))[0].files.map((f) => f.path);
    } catch (e) {
      problems.push(`${name}: npm pack --dry-run failed: ${e.message}`);
      continue;
    }
    for (const required of spec.mustShip) {
      if (!listed.includes(required)) {
        problems.push(
          `${name}: tarball is MISSING ${required} — published package would be broken. ` +
            `Shipped: ${listed.slice(0, 12).join(', ')}${listed.length > 12 ? ', …' : ''}`
        );
      }
    }
    console.log(`check-packaging: ${name} ships ${listed.length} files ✓`);
  }
}

if (problems.length) {
  console.error('check-packaging FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `check-packaging: OK — ${Object.keys(EXPECTED).length} packages` +
    (withPack
      ? ' (tarball contents verified)'
      : ' (declarations only; use --pack for tarballs)')
);
