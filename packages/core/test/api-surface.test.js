'use strict';
// Guards the multi-language public API (ADR 0002).
//
// The engine is authored once and projected to Node/.NET/Python/Java by jsii,
// so a change to the public surface is a change to four published packages at
// once. jsii itself only tells us the API is *expressible*; these tests tell us
// whether it *changed*, and re-assert the naming rules we have already been
// bitten by (`build`, `type`, `setX`).
//
// When a diff here is intentional: run
//   node packages/core/test/generate-api-surface.cjs
// and review the snapshot diff as a breaking-change review.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readSurface } = require('./api-surface.cjs');

const SNAPSHOT = path.resolve(__dirname, 'api-surface.json');
const surface = readSurface();

test('public API matches the committed snapshot', () => {
  assert.ok(
    fs.existsSync(SNAPSHOT),
    `missing ${SNAPSHOT} — run node packages/core/test/generate-api-surface.cjs`
  );
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  assert.deepStrictEqual(
    surface,
    expected,
    'public API surface changed. If this is intentional, regenerate the ' +
      'snapshot (node packages/core/test/generate-api-surface.cjs) and treat ' +
      'the diff as a breaking change for Node/.NET/Python/Java consumers.'
  );
});

test('no public member uses a jsii-prohibited name', () => {
  // Each of these has actually broken the build before — see AGENTS.md.
  const offenders = [];
  for (const [typeName, type] of Object.entries(surface)) {
    for (const m of type.members) {
      const name = m.replace(/^(static |enum )/, '').replace(/[(:].*$/, '');
      if (name === 'build') {
        offenders.push(`${typeName}.${name} — "build" is prohibited by jsii (use toLine/toFileContent)`);
      }
      if (name === 'type') {
        offenders.push(`${typeName}.${name} — "type" is a Go reserved word (use fieldType)`);
      }
      if (/^set[A-Z]/.test(name) && !m.startsWith('static ')) {
        // setDecimal/setDateIso take the value map as their first argument, so
        // they are plain methods, not Java-style property setters. jsii accepts
        // those; it rejects a one-argument setX that shadows a property X.
        const prop = name.slice(3);
        const clashes = type.members.some((other) =>
          new RegExp(`^${prop.charAt(0).toLowerCase()}${prop.slice(1)}:`).test(other)
        );
        if (clashes) {
          offenders.push(`${typeName}.${name} — collides with property ${prop} (JSII5001)`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('no public API member exposes a union type', () => {
  // jsii cannot project unions; catching it here gives a clearer message than
  // the compiler's, and keeps ADR 0002's boundary rules honest.
  const unions = [];
  for (const [typeName, type] of Object.entries(surface)) {
    for (const m of type.members) {
      if (m.includes('|')) unions.push(`${typeName}: ${m}`);
    }
  }
  assert.deepStrictEqual(unions, []);
});

test('the documented entry points are all present', () => {
  // A cheap, explicit smoke list: renaming or dropping one of these silently
  // would break every README/example even if the snapshot were regenerated.
  const required = {
    CnabRecord: ['static fromJson', 'parse', 'toLine', 'toLineWithOptions', 'validate'],
    CnabSpec: ['static fromJson', 'recordKeys', 'getRecord', 'getCodeTable', 'lookupCode'],
    CnabFile: ['static forBank', 'static detect', 'static detectScope', 'parse'],
    CnabFileBuilder: ['static forBank', 'withHeader', 'addDetail', 'toFileContent'],
    Modulo: ['static mod10', 'static mod11', 'static mod11Boleto'],
    Boleto: ['static barcode', 'static linhaDigitavel', 'static parseLinhaDigitavel'],
  };
  for (const [typeName, members] of Object.entries(required)) {
    assert.ok(surface[typeName], `missing public type ${typeName}`);
    for (const m of members) {
      const found = surface[typeName].members.some((x) => x.startsWith(`${m}(`));
      assert.ok(found, `missing ${typeName}.${m}`);
    }
  }
});
