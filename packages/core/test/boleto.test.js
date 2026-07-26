'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { Modulo, Boleto } = require('../lib/index.js');

// ---------------------------------------------------------------------------
// Modulo.mod10
// ---------------------------------------------------------------------------

test('mod10: FEBRABAN worked example 01230067896 -> 3', () => {
  // Right-to-left, weights 2,1 alternating; products > 9 sum their digits:
  // 6*2=12->3, 9*1=9, 8*2=16->7, 7*1=7, 6*2=12->3, 0*1=0, 0*2=0,
  // 3*1=3, 2*2=4, 1*1=1, 0*2=0; sum=37; DV = 40-37 = 3.
  assert.strictEqual(Modulo.mod10('01230067896'), 3);
});

test('mod10: hand-derived vectors', () => {
  // '104912345' right-to-left: 5*2=10->1, 4*1=4, 3*2=6, 2*1=2, 1*2=2,
  // 9*1=9, 4*2=8, 0*1=0, 1*2=2; sum=34; DV = (10-4)%10 = 6.
  assert.strictEqual(Modulo.mod10('104912345'), 6);
  // '6789012345' right-to-left: 5*2=10->1, 4*1=4, 3*2=6, 2*1=2, 1*2=2,
  // 0*1=0, 9*2=18->9, 8*1=8, 7*2=14->5, 6*1=6; sum=43; DV = (10-3)%10 = 7.
  assert.strictEqual(Modulo.mod10('6789012345'), 7);
  // sum already a multiple of 10 -> DV 0: '505' -> 5*2=10->1, 0*1=0,
  // 5*2=10->1; sum=2... use '0': 0*2=0; sum=0; DV = (10-0)%10 = 0.
  assert.strictEqual(Modulo.mod10('0'), 0);
});

test('mod10: rejects non-digits and empty input', () => {
  assert.throws(() => Modulo.mod10(''), /only digits/);
  assert.throws(() => Modulo.mod10('12a4'), /only digits/);
});

// ---------------------------------------------------------------------------
// Modulo.mod11 / mod11Boleto
// ---------------------------------------------------------------------------

test('mod11: hand-derived vectors', () => {
  // '0123456789' right-to-left with weights 2..9 cycling:
  // 9*2=18, 8*3=24, 7*4=28, 6*5=30, 5*6=30, 4*7=28, 3*8=24, 2*9=18,
  // 1*2=2, 0*3=0; sum=202; 202%11=4; DV = 11-4 = 7.
  assert.strictEqual(Modulo.mod11('0123456789'), 7);
  // '1': 1*2=2; DV = 11-2 = 9.
  assert.strictEqual(Modulo.mod11('1'), 9);
  // '6': 6*2=12; 12%11=1; DV = 11-1 = 10 -> maps to 0.
  assert.strictEqual(Modulo.mod11('6'), 0);
  // '0': sum=0; DV = 11-0 = 11 -> maps to 0.
  assert.strictEqual(Modulo.mod11('0'), 0);
});

test('mod11Boleto: hand-derived vectors (0/1/10/11 -> 1)', () => {
  // '1': DV = 9 (no mapping).
  assert.strictEqual(Modulo.mod11Boleto('1'), 9);
  // '5': 5*2=10; 10%11=10; DV = 11-10 = 1 -> stays 1 (in mapped set).
  assert.strictEqual(Modulo.mod11Boleto('5'), 1);
  // '6': raw DV 10 -> 1.
  assert.strictEqual(Modulo.mod11Boleto('6'), 1);
  // '0': raw DV 11 -> 1.
  assert.strictEqual(Modulo.mod11Boleto('0'), 1);
  // same weighting as mod11: '0123456789' -> 7.
  assert.strictEqual(Modulo.mod11Boleto('0123456789'), 7);
});

// ---------------------------------------------------------------------------
// Boleto.fatorVencimento
// ---------------------------------------------------------------------------

test('fatorVencimento: FEBRABAN vectors', () => {
  assert.strictEqual(Boleto.fatorVencimento('1997-10-08'), '0001');
  // documented FEBRABAN example: 2000-07-03 -> 1000
  assert.strictEqual(Boleto.fatorVencimento('2000-07-03'), '1000');
  assert.strictEqual(Boleto.fatorVencimento('2025-02-21'), '9999');
  // rollover: restarts at 1000
  assert.strictEqual(Boleto.fatorVencimento('2025-02-22'), '1000');
  assert.strictEqual(Boleto.fatorVencimento('2025-02-23'), '1001');
});

test('fatorVencimento: rejects bad input', () => {
  assert.throws(() => Boleto.fatorVencimento('08/10/1997'), /YYYY-MM-DD/);
  assert.throws(() => Boleto.fatorVencimento('1997-10-07'), /1997-10-08 or later/);
  assert.throws(() => Boleto.fatorVencimento('2025-02-30'), /not a valid calendar date/);
});

// ---------------------------------------------------------------------------
// Boleto barcode + linha digitável: fully hand-derived vector
// ---------------------------------------------------------------------------

// bank 104, currency 9, due 2025-02-23 (fator 1001), amount 123456 cents,
// free field 1234567890123456789012345.
// 43 digits without DV: 1049 1001 0000123456 1234567890123456789012345
// mod11Boleto sum (right-to-left, weights 2..9 cycling):
//   5*2+4*3+3*4+2*5+1*6+0*7+9*8+8*9 = 194
// + 7*2+6*3+5*4+4*5+3*6+2*7+1*8+0*9 = 112  (total 306)
// + 9*2+8*3+7*4+6*5+5*6+4*7+3*8+2*9 = 200  (total 506)
// + 1*2+6*3+5*4+4*5+3*6+2*7+1*8+0*9 = 100  (total 606)
// + 0*2+0*3+0*4+1*5+0*6+0*7+1*8+9*9 =  94  (total 700)
// + 4*2+0*3+1*4                     =  12  (total 712)
// 712 % 11 = 8; DV = 11 - 8 = 3.
const KNOWN_BARCODE = '10493100100001234561234567890123456789012345';
// linha digitável:
//   field1 = 1049 + 12345 + mod10('104912345')=6  -> 1049123456
//   field2 = 6789012345 + mod10=7                 -> 67890123457
//   field3 = 6789012345 + mod10=7                 -> 67890123457
//   field4 = 3 (general DV)
//   field5 = 1001 + 0000123456                    -> 10010000123456
const KNOWN_LINHA = '10491234566789012345767890123457310010000123456';
const KNOWN_FORMATTED = '10491.23456 67890.123457 67890.123457 3 10010000123456';

test('barcode: composes the hand-derived 44-digit barcode', () => {
  const bc = Boleto.barcode({
    bankCode: '104',
    currencyCode: '9',
    dueDateIso: '2025-02-23',
    amountCents: '123456',
    freeField: '1234567890123456789012345',
  });
  assert.strictEqual(bc, KNOWN_BARCODE);
  assert.strictEqual(bc.length, 44);
  assert.strictEqual(Boleto.barcodeCheckDigit(bc), 3);
  assert.strictEqual(Boleto.isValidBarcode(bc), true);
});

test('linhaDigitavel: matches the hand-derived 47 digits', () => {
  assert.strictEqual(Boleto.linhaDigitavel(KNOWN_BARCODE), KNOWN_LINHA);
  assert.strictEqual(Boleto.linhaDigitavelFormatted(KNOWN_BARCODE), KNOWN_FORMATTED);
});

test('parseLinhaDigitavel: plain and formatted parse back to the barcode', () => {
  assert.strictEqual(Boleto.parseLinhaDigitavel(KNOWN_LINHA), KNOWN_BARCODE);
  assert.strictEqual(Boleto.parseLinhaDigitavel(KNOWN_FORMATTED), KNOWN_BARCODE);
});

// ---------------------------------------------------------------------------
// Round-trips over synthetic barcodes
// ---------------------------------------------------------------------------

const ROUND_TRIP_CASES = [
  {
    bankCode: '104',
    currencyCode: '9',
    dueDateIso: '2024-12-31',
    amountCents: '1',
    freeField: '0000000000000000000000001',
  },
  {
    bankCode: '104',
    currencyCode: '9',
    dueDateIso: '2025-02-22',
    amountCents: '9999999999',
    freeField: '9999999999999999999999999',
  },
  {
    bankCode: '341',
    currencyCode: '9',
    dueDateIso: '1997-10-08',
    amountCents: '150000',
    freeField: '1750012345671234567000000',
  },
  {
    bankCode: '341',
    currencyCode: '9',
    dueDateIso: '2026-07-18',
    amountCents: '0',
    freeField: '0000000000000000000000000',
  },
  {
    bankCode: '001',
    currencyCode: '9',
    dueDateIso: '2000-07-03',
    amountCents: '250099',
    freeField: '5024136798102030405060708',
  },
];

for (const params of ROUND_TRIP_CASES) {
  test(`round-trip: bank ${params.bankCode} due ${params.dueDateIso} amount ${params.amountCents}`, () => {
    const bc = Boleto.barcode(params);
    assert.strictEqual(bc.length, 44);
    assert.match(bc, /^[0-9]{44}$/);
    assert.strictEqual(Boleto.isValidBarcode(bc), true);
    assert.strictEqual(Number(bc.charAt(4)), Boleto.barcodeCheckDigit(bc));

    const linha = Boleto.linhaDigitavel(bc);
    assert.strictEqual(linha.length, 47);
    assert.strictEqual(Boleto.parseLinhaDigitavel(linha), bc);

    const formatted = Boleto.linhaDigitavelFormatted(bc);
    assert.strictEqual(Boleto.parseLinhaDigitavel(formatted), bc);
    assert.strictEqual(formatted.replace(/[.\s]/g, ''), linha);
  });
}

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

test('parseLinhaDigitavel: corrupting a field digit throws (mod10 mismatch)', () => {
  const corrupted = '2' + KNOWN_LINHA.substring(1); // field 1 first digit 1 -> 2
  assert.throws(
    () => Boleto.parseLinhaDigitavel(corrupted),
    /field 1 check digit mismatch/
  );
});

test('parseLinhaDigitavel: corrupting field 5 throws (general DV mismatch)', () => {
  // index 33 is the first fator digit, covered only by the general mod11 DV
  const corrupted = KNOWN_LINHA.substring(0, 33) + '2' + KNOWN_LINHA.substring(34);
  assert.throws(
    () => Boleto.parseLinhaDigitavel(corrupted),
    /general check digit mismatch/
  );
});

test('parseLinhaDigitavel: wrong length or non-digits throw', () => {
  assert.throws(
    () => Boleto.parseLinhaDigitavel(KNOWN_LINHA.substring(0, 46)),
    /47 digits/
  );
  assert.throws(() => Boleto.parseLinhaDigitavel(KNOWN_LINHA + '0'), /47 digits/);
  assert.throws(() => Boleto.parseLinhaDigitavel('x'.repeat(47)), /47 digits/);
});

test('barcode: invalid params throw with clear messages', () => {
  const ok = ROUND_TRIP_CASES[0];
  assert.throws(
    () => Boleto.barcode({ ...ok, bankCode: '10' }),
    /bankCode must be exactly 3 digits/
  );
  assert.throws(
    () => Boleto.barcode({ ...ok, currencyCode: '99' }),
    /currencyCode must be exactly 1 digit/
  );
  assert.throws(
    () => Boleto.barcode({ ...ok, amountCents: '12345678901' }),
    /amountCents must have at most 10 digits/
  );
  assert.throws(() => Boleto.barcode({ ...ok, amountCents: '12.50' }), /only digits/);
  assert.throws(
    () => Boleto.barcode({ ...ok, freeField: '123' }),
    /freeField must be exactly 25 digits/
  );
});

test('isValidBarcode / linhaDigitavel: reject a wrong general DV', () => {
  // replace the correct DV (3) with a different digit
  const bad = KNOWN_BARCODE.substring(0, 4) + '4' + KNOWN_BARCODE.substring(5);
  assert.strictEqual(Boleto.isValidBarcode(bad), false);
  assert.throws(() => Boleto.linhaDigitavel(bad), /invalid general check digit/);
  assert.strictEqual(Boleto.isValidBarcode('123'), false);
  assert.strictEqual(Boleto.isValidBarcode('x'.repeat(44)), false);
});

test('barcodeCheckDigit: wrong length throws', () => {
  assert.throws(() => Boleto.barcodeCheckDigit('123'), /44 digits/);
});
