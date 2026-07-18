'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CnabSpec } = require('../lib/index.js');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);
const spec = CnabSpec.fromJson(specJson);

test('codeTableKeys lists the legacy and FEBRABAN reference tables', () => {
  const keys = spec.codeTableKeys();
  const expected = [
    'cnab400/001/retorno/codigo_ocorrencia',
    'cnab400/104/retorno/codigo_ocorrencia',
    'cnab400/237/retorno/codigo_ocorrencia',
    'cnab400/341/retorno/codigo_ocorrencia',
    'cnab240/generic/especie_titulo',
    'cnab240/generic/codigo_movimento_remessa',
  ];
  for (const key of expected) {
    assert.ok(keys.includes(key), `missing code table key: ${key}`);
    assert.ok(spec.hasCodeTable(key), `hasCodeTable false for: ${key}`);
  }
});

test('getCodeTable returns a non-empty code -> description map', () => {
  const table = spec.getCodeTable('cnab400/341/retorno/codigo_ocorrencia');
  assert.ok(Object.keys(table).length > 0);
  for (const [code, description] of Object.entries(table)) {
    assert.strictEqual(typeof code, 'string');
    assert.strictEqual(typeof description, 'string');
  }
});

test('lookupCode normalizes leading zeros against legacy unpadded keys', () => {
  const key = 'cnab400/104/retorno/codigo_ocorrencia';
  // legacy table stores "2"; CNAB fields carry "02"
  assert.strictEqual(spec.lookupCode(key, '2'), 'Baixa Confirmada');
  assert.strictEqual(spec.lookupCode(key, '02'), 'Baixa Confirmada');
});

test('lookupCode returns empty string for an unknown code', () => {
  assert.strictEqual(
    spec.lookupCode('cnab400/104/retorno/codigo_ocorrencia', '77'),
    ''
  );
});

test('getCodeTable throws for a missing table key', () => {
  assert.throws(
    () => spec.getCodeTable('cnab400/999/retorno/nope'),
    /code table not found: cnab400\/999\/retorno\/nope/
  );
});

test('especie_titulo has the 23 FEBRABAN entries', () => {
  const table = spec.getCodeTable('cnab240/generic/especie_titulo');
  assert.strictEqual(Object.keys(table).length, 23);
  assert.strictEqual(table['02'], 'DM - Duplicata Mercantil');
  assert.strictEqual(
    spec.lookupCode('cnab240/generic/especie_titulo', '2'),
    'DM - Duplicata Mercantil'
  );
});
