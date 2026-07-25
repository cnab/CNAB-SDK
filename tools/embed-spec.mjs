#!/usr/bin/env node
// embed-spec.mjs — embed the compiled spec into @cnab/core as a TS source file.
//
// WHY THIS EXISTS
// ---------------
// The engine only ever accepted the spec as a *string* (`CnabSpec.fromJson`).
// In Node that is fine — you can `require('@cnab/spec/dist/spec.json')`. A
// Python / Java / .NET consumer installing only the generated `cnab-core`
// package has no such file and therefore no data at all: they would get an
// engine that can parse nothing.
//
// So the compiled spec is baked into the jsii assembly itself as a plain string
// constant. jsii-pacmak bundles `lib/` into every target package, which makes
// the data travel with the engine in all four languages with zero file I/O.
//
// The generated module is NOT part of the public jsii API: `src/index.ts`
// imports it, but never re-exports it (jsii only supports classes / interfaces
// / enums at the boundary, not top-level consts). It is reachable from user
// code through `CnabSpec.bundled()` / `CnabSpec.bundledJson()`.
//
// The output is deliberately content-agnostic: it copies whatever
// `packages/spec/dist/spec.json` contains, so renaming catalog fields or adding
// records changes nothing here.
//
// Run: node tools/embed-spec.mjs   (also run by `npm run build:spec`)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPEC_JSON = path.join(ROOT, 'packages', 'spec', 'dist', 'spec.json');
const BUILD_SPEC = path.join(ROOT, 'tools', 'build-spec.mjs');
const OUT_FILE = path.join(ROOT, 'packages', 'core', 'src', 'spec.generated.ts');

// `packages/core`'s own `build` / `build:jsii` / `prepack` call this script, and
// they must work from a clean checkout where `dist/` (gitignored) is absent.
if (!fs.existsSync(SPEC_JSON)) {
  execFileSync(process.execPath, [BUILD_SPEC], { cwd: ROOT, stdio: 'inherit' });
}

const raw = fs.readFileSync(SPEC_JSON, 'utf8');

// Re-serialize compactly: the on-disk file is pretty-printed for review/diffing,
// but nothing reads the embedded copy by eye and the indentation is ~40% of it.
// JSON.parse/stringify round-trips it without changing a single value.
const compact = JSON.stringify(JSON.parse(raw));

// JSON.stringify of a string produces a correctly escaped double-quoted literal
// (quotes, backslashes and control characters all handled); it is valid TS.
const literal = JSON.stringify(compact);

const banner = `// GENERATED FILE — DO NOT EDIT.
//
// Produced by tools/embed-spec.mjs from packages/spec/dist/spec.json.
// Regenerate with \`npm run build:spec\` (or \`node tools/embed-spec.mjs\`).
// This file is gitignored: it is build output, like lib/ and .jsii.
`;

const body = `${banner}
/* eslint-disable */

/**
 * The compiled CNAB spec, minified and embedded so that every jsii target
 * language ships the data with the engine.
 *
 * Internal: not part of the public jsii API surface (jsii does not export
 * top-level constants). Reach it via \`CnabSpec.bundledJson()\`.
 *
 * @internal
 */
export const BUNDLED_SPEC_JSON: string = ${literal};
`;

const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
if (previous === body) {
  console.log(
    `embed-spec: up to date — ${OUT_FILE.slice(ROOT.length + 1)} (${kb(body.length)})`
  );
} else {
  fs.writeFileSync(OUT_FILE, body);
  console.log(
    `embed-spec: OK — ${kb(raw.length)} spec.json -> ${kb(compact.length)} embedded ` +
      `-> ${OUT_FILE.slice(ROOT.length + 1)} (${kb(body.length)})`
  );
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}
