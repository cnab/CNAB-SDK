'use strict';
// Regenerate the golden line files from the current spec + engine.
// Run after an intentional spec/engine change:  node test/generate-golden.cjs
const fs = require('node:fs');
const path = require('node:path');
const { CnabSpec } = require('../lib/index.js');
const { cases, safeKey } = require('./cases.cjs');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);
const spec = CnabSpec.fromJson(specJson);
const goldenDir = path.resolve(__dirname, 'golden');
fs.mkdirSync(goldenDir, { recursive: true });

for (const c of cases) {
  const rec = spec.getRecord(c.key);
  const line = rec.toLine(c.values);
  fs.writeFileSync(path.join(goldenDir, safeKey(c.key) + '.line'), line);
  console.log(`wrote golden ${c.key} (len ${line.length})`);
}
