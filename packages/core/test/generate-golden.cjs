'use strict';
// Regenerate the golden line files from the current spec + engine.
// Run after an intentional spec/engine change:  node test/generate-golden.cjs
const fs = require('node:fs');
const path = require('node:path');
const { CnabSpec } = require('../lib/index.js');
const { allCases, safeKey } = require('./cases.cjs');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);
const spec = CnabSpec.fromJson(specJson);
const goldenDir = path.resolve(__dirname, 'golden');
fs.mkdirSync(goldenDir, { recursive: true });

const written = new Set();
for (const c of allCases) {
  const rec = spec.getRecord(c.key);
  const line = rec.toLine(c.values);
  const file = safeKey(c.key) + '.line';
  fs.writeFileSync(path.join(goldenDir, file), line);
  written.add(file);
  console.log(`wrote golden ${c.key} (len ${line.length})${c.auto ? ' [auto]' : ''}`);
}

// Drop goldens whose record no longer exists, so the directory always mirrors
// the cases (a renamed record would otherwise leave an orphan fixture behind).
for (const file of fs.readdirSync(goldenDir)) {
  if (file.endsWith('.line') && !written.has(file)) {
    fs.unlinkSync(path.join(goldenDir, file));
    console.log(`removed stale golden ${file}`);
  }
}
