'use strict';
// Strict `toLine` behaviour: values that do not fit, or that are not digit
// strings on numeric fields, must FAIL LOUDLY instead of being silently
// truncated/stripped (which for a bank file is undetectable financial
// corruption — `validate` happily accepts the corrupted line).
//
// `toLineWithOptions` is the documented opt-out that restores the legacy
// lenient behaviour.

const { test } = require('node:test');
const assert = require('node:assert');
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

const SEG_P = 'cnab240/104/sigcb/remessa/detalhe_segmento_p';
const HEADER_240 = 'cnab240/104/sigcb/header_arquivo';

const LENIENT = { truncateOversized: true, stripNonDigits: true };

// --- oversized numeric ------------------------------------------------------

test('oversized numeric value throws instead of keeping the rightmost digits', () => {
  const rec = spec.getRecord(SEG_P);
  // valor_titulo is 15 wide (86-100); 17 significant digits cannot fit.
  const values = { valor_titulo: '12345678901234567' };
  assert.throws(
    () => rec.toLine(values),
    (err) => {
      assert.ok(
        err.message.startsWith(
          'field "valor_titulo" (86-100): value has 17 digits but the field is 15 wide'
        ),
        `unhelpful message: ${err.message}`
      );
      assert.ok(err.message.includes('12345678901234567'), 'message omits the value');
      assert.ok(err.message.includes('toLineWithOptions'), 'message omits the opt-out');
      return true;
    }
  );
});

test('redundant leading zeros are NOT an overflow (nothing is lost)', () => {
  const rec = spec.getRecord(SEG_P);
  // 20 characters, but only 6 significant digits -> fits a 15-wide field.
  const line = rec.toLine({ valor_titulo: '00000000000000150000' });
  assert.strictEqual(line.substring(85, 100), '000000000150000');
});

// --- oversized alpha --------------------------------------------------------

test('oversized alpha value throws instead of being truncated', () => {
  const rec = spec.getRecord(HEADER_240);
  // nome_empresa is 30 wide (73-102).
  const long = 'EMPRESA COM UM NOME EXAGERADAMENTE LONGO LTDA';
  assert.throws(
    () => rec.toLine({ nome_empresa: long }),
    (err) => {
      assert.ok(
        err.message.startsWith(
          `field "nome_empresa" (73-102): value is ${long.length} characters but the field is 30 wide`
        ),
        `unhelpful message: ${err.message}`
      );
      assert.ok(err.message.includes(long), 'message omits the value');
      assert.ok(err.message.includes('truncateOversized'), 'message omits the opt-out');
      return true;
    }
  );
});

// --- non-digit numeric ------------------------------------------------------

test('decimal string on a numeric field throws and points at setDecimal', () => {
  const rec = spec.getRecord(SEG_P);
  assert.throws(
    () => rec.toLine({ valor_titulo: '1500.00' }),
    (err) => {
      assert.ok(
        err.message.startsWith(
          'field "valor_titulo" (86-100): value "1500.00" is not a digit string'
        ),
        `unhelpful message: ${err.message}`
      );
      assert.ok(err.message.includes('unsigned digit strings'), 'message omits the rule');
      assert.ok(
        err.message.includes('setDecimal'),
        'message does not point at setDecimal'
      );
      assert.ok(err.message.includes('stripNonDigits'), 'message omits the opt-out');
      return true;
    }
  );
});

test('a negative value on a numeric field throws (the sign would be stripped)', () => {
  const rec = spec.getRecord(SEG_P);
  assert.throws(() => rec.toLine({ valor_titulo: '-150000' }), /is not a digit string/);
});

test('the setDecimal path produces exactly what the raw digits would', () => {
  const rec = spec.getRecord(SEG_P);
  const values = rec.setDecimal({}, 'valor_titulo', '1500.00');
  assert.strictEqual(values.valor_titulo, '150000');
  assert.strictEqual(
    rec.toLine(values).substring(85, 100),
    rec.toLine({ valor_titulo: '000000000150000' }).substring(85, 100)
  );
});

test('empty and all-digit numeric values keep working', () => {
  const rec = spec.getRecord(SEG_P);
  assert.strictEqual(rec.toLine({ valor_titulo: '' }).substring(85, 100), '0'.repeat(15));
  assert.strictEqual(
    rec.toLine({ valor_titulo: '150000' }).substring(85, 100),
    '000000000150000'
  );
});

// --- explicit opt-out -------------------------------------------------------

test('toLineWithOptions(truncateOversized) reproduces the legacy truncation', () => {
  const rec = spec.getRecord(SEG_P);
  const line = rec.toLineWithOptions({ valor_titulo: '12345678901234567' }, LENIENT);
  // legacy numeric behaviour: keep the RIGHTMOST `width` digits
  assert.strictEqual(line.substring(85, 100), '345678901234567');

  const header = spec.getRecord(HEADER_240);
  const long = 'EMPRESA COM UM NOME EXAGERADAMENTE LONGO LTDA';
  const hline = header.toLineWithOptions({ nome_empresa: long }, LENIENT);
  // legacy alpha behaviour: keep the LEFTMOST `width` characters
  assert.strictEqual(hline.substring(72, 102), long.substring(0, 30));
});

test('toLineWithOptions(stripNonDigits) reproduces the legacy stripping', () => {
  const rec = spec.getRecord(SEG_P);
  const line = rec.toLineWithOptions({ valor_titulo: '1500.00' }, LENIENT);
  assert.strictEqual(line.substring(85, 100), '000000000150000');
  const negative = rec.toLineWithOptions({ valor_titulo: '-150000' }, LENIENT);
  assert.strictEqual(negative.substring(85, 100), '000000000150000');
});

test('each lenient flag only relaxes its own rule', () => {
  const rec = spec.getRecord(SEG_P);
  const onlyTruncate = { truncateOversized: true, stripNonDigits: false };
  const onlyStrip = { truncateOversized: false, stripNonDigits: true };

  assert.throws(
    () => rec.toLineWithOptions({ valor_titulo: '1500.00' }, onlyTruncate),
    /is not a digit string/
  );
  assert.throws(
    () => rec.toLineWithOptions({ valor_titulo: '12345678901234567' }, onlyStrip),
    /but the field is 15 wide/
  );
  // all-strict options behave exactly like toLine
  const strict = { truncateOversized: false, stripNonDigits: false };
  assert.strictEqual(
    rec.toLineWithOptions({ valor_titulo: '150000' }, strict),
    rec.toLine({ valor_titulo: '150000' })
  );
});

// --- round-trip is unaffected ----------------------------------------------

test('toLine(parse(line)) is still identity for every golden record', () => {
  for (const c of cases) {
    const rec = spec.getRecord(c.key);
    const golden = fs.readFileSync(
      path.join(goldenDir, safeKey(c.key) + '.line'),
      'utf8'
    );
    assert.strictEqual(
      rec.toLine(rec.parse(golden)),
      golden,
      `strict toLine broke the round-trip for ${c.key}`
    );
  }
});

test('strict toLine round-trips a fully blank line of every record in the spec', () => {
  // Blank/space-filled input is the most common "unset" shape; parse() turns it
  // into '' (alpha) and '0' (numeric) and toLine must accept both back.
  let checked = 0;
  for (const key of spec.recordKeys()) {
    const rec = spec.getRecord(key);
    // `generic/` templates are partial by design, so measure the covered width
    // rather than the declared line length.
    const width = rec.spec.fields.reduce((a, f) => a + f.end - f.start + 1, 0);
    const blank = ' '.repeat(rec.spec.lineLength);
    const rebuilt = rec.toLine(rec.parse(blank));
    assert.strictEqual(rebuilt.length, width, `bad length for ${key}`);
    // Re-parsing by position only makes sense when the record covers the whole
    // line (partial `generic/` templates have gaps), but then it is a fixed point.
    if (width === rec.spec.lineLength) {
      assert.strictEqual(
        rec.toLine(rec.parse(rebuilt)),
        rebuilt,
        `not a fixed point: ${key}`
      );
    }
    checked += 1;
  }
  assert.ok(checked >= 50, `expected to check the whole spec, checked ${checked}`);
});

test('CnabFileBuilder uses strict mode: a bad value aborts the whole file', () => {
  const { CnabFileBuilder } = require('../lib/index.js');
  const b = CnabFileBuilder.forBank(specJson, 'cnab240', '104', 'sigcb', 'remessa');
  b.withHeader({ codigo_banco: '104', nome_empresa: 'EMPRESA TESTE LTDA' });
  b.startLote({ codigo_banco: '104' });
  b.addDetail('detalhe_segmento_p', { valor_titulo: '1500.00' });
  b.endLote({});
  assert.throws(() => b.toFileContent({}), /valor_titulo.*is not a digit string/s);
});
