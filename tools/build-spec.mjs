#!/usr/bin/env node
// build-spec.mjs — compile CNAB spec YAML into language-neutral JSON.
//
// Responsibilities (see docs/adr/0003):
//   * load the field-library catalog (packages/spec/fields/catalog.yml)
//   * load every full standalone record under packages/spec/src/**.yml
//   * resolve each field's `ref` against the catalog
//   * parse legacy pictures for TYPE only (9 -> num, X -> alpha,
//     V9(n) -> num_decimal with `decimals`)
//   * convert strftime date formats to language-neutral tokens
//   * VALIDATE that every record covers its whole 240/400 line with no gaps
//     and no overlaps (fail the build otherwise)
//   * emit packages/spec/dist/spec.json
//
// Run: node tools/build-spec.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPEC_DIR = path.join(ROOT, 'packages', 'spec');
const CATALOG_FILE = path.join(SPEC_DIR, 'fields', 'catalog.yml');
const SRC_DIR = path.join(SPEC_DIR, 'src');
const DIST_DIR = path.join(SPEC_DIR, 'dist');

const LINE_LENGTHS = { cnab240: 240, cnab400: 400 };

// --- picture parsing -------------------------------------------------------

// Parse a legacy COBOL picture for TYPE + decimals only. Size is taken from the
// record's pos, not from the picture.
export function parsePicture(picture) {
  if (typeof picture !== 'string') {
    throw new Error(`picture must be a string, got ${JSON.stringify(picture)}`);
  }
  const p = picture.trim();
  const decMatch = p.match(/V9\((\d+)\)/i);
  if (decMatch) {
    return { type: 'num_decimal', decimals: Number(decMatch[1]) };
  }
  if (/^9\(\d+\)$/i.test(p)) {
    return { type: 'num', decimals: 0 };
  }
  if (/^X\(\d+\)$/i.test(p)) {
    return { type: 'alpha', decimals: 0 };
  }
  throw new Error(`unrecognized picture: ${JSON.stringify(picture)}`);
}

// --- strftime -> neutral tokens -------------------------------------------

const STRFTIME_TOKENS = [
  ['%Y', 'yyyy'],
  ['%y', 'yy'],
  ['%m', 'MM'],
  ['%d', 'dd'],
  ['%H', 'HH'],
  ['%M', 'mm'],
  ['%S', 'ss'],
];

export function convertDateFormat(strftime) {
  if (strftime == null) return '';
  let out = String(strftime);
  for (const [from, to] of STRFTIME_TOKENS) {
    out = out.split(from).join(to);
  }
  if (out.includes('%')) {
    throw new Error(`unsupported strftime directive in: ${JSON.stringify(strftime)}`);
  }
  return out;
}

// --- file walking ----------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) out.push(full);
  }
  return out;
}

// --- coverage validation ---------------------------------------------------

// strict=true (real bank records): require full, gapless coverage AND no
// overlaps. strict=false (generic templates, ADR 0003): only check ranges and
// overlaps; gaps are allowed because templates may be partial copy-from sources.
function validateCoverage(key, lineLength, fields, strict) {
  const errors = [];
  const sorted = [...fields].sort((a, b) => a.start - b.start);
  let cursor = 1;
  for (const f of sorted) {
    if (f.start < 1 || f.end > lineLength || f.start > f.end) {
      errors.push(
        `field "${f.name}" has invalid range [${f.start}, ${f.end}] (line length ${lineLength})`
      );
      continue;
    }
    if (f.start > cursor) {
      if (strict) errors.push(`gap at positions ${cursor}..${f.start - 1} (before "${f.name}")`);
    } else if (f.start < cursor) {
      errors.push(
        `overlap at positions ${f.start}..${Math.min(cursor - 1, f.end)} ("${f.name}" collides with previous field)`
      );
    }
    cursor = Math.max(cursor, f.end + 1);
  }
  if (strict && cursor - 1 < lineLength) {
    errors.push(`gap at positions ${cursor}..${lineLength} (end of line uncovered)`);
  }
  return errors.map((e) => `  [${key}] ${e}`);
}

// --- main ------------------------------------------------------------------

function main() {
  if (!fs.existsSync(CATALOG_FILE)) {
    fail(`catalog not found: ${CATALOG_FILE}`);
  }
  const catalog = yaml.load(fs.readFileSync(CATALOG_FILE, 'utf8')) || {};

  // resolve each catalog entry's semantics once
  const resolvedCatalog = {};
  for (const [name, raw] of Object.entries(catalog)) {
    try {
      const { type, decimals } = parsePicture(raw.picture);
      resolvedCatalog[name] = {
        type,
        decimals,
        dateFormat: convertDateFormat(raw.date_format),
        description: (raw.description || '').trim(),
      };
    } catch (e) {
      fail(`catalog field "${name}": ${e.message}`);
    }
  }

  const records = {};
  const codeTables = {};
  const allErrors = [];

  if (!fs.existsSync(SRC_DIR)) fail(`spec src not found: ${SRC_DIR}`);

  for (const file of walk(SRC_DIR).sort()) {
    const rel = path.relative(SRC_DIR, file).replace(/\.ya?ml$/, '');
    const key = rel.split(path.sep).join('/');
    const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
    const meta = doc.meta || {};

    // code table (lookup) ----------------------------------------------------
    if (doc.codes) {
      codeTables[key] = {
        meta: { kind: 'code_table', ...meta },
        codes: Object.fromEntries(
          Object.entries(doc.codes).map(([k, v]) => [String(k), String(v)])
        ),
      };
      continue;
    }

    // positioned record ------------------------------------------------------
    if (!Array.isArray(doc.fields)) {
      allErrors.push(`  [${key}] record has neither "fields" nor "codes"`);
      continue;
    }

    const layout = meta.layout;
    const lineLength = meta.lineLength || LINE_LENGTHS[layout];
    if (!lineLength) {
      allErrors.push(`  [${key}] missing/unknown layout line length (layout=${layout})`);
      continue;
    }

    const fields = [];
    for (const fieldDef of doc.fields) {
      const ref = fieldDef.ref;
      const pos = fieldDef.pos;
      if (!ref || !Array.isArray(pos) || pos.length !== 2) {
        allErrors.push(`  [${key}] field "${ref || '?'}" missing ref/pos`);
        continue;
      }
      const cat = resolvedCatalog[ref];
      if (!cat) {
        allErrors.push(`  [${key}] field "${ref}" not found in catalog`);
        continue;
      }
      const [start, end] = pos;
      // Catalog provides default semantics; a record field MAY override the
      // date format / decimals for layout-specific variants (see ADR 0004),
      // e.g. 6-digit ddMMyy dates in CNAB400 vs 8-digit ddMMyyyy in CNAB240.
      let type = cat.type;
      let decimals = cat.decimals;
      let dateFormat = cat.dateFormat;
      if (fieldDef.picture != null) {
        try {
          const parsed = parsePicture(fieldDef.picture);
          type = parsed.type;
          decimals = parsed.decimals;
        } catch (e) {
          allErrors.push(`  [${key}] field "${ref}": ${e.message}`);
        }
      }
      if (fieldDef.decimals != null) {
        decimals = Number(fieldDef.decimals);
        type = decimals > 0 ? 'num_decimal' : type;
      }
      if (fieldDef.date_format != null) {
        try {
          dateFormat = convertDateFormat(fieldDef.date_format);
        } catch (e) {
          allErrors.push(`  [${key}] field "${ref}": ${e.message}`);
        }
      }
      fields.push({
        name: ref,
        start,
        end,
        type,
        decimals,
        dateFormat,
        default: fieldDef.default != null ? String(fieldDef.default) : '',
        description: cat.description,
      });
    }

    const coverageErrors = validateCoverage(key, lineLength, fields, !meta.template);
    allErrors.push(...coverageErrors);

    records[key] = {
      meta: {
        layout,
        bank: meta.bank != null ? String(meta.bank) : '',
        variant: meta.variant || '',
        direction: meta.direction || '',
        record: meta.record || path.basename(key),
        lineLength,
        template: !!meta.template,
      },
      fields,
    };
  }

  if (allErrors.length) {
    console.error('Spec validation FAILED:');
    console.error(allErrors.join('\n'));
    process.exit(1);
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    catalog: resolvedCatalog,
    records,
    codeTables,
  };
  fs.writeFileSync(path.join(DIST_DIR, 'spec.json'), JSON.stringify(out, null, 2) + '\n');

  const recCount = Object.keys(records).length;
  const tableCount = Object.keys(codeTables).length;
  const catCount = Object.keys(resolvedCatalog).length;
  console.log(
    `build-spec: OK — ${recCount} records, ${tableCount} code tables, ` +
      `${catCount} catalog fields -> packages/spec/dist/spec.json`
  );
}

function fail(msg) {
  console.error(`build-spec: ${msg}`);
  process.exit(1);
}

main();
