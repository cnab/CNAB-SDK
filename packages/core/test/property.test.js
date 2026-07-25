'use strict';
// Generative round-trip property tests over the *data* (issue #16).
//
// The engine is covered by hand-written unit tests; this file covers every
// shipped (non-template) record in packages/spec/dist/spec.json with
// deterministic pseudo-random, type-correct values and asserts the invariants
// that must hold for ANY record:
//
//   1. toLine(values).length === meta.lineLength
//   2. each field lands exactly on its declared [start, end] positions
//   3. parse -> toLine is idempotent (a well-formed line rebuilds identically)
//   4. validate(line).valid === true
//   5. the same holds for a defaults-only line (toLine({}))
//
// Randomness is a seeded LCG so a failure always reproduces: the seed is part
// of every assertion message.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CnabSpec, FieldType } = require('../lib/index.js');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);
const spec = CnabSpec.fromJson(specJson);
const specDoc = JSON.parse(specJson);

/** Record keys of everything actually shipped (templates are copy-from sources). */
const shippedKeys = Object.keys(specDoc.records).filter(
  (k) => specDoc.records[k].meta.template !== true
);

const ITERATIONS = 12;

// --- deterministic PRNG -----------------------------------------------------

/** Numerical Recipes LCG — tiny, deterministic, good enough for fuzz values. */
function lcg(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Stable 32-bit hash so each record gets its own reproducible seed. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- value generators -------------------------------------------------------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomInt(rnd, maxExclusive) {
  return Math.floor(rnd() * maxExclusive);
}

/**
 * Uppercase A-Z / space text of at most `width` characters. Trailing spaces are
 * dropped because `parse` right-trims alpha fields: keeping them would make the
 * *values* differ across a round-trip (the produced *line* stays identical).
 */
function alphaValue(rnd, width) {
  const len = randomInt(rnd, width + 1);
  let out = '';
  for (let i = 0; i < len; i++) {
    // ~1 in 8 characters is a space, so multi-word text is exercised too
    out += randomInt(rnd, 8) === 0 ? ' ' : LETTERS[randomInt(rnd, 26)];
  }
  return out.replace(/\s+$/, '');
}

/** Digit string of at most `width` digits (never wider — toLine may be strict). */
function numericValue(rnd, width) {
  const len = 1 + randomInt(rnd, width);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String(randomInt(rnd, 10));
  }
  return out;
}

function generateValues(rec, rnd) {
  const values = {};
  for (const f of rec.spec.fields) {
    const width = f.end - f.start + 1;
    values[f.name] =
      f.fieldType === FieldType.ALPHA
        ? alphaValue(rnd, width)
        : numericValue(rnd, width);
  }
  return values;
}

/** How `toLine` is specified to render a value into its fixed-width slot. */
function expectedSlot(field, value) {
  const width = field.end - field.start + 1;
  if (field.fieldType === FieldType.ALPHA) {
    return value.substring(0, width).padEnd(width, ' ');
  }
  return value.padStart(width, '0');
}

// --- the properties ---------------------------------------------------------

function checkLine(rec, key, line, where) {
  assert.strictEqual(
    line.length,
    rec.spec.lineLength,
    `${key} ${where}: line length ${line.length} != meta.lineLength ${rec.spec.lineLength}`
  );

  const rebuilt = rec.toLine(rec.parse(line));
  if (rebuilt !== line) {
    let pos = 0;
    while (pos < line.length && line[pos] === rebuilt[pos]) pos++;
    const field = rec.spec.fields.find((f) => f.start <= pos + 1 && f.end >= pos + 1);
    assert.fail(
      `${key} ${where}: parse -> toLine is not idempotent; first difference at ` +
        `position ${pos + 1} (field "${field ? field.name : '?'}") ` +
        `${JSON.stringify(line.substring(pos, pos + 12))} != ` +
        `${JSON.stringify(rebuilt.substring(pos, pos + 12))}`
    );
  }

  const result = rec.validate(line);
  assert.strictEqual(
    result.valid,
    true,
    `${key} ${where}: validate rejected a generated line: ${result.errors.join('; ')}`
  );
}

test('every shipped record is covered by the property tests', () => {
  assert.ok(
    shippedKeys.length >= 37,
    `expected at least 37 shipped records, found ${shippedKeys.length}`
  );
  for (const key of shippedKeys) {
    assert.ok(spec.hasRecord(key), `spec.getRecord missing shipped key ${key}`);
  }
});

test('shipped records declare gapless, in-order positional coverage', () => {
  for (const key of shippedKeys) {
    const rec = spec.getRecord(key);
    let cursor = 1;
    for (const f of rec.spec.fields) {
      assert.strictEqual(
        f.start,
        cursor,
        `${key}: field "${f.name}" starts at ${f.start}, expected ${cursor} ` +
          '(fields must be listed in positional order with no gaps — toLine ' +
          'concatenates them in declaration order)'
      );
      assert.ok(f.end >= f.start, `${key}: field "${f.name}" has end < start`);
      cursor = f.end + 1;
    }
    assert.strictEqual(
      cursor - 1,
      rec.spec.lineLength,
      `${key}: fields cover ${cursor - 1} positions, expected ${rec.spec.lineLength}`
    );
  }
});

for (const key of shippedKeys) {
  test(`property: ${key}`, () => {
    const rec = spec.getRecord(key);
    const baseSeed = hashSeed(key);

    // --- defaults only ------------------------------------------------------
    checkLine(rec, key, rec.toLine({}), 'defaults-only');

    // --- generated values ---------------------------------------------------
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const seed = (baseSeed + iteration) >>> 0;
      const rnd = lcg(seed);
      const values = generateValues(rec, rnd);
      const line = rec.toLine(values);
      const where = `seed ${seed} (iteration ${iteration})`;

      checkLine(rec, key, line, where);

      // every field must land exactly on its declared positions
      for (const f of rec.spec.fields) {
        assert.strictEqual(
          line.substring(f.start - 1, f.end),
          expectedSlot(f, values[f.name]),
          `${key} ${where}: field "${f.name}" is not rendered at positions ` +
            `${f.start}-${f.end}`
        );
      }

      // parsed values round-trip back to the same values for full-width use
      const parsed = rec.parse(line);
      for (const f of rec.spec.fields) {
        if (f.fieldType === FieldType.ALPHA) {
          assert.strictEqual(
            parsed[f.name],
            values[f.name],
            `${key} ${where}: alpha field "${f.name}" did not survive the round-trip`
          );
        } else {
          const expected = values[f.name].replace(/^0+/, '') || '0';
          assert.strictEqual(
            parsed[f.name],
            expected,
            `${key} ${where}: numeric field "${f.name}" did not survive the round-trip`
          );
        }
      }
    }
  });
}
