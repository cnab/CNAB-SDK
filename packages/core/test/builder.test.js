'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CnabFile, CnabFileBuilder } = require('../lib/index.js');

const specJson = fs.readFileSync(
  path.resolve(__dirname, '../../spec/dist/spec.json'),
  'utf8'
);

test('builds a full Caixa 104 SIGCB CNAB240 remessa file', () => {
  const builder = CnabFileBuilder.forBank(
    specJson,
    'cnab240',
    '104',
    'sigcb',
    'remessa'
  );
  builder.withHeader({
    codigo_banco: '104',
    codigo_inscricao: '2',
    numero_inscricao: '12345678000199',
    agencia: '1234',
    codigo_cedente: '654321',
    nome_empresa: 'EMPRESA TESTE LTDA',
    nome_banco: 'CAIXA ECONOMICA FEDERAL',
    codigo_remessa_retorno: '1',
    data_geracao: '18072026',
    hora_geracao: '101500',
    numero_sequencial_arquivo: '1',
    // deliberately try to override a builder-owned sequence counter:
    lote_servico: '7777',
  });
  builder.startLote({
    codigo_banco: '104',
    tipo_operacao: 'R',
    codigo_inscricao: '2',
    numero_inscricao: '12345678000199',
    agencia: '1234',
    codigo_cedente: '654321',
    nome_empresa: 'EMPRESA TESTE LTDA',
    numero_sequencial_arquivo: '1',
    data_geracao: '18072026',
  });
  builder.addDetail('detalhe_segmento_p', {
    codigo_banco: '104',
    codigo_ocorrencia: '01',
    agencia: '1234',
    codigo_cedente: '654321',
    modalidade_carteira: '14',
    nosso_numero: '123456789012345',
    numero_documento: 'DOC1',
    vencimento: '30082026',
    valor_titulo: '150000',
  });
  builder.addDetail('detalhe_segmento_r', {
    codigo_banco: '104',
    codigo_ocorrencia: '01',
  });
  builder.addDetail('detalhe_segmento_p', {
    codigo_banco: '104',
    codigo_ocorrencia: '01',
    numero_documento: 'DOC2',
    vencimento: '30092026',
    valor_titulo: '250000',
  });
  builder.addDetail('detalhe_segmento_r', {
    codigo_banco: '104',
    codigo_ocorrencia: '01',
  });
  builder.endLote({
    codigo_banco: '104',
    qtde_titulo_cobranca_simples: '2',
    valor_total_titulo_simples: '400000',
  });
  const content = builder.toFileContent({ codigo_banco: '104' });

  const lines = content.split('\n');
  assert.strictEqual(lines.length, 8); // header + (header_lote + 4 details + trailer_lote) + trailer
  for (const line of lines) {
    assert.strictEqual(line.length, 240);
  }

  // lote_servico sequence: '0000' header, '0001' on every lote line, '9999' trailer
  const loteServico = lines.map((l) => l.substring(3, 7));
  assert.deepStrictEqual(loteServico, [
    '0000', // header_arquivo (builder-owned: the user-supplied 7777 is ignored)
    '0001',
    '0001',
    '0001',
    '0001',
    '0001',
    '0001',
    '9999',
  ]);

  // numero_sequencial_lote 1..4 within the lote (details, pos 9-13)
  const detailSeq = lines.slice(2, 6).map((l) => l.substring(8, 13));
  assert.deepStrictEqual(detailSeq, ['00001', '00002', '00003', '00004']);

  // trailer_lote qtde_registro_lote = header_lote + 4 details + trailer_lote = 6
  assert.strictEqual(lines[6].substring(17, 23), '000006');
  // trailer_arquivo qtde_lotes = 1, qtde_registros = 8 (all lines)
  assert.strictEqual(lines[7].substring(17, 23), '000001');
  assert.strictEqual(lines[7].substring(23, 29), '000008');

  // round-trip: the file parser classifies every line
  const parsed = CnabFile.forBank(
    specJson,
    'cnab240',
    '104',
    'sigcb',
    'remessa'
  ).parse(content);
  assert.strictEqual(parsed.length, 8);
  for (const p of parsed) {
    assert.notStrictEqual(p.recordKey, '');
  }
  assert.deepStrictEqual(
    parsed.map((p) => p.recordKey),
    [
      'cnab240/104/sigcb/header_arquivo',
      'cnab240/104/sigcb/header_lote',
      'cnab240/104/sigcb/remessa/detalhe_segmento_p',
      'cnab240/104/sigcb/remessa/detalhe_segmento_r',
      'cnab240/104/sigcb/remessa/detalhe_segmento_p',
      'cnab240/104/sigcb/remessa/detalhe_segmento_r',
      'cnab240/104/sigcb/trailer_lote',
      'cnab240/104/sigcb/trailer_arquivo',
    ]
  );
  // parsed counters match what the builder wrote
  assert.strictEqual(parsed[6].fields.qtde_registro_lote, '6');
  assert.strictEqual(parsed[7].fields.qtde_lotes, '1');
  assert.strictEqual(parsed[7].fields.qtde_registros, '8');
});

test('user-supplied trailer counters win over auto-computation (cnab240)', () => {
  const builder = CnabFileBuilder.forBank(
    specJson,
    'cnab240',
    '104',
    'sigcb',
    'remessa'
  );
  builder.withHeader({ codigo_banco: '104' });
  builder.startLote({ codigo_banco: '104' });
  builder.addDetail('detalhe_segmento_p', { codigo_banco: '104' });
  builder.endLote({ codigo_banco: '104', qtde_registro_lote: '99' });
  const content = builder.toFileContent({
    codigo_banco: '104',
    qtde_registros: '77',
  });
  const lines = content.split('\n');
  assert.strictEqual(lines[3].substring(17, 23), '000099'); // user value kept
  assert.strictEqual(lines[4].substring(23, 29), '000077'); // user value kept
  assert.strictEqual(lines[4].substring(17, 23), '000001'); // qtde_lotes still auto
});

test('builds a full Itaú 341 CNAB400 remessa file', () => {
  const builder = CnabFileBuilder.forBank(
    specJson,
    'cnab400',
    '341',
    '',
    'remessa'
  );
  builder.withHeader({
    agencia: '1234',
    conta: '56789',
    conta_dv: '0',
    nome_empresa: 'EMPRESA TESTE LTDA',
    nome_banco: 'BANCO ITAU SA',
    data_geracao: '180726',
  });
  builder.addDetail('detalhe', {
    codigo_inscricao: '02',
    numero_inscricao: '12345678000199',
    agencia: '1234',
    conta: '56789',
    conta_dv: '0',
    nosso_numero: '12345678',
    numero_carteira: '109',
    codigo_carteira: 'I',
    numero_documento: 'DOC1',
    vencimento: '300826',
    valor_titulo: '150000',
    nome: 'FULANO DE TAL',
  });
  builder.addDetail('detalhe', {
    codigo_inscricao: '02',
    numero_inscricao: '12345678000199',
    numero_documento: 'DOC2',
    vencimento: '300926',
    valor_titulo: '250000',
    nome: 'CICLANO DE TAL',
  });
  const content = builder.toFileContent({});

  const lines = content.split('\n');
  assert.strictEqual(lines.length, 4); // header + 2 detalhes + trailer
  for (const line of lines) {
    assert.strictEqual(line.length, 400);
  }

  // numero_sequencial 1..4 over all lines (pos 395-400)
  const seqs = lines.map((l) => l.substring(394, 400));
  assert.deepStrictEqual(seqs, ['000001', '000002', '000003', '000004']);

  // round-trip: the file parser classifies every line
  const parsed = CnabFile.forBank(
    specJson,
    'cnab400',
    '341',
    '',
    'remessa'
  ).parse(content);
  assert.strictEqual(parsed.length, 4);
  for (const p of parsed) {
    assert.notStrictEqual(p.recordKey, '');
  }
  assert.deepStrictEqual(
    parsed.map((p) => p.recordKey),
    [
      'cnab400/341/remessa/header_arquivo',
      'cnab400/341/remessa/detalhe',
      'cnab400/341/remessa/detalhe',
      'cnab400/341/remessa/trailer_arquivo',
    ]
  );
});

test('addDetail with an unknown record name throws', () => {
  const builder = CnabFileBuilder.forBank(
    specJson,
    'cnab240',
    '104',
    'sigcb',
    'remessa'
  );
  builder.startLote({});
  assert.throws(
    () => builder.addDetail('detalhe_segmento_z', {}),
    /unknown record "detalhe_segmento_z"/
  );
});

test('addDetail before startLote throws on cnab240', () => {
  const builder = CnabFileBuilder.forBank(
    specJson,
    'cnab240',
    '104',
    'sigcb',
    'remessa'
  );
  assert.throws(
    () => builder.addDetail('detalhe_segmento_p', {}),
    /no lote is open/
  );
});

test('startLote throws on cnab400', () => {
  const builder = CnabFileBuilder.forBank(
    specJson,
    'cnab400',
    '341',
    '',
    'remessa'
  );
  assert.throws(() => builder.startLote({}), /only available for cnab240/);
});
