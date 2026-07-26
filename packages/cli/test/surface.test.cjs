'use strict';
// Guards the CLI's command surface against silent drift.
//
// The CLI fell behind the engine once already: `CnabFile.detect`,
// `CnabFileBuilder`, `Boleto` and the code tables all shipped while `cnab`
// still offered only records/parse/build/validate. These tests make the two
// halves of that drift visible: a command that exists but is undocumented, and
// a documented command that does not exist.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BIN = path.resolve(__dirname, '../bin/cnab.mjs');
const SOURCE = fs.readFileSync(BIN, 'utf8');
const help = execFileSync('node', [BIN, 'help'], { encoding: 'utf8' });

/**
 * Commands the dispatcher actually accepts. Determined behaviourally by
 * invoking each candidate and checking the CLI does not reject it as unknown —
 * the dispatcher mixes `if (cmd === 'x')` and `switch/case`, so scraping the
 * source would silently miss whichever style a new command happens to use.
 * (Commands still fail here for missing arguments; that is fine, we only care
 * that they are recognised.)
 */
function isImplemented(cmd) {
  try {
    execFileSync('node', [BIN, cmd], { stdio: 'pipe' });
    return true; // ran cleanly
  } catch (e) {
    return !/unknown command/.test(e.stderr.toString('utf8'));
  }
}

/** Command names mentioned in the source dispatcher, either dispatch style. */
function dispatchedCommands() {
  const names = [
    ...SOURCE.matchAll(/case '([a-z-]+)':/g),
    ...SOURCE.matchAll(/cmd === '([a-z-]+)'/g),
  ].map((m) => m[1]);
  return [...new Set(names)].filter((c) => c !== 'help').sort();
}

function implementedCommands() {
  return dispatchedCommands();
}

test('every implemented command is documented in help', () => {
  const undocumented = implementedCommands().filter(
    (cmd) => !new RegExp(`\\bcnab ${cmd}\\b`).test(help)
  );
  assert.deepStrictEqual(
    undocumented,
    [],
    'commands exist but are missing from the HELP text'
  );
});

test('every command listed in help is actually implemented', () => {
  const documented = [
    ...new Set([...help.matchAll(/^\s{2}cnab ([a-z-]+)/gm)].map((m) => m[1])),
  ].filter((c) => c !== 'help');
  const missing = documented.filter((c) => !isImplemented(c));
  assert.deepStrictEqual(missing, [], 'help documents commands the CLI rejects');
});

test('the engine-parity commands are present', () => {
  // Explicit list: these are the ones the CLI was missing before, so a
  // regression here is the exact failure we are guarding against.
  for (const cmd of ['detect', 'parse-file', 'tables', 'code', 'boleto']) {
    assert.ok(
      isImplemented(cmd),
      `CLI lost the "${cmd}" command — it is part of engine parity`
    );
  }
});

test('help documents the global I/O options', () => {
  for (const flag of [
    '--encoding',
    '--out',
    '--crlf',
    '--trailing-newline',
    '--pretty',
  ]) {
    assert.ok(help.includes(flag), `help does not document ${flag}`);
  }
  // latin1 being the default is a correctness-relevant promise, not a detail:
  // reading a real CNAB file as UTF-8 misaligns every position after an accent.
  assert.match(help, /Default: latin1/);
});

test('an unknown command fails with a non-zero exit and a clear message', () => {
  let threw = false;
  try {
    execFileSync('node', [BIN, 'definitely-not-a-command'], { stdio: 'pipe' });
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('utf8'), /unknown command/);
  }
  assert.ok(threw, 'unknown commands must not exit 0');
});
