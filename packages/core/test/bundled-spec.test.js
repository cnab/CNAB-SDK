'use strict';
// The spec bundled into the engine (tools/embed-spec.mjs -> src/spec.generated.ts)
// is the ONLY way a Python / Java / .NET consumer gets any data: they install the
// jsii-generated package and have no `spec.json` on disk. These tests assert the
// embedded copy is byte-equivalent to the compiled one and that the no-spec-string
// entry points work end to end.
//
// Everything here is derived from the spec at runtime — no field name, record name
// or bank code is hardcoded — so a catalog canonicalization cannot break it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CnabSpec, CnabFile, CnabFileBuilder } = require('../lib/index.js');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);
const fromFile = CnabSpec.fromJson(specJson);

/** First scope (layout/bank/variant/direction) that has a header_arquivo. */
function firstScope(spec) {
  for (const key of spec.recordKeys()) {
    const meta = spec.getRecord(key).spec;
    if (meta.record === 'header_arquivo' && meta.bank !== '') {
      return meta;
    }
  }
  throw new Error('no header_arquivo record in the spec');
}

test('bundledJson() is the compiled spec.json, only minified', () => {
  assert.deepStrictEqual(
    JSON.parse(CnabSpec.bundledJson()),
    JSON.parse(specJson),
    'the embedded spec drifted from packages/spec/dist/spec.json — run `npm run build:spec`'
  );
});

test('bundled() exposes exactly the records and code tables of the file-loaded spec', () => {
  const bundled = CnabSpec.bundled();

  assert.strictEqual(
    bundled.recordKeys().length,
    fromFile.recordKeys().length,
    'record count differs between the bundled and the file-loaded spec'
  );
  assert.deepStrictEqual(bundled.recordKeys().sort(), fromFile.recordKeys().sort());
  assert.deepStrictEqual(bundled.codeTableKeys().sort(), fromFile.codeTableKeys().sort());
  assert.ok(bundled.recordKeys().length > 0, 'bundled spec is empty');
});

test('bundled() records are identical to the file-loaded ones', () => {
  const bundled = CnabSpec.bundled();
  for (const key of fromFile.recordKeys()) {
    assert.deepStrictEqual(
      bundled.getRecord(key).spec,
      fromFile.getRecord(key).spec,
      `record ${key} differs`
    );
  }
});

test('CnabFile.forBankBundled() parses a line end to end without any spec string', () => {
  const scope = firstScope(fromFile);
  const key = fromFile
    .recordKeys()
    .find(
      (k) =>
        fromFile.getRecord(k).spec.record === 'header_arquivo' &&
        fromFile.getRecord(k).spec.bank === scope.bank &&
        fromFile.getRecord(k).spec.variant === scope.variant
    );
  const line = fromFile.getRecord(key).toLine({});

  const file = CnabFile.forBankBundled(
    scope.layout,
    scope.bank,
    scope.variant,
    scope.direction
  );
  const parsed = file.parse(line);

  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(
    parsed[0].recordKey,
    key,
    'line was not classified as its own record'
  );

  // The parsed values round-trip back to the exact same line.
  assert.strictEqual(fromFile.getRecord(key).toLine(parsed[0].fields), line);

  // And they equal what the file-loaded parser produces.
  const viaJson = CnabFile.forBank(
    specJson,
    scope.layout,
    scope.bank,
    scope.variant,
    scope.direction
  ).parse(line);
  assert.deepStrictEqual(parsed, viaJson);
});

/**
 * First CNAB400 scope that has the whole set the builder needs
 * (header_arquivo + detalhe + trailer_arquivo). CNAB400 has no lotes, so this
 * is the shortest complete round trip.
 */
function firstBuildableScope(spec, direction) {
  const byScope = new Map();
  for (const key of spec.recordKeys()) {
    const meta = spec.getRecord(key).spec;
    if (meta.layout !== 'cnab400' || meta.bank === '') continue;
    if (meta.direction !== '' && meta.direction !== direction) continue;
    const id = `${meta.bank}/${meta.variant}`;
    if (!byScope.has(id)) byScope.set(id, { meta, records: new Set() });
    byScope.get(id).records.add(meta.record);
  }
  for (const { meta, records } of byScope.values()) {
    if (['header_arquivo', 'detalhe', 'trailer_arquivo'].every((r) => records.has(r))) {
      return meta;
    }
  }
  throw new Error(`no complete cnab400 ${direction} scope in the spec`);
}

test('CnabFileBuilder.forBankBundled() builds the same file as forBank(specJson, ...)', () => {
  const scope = firstBuildableScope(fromFile, 'remessa');
  const args = [scope.layout, scope.bank, scope.variant, 'remessa'];

  const bundled = CnabFileBuilder.forBankBundled(...args);
  const viaJson = CnabFileBuilder.forBank(specJson, ...args);
  for (const b of [bundled, viaJson]) {
    b.withHeader({});
    b.addDetail('detalhe', {});
  }
  assert.strictEqual(bundled.toFileContent({}), viaJson.toFileContent({}));
  assert.ok(bundled.toFileContent({}).length > 0);
});
