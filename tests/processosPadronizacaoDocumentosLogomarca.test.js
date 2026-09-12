import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CIENTE_AUTORIZO,
  DESPACHO_PREFEITA,
  MUNICIPIO,
  PAPEL_PREFEITA,
  PROVIDENCIAS,
  ROTULO_AUTORIZACAO,
  etiquetaDeCpf,
  linhasDaIdentificacao,
} from "../src/lib/processosDocumentoComum.js";
import {
  dadosDoDocumento as dadosDaDiaria,
  htmlDoProcesso as htmlDaDiaria,
  montarPdfDoProcesso as pdfDaDiaria,
} from "../src/lib/processosDiariasDocumento.js";
import {
  dadosDoDocumento as dadosDoServico,
  htmlDoProcesso as htmlDoServico,
  montarPdfDoProcesso as pdfDoServico,
} from "../src/lib/processosServicosDocumento.js";
import {
  processoParaFormulario as formularioDaDiaria,
  processoVazio as diariaVazia,
} from "../src/lib/processosDiarias.js";
import {
  processoParaFormulario as formularioDoServico,
  processoVazio as servicoVazio,
} from "../src/lib/processosServicos.js";
import {
  ENCAMINHAMENTO_PADRAO,
  secretariasParaEncaminhamento,
  sugerirEncaminhamento,
} from "../src/lib/processosEncaminhamento.js";

/**
 * PROCESSOS — A PADRONIZAÇÃO DOS CINCO DOCUMENTOS, E O CONSERTO DA MIGRATION DA
 * LOGOMARCA.
 *
 * Os CINCO documentos do módulo, que daqui para frente seguem UMA regra só:
 *
 *   1. Requisição de Diárias                          (diária, folha 1)
 *   2. Liquidação/Solicitação de Pagamento             (diária, folha 2)
 *   3. Prestação de Contas de Diárias                  (diária, folha 3)
 *   4. Requisição de Material/Serviço                  (serviço, folha 1)
 *   5. Liquidação/Solicitação de Pagamento             (serviço, folha 2)
 *
 * O que este arquivo defende, e que nenhum outro defende:
 *
 *   - CADA FOLHA TEM A DATA DELA, sempre editável e sem depender de nenhum outro
 *     campo estar preenchido;
 *   - A ASSINATURA DO REQUISITANTE E A AUTORIZAÇÃO DA PREFEITA SAEM LADO A LADO
 *     em todas as folhas que têm autorização -- com a exceção já definida da
 *     Requisição de Diárias, onde as três assinaturas seguem empilhadas;
 *   - ABAIXO DO TRAÇO SAEM NOME, CARGO E CPF, e nada mais;
 *   - "À SECRETARIA DE ___" sai PREENCHIDO em todas elas;
 *   - "VIAGEM REALIZADA" E "CONFERÊNCIA INTERNA" NÃO EXISTEM MAIS na tela;
 *   - o LAYOUT MORA EM UM LUGAR SÓ (src/lib/processosDocumentoComum.js), e não
 *     copiado documento a documento;
 *   - a MIGRATION DO STORAGE roda de ponta a ponta, garantindo a função de
 *     permissão ANTES das políticas, e NÃO apaga a logomarca em uso.
 *
 * ⚠️ ISTO É PAPEL. Nada aqui debita conta, dá baixa em NF, altera saldo, cria
 * pagamento ou mexe na Programação Diária.
 */

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/** As folhas do HTML, uma por página impressa. */
const folhasDoHtml = (html) => html.split('class="folha"').slice(1);

/** O texto que o PDF imprime, folha por folha. */
function textoDasFolhas(pdf) {
  const folhas = [];
  for (let n = 1; n < pdf.internal.pages.length; n += 1) {
    const bruto = pdf.internal.pages[n].join("\n");
    folhas.push([...bruto.matchAll(/\((.*?)\) Tj/g)].map((achado) => achado[1]).join(" | "));
  }
  return folhas;
}

/** Onde, na folha do PDF, cada texto foi impresso -- em pontos. */
function posicoesDaFolha(pdf, folha = 1) {
  const bruto = pdf.internal.pages[folha].join("\n");
  return [...bruto.matchAll(/([\d.]+) ([\d.]+) Td\n\((.*?)\) Tj/g)].map((achado) => ({
    x: Number(achado[1]),
    y: Number(achado[2]),
    texto: achado[3],
  }));
}

const acharTexto = (posicoes, pedaco) => posicoes.find((p) => p.texto.includes(pedaco)) ?? null;

const PREFEITA = { nome: "Ana Maria da Silva", cpf: "111.222.333-44", cargo: "Prefeita Municipal" };

/** O cadastro de secretarias do MÓDULO FINANCEIRO, como ele chega por leitura. */
const SECRETARIAS_DO_FINANCEIRO = [
  { id: "fin-1", nome: "Secretaria Municipal de Finanças", ativo: true },
  { id: "fin-2", nome: "Secretaria Municipal de Saúde", ativo: true },
  { id: "fin-3", nome: "Secretaria Municipal de Educação", ativo: true },
  { id: "fin-4", nome: "Secretaria Municipal de Cultura", ativo: false },
];

/** Uma diária COM tudo o que as três folhas imprimem. */
function diaria(extra = {}) {
  return {
    ...diariaVazia({ ano: 2026, hoje: "2026-03-10" }),
    id: 9,
    numero: 1,
    ano: 2026,
    situacao: "rascunho",
    data_processo: "2026-01-05",
    solicitante_nome: "Secretaria Municipal de Educação",
    beneficiario_nome: "Maria Souza da Silva",
    beneficiario_cargo: "Auxiliar Administrativo",
    beneficiario_cpf: "123.456.789-01",
    assinante_secretaria_nome: "João Batista de Oliveira Filho",
    assinante_secretaria_cargo: "Secretário Municipal de Educação",
    assinante_secretaria_cpf: "987.654.321-00",
    destino: "Brasília/DF",
    finalidade: "Reunião no Ministério da Fazenda.",
    data_saida: "2026-03-12",
    data_retorno: "2026-03-14",
    quantidade_diarias: "2,5",
    valor_unitario: "320,00",
    valor_total: 800,
    valor_extenso: "oitocentos reais",
    ...extra,
  };
}

/** Um serviço COM os dois signatários preenchidos. */
function servico(extra = {}) {
  return {
    ...servicoVazio({ ano: 2026, hoje: "2026-03-10" }),
    id: 41,
    numero: 7,
    ano: 2026,
    situacao: "rascunho",
    data_processo: "2026-01-05",
    solicitante_nome: "Secretaria Municipal de Turismo",
    tipo: "servicos",
    atestado: "servicos",
    objeto: "Manutenção dos aparelhos de ar-condicionado",
    itens: [
      { quantidade: "12", discriminacao: "Manutenção preventiva de ar-condicionado split" },
      { quantidade: "4", discriminacao: "Recarga de gás refrigerante" },
    ],
    favorecido_nome: "Refrigeração Laje Ltda.",
    favorecido_cpf_cnpj: "12.345.678/0001-90",
    valor_total: 4800,
    requisitante_nome: "Carla Dias do Nascimento",
    requisitante_cargo: "Chefe de Setor de Compras",
    requisitante_cpf: "555.666.777-88",
    liquidacao_assinante_nome: "Pedro Henrique Alves",
    liquidacao_assinante_cargo: "Diretor Administrativo",
    liquidacao_assinante_cpf: "444.333.222-11",
    ...extra,
  };
}

/* -------------------------------------------------------------------------
 * O COMPONENTE ÚNICO -- a regra de construção da entrega
 * ---------------------------------------------------------------------- */

test("0. cabeçalho, rodapé, assinaturas e datas moram em UM componente, reaproveitado", async () => {
  const [comum, diarias, servicos] = await Promise.all([
    read("src/lib/processosDocumentoComum.js"),
    read("src/lib/processosDiariasDocumento.js"),
    read("src/lib/processosServicosDocumento.js"),
  ]);

  // O componente comum é quem desenha o cabeçalho, o rodapé, a faixa de
  // assinaturas, o quadro da prefeita e a linha de local e data.
  [
    "export function cabecalhoHtml",
    "export function rodapeHtml",
    "export function assinaturaHtml",
    "export function assinaturasEmpilhadasHtml",
    "export function quadroDaPrefeitaHtml",
    "export function faixaDeAssinaturasHtml",
    "export function ladoDoRequisitanteHtml",
    "export function localEData",
    "export function emData",
    "export function etiquetaDeCpf",
    "export function linhasDaIdentificacao",
    "export function estilosComuns",
    "export function criarPincelBase",
  ].forEach((assinatura) => assert.ok(comum.includes(assinatura), `falta ${assinatura}`));

  // ⚠️ E OS DOIS DOCUMENTOS IMPORTAM DE LÁ, em vez de ter cópia própria.
  [diarias, servicos].forEach((documento) => {
    assert.match(documento, /from "\.\/processosDocumentoComum\.js"/);
    // Nenhuma das funções compartilhadas é redefinida documento a documento.
    [
      "function cabecalhoHtml",
      "function rodapeHtml",
      "function quadroDaPrefeitaHtml",
      "function faixaDeAssinaturasHtml",
      "function localEData",
      "function desenharBrasaoPdf",
      "function estilosComuns",
    ].forEach((copia) => assert.ok(!documento.includes(copia), `cópia local de ${copia}`));
  });

  // O município é UM valor, escrito de UM jeito, nos cinco documentos.
  assert.equal(MUNICIPIO, "São José da Laje/AL");
  const html = htmlDaDiaria(dadosDaDiaria(diaria(), {}), { escopo: "completo" })
    + htmlDoServico(dadosDoServico(servico(), {}), { escopo: "completo" });
  assert.equal((html.match(/São José da Laje\/AL,/g) ?? []).length, 5);
  assert.doesNotMatch(html, /São José da Laje - AL,/);
});

/* -------------------------------------------------------------------------
 * TESTE 1 -- a data de cada folha é editável, e não depende de nada
 * ---------------------------------------------------------------------- */

test("1. a data de cada folha é editável e não depende de outro campo estar preenchido", async () => {
  const [diariaJsx, servicoJsx] = await Promise.all([
    read("src/components/processos/ModalProcessoDiaria.jsx"),
    read("src/components/processos/ModalProcessoServico.jsx"),
  ]);

  // Os CINCO campos de data das folhas existem, são de data e só travam no
  // modo somente-leitura (processo finalizado ou sem permissão de editar).
  const CAMPOS = [
    [diariaJsx, "Data da Requisição de Diárias", "requisicao_data"],
    [diariaJsx, "Data da Liquidação", "liquidacao_data"],
    [diariaJsx, "Data da Prestação de Contas", "prestacao_data"],
    [servicoJsx, "Data da Requisição de Material/Serviço", "requisicao_data"],
    [servicoJsx, "Data da Liquidação/Solicitação de Pagamento", "liquidacao_data"],
  ];
  CAMPOS.forEach(([fonte, rotulo, campo]) => {
    const inicio = fonte.indexOf(`rotulo="${rotulo}"`);
    assert.ok(inicio > 0, `falta o campo ${rotulo}`);
    const bloco = fonte.slice(inicio, inicio + 700);
    assert.match(bloco, /tipo="date"/);
    assert.ok(bloco.includes(`definir("${campo}"`), `${rotulo} não grava em ${campo}`);
    // ⚠️ A ÚNICA TRAVA É `somenteLeitura`. Nada de depender de outro campo.
    const trava = bloco.match(/desabilitado=\{([^}]*)\}/)?.[1] ?? "";
    assert.equal(trava.trim(), "somenteLeitura", `${rotulo} tem trava a mais`);
  });

  // E nenhum campo de data tem piso ou teto: data anterior é aceita.
  [diariaJsx, servicoJsx].forEach((fonte) => {
    assert.doesNotMatch(fonte, /tipo="date"[\s\S]{0,400}?\bmin=/);
    assert.doesNotMatch(fonte, /tipo="date"[\s\S]{0,400}?\bmax=/);
  });

  // ⚠️ A DATA DA LIQUIDAÇÃO DA DIÁRIA SAI EM BLOCO PRÓPRIO, NO TOPO DA FOLHA.
  // Antes ela morava dentro de "Viagem realizada", cercada de saída, retorno e
  // valor a liquidar -- e por isso parecia depender deles para liberar.
  const paginaDois = diariaJsx.slice(diariaJsx.indexOf("function SecaoLiquidacao"));
  const doBloco = paginaDois.indexOf('titulo="Data da liquidação"');
  assert.ok(doBloco > 0, "a data da liquidação precisa de bloco próprio");
  assert.ok(
    doBloco < paginaDois.indexOf('titulo="Encaminhamento da prefeita"'),
    "o bloco da data é o PRIMEIRO da folha 2",
  );

  // A data de abertura é só a sugestão inicial: o documento imprime a escolhida,
  // inclusive quando ela é ANTERIOR à abertura.
  const escolhida = dadosDaDiaria(
    diaria({ data_processo: "2026-05-10", requisicao_data: "2026-02-03" }),
    {},
  );
  assert.equal(escolhida.requisicao.localEData, "São José da Laje/AL, 3 de fevereiro de 2026");
  // E, em branco, cada folha cai na data de abertura -- sem inventar a de hoje.
  const semData = dadosDaDiaria(
    diaria({ requisicao_data: "", liquidacao_data: "", prestacao_data: "" }),
    {},
  );
  assert.equal(semData.requisicao.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(semData.liquidacao.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  // ⚠️ E O RASCUNHO NOVO JÁ ABRE COM A DE HOJE SUGERIDA -- sugestão, não trava:
  // o campo continua editável e o documento imprime o que for escolhido.
  assert.equal(diariaVazia({ ano: 2026, hoje: "2026-03-10" }).requisicao_data, "2026-03-10");
});

/* -------------------------------------------------------------------------
 * TESTE 2 -- datas diferentes por folha, impressas cada uma na sua
 * ---------------------------------------------------------------------- */

test("2. datas diferentes por folha saem certas nas CINCO folhas, em HTML e em PDF", () => {
  const daDiaria = dadosDaDiaria(
    diaria({ requisicao_data: "2026-02-03", liquidacao_data: "2026-04-20", prestacao_data: "2026-05-30" }),
    {},
  );
  const doServico = dadosDoServico(
    servico({ requisicao_data: "2026-06-01", liquidacao_data: "2026-07-15" }),
    {},
  );

  const folhasDiaria = folhasDoHtml(htmlDaDiaria(daDiaria, { escopo: "completo" }));
  const folhasServico = folhasDoHtml(htmlDoServico(doServico, { escopo: "completo" }));
  const ESPERADO = [
    [folhasDiaria[0], "3 de fevereiro de 2026", ["20 de abril", "30 de maio"]],
    [folhasDiaria[1], "20 de abril de 2026", ["3 de fevereiro", "30 de maio"]],
    [folhasDiaria[2], "30 de maio de 2026", ["3 de fevereiro", "20 de abril"]],
    [folhasServico[0], "1 de junho de 2026", ["15 de julho"]],
    [folhasServico[1], "15 de julho de 2026", ["1 de junho"]],
  ];
  ESPERADO.forEach(([folha, propria, alheias]) => {
    assert.ok(folha.includes(propria), `a folha deveria trazer ${propria}`);
    alheias.forEach((outra) => assert.ok(!folha.includes(outra), `a folha trouxe ${outra}`));
  });
  // E a data de abertura (5 de janeiro) não aparece em folha nenhuma.
  assert.ok(!folhasDiaria.concat(folhasServico).join(" ").includes("5 de janeiro de 2026"));

  // O "Em, __/__/__" da autorização da prefeita segue a data DAQUELA folha.
  assert.equal(daDiaria.requisicao.emData, "Em, 03/02/2026");
  assert.equal(daDiaria.liquidacao.emData, "Em, 20/04/2026");
  assert.equal(doServico.requisicao.emData, "Em, 01/06/2026");
  assert.equal(doServico.liquidacao.emData, "Em, 15/07/2026");

  // No PDF, a mesma coisa.
  const impressoDiaria = textoDasFolhas(pdfDaDiaria(daDiaria, { escopo: "completo" }));
  assert.ok(impressoDiaria[0].includes("3 de fevereiro de 2026"));
  assert.ok(impressoDiaria[1].includes("20 de abril de 2026"));
  assert.ok(impressoDiaria[2].includes("30 de maio de 2026"));
  const impressoServico = textoDasFolhas(pdfDoServico(doServico, { escopo: "completo" }));
  assert.ok(impressoServico[0].includes("1 de junho de 2026"));
  assert.ok(impressoServico[1].includes("15 de julho de 2026"));
});

/* -------------------------------------------------------------------------
 * TESTE 3 -- requisitante e prefeita LADO A LADO (exceto Requisição de Diárias)
 * ---------------------------------------------------------------------- */

test("3. a autorização da prefeita sai AO LADO da assinatura, nas três folhas que pedem faixa", () => {
  const daDiaria = dadosDaDiaria(diaria(), { prefeita: PREFEITA });
  const doServico = dadosDoServico(servico(), { prefeita: PREFEITA });
  const [diariaUm, diariaDois, diariaTres] = folhasDoHtml(htmlDaDiaria(daDiaria, { escopo: "completo" }));
  const [servicoUm, servicoDois] = folhasDoHtml(htmlDoServico(doServico, { escopo: "completo" }));

  // AS TRÊS FOLHAS QUE USAM A FAIXA: liquidação da diária, e as duas do serviço.
  [diariaDois, servicoUm, servicoDois].forEach((folha) => {
    const faixa = folha.slice(folha.indexOf('<div class="faixa-assinaturas">'));
    assert.match(faixa, /<div class="lado">/);
    assert.match(faixa, /<div class="autorizacao">/);
    // O requisitante à ESQUERDA, a prefeita à DIREITA -- nesta ordem.
    assert.ok(faixa.indexOf('class="lado"') < faixa.indexOf('class="autorizacao"'));
    // Local e data ficam do lado do requisitante, dentro da faixa.
    assert.match(faixa, /<div class="lado"><p class="local-data">São José da Laje\/AL/);
  });

  // ⚠️ A EXCEÇÃO JÁ DEFINIDA: na REQUISIÇÃO DE DIÁRIAS as três assinaturas
  // (servidor, responsável pela secretaria e prefeita) seguem EMPILHADAS.
  assert.doesNotMatch(diariaUm, /faixa-assinaturas/);
  assert.match(diariaUm, /<div class="assinaturas">/);

  // ⚠️ A PRESTAÇÃO DE CONTAS NÃO TEM AUTORIZAÇÃO DA PREFEITA -- e por isso não
  // tem faixa: a folha 3 fecha com a assinatura do servidor, sozinha.
  assert.doesNotMatch(diariaTres, /faixa-assinaturas/);
  assert.doesNotMatch(diariaTres, new RegExp(ROTULO_AUTORIZACAO));
  assert.match(diariaTres, /<div class="assinatura-unica">/);

  // A faixa é UMA linha (flex) e não quebra no meio da folha.
  const css = htmlDoServico(doServico, { escopo: "requisicao" });
  assert.match(css, /\.faixa-assinaturas \{ display: flex/);
  assert.match(css, /\.faixa-assinaturas \{[^}]*page-break-inside: avoid/);

  // No PDF: os dois lados na MESMA faixa horizontal, em x diferentes.
  [
    [pdfDoServico(doServico, { escopo: "requisicao" }), 1, "Carla Dias do Nascimento"],
    [pdfDoServico(doServico, { escopo: "liquidacao" }), 1, "Pedro Henrique Alves"],
    [pdfDaDiaria(daDiaria, { escopo: "liquidacao" }), 1, "João Batista de Oliveira Filho"],
  ].forEach(([pdf, folha, assinante]) => {
    const posicoes = posicoesDaFolha(pdf, folha);
    const esquerda = acharTexto(posicoes, assinante);
    const ciente = acharTexto(posicoes, CIENTE_AUTORIZO);
    const prefeita = posicoes.find((p) => p.texto === PAPEL_PREFEITA) ?? null;
    assert.ok(esquerda && ciente && prefeita, `faltou alguém na faixa de ${assinante}`);
    assert.ok(esquerda.x < ciente.x, "o requisitante sai à ESQUERDA");
    assert.ok(Math.abs(esquerda.y - prefeita.y) < 35, "as duas assinaturas na mesma faixa");
  });
});

/* -------------------------------------------------------------------------
 * TESTE 4 -- nome, cargo e CPF abaixo do traço, e nada mais
 * ---------------------------------------------------------------------- */

test("4. abaixo de cada assinatura saem NOME, CARGO e CPF -- e a legenda antiga saiu", () => {
  const daDiaria = dadosDaDiaria(diaria(), { prefeita: PREFEITA });
  const doServico = dadosDoServico(servico(), { prefeita: PREFEITA });
  const html = htmlDaDiaria(daDiaria, { escopo: "completo" })
    + htmlDoServico(doServico, { escopo: "completo" });

  // ⚠️ A LEGENDA ENTRE PARÊNTESES NÃO SAI MAIS, em nenhuma das cinco folhas.
  assert.doesNotMatch(html, /identificação funcional do requisitante/);
  assert.doesNotMatch(html, /\(assinatura, nome e identificação/);

  // Os signatários das cinco folhas, cada um com nome, cargo e CPF pontuado.
  [
    ["Maria Souza da Silva", "Auxiliar Administrativo", "CPF: 123.456.789-01"],
    ["João Batista de Oliveira Filho", "Secretário Municipal de Educação", "CPF: 987.654.321-00"],
    ["Carla Dias do Nascimento", "Chefe de Setor de Compras", "CPF: 555.666.777-88"],
    ["Pedro Henrique Alves", "Diretor Administrativo", "CPF: 444.333.222-11"],
    ["Ana Maria da Silva", "Prefeita Municipal", "CPF: 111.222.333-44"],
  ].forEach(([nome, cargo, cpf]) => {
    assert.ok(html.includes(`<strong>${nome}</strong>`), `${nome} não saiu em destaque`);
    assert.ok(html.includes(`<span class="cargo">${cargo}</span>`), `falta o cargo de ${nome}`);
    assert.ok(html.includes(`<span class="cargo">${cpf}</span>`), `falta o CPF de ${nome}`);
  });

  // O CPF sai PONTUADO mesmo quando o cadastro guardou só os números.
  assert.equal(etiquetaDeCpf("12345678901"), "CPF: 123.456.789-01");
  // ⚠️ SEM CPF CADASTRADO A LINHA NÃO SAI -- nunca um "CPF:" vazio no papel.
  assert.equal(etiquetaDeCpf(""), "");
  assert.equal(etiquetaDeCpf("--"), "");
  assert.deepEqual(linhasDaIdentificacao({ papel: "PREFEITA", cargo: "", cpf: "" }), ["PREFEITA"]);
  const semCpf = htmlDaDiaria(
    dadosDaDiaria(diaria({ beneficiario_cpf: "", assinante_secretaria_cpf: "" }), {}),
    { escopo: "completo" },
  );
  assert.doesNotMatch(semCpf, /CPF:\s*<\/span>/);
  assert.doesNotMatch(semCpf, /undefined|null/);

  // No PDF é a mesma identificação, folha por folha.
  const impresso = textoDasFolhas(pdfDaDiaria(daDiaria, { escopo: "completo" })).join(" || ")
    + textoDasFolhas(pdfDoServico(doServico, { escopo: "completo" })).join(" || ");
  ["123.456.789-01", "987.654.321-00", "555.666.777-88", "444.333.222-11", "111.222.333-44"]
    .forEach((cpf) => assert.ok(impresso.includes(cpf), `o PDF não imprimiu ${cpf}`));
  assert.ok(!impresso.includes("identificação funcional"));
});

/* -------------------------------------------------------------------------
 * TESTE 5 -- a área da prefeita vem do cadastro do Chefe do Poder Executivo
 * ---------------------------------------------------------------------- */

test("5. a área da prefeita traz nome, cargo e CPF do cadastro, com o despacho completo", () => {
  const doServico = dadosDoServico(servico(), { prefeita: PREFEITA });
  assert.deepEqual(doServico.prefeita, PREFEITA);

  const html = htmlDoServico(doServico, { escopo: "requisicao" });
  const quadro = html.match(/<div class="autorizacao">[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  // O quadro traz, na ordem do modelo: o rótulo, o CIENTE/AUTORIZO, o destino,
  // as providências, o "Em," e a assinatura identificada.
  [ROTULO_AUTORIZACAO, CIENTE_AUTORIZO, DESPACHO_PREFEITA, PROVIDENCIAS, "Em, ", PAPEL_PREFEITA]
    .forEach((pedaco) => assert.ok(quadro.includes(pedaco), `falta "${pedaco}" no quadro`));
  assert.match(quadro, /<strong>Ana Maria da Silva<\/strong>PREFEITA/);
  assert.match(quadro, /<span class="cargo">Prefeita Municipal<\/span>/);
  assert.match(quadro, /<span class="cargo">CPF: 111\.222\.333-44<\/span>/);

  // Sem cadastro, o traço sai em branco para assinar à mão -- e sem "CPF:" solto.
  const semCadastro = htmlDoServico(dadosDoServico(servico(), {}), { escopo: "requisicao" });
  assert.match(semCadastro, /<strong>&nbsp;<\/strong>PREFEITA/);
  assert.doesNotMatch(semCadastro, /CPF:\s*<\/span>/);
});

/* -------------------------------------------------------------------------
 * TESTE 6 -- "À SECRETARIA DE ___" sai PREENCHIDO nas quatro folhas
 * ---------------------------------------------------------------------- */

test("6. o “À SECRETARIA DE ___” sai preenchido, e a lista vem do módulo financeiro", () => {
  const daDiaria = dadosDaDiaria(
    diaria({ encaminhar_secretaria_nome: "Secretaria Municipal de Saúde" }),
    {},
  );
  const doServico = dadosDoServico(
    servico({ encaminhar_secretaria_nome: "Secretaria Municipal de Saúde" }),
    {},
  );
  const html = htmlDaDiaria(daDiaria, { escopo: "completo" })
    + htmlDoServico(doServico, { escopo: "completo" });

  // TRÊS despachos -- um por folha que tem QUADRO DE AUTORIZAÇÃO da prefeita --,
  // todos com o MESMO rótulo e todos PREENCHIDOS.
  const despachos = html.match(/À SECRETARIA DE <span class="preenchido">[^<]*<\/span>/g) ?? [];
  assert.equal(despachos.length, 3, "liquidação da diária + as duas folhas do serviço");
  despachos.forEach((linha) =>
    assert.equal(linha, 'À SECRETARIA DE <span class="preenchido">Saúde</span>'),
  );
  assert.doesNotMatch(html, /À SECRETARIA DE <span class="preenchido">\s*<\/span>/);

  // ⚠️ POR QUE TRÊS E NÃO CINCO. O despacho só existe onde existe o quadro de
  // autorização, e duas folhas não têm quadro nenhum no modelo oficial:
  //   - a REQUISIÇÃO DE DIÁRIAS fecha com as TRÊS ASSINATURAS EMPILHADAS
  //     (servidor, responsável pela secretaria e prefeita) e nenhum despacho;
  //   - a PRESTAÇÃO DE CONTAS não passa pela prefeita.
  // Não há campo para preencher onde não há quadro -- e inventar um seria sair
  // do modelo.
  const [folhaUm, , folhaTres] = folhasDoHtml(htmlDaDiaria(daDiaria, { escopo: "completo" }));
  assert.ok(!folhaUm.includes("À SECRETARIA DE"));
  assert.match(folhaUm, /<div class="assinaturas">/);
  assert.match(folhaUm, /Assinatura da Prefeita/);
  assert.ok(!folhaTres.includes("À SECRETARIA DE"));
  // O valor escolhido, porém, é UM só e vale para o processo inteiro: as folhas
  // que têm quadro imprimem todas a MESMA secretaria.
  assert.equal(daDiaria.liquidacao.destino, "Saúde");
  assert.equal(doServico.requisicao.despacho, "Saúde");
  assert.equal(doServico.liquidacao.destino, "Saúde");

  // SEM escolha, o padrão do modelo oficial: Finanças. Nunca em branco.
  const semEscolha = dadosDoServico(servico(), {});
  assert.equal(ENCAMINHAMENTO_PADRAO, "Finanças");
  assert.equal(semEscolha.liquidacao.destino, "Finanças");
  assert.match(
    htmlDoServico(semEscolha, { escopo: "liquidacao" }),
    /À SECRETARIA DE <span class="preenchido">Finanças<\/span>/,
  );

  // ⚠️ A LISTA OFERECIDA É LIDA DO CADASTRO DE SECRETARIAS DO MÓDULO FINANCEIRO,
  // e só as ATIVAS. Este módulo apenas LÊ: não cria, não altera, não exclui.
  const oferecidas = secretariasParaEncaminhamento(SECRETARIAS_DO_FINANCEIRO);
  assert.deepEqual(oferecidas.map((s) => s.nome), [
    "Secretaria Municipal de Educação",
    "Secretaria Municipal de Finanças",
    "Secretaria Municipal de Saúde",
  ]);

  // ⚠️ NÃO É A SECRETARIA SOLICITANTE: uma REQUISITA (cadastro próprio de
  // Processos), a outra RECEBE para pagar (cadastro do financeiro).
  assert.equal(doServico.requisicao.despacho, "Saúde");
  assert.ok(html.includes("Secretaria Municipal de Turismo"), "a solicitante continua impressa");

  // A sugestão: a solicitante quando ela TEM financeiro; Finanças quando não tem.
  assert.deepEqual(
    sugerirEncaminhamento({
      secretariasFinanceiras: SECRETARIAS_DO_FINANCEIRO,
      nomeDaSolicitante: "Secretaria Municipal de Saúde",
    }),
    { encaminhar_secretaria_id: "fin-2", encaminhar_secretaria_nome: "Secretaria Municipal de Saúde" },
  );
  assert.deepEqual(
    sugerirEncaminhamento({
      secretariasFinanceiras: SECRETARIAS_DO_FINANCEIRO,
      nomeDaSolicitante: "Secretaria Municipal de Turismo",
    }),
    { encaminhar_secretaria_id: "fin-1", encaminhar_secretaria_nome: "Secretaria Municipal de Finanças" },
  );
  // Cadastro financeiro ainda não lido: sai Finanças escrito e nenhum id gravado
  // -- o campo NUNCA vai ao papel em branco, e nada é inventado no cadastro.
  assert.deepEqual(sugerirEncaminhamento(), {
    encaminhar_secretaria_id: null,
    encaminhar_secretaria_nome: "Finanças",
  });
});

/* -------------------------------------------------------------------------
 * TESTE 7 -- "Viagem realizada" e "Conferência interna" não existem mais
 * ---------------------------------------------------------------------- */

test("7. “Viagem realizada” e “Conferência interna” saíram da tela da liquidação", async () => {
  const diariaJsx = await read("src/components/processos/ModalProcessoDiaria.jsx");

  // Os dois BLOCOS não existem mais.
  assert.doesNotMatch(diariaJsx, /titulo="Viagem realizada"/);
  assert.doesNotMatch(diariaJsx, /titulo="Conferência interna"/);

  // E nenhum dos campos deles é digitado ou lido na tela.
  [
    "Saída realizada",
    "Retorno realizado",
    "Diárias realizadas",
    "Valor a liquidar",
    "Documentos comprobatórios apresentados",
    "Responsável pela conferência",
    "liquidacao_data_saida",
    "liquidacao_data_retorno",
    "liquidacao_quantidade",
    "liquidacao_valor",
    "liquidacao_documentos",
    "liquidacao_responsavel",
    "valorNaLiquidacao",
  ].forEach((sumido) => assert.ok(!diariaJsx.includes(sumido), `"${sumido}" continua na tela`));

  // ⚠️ AS COLUNAS CONTINUAM NO BANCO, INTOCADAS. Não há `drop column`: processo
  // já criado com esses dados gravados continua abrindo.
  const dados = await read("src/lib/processosDiariasDados.js");
  ["liquidacao_data_saida", "liquidacao_data_retorno", "liquidacao_quantidade", "liquidacao_valor"]
    .forEach((coluna) => assert.ok(dados.includes(coluna), `a coluna ${coluna} saiu do banco`));

  // E o papel nunca imprimiu esses blocos -- continua não imprimindo.
  const html = htmlDaDiaria(
    dadosDaDiaria(
      diaria({
        liquidacao_data_saida: "2026-03-12",
        liquidacao_documentos: "Bilhetes e notas",
        liquidacao_responsavel: "Alguém da secretaria",
      }),
      {},
    ),
    { escopo: "completo" },
  );
  ["Viagem realizada", "Conferência interna", "Bilhetes e notas", "Alguém da secretaria"]
    .forEach((pedaco) => assert.ok(!html.includes(pedaco), `"${pedaco}" foi impresso`));
});

/* -------------------------------------------------------------------------
 * TESTE 8 -- cada documento continua caindo em UMA folha
 * ---------------------------------------------------------------------- */

test("8. cada um dos cinco documentos continua saindo em UMA folha", () => {
  const daDiaria = dadosDaDiaria(diaria(), { prefeita: PREFEITA });
  const doServico = dadosDoServico(servico(), { prefeita: PREFEITA });

  assert.equal(pdfDaDiaria(daDiaria, { escopo: "requisicao" }).getNumberOfPages(), 1);
  assert.equal(pdfDaDiaria(daDiaria, { escopo: "liquidacao" }).getNumberOfPages(), 1);
  assert.equal(pdfDaDiaria(daDiaria, { escopo: "prestacao" }).getNumberOfPages(), 1);
  assert.equal(pdfDaDiaria(daDiaria, { escopo: "completo" }).getNumberOfPages(), 3);
  assert.equal(pdfDoServico(doServico, { escopo: "requisicao" }).getNumberOfPages(), 1);
  assert.equal(pdfDoServico(doServico, { escopo: "liquidacao" }).getNumberOfPages(), 1);
  assert.equal(pdfDoServico(doServico, { escopo: "completo" }).getNumberOfPages(), 2);

  // O cargo e o CPF abaixo de CADA uma das três assinaturas empilhadas da
  // Requisição de Diárias não empurram a folha: o vão da caneta encolhe.
  assert.equal(
    pdfDaDiaria(
      dadosDaDiaria(
        diaria({
          beneficiario_cargo: "Auxiliar Administrativo de Nível Superior da Secretaria",
          assinante_secretaria_cargo: "Secretário Municipal de Educação, Cultura e Esportes",
        }),
        { prefeita: PREFEITA },
      ),
      { escopo: "requisicao" },
    ).getNumberOfPages(),
    1,
  );

  // E a economia de folha não depende de sorte: com 1, 5 e 10 itens as duas
  // folhas do serviço continuam saindo com uma folha cada.
  [1, 5, 10].forEach((quantos) => {
    const itens = Array.from({ length: quantos }, (_, i) => ({
      quantidade: String(i + 1),
      discriminacao: `Item de material número ${i + 1} do quadro descritivo`,
    }));
    const comItens = dadosDoServico(servico({ itens }), { prefeita: PREFEITA });
    assert.equal(pdfDoServico(comItens, { escopo: "requisicao" }).getNumberOfPages(), 1);
    assert.equal(pdfDoServico(comItens, { escopo: "liquidacao" }).getNumberOfPages(), 1);
  });

  // Em HTML, a folha quebra por folha -- e são três e duas.
  assert.equal(folhasDoHtml(htmlDaDiaria(daDiaria, { escopo: "completo" })).length, 3);
  assert.equal(folhasDoHtml(htmlDoServico(doServico, { escopo: "completo" })).length, 2);
});

/* -------------------------------------------------------------------------
 * O CONGELAMENTO -- documento finalizado não muda mais
 * ---------------------------------------------------------------------- */

test("8b. documento finalizado guarda nome, cargo, CPF, secretaria, logo e rodapé da época", async () => {
  const dados = await read("src/lib/processosDiariasDados.js");
  // Tudo o que o papel imprime fica GRAVADO NA LINHA DO PROCESSO -- e por isso
  // mudança de cadastro depois não reescreve documento nenhum.
  [
    "beneficiario_nome", "beneficiario_cargo", "beneficiario_cpf",
    "assinante_secretaria_nome", "assinante_secretaria_cargo", "assinante_secretaria_cpf",
    "solicitante_nome", "solicitante_secretario", "solicitante_secretario_cpf",
    "solicitante_secretario_cargo", "encaminhar_secretaria_nome",
    "identidade_visual", "prefeita",
  ].forEach((coluna) => assert.ok(dados.includes(coluna), `falta congelar ${coluna}`));

  // A prova em cima do documento: o processo guarda a prefeita de ontem, e o
  // cadastro de hoje NÃO reescreve a folha já finalizada.
  const congelado = diaria({
    situacao: "finalizada",
    prefeita: { nome: "Prefeita de Ontem", cpf: "000.111.222-33", cargo: "Prefeita Municipal" },
  });
  const impresso = htmlDaDiaria(
    dadosDaDiaria(congelado, { prefeita: PREFEITA }),
    { escopo: "liquidacao" },
  );
  assert.ok(impresso.includes("Prefeita de Ontem"));
  assert.ok(impresso.includes("000.111.222-33"));
  assert.ok(!impresso.includes("Ana Maria da Silva"));
});

/* -------------------------------------------------------------------------
 * TESTE 9 -- a migration do Storage roda de ponta a ponta
 * ---------------------------------------------------------------------- */

const MIGRATION_STORAGE =
  "supabase/migrations/20260912160000_storage_logomarca_politicas_corrigidas.sql";

/** O código da migration, sem os comentários que explicam o defeito antigo. */
const semComentarios = (sql) =>
  sql
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");

test("9. a migration do Storage cria a função ANTES das políticas, e não aborta no meio", async () => {
  const arquivo = await read(MIGRATION_STORAGE);
  const sql = semComentarios(arquivo);

  // ⚠️ O DEFEITO CONSERTADO: ela NÃO chama mais a função que não existe neste
  // banco, e que derrubava o script com 42883. (O cabeçalho cita o nome antigo
  // para registrar o motivo; o que roda, não.)
  assert.ok(!sql.includes("pode_editar_configuracoes"));
  assert.ok(arquivo.includes("42883"), "o cabeçalho registra o erro consertado");

  // Ela usa a função do PADRÃO DO PROJETO -- uma por módulo, recebendo a ação --
  // e a permissão é a mesma que a tela e a função do servidor conferem.
  assert.match(sql, /public\.pode_em_administracao\('editar'\)/);

  // E GARANTE essa função ANTES de criar política alguma.
  const criacao = sql.indexOf("create or replace function public.pode_em_administracao(acao text)");
  const primeiraPolitica = sql.indexOf("create policy");
  assert.ok(criacao > 0, "a função precisa ser criada nesta migration");
  assert.ok(criacao < primeiraPolitica, "a função tem de vir ANTES das políticas");
  assert.match(sql, /grant execute on function public\.pode_em_administracao\(text\) to authenticated/);

  // AS QUATRO POLÍTICAS DO BUCKET, e cada uma no bloco dela.
  const politicas = [
    "configuracoes_leitura_publica",
    "configuracoes_insert_administracao",
    "configuracoes_update_administracao",
    "configuracoes_delete_administracao",
  ];
  politicas.forEach((nome) => {
    assert.ok(sql.includes(`drop policy if exists "${nome}"`), `falta o drop de ${nome}`);
    assert.ok(sql.includes(`create policy "${nome}"`), `falta o create de ${nome}`);
  });
  assert.equal((sql.match(/create policy/g) ?? []).length, 4);
  assert.equal((sql.match(/drop policy if exists/g) ?? []).length, 4);
  // As TRÊS que checam permissão usam a função; a de leitura é pública e não
  // chama função nenhuma -- por isso a impressão carrega a imagem por URL.
  // Quatro chamadas para três políticas: a de update confere a linha ANTIGA
  // (using) e a NOVA (with check).
  assert.equal((sql.match(/public\.pode_em_administracao\('editar'\)/g) ?? []).length, 4);
  const update = sql.slice(sql.indexOf('create policy "configuracoes_update_administracao"'));
  assert.match(update.slice(0, 400), /using \(bucket_id = 'configuracoes' and public\.pode_em_administracao\('editar'\)\)/);
  const leitura = sql.slice(sql.indexOf('create policy "configuracoes_leitura_publica"'));
  assert.ok(!leitura.slice(0, 300).includes("pode_em_administracao"));

  // ⚠️ NENHUM BLOCO TRATA SÓ `insufficient_privilege`: era isso que deixava o
  // 42883 escapar e abortar o script inteiro. Todos tratam `when others`.
  const blocos = sql.split("do $$").slice(1);
  assert.equal(blocos.length, 6, "bucket, função e as quatro políticas");
  blocos.forEach((bloco, i) => {
    assert.ok(bloco.includes("when others then"), `o bloco ${i + 1} deixa erro escapar`);
  });

  // IDEMPOTENTE: rodar de novo tem o mesmo efeito.
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /create or replace function/);
  // E termina mostrando o que ficou valendo, para conferência no SQL Editor.
  assert.match(sql, /from pg_policies/);
  assert.match(sql, /from storage\.buckets where id = 'configuracoes'/);
});

test("9b. o arquivo que abortava está marcado como substituído, e ninguém o roda", async () => {
  const antigo = await read("supabase/migrations/20260912130000_storage_logomarca.sql");
  assert.match(antigo, /NÃO RODE ESTE ARQUIVO/);
  assert.ok(antigo.includes("20260912160000_storage_logomarca_politicas_corrigidas.sql"));
  // A migration aplicada de operações de pagamento não foi tocada por nada disto.
  assert.doesNotMatch(antigo, /pagamentos|saldos|baixas/i);
});

/* -------------------------------------------------------------------------
 * TESTES 10 e 11 -- o envio da logomarca, e a que já está lá
 * ---------------------------------------------------------------------- */

test("10. as DUAS telas enviam a logomarca pelo mesmo caminho, com a mesma permissão", async () => {
  const [envio, aparencia, processos, doSistema, daIdentidade, servidor] = await Promise.all([
    read("src/lib/logomarcaEnvio.js"),
    read("src/components/configuracoes/CategoriaAparencia.jsx"),
    read("src/components/configuracoes/CategoriaProcessos.jsx"),
    read("src/lib/configuracoesSistema.js"),
    read("src/lib/processosIdentidadeDados.js"),
    read("netlify/functions/enviar-logomarca.mts"),
  ]);

  // ⚠️ AS DUAS TELAS DESEMBOCAM NA MESMA ORIGEM. Aparência chama
  // enviarLogomarca, Processos chama enviarBrasaoProcessos, e as duas funções
  // são embrulhos finos de enviarImagemDeIdentidade -- uma pasta cada, um
  // caminho de envio só.
  assert.match(aparencia, /enviarLogomarca/);
  assert.match(doSistema, /import \{ enviarImagemDeIdentidade \} from "\.\/logomarcaEnvio"/);
  assert.match(doSistema, /export async function enviarLogomarca[\s\S]{0,220}enviarImagemDeIdentidade/);
  assert.match(doSistema, /pasta: "logomarca"/);

  assert.match(processos, /enviarBrasaoProcessos/);
  assert.match(daIdentidade, /import \{ enviarImagemDeIdentidade \} from "\.\/logomarcaEnvio\.js"/);
  assert.match(daIdentidade, /export async function enviarBrasaoProcessos[\s\S]{0,220}enviarImagemDeIdentidade/);
  assert.match(daIdentidade, /export const PASTA_BRASAO = "processos-brasao"/);
  assert.match(daIdentidade, /pasta: PASTA_BRASAO/);

  // E a origem única grava NO BUCKET que a migration configura -- o nome do
  // bucket também é de um lugar só.
  assert.match(envio, /export async function enviarImagemDeIdentidade/);
  assert.match(envio, /supabase\.storage\.from\(BUCKET_CONFIGURACOES\)\.upload\(/);
  const regras = await read("src/lib/logomarcaImagem.js");
  assert.match(regras, /BUCKET_CONFIGURACOES = "configuracoes"/);

  // A MESMA PERMISSÃO dos dois lados: edição no módulo 'administracao'. É o que
  // a função do servidor confere, e é o que a política do bucket passa a exigir.
  assert.match(servidor, /const MODULO = "administracao"/);
  assert.match(servidor, /permissoes_efetivas/);
  const sql = await read(MIGRATION_STORAGE);
  assert.match(sql, /pe\.modulo = 'administracao'/);
  assert.match(sql, /when 'editar'\s+then pe\.pode_editar/);

  // E se a política barrar o envio direto, o envio cai na função do servidor:
  // as duas telas continuam funcionando até no banco onde nada foi rodado.
  assert.match(envio, /ROTA_ENVIO_SERVIDOR/);
  assert.match(envio, /\/api\/configuracoes\/logomarca/);
});

test("11. a logomarca já cadastrada NÃO é perdida no conserto", async () => {
  const arquivo = await read(MIGRATION_STORAGE);
  const sql = semComentarios(arquivo);

  // ⚠️ Nenhuma remoção de arquivo, de bucket ou da linha que guarda a URL.
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /drop\s+(table|bucket|schema)/i);
  assert.doesNotMatch(sql, /truncate/i);
  assert.doesNotMatch(sql, /update\s+public\.configuracoes_sistema/i);
  // O que ela altera no bucket é só o que libera o envio: público, teto e tipos.
  const updates = sql.match(/update storage\.buckets[\s\S]{0,120}/g) ?? [];
  assert.ok(updates.length >= 1);
  updates.forEach((trecho) => assert.match(trecho, /public = true|file_size_limit|allowed_mime_types/));
  // E a conferência final lista os arquivos que continuam lá -- a prova, no
  // próprio SQL Editor, de que a logomarca em uso sobreviveu ao conserto.
  assert.match(sql, /from storage\.objects[\s\S]*?bucket_id = 'configuracoes'/);
  assert.match(arquivo, /A LOGOMARCA EM USO NÃO É PERDIDA/);
});

/* -------------------------------------------------------------------------
 * TESTE 12 -- processo já criado continua abrindo e imprimindo
 * ---------------------------------------------------------------------- */

test("12. processo já criado abre normalmente e imprime, sem os campos removidos", () => {
  // Um processo ANTIGO: sem data por folha, sem encaminhamento, sem prefeita
  // congelada, e COM os campos que saíram da tela gravados no banco.
  const antigaDiaria = {
    id: 8,
    numero: 2,
    ano: 2026,
    situacao: "finalizada",
    data_processo: "2026-01-05",
    beneficiario_nome: "João da Silva",
    valor_total: 400,
    liquidacao_data_saida: "2026-02-01",
    liquidacao_data_retorno: "2026-02-03",
    liquidacao_quantidade: "2",
    liquidacao_valor: 400,
    liquidacao_documentos: "Notas e bilhetes",
    liquidacao_responsavel: "Conferido pela secretaria",
  };

  // Abre sem inventar data nenhuma.
  const formulario = formularioDaDiaria(antigaDiaria);
  assert.equal(formulario.requisicao_data, "");
  assert.equal(formulario.liquidacao_data, "");
  assert.equal(formulario.prestacao_data, "");
  // E os dados antigos continuam sendo lidos do banco, sem perder nada.
  assert.equal(formulario.liquidacao_documentos, "Notas e bilhetes");

  // E imprime as três folhas, com a data de abertura onde não há data própria.
  const dados = dadosDaDiaria(antigaDiaria, {});
  assert.equal(dados.requisicao.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(dados.liquidacao.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(
    dados.prestacao.localEData,
    "São José da Laje/AL, ______ de ____________________ de 2026",
  );
  assert.equal(dados.liquidacao.destino, "Finanças");
  assert.equal(pdfDaDiaria(dados, { escopo: "completo" }).getNumberOfPages(), 3);

  // O serviço antigo, igual.
  const antigoServico = {
    id: 5,
    numero: 3,
    ano: 2026,
    situacao: "finalizada",
    data_processo: "2026-01-05",
    solicitante_nome: "Secretaria Municipal de Educação",
    tipo: "servicos",
    itens: [{ quantidade: "2", discriminacao: "Cadeiras escolares" }],
    valor_total: 1200,
  };
  assert.equal(formularioDoServico(antigoServico).requisicao_data, "");
  const doServico = dadosDoServico(antigoServico, {});
  assert.equal(doServico.requisicao.despacho, "Educação");
  assert.equal(pdfDoServico(doServico, { escopo: "completo" }).getNumberOfPages(), 2);
});

/* -------------------------------------------------------------------------
 * TESTE 13 -- nada disto é financeiro
 * ---------------------------------------------------------------------- */

const ARQUIVOS_DESTA_ENTREGA = [
  "src/lib/processosDocumentoComum.js",
  "src/lib/processosDiariasDocumento.js",
  "src/lib/processosServicosDocumento.js",
  "src/lib/processosEncaminhamento.js",
  "src/components/processos/ModalProcessoDiaria.jsx",
  "src/components/processos/ModalProcessoServico.jsx",
];

test("13. nenhum arquivo desta entrega altera saldo, baixa, NF, programação ou pagamento", async () => {
  const PROIBIDOS = [
    "pagamentos",
    "pagamentos_baixas",
    "valores_em_aberto",
    "saldos_historico",
    "contas_bancarias",
    "transferencias_contas",
    "programacoes_pagamento",
    "notas_fiscais",
  ];
  const fontes = await Promise.all(ARQUIVOS_DESTA_ENTREGA.map(read));
  fontes.forEach((fonte, i) => {
    const semComentarios = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    PROIBIDOS.forEach((tabela) => {
      assert.ok(
        !new RegExp(`from\\(["'\`]${tabela}["'\`]\\)`).test(semComentarios),
        `${ARQUIVOS_DESTA_ENTREGA[i]} toca em ${tabela}`,
      );
    });
    ["debitar", "dar baixa", "baixar", "creditar"].forEach((verbo) => {
      assert.ok(!new RegExp(`${verbo}\\s*\\(`, "i").test(semComentarios));
    });
  });

  // E a migration do Storage mexe em bucket e política -- em nada financeiro.
  const sql = await read(MIGRATION_STORAGE);
  const semComentariosSql = semComentarios(sql);
  PROIBIDOS.forEach((tabela) =>
    assert.ok(!semComentariosSql.includes(`public.${tabela}`), `a migration toca em ${tabela}`),
  );
  assert.match(semComentariosSql, /storage\.buckets/);
  assert.match(semComentariosSql, /storage\.objects/);
});
