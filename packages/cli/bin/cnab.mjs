#!/usr/bin/env node
// @cnab/cli — inspect, parse, build and validate CNAB 240/400 files.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Boleto, CnabFile, CnabSpec } from '@cnab/core';

const require = createRequire(import.meta.url);

let specJsonCache = null;

function loadSpecJson() {
  if (specJsonCache !== null) return specJsonCache;
  let specPath;
  try {
    specPath = require.resolve('@cnab/spec'); // package main -> dist/spec.json
  } catch {
    specPath = null;
  }
  if (!specPath || !fs.existsSync(specPath)) {
    fail('compiled spec not found. Run `npm run build:spec` at the repo root first.');
  }
  // The compiled spec is ASCII/UTF-8 JSON — unrelated to the --encoding of
  // the CNAB data files the CLI reads and writes.
  specJsonCache = fs.readFileSync(specPath, 'utf8');
  return specJsonCache;
}

function loadSpec() {
  return CnabSpec.fromJson(loadSpecJson());
}

function fail(msg, code = 1) {
  process.stderr.write(`cnab: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

/** A flag's string value, or `undefined` when absent / used as a bare switch. */
function opt(value) {
  return value === undefined || value === true ? undefined : String(value);
}

function required(value, flag) {
  const v = opt(value);
  if (v === undefined || v === '') fail(`missing ${flag}`);
  return v;
}

// ---------------------------------------------------------------------------
// Encoding / I/O
// ---------------------------------------------------------------------------

// Real CNAB files are Latin-1 (ISO-8859-1 / Windows-1252), not UTF-8: accented
// names such as JOSÉ or SÃO PAULO are one byte per character there, which is
// what keeps the fixed-width positions aligned. Hence latin1 is the default.
const ENCODINGS = {
  latin1: 'latin1',
  'iso-8859-1': 'latin1',
  utf8: 'utf8',
  'utf-8': 'utf8',
};

function resolveEncoding(args) {
  if (args.encoding === undefined) return 'latin1';
  if (args.encoding === true) fail('--encoding requires a value (latin1|utf8)');
  const enc = ENCODINGS[String(args.encoding).toLowerCase()];
  if (!enc) fail(`unsupported --encoding "${args.encoding}" (use latin1 or utf8)`);
  return enc;
}

/** Drop the UTF-8 BOM byte sequence (EF BB BF) before decoding. */
function stripBomBytes(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
    ? buf.subarray(3)
    : buf;
}

/** Drop a decoded BOM character (U+FEFF), which would shift every position. */
function stripBomChar(str) {
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

function readInput(args, enc) {
  if (args.file !== undefined) {
    if (args.file === true) fail('--file requires a path');
    let buf;
    try {
      buf = fs.readFileSync(args.file);
    } catch (e) {
      fail(`cannot read "${args.file}": ${e.message}`);
    }
    return stripBomChar(stripBomBytes(buf).toString(enc));
  }
  if (args.line != null && args.line !== true) return stripBomChar(String(args.line));
  // stdin
  let buf;
  try {
    buf = fs.readFileSync(0);
  } catch {
    buf = Buffer.alloc(0);
  }
  return stripBomChar(stripBomBytes(buf).toString(enc));
}

function applyEol(str, args) {
  const normalized = str.replace(/\r\n/g, '\n');
  return args.crlf ? normalized.replace(/\n/g, '\r\n') : normalized;
}

function writeBytes(str, args, enc) {
  const buf = Buffer.from(str, enc);
  const out = opt(args.out);
  if (out !== undefined) {
    try {
      fs.writeFileSync(out, buf);
    } catch (e) {
      fail(`cannot write "${out}": ${e.message}`);
    }
    return;
  }
  process.stdout.write(buf);
}

/** Informational output (listings, JSON, reports): always newline-terminated. */
function emitText(text, args, enc) {
  writeBytes(applyEol(text.endsWith('\n') ? text : `${text}\n`, args), args, enc);
}

function emitJson(value, args, enc) {
  emitText(JSON.stringify(value, null, args.pretty ? 2 : 0), args, enc);
}

/**
 * CNAB file content: lines joined with the selected EOL and, matching
 * `CnabFileBuilder.toFileContent`, no trailing newline unless asked for.
 */
function emitContent(text, args, enc) {
  let body = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (args['trailing-newline']) body += '\n';
  writeBytes(applyEol(body, args), args, enc);
}

function splitLines(text) {
  return text.split(/\r?\n/).filter((l) => l.length > 0);
}

function requireRecord(spec, key) {
  if (!key || key === true) fail('missing --record <key> (see `cnab records`)');
  if (!spec.hasRecord(key)) fail(`unknown record "${key}" (see \`cnab records\`)`);
  return spec.getRecord(key);
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `cnab — CNAB 240/400 toolkit

Usage:
  cnab records    [--layout cnab240|cnab400] [--bank 104] [--grep p]
  cnab parse      --record <key> [--file <path> | --line <text> | stdin] [--pretty]
  cnab build      --record <key> [--file <json> | stdin]   (JSON object or array of objects)
  cnab validate   --record <key> [--file <path> | --line <text> | stdin]
  cnab detect     [--file <path> | stdin] [--pretty]
  cnab parse-file [--file <path> | stdin] [--pretty]
                  [--layout <l>] [--bank <b>] [--variant <v>] [--direction <d>]
  cnab tables     [--grep <text>]
  cnab code       <tableKey> <code>
  cnab boleto barcode --bank <3d> [--currency 9] --due <YYYY-MM-DD>
                      --amount <cents> --free <25d>
  cnab boleto parse   <linhaDigitavel>

A <key> looks like: cnab240/104/sigcb/header_arquivo

Global I/O options:
  --encoding latin1|utf8   encoding used to DECODE input and ENCODE output.
                           Default: latin1 (ISO-8859-1) — real CNAB files are
                           Latin-1/Windows-1252, and one char == one byte there,
                           so accented names (JOSÉ, SÃO PAULO) keep the
                           fixed-width positions aligned.
  --out <file>             write the output to a file instead of stdout.
  --crlf                   emit CRLF line endings (default: LF).
  --trailing-newline       append a final newline to generated CNAB content
                           (default: none, matching CnabFileBuilder).
  --pretty                 indent JSON output.

A leading UTF-8 BOM in the input is stripped before parsing (it would
otherwise shift every position by one). CRLF input is accepted everywhere.
--encoding applies to data only; this help text and error messages are
always written as UTF-8.

Commands:
  records      list record keys known to the compiled spec
  parse        parse fixed-width line(s) with an explicit record spec
  build        build fixed-width line(s) from JSON field maps
  validate     check line length and numeric fields; exit 2 when invalid
  detect       print the detected {layout, bank, variant, direction} as JSON
  parse-file   auto-detect the scope and parse a WHOLE file, printing an array
               of {recordKey, tipo, segment, fields}; --layout/--bank/--variant/
               --direction override detection
  tables       list code-table keys
  code         print a code's description from a code table
  boleto       FEBRABAN barcode / linha digitável helpers

Examples:
  cnab records --bank 104
  cnab detect --file remessa.txt
  cnab parse-file --file remessa.txt --pretty
  cnab parse-file --file remessa.txt --encoding utf8
  echo "<240-char line>" | cnab parse --record cnab240/104/sigcb/header_arquivo --pretty
  echo '{"codigo_banco":"104"}' | cnab build --record cnab240/104/sigcb/header_arquivo \\
       --crlf --trailing-newline --out remessa.txt
  cnab tables --grep ocorrencia
  cnab code cnab400/104/retorno/codigo_ocorrencia 02
  cnab boleto barcode --bank 104 --currency 9 --due 2026-08-30 \\
       --amount 150000 --free 1234567890123456789012345
  cnab boleto parse 10491234567890123456789012345678901234567890123
`;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdRecords(spec, args, enc) {
  let keys = spec.recordKeys();
  if (args.layout) keys = keys.filter((k) => k.startsWith(`${args.layout}/`));
  if (args.bank) keys = keys.filter((k) => k.split('/')[1] === String(args.bank));
  if (args.grep && args.grep !== true) keys = keys.filter((k) => k.includes(args.grep));
  keys.sort();
  if (keys.length === 0) return;
  emitText(keys.join('\n'), args, enc);
}

function cmdParse(spec, args, enc) {
  const rec = requireRecord(spec, args.record);
  const lines = splitLines(readInput(args, enc));
  if (lines.length === 0) fail('no input lines');
  const out = lines.map((l) => rec.parse(l));
  emitJson(out.length === 1 ? out[0] : out, args, enc);
}

function cmdBuild(spec, args, enc) {
  const rec = requireRecord(spec, args.record);
  const raw = readInput(args, enc).trim();
  if (!raw) fail('no JSON input (object or array of objects)');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`invalid JSON input: ${e.message}`);
  }
  const recordsIn = Array.isArray(data) ? data : [data];
  let lines;
  try {
    lines = recordsIn.map((values) => rec.toLine(values));
  } catch (e) {
    fail(e.message);
  }
  emitContent(lines.join('\n'), args, enc);
}

function cmdValidate(spec, args, enc) {
  const rec = requireRecord(spec, args.record);
  const lines = splitLines(readInput(args, enc));
  if (lines.length === 0) fail('no input lines');
  let ok = true;
  const report = [];
  lines.forEach((l, i) => {
    const res = rec.validate(l);
    if (res.valid) {
      report.push(`line ${i + 1}: OK`);
    } else {
      ok = false;
      report.push(`line ${i + 1}: INVALID`);
      for (const e of res.errors) report.push(`  - ${e}`);
    }
  });
  emitText(report.join('\n'), args, enc);
  if (!ok) process.exit(2);
}

function detectScopeOrFail(specJson, content) {
  try {
    return CnabFile.detectScope(specJson, content);
  } catch (e) {
    return fail(e.message);
  }
}

function cmdDetect(args, enc) {
  const content = readInput(args, enc);
  if (content.trim() === '') fail('no input lines');
  const scope = detectScopeOrFail(loadSpecJson(), content);
  emitJson(
    {
      layout: scope.layout,
      bank: scope.bank,
      variant: scope.variant,
      direction: scope.direction,
    },
    args,
    enc
  );
}

function cmdParseFile(args, enc) {
  const specJson = loadSpecJson();
  const content = readInput(args, enc);
  if (content.trim() === '') fail('no input lines');

  const layout = opt(args.layout);
  const bank = opt(args.bank);
  const variant = opt(args.variant);
  const direction = opt(args.direction);

  let scope;
  if (layout !== undefined && bank !== undefined) {
    // fully explicit: no detection needed
    scope = {
      layout,
      bank,
      variant: variant ?? '',
      direction: direction ?? '',
    };
  } else {
    const detected = detectScopeOrFail(specJson, content);
    scope = {
      layout: layout ?? detected.layout,
      bank: bank ?? detected.bank,
      variant: variant ?? detected.variant,
      direction: direction ?? detected.direction,
    };
  }

  let parsed;
  try {
    const file = CnabFile.forBank(
      specJson,
      scope.layout,
      scope.bank,
      scope.variant,
      scope.direction
    );
    parsed = file.parse(content);
  } catch (e) {
    return fail(e.message);
  }
  emitJson(
    parsed.map((p) => ({
      recordKey: p.recordKey,
      tipo: p.tipo,
      segment: p.segment,
      fields: p.fields,
    })),
    args,
    enc
  );
}

function cmdTables(spec, args, enc) {
  let keys = spec.codeTableKeys();
  if (args.grep && args.grep !== true) keys = keys.filter((k) => k.includes(args.grep));
  keys.sort();
  if (keys.length === 0) return;
  emitText(keys.join('\n'), args, enc);
}

function cmdCode(spec, args, enc) {
  const key = args._[1];
  const code = args._[2];
  if (!key || code === undefined) fail('usage: cnab code <tableKey> <code>');
  if (!spec.hasCodeTable(key)) fail(`unknown code table "${key}" (see \`cnab tables\`)`);
  const description = spec.lookupCode(key, String(code));
  if (description === '') fail(`unknown code "${code}" in table "${key}"`, 2);
  emitText(description, args, enc);
}

function cmdBoleto(args, enc) {
  const sub = args._[1];
  if (sub === 'barcode') {
    const params = {
      bankCode: required(args.bank, '--bank <3 digits>'),
      currencyCode: opt(args.currency) ?? '9',
      dueDateIso: required(args.due, '--due <YYYY-MM-DD>'),
      amountCents: required(args.amount, '--amount <cents>'),
      freeField: required(args.free, '--free <25 digits>'),
    };
    let barcode;
    let linha;
    let formatted;
    try {
      barcode = Boleto.barcode(params);
      linha = Boleto.linhaDigitavel(barcode);
      formatted = Boleto.linhaDigitavelFormatted(barcode);
    } catch (e) {
      return fail(e.message);
    }
    emitText(
      [`barcode: ${barcode}`, `linha: ${linha}`, `formatted: ${formatted}`].join('\n'),
      args,
      enc
    );
    return;
  }
  if (sub === 'parse') {
    // allow the formatted mask to arrive as several argv tokens
    const linha = args._.slice(2).join('');
    if (linha === '') fail('usage: cnab boleto parse <linhaDigitavel>');
    let barcode;
    try {
      barcode = Boleto.parseLinhaDigitavel(linha);
    } catch (e) {
      return fail(e.message, 2);
    }
    emitText(
      [`barcode: ${barcode}`, `valid: ${Boleto.isValidBarcode(barcode)}`].join('\n'),
      args,
      enc
    );
    return;
  }
  fail('usage: cnab boleto barcode ... | cnab boleto parse <linhaDigitavel>');
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.help) {
    process.stdout.write(HELP);
    return;
  }

  const enc = resolveEncoding(args);

  // boleto helpers are pure math — they do not need the compiled spec
  if (cmd === 'boleto') return cmdBoleto(args, enc);
  if (cmd === 'detect') return cmdDetect(args, enc);
  if (cmd === 'parse-file') return cmdParseFile(args, enc);

  const spec = loadSpec();
  switch (cmd) {
    case 'records':
      return cmdRecords(spec, args, enc);
    case 'parse':
      return cmdParse(spec, args, enc);
    case 'build':
      return cmdBuild(spec, args, enc);
    case 'validate':
      return cmdValidate(spec, args, enc);
    case 'tables':
      return cmdTables(spec, args, enc);
    case 'code':
      return cmdCode(spec, args, enc);
    default:
      fail(`unknown command "${cmd}" (try \`cnab help\`)`);
  }
}

main();
