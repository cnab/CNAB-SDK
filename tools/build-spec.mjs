#!/usr/bin/env node
// build-spec.mjs — compile CNAB spec YAML into language-neutral JSON.
//
// Responsibilities (see docs/adr/0003):
//   * load the field-library catalog (packages/spec/fields/catalog.yml)
//   * load every full standalone record under packages/spec/src/**.yml
//   * resolve each field's `ref` against the catalog, THROUGH the entry's
//     `aliases:` list, so the compiled spec only ever emits canonical names
//     (see docs/adrs/0008)
//   * enforce canonical naming: no alias may collide with a canonical name or
//     another alias, and no two canonical names may be spelling variants of
//     each other (outside an explicit, shrinking allow-list)
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

// --- canonical field naming (ADR 0008) -------------------------------------

// Normalize a field name for synonym detection: drop the Portuguese
// connectives `_de_` / `_do_` / `_da_` / `_dos_` / `_das_` and all
// underscores. `codigo_do_banco` and `codigo_banco` both normalize to
// `codigobanco`; `mensagem1` and `mensagem_1` both to `mensagem1`.
export function normalizeFieldName(name) {
  return String(name)
    .replace(/_(?:de|do|da|dos|das)_/g, '_')
    .split('_')
    .join('');
}

/**
 * Clusters of catalog names that normalize to the same form and are
 * DELIBERATELY left as separate canonical entries because they denote
 * genuinely different concepts (a single record uses both, at different
 * positions), so merging them would collapse two real fields into one map key.
 *
 * This list is naming debt and is meant to SHRINK to empty (ADR 0008). Adding
 * an entry requires evidence that the two names are not synonyms; the right
 * long-term fix is to rename one side to something unambiguous. A stale entry
 * (one whose cluster no longer exists) fails the build so the list cannot rot.
 *
 * Keyed by normalized name -> the exact set of canonical names allowed to share
 * it, so a THIRD variant sneaking into an allowed cluster still fails.
 */
const ALLOWED_NAME_COLLISIONS = {
  // cnab400/237/retorno/detalhe carries `codigo_do_banco` at 166-168 (banco
  // cobrador) AND `codigo_banco` at 315-318 — two distinct fields on one line.
  codigobanco: ['codigo_banco', 'codigo_do_banco'],
};

/**
 * Build the alias -> canonical index and enforce the naming rules.
 * Returns `{ aliasOf, aliasesByName, errors }`; `errors` is empty on success.
 */
export function buildAliasIndex(catalog) {
  const errors = [];
  const canonical = Object.keys(catalog);
  const canonicalSet = new Set(canonical);
  const aliasOf = new Map(); // alias -> canonical
  const aliasesByName = {}; // canonical -> [alias, ...]

  for (const name of canonical) {
    const raw = catalog[name] || {};
    const declared = raw.aliases;
    if (declared == null) {
      aliasesByName[name] = [];
      continue;
    }
    if (!Array.isArray(declared)) {
      errors.push(
        `catalog field "${name}": "aliases" must be a list, got ${JSON.stringify(declared)}`
      );
      aliasesByName[name] = [];
      continue;
    }
    const list = [];
    for (const rawAlias of declared) {
      const alias = String(rawAlias);
      if (alias === name) {
        errors.push(`catalog field "${name}": lists itself as an alias`);
        continue;
      }
      if (canonicalSet.has(alias)) {
        errors.push(
          `alias collision: "${alias}" is declared as an alias of "${name}" but is also a canonical catalog entry — ` +
            `delete the "${alias}" entry or drop the alias`
        );
        continue;
      }
      const owner = aliasOf.get(alias);
      if (owner !== undefined) {
        errors.push(
          `alias collision: "${alias}" is declared as an alias of both "${owner}" and "${name}" — ` +
            `an alias may point at exactly one canonical name`
        );
        continue;
      }
      aliasOf.set(alias, name);
      list.push(alias);
    }
    aliasesByName[name] = list;
  }

  // Spelling-variant gate: two canonical names must not normalize to the same
  // form unless the cluster is on the explicit allow-list.
  const byNormalized = new Map();
  for (const name of canonical) {
    const norm = normalizeFieldName(name);
    const bucket = byNormalized.get(norm);
    if (bucket) bucket.push(name);
    else byNormalized.set(norm, [name]);
  }
  for (const [norm, names] of [...byNormalized].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    if (names.length < 2) continue;
    const allowed = ALLOWED_NAME_COLLISIONS[norm];
    const sorted = [...names].sort();
    if (allowed && sorted.join('\u0001') === [...allowed].sort().join('\u0001')) continue;
    errors.push(
      `canonical name collision: ${sorted.map((n) => `"${n}"`).join(' and ')} ` +
        `are spelling variants of the same name ("${norm}") — ` +
        `keep one as the canonical entry and add the other(s) to its "aliases:" list ` +
        `(see docs/adrs/0008-canonical-field-naming.md)` +
        (allowed
          ? `. The allow-list entry "${norm}" covers exactly ${[...allowed]
              .sort()
              .map((n) => `"${n}"`)
              .join(' and ')}; update it deliberately if this cluster really changed.`
          : '')
    );
  }
  for (const norm of Object.keys(ALLOWED_NAME_COLLISIONS).sort()) {
    const names = byNormalized.get(norm) || [];
    if (names.length < 2) {
      errors.push(
        `stale allow-list entry "${norm}" in ALLOWED_NAME_COLLISIONS (tools/build-spec.mjs): ` +
          `the cluster no longer exists — remove the entry, the list is meant to shrink to empty`
      );
    }
  }

  return { aliasOf, aliasesByName, errors };
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
      if (strict)
        errors.push(`gap at positions ${cursor}..${f.start - 1} (before "${f.name}")`);
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

  // canonical naming: resolve aliases and reject new spelling collisions
  const { aliasOf, aliasesByName, errors: namingErrors } = buildAliasIndex(catalog);
  if (namingErrors.length) {
    console.error(
      'Canonical field naming FAILED (see docs/adrs/0008-canonical-field-naming.md):'
    );
    console.error(namingErrors.map((e) => `  ${e}`).join('\n'));
    process.exit(1);
  }

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
        // Legacy spellings that resolve to this entry at compile time. Emitted
        // so a runtime helper can accept a pre-ADR-0008 name (ADR 0008).
        aliases: aliasesByName[name] || [],
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
    const seenNames = new Map(); // canonical name -> the ref that produced it
    for (const fieldDef of doc.fields) {
      const ref = fieldDef.ref;
      const pos = fieldDef.pos;
      if (!ref || !Array.isArray(pos) || pos.length !== 2) {
        allErrors.push(`  [${key}] field "${ref || '?'}" missing ref/pos`);
        continue;
      }
      // A ref may name a canonical entry or one of its aliases; the compiled
      // spec always carries the canonical name (ADR 0008).
      const name = resolvedCatalog[ref] ? ref : aliasOf.get(ref);
      const cat = name ? resolvedCatalog[name] : undefined;
      if (!cat) {
        allErrors.push(`  [${key}] field "${ref}" not found in catalog`);
        continue;
      }
      const previousRef = seenNames.get(name);
      if (previousRef !== undefined) {
        allErrors.push(
          `  [${key}] duplicate field name "${name}"` +
            (previousRef === ref
              ? ` (listed twice)`
              : ` (from refs "${previousRef}" and "${ref}" — they are not synonyms; ` +
                `give the second field its own canonical name)`)
        );
        continue;
      }
      seenNames.set(name, ref);
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
        name,
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
