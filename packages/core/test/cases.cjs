'use strict';
// Shared golden-file test cases. Each case names a record key, a set of input
// field values (missing fields fall back to spec defaults), and independent
// position/field checks. The generator writes the produced line to
// test/golden/<safeKey>.line; the test asserts the engine reproduces it and
// that parse/toLine round-trips.
//
// Sample values are synthetic (anonymized): fictional CNPJs, agencies, names.

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
      nome_da_empresa: 'EMPRESA TESTE LTDA',
      data_de_geracao: '260626',
    },
    checks: {
      substr: { '1-1': '0', '2-2': '2' },
      parsed: { codigo_do_banco: '341' },
    },
  },
  {
    key: 'cnab400/341/retorno/detalhe',
    values: {
      tipo_de_registro: '1',
      agencia: '1234',
      conta: '56789',
      nosso_numero: '00000001',
      codigo_de_ocorrencia: '06',
      data_de_ocorrencia: '260626',
      valor_do_titulo: '0000000150000',
      data_vencimento: '150726',
    },
    checks: {
      substr: { '1-1': '1' },
      parsed: { codigo_de_ocorrencia: '6', valor_do_titulo: '150000' },
    },
  },
  {
    key: 'cnab400/341/retorno/trailer_arquivo',
    values: {
      numero_sequencial: '000003',
    },
    checks: {
      substr: { '1-1': '9' },
      parsed: { tipo_de_registro: '9' },
    },
  },
];

module.exports = { cases, safeKey: (k) => k.replace(/\//g, '__') };
