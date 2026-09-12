import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CAMPOS_ENCAMINHAMENTO,
  ENCAMINHAMENTO_PADRAO,
  complementoDoEncaminhamento,
  complementoDoEncaminhamentoDaLiquidacao,
  dadosDoEncaminhamentoParaDocumento,
  destinoDaLiquidacao,
  encaminhamentoPeloNome,
  nucleoDaSecretaria,
  secretariaMunicipalDoEncaminhamento,
  secretariasParaEncaminhamento,
  sugerirEncaminhamento,
  sugerirEncaminhamentoDaLiquidacao,
} from "../src/lib/processosEncaminhamento.js";
import {
  CAMPOS_REQUISICAO as CAMPOS_REQUISICAO_SERVICO,
  dataDaLiquidacao as dataDaLiquidacaoServico,
  dataDaRequisicao as dataDaRequisicaoServico,
  duplicarProcesso as duplicarServico,
  formularioParaBanco as formularioParaBancoServico,
  processoParaFormulario as processoParaFormularioServico,
  processoVazio as processoVazioServico,
} from "../src/lib/processosServicos.js";
import {
  dataDaLiquidacao as dataDaLiquidacaoDiaria,
  dataDaPrestacao,
  dataDaRequisicao as dataDaRequisicaoDiaria,
  formularioParaBanco as formularioParaBancoDiaria,
  processoParaFormulario as processoParaFormularioDiaria,
  processoVazio as processoVazioDiaria,
} from "../src/lib/processosDiarias.js";
import {
  dadosDoDocumento as dadosDoServico,
  htmlDoProcesso as htmlDoServico,
  montarPdfDoProcesso as pdfDoServico,
} from "../src/lib/processosServicosDocumento.js";
import {
  dadosDoDocumento as dadosDaDiaria,
  htmlDoProcesso as htmlDaDiaria,
  montarPdfDoProcesso as pdfDaDiaria,
} from "../src/lib/processosDiariasDocumento.js";
import { BANCOS_INICIAIS, bancoAtendeBusca } from "../src/lib/processosBancos.js";

/**
 * PROCESSOS — as quatro correções deste envio e a lista de conferência pedida
 * com elas:
 *
 *   1. CADA DOCUMENTO DO PROCESSO TEM A DATA DELE, e todas editáveis: a data da
 *      requisição na folha 1, a da liquidação na 2 e a da prestação de contas na
 *      3 das diárias. A data de hoje é só a sugestão inicial;
 *   2. na REQUISIÇÃO de material/serviço, a autorização da prefeita sai AO LADO
 *      da assinatura do requisitante, na mesma faixa -- e o documento cabe em uma
 *      folha. ⚠️ Nas DIÁRIAS as três assinaturas continuam EMPILHADAS;
 *   3. o "À SECRETARIA MUNICIPAL DE ______" sai IMPRESSO PREENCHIDO, com a
 *      secretaria escolhida num campo novo do processo. As oferecidas são LIDAS
 *      do cadastro de secretarias do módulo FINANCEIRO;
 *   4. o campo de busca do BANCO ocupa UMA LINHA: a lista ABRE INTEIRA ao clicar,
 *      tocar ou focar o campo (digitar só filtra), flutua sobre o conteúdo, fecha
 *      ao clicar fora e não empurra Agência, Conta, PIX e Titular.
 *
 * ⚠️ A SECRETARIA DO ENCAMINHAMENTO NÃO É A SOLICITANTE. Quem REQUISITA vem do
 * cadastro próprio do módulo e pode ser qualquer secretaria; quem RECEBE o
 * processo para as providências é uma das que TÊM FINANCEIRO. E o cadastro do
 * financeiro é APENAS LIDO: nada aqui cria, altera ou exclui nele.
 *
 * ⚠️ ISTO É PAPEL. Nenhum destes testes -- e nada do que eles exercitam --
 * debita conta, dá baixa em NF, altera saldo, cria pagamento ou mexe na
 * Programação Diária.
 */

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/** O que o arquivo FAZ, sem os comentários que explicam o que ele não faz. */
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const semComentariosSql = (fonte) =>
  fonte
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");

const MIGRATION =
  "supabase/migrations/20260912120000_processos_datas_por_documento_e_encaminhamento.sql";

/** Os arquivos do módulo Processos tocados por este envio. */
const ARQUIVOS_DO_ENVIO = [
  "src/lib/processosEncaminhamento.js",
  "src/lib/processosServicos.js",
  "src/lib/processosServicosDados.js",
  "src/lib/processosServicosDocumento.js",
  "src/lib/processosDiarias.js",
  "src/lib/processosDiariasDados.js",
  "src/lib/processosDiariasDocumento.js",
  // O COMPONENTE COMPARTILHADO dos cinco documentos: cabeçalho, rodapé,
  // assinaturas e regras de data moram aqui, e não copiados documento a documento.
  "src/lib/processosDocumentoComum.js",
  "src/components/processos/ModalProcessoServico.jsx",
  "src/components/processos/ModalProcessoDiaria.jsx",
  "src/components/processos/PaginaServicos.jsx",
  "src/components/processos/PaginaDiarias.jsx",
  "src/components/processos/SeletorBanco.jsx",
  "src/pages/ModuloProcessos.jsx",
];

/** O cadastro de secretarias do MÓDULO FINANCEIRO, como ele chega por leitura. */
const SECRETARIAS_DO_FINANCEIRO = [
  { id: "fin-1", nome: "Secretaria Municipal de Finanças", ativo: true },
  { id: "fin-2", nome: "Secretaria Municipal de Saúde", ativo: true },
  { id: "fin-3", nome: "Secretaria Municipal de Assistência Social", ativo: true },
  { id: "fin-4", nome: "Secretaria Municipal de Educação", ativo: true },
  { id: "fin-5", nome: "Secretaria Municipal de Cultura", ativo: false },
];

function servicoDeExemplo(extra = {}) {
  return {
    ...processoVazioServico({ ano: 2026, hoje: "2026-03-10" }),
    id: 41,
    numero: 7,
    ano: 2026,
    situacao: "rascunho",
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
    ...extra,
  };
}

function diariaDeExemplo(extra = {}) {
  return {
    ...processoVazioDiaria({ ano: 2026, hoje: "2026-03-10" }),
    id: 9,
    numero: 1,
    ano: 2026,
    situacao: "rascunho",
    beneficiario_nome: "Maria Souza da Silva",
    beneficiario_cpf: "123.456.789-00",
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

const acharTexto = (posicoes, pedaco) =>
  posicoes.find((p) => p.texto.includes(pedaco)) ?? null;

/* -------------------------------------------------------------------------
 * 1. Serviços/Materiais: cada folha com a data DELA
 * ---------------------------------------------------------------------- */

test("1. serviços com datas diferentes: cada folha impressa sai com a data dela", () => {
  const processo = servicoDeExemplo({
    data_processo: "2026-01-05",
    requisicao_data: "2026-02-03",
    liquidacao_data: "2026-04-20",
  });

  // A data de cada documento é a DELE, e a de abertura não manda em nenhuma.
  assert.equal(dataDaRequisicaoServico(processo), "2026-02-03");
  assert.equal(dataDaLiquidacaoServico(processo), "2026-04-20");

  const dados = dadosDoServico(processo, {});
  assert.equal(dados.requisicao.localEData, "São José da Laje/AL, 3 de fevereiro de 2026");
  assert.equal(dados.requisicao.emData, "Em, 03/02/2026");
  assert.equal(dados.liquidacao.localEData, "São José da Laje/AL, 20 de abril de 2026");
  assert.equal(dados.liquidacao.emData, "Em, 20/04/2026");

  // No papel: a folha 1 traz a data da requisição e NÃO a da liquidação; a
  // folha 2, o contrário. Nenhuma das duas traz 5 de janeiro (a abertura).
  const [folha1, folha2] = folhasDoHtml(htmlDoServico(dados, { escopo: "completo" }));
  assert.match(folha1, /3 de fevereiro de 2026/);
  assert.match(folha1, /03\/02\/2026/);
  assert.doesNotMatch(folha1, /20 de abril de 2026/);
  assert.match(folha2, /20 de abril de 2026/);
  assert.doesNotMatch(folha2, /3 de fevereiro de 2026/);
  assert.doesNotMatch(folha1 + folha2, /5 de janeiro de 2026/);

  const folhas = textoDasFolhas(pdfDoServico(dados, { escopo: "completo" }));
  assert.equal(folhas.length, 2);
  assert.ok(folhas[0].includes("3 de fevereiro de 2026"));
  assert.ok(!folhas[0].includes("20 de abril de 2026"));
  assert.ok(folhas[1].includes("20 de abril de 2026"));
  assert.ok(!folhas[1].includes("3 de fevereiro de 2026"));

  // As duas datas são campos do formulário e vão gravadas como escolhidas.
  assert.ok(CAMPOS_REQUISICAO_SERVICO.includes("requisicao_data"));
  const linha = formularioParaBancoServico(processoParaFormularioServico(processo));
  assert.equal(linha.requisicao_data, "2026-02-03");
  assert.equal(linha.liquidacao_data, "2026-04-20");
});

/* -------------------------------------------------------------------------
 * 2. Diárias: as TRÊS folhas, cada uma com a data dela
 * ---------------------------------------------------------------------- */

test("2. diárias: requisição, liquidação e prestação de contas saem com datas próprias", () => {
  const processo = diariaDeExemplo({
    data_processo: "2026-01-05",
    requisicao_data: "2026-02-03",
    liquidacao_data: "2026-04-20",
    prestacao_data: "2026-05-30",
  });

  assert.equal(dataDaRequisicaoDiaria(processo), "2026-02-03");
  assert.equal(dataDaLiquidacaoDiaria(processo), "2026-04-20");
  assert.equal(dataDaPrestacao(processo), "2026-05-30");

  const dados = dadosDaDiaria(processo, {});
  assert.equal(dados.localEData, "São José da Laje/AL, 3 de fevereiro de 2026");
  assert.equal(dados.liquidacao.localEData, "São José da Laje/AL, 20 de abril de 2026");
  assert.equal(dados.prestacao.localEData, "São José da Laje/AL, 30 de maio de 2026");

  const folhas = textoDasFolhas(pdfDaDiaria(dados, { escopo: "completo" }));
  assert.equal(folhas.length, 3);
  assert.ok(folhas[0].includes("3 de fevereiro de 2026"));
  assert.ok(folhas[1].includes("20 de abril de 2026"));
  assert.ok(folhas[2].includes("30 de maio de 2026"));
  // Nenhuma folha carrega a data da outra.
  assert.ok(!folhas[0].includes("20 de abril de 2026"));
  assert.ok(!folhas[1].includes("30 de maio de 2026"));
  assert.ok(!folhas[2].includes("3 de fevereiro de 2026"));

  const linha = formularioParaBancoDiaria(processoParaFormularioDiaria(processo));
  assert.equal(linha.requisicao_data, "2026-02-03");
  assert.equal(linha.liquidacao_data, "2026-04-20");
  assert.equal(linha.prestacao_data, "2026-05-30");
});

/* -------------------------------------------------------------------------
 * 3. A data de hoje é só a sugestão inicial -- data ANTERIOR é aceita
 * ---------------------------------------------------------------------- */

test("3. escolher uma data anterior funciona, nas duas áreas e em todas as folhas", () => {
  // O processo NOVO nasce sugerindo hoje na folha 1...
  assert.equal(processoVazioServico({ ano: 2026, hoje: "2026-09-11" }).requisicao_data, "2026-09-11");
  assert.equal(processoVazioDiaria({ ano: 2026, hoje: "2026-09-11" }).requisicao_data, "2026-09-11");

  // ...e a sugestão é trocável por uma data ANTERIOR, que é a que fica gravada.
  const servico = formularioParaBancoServico({
    ...processoVazioServico({ ano: 2026, hoje: "2026-09-11" }),
    data_processo: "2026-09-11",
    requisicao_data: "2026-03-02",
    liquidacao_data: "2026-03-09",
  });
  assert.equal(servico.requisicao_data, "2026-03-02");
  assert.equal(servico.liquidacao_data, "2026-03-09");

  const diaria = formularioParaBancoDiaria({
    ...processoVazioDiaria({ ano: 2026, hoje: "2026-09-11" }),
    data_processo: "2026-09-11",
    requisicao_data: "2026-01-08",
    liquidacao_data: "2026-01-20",
    prestacao_data: "2026-02-02",
  });
  assert.equal(diaria.requisicao_data, "2026-01-08");
  assert.equal(diaria.prestacao_data, "2026-02-02");

  // E o papel imprime a data anterior escolhida, não a de hoje.
  const dados = dadosDoServico(servicoDeExemplo({ requisicao_data: "2026-03-02" }), {});
  assert.match(dados.requisicao.localEData, /2 de março de 2026/);

  // A cópia de um processo é um processo NOVO: as datas voltam ao ponto de
  // partida em vez de herdar as do mês passado.
  const copia = duplicarServico(
    servicoDeExemplo({ requisicao_data: "2026-03-02", liquidacao_data: "2026-03-09" }),
    { ano: 2026, hoje: "2026-09-11" },
  );
  assert.equal(copia.requisicao_data, "2026-09-11");
  assert.equal(copia.liquidacao_data, "");

  // Os campos da tela são de data e editáveis -- nenhum `disabled` fixo.
  return Promise.all([
    read("src/components/processos/ModalProcessoServico.jsx"),
    read("src/components/processos/ModalProcessoDiaria.jsx"),
  ]).then(([servicoJsx, diariaJsx]) => {
    assert.match(servicoJsx, /rotulo="Data da Requisição de Material\/Serviço"\s*\n\s*tipo="date"/);
    assert.match(servicoJsx, /definir\("requisicao_data", v\)/);
    assert.match(servicoJsx, /rotulo="Data da Liquidação\/Solicitação de Pagamento"\s*\n\s*tipo="date"/);
    assert.match(diariaJsx, /rotulo="Data da Requisição de Diárias"\s*\n\s*tipo="date"/);
    assert.match(diariaJsx, /rotulo="Data da Liquidação"\s*\n\s*tipo="date"/);
    assert.match(diariaJsx, /rotulo="Data da Prestação de Contas"\s*\n\s*tipo="date"/);
  });
});

/* -------------------------------------------------------------------------
 * 4. A requisição: prefeita AO LADO do requisitante, em UMA folha
 * ---------------------------------------------------------------------- */

test("4. na requisição impressa, a autorização da prefeita sai ao lado da assinatura do requisitante", () => {
  const dados = dadosDoServico(
    servicoDeExemplo({
      requisicao_data: "2026-02-03",
      encaminhar_secretaria_nome: "Secretaria Municipal de Assistência Social",
      requisitante_nome: "Carla Dias do Nascimento",
      requisitante_cargo: "Chefe de Setor",
      requisitante_cpf: "555.666.777-88",
    }),
    {},
  );

  // No HTML: UMA faixa horizontal com os dois lados dentro dela.
  const html = htmlDoServico(dados, { escopo: "requisicao" });
  const faixa = html.slice(html.indexOf('<div class="faixa-assinaturas">'));
  // ⚠️ Abaixo do traço sai a IDENTIFICAÇÃO -- nome, cargo e CPF --, e NÃO mais
  // a legenda "(assinatura, nome e identificação funcional do requisitante)",
  // que era redundante com o que o sistema já imprime.
  assert.match(faixa, /<div class="lado">[\s\S]*?<strong>Carla Dias do Nascimento<\/strong>/);
  assert.match(faixa, /<div class="lado">[\s\S]*?<span class="cargo">Chefe de Setor<\/span>/);
  assert.match(faixa, /<div class="lado">[\s\S]*?<span class="cargo">CPF: 555\.666\.777-88<\/span>/);
  assert.doesNotMatch(html, /identificação funcional do requisitante/);
  assert.match(faixa, /<div class="autorizacao">[\s\S]*?CIENTE\/AUTORIZO/);
  // A faixa é uma linha só (flex), e não quebra no meio.
  assert.match(html, /\.faixa-assinaturas \{ display: flex/);
  assert.match(html, /\.faixa-assinaturas \{[^}]*page-break-inside: avoid/);
  // O lado do requisitante vem ANTES do quadro da prefeita: esquerda e direita.
  assert.ok(faixa.indexOf('class="lado"') < faixa.indexOf('class="autorizacao"'));

  // No PDF: as duas ficam na MESMA folha, em alturas que se sobrepõem (é a
  // mesma faixa) e em x diferentes (uma à esquerda, outra à direita).
  const pdf = pdfDoServico(dados, { escopo: "requisicao" });
  assert.equal(pdf.getNumberOfPages(), 1, "a requisição deve caber em UMA folha");
  const posicoes = posicoesDaFolha(pdf, 1);
  const requisitante = acharTexto(posicoes, "Carla Dias do Nascimento");
  const ciente = acharTexto(posicoes, "CIENTE/AUTORIZO");
  // ⚠️ O rótulo EXATO: "AUTORIZAÇÃO DA PREFEITA" é o título do quadro, e não a
  // linha de assinatura dela.
  const prefeita = posicoes.find((p) => p.texto === "PREFEITA") ?? null;
  assert.ok(requisitante && ciente && prefeita);
  assert.ok(requisitante.x < ciente.x, "o requisitante sai à ESQUERDA");
  // A assinatura da prefeita e a do requisitante terminam quase na mesma
  // altura: é uma faixa, e não um bloco embaixo do outro.
  assert.ok(Math.abs(requisitante.y - prefeita.y) < 30, "as duas assinaturas na mesma faixa");
  assert.ok(ciente.y > requisitante.y, "o quadro da prefeita ocupa a altura da faixa");

  // E a economia de folha não depende de sorte: com 1, 5 e 10 itens a
  // requisição continua saindo em UMA folha.
  [1, 5, 10].forEach((quantos) => {
    const itens = Array.from({ length: quantos }, (_, i) => ({
      quantidade: String(i + 1),
      discriminacao: `Item de material número ${i + 1} do quadro descritivo`,
    }));
    const comItens = dadosDoServico(servicoDeExemplo({ itens }), {});
    assert.equal(
      pdfDoServico(comItens, { escopo: "requisicao" }).getNumberOfPages(),
      1,
      `a requisição com ${quantos} itens deveria caber em uma folha`,
    );
  });
});

/* -------------------------------------------------------------------------
 * 5. Nas DIÁRIAS, as três assinaturas continuam UMA ABAIXO DA OUTRA
 * ---------------------------------------------------------------------- */

test("5. nas diárias as três assinaturas continuam empilhadas, como definido", async () => {
  const dados = dadosDaDiaria(diariaDeExemplo(), {});
  const html = htmlDaDiaria(dados, { escopo: "completo" });

  // A FAIXA LADO A LADO passou a valer em TODAS as folhas que têm autorização da
  // prefeita, e a folha 2 das diárias é uma delas. A EXCEÇÃO -- já definida -- é
  // esta folha 1: as três assinaturas da REQUISIÇÃO DE DIÁRIAS seguem
  // empilhadas, como no modelo oficial.
  const [folha1, folha2] = folhasDoHtml(html);
  assert.doesNotMatch(folha1, /faixa-assinaturas/);
  assert.match(folha2, /<div class="faixa-assinaturas">/);

  // As três saem no MESMO bloco, uma embaixo da outra.
  const bloco = folha1.slice(folha1.indexOf('<div class="assinaturas">'));
  const ordem = ["Assinatura do Servidor", "Responsável pela Secretaria", "Assinatura da Prefeita"];
  ordem.forEach((rotulo, i) => {
    assert.ok(bloco.includes(rotulo));
    if (i > 0) assert.ok(bloco.indexOf(ordem[i - 1]) < bloco.indexOf(rotulo));
  });
  assert.doesNotMatch(html, /\.assinaturas \{[^}]*display: flex/);

  // No PDF, a prova é a altura: mesma coluna, alturas decrescentes.
  const posicoes = posicoesDaFolha(pdfDaDiaria(dados, { escopo: "requisicao" }), 1);
  const alturas = ordem.map((rotulo) => acharTexto(posicoes, rotulo));
  alturas.forEach((achado) => assert.ok(achado, "as três assinaturas saem impressas"));
  assert.ok(alturas[0].y > alturas[1].y && alturas[1].y > alturas[2].y);
  const xs = alturas.map((a) => a.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 40, "as três na mesma coluna");
});

/* -------------------------------------------------------------------------
 * 6. O "À SECRETARIA MUNICIPAL DE ___" sai PREENCHIDO
 * ---------------------------------------------------------------------- */

test("6. o encaminhamento escolhido sai impresso preenchido, nas duas áreas", () => {
  const servico = dadosDoServico(
    servicoDeExemplo({ encaminhar_secretaria_nome: "Secretaria Municipal de Assistência Social" }),
    {},
  );
  // O nome sai do campo do processo, e sem o prefixo repetido.
  assert.equal(servico.requisicao.despacho, "Assistência Social");
  const html = htmlDoServico(servico, { escopo: "completo" });
  // ⚠️ O RÓTULO É O MESMO NAS QUATRO FOLHAS QUE TÊM AUTORIZAÇÃO DA PREFEITA:
  // "À SECRETARIA DE ______", seguido do núcleo cadastrado. Antes cada
  // documento escrevia do seu jeito.
  const despachos = html.match(/À SECRETARIA DE <span class="preenchido">[^<]*<\/span>/g) ?? [];
  assert.equal(despachos.length, 2, "as DUAS folhas do serviço trazem o despacho");
  despachos.forEach((linha) =>
    assert.equal(linha, 'À SECRETARIA DE <span class="preenchido">Assistência Social</span>'),
  );
  // Nada de linha em branco para completar à mão.
  assert.doesNotMatch(html, /À SECRETARIA DE\s*<span class="preenchido">\s*<\/span>/);
  assert.ok(textoDasFolhas(pdfDoServico(servico, { escopo: "requisicao" }))[0].includes("Assistência Social"));

  // A folha 2 encaminha a mesma secretaria, no lugar do Finanças fixo -- e o
  // valor guardado é o NÚCLEO, porque o prefixo quem imprime é o quadro.
  assert.equal(servico.liquidacao.destino, "Assistência Social");

  // Nas diárias, a folha 2 usa o MESMO quadro, com o mesmo rótulo.
  const diaria = dadosDaDiaria(
    diariaDeExemplo({ encaminhar_secretaria_nome: "Secretaria Municipal de Saúde" }),
    {},
  );
  assert.equal(diaria.liquidacao.destino, "Saúde");
  assert.match(
    htmlDaDiaria(diaria, { escopo: "completo" }),
    /À SECRETARIA DE <span class="preenchido">Saúde<\/span>/,
  );

  // SEM escolha, o padrão do modelo oficial: Finanças.
  assert.equal(ENCAMINHAMENTO_PADRAO, "Finanças");
  assert.equal(complementoDoEncaminhamento({}), "Finanças");
  assert.equal(destinoDaLiquidacao({}), "SECRETARIA DE FINANÇAS");
  assert.equal(secretariaMunicipalDoEncaminhamento({}), "Secretaria Municipal de Finanças");

  // A escolha é SUGERIDA, E CADA FOLHA TEM A SUA: a REQUISIÇÃO volta para a
  // casa que pediu quando ela tem financeiro, e a LIQUIDAÇÃO vai para Finanças,
  // que é quem paga. As duas seguem trocáveis até a finalização.
  const daSaude = sugerirEncaminhamento({
    secretariasFinanceiras: SECRETARIAS_DO_FINANCEIRO,
    nomeDaSolicitante: "Secretaria Municipal de Saúde",
  });
  assert.equal(daSaude.despacho_secretaria, "Secretaria Municipal de Saúde");
  assert.equal(daSaude.encaminhar_secretaria_nome, "Secretaria Municipal de Finanças");
  // Solicitante SEM financeiro -- Turismo -- manda as duas folhas para Finanças.
  const doTurismo = sugerirEncaminhamento({
    secretariasFinanceiras: SECRETARIAS_DO_FINANCEIRO,
    nomeDaSolicitante: "Secretaria Municipal de Turismo",
  });
  assert.equal(doTurismo.despacho_secretaria, "Secretaria Municipal de Finanças");
  assert.equal(doTurismo.encaminhar_secretaria_nome, "Secretaria Municipal de Finanças");
  // A liquidação sozinha nunca sugere a solicitante: é sempre quem paga.
  assert.deepEqual(
    sugerirEncaminhamentoDaLiquidacao({ secretariasFinanceiras: SECRETARIAS_DO_FINANCEIRO }),
    { encaminhar_secretaria_id: "fin-1", encaminhar_secretaria_nome: "Secretaria Municipal de Finanças" },
  );

  // ⚠️ PROCESSO ANTIGO CONTINUA IMPRIMINDO O QUE IMPRIMIA. Ele tem só um dos
  // dois campos gravado, e cada folha cai no campo do outro antes de cair em
  // Finanças -- o papel já emitido sai igual.
  assert.equal(
    complementoDoEncaminhamento({ encaminhar_secretaria_nome: "Secretaria Municipal de Educação" }),
    "Educação",
  );
  assert.equal(
    complementoDoEncaminhamentoDaLiquidacao({ despacho_secretaria: "Educação" }),
    "Educação",
  );

  // ⚠️ O ENCAMINHAMENTO NÃO É A SOLICITANTE: Turismo requisita, Finanças recebe.
  const separadas = dadosDoServico(
    servicoDeExemplo({
      solicitante_nome: "Secretaria Municipal de Turismo",
      encaminhar_secretaria_nome: "Secretaria Municipal de Finanças",
    }),
    {},
  );
  assert.match(separadas.requisitante, /Turismo/);
  assert.equal(separadas.requisicao.despacho, "Finanças");
});

/* -------------------------------------------------------------------------
 * 7. A lista vem do cadastro do FINANCEIRO -- e ele fica intacto
 * ---------------------------------------------------------------------- */

test("7. as secretarias oferecidas são lidas do cadastro do financeiro, que segue intacto", async () => {
  // A lista é o cadastro do financeiro: só as ativas, sem repetição e em ordem.
  const oferecidas = secretariasParaEncaminhamento(SECRETARIAS_DO_FINANCEIRO);
  assert.deepEqual(
    oferecidas.map((s) => s.nucleo),
    ["Assistência Social", "Educação", "Finanças", "Saúde"],
  );
  assert.ok(!oferecidas.some((s) => s.nucleo === "Cultura"), "inativa não é oferecida");
  assert.equal(oferecidas.length, new Set(oferecidas.map((s) => s.nome)).size);
  // Uma secretaria com financeiro criada amanhã aparece sozinha, sem alteração
  // nenhuma no módulo Processos.
  const comNova = secretariasParaEncaminhamento([
    ...SECRETARIAS_DO_FINANCEIRO,
    { id: "fin-9", nome: "Secretaria Municipal de Meio Ambiente", ativo: true },
  ]);
  assert.ok(comNova.some((s) => s.nucleo === "Meio Ambiente"));

  // Escolher grava id + NOME: o nome congelado é o que o documento imprime.
  const escolhida = encaminhamentoPeloNome(oferecidas, "Secretaria Municipal de Saúde");
  const gravado = dadosDoEncaminhamentoParaDocumento(escolhida);
  assert.deepEqual(gravado, {
    encaminhar_secretaria_id: "fin-2",
    encaminhar_secretaria_nome: "Secretaria Municipal de Saúde",
  });
  assert.deepEqual(CAMPOS_ENCAMINHAMENTO, [
    "encaminhar_secretaria_id",
    "encaminhar_secretaria_nome",
  ]);
  // Renomear a secretaria no cadastro depois NÃO reescreve o documento: ele
  // imprime o nome congelado no processo.
  assert.equal(complementoDoEncaminhamento({ encaminhar_secretaria_nome: "Secretaria de Saúde" }), "Saúde");
  assert.equal(nucleoDaSecretaria("Secretaria Municipal de Educação"), "Educação");

  // ⚠️ APENAS LEITURA. Nenhum arquivo do módulo escreve em `secretarias`.
  const leitura = semComentarios(await read("src/lib/processosDiariasDados.js"));
  assert.match(leitura, /from\("secretarias"\)\s*\n?\s*\.select\("id,nome"\)\s*\n?\s*\.eq\("ativo", true\)/);
  const fontes = await Promise.all(ARQUIVOS_DO_ENVIO.map((caminho) => read(caminho)));
  fontes.forEach((fonte, i) => {
    const codigo = semComentarios(fonte);
    ["insert", "update", "delete", "upsert"].forEach((escrita) => {
      assert.ok(
        !new RegExp(`from\\(\\s*"secretarias"\\s*\\)[\\s\\S]{0,120}?\\.${escrita}\\(`).test(codigo),
        `${ARQUIVOS_DO_ENVIO[i]} não pode ${escrita} no cadastro de secretarias do financeiro`,
      );
    });
  });

  // E a migration também só LÊ: nada de insert, update ou delete lá, e nenhuma
  // chave estrangeira que trave o cadastro do financeiro.
  const sql = semComentariosSql(await read(MIGRATION));
  assert.ok(!/(insert|update|delete)\s+[\s\S]{0,40}public\.secretarias/i.test(sql));
  assert.ok(!/references\s+public\.secretarias/i.test(sql));
  assert.ok(!/alter table public\.secretarias/i.test(sql));
  // Aditiva: só colunas novas, e nada removido ou renomeado.
  assert.match(sql, /add column if not exists requisicao_data date/);
  assert.match(sql, /add column if not exists encaminhar_secretaria_id uuid/);
  assert.match(sql, /add column if not exists encaminhar_secretaria_nome text/);
  assert.ok(!/drop (column|table)|rename/i.test(sql));
});

/* -------------------------------------------------------------------------
 * 8. A LISTA DE BANCOS ABRE AO CLICAR, TOCAR OU FOCAR -- e fecha ao clicar fora
 * ---------------------------------------------------------------------- */

/**
 * ⚠️ ESTE TESTE FOI REESCRITO, e é importante dizer por quê.
 *
 * Ele afirmava que "a lista só aparece ao digitar". Era a descrição fiel do que
 * o código fazia, e era justamente o defeito: a pessoa clicava no campo do banco
 * e nada acontecia, então ela precisava ADIVINHAR o número ou o começo do nome
 * para descobrir o que existia cadastrado. Campo de escolha que não mostra as
 * opções não é campo de escolha.
 *
 * O comportamento correto, e o que este teste passa a exigir: clicar, tocar ou
 * focar o campo abre a lista COMPLETA; digitar apenas FILTRA o que já está à
 * vista; clicar fora fecha.
 *
 * O que já funcionava continua exigido aqui, linha por linha: a lista FLUTUA
 * (não empurra Agência, Conta, PIX e Titular para baixo), tem altura limitada,
 * rola por dentro e trata o toque do iPad pelo `onPointerDown`.
 */
test("8. a lista de bancos abre ao clicar, tocar ou focar o campo, e fecha ao clicar fora", async () => {
  const fonte = await read("src/components/processos/SeletorBanco.jsx");
  const codigo = semComentarios(fonte);

  // ABRIR É ESTADO PRÓPRIO, e não consequência de haver texto digitado.
  assert.match(codigo, /const \[listaAberta, setListaAberta\] = React\.useState\(false\)/);
  assert.match(codigo, /\{listaAberta && \(\s*\n?\s*<ul/);
  // E o que se digita NÃO é mais a condição de a lista existir.
  assert.doesNotMatch(codigo, /const procurando =/);
  assert.doesNotMatch(codigo, /\{procurando && \(/);

  // CLIQUE, TOQUE E FOCO abrem. O toque é o `onPointerDown` na caixa inteira --
  // no iPad o dedo precisa acertar a linha, não só o texto.
  assert.match(codigo, /const abrirLista = \(\) => \{/);
  assert.match(codigo, /onPointerDown=\{abrirLista\}/);
  assert.match(codigo, /onClick=\{abrirLista\}/);
  assert.match(codigo, /onFocus=\{abrirLista\}/);

  // CLICAR FORA FECHA: ouvinte no documento, com a caixa do campo como fronteira.
  assert.match(codigo, /const caixa = React\.useRef\(null\)/);
  assert.match(codigo, /<div className="relative" ref=\{caixa\}>/);
  assert.match(codigo, /document\.addEventListener\("pointerdown", aoApontarFora, true\)/);
  assert.match(codigo, /document\.removeEventListener\("pointerdown", aoApontarFora, true\)/);
  assert.match(codigo, /if \(caixa\.current\?\.contains\(evento\.target\)\) return/);
  // Escape fecha, e escolher fecha.
  assert.match(codigo, /const fecharLista = \(\) => \{/);
  assert.match(codigo, /if \(e\.key === "Escape"\) fecharLista\(\)/);
  assert.match(codigo, /const escolher = \(banco\) => \{[\s\S]*?fecharLista\(\)/);

  // O QUE JÁ FUNCIONAVA, mantido: a lista FLUTUA sobre o conteúdo -- `absolute`
  // dentro de um `relative` --, então não empurra Agência, Conta, PIX e Titular.
  assert.match(codigo, /className="absolute left-0 right-0 top-full z-20/);
  // A altura é limitada e a rolagem é DENTRO da lista.
  assert.match(codigo, /max-h-56/);
  assert.match(codigo, /overflow-y-auto/);
  assert.match(codigo, /overscroll-contain/);
  // Toque no iPad: o `onPointerDown` do item garante a escolha do dedo, e as
  // linhas têm alvo grande.
  assert.match(codigo, /onPointerDown=\{\(e\) => \{/);
  assert.match(codigo, /py-2\.5/);
  // Poucos resultados desenhados por vez; a busca afina o resto.
  assert.match(codigo, /const LIMITE_DA_LISTA = 30/);
  assert.match(codigo, /encontrados\.slice\(0, LIMITE_DA_LISTA\)/);
  assert.match(codigo, /bancoAtendeBusca\(banco, busca\)/);
});

/* -------------------------------------------------------------------------
 * 9. Procurar o banco por número e por nome
 * ---------------------------------------------------------------------- */

test("9. procurar o banco por 001 e por bras encontra o Banco do Brasil", () => {
  const brasil = BANCOS_INICIAIS.find((banco) => /Brasil/i.test(banco.nome));
  assert.ok(brasil);
  ["001", "1", "bras", "BRASIL", "banco do brasil"].forEach((busca) =>
    assert.ok(bancoAtendeBusca(brasil, busca), `"${busca}" deveria encontrar o Banco do Brasil`),
  );
  // E a busca não traz o que não pediram.
  assert.ok(!bancoAtendeBusca(brasil, "104"));
  assert.ok(!bancoAtendeBusca(brasil, "caixa"));
  // Outros números do cadastro continuam achando os seus.
  const caixa = BANCOS_INICIAIS.find((banco) => /Caixa/i.test(banco.nome));
  assert.ok(bancoAtendeBusca(caixa, "104"));
  assert.ok(bancoAtendeBusca(caixa, "caixa"));
});

/* -------------------------------------------------------------------------
 * 10. Processo já criado continua abrindo -- e imprimindo -- como antes
 * ---------------------------------------------------------------------- */

test("10. processo já criado abre normalmente e imprime como sempre imprimiu", () => {
  // Uma linha GRAVADA ANTES desta migration: sem as colunas novas.
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

  // Abre sem inventar data nenhuma: a folha 1 do processo antigo NÃO ganha a
  // data de hoje só por ter sido reaberta.
  const formulario = processoParaFormularioServico(antigoServico);
  assert.equal(formulario.requisicao_data, "");
  assert.equal(formulario.encaminhar_secretaria_nome, "");
  assert.equal(formulario.data_processo, "2026-01-05");
  assert.equal(formularioParaBancoServico(formulario).requisicao_data, null);

  // E imprime exatamente como imprimia: as duas folhas com a data de abertura
  // e o despacho completado com a solicitante.
  const dados = dadosDoServico(antigoServico, {});
  assert.equal(dados.requisicao.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(dados.liquidacao.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(dados.requisicao.despacho, "Educação");
  assert.equal(dados.liquidacao.destino, "Finanças");
  assert.equal(pdfDoServico(dados, { escopo: "completo" }).getNumberOfPages(), 2);

  // O despacho escrito à mão no processo antigo continua sendo o impresso.
  assert.equal(
    dadosDoServico({ ...antigoServico, despacho_secretaria: "Finanças" }, {}).requisicao.despacho,
    "Finanças",
  );

  // A diária antiga, igual: nenhuma data nova e a folha 3 segue em branco para
  // ser completada à mão quando a prestação de contas não foi datada.
  const antigaDiaria = {
    id: 8,
    numero: 2,
    ano: 2026,
    situacao: "finalizada",
    data_processo: "2026-01-05",
    beneficiario_nome: "João da Silva",
    valor_total: 400,
  };
  const formularioDiaria = processoParaFormularioDiaria(antigaDiaria);
  assert.equal(formularioDiaria.requisicao_data, "");
  const daDiaria = dadosDaDiaria(antigaDiaria, {});
  assert.equal(daDiaria.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(daDiaria.liquidacao.localEData, daDiaria.localEData);
  assert.equal(dataDaPrestacao(antigaDiaria), "");
  assert.equal(
    daDiaria.prestacao.localEData,
    "São José da Laje/AL, ______ de ____________________ de 2026",
  );
});

/* -------------------------------------------------------------------------
 * 11. Nada disto é financeiro
 * ---------------------------------------------------------------------- */

test("11. nada aqui altera saldo, dá baixa, programa pagamento ou cria pagamento", async () => {
  const PROIBIDOS = [
    "pagamentos",
    "pagamentos_baixas",
    "valores_em_aberto",
    "saldos_historico",
    "contas_bancarias",
    "transferencias_contas",
    "programacoes_pagamento",
  ];

  const fontes = await Promise.all(ARQUIVOS_DO_ENVIO.map((caminho) => read(caminho)));
  fontes.forEach((fonte, i) => {
    const codigo = semComentarios(fonte);
    // ⚠️ CONSULTAR a NF em aberto é leitura, e continua permitido: é o que
    // permite copiar número, emissão e valores para DENTRO do documento. O que
    // não pode -- e não existe em nenhum destes arquivos -- é ESCREVER.
    PROIBIDOS.forEach((tabela) =>
      ["insert", "update", "delete", "upsert"].forEach((escrita) =>
        assert.ok(
          !new RegExp(
            `from\\(\\s*["'\`]${tabela}["'\`]\\s*\\)[\\s\\S]{0,200}?\\.${escrita}\\(`,
          ).test(codigo),
          `${ARQUIVOS_DO_ENVIO[i]} não pode ${escrita} em ${tabela}`,
        ),
      ),
    );
    ["registrarBaixa", "darBaixa", "debitarSaldo", "atualizarSaldo", "criarPagamento"].forEach(
      (acao) =>
        assert.ok(!codigo.includes(acao), `${ARQUIVOS_DO_ENVIO[i]} não pode chamar ${acao}`),
    );
  });

  // A migration também não toca em nada financeiro: ela só acrescenta colunas
  // nas duas tabelas do módulo Processos.
  const sql = semComentariosSql(await read(MIGRATION));
  PROIBIDOS.forEach((tabela) =>
    assert.ok(!new RegExp(`public\\.${tabela}\\b`).test(sql), `a migration não pode tocar em ${tabela}`),
  );
  const alteradas = [...sql.matchAll(/alter table (public\.[a-z_]+)/g)].map((achado) => achado[1]);
  assert.deepEqual([...new Set(alteradas)].sort(), [
    "public.processos_diarias",
    "public.processos_servicos",
  ]);
  // Ela precisa ser rodada À MÃO no SQL Editor do Supabase, e avisa isso.
  const bruto = await read(MIGRATION);
  assert.match(bruto, /MANUALMENTE no SQL Editor do\s+(--\s+)?Supabase/);
});
