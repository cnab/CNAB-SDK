#!/usr/bin/env node
// check-docs-claims.mjs — the prose must agree with the compiled spec.
//
// This exists because the same bug has now happened three times, in three
// different files, and every time it was caught by a human reading rather than
// by anything automatic:
//
//   * the docs site advertised v0.1.0 two releases late, was corrected to
//     v0.3.0, and was stale again one release after that;
//   * docs/REFORMULATION.md claimed 54 records / 4 code tables / 297 catalog
//     fields when the real numbers were 55 / 6 / 277 — three wrong figures in
//     the one paragraph whose entire job is stating coverage;
//   * README.md claimed 215/47/35/39 unit tests, numbers that predated the PIX
//     work entirely.
//
// Generated artifacts do not drift. Prose does, silently, and a wrong coverage
// claim is the kind of thing a reader plans a project around. So the figures
// that CAN be derived from packages/spec/dist/spec.json are asserted here, and
// `npm test` runs it.
//
// Scope, deliberately: only claims that are mechanically checkable against the
// compiled spec. Per-language unit-test counts are NOT checked — they would
// need every binding suite to have run — so those stay manual and are called
// out as such in the report below.
//
// Run: node tools/check-docs-claims.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'packages/spec/dist/spec.json');

if (!fs.existsSync(SPEC)) {
  console.error(
    `check-docs-claims: ${SPEC} not found — run \`npm run build:spec\` first`
  );
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));

// --- ground truth, derived --------------------------------------------------

const records = Object.keys(spec.records);
const codeTables = Object.keys(spec.codeTables ?? {});
const banks = new Set();
let bankSpecific = 0;
let generic = 0;
for (const r of Object.values(spec.records)) {
  const bank = r.meta?.bank;
  if (bank && bank !== 'generic') {
    banks.add(bank);
    bankSpecific += 1;
  } else {
    generic += 1;
  }
}
const truth = {
  records: records.length,
  codeTables: codeTables.length,
  banks: banks.size,
  bankSpecific,
  generic,
};

// The catalog is the authority for field count, not the union of used names.
const catalogPath = path.join(ROOT, 'packages/spec/fields/catalog.yml');
if (fs.existsSync(catalogPath)) {
  const text = fs.readFileSync(catalogPath, 'utf8');
  // Top-level YAML keys: a name at column 0 followed by a colon.
  truth.catalog = (text.match(/^[a-z0-9_]+:/gm) ?? []).length;
}

// --- what the prose claims --------------------------------------------------

/**
 * Each claim is a regex with one capturing group holding a number, plus the
 * ground-truth key it must equal. A claim whose pattern no longer matches is
 * reported too: silently checking nothing is how a guard rots into decoration.
 */
const CLAIMS = [
  ['README.md', /\*\*(\d+) banks\*\*/, 'banks'],
  ['README.md', /\*\*(\d+) records\*\*/, 'records'],
  ['README.md', /\((\d+) bank-specific/, 'bankSpecific'],
  ['README.md', /bank-specific \+ (\d+) generic/, 'generic'],
  ['README.md', /\*\*(\d+) code tables\*\*/, 'codeTables'],
  ['README.md', /\*\*(\d+) catalog fields\*\*/, 'catalog'],
  ['docs/REFORMULATION.md', /^(\d+) full standalone records/m, 'records'],
  ['docs/REFORMULATION.md', /records \+ (\d+) code tables/, 'codeTables'],
  ['docs/REFORMULATION.md', /driven by a (\d+)-field catalog/, 'catalog'],
];

const problems = [];
let checked = 0;

for (const [file, pattern, key] of CLAIMS) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    problems.push(`${file}: not found, but a claim is registered against it`);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  const m = text.match(pattern);
  if (!m) {
    problems.push(
      `${file}: no text matched ${pattern} (expected a "${key}" claim). ` +
        `Either the wording changed — update this pattern — or the claim was ` +
        `dropped. An unmatched pattern checks nothing.`
    );
    continue;
  }
  checked += 1;
  const claimed = Number(m[1]);
  if (claimed !== truth[key]) {
    problems.push(
      `${file}: claims ${claimed} for "${key}", but the compiled spec says ` +
        `${truth[key]} — ${JSON.stringify(m[0])}`
    );
  }
}

if (problems.length) {
  console.error('check-docs-claims FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\n  Ground truth: ' +
      Object.entries(truth)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
  );
  process.exit(1);
}

console.log(
  `check-docs-claims: OK — ${checked} spec-derived claims agree ` +
    `(${truth.records} records, ${truth.codeTables} code tables, ` +
    `${truth.banks} banks, ${truth.catalog} catalog fields). ` +
    `Per-language test counts are NOT checked here.`
);
