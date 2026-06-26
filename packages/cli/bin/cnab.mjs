#!/usr/bin/env node
// @cnab/cli — parse / build / validate CNAB 240/400 lines over a compiled spec.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { CnabSpec } from '@cnab/core';

const require = createRequire(import.meta.url);

function loadSpec() {
  let specPath;
  try {
    specPath = require.resolve('@cnab/spec'); // package main -> dist/spec.json
  } catch {
    specPath = null;
  }
  if (!specPath || !fs.existsSync(specPath)) {
    fail(
      'compiled spec not found. Run `npm run build:spec` at the repo root first.'
    );
  }
  return CnabSpec.fromJson(fs.readFileSync(specPath, 'utf8'));
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

function readInput(args) {
  if (args.file) return fs.readFileSync(args.file, 'utf8');
  if (args.line != null && args.line !== true) return String(args.line);
  // stdin
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function splitLines(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
}

function requireRecord(spec, key) {
  if (!key || key === true) fail('missing --record <key> (see `cnab records`)');
  if (!spec.hasRecord(key)) fail(`unknown record "${key}" (see \`cnab records\`)`);
  return spec.getRecord(key);
}

const HELP = `cnab — CNAB 240/400 toolkit

Usage:
  cnab records [--layout cnab240|cnab400] [--bank 104] [--grep p]
  cnab parse    --record <key> [--file <path> | --line <text> | stdin] [--pretty]
  cnab build    --record <key> [--file <json> | stdin]   (JSON object or array of objects)
  cnab validate --record <key> [--file <path> | --line <text> | stdin]

A <key> looks like: cnab240/104/sigcb/header_arquivo

Examples:
  cnab records --bank 104
  echo "<240-char line>" | cnab parse --record cnab240/104/sigcb/header_arquivo --pretty
  echo '{"codigo_banco":"104"}' | cnab build --record cnab240/104/sigcb/header_arquivo
`;

function cmdRecords(spec, args) {
  let keys = spec.recordKeys();
  if (args.layout) keys = keys.filter((k) => k.startsWith(`${args.layout}/`));
  if (args.bank) keys = keys.filter((k) => k.split('/')[1] === String(args.bank));
  if (args.grep && args.grep !== true) keys = keys.filter((k) => k.includes(args.grep));
  keys.sort();
  process.stdout.write(keys.join('\n') + (keys.length ? '\n' : ''));
}

function cmdParse(spec, args) {
  const rec = requireRecord(spec, args.record);
  const lines = splitLines(readInput(args));
  if (lines.length === 0) fail('no input lines');
  const out = lines.map((l) => rec.parse(l));
  const result = out.length === 1 ? out[0] : out;
  process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0) + '\n');
}

function cmdBuild(spec, args) {
  const rec = requireRecord(spec, args.record);
  const raw = readInput(args).trim();
  if (!raw) fail('no JSON input (object or array of objects)');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`invalid JSON input: ${e.message}`);
  }
  const recordsIn = Array.isArray(data) ? data : [data];
  const lines = recordsIn.map((values) => rec.toLine(values));
  process.stdout.write(lines.join('\n') + '\n');
}

function cmdValidate(spec, args) {
  const rec = requireRecord(spec, args.record);
  const lines = splitLines(readInput(args));
  if (lines.length === 0) fail('no input lines');
  let ok = true;
  lines.forEach((l, i) => {
    const res = rec.validate(l);
    if (res.valid) {
      process.stdout.write(`line ${i + 1}: OK\n`);
    } else {
      ok = false;
      process.stdout.write(`line ${i + 1}: INVALID\n`);
      for (const e of res.errors) process.stdout.write(`  - ${e}\n`);
    }
  });
  if (!ok) process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.help) {
    process.stdout.write(HELP);
    return;
  }

  const spec = loadSpec();
  switch (cmd) {
    case 'records':
      return cmdRecords(spec, args);
    case 'parse':
      return cmdParse(spec, args);
    case 'build':
      return cmdBuild(spec, args);
    case 'validate':
      return cmdValidate(spec, args);
    default:
      fail(`unknown command "${cmd}" (try \`cnab help\`)`);
  }
}

main();
