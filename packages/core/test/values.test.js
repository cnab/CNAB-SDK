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

// cnab240/104/sigcb/remessa/detalhe_segmento_p:
//   valor_titulo   num_decimal decimals=2 (86-100)
//   vencimento     num ddMMyyyy (78-85)
const segP = spec.getRecord('cnab240/104/sigcb/remessa/detalhe_segmento_p');
// cnab400/341/retorno/detalhe:
//   data_vencimento  num ddMMyy (147-152)
//   valor_titulo  num_decimal decimals=2 (153-165)
const det400 = spec.getRecord('cnab400/341/retorno/detalhe');
// cnab240/104/sigcb/header_arquivo: hora_geracao num HHmmss (152-157)
const header = spec.getRecord('cnab240/104/sigcb/header_arquivo');

// --- getDecimal ---------------------------------------------------------

test('getDecimal inserts the implied decimal separator', () => {
  assert.strictEqual(segP.getDecimal({ valor_titulo: '150000' }, 'valor_titulo'), '1500.00');
  assert.strictEqual(segP.getDecimal({ valor_titulo: '1' }, 'valor_titulo'), '0.01');
  assert.strictEqual(segP.getDecimal({ valor_titulo: '99' }, 'valor_titulo'), '0.99');
  assert.strictEqual(segP.getDecimal({ valor_titulo: '100' }, 'valor_titulo'), '1.00');
});

test('getDecimal returns 0.00 for a zero value', () => {
  assert.strictEqual(segP.getDecimal({ valor_titulo: '0' }, 'valor_titulo'), '0.00');
});

test('getDecimal handles the largest value the field can hold', () => {
  // valor_titulo is 15 digits wide with 2 implied decimals
  assert.strictEqual(
    segP.getDecimal({ valor_titulo: '999999999999999' }, 'valor_titulo'),
    '9999999999999.99'
  );
});

test('getDecimal returns decimals-0 fields unchanged', () => {
  assert.strictEqual(segP.getDecimal({ codigo_banco: '104' }, 'codigo_banco'), '104');
});

test('getDecimal throws for an unknown field name', () => {
  assert.throws(() => segP.getDecimal({}, 'nope'), /field not found: nope/);
});

test('getDecimal throws for a non-digit stored value', () => {
  assert.throws(
    () => segP.getDecimal({ valor_titulo: '15x0' }, 'valor_titulo'),
    /not a digit string/
  );
});

// --- setDecimal ---------------------------------------------------------

test('setDecimal stores the raw implied-decimal digit string', () => {
  let values = {};
  values = segP.setDecimal(values, 'valor_titulo', '1500.00');
  assert.strictEqual(values.valor_titulo, '150000');
});

test('setDecimal accepts a missing fractional part', () => {
  let values = {};
  values = segP.setDecimal(values, 'valor_titulo', '1500');
  assert.strictEqual(values.valor_titulo, '150000');
});

test('setDecimal zero-pads a short fractional part', () => {
  let values = {};
  values = segP.setDecimal(values, 'valor_titulo', '1500.5');
  assert.strictEqual(values.valor_titulo, '150050');
});

test('setDecimal normalizes zero', () => {
  let values = {};
  values = segP.setDecimal(values, 'valor_titulo', '0.00');
  assert.strictEqual(values.valor_titulo, '0');
});

test('setDecimal throws on malformed input', () => {
  assert.throws(() => segP.setDecimal({}, 'valor_titulo', 'abc'), /malformed decimal/);
  assert.throws(() => segP.setDecimal({}, 'valor_titulo', '1.2.3'), /malformed decimal/);
  assert.throws(() => segP.setDecimal({}, 'valor_titulo', '1500.'), /malformed decimal/);
  assert.throws(() => segP.setDecimal({}, 'valor_titulo', '-1.00'), /malformed decimal/);
  assert.throws(() => segP.setDecimal({}, 'valor_titulo', '1,00'), /malformed decimal/);
});

test('setDecimal throws when the fraction exceeds the field decimals', () => {
  assert.throws(
    () => segP.setDecimal({}, 'valor_titulo', '1500.123'),
    /too many fraction digits/
  );
  // decimals-0 field: any fraction digit is too many
  assert.throws(
    () => segP.setDecimal({}, 'codigo_banco', '104.5'),
    /too many fraction digits/
  );
});

test('setDecimal throws for an unknown field name', () => {
  assert.throws(() => segP.setDecimal({}, 'nope', '1.00'), /field not found: nope/);
});

// --- decimal round-trip through toLine/parse ----------------------------

test('decimal values round-trip through toLine and parse', () => {
  let values = {};
  values = segP.setDecimal(values, 'valor_titulo', '1234.56');
  const line = segP.toLine(values);
  assert.strictEqual(line.substring(85, 100), '000000000123456');
  const parsed = segP.parse(line);
  assert.strictEqual(segP.getDecimal(parsed, 'valor_titulo'), '1234.56');
});

test('cnab400 decimal values round-trip through toLine and parse', () => {
  let values = {};
  values = det400.setDecimal(values, 'valor_titulo', '0.99');
  const parsed = det400.parse(det400.toLine(values));
  assert.strictEqual(det400.getDecimal(parsed, 'valor_titulo'), '0.99');
});

// --- getDateIso ---------------------------------------------------------

test('getDateIso converts ddMMyyyy to YYYY-MM-DD', () => {
  assert.strictEqual(segP.getDateIso({ vencimento: '15072026' }, 'vencimento'), '2026-07-15');
});

test('getDateIso re-pads values whose leading zeros were normalized away', () => {
  // parse strips leading zeros from numeric fields: '05072026' -> '5072026'
  assert.strictEqual(segP.getDateIso({ vencimento: '5072026' }, 'vencimento'), '2026-07-05');
});

test('getDateIso converts ddMMyy with the 70 century pivot', () => {
  assert.strictEqual(det400.getDateIso({ data_vencimento: '150770' }, 'data_vencimento'), '1970-07-15');
  assert.strictEqual(det400.getDateIso({ data_vencimento: '150799' }, 'data_vencimento'), '1999-07-15');
  assert.strictEqual(det400.getDateIso({ data_vencimento: '150769' }, 'data_vencimento'), '2069-07-15');
  assert.strictEqual(det400.getDateIso({ data_vencimento: '150726' }, 'data_vencimento'), '2026-07-15');
  // parse-normalized ddMMyy value ('020170' -> '20170')
  assert.strictEqual(det400.getDateIso({ data_vencimento: '20170' }, 'data_vencimento'), '1970-01-02');
});

test('getDateIso converts HHmmss to HH:mm:ss', () => {
  assert.strictEqual(header.getDateIso({ hora_geracao: '103000' }, 'hora_geracao'), '10:30:00');
  assert.strictEqual(header.getDateIso({ hora_geracao: '235959' }, 'hora_geracao'), '23:59:59');
});

test('getDateIso returns empty string for all-zeros (unset) values', () => {
  assert.strictEqual(segP.getDateIso({ vencimento: '0' }, 'vencimento'), '');
  assert.strictEqual(segP.getDateIso({ vencimento: '00000000' }, 'vencimento'), '');
  assert.strictEqual(det400.getDateIso({ data_vencimento: '000000' }, 'data_vencimento'), '');
});

test('getDateIso throws for a field with no date format', () => {
  assert.throws(
    () => segP.getDateIso({ valor_titulo: '150000' }, 'valor_titulo'),
    /field has no date format: valor_titulo/
  );
});

test('getDateIso throws for an unknown field name', () => {
  assert.throws(() => segP.getDateIso({}, 'nope'), /field not found: nope/);
});

// --- setDateIso ---------------------------------------------------------

test('setDateIso stores ddMMyyyy raw tokens', () => {
  let values = {};
  values = segP.setDateIso(values, 'vencimento', '2026-07-15');
  assert.strictEqual(values.vencimento, '15072026');
});

test('setDateIso stores ddMMyy raw tokens', () => {
  let values = {};
  values = det400.setDateIso(values, 'data_vencimento', '2026-07-15');
  assert.strictEqual(values.data_vencimento, '150726');
  values = det400.setDateIso(values, 'data_vencimento', '1970-01-02');
  assert.strictEqual(values.data_vencimento, '020170');
});

test('setDateIso stores HHmmss raw tokens', () => {
  let values = {};
  values = header.setDateIso(values, 'hora_geracao', '10:30:00');
  assert.strictEqual(values.hora_geracao, '103000');
});

test('setDateIso with empty string stores the unset (all zeros) value', () => {
  let values = {};
  values = segP.setDateIso(values, 'vencimento', '');
  assert.strictEqual(segP.getDateIso(values, 'vencimento'), '');
  const line = segP.toLine(values);
  assert.strictEqual(line.substring(77, 85), '00000000');
});

test('set/get date are inverses through toLine and parse', () => {
  let values = {};
  values = segP.setDateIso(values, 'vencimento', '2026-07-05');
  const parsed = segP.parse(segP.toLine(values));
  assert.strictEqual(segP.getDateIso(parsed, 'vencimento'), '2026-07-05');

  const values400 = det400.setDateIso({}, 'data_vencimento', '1970-01-02');
  const parsed400 = det400.parse(det400.toLine(values400));
  assert.strictEqual(det400.getDateIso(parsed400, 'data_vencimento'), '1970-01-02');

  const hv = header.setDateIso({}, 'hora_geracao', '00:05:09');
  const parsedH = header.parse(header.toLine(hv));
  assert.strictEqual(header.getDateIso(parsedH, 'hora_geracao'), '00:05:09');
});

test('setDateIso throws on malformed input', () => {
  assert.throws(() => segP.setDateIso({}, 'vencimento', '2026-7-15'), /malformed ISO date/);
  assert.throws(() => segP.setDateIso({}, 'vencimento', '15/07/2026'), /malformed ISO date/);
  assert.throws(() => segP.setDateIso({}, 'vencimento', 'garbage'), /malformed ISO date/);
  assert.throws(() => segP.setDateIso({}, 'vencimento', '2026-13-01'), /invalid date/);
  assert.throws(() => segP.setDateIso({}, 'vencimento', '2026-00-10'), /invalid date/);
  assert.throws(() => segP.setDateIso({}, 'vencimento', '2026-01-32'), /invalid date/);
  assert.throws(() => header.setDateIso({}, 'hora_geracao', '10:30'), /malformed ISO time/);
  assert.throws(() => header.setDateIso({}, 'hora_geracao', '24:00:00'), /invalid time/);
  assert.throws(() => header.setDateIso({}, 'hora_geracao', '10:60:00'), /invalid time/);
});

test('setDateIso throws for a ddMMyy year outside the 1970-2069 pivot window', () => {
  assert.throws(
    () => det400.setDateIso({}, 'data_vencimento', '1950-01-01'),
    /year out of range/
  );
  assert.throws(
    () => det400.setDateIso({}, 'data_vencimento', '2070-01-01'),
    /year out of range/
  );
});

test('setDateIso throws for a field with no date format', () => {
  assert.throws(
    () => segP.setDateIso({}, 'valor_titulo', '2026-07-15'),
    /field has no date format: valor_titulo/
  );
});

test('setDateIso throws for an unknown field name', () => {
  assert.throws(() => segP.setDateIso({}, 'nope', '2026-07-15'), /field not found: nope/);
});

// --- the setters must not rely on mutation ------------------------------
//
// These exist because `setDecimal`/`setDateIso` used to return void and mutate
// the map in place. That works in Node, where objects are passed by reference,
// and silently does NOTHING in Python/Java/.NET, because jsii marshals maps by
// value. Two documented public helpers were therefore inert in three of the
// four languages the SDK ships, and no Node test could ever have caught it.
// The equivalent assertions run against the real bindings in bindings/*.

test('setDecimal returns a new map and leaves the input untouched', () => {
  const input = { codigo_banco: '104' };
  const out = segP.setDecimal(input, 'valor_titulo', '1500.00');
  assert.strictEqual(out.valor_titulo, '150000');
  assert.strictEqual(out.codigo_banco, '104', 'other keys are carried over');
  assert.strictEqual(
    input.valor_titulo,
    undefined,
    'input must not be mutated — a by-value binding would not see it'
  );
  assert.notStrictEqual(out, input, 'must be a distinct object');
});

test('setDateIso returns a new map and leaves the input untouched', () => {
  const input = { codigo_banco: '104' };
  const out = segP.setDateIso(input, 'vencimento', '2026-07-15');
  assert.strictEqual(out.vencimento, '15072026');
  assert.strictEqual(out.codigo_banco, '104');
  assert.strictEqual(input.vencimento, undefined, 'input must not be mutated');
});

test('the setters compose without mutation', () => {
  let v = {};
  v = segP.setDecimal(v, 'valor_titulo', '1234.56');
  v = segP.setDateIso(v, 'vencimento', '2026-07-15');
  assert.strictEqual(v.valor_titulo, '123456');
  assert.strictEqual(v.vencimento, '15072026');
});
