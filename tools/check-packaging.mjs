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
    (withPack ? ' (tarball contents verified)' : ' (declarations only; use --pack for tarballs)')
);
