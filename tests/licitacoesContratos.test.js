import test from "node:test";
import assert from "node:assert/strict";
import { filtrarLicitacoesContratos, rotuloSecretariasDaLicitacao, situacaoContrato } from "../src/lib/licitacoesContratosRegras.js";
import { gerarPdfLicitacoes, linhasDocumentoLicitacoes, montarHtmlLicitacoes, MARGEM_DOCUMENTO_LICITACOES } from "../src/lib/licitacoesContratosDocumento.js";

function isoEm(dias) {
  const data = new Date(); data.setHours(12, 0, 0, 0); data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

test("contrato com validade em 20 dias aparece como Vencendo em breve", () => {
  assert.equal(situacaoContrato({ data_validade: isoEm(20), encerrado: false }), "vencendo");
});

test("contrato com validade passada aparece como Vencido", () => {
  assert.equal(situacaoContrato({ data_validade: isoEm(-1), encerrado: false }), "vencido");
});

test("encerramento manual prevalece sobre a validade", () => {
  assert.equal(situacaoContrato({ data_validade: isoEm(20), encerrado: true }), "encerrado");
});

const registros = [
  { id:"1", fornecedor_id:"f1", tipo_id:"t1", secretaria_id:"s1", licitacoes_contratos_secretarias:[{secretarias:{id:"s1",nome:"Educação"}},{secretarias:{id:"s2",nome:"Saúde"}}], numero:"PE 14/2026", objeto:"Aquisição de gêneros alimentícios para a merenda escolar durante todo o ano letivo", data_inicio:"2026-02-10", data_validade:"2026-12-31", valor:125430.57, encerrado:false, fornecedores:{razao_social:"Cooperativa Serra Azul",nome_fantasia:"Serra Azul",cpf_cnpj:"12.345.678/0001-90"}, tipos_licitacao_contrato:{nome:"Pregão eletrônico"} },
  { id:"2", fornecedor_id:"f2", tipo_id:"t2", secretaria_id:"s2", numero:"CT 08/2025", objeto:"Manutenção preventiva de veículos", data_inicio:"2025-05-12", data_validade:"2025-12-20", valor:48000, encerrado:true, fornecedores:{razao_social:"Oficina Vale Ltda.",nome_fantasia:"Oficina Vale",cpf_cnpj:"98.765.432/0001-10"}, tipos_licitacao_contrato:{nome:"Contrato"} },
];

test("licitação com duas secretarias é encontrada pelo filtro de cada vínculo", () => {
  assert.deepEqual(filtrarLicitacoesContratos(registros, { secretaria: "s1" }).map((i) => i.id), ["1"]);
  assert.deepEqual(filtrarLicitacoesContratos(registros, { secretaria: "s2" }).map((i) => i.id), ["1", "2"]);
});

test("rótulo informa todas quando a seleção cobre a lista ativa", () => {
  assert.equal(rotuloSecretariasDaLicitacao(registros[0], 2), "Todas as secretarias");
  assert.equal(rotuloSecretariasDaLicitacao(registros[0], 13), "Educação, Saúde");
});

test("seleção Todas continua atendendo o filtro de secretaria criada futuramente", () => {
  const todas = { ...registros[0], todas_secretarias: true };
  assert.deepEqual(filtrarLicitacoesContratos([todas], { secretaria: "nova-secretaria" }).map((i) => i.id), ["1"]);
});

test("fornecedor e período combinados alimentam o PDF com exatamente a lista filtrada", () => {
  const filtrados = filtrarLicitacoesContratos(registros, { fornecedor:"12.345", assinaturaDe:"2026-01-01", assinaturaAte:"2026-12-31" });
  assert.deepEqual(filtrados.map((item) => item.id), ["1"]);
  const linhas = linhasDocumentoLicitacoes(filtrados);
  assert.equal(linhas.length, 1);
  assert.match(linhas[0].join(" "), /Cooperativa Serra Azul/);
  assert.doesNotMatch(linhas[0].join(" "), /Oficina Vale/);
  const pdf = gerarPdfLicitacoes(filtrados, { salvar:false });
  assert.ok(pdf.internal.pageSize.getWidth() - (MARGEM_DOCUMENTO_LICITACOES * 2) > 700);
  assert.ok(pdf.getNumberOfPages() >= 1);
});

test("filtro textual de objeto funciona isoladamente e ignora acentos", () => {
  const filtrados = filtrarLicitacoesContratos(registros, { objeto:"generos alimenticios" });
  assert.deepEqual(filtrados.map((item) => item.id), ["1"]);
});

test("impressão sem filtros contém a lista completa e preserva texto com quebra dentro das margens", () => {
  const completos = filtrarLicitacoesContratos(registros, {});
  const html = montarHtmlLicitacoes(completos);
  assert.equal(completos.length, 2);
  assert.match(html, /Cooperativa Serra Azul/);
  assert.match(html, /Oficina Vale/);
  assert.match(html, /Aquisição de gêneros alimentícios para a merenda escolar durante todo o ano letivo/);
  assert.match(html, /@page \{ size: A4 landscape; margin: 10mm; \}/);
  assert.match(html, /overflow-wrap:anywhere/);
});
