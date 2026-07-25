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

test('parses a whole Caixa 104 SIGCB retorno file (T/U detection)', () => {
  const keys = [
    'cnab240/104/sigcb/header_arquivo',
    'cnab240/104/sigcb/header_lote',
    'cnab240/104/sigcb/retorno/detalhe_segmento_t',
    'cnab240/104/sigcb/retorno/detalhe_segmento_u',
    'cnab240/104/sigcb/trailer_lote',
  ];
  const content = buildFile(keys, {
    0: { codigo_banco: '104', codigo_remessa_retorno: '2' },
    2: { nosso_numero: '000000000000001', valor_titulo: '000000000150000' },
    3: { valor_pago: '000000000150000' },
  });
  const file = CnabFile.forBank(specJson, 'cnab240', '104', 'sigcb', 'retorno');
  const parsed = file.parse(content);

  assert.strictEqual(parsed.length, keys.length);
  assert.deepStrictEqual(parsed.map((p) => p.recordKey), keys);
  // segment T and U retorno lines are classified via their defaults
  assert.strictEqual(parsed[2].tipo, '3');
  assert.strictEqual(parsed[2].segment, 'T');
  assert.strictEqual(parsed[3].tipo, '3');
  assert.strictEqual(parsed[3].segment, 'U');
  // fields were actually parsed
  assert.strictEqual(parsed[2].fields.valor_titulo, '150000');
  assert.strictEqual(parsed[3].fields.valor_pago, '150000');
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

test('detectScope identifies a 104 CNAB240 SIGCB remessa file', () => {
  const keys = [
    'cnab240/104/sigcb/header_arquivo',
    'cnab240/104/sigcb/header_lote',
    'cnab240/104/sigcb/remessa/detalhe_segmento_p',
    'cnab240/104/sigcb/trailer_lote',
  ];
  const content = buildFile(keys, {
    0: { codigo_banco: '104', codigo_remessa_retorno: '1' },
  });
  const scope = CnabFile.detectScope(specJson, content);
  assert.deepStrictEqual(scope, {
    layout: 'cnab240',
    bank: '104',
    variant: 'sigcb',
    direction: 'remessa',
  });
});

test('detectScope/detect identify a 104 CNAB240 SIGCB retorno file', () => {
  const keys = [
    'cnab240/104/sigcb/header_arquivo',
    'cnab240/104/sigcb/header_lote',
    'cnab240/104/sigcb/retorno/detalhe_segmento_t',
    'cnab240/104/sigcb/retorno/detalhe_segmento_u',
    'cnab240/104/sigcb/trailer_lote',
  ];
  const content = buildFile(keys, {
    0: { codigo_banco: '104', codigo_remessa_retorno: '2' },
  });
  const scope = CnabFile.detectScope(specJson, content);
  assert.deepStrictEqual(scope, {
    layout: 'cnab240',
    bank: '104',
    variant: 'sigcb',
    direction: 'retorno',
  });
  // the convenience factory builds a working parser from the detected scope
  const parsed = CnabFile.detect(specJson, content).parse(content);
  assert.deepStrictEqual(parsed.map((p) => p.recordKey), keys);
});

test('detectScope/detect identify an Itaú 341 CNAB400 retorno file', () => {
  const keys = [
    'cnab400/341/retorno/header_arquivo',
    'cnab400/341/retorno/detalhe',
    'cnab400/341/retorno/trailer_arquivo',
  ];
  const content = buildFile(keys, {
    0: { codigo_do_banco: '341' },
    1: { tipo_registro: '1' },
  });
  const scope = CnabFile.detectScope(specJson, content);
  assert.deepStrictEqual(scope, {
    layout: 'cnab400',
    bank: '341',
    variant: '',
    direction: 'retorno',
  });
  const parsed = CnabFile.detect(specJson, content).parse(content);
  assert.deepStrictEqual(parsed.map((p) => p.recordKey), keys);
});

test('detect throws a clear error on garbage content', () => {
  assert.throws(() => CnabFile.detect(specJson, 'Z'.repeat(240)), /cannot detect bank/);
  assert.throws(() => CnabFile.detect(specJson, 'hello world'), /cannot detect CNAB layout/);
  assert.throws(() => CnabFile.detect(specJson, '\n\n'), /no non-empty lines/);
  // valid bank code but no direction indicator at position 143
  const junk = `104${'X'.repeat(237)}`;
  assert.throws(() => CnabFile.detect(specJson, junk), /cannot detect direction/);
});

test('a leading UTF-8 BOM does not shift positions in detectScope/parse', () => {
  const keys = [
    'cnab240/104/sigcb/header_arquivo',
    'cnab240/104/sigcb/header_lote',
    'cnab240/104/sigcb/remessa/detalhe_segmento_p',
    'cnab240/104/sigcb/trailer_lote',
  ];
  const content = buildFile(keys, {
    0: { codigo_banco: '104', codigo_remessa_retorno: '1' },
  });
  const withBom = `﻿${content}`;

  assert.deepStrictEqual(CnabFile.detectScope(specJson, withBom), {
    layout: 'cnab240',
    bank: '104',
    variant: 'sigcb',
    direction: 'remessa',
  });
  const parsed = CnabFile.detect(specJson, withBom).parse(withBom);
  assert.deepStrictEqual(parsed.map((p) => p.recordKey), keys);
  // positions are intact: the BOM did not become part of codigo_banco
  assert.strictEqual(parsed[0].fields.codigo_banco, '104');
  assert.deepStrictEqual(parsed, CnabFile.detect(specJson, content).parse(content));
});

test('CRLF line endings and a trailing newline parse like LF', () => {
  const keys = [
    'cnab240/104/sigcb/header_arquivo',
    'cnab240/104/sigcb/header_lote',
    'cnab240/104/sigcb/remessa/detalhe_segmento_p',
    'cnab240/104/sigcb/trailer_lote',
  ];
  const lf = buildFile(keys, {
    0: { codigo_banco: '104', codigo_remessa_retorno: '1' },
  });
  const crlf = `${lf.split('\n').join('\r\n')}\r\n`;

  assert.deepStrictEqual(
    CnabFile.detectScope(specJson, crlf),
    CnabFile.detectScope(specJson, lf)
  );
  assert.deepStrictEqual(
    CnabFile.detect(specJson, crlf).parse(crlf),
    CnabFile.detect(specJson, lf).parse(lf)
  );
});
