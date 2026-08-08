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
  assert.strictEqual(spec.lookupCode('cnab400/104/retorno/codigo_ocorrencia', '77'), '');
});

test('getCodeTable throws for a missing table key', () => {
  assert.throws(
    () => spec.getCodeTable('cnab400/999/retorno/nope'),
    /code table not found: cnab400\/999\/retorno\/nope/
  );
});

// Tables migrated from the legacy cnab_yaml/cnab-json repos, whose YAML used
// integer keys — the build's String(k) coercion leaves them unpadded ("2").
// lookupCode() normalizes, so they resolve; new tables must not add to the set.
const LEGACY_UNPADDED_TABLES = new Set([
  'cnab400/001/retorno/codigo_ocorrencia',
  'cnab400/104/retorno/codigo_ocorrencia',
  'cnab400/237/retorno/codigo_ocorrencia',
  'cnab400/341/retorno/codigo_ocorrencia',
]);

test('every non-legacy code table uses zero-padded string keys', () => {
  for (const key of spec.codeTableKeys()) {
    if (LEGACY_UNPADDED_TABLES.has(key)) continue;
    for (const code of Object.keys(spec.getCodeTable(key))) {
      assert.match(
        code,
        /^\d{2,}$/,
        `${key}: code "${code}" is not a zero-padded numeric string ` +
          `(unquoted YAML like 02 parses as the integer 2 and loses the zero)`
      );
    }
  }
});

// The cheapest way to get an occurrence table wrong is to paste another bank's
// in. Two banks agreeing on every code AND every wording does not happen.
test('no two code tables are identical', () => {
  const seen = new Map(); // fingerprint -> key
  for (const key of spec.codeTableKeys()) {
    const fingerprint = JSON.stringify(spec.getCodeTable(key));
    const twin = seen.get(fingerprint);
    assert.strictEqual(
      twin,
      undefined,
      `${key} is byte-identical to ${twin} — one was copied from the other`
    );
    seen.set(fingerprint, key);
  }
});

// CNAB240 reports occurrences in segmento T with its own code set; the CNAB400
// occurrence codes do not transfer between layouts for the same bank.
test('a bank\'s CNAB240 and CNAB400 occurrence tables differ', () => {
  for (const key of spec.codeTableKeys()) {
    const match = /^cnab240\/(\d{3})\/(?:\w+\/)*retorno\/codigo_movimento$/.exec(key);
    if (!match) continue;
    const counterpart = `cnab400/${match[1]}/retorno/codigo_ocorrencia`;
    if (!spec.hasCodeTable(counterpart)) continue;
    assert.notDeepStrictEqual(
      spec.getCodeTable(key),
      spec.getCodeTable(counterpart),
      `${key} matches ${counterpart} — the CNAB400 table was reused for CNAB240`
    );
  }
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
