#!/usr/bin/env node
// migrate-legacy.mjs — ONE-SHOT importer from cnab_yaml into the new spec model.
//
// Reads the legacy partial-overlay specs and produces:
//   * packages/spec/fields/catalog.yml   (field library: name -> picture/date/desc)
//   * packages/spec/src/<layout>/<bank>/[variant/][direction/]<record>.yml
//       full standalone records (ref + pos + optional default/date_format override)
//   * code tables (codigo_ocorrencia) preserved as { codes: {...} }
//
// Overlay assembly: a bank record is the union of the bank's own fields
// (authoritative for the positions they occupy) plus the generic fields whose
// NAME the bank does not redefine AND whose positions do not overlap any bank
// field. Known legacy bugs are fixed via KNOWN_DROPS.
//
// This is intentionally NOT part of the normal build. After running it once and
// committing, the generated files under packages/spec are the source of truth
// and may be hand-edited; do not re-run blindly.
//
// Run: node tools/migrate-legacy.mjs /path/to/cnab_yaml

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SPEC_DIR = path.join(ROOT, 'packages', 'spec');
const SRC_OUT = path.join(SPEC_DIR, 'src');
const CATALOG_OUT = path.join(SPEC_DIR, 'fields', 'catalog.yml');

const LEGACY = process.argv[2] || path.resolve(ROOT, '..', 'cnab_yaml');
const LINE_LENGTHS = { cnab240: 240, cnab400: 400 };
const DIRECTIONS = new Set(['remessa', 'retorno']);

// Legacy data fixes applied during assembly. Key: output record key.
// Value: set of field names to drop (buggy/leftover fields).
const KNOWN_DROPS = {
  // SIGCB header: legacy defines uso_exclusivo_banco_01 X(7) AND
  // uso_exclusivo_caixa_02 9(7) both at 65-71, plus leftover SICOB fields
  // codigo_cedente_dv(71) / agencia_mais_cedente_dv(72). Keep the SIGCB layout
  // (uso_exclusivo_caixa_02 at 65-71, uso_exclusivo_caixa_03 at 72); the
  // overlapping generic fields are dropped automatically, and we drop the
  // duplicate banco field explicitly here.
  'cnab240/104/sigcb/header_arquivo': ['uso_exclusivo_banco_01'],
};

// Rename fields where legacy reused a name for two different positions (e.g. a
// duplicate mapping key). Key: output record key -> { oldName: newName }.
const KNOWN_RENAMES = {
  // Bradesco 237 retorno detalhe declares `valor_outras_despesas` twice (a
  // duplicate-key bug): once at 189-201 and once at 202-214. The 202-214 slot
  // is the juros/desconto value (cf. BB 001 detalhe). Rename it and re-add the
  // 189-201 field via KNOWN_FILLS below.
  'cnab400/237/retorno/detalhe': { valor_outras_despesas: 'valor_juros_desconto' },
};

// Fill positions left uncovered after assembly because a bank shrank/relocated
// fields, leaving reserved regions the legacy generic no longer covers. These
// are reserved / uso-exclusivo regions; exact bank semantics should be verified
// against the bank manual. Key: output record key -> [ field defs ].
const KNOWN_FILLS = {
  // SIGCB segment T shrinks codigo_cedente (24-29), nosso_numero (42-56) and
  // numero_documento (59-69); the freed positions are reserved in SIGCB.
  'cnab240/104/sigcb/retorno/detalhe_segmento_t': [
    { ref: 'reservado_caixa_t1', pos: [30, 35], picture: '9(6)', default: '0', desc: 'Reserved (SIGCB) — verify against Caixa manual' },
    { ref: 'reservado_caixa_t2', pos: [38, 41], picture: '9(4)', default: '0', desc: 'Reserved (SIGCB) — verify against Caixa manual' },
    { ref: 'reservado_caixa_t3', pos: [57, 57], picture: '9(1)', default: '0', desc: 'Reserved (SIGCB) — verify against Caixa manual' },
    { ref: 'reservado_caixa_t4', pos: [70, 73], picture: '9(4)', default: '0', desc: 'Reserved (SIGCB) — verify against Caixa manual' },
  ],
  // BB 001 relocates agencia_cobradora to 18-22, leaving 169-173 reserved.
  'cnab400/001/retorno/detalhe': [
    { ref: 'reservado_bb_d1', pos: [169, 173], picture: '9(5)', default: '0', desc: 'Reserved (BB) — verify against Banco do Brasil manual' },
  ],
  // Re-add the valor_outras_despesas field lost to the 237 duplicate-key bug.
  'cnab400/237/retorno/detalhe': [
    { ref: 'valor_outras_despesas', pos: [189, 201] },
  ],
};

// --- helpers ---------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && /\.ya?ml$/.test(e.name)) out.push(full);
  }
  return out;
}

function isFieldObject(v) {
  return v && typeof v === 'object' && Array.isArray(v.pos);
}

// Some legacy files contain duplicate mapping keys (a bug). js-yaml rejects
// them by default; the `json: true` option makes duplicates override (last
// wins) instead of throwing. We try a strict load first only to detect/report
// the offenders.
const dupKeyFiles = [];
function loadYaml(raw, rel) {
  try {
    return yaml.load(raw) || {};
  } catch (e) {
    if (e && /duplicated mapping key/.test(e.message || '')) {
      dupKeyFiles.push(rel);
      return yaml.load(raw, { json: true }) || {};
    }
    throw new Error(`${rel}: ${e.message}`);
  }
}

// Extract the first comment line inside each top-level field block, to use as a
// description. js-yaml drops comments, so parse the raw text.
function extractDescriptions(raw) {
  const desc = {};
  const lines = raw.split('\n');
  let current = null;
  for (const line of lines) {
    const top = line.match(/^([A-Za-z0-9_]+):\s*(#.*)?$/);
    if (top) {
      current = top[1];
      continue;
    }
    if (current && /^\s+#/.test(line) && desc[current] === undefined) {
      const text = line.replace(/^\s+#\s?/, '').trim();
      if (text) desc[current] = text;
    } else if (current && /^\s+\S/.test(line) && !/^\s+#/.test(line)) {
      // first non-comment property: stop looking for this field's description
      if (desc[current] === undefined) desc[current] = '';
    }
  }
  return desc;
}

function parsePictureType(picture) {
  const p = String(picture).trim();
  const dec = p.match(/V9\((\d+)\)/i);
  if (dec) return { type: 'num_decimal', decimals: Number(dec[1]) };
  if (/^9\(\d+\)$/i.test(p)) return { type: 'num', decimals: 0 };
  if (/^X\(\d+\)$/i.test(p)) return { type: 'alpha', decimals: 0 };
  return { type: 'unknown', decimals: 0 };
}

// classify a legacy file path -> {layout, bank, variant, direction, record}
function classify(relPath) {
  const parts = relPath.replace(/\.ya?ml$/, '').split(path.sep);
  const layout = parts[0];
  const bank = parts[1];
  const record = parts[parts.length - 1];
  const middle = parts.slice(2, parts.length - 1);
  let direction = '';
  let variant = '';
  for (const m of middle) {
    if (DIRECTIONS.has(m)) direction = m;
    else variant = m;
  }
  return { layout, bank, variant, direction, record };
}

// --- load legacy -----------------------------------------------------------

const files = [];
for (const layout of ['cnab240', 'cnab400']) {
  const dir = path.join(LEGACY, layout);
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir)) {
    const rel = path.relative(LEGACY, f);
    const raw = fs.readFileSync(f, 'utf8');
    const doc = loadYaml(raw, rel);
    files.push({ rel, raw, doc, meta: classify(rel) });
  }
}

// generic baseline index: layout|direction|record -> fields object
const generics = {};
for (const file of files) {
  if (file.meta.bank !== 'generic') continue;
  const fieldsObj = {};
  for (const [name, v] of Object.entries(file.doc)) {
    if (isFieldObject(v)) fieldsObj[name] = v;
  }
  const { layout, direction, record } = file.meta;
  generics[`${layout}|${direction}|${record}`] = fieldsObj;
}

function findGeneric(layout, direction, record) {
  return (
    generics[`${layout}|${direction}|${record}`] ||
    generics[`${layout}||${record}`] ||
    null
  );
}

// --- catalog accumulation --------------------------------------------------

const catalog = {}; // name -> { types:Set, pictures:Set, decimals, dateFormats:Set, descriptions:[] }

function noteField(name, fieldDef, description) {
  const entry =
    catalog[name] ||
    (catalog[name] = {
      pictures: new Set(),
      types: new Set(),
      decimals: 0,
      dateFormats: new Set(),
      description: '',
    });
  if (fieldDef.picture) {
    entry.pictures.add(fieldDef.picture);
    const { type, decimals } = parsePictureType(fieldDef.picture);
    entry.types.add(type);
    if (decimals > entry.decimals) entry.decimals = decimals;
  }
  if (fieldDef.date_format) entry.dateFormats.add(fieldDef.date_format);
  if (description && !entry.description) entry.description = description;
}

// --- assemble records ------------------------------------------------------

const outputs = []; // { outKey, outPath, meta, fields:[{ref,pos,default?,date_format?}] }
const codeTables = [];
const conflicts = [];

for (const file of files) {
  const { layout, bank, variant, direction, record } = file.meta;
  const descs = extractDescriptions(file.raw);

  // code table?
  const values = Object.values(file.doc);
  const hasFields = values.some(isFieldObject);
  if (!hasFields) {
    // treat as code table (codigo_ocorrencia etc.)
    const codes = {};
    for (const [k, v] of Object.entries(file.doc)) {
      if (typeof v === 'string' || typeof v === 'number') codes[String(k)] = String(v);
    }
    if (Object.keys(codes).length) {
      const segs = [layout, bank, variant, direction, record].filter(Boolean);
      codeTables.push({
        outKey: segs.join('/'),
        outPath: path.join(SRC_OUT, ...segs) + '.yml',
        meta: { layout, bank, variant, direction, record, kind: 'code_table' },
        codes,
      });
    }
    continue;
  }

  // own fields (apply known renames for legacy duplicate-key collisions)
  const renames = KNOWN_RENAMES[[layout, bank, variant, direction, record].filter(Boolean).join('/')] || {};
  const ownFields = {};
  for (const [name, v] of Object.entries(file.doc)) {
    if (isFieldObject(v)) ownFields[renames[name] || name] = v;
  }

  const segs = [layout, bank, variant, direction, record].filter(Boolean);
  const outKey = segs.join('/');

  let assembled; // [name, fieldDef]
  if (bank === 'generic') {
    assembled = Object.entries(ownFields);
  } else {
    const baseline = findGeneric(layout, direction, record) || {};
    const drops = new Set(KNOWN_DROPS[outKey] || []);
    const bankNames = new Set(Object.keys(ownFields));
    // bank fields (authoritative), minus known drops
    const bankFields = Object.entries(ownFields).filter(([n]) => !drops.has(n));
    const bankRanges = bankFields.map(([, v]) => v.pos);
    const overlaps = (pos) =>
      bankRanges.some(([s, e]) => !(pos[1] < s || pos[0] > e));
    // generic fields the bank neither redefines (by name) nor overlaps (by pos)
    const inheritedFields = Object.entries(baseline).filter(
      ([n, v]) => !bankNames.has(n) && !overlaps(v.pos)
    );
    assembled = [...bankFields, ...inheritedFields];
  }

  // explicit fills for reserved regions left uncovered after assembly
  for (const fill of KNOWN_FILLS[outKey] || []) {
    const v = { pos: fill.pos };
    if (fill.picture) v.picture = fill.picture;
    if (fill.default !== undefined) v.default = fill.default;
    if (fill.desc) v._desc = fill.desc;
    assembled.push([fill.ref, v]);
  }

  assembled.sort((a, b) => a[1].pos[0] - b[1].pos[0]);

  const lineLength = LINE_LENGTHS[layout];
  const fields = assembled.map(([name, v]) => {
    noteField(name, v, v._desc || descs[name]);
    const f = { ref: name, pos: [v.pos[0], v.pos[1]] };
    if (v.default !== undefined) f.default = v.default === null ? '' : v.default;
    if (v.date_format) f.date_format = v.date_format; // resolved against catalog later
    if (v.picture) f._picture = v.picture; // legacy picture, used to decide overrides later
    return f;
  });

  outputs.push({
    outKey,
    outPath: path.join(SRC_OUT, ...segs) + '.yml',
    meta: { layout, bank, variant, direction, record, lineLength, template: bank === 'generic' },
    fields,
  });
}

// --- resolve catalog: pick representative picture/date, decide overrides ----

const catalogResolved = {};
for (const [name, e] of Object.entries(catalog)) {
  const types = [...e.types].filter((t) => t !== 'unknown');
  let chosenType = 'alpha';
  if (types.includes('num_decimal')) chosenType = 'num_decimal';
  else if (types.includes('num')) chosenType = 'num';
  else if (types.includes('alpha')) chosenType = 'alpha';
  if (e.types.size > 1 && !(e.types.has('num') && e.types.has('num_decimal'))) {
    conflicts.push(`type conflict for "${name}": ${[...e.types].join(', ')} -> using ${chosenType}`);
  }
  // representative picture matching chosen type
  let picture = [...e.pictures].find((p) => {
    const t = parsePictureType(p).type;
    return chosenType === 'num_decimal' ? t === 'num_decimal' : t === chosenType;
  });
  if (!picture) {
    picture = chosenType === 'num_decimal' ? `9(1)V9(${e.decimals})` : chosenType === 'num' ? '9(1)' : 'X(1)';
  }
  const dateFormats = [...e.dateFormats];
  if (dateFormats.length > 1) {
    conflicts.push(`date_format variants for "${name}": ${dateFormats.join(', ')} (default first; others overridden per record)`);
  }
  catalogResolved[name] = {
    picture,
    date_format: dateFormats[0] || null,
    description: e.description || '',
  };
}

// Decide per-record overrides where a record's own field semantics differ from
// the catalog default (ADR 0004): date_format and picture (type/decimals).
for (const out of outputs) {
  for (const f of out.fields) {
    const cat = catalogResolved[f.ref];
    if (f.date_format) {
      if (cat && cat.date_format && f.date_format === cat.date_format) {
        delete f.date_format; // matches default; no override needed
      }
    }
    if (f._picture && cat) {
      const own = parsePictureType(f._picture);
      const def = parsePictureType(cat.picture);
      if (own.type !== def.type || own.decimals !== def.decimals) {
        f.picture = f._picture; // override: different type/decimals than catalog default
      }
    }
    delete f._picture;
  }
}

// --- emit ------------------------------------------------------------------

function dumpField(f) {
  const parts = [`ref: ${f.ref}`, `pos: [${f.pos[0]}, ${f.pos[1]}]`];
  if (f.default !== undefined) parts.push(`default: ${JSON.stringify(f.default)}`);
  if (f.picture) parts.push(`picture: ${JSON.stringify(f.picture)}`);
  if (f.date_format) parts.push(`date_format: ${JSON.stringify(f.date_format)}`);
  return `  - { ${parts.join(', ')} }`;
}

function dumpRecord(out) {
  const m = out.meta;
  const metaLines = [
    'meta:',
    `  layout: ${m.layout}`,
    `  bank: ${JSON.stringify(m.bank)}`,
  ];
  if (m.variant) metaLines.push(`  variant: ${m.variant}`);
  if (m.direction) metaLines.push(`  direction: ${m.direction}`);
  metaLines.push(`  record: ${m.record}`);
  metaLines.push(`  lineLength: ${m.lineLength}`);
  if (m.template) metaLines.push('  template: true');
  const fieldLines = ['fields:', ...out.fields.map(dumpField)];
  return metaLines.join('\n') + '\n' + fieldLines.join('\n') + '\n';
}

function dumpCodeTable(t) {
  const m = t.meta;
  const metaLines = ['meta:', `  layout: ${m.layout}`, `  bank: ${JSON.stringify(m.bank)}`];
  if (m.variant) metaLines.push(`  variant: ${m.variant}`);
  if (m.direction) metaLines.push(`  direction: ${m.direction}`);
  metaLines.push(`  record: ${m.record}`);
  metaLines.push('  kind: code_table');
  const codeLines = ['codes:'];
  for (const [k, v] of Object.entries(t.codes)) codeLines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return metaLines.join('\n') + '\n' + codeLines.join('\n') + '\n';
}

// catalog.yml
const catNames = Object.keys(catalogResolved).sort();
let catalogText =
  '# CNAB field-library catalog (generated by tools/migrate-legacy.mjs, then\n' +
  '# hand-maintained). Maps canonical field name -> SEMANTICS only:\n' +
  '#   picture: conveys TYPE and decimals (9=num, X=alpha, V9(n)=num_decimal).\n' +
  '#           The field SIZE comes from each record\'s pos, not the picture.\n' +
  '#   date_format: optional strftime; converted to neutral tokens at build.\n' +
  '#   description: short human description.\n' +
  '# Never contains positions. See docs/adr/0003.\n\n';
for (const name of catNames) {
  const c = catalogResolved[name];
  catalogText += `${name}:\n  picture: ${JSON.stringify(c.picture)}\n`;
  if (c.date_format) catalogText += `  date_format: ${JSON.stringify(c.date_format)}\n`;
  catalogText += `  description: ${JSON.stringify(c.description)}\n\n`;
}

fs.mkdirSync(path.dirname(CATALOG_OUT), { recursive: true });
fs.writeFileSync(CATALOG_OUT, catalogText);

for (const out of [...outputs, ...codeTables]) {
  fs.mkdirSync(path.dirname(out.outPath), { recursive: true });
  fs.writeFileSync(out.outPath, out.codes ? dumpCodeTable(out) : dumpRecord(out));
}

console.log(
  `migrate-legacy: wrote ${outputs.length} records, ${codeTables.length} code tables, ` +
    `${catNames.length} catalog fields`
);
if (dupKeyFiles.length) {
  console.log('\nLegacy duplicate-key files sanitized (kept first occurrence):');
  for (const d of dupKeyFiles) console.log('  - ' + d);
}
if (conflicts.length) {
  console.log('\nNotes / conflicts to review:');
  for (const c of conflicts) console.log('  - ' + c);
}
