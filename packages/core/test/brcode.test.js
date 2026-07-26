'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { BrCode } = require('../lib/index.js');

// --- CRC-16/CCITT-FALSE --------------------------------------------------
//
// The CRC is the part of a BR Code that is easy to get subtly wrong, and a
// wrong CRC produces a QR that SCANS FINE and is then rejected by the bank —
// the same "plausible but wrong" failure class as the toLine truncation bug
// (#28). "123456789" -> 0x29B1 is the canonical check value published for
// CRC-16/CCITT-FALSE, so it pins the algorithm independently of anything PIX.

test('crc16 matches the canonical CCITT-FALSE check value', () => {
  assert.strictEqual(BrCode.crc16('123456789'), '29B1');
});

test('crc16 of the empty string is the initial value', () => {
  assert.strictEqual(BrCode.crc16(''), 'FFFF');
});

// Rather than assert remembered magic numbers — one of which was simply wrong
// when this test was first written — cross-check the shipped bitwise
// implementation against an independent TABLE-DRIVEN one. Same specification,
// genuinely different code path, so agreeing on thousands of inputs is real
// evidence and not a restatement of the same mistake.
function crc16TableDriven(s) {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 8;
    for (let k = 0; k < 8; k++) {
      c = (c & 0x8000) !== 0 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    table[n] = c;
  }
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc = ((crc << 8) ^ table[((crc >> 8) ^ (s.charCodeAt(i) & 0xff)) & 0xff]) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

test('the table-driven reference also reproduces the canonical check value', () => {
  assert.strictEqual(crc16TableDriven('123456789'), '29B1');
});

test('crc16 agrees with an independent table-driven implementation', () => {
  const alphabet = 'ABCXYZ0129 .*@-abc';
  for (let i = 0; i < 2000; i++) {
    let s = '';
    let seed = i * 2654435761;
    const len = i % 64;
    for (let j = 0; j < len; j++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      s += alphabet[seed % alphabet.length];
    }
    assert.strictEqual(BrCode.crc16(s), crc16TableDriven(s), `mismatch for ${JSON.stringify(s)}`);
  }
});

test('crc16 always returns four uppercase hex characters', () => {
  // Guards the zero-padding path: a CRC below 0x1000 must not come back short.
  for (let i = 0; i < 400; i++) {
    const crc = BrCode.crc16(`payload-${i}`);
    assert.match(crc, /^[0-9A-F]{4}$/, `bad crc for i=${i}: ${crc}`);
  }
});

// --- encode ---------------------------------------------------------------

const BASE = {
  pixKey: 'fulano@example.com',
  merchantName: 'FULANO DE TAL',
  merchantCity: 'BRASILIA',
};

test('encode produces a payload with the expected EMV skeleton', () => {
  const p = BrCode.encode(BASE);
  assert.ok(p.startsWith('000201'), `payload should start with 000201, got ${p.slice(0, 12)}`);
  assert.ok(p.includes('BR.GOV.BCB.PIX'), 'missing the PIX GUI');
  assert.ok(p.includes('5303986'), 'missing currency 986');
  assert.ok(p.includes('5802BR'), 'missing country BR');
  assert.match(p.slice(-8), /^6304[0-9A-F]{4}$/, 'must end with tag 63 + 4 hex');
});

test('encode output validates', () => {
  assert.strictEqual(BrCode.isValid(BrCode.encode(BASE)), true);
});

test('the CRC covers the 6304 header itself', () => {
  // If an implementation computes the CRC over the payload WITHOUT "6304",
  // isValid would still pass against its own output but the code would be
  // rejected in the wild. Recompute independently here.
  const p = BrCode.encode(BASE);
  const body = p.slice(0, -4);
  assert.ok(body.endsWith('6304'), 'body handed to crc16 must include 6304');
  assert.strictEqual(BrCode.crc16(body), p.slice(-4));
});

test('amount is emitted only when supplied', () => {
  assert.ok(!BrCode.encode(BASE).includes('54'), 'no amount tag expected');
  const withAmount = BrCode.encode({ ...BASE, amount: '10.00' });
  assert.ok(withAmount.includes('540510.00'), `expected 540510.00 in ${withAmount}`);
});

test('encode rejects a float-ish or malformed amount', () => {
  for (const bad of ['10,00', '1e3', '-5', '10.001', 'abc', '10.']) {
    assert.throws(
      () => BrCode.encode({ ...BASE, amount: bad }),
      /decimal string/,
      `expected rejection for ${bad}`
    );
  }
});

test('txid defaults to *** and round-trips when supplied', () => {
  assert.ok(BrCode.encode(BASE).includes('62070503***'));
  const p = BrCode.encode({ ...BASE, txid: 'PEDIDO123' });
  assert.strictEqual(BrCode.decode(p).txid, 'PEDIDO123');
});

test('encode rejects an invalid txid', () => {
  assert.throws(() => BrCode.encode({ ...BASE, txid: 'nao-permitido!' }), /txid/);
  assert.throws(() => BrCode.encode({ ...BASE, txid: 'X'.repeat(26) }), /txid/);
});

test('accents are folded rather than emitted raw', () => {
  const p = BrCode.encode({ ...BASE, merchantName: 'JOSÉ DA SILVA', merchantCity: 'SÃO PAULO' });
  const f = BrCode.decode(p);
  assert.strictEqual(f.merchantName, 'JOSE DA SILVA');
  assert.strictEqual(f.merchantCity, 'SAO PAULO');
  // eslint-disable-next-line no-control-regex
  assert.match(p, /^[\x20-\x7e]+$/, 'payload must be printable ASCII');
});

test('long names and cities are truncated to the EMV limits', () => {
  const p = BrCode.encode({
    ...BASE,
    merchantName: 'A'.repeat(40),
    merchantCity: 'B'.repeat(40),
  });
  const f = BrCode.decode(p);
  assert.strictEqual(f.merchantName.length, 25);
  assert.strictEqual(f.merchantCity.length, 15);
});

test('encode requires key, name and city', () => {
  assert.throws(() => BrCode.encode({ ...BASE, pixKey: '' }), /pixKey/);
  assert.throws(() => BrCode.encode({ ...BASE, merchantName: '' }), /merchantName/);
  assert.throws(() => BrCode.encode({ ...BASE, merchantCity: '' }), /merchantCity/);
});

test('singleUse adds initiation method 12', () => {
  assert.ok(!BrCode.encode(BASE).includes('010212'));
  assert.ok(BrCode.encode({ ...BASE, singleUse: true }).includes('010212'));
});

// --- decode / round-trip ---------------------------------------------------

test('decode round-trips every field encode wrote', () => {
  const input = {
    pixKey: '123e4567-e12b-12d1-a456-426655440000',
    merchantName: 'LOJA EXEMPLO',
    merchantCity: 'RIO DE JANEIRO',
    amount: '1500.00',
    txid: 'INV0001',
    description: 'Pedido 42',
  };
  const f = BrCode.decode(BrCode.encode(input));
  assert.strictEqual(f.pixKey, input.pixKey);
  assert.strictEqual(f.merchantName, input.merchantName);
  assert.strictEqual(f.merchantCity, input.merchantCity);
  assert.strictEqual(f.amount, input.amount);
  assert.strictEqual(f.txid, input.txid);
  assert.strictEqual(f.description, input.description);
  assert.strictEqual(f.crcValid, true);
});

test('round-trip holds across many generated payloads', () => {
  for (let i = 0; i < 200; i++) {
    const input = {
      pixKey: `user${i}@example.com`,
      merchantName: `LOJA ${i}`,
      merchantCity: 'BRASILIA',
      amount: `${i}.${String(i % 100).padStart(2, '0')}`,
      txid: `TX${i}`,
    };
    const p = BrCode.encode(input);
    assert.strictEqual(BrCode.isValid(p), true, `invalid at i=${i}`);
    const f = BrCode.decode(p);
    assert.strictEqual(f.pixKey, input.pixKey, `pixKey at i=${i}`);
    assert.strictEqual(f.amount, input.amount, `amount at i=${i}`);
    assert.strictEqual(f.txid, input.txid, `txid at i=${i}`);
  }
});

// --- tamper detection ------------------------------------------------------

test('isValid rejects a tampered payload', () => {
  const p = BrCode.encode({ ...BASE, amount: '10.00' });
  // Change the amount without recomputing the CRC — this is the attack the
  // checksum exists to catch.
  const tampered = p.replace('540510.00', '540590.00');
  assert.notStrictEqual(tampered, p);
  assert.strictEqual(BrCode.isValid(tampered), false);
  assert.strictEqual(BrCode.decode(tampered).crcValid, false);
});

test('isValid is a predicate: false, not a throw, for junk', () => {
  for (const junk of ['', 'x', 'not a brcode', '0002', '000201']) {
    assert.strictEqual(BrCode.isValid(junk), false, `expected false for ${JSON.stringify(junk)}`);
  }
});

test('isValid accepts a lowercase CRC', () => {
  const p = BrCode.encode(BASE);
  const lower = p.slice(0, -4) + p.slice(-4).toLowerCase();
  assert.strictEqual(BrCode.isValid(lower), true);
});

test('decode raises on structurally malformed input', () => {
  // Shorter than any possible payload.
  assert.throws(() => BrCode.decode('0002'), /too short/);
  // Long enough to reach the TLV walker, but tag 00 declares 99 characters
  // that are not present.
  assert.throws(() => BrCode.decode('0099010203040506'), /declares 99 characters/);
  // A length field that is not two digits.
  assert.throws(() => BrCode.decode('00XX0102030405'), /is not two digits/);
  // Well-formed TLVs, but the final tag is not the CRC.
  assert.throws(() => BrCode.decode('000201010211'), /expected "63"/);
});
