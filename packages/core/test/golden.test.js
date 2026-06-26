'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CnabSpec, CnabRecord, FieldType } = require('../lib/index.js');
const { cases, safeKey } = require('./cases.cjs');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);
const spec = CnabSpec.fromJson(specJson);
const goldenDir = path.resolve(__dirname, 'golden');

test('spec.json exposes the expected record keys', () => {
  for (const c of cases) {
    assert.ok(spec.hasRecord(c.key), `missing record ${c.key}`);
  }
  assert.ok(spec.recordKeys().length >= 50);
});

for (const c of cases) {
  test(`golden: ${c.key}`, () => {
    const rec = spec.getRecord(c.key);
    const goldenPath = path.join(goldenDir, safeKey(c.key) + '.line');
    const golden = fs.readFileSync(goldenPath, 'utf8');

    // 1. engine reproduces the committed golden line from the inputs
    assert.strictEqual(rec.toLine(c.values), golden, 'toLine drifted from golden');

    // 2. line length matches the layout
    assert.strictEqual(golden.length, rec.spec.lineLength, 'wrong line length');

    // 3. round-trip: parse then rebuild is identity
    const parsed = rec.parse(golden);
    assert.strictEqual(rec.toLine(parsed), golden, 'parse/toLine not invertible');

    // 4. independent position checks (1-based inclusive ranges)
    for (const [range, expected] of Object.entries(c.checks.substr || {})) {
      const [s, e] = range.split('-').map(Number);
      assert.strictEqual(
        golden.substring(s - 1, e),
        expected,
        `positions ${range} expected "${expected}"`
      );
    }

    // 5. parsed field expectations
    for (const [name, expected] of Object.entries(c.checks.parsed || {})) {
      assert.strictEqual(parsed[name], expected, `parsed.${name}`);
    }
  });
}

test('CnabRecord.fromJson + validate flags a bad numeric field', () => {
  const rec = spec.getRecord('cnab240/104/sigcb/header_arquivo');
  const good = rec.toLine({ codigo_banco: '104' });
  assert.strictEqual(rec.validate(good).valid, true);

  // corrupt the numeric codigo_banco (positions 1-3) with letters
  const bad = 'ABC' + good.substring(3);
  const res = rec.validate(bad);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('codigo_banco')));
});

test('validate flags wrong line length', () => {
  const rec = spec.getRecord('cnab400/341/retorno/trailer_arquivo');
  const res = rec.validate('123');
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('line length')));
});

test('FieldType enum is exported', () => {
  assert.strictEqual(FieldType.NUM, 'num');
  assert.strictEqual(FieldType.ALPHA, 'alpha');
  assert.strictEqual(FieldType.NUM_DECIMAL, 'num_decimal');
});
