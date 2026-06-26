'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BIN = path.resolve(__dirname, '../bin/cnab.mjs');
const RECORD = 'cnab240/104/sigcb/header_arquivo';

function run(args, input) {
  return execFileSync('node', [BIN, ...args], {
    input: input ?? '',
    encoding: 'utf8',
  });
}

test('records lists keys filtered by bank', () => {
  const out = run(['records', '--bank', '104']);
  const keys = out.trim().split('\n');
  assert.ok(keys.includes(RECORD));
  assert.ok(keys.every((k) => k.split('/')[1] === '104'));
});

const stripNl = (s) => s.replace(/\n$/, ''); // keep significant trailing spaces

test('build then parse round-trips through the CLI', () => {
  const built = stripNl(run(['build', '--record', RECORD], '{"codigo_banco":"104"}'));
  assert.strictEqual(built.length, 240);
  assert.strictEqual(built.substring(0, 3), '104');

  const parsed = JSON.parse(run(['parse', '--record', RECORD, '--line', built]));
  assert.strictEqual(parsed.codigo_banco, '104');
});

test('validate reports OK and INVALID with exit code', () => {
  const line = stripNl(run(['build', '--record', RECORD], '{"codigo_banco":"104"}'));
  const ok = run(['validate', '--record', RECORD, '--line', line]);
  assert.match(ok, /OK/);

  let threw = false;
  try {
    run(['validate', '--record', RECORD, '--line', 'too-short']);
  } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 2);
    assert.match(e.stdout, /INVALID/);
  }
  assert.ok(threw, 'validate should exit non-zero on invalid input');
});

test('unknown record fails clearly', () => {
  let threw = false;
  try {
    run(['parse', '--record', 'cnab240/999/nope', '--line', 'x']);
  } catch (e) {
    threw = true;
    assert.match(e.stderr, /unknown record/);
  }
  assert.ok(threw);
});
