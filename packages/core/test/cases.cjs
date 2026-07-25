'use strict';
// Shared golden-file test cases. Each case names a record key, a set of input
// field values (missing fields fall back to spec defaults), and independent
// position/field checks. The generator writes the produced line to
// test/golden/<safeKey>.line; the test asserts the engine reproduces it and
// that parse/toLine round-trips.
//
// Sample values are synthetic (anonymized): fictional CNPJs, agencies, names.
//
// Two kinds of cases (issue #16):
//   * `cases`     — hand-written, with explicit position/parsed assertions.
//                   These encode real knowledge of the layout; prefer them.
//   * `autoCases` — deterministically derived (see `defaultCaseFor`) for every
//                   shipped record NOT covered by a hand-written case, so all
//                   shipped records have a committed golden line. They assert
//                   nothing about the layout's meaning; they are drift
//                   detectors — a spec edit that moves a field changes the
//                   golden and the diff shows exactly what moved.
// `allCases` is the union and is what the generator and the test iterate.

const fs = require('node:fs');
const path = require('node:path');

const cases = [
  // --- Caixa 104 CNAB240 (SIGCB) --------------------------------------------
  {
    key: 'cnab240/104/sigcb/header_arquivo', // remessa
    values: {
      codigo_banco: '104',
      codigo_inscricao: '2',
      numero_inscricao: '12345678000199',
      codigo_convenio: '00000000000123456',
      agencia: '01234',
      agencia_dv: '5',
      codigo_cedente: '000123',
      nome_empresa: 'EMPRESA TESTE LTDA',
      nome_banco: 'CAIXA ECONOMICA FEDERAL',
      codigo_remessa_retorno: '1',
      data_geracao: '26062026',
      hora_geracao: '103000',
      numero_sequencial_arquivo: '000001',
    },
    checks: {
      substr: { '1-3': '104', '143-143': '1', '144-151': '26062026' },
      parsed: { codigo_banco: '104', nome_banco: 'CAIXA ECONOMICA FEDERAL' },
    },
  },
  {
    key: 'cnab240/104/sigcb/remessa/detalhe_segmento_p',
    values: {
      codigo_banco: '104',
      lote_servico: '0001',
      numero_sequencial_lote: '00001',
      codigo_segmento: 'P',
      codigo_ocorrencia: '01',
      nosso_numero: '00000000001',
      numero_documento: 'DOC0000001',
      vencimento: '15072026',
      valor_titulo: '000000000150000',
      data_emissao: '26062026',
    },
    checks: {
      substr: { '14-14': 'P' },
      parsed: { codigo_segmento: 'P', valor_titulo: '150000' },
    },
  },
  {
    key: 'cnab240/104/sigcb/retorno/detalhe_segmento_t',
    values: {
      codigo_banco: '104',
      lote_servico: '0001',
      codigo_segmento: 'T',
      codigo_cedente: '000123',
      nosso_numero: '000000000000001',
      valor_titulo: '000000000150000',
    },
    checks: {
      substr: { '14-14': 'T' },
      parsed: { codigo_segmento: 'T' },
    },
  },

  // --- Itaú 341 CNAB400 -----------------------------------------------------
  {
    key: 'cnab400/341/remessa/header_arquivo',
    values: {
      agencia: '1234',
      conta: '56789',
      conta_dv: '0',
      nome_empresa: 'EMPRESA TESTE LTDA',
      codigo_banco: '341',
      nome_banco: 'BANCO ITAU SA',
      data_geracao: '260626',
    },
    checks: {
      substr: { '1-1': '0', '3-9': 'REMESSA', '77-79': '341' },
      parsed: { codigo_banco: '341', literal_remessa: 'REMESSA' },
    },
  },
  {
    key: 'cnab400/341/retorno/header_arquivo',
    values: {
      codigo_do_banco: '341',
      nome_empresa: 'EMPRESA TESTE LTDA',
      data_geracao: '260626',
    },
    checks: {
      substr: { '1-1': '0', '2-2': '2' },
      parsed: { codigo_do_banco: '341' },
    },
  },
  {
    key: 'cnab400/341/retorno/detalhe',
    values: {
      tipo_registro: '1',
      agencia: '1234',
      conta: '56789',
      nosso_numero: '00000001',
      codigo_ocorrencia: '06',
      data_de_ocorrencia: '260626',
      valor_titulo: '0000000150000',
      data_vencimento: '150726',
    },
    checks: {
      substr: { '1-1': '1' },
      parsed: { codigo_ocorrencia: '6', valor_titulo: '150000' },
    },
  },
  {
    key: 'cnab400/341/retorno/trailer_arquivo',
    values: {
      numero_sequencial: '000003',
    },
    checks: {
      substr: { '1-1': '9' },
      parsed: { tipo_registro: '9' },
    },
  },
];

const safeKey = (k) => k.replace(/\//g, '__');

// --- auto-derived cases -----------------------------------------------------

const specDoc = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../spec/dist/spec.json'), 'utf8')
);

/** Record keys of everything shipped (templates are copy-from sources only). */
function shippedRecordKeys() {
  return Object.keys(specDoc.records).filter(
    (k) => specDoc.records[k].meta.template !== true
  );
}

/** Stable 32-bit FNV-1a hash — the whole derivation must be reproducible. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Fixed synthetic date/time values keep the derived lines plausible and stable.
const DATE_SAMPLES = { ddMMyyyy: '26062026', ddMMyy: '260626', HHmmss: '103000' };

/**
 * Deterministic synthetic value for one field. Alpha fields get the field name
 * (uppercased, `_` -> space) so the golden line stays human-readable; numeric
 * fields get digits derived from a stable hash of `record|field`. Values always
 * fit the field width, and digits only ever go into numeric fields, so this
 * works whether `toLine` truncates or throws on bad input.
 */
function syntheticValue(recordKey, field) {
  const width = field.end - field.start + 1;
  if (field.type === 'alpha') {
    const text = field.name.toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
    return text.substring(0, width);
  }
  if (field.dateFormat && DATE_SAMPLES[field.dateFormat]) {
    const sample = DATE_SAMPLES[field.dateFormat];
    return sample.length <= width ? sample : sample.substring(0, width);
  }
  let seed = hash(`${recordKey}|${field.name}`);
  let digits = '';
  for (let i = 0; i < Math.min(width, 15); i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    digits += String(seed % 10);
  }
  return digits;
}

/**
 * Derive a deterministic case for a record that has no hand-written one.
 * Fields carrying a spec default are left out so the default wins — that keeps
 * record discriminators (tipo_registro, codigo_segmento, ...) intact.
 */
function defaultCaseFor(recordKey) {
  const raw = specDoc.records[recordKey];
  if (!raw) {
    throw new Error(`unknown record key: ${recordKey}`);
  }
  const values = {};
  for (const field of raw.fields) {
    if (field.default) {
      continue;
    }
    values[field.name] = syntheticValue(recordKey, field);
  }
  return { key: recordKey, values, checks: {}, auto: true };
}

const explicitKeys = new Set(cases.map((c) => c.key));
const autoCases = shippedRecordKeys()
  .filter((k) => !explicitKeys.has(k))
  .sort()
  .map(defaultCaseFor);

const allCases = [...cases, ...autoCases];

module.exports = {
  cases,
  autoCases,
  allCases,
  defaultCaseFor,
  shippedRecordKeys,
  safeKey,
};
