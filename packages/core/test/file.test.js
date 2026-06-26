'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CnabSpec, CnabFile } = require('../lib/index.js');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);
const spec = CnabSpec.fromJson(specJson);

function buildFile(keys, valuesByIndex) {
  return keys
    .map((k, i) => spec.getRecord(k).toLine((valuesByIndex && valuesByIndex[i]) || {}))
    .join('\n');
}

test('parses a whole Caixa 104 SIGCB remessa file (record detection)', () => {
  const keys = [
    'cnab240/104/sigcb/header_arquivo',
    'cnab240/104/sigcb/header_lote',
    'cnab240/104/sigcb/remessa/detalhe_segmento_p',
    'cnab240/104/sigcb/remessa/detalhe_segmento_r',
    'cnab240/104/sigcb/trailer_lote',
  ];
  const content = buildFile(keys, { 0: { codigo_banco: '104' } });
  const file = CnabFile.forBank(specJson, 'cnab240', '104', 'sigcb', 'remessa');
  const parsed = file.parse(content);

  assert.strictEqual(parsed.length, keys.length);
  assert.deepStrictEqual(parsed.map((p) => p.recordKey), keys);
  // segment lines carry their segment code
  assert.strictEqual(parsed[2].segment, 'P');
  assert.strictEqual(parsed[3].segment, 'R');
  // fields were actually parsed
  assert.strictEqual(parsed[0].fields.codigo_banco, '104');
});

test('parses a whole Itaú 341 CNAB400 retorno file', () => {
  const keys = [
    'cnab400/341/retorno/header_arquivo',
    'cnab400/341/retorno/detalhe',
    'cnab400/341/retorno/trailer_arquivo',
  ];
  const content = buildFile(keys);
  const file = CnabFile.forBank(specJson, 'cnab400', '341', '', 'retorno');
  const parsed = file.parse(content);

  assert.strictEqual(parsed.length, 3);
  assert.deepStrictEqual(parsed.map((p) => p.recordKey), keys);
  assert.strictEqual(parsed[0].tipo, '0');
  assert.strictEqual(parsed[1].tipo, '1');
  assert.strictEqual(parsed[2].tipo, '9');
});

test('unclassifiable line yields an empty recordKey', () => {
  const file = CnabFile.forBank(specJson, 'cnab240', '104', 'sigcb', 'remessa');
  const junk = 'Z'.repeat(240);
  const parsed = file.parse(junk);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].recordKey, '');
  assert.deepStrictEqual(parsed[0].fields, {});
});

test('forBank rejects an unknown layout', () => {
  assert.throws(() => CnabFile.forBank(specJson, 'cnab999', '104', '', ''), /unknown layout/);
});
