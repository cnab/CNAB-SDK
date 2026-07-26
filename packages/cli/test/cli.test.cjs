'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.resolve(__dirname, '../bin/cnab.mjs');
const RECORD = 'cnab240/104/sigcb/header_arquivo';

/**
 * `fixtures/` holds the same 6-line Caixa 104 SIGCB CNAB240 remessa file (built
 * with CnabFileBuilder, accented names JOSÉ / SÃO PAULO / ECONÔMICA) in four
 * on-disk shapes, written as real bytes:
 *
 *   latin1-remessa.txt       latin1, LF,   no trailing newline (the canonical one)
 *   latin1-crlf-remessa.txt  latin1, CRLF, trailing newline
 *   bom-latin1-remessa.txt   latin1, LF,   preceded by the UTF-8 BOM EF BB BF
 *   utf8-remessa.txt         UTF-8,  LF,   no trailing newline
 */
const FIXTURES = path.resolve(__dirname, 'fixtures');

/** Run the CLI and return stdout as a **Buffer** (the CLI writes raw bytes). */
function runRaw(args, input) {
  return execFileSync('node', [BIN, ...args], { input: input ?? Buffer.alloc(0) });
}

/** Run the CLI and decode stdout with `enc` (default latin1, the CLI default). */
function run(args, input, enc) {
  return runRaw(args, input).toString(enc || 'latin1');
}

const stripNl = (s) => s.replace(/\r?\n$/, ''); // keep significant trailing spaces
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

// ---------------------------------------------------------------------------
// existing behaviour
// ---------------------------------------------------------------------------

test('records lists keys filtered by bank', () => {
  const out = run(['records', '--bank', '104']);
  const keys = out.trim().split('\n');
  assert.ok(keys.includes(RECORD));
  assert.ok(keys.every((k) => k.split('/')[1] === '104'));
});

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
    assert.match(e.stdout.toString('latin1'), /INVALID/);
  }
  assert.ok(threw, 'validate should exit non-zero on invalid input');
});

test('unknown record fails clearly', () => {
  let threw = false;
  try {
    run(['parse', '--record', 'cnab240/999/nope', '--line', 'x']);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /unknown record/);
  }
  assert.ok(threw);
});

// ---------------------------------------------------------------------------
// encoding & I/O robustness (issue #10)
// ---------------------------------------------------------------------------

test('latin1 is the default and accented names decode correctly', () => {
  const out = run(['parse-file', '--file', path.join(FIXTURES, 'latin1-remessa.txt')]);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed[0].fields.nome_empresa, 'JOSÉ DA SILVA & CIA LTDA');
  assert.strictEqual(parsed[0].fields.nome_banco, 'CAIXA ECONÔMICA FEDERAL');
  assert.strictEqual(parsed[1].fields.mensagem_1, 'COBRANÇA SÃO PAULO');
  assert.strictEqual(parsed[1].fields.mensagem_2, 'AV. PAULISTA 1000 - SÃO PAULO/SP');
  // one char == one byte in latin1, so the fixed-width positions still hold
  assert.strictEqual(parsed[0].fields.codigo_banco, '104');
});

test('a latin1 file round-trips byte-for-byte through parse-file and build', () => {
  const file = path.join(FIXTURES, 'latin1-remessa.txt');
  const original = fixture('latin1-remessa.txt');

  const parsed = JSON.parse(run(['parse-file', '--file', file]));
  assert.strictEqual(parsed.length, 6);

  const rebuilt = parsed.map((p) => {
    assert.notStrictEqual(p.recordKey, '', 'every line must be classified');
    // the JSON goes back in as latin1 bytes, exactly as the CLI printed it
    const input = Buffer.from(JSON.stringify(p.fields), 'latin1');
    return runRaw(['build', '--record', p.recordKey], input);
  });

  const joined = Buffer.from(
    rebuilt.map((b) => b.toString('latin1')).join('\n'),
    'latin1'
  );
  assert.deepStrictEqual(joined, original);
});

test('a single latin1 line round-trips byte-for-byte through parse and build', () => {
  const original = fixture('latin1-remessa.txt').subarray(0, 240);
  const tmp = path.join(os.tmpdir(), `cnab-cli-line-${process.pid}.txt`);
  fs.writeFileSync(tmp, original);
  try {
    const json = runRaw(['parse', '--record', RECORD, '--file', tmp]);
    const built = runRaw(['build', '--record', RECORD], json);
    assert.deepStrictEqual(built, original);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('--encoding utf8 reads and writes UTF-8', () => {
  const file = path.join(FIXTURES, 'utf8-remessa.txt');
  const parsed = JSON.parse(
    run(['parse-file', '--file', file, '--encoding', 'utf8'], null, 'utf8')
  );
  assert.strictEqual(parsed[0].fields.nome_empresa, 'JOSÉ DA SILVA & CIA LTDA');

  // and the same file read as latin1 (the default) is misaligned: the two
  // accented bytes of each UTF-8 char make the first line 242 chars long
  let threw = false;
  try {
    run(['detect', '--file', file]);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /242 characters long/);
  }
  assert.ok(threw, 'a UTF-8 file must not silently decode as latin1');
});

test('output is encoded with --encoding (latin1 by default)', () => {
  // --encoding drives both sides, so read each fixture in its own encoding:
  // the resulting *text* is identical, the resulting *bytes* are not.
  const asLatin1 = runRaw([
    'parse-file',
    '--file',
    path.join(FIXTURES, 'latin1-remessa.txt'),
  ]);
  const asUtf8 = runRaw([
    'parse-file',
    '--file',
    path.join(FIXTURES, 'utf8-remessa.txt'),
    '--encoding',
    'utf8',
  ]);
  assert.strictEqual(asLatin1.toString('latin1'), asUtf8.toString('utf8'));
  assert.ok(asUtf8.length > asLatin1.length, 'UTF-8 spends 2 bytes per accented char');
  assert.ok(asLatin1.includes(Buffer.from('JOSÉ', 'latin1')));
  assert.ok(!asLatin1.includes(Buffer.from('JOSÉ', 'utf8')));
  assert.ok(asUtf8.includes(Buffer.from('JOSÉ', 'utf8')));
});

test('CRLF input parses like LF input', () => {
  const lf = JSON.parse(
    run(['parse-file', '--file', path.join(FIXTURES, 'latin1-remessa.txt')])
  );
  const crlf = JSON.parse(
    run(['parse-file', '--file', path.join(FIXTURES, 'latin1-crlf-remessa.txt')])
  );
  assert.deepStrictEqual(crlf, lf);
  assert.strictEqual(crlf.length, 6);

  // ...and through the single-record commands too (the trailing CRLF must not
  // produce a 7th, empty line)
  const lines = JSON.parse(
    run([
      'parse',
      '--record',
      RECORD,
      '--file',
      path.join(FIXTURES, 'latin1-crlf-remessa.txt'),
    ])
  );
  assert.strictEqual(lines.length, 6);
  assert.strictEqual(lines[0].codigo_banco, '104');
  assert.strictEqual(lines[0].nome_empresa, 'JOSÉ DA SILVA & CIA LTDA');
});

test('a leading UTF-8 BOM is stripped and positions are not shifted', () => {
  const withBom = JSON.parse(
    run(['parse-file', '--file', path.join(FIXTURES, 'bom-latin1-remessa.txt')])
  );
  const without = JSON.parse(
    run(['parse-file', '--file', path.join(FIXTURES, 'latin1-remessa.txt')])
  );
  assert.deepStrictEqual(withBom, without);
  assert.strictEqual(withBom[0].recordKey, RECORD);
  assert.strictEqual(withBom[0].fields.codigo_banco, '104');

  // detect works on the BOM'd file as well
  assert.deepStrictEqual(
    JSON.parse(run(['detect', '--file', path.join(FIXTURES, 'bom-latin1-remessa.txt')])),
    JSON.parse(run(['detect', '--file', path.join(FIXTURES, 'latin1-remessa.txt')]))
  );
});

test('build emits LF and no trailing newline by default', () => {
  const input = '[{"codigo_banco":"104"},{"codigo_banco":"104"}]';
  const out = runRaw(['build', '--record', RECORD], input).toString('latin1');
  assert.strictEqual(out.length, 240 * 2 + 1);
  assert.strictEqual(out.charAt(240), '\n');
  assert.ok(!out.endsWith('\n'), 'no trailing newline by default');
});

test('--crlf and --trailing-newline shape the output', () => {
  const input = '[{"codigo_banco":"104"},{"codigo_banco":"104"}]';

  const crlf = runRaw(['build', '--record', RECORD, '--crlf'], input).toString('latin1');
  assert.strictEqual(crlf.length, 240 * 2 + 2);
  assert.strictEqual(crlf.substring(240, 242), '\r\n');
  assert.ok(!crlf.endsWith('\n'));

  const lfNl = runRaw(
    ['build', '--record', RECORD, '--trailing-newline'],
    input
  ).toString('latin1');
  assert.strictEqual(lfNl.length, 240 * 2 + 2);
  assert.ok(lfNl.endsWith('\n') && !lfNl.endsWith('\r\n'));

  const both = runRaw(
    ['build', '--record', RECORD, '--crlf', '--trailing-newline'],
    input
  ).toString('latin1');
  assert.strictEqual(both.length, 240 * 2 + 4);
  assert.ok(both.endsWith('\r\n'));
  assert.strictEqual(both.split('\r\n').length, 3);
});

test('--out writes the encoded bytes to a file', () => {
  const tmp = path.join(os.tmpdir(), `cnab-cli-out-${process.pid}.txt`);
  try {
    const stdout = runRaw(
      ['build', '--record', RECORD, '--out', tmp, '--trailing-newline'],
      Buffer.from('{"codigo_banco":"104","nome_empresa":"JOSÉ & CIA"}', 'latin1')
    );
    assert.strictEqual(stdout.length, 0, 'nothing goes to stdout with --out');
    const written = fs.readFileSync(tmp);
    assert.strictEqual(written.length, 241);
    assert.ok(written.includes(Buffer.from('JOSÉ & CIA', 'latin1')));
    assert.ok(!written.includes(Buffer.from('JOSÉ', 'utf8')));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});

test('--encoding rejects unsupported values', () => {
  let threw = false;
  try {
    run(['records', '--encoding', 'cp500']);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /unsupported --encoding/);
  }
  assert.ok(threw);
});

// ---------------------------------------------------------------------------
// CLI catch-up: detect / parse-file / tables / code / boleto
// ---------------------------------------------------------------------------

test('detect prints the detected scope as JSON', () => {
  const out = run(['detect', '--file', path.join(FIXTURES, 'latin1-remessa.txt')]);
  assert.deepStrictEqual(JSON.parse(out), {
    layout: 'cnab240',
    bank: '104',
    variant: 'sigcb',
    direction: 'remessa',
  });
  // --pretty indents
  const pretty = run([
    'detect',
    '--file',
    path.join(FIXTURES, 'latin1-remessa.txt'),
    '--pretty',
  ]);
  assert.match(pretty, /\n {2}"layout": "cnab240"/);
});

test('detect reads stdin and fails clearly on garbage', () => {
  const out = run(['detect'], fixture('latin1-remessa.txt'));
  assert.strictEqual(JSON.parse(out).bank, '104');

  let threw = false;
  try {
    run(['detect', '--line', 'hello world']);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /cannot detect CNAB layout/);
  }
  assert.ok(threw);
});

test('parse-file auto-detects the scope and parses every line', () => {
  const out = run(['parse-file', '--file', path.join(FIXTURES, 'latin1-remessa.txt')]);
  const parsed = JSON.parse(out);
  assert.deepStrictEqual(
    parsed.map((p) => p.recordKey),
    [
      'cnab240/104/sigcb/header_arquivo',
      'cnab240/104/sigcb/header_lote',
      'cnab240/104/sigcb/remessa/detalhe_segmento_p',
      'cnab240/104/sigcb/remessa/detalhe_segmento_r',
      'cnab240/104/sigcb/trailer_lote',
      'cnab240/104/sigcb/trailer_arquivo',
    ]
  );
  assert.deepStrictEqual(Object.keys(parsed[0]), [
    'recordKey',
    'tipo',
    'segment',
    'fields',
  ]);
  assert.strictEqual(parsed[2].tipo, '3');
  assert.strictEqual(parsed[2].segment, 'P');
  assert.strictEqual(parsed[2].fields.valor_titulo, '150000');
});

test('parse-file honours explicit scope flags over detection', () => {
  const file = path.join(FIXTURES, 'latin1-remessa.txt');
  const explicit = JSON.parse(
    run([
      'parse-file',
      '--file',
      file,
      '--layout',
      'cnab240',
      '--bank',
      '104',
      '--variant',
      'sigcb',
      '--direction',
      'remessa',
    ])
  );
  assert.deepStrictEqual(explicit, JSON.parse(run(['parse-file', '--file', file])));

  // a wrong-but-valid scope is used verbatim instead of the detected one
  const wrong = JSON.parse(
    run(['parse-file', '--file', file, '--layout', 'cnab400', '--bank', '341'])
  );
  assert.notDeepStrictEqual(wrong, explicit);
  assert.ok(
    wrong.every((p) => p.recordKey === '' || p.recordKey.startsWith('cnab400/341/')),
    `unexpected keys: ${wrong.map((p) => p.recordKey).join(',')}`
  );

  let threw = false;
  try {
    run(['parse-file', '--file', file, '--layout', 'cnab999', '--bank', '104']);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /unknown layout/);
  }
  assert.ok(threw);
});

test('tables lists code-table keys and --grep filters them', () => {
  const all = run(['tables']).trim().split('\n');
  assert.ok(all.includes('cnab400/104/retorno/codigo_ocorrencia'));
  assert.ok(all.includes('cnab240/generic/especie_titulo'));

  const filtered = run(['tables', '--grep', 'especie']).trim().split('\n');
  assert.deepStrictEqual(filtered, ['cnab240/generic/especie_titulo']);
});

test('code prints a description and fails on unknown keys/codes', () => {
  const desc = run(['code', 'cnab400/104/retorno/codigo_ocorrencia', '02']).trim();
  assert.strictEqual(desc, 'Baixa Confirmada');
  // the lookup normalizes padding: "2" resolves like "02"
  assert.strictEqual(
    run(['code', 'cnab400/104/retorno/codigo_ocorrencia', '2']).trim(),
    desc
  );

  let threw = false;
  try {
    run(['code', 'nope/table', '02']);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /unknown code table/);
  }
  assert.ok(threw);

  threw = false;
  try {
    run(['code', 'cnab400/104/retorno/codigo_ocorrencia', '9999']);
  } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 2);
    assert.match(e.stderr.toString('latin1'), /unknown code "9999"/);
  }
  assert.ok(threw);
});

test('boleto barcode prints the barcode and linha digitável', () => {
  const out = run([
    'boleto',
    'barcode',
    '--bank',
    '104',
    '--currency',
    '9',
    '--due',
    '2026-08-30',
    '--amount',
    '150000',
    '--free',
    '1234567890123456789012345',
  ]);
  const barcode = /^barcode: (\d{44})$/m.exec(out);
  const linha = /^linha: (\d{47})$/m.exec(out);
  const formatted = /^formatted: (.+)$/m.exec(out);
  assert.ok(barcode, `no barcode line in:\n${out}`);
  assert.ok(linha, `no linha line in:\n${out}`);
  assert.ok(formatted);
  assert.strictEqual(barcode[1].substring(0, 4), '1049');
  assert.strictEqual(barcode[1].substring(19), '1234567890123456789012345');
  assert.match(formatted[1], /^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);

  // --currency defaults to 9
  const dflt = run([
    'boleto',
    'barcode',
    '--bank',
    '104',
    '--due',
    '2026-08-30',
    '--amount',
    '150000',
    '--free',
    '1234567890123456789012345',
  ]);
  assert.strictEqual(dflt, out);
});

test('boleto parse recovers the barcode and reports validity', () => {
  const built = run([
    'boleto',
    'barcode',
    '--bank',
    '104',
    '--due',
    '2026-08-30',
    '--amount',
    '150000',
    '--free',
    '1234567890123456789012345',
  ]);
  const barcode = /^barcode: (\d{44})$/m.exec(built)[1];
  const linha = /^linha: (\d{47})$/m.exec(built)[1];
  const formatted = /^formatted: (.+)$/m.exec(built)[1];

  const parsed = run(['boleto', 'parse', linha]);
  assert.match(parsed, new RegExp(`^barcode: ${barcode}$`, 'm'));
  assert.match(parsed, /^valid: true$/m);
  // the formatted mask is accepted too (as one argv token or several)
  assert.strictEqual(run(['boleto', 'parse', formatted]), parsed);
  assert.strictEqual(run(['boleto', 'parse', ...formatted.split(' ')]), parsed);
});

test('boleto reports bad input clearly', () => {
  let threw = false;
  try {
    run(['boleto', 'parse', '1'.repeat(47)]);
  } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 2);
    assert.match(e.stderr.toString('latin1'), /check digit mismatch/);
  }
  assert.ok(threw);

  threw = false;
  try {
    run([
      'boleto',
      'barcode',
      '--bank',
      '104',
      '--due',
      '2026-08-30',
      '--amount',
      '150000',
    ]);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /missing --free/);
  }
  assert.ok(threw);

  threw = false;
  try {
    run(['boleto', 'nonsense']);
  } catch (e) {
    threw = true;
    assert.match(e.stderr.toString('latin1'), /usage: cnab boleto/);
  }
  assert.ok(threw);
});

test('help documents the new commands and the latin1 default', () => {
  // help and diagnostics are always UTF-8, independently of --encoding
  const help = run(['help'], null, 'utf8');
  assert.ok(help.includes('JOSÉ, SÃO PAULO'));
  for (const cmd of [
    'detect',
    'parse-file',
    'tables',
    'code',
    'boleto barcode',
    'boleto parse',
  ]) {
    assert.ok(help.includes(cmd), `help should mention "${cmd}"`);
  }
  assert.match(help, /--encoding latin1\|utf8/);
  assert.match(help, /Default: latin1/);
  assert.match(help, /--crlf/);
  assert.match(help, /--trailing-newline/);
  assert.strictEqual(run([], null, 'utf8'), help);
});
