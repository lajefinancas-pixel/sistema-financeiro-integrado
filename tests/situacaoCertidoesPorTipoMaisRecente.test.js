// Testes do defeito "certidão renovada continua alertando": o fornecedor com um
// FGTS vencido em 02/09 e um FGTS novo vencendo em 28/09 aparecia como "1
// certidão vencida", porque a conta somava as duas emissões do mesmo tipo.
//
// O que estes testes travam:
//
//   A SITUAÇÃO SAI DA CERTIDÃO MAIS RECENTE DE CADA TIPO
//   A EMISSÃO ANTERIOR CONTINUA CADASTRADA E VISÍVEL
//   CERTIDÃO SEM VENCIMENTO NÃO É SUPERADA POR NINGUÉM
//   FORNECEDORES DIFERENTES NÃO DISPUTAM A MESMA VIGÊNCIA
//   TODAS AS TELAS LEEM A MESMA REGRA (UM ÚNICO UTILITÁRIO)
//
// A regra é um módulo puro (lib/certidoesRegras.js), então dá para exercitá-la
// direto. Os pontos que só existem dentro de módulos com Supabase (filtros,
// alertas, relatórios, ficha) são travados pelo texto do arquivo, que é o que
// garante que nenhum deles voltou a contar por conta própria.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DIAS_ALERTA_VENCIMENTO,
  anotarVigencia,
  contarRegularidade,
  detalheDocumental,
  ehVigenteNoTipo,
  hojeISO,
  resumoDocumental,
  somenteAnteriores,
  somenteVigentes,
  temEmissoesConcorrentes,
} from "../src/lib/certidoesRegras.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/** Data ISO a N dias de hoje (negativo = passado), para não depender do calendário. */
function emDias(dias) {
  const base = new Date(`${hojeISO()}T00:00:00`);
  base.setDate(base.getDate() + dias);
  return base.toISOString().slice(0, 10);
}

const FGTS_VENCIDO = {
  id: 1,
  fornecedor_id: 10,
  tipo_certidao_id: 5,
  tipos_certidao: { id: 5, nome: "FGTS" },
  numero_documento: "111",
  data_emissao: emDias(-95),
  data_vencimento: emDias(-1),
  arquivo_url: "certidoes/fgts-antigo.pdf",
};

const FGTS_NOVO = {
  id: 2,
  fornecedor_id: 10,
  tipo_certidao_id: 5,
  tipos_certidao: { id: 5, nome: "FGTS" },
  numero_documento: "222",
  data_emissao: emDias(-2),
  data_vencimento: emDias(25),
  arquivo_url: "certidoes/fgts-novo.pdf",
};

const CARTAO_CNPJ = {
  id: 3,
  fornecedor_id: 10,
  tipo_certidao_id: 9,
  tipos_certidao: { id: 9, nome: "Cartão CNPJ" },
  data_emissao: emDias(-300),
  data_vencimento: null,
};

// O caso do relato, na ordem em que a consulta devolve (vencimento mais próximo
// primeiro), que é justamente a ordem em que a antiga vinha na frente.
const FICHA = [FGTS_VENCIDO, FGTS_NOVO, CARTAO_CNPJ];

test("fornecedor com FGTS vencido e FGTS novo aparece como regular", () => {
  const resumo = resumoDocumental(FICHA);
  assert.equal(resumo.vencidas, 0);
  assert.equal(resumo.tom, "a_vencer");
  assert.equal(resumo.texto, "1 certidão próxima do vencimento");

  // Sem a emissão anterior na conta, o alerta de vencida desaparece de vez.
  const semJanela = contarRegularidade(FICHA, 0);
  assert.equal(semJanela.vencidas, 0);
  assert.equal(semJanela.aVencer, 0);
  assert.equal(semJanela.regular, true);
  assert.equal(resumoDocumental(FICHA.slice(0, 2)).vencidas, 0);
});

test("a certidão antiga continua cadastrada, contada no total e visível na ficha", () => {
  const lista = anotarVigencia(FICHA);
  assert.equal(lista.length, 3);
  assert.deepEqual(lista.map((c) => c.id), [1, 2, 3]);

  const antiga = lista[0];
  assert.equal(antiga.vigenteNoTipo, false);
  assert.equal(antiga.superadaPorId, 2);
  assert.equal(antiga.superadaPorVencimento, FGTS_NOVO.data_vencimento);
  // Nada do cadastro foi apagado ou sobrescrito para ela sair da conta.
  assert.equal(antiga.numero_documento, "111");
  assert.equal(antiga.data_vencimento, FGTS_VENCIDO.data_vencimento);
  assert.equal(antiga.arquivo_url, "certidoes/fgts-antigo.pdf");
  assert.equal(FGTS_VENCIDO.vigenteNoTipo, undefined);

  assert.equal(lista[1].vigenteNoTipo, true);
  assert.equal(lista[1].superadaPorId, null);

  const resumo = resumoDocumental(FICHA);
  assert.equal(resumo.total, 3);
  assert.equal(resumo.vigentes, 2);
  assert.equal(resumo.anteriores, 1);
  assert.match(detalheDocumental(resumo), /3 certidões cadastradas/);
  assert.match(detalheDocumental(resumo), /1 emissão anterior não entra na conta/);
});

test("a marca de vigência só aparece onde há mais de uma emissão do tipo", () => {
  const [antiga, nova, cartao] = anotarVigencia(FICHA);
  assert.equal(temEmissoesConcorrentes(antiga), true);
  assert.equal(temEmissoesConcorrentes(nova), true);
  assert.equal(temEmissoesConcorrentes(cartao), false);

  const so = anotarVigencia([FGTS_VENCIDO]);
  assert.equal(so[0].vigenteNoTipo, true);
  assert.equal(temEmissoesConcorrentes(so[0]), false);
  // Uma única emissão vencida continua sendo pendência.
  assert.equal(contarRegularidade([FGTS_VENCIDO]).vencidas, 1);
});

test("certidão sem vencimento segue como está hoje", () => {
  const duas = [CARTAO_CNPJ, { ...CARTAO_CNPJ, id: 4, data_emissao: emDias(-10) }];
  const lista = anotarVigencia(duas);
  assert.deepEqual(lista.map(ehVigenteNoTipo), [true, true]);
  assert.equal(somenteAnteriores(duas).length, 0);
  assert.equal(contarRegularidade(duas).regular, true);
});

test("a vigência é por fornecedor e por tipo", () => {
  const outroFornecedor = { ...FGTS_VENCIDO, id: 7, fornecedor_id: 20 };
  const outroTipo = {
    ...FGTS_VENCIDO,
    id: 8,
    tipo_certidao_id: 6,
    tipos_certidao: { id: 6, nome: "Certidão Federal" },
  };
  const conta = contarRegularidade([...FICHA, outroFornecedor, outroTipo]);
  // O FGTS do outro fornecedor e a Federal deste continuam vencidos: a emissão
  // nova de FGTS não regulariza documento nem fornecedor alheio.
  assert.equal(conta.vencidas, 2);
  assert.equal(conta.anteriores, 1);
  assert.equal(somenteVigentes([...FICHA, outroFornecedor, outroTipo]).length, 4);
});

test("empate de vencimento é decidido pela emissão mais recente", () => {
  const mesmoDia = { ...FGTS_NOVO, id: 5, data_emissao: emDias(-30) };
  const vigentes = somenteVigentes([FGTS_NOVO, mesmoDia]);
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].id, 2);
  // A ordem em que a lista chega não muda quem vale.
  assert.equal(somenteVigentes([mesmoDia, FGTS_NOVO])[0].id, 2);
});

test("a janela de dias é a mesma da tela e não conta a emissão anterior", () => {
  assert.equal(DIAS_ALERTA_VENCIMENTO, 30);
  const conta = contarRegularidade(FICHA);
  assert.equal(conta.janela, 30);
  assert.equal(conta.aVencer, 1);
  assert.equal(conta.vencidas, 0);
});

test("todos os pontos que leem regularidade usam a regra compartilhada", async () => {
  const arquivos = {
    "src/lib/certidoesFornecedor.js": ["anotarVigencia"],
    "src/lib/alertasCertidoes.js": ["contarRegularidade", "somenteVigentes"],
    "src/lib/filtrosCertidoes.js": ["anotarVigencia", "ehVigenteNoTipo"],
    "src/lib/relatoriosDados.js": ["anotarVigencia", "somenteVigentes"],
    "src/lib/certidoesDocumento.js": ["ehVigenteNoTipo", "temEmissoesConcorrentes"],
    "src/components/certidoes/badges.jsx": ["ehVigenteNoTipo", "temEmissoesConcorrentes"],
    "src/components/fornecedores/VidaDoFornecedor.jsx": ["anotarVigencia"],
  };

  for (const [caminho, nomes] of Object.entries(arquivos)) {
    const fonte = await read(caminho);
    assert.match(fonte, /certidoesRegras/, `${caminho} deveria importar a regra compartilhada`);
    nomes.forEach((nome) => {
      assert.match(fonte, new RegExp(nome), `${caminho} deveria usar ${nome}`);
    });
  }

  // O card do Painel Principal e a seção "Precisa da minha atenção" leem o
  // resumoCertidoes, que já passou a contar só as vigentes.
  const card = await read("src/components/certidoes/CardCertidoes.jsx");
  assert.match(card, /resumoCertidoes/);
  const painel = await read("src/lib/painelPessoal.js");
  assert.match(painel, /resumoCertidoes/);
});

test("os recortes de pendência dos relatórios ignoram a emissão superada", async () => {
  const catalogo = await read("src/lib/relatoriosCatalogo.js");
  assert.match(catalogo, /certidoesVigentesDe/);
  assert.match(catalogo, /l\.vigente !== false && l\.situacao_prazo === situacao/);
  // A listagem completa continua saindo, com a coluna que separa as duas.
  assert.match(catalogo, /label: "Vigência"/);

  const dados = await read("src/lib/relatoriosDados.js");
  assert.match(dados, /vigencia: vigente \? "Vigente" : "Anterior"/);
});

test("nenhuma certidão é escondida da listagem por causa da vigência", async () => {
  const filtros = await read("src/lib/filtrosCertidoes.js");
  // O filtro por vigência só entra quando há recorte de situação ou de prazo:
  // sem filtro, a base é a lista inteira anotada.
  assert.match(filtros, /const base = semCadastro\s*\n?\s*\? linhasNaoCadastradas\(certidoes, fornecedores\)\s*\n?\s*: anotarVigencia\(certidoes \?\? \[\]\);/);
  assert.match(filtros, /if \(f\.situacao && !ehVigenteNoTipo\(certidao\)\) return false;/);

  const ficha = await read("src/components/fornecedores/VidaDoFornecedor.jsx");
  assert.match(ficha, /BadgeVigencia/);
  assert.doesNotMatch(ficha, /filter\(ehVigenteNoTipo\)/);
});
