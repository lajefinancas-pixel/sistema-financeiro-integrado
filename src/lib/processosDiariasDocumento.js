// O documento do Processo de Diária: as TRÊS páginas, em impressão e em PDF.
//
// É o modelo oficial da Prefeitura Municipal de São José da Laje - AL, folha por
// folha, campo por campo:
//
//   1. REQUISIÇÃO DE DIÁRIAS -- a Lei Municipal nº 003/2005, o que se requisita,
//      a identificação do servidor, o quadro de valores com o VALOR POR EXTENSO
//      e as três assinaturas (servidor, secretaria e prefeita).
//   2. LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO -- o requisitante, o pedido de
//      autorização à Senhora Prefeita, o quadro resumo, o favorecido com dados
//      bancários e valor, e a autorização da prefeita para a Secretaria
//      Municipal de Finanças.
//   3. PRESTAÇÃO DE CONTAS DE DIÁRIAS -- o RELATÓRIO DE ATIVIDADES, impresso com
//      linhas para ser escrito à mão quando ainda não foi digitado, e o
//      fechamento com local, data, nome e cargo do servidor.
//
// Não é captura de tela: é o documento desenhado em A4 retrato, com o rodapé
// institucional da prefeitura em TODAS as páginas.
//
// PAGINAÇÃO. Cada documento começa em folha PRÓPRIA -- na impressão pelo
// `page-break-after` da folha, no PDF por um `addPage()` incondicional. No uso
// normal o processo completo sai em exatamente três páginas; conteúdo
// excepcionalmente grande transborda para uma folha a mais em vez de ser
// cortado: informação do documento não é truncada para forçar três páginas.
//
// A PRESTAÇÃO DE CONTAS PENDENTE NÃO IMPEDE NADA. Ela é preenchida depois da
// viagem: enquanto isso, a página 3 sai com as linhas em branco e as páginas 1
// e 2 saem completas, como no papel.
//
// O DOCUMENTO NÃO É FINANCEIRO. Imprimir ou gerar o PDF não debita conta, não
// dá baixa em NF, não altera saldo e não cria pagamento. A página 2 chama-se
// "Liquidação/Solicitação de Pagamento" porque é o nome do formulário: ela
// SOLICITA a autorização da prefeita em papel, e nada mais.

import { jsPDF } from "jspdf";
import { formatBRL, formatBRLSimples, paraNumeroMoeda } from "./moeda.js";
import { imprimirDocumentoHtml } from "./impressaoNavegador.js";
import {
  LEI_DAS_DIARIAS,
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  TITULO_PAGINA_3,
  dataBR,
  dataDasDiarias,
  nomeDaSecretaria,
  numeroDoProcesso,
  quantidadeDeDiarias,
  relatorioDaPrestacao,
  situacaoInfo,
  valorExtensoDoProcesso,
} from "./processosDiarias.js";
import {
  BRASAO_SVG,
  IDENTIDADE_PADRAO,
  identidadeDoProcesso,
  normalizarIdentidade,
} from "./processosIdentidade.js";
import { logoDoDocumento } from "./processosIdentidade.js";
import { tipoDiariaComposto } from "./processosDiariasTabela.js";

/**
 * O cabeçalho institucional de fábrica.
 *
 * Continua exportado porque telas e testes o citam, mas o que o documento
 * IMPRIME é `dados.identidade` -- a identidade configurada em
 * Configurações → Processos, ou a congelada no processo quando ele já foi
 * finalizado. Estes dois objetos são só o ponto de partida.
 */
export const IDENTIDADE = {
  orgao: IDENTIDADE_PADRAO.orgao,
  estado: IDENTIDADE_PADRAO.estado,
};

/** O rodapé institucional de fábrica, impresso em TODAS as páginas do processo. */
export const RODAPE_INSTITUCIONAL = {
  endereco: IDENTIDADE_PADRAO.rodape_endereco,
  contato: IDENTIDADE_PADRAO.rodape_contato,
};

/** O município que assina o documento, nas linhas de "Local e data". */
export const MUNICIPIO = "São José da Laje - AL";

/** A secretaria a quem a autorização da prefeita é destinada (página 2). */
export const SECRETARIA_DE_FINANCAS = "Secretaria Municipal de Finanças";

export const SEM_REGISTRO = "--";

/** Os quatro escopos de saída: o processo completo ou um documento só. */
export const ESCOPOS = [
  { id: "completo", rotulo: "Processo completo (3 páginas)" },
  { id: "requisicao", rotulo: "Somente a Requisição" },
  { id: "liquidacao", rotulo: "Somente a Liquidação" },
  { id: "prestacao", rotulo: "Somente a Prestação de Contas" },
];

const COR = {
  navy: "#0F2A44",
  ouro: "#C9A227",
  faixa: "#EEF2F7",
  linha: "#C8D2DE",
  apoio: "#5A6B7E",
};

const TINTA = {
  navy: [15, 42, 68],
  ouro: [201, 162, 39],
  faixa: [238, 242, 247],
  linha: [200, 210, 222],
  apoio: [90, 107, 126],
  branco: [255, 255, 255],
  papel: [251, 250, 247],
};

// A4 retrato. A margem de baixo é maior porque o rodapé institucional tem duas
// linhas de endereço e contato, mais a linha de emissão.
const PAGINA = { largura: 210, altura: 297, margemTopo: 10, margemBase: 18, margemLado: 13 };

/** O espaçamento das linhas do RELATÓRIO DE ATIVIDADES, em milímetros. */
const PAUTA = 7;

/* -------------------------------------------------------------------------
 * Dados do documento
 * ---------------------------------------------------------------------- */

function texto(valor) {
  return String(valor ?? "").trim();
}

function ou(valor) {
  const limpo = texto(valor);
  return limpo === "" ? SEM_REGISTRO : limpo;
}

function moeda(valor) {
  return formatBRL(paraNumeroMoeda(valor));
}

function moedaSimples(valor) {
  return formatBRLSimples(paraNumeroMoeda(valor));
}

function escapar(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[c]));
}

/** "11/09/2026 15:42" -- data e hora da emissão. */
export function agoraBR() {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "2" ou "1,5" -- a quantidade como ela entra na frase "Requisita: N Diária(s)". */
function quantidadeNumero(valor) {
  const numero = quantidadeDeDiarias(valor);
  if (numero <= 0) return SEM_REGISTRO;
  return Number.isInteger(numero) ? String(numero) : numero.toFixed(1).replace(".", ",");
}

/** "2 diárias" -- a quantidade com a palavra, para o quadro resumo. */
function quantidadeTexto(valor) {
  const numero = quantidadeDeDiarias(valor);
  if (numero <= 0) return SEM_REGISTRO;
  return `${quantidadeNumero(valor)} ${numero === 1 ? "diária" : "diárias"}`;
}

/**
 * "Secretaria Municipal de Educação" -- o requisitante da página 2.
 *
 * O prefixo não é repetido quando a secretaria já vem cadastrada com ele: o
 * papel sairia "Secretaria Municipal de Secretaria de Educação".
 */
/**
 * O "Tipo de Diária" que vai para o papel.
 *
 * Quem escolheu faixa, categoria e pernoite na tela tem o campo COMPOSTO a
 * partir disso ("Estado de AL até 100 km — Outros Agentes — com pernoite"), que
 * é o que o item 5 pede. O texto gravado em tipo_diaria manda quando existe:
 * ele é a redação manual, e processo antigo (anterior à Tabela de Diárias) só
 * tem ele.
 */
function tipoDiariaDoProcesso(processo) {
  const escrito = texto(processo?.tipo_diaria);
  if (escrito !== "") return escrito;
  return tipoDiariaComposto({
    faixa: processo?.diaria_faixa,
    categoria: processo?.diaria_categoria,
    pernoite: processo?.diaria_pernoite === true,
  });
}

/**
 * A imagem preparada só vale para a identidade que ela representa.
 *
 * É a trava do item 12 no nível do desenho: documento já finalizado imprime o
 * brasão que congelou, e uma imagem preparada a partir de outra URL é
 * descartada em favor do desenho vetorial.
 */
function logoAceito(logo, identidade) {
  if (!logo || !logo.dataUrl) return null;
  const origem = texto(logo.url);
  if (origem === "") return null;
  return origem === logoDoDocumento(identidade) ? logo : null;
}

function requisitanteDe(nome) {
  const limpo = texto(nome);
  if (limpo === "") return SEM_REGISTRO;
  return /^secretaria/i.test(limpo) ? limpo : `Secretaria Municipal de ${limpo}`;
}

/**
 * O texto do campo "Objetivando" -- o mesmo nas páginas 1 e 2.
 *
 * É o campo do formulário oficial onde se escreve a que a viagem se destina.
 * Ele reúne o que o cadastro tem sobre isso (objeto, finalidade e destino) em
 * vez de deixar qualquer um deles fora do papel.
 */
function objetivandoDe(processo) {
  const objeto = texto(processo?.objeto);
  const finalidade = texto(processo?.finalidade);
  const destino = texto(processo?.destino);

  const partes = [];
  if (objeto !== "") partes.push(objeto);
  if (finalidade !== "" && finalidade !== objeto) partes.push(finalidade);
  if (destino !== "") partes.push(`Destino: ${destino}`);
  return partes.length > 0 ? partes.join(" — ") : SEM_REGISTRO;
}

/** "São José da Laje - AL, 10 de março de 2026" -- ou com o dia e o mês em branco. */
function localEData(data, ano) {
  const bruto = texto(data);
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
  if (partes) {
    const meses = [
      "janeiro", "fevereiro", "março", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    ];
    const mes = meses[Number(partes[2]) - 1] ?? "";
    return `${MUNICIPIO}, ${Number(partes[3])} de ${mes} de ${partes[1]}`;
  }
  // Sem data preenchida o papel sai como o formulário oficial: para completar à
  // mão, já com o ano do exercício.
  const exercicio = Number(ano);
  const fim = Number.isFinite(exercicio) && exercicio > 0 ? String(Math.trunc(exercicio)) : "______";
  return `${MUNICIPIO}, ______ de ____________________ de ${fim}`;
}

/**
 * Tudo o que as três páginas mostram, lido UMA VEZ do processo.
 *
 * Os dados compartilhados aparecem em mais de uma página porque são os MESMOS
 * dados -- não há cópia aqui, só leitura do mesmo registro. É o que garante que
 * o nome do servidor na Requisição e o favorecido da Liquidação nunca divirjam.
 */
export function dadosDoDocumento(
  processo,
  { secretarias = [], emissor = "", emissao = null, identidade = null, logo = null } = {},
) {
  const p = processo ?? {};
  const secretaria = nomeDaSecretaria(p, secretarias);

  return {
    // ⚠️ A IDENTIDADE VISUAL DA FOLHA. Processo já finalizado imprime a que ele
    // congelou; rascunho imprime a vigente. Trocar o brasão ou o rodapé hoje
    // não reescreve o documento emitido antes -- a mesma regra dos dados do
    // secretário e da prefeita.
    identidade: identidadeDoProcesso(p, identidade),
    // A versão rasterizada do brasão, quando a tela conseguiu preparar uma: é o
    // que faz o PDF sair sem serrilhado. Só é aceita se tiver sido preparada a
    // partir da MESMA imagem que esta folha deve imprimir -- assim um processo
    // que congelou o brasão antigo não sai com o brasão novo por atalho.
    logo: logoAceito(logo, identidadeDoProcesso(p, identidade)),

    numero: numeroDoProcesso(p) || SEM_REGISTRO,
    ano: p.ano ?? null,
    situacao: situacaoInfo(p.situacao).rotulo,
    cancelado: texto(p.situacao) === "cancelada",
    rascunho: texto(p.situacao) === "rascunho",
    motivoCancelamento: texto(p.motivo_cancelamento),
    data: dataBR(p.data_processo) || SEM_REGISTRO,
    secretaria: ou(secretaria),
    requisitante: requisitanteDe(secretaria),
    emissao: emissao || agoraBR(),
    emissor: ou(emissor),

    // PÁGINA 1 — o que se requisita.
    requisicao: {
      lei: LEI_DAS_DIARIAS,
      quantidade: quantidadeNumero(p.quantidade_diarias),
      custeio: ou(p.custeio_despesas),
      objetivando: objetivandoDe(p),
      dataDiarias: ou(dataDasDiarias(p)),
    },

    // PÁGINA 1 — identificação do servidor, na ordem do formulário.
    servidor: {
      nome: ou(p.beneficiario_nome),
      cpf: ou(p.beneficiario_cpf),
      endereco: ou(p.beneficiario_endereco),
      secretaria: ou(secretaria),
      cargo: ou(p.beneficiario_cargo),
      horarioSaida: ou(p.hora_saida),
      tipoDiaria: ou(tipoDiariaDoProcesso(p)),
    },

    // O quadro de valores das páginas 1 e 2.
    valor: {
      quantidade: quantidadeNumero(p.quantidade_diarias),
      quantidadeTexto: quantidadeTexto(p.quantidade_diarias),
      unitario: moeda(p.valor_unitario),
      total: moeda(p.valor_total),
      totalSimples: moedaSimples(p.valor_total),
      extenso: ou(valorExtensoDoProcesso(p)),
    },

    banco: {
      banco: ou(p.banco),
      agencia: ou(p.agencia),
      conta: ou(p.conta),
      pix: ou(p.pix),
      titular: ou(p.titular),
    },

    // PÁGINA 3 — a prestação de contas, que pode estar pendente.
    prestacao: {
      relatorio: relatorioDaPrestacao(p),
      data: texto(p.prestacao_data),
      localEData: localEData(p.prestacao_data, p.ano),
    },

    localEData: localEData(p.data_processo, p.ano),
  };
}

/** As folhas que a saída vai ter, na ordem do processo. */
export function folhasDoEscopo(escopo) {
  if (escopo === "requisicao") return ["requisicao"];
  if (escopo === "liquidacao") return ["liquidacao"];
  if (escopo === "prestacao") return ["prestacao"];
  return ["requisicao", "liquidacao", "prestacao"];
}

/** "processo-diaria-0001-2026.pdf" */
export function nomeDoArquivo(dados, extensao = "pdf", escopo = "completo") {
  const numero = String(dados?.numero ?? "").replace("/", "-").replace(/[^\w-]/g, "");
  const sufixos = { requisicao: "-requisicao", liquidacao: "-liquidacao", prestacao: "-prestacao-de-contas" };
  return `processo-diaria-${numero || "sem-numero"}${sufixos[escopo] ?? ""}.${extensao}`;
}

/* -------------------------------------------------------------------------
 * Impressão (HTML)
 * ---------------------------------------------------------------------- */

// O brasão do repositório, embutido no documento para que a folha nunca saia sem
// ele por causa de uma imagem que não carregou na janela de impressão.
function brasaoSvg(lado) {
  return BRASAO_SVG.replace(
    /^<svg /,
    `<svg width="${lado}mm" height="${lado}mm" `,
  ).replace(/ width="512" height="512"/, "");
}

/**
 * O brasão do CABEÇALHO, em TODAS as folhas.
 *
 * Brasão enviado em Configurações → Processos sai como imagem; sem imagem
 * enviada, sai o vetor do repositório. Nos dois casos a ALTURA é a que manda e a
 * largura é automática, com um teto de largura -- é o que impede a folha de
 * deformar o brasão e o que o mantém discreto, sem roubar espaço do conteúdo.
 */
function brasaoDoDocumento(dados, lado) {
  const url = texto(dados?.logo?.dataUrl) || texto(dados?.identidade?.logo_url);
  if (url === "") return brasaoSvg(lado);
  return `<img class="brasao" src="${escapar(url)}" alt="${escapar(dados?.identidade?.orgao ?? "")}"`
    + ` style="height:${lado}mm;max-width:${(lado * 1.6).toFixed(1)}mm">`;
}

function estilos() {
  return `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { color: ${COR.navy}; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.35;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    /* A folha tem a altura da página e sempre quebra depois: é isto que faz cada
       documento do processo começar em folha nova, qualquer que seja o tamanho
       do conteúdo. A altura é MÍNIMA, não fixa -- conteúdo excepcional
       transborda para uma folha a mais em vez de ser cortado. */
    .folha { position: relative; width: ${PAGINA.largura}mm; min-height: ${PAGINA.altura}mm;
      padding: ${PAGINA.margemTopo}mm ${PAGINA.margemLado}mm ${PAGINA.margemBase + 4}mm;
      page-break-after: always; break-after: page; }
    .folha:last-child { page-break-after: auto; break-after: auto; }

    .cabecalho { display: flex; align-items: center; gap: 4mm; border-bottom: 1.4pt solid ${COR.navy}; padding-bottom: 2mm; }
    .cabecalho svg { display: block; flex: 0 0 auto; }
    /* O brasão enviado entra como imagem: altura fixa e largura automática, para
       sair SEMPRE na proporção original, sem esticar nem achatar. */
    .cabecalho img.brasao { display: block; flex: 0 0 auto; width: auto; object-fit: contain; }
    .orgao { font-size: 10pt; font-weight: bold; letter-spacing: .08em; }
    .estado { margin-top: .4mm; color: ${COR.apoio}; font-size: 7.5pt; font-weight: bold; letter-spacing: .16em; }
    .titulo { margin: 1.2mm 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 13pt; letter-spacing: .02em; }
    .selo { margin-left: auto; text-align: right; font-size: 7.5pt; color: ${COR.apoio}; white-space: nowrap; }
    .selo strong { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 12pt; color: ${COR.navy}; }
    .pagina-de { font-size: 6.5pt; letter-spacing: .1em; text-transform: uppercase; }

    .aviso { margin-top: 2.5mm; border: .8pt solid ${COR.navy}; padding: 1.6mm 2mm; font-size: 8pt; }
    .aviso strong { letter-spacing: .06em; text-transform: uppercase; }

    h2 { margin: 4mm 0 1.6mm; padding: 1.2mm 2mm; background: ${COR.navy}; color: #fff; font-size: 8pt;
      font-weight: bold; letter-spacing: .1em; text-transform: uppercase; }

    .abertura { margin: 4mm 0 0; text-align: justify; }
    .linha-doc { margin: 2.6mm 0 0; }
    .linha-doc b { letter-spacing: .02em; }
    /* O valor preenchido sai sobre a linha pontilhada do formulário; vazio, a
       linha fica lá para ser completada à mão. */
    .preenchido { border-bottom: .5pt dotted ${COR.apoio}; padding: 0 1mm; }
    .destaque { font-weight: bold; }

    .grade { display: flex; flex-wrap: wrap; border: .5pt solid ${COR.linha}; border-bottom: 0; }
    .campo { border-bottom: .5pt solid ${COR.linha}; border-right: .5pt solid ${COR.linha}; padding: 1.4mm 2mm; overflow: hidden; }
    .campo .rotulo { display: block; font-size: 6.5pt; letter-spacing: .08em; text-transform: uppercase; color: ${COR.apoio}; }
    .campo .valor { display: block; font-size: 9.5pt; overflow-wrap: break-word; }
    .campo.forte .valor { font-weight: bold; }
    .c100 { width: 100%; border-right: 0; }
    .c50 { width: 50%; }
    .c33 { width: 33.34%; }
    .c67 { width: 66.66%; }
    .fim { border-right: 0; }

    table.quadro { width: 100%; border-collapse: collapse; margin-top: 1.6mm; }
    table.quadro th { border: .5pt solid ${COR.navy}; background: ${COR.faixa}; padding: 1.4mm 2mm;
      font-size: 7.5pt; letter-spacing: .06em; text-transform: uppercase; text-align: left; }
    table.quadro td { border: .5pt solid ${COR.navy}; padding: 1.8mm 2mm; font-size: 9.5pt; vertical-align: top;
      overflow-wrap: break-word; }
    table.quadro td.numero { font-weight: bold; white-space: nowrap; }
    table.quadro td b { display: block; }
    table.quadro td span.rotulo { display: block; font-size: 6.5pt; letter-spacing: .08em;
      text-transform: uppercase; color: ${COR.apoio}; margin-top: 1.2mm; }
    table.quadro td span.rotulo:first-child { margin-top: 0; }

    .texto { border: .5pt solid ${COR.linha}; padding: 1.8mm 2mm; min-height: 16mm; font-size: 9.5pt;
      white-space: pre-wrap; overflow-wrap: break-word; }

    /* O RELATÓRIO DE ATIVIDADES sai PAUTADO: as linhas são impressas, para ser
       escrito à mão quando a prestação de contas ainda não foi digitada. A
       entrelinha do texto é a mesma distância das linhas, então o que já foi
       digitado assenta sobre elas. */
    .pautado { border: .5pt solid ${COR.linha}; padding: 0 2mm; min-height: ${PAUTA * 16}mm;
      font-size: 10pt; line-height: ${PAUTA}mm; white-space: pre-wrap; overflow-wrap: break-word;
      background-image: repeating-linear-gradient(to bottom,
        transparent 0, transparent ${PAUTA - 0.25}mm, ${COR.linha} ${PAUTA - 0.25}mm, ${COR.linha} ${PAUTA}mm); }

    .fecho { margin-top: 4mm; text-align: justify; }
    .local-data { margin-top: 8mm; text-align: center; font-size: 10pt; }

    .assinaturas { display: flex; gap: 6mm; margin-top: 12mm; }
    .assinaturas div { flex: 1; border-top: .7pt solid ${COR.navy}; padding-top: 1.4mm; text-align: center;
      font-size: 7.5pt; color: ${COR.apoio}; }
    .assinaturas strong { display: block; font-size: 8.5pt; color: ${COR.navy}; }
    .assinatura-unica { margin: 12mm auto 0; width: 90mm; border-top: .7pt solid ${COR.navy}; padding-top: 1.4mm;
      text-align: center; font-size: 7.5pt; color: ${COR.apoio}; }
    .assinatura-unica strong { display: block; font-size: 9pt; color: ${COR.navy}; }

    .autorizacao { margin-top: 5mm; border: .8pt solid ${COR.navy}; padding: 3mm; }
    .autorizacao .rotulo-caixa { font-size: 7.5pt; font-weight: bold; letter-spacing: .1em;
      text-transform: uppercase; color: ${COR.apoio}; }
    .autorizacao p { margin: 1.6mm 0 0; }
    .linhas-a-mao { margin-top: 6mm; }
    .linhas-a-mao div { margin-top: 5mm; border-bottom: .5pt solid ${COR.apoio}; font-size: 8pt;
      color: ${COR.apoio}; padding-bottom: .8mm; }

    .rodape { position: absolute; left: ${PAGINA.margemLado}mm; right: ${PAGINA.margemLado}mm; bottom: 6mm;
      border-top: .5pt solid ${COR.navy}; padding-top: 1.2mm; text-align: center; color: ${COR.apoio}; font-size: 7pt; }
    .rodape .endereco { color: ${COR.navy}; font-weight: bold; }
    .rodape .emissao { margin-top: .6mm; font-size: 6.5pt; }
  `;
}

function cabecalhoHtml(dados, titulo, indice, total) {
  const identidade = normalizarIdentidade(dados?.identidade);
  return `<div class="cabecalho">${brasaoDoDocumento(dados, 16)}`
    + `<div><div class="orgao">${escapar(identidade.orgao)}</div>`
    + `<div class="estado">${escapar(identidade.estado)}</div>`
    + `<div class="titulo">${escapar(titulo)}</div></div>`
    + `<div class="selo"><span class="pagina-de">Processo de diária nº</span><strong>${escapar(dados.numero)}</strong>`
    + `<span class="pagina-de">Página ${indice} de ${total}</span></div>`
    + `</div>`;
}

/**
 * O aviso que o papel carrega quando o documento não está finalizado.
 *
 * Rascunho impresso precisa dizer que é rascunho, e processo cancelado precisa
 * dizer que foi anulado -- senão a folha circula como se valesse.
 */
function avisoHtml(dados) {
  if (dados.cancelado) {
    const motivo = dados.motivoCancelamento ? ` Motivo: ${dados.motivoCancelamento}.` : "";
    return `<div class="aviso"><strong>Processo cancelado.</strong>${escapar(motivo)} O registro, a numeração e o histórico foram preservados.</div>`;
  }
  if (dados.rascunho) {
    return `<div class="aviso"><strong>Rascunho.</strong> Documento ainda não finalizado — sujeito a alteração.</div>`;
  }
  return "";
}

function campo(rotulo, valor, classe = "c50", forte = false) {
  return `<div class="campo ${classe}${forte ? " forte" : ""}">`
    + `<span class="rotulo">${escapar(rotulo)}</span>`
    + `<span class="valor">${escapar(valor)}</span></div>`;
}

/** O rodapé institucional, igual em todas as folhas. */
function rodapeHtml(dados, indice, total) {
  const identidade = normalizarIdentidade(dados?.identidade);
  return `<div class="rodape">`
    + `<div class="endereco">${escapar(identidade.rodape_endereco)}</div>`
    + `<div>${escapar(identidade.rodape_contato)}</div>`
    + `<div class="emissao">Processo nº ${escapar(dados.numero)} — Página ${indice} de ${total} — `
    + `Emitido em ${escapar(dados.emissao)} por ${escapar(dados.emissor)}</div>`
    + `</div>`;
}

/** Página 1: REQUISIÇÃO DE DIÁRIAS. */
function folhaRequisicao(dados, indice, total) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_1, indice, total)
    + avisoHtml(dados)

    + `<p class="abertura">O(a) servidor(a) abaixo identificado(a), na conformidade da `
    + `${escapar(dados.requisicao.lei)}</p>`

    + `<p class="linha-doc"><b>Requisita:</b> <span class="preenchido destaque">${escapar(dados.requisicao.quantidade)}</span> `
    + `Diária(s) destinada(s) ao custeio de despesas `
    + `<span class="preenchido">${escapar(dados.requisicao.custeio)}</span></p>`
    + `<p class="linha-doc"><b>Objetivando:</b> <span class="preenchido">${escapar(dados.requisicao.objetivando)}</span></p>`
    + `<p class="linha-doc"><b>Data da(s) Diária(s):</b> <span class="preenchido">${escapar(dados.requisicao.dataDiarias)}</span></p>`

    + `<h2>Identificação do Servidor</h2>`
    + `<div class="grade">`
    + campo("Nome", dados.servidor.nome, "c67")
    + campo("CPF", dados.servidor.cpf, "c33 fim")
    + campo("Endereço", dados.servidor.endereco, "c100")
    + campo("Secretaria", dados.servidor.secretaria, "c50")
    + campo("Cargo", dados.servidor.cargo, "c50 fim")
    + campo("Horário de Saída", dados.servidor.horarioSaida, "c50")
    + campo("Tipo de Diária", dados.servidor.tipoDiaria, "c50 fim")
    + `</div>`

    + `<table class="quadro"><thead><tr>`
    + `<th style="width:20%">Quantidade</th>`
    + `<th style="width:28%">Valor da(s) Diária(s) R$</th>`
    + `<th>Valor por Extenso</th>`
    + `</tr></thead><tbody><tr>`
    + `<td class="numero">${escapar(dados.valor.quantidade)}</td>`
    + `<td class="numero">${escapar(dados.valor.totalSimples)}</td>`
    + `<td>${escapar(dados.valor.extenso)}</td>`
    + `</tr></tbody></table>`

    + `<p class="local-data">${escapar(dados.localEData)}</p>`

    + `<div class="assinaturas">`
    + `<div><strong>${escapar(dados.servidor.nome === SEM_REGISTRO ? "&nbsp;" : dados.servidor.nome)}</strong>Assinatura do Servidor</div>`
    + `<div><strong>&nbsp;</strong>Responsável pela Secretaria</div>`
    + `<div><strong>&nbsp;</strong>Assinatura da Prefeita</div>`
    + `</div>`

    + rodapeHtml(dados, indice, total)
    + `</div>`;
}

/** Página 2: LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO (sempre em folha nova). */
function folhaLiquidacao(dados, indice, total) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_2, indice, total)
    + avisoHtml(dados)

    + `<p class="linha-doc"><b>Requisitante:</b> <span class="preenchido">${escapar(dados.requisitante)}</span></p>`

    + `<p class="abertura"><b>A Senhora Prefeita</b></p>`
    + `<p class="abertura">Pelo presente, venho solicitar AUTORIZAÇÃO de pagamento em favor do(a) beneficiário(a) `
    + `abaixo identificado(a), o(a) qual: Realizou viagens e/ou deslocamentos, conforme descrito abaixo, e que `
    + `ATESTO a necessidade e a realização das mesmas.</p>`

    + `<h2>Quadro Resumo</h2>`
    + `<table class="quadro"><thead><tr>`
    + `<th>Objetivando</th>`
    + `<th style="width:20%">Quantidade</th>`
    + `<th style="width:30%">Requisitante</th>`
    + `</tr></thead><tbody><tr>`
    + `<td>${escapar(dados.requisicao.objetivando)}</td>`
    + `<td class="numero">${escapar(dados.valor.quantidadeTexto)}</td>`
    + `<td>${escapar(dados.requisitante)}</td>`
    + `</tr></tbody></table>`

    + `<table class="quadro"><thead><tr>`
    + `<th style="width:40%">Favorecido(a)</th>`
    + `<th style="width:32%">Dados Bancários</th>`
    + `<th>Valor (R$)</th>`
    + `</tr></thead><tbody><tr>`
    + `<td><span class="rotulo">Nome</span><b>${escapar(dados.servidor.nome)}</b>`
    + `<span class="rotulo">Endereço</span>${escapar(dados.servidor.endereco)}`
    + `<span class="rotulo">CNPJ/CPF</span>${escapar(dados.servidor.cpf)}</td>`
    + `<td><span class="rotulo">Banco</span>${escapar(dados.banco.banco)}`
    + `<span class="rotulo">Agência</span>${escapar(dados.banco.agencia)}`
    + `<span class="rotulo">Conta</span>${escapar(dados.banco.conta)}</td>`
    + `<td><b>${escapar(dados.valor.total)}</b>`
    + `<span class="rotulo">Valor por extenso</span>${escapar(dados.valor.extenso)}</td>`
    + `</tr></tbody></table>`

    + `<div class="autorizacao">`
    + `<div class="rotulo-caixa">Autorização da Prefeita</div>`
    + `<p><b>Ciente / Autorizo.</b></p>`
    + `<p>À ${escapar(SECRETARIA_DE_FINANCAS)}, para as providências de pagamento.</p>`
    + `<p class="local-data">${escapar(dados.localEData)}</p>`
    + `<div class="assinatura-unica"><strong>&nbsp;</strong>Assinatura da Prefeita</div>`
    + `<div class="linhas-a-mao">`
    + `<div>Nome:</div>`
    + `<div>CPF:</div>`
    + `<div>Cargo:</div>`
    + `</div>`
    + `</div>`

    + rodapeHtml(dados, indice, total)
    + `</div>`;
}

/** Página 3: PRESTAÇÃO DE CONTAS DE DIÁRIAS (sempre em folha nova). */
function folhaPrestacao(dados, indice, total) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_3, indice, total)
    + avisoHtml(dados)

    + `<h2>Relatório de Atividades</h2>`
    + `<div class="pautado">${escapar(dados.prestacao.relatorio)}</div>`

    + `<p class="fecho">Sem mais a acrescentar, subscrevo-me.</p>`
    + `<p class="fecho">Eis a prestação de contas, a qual submeto à apreciação e aprovação.</p>`

    + `<p class="local-data">${escapar(dados.prestacao.localEData)}</p>`

    + `<div class="assinatura-unica">`
    + `<strong>${escapar(dados.servidor.nome === SEM_REGISTRO ? "&nbsp;" : dados.servidor.nome)}</strong>`
    + `${escapar(dados.servidor.cargo === SEM_REGISTRO ? "Cargo do(a) servidor(a)" : dados.servidor.cargo)}`
    + `</div>`

    + rodapeHtml(dados, indice, total)
    + `</div>`;
}

const FOLHAS_HTML = {
  requisicao: folhaRequisicao,
  liquidacao: folhaLiquidacao,
  prestacao: folhaPrestacao,
};

/**
 * O documento inteiro em HTML: as três folhas em um só arquivo.
 *
 * É o MESMO HTML usado na pré-visualização da tela e na impressão -- o que se vê
 * antes de imprimir é o documento, não uma imitação dele.
 */
export function htmlDoProcesso(dados, { escopo = "completo" } = {}) {
  const folhas = folhasDoEscopo(escopo);
  const total = folhas.length;
  const corpo = folhas
    .map((folha, indice) => (FOLHAS_HTML[folha] ?? folhaRequisicao)(dados, indice + 1, total))
    .join("");

  const titulo = `Processo de Diária nº ${dados.numero}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>`
    + `<style>${estilos()}</style></head><body>${corpo}</body></html>`;
}

/** Imprime o processo em um quadro próprio, fora da árvore da página. */
export function imprimirProcesso(dados, { escopo = "completo" } = {}) {
  imprimirDocumentoHtml(htmlDoProcesso(dados, { escopo }));
}

/* -------------------------------------------------------------------------
 * PDF (arquivo único, três páginas)
 * ---------------------------------------------------------------------- */

/**
 * O BRASÃO NO PDF, em todas as páginas.
 *
 * Quando a tela conseguiu preparar a imagem (`dados.logo`), ela é inserida
 * RASTERIZADA EM ALTA RESOLUÇÃO -- 512 px no espaço de ~16 mm dão mais de 800
 * dpi, então não serrilha no papel nem na tela do PDF. A proporção original é
 * respeitada: a imagem é encaixada numa caixa quadrada de `lado`, e é o lado
 * MAIOR dela que toca a caixa, nunca os dois -- ela não estica nem achata.
 *
 * Sem imagem preparada (aba sem canvas, imagem inacessível, brasão em SVG que o
 * jsPDF não desenha), o brasão vetorial do repositório é desenhado com
 * primitivas do PDF. Assim a folha NUNCA sai sem brasão, e nada depende de link
 * externo na hora de gerar.
 *
 * @returns a largura efetivamente ocupada, para o cabeçalho posicionar o texto.
 */
function desenharBrasaoPdf(pdf, x, y, lado, dados = null) {
  const preparado = dados?.logo?.dataUrl ? dados.logo : null;
  if (preparado) {
    const proporcao = Number(preparado.proporcao)
      || (Number(preparado.largura) / Number(preparado.altura))
      || 1;
    const largura = proporcao >= 1 ? lado : lado * proporcao;
    const altura = proporcao >= 1 ? lado / proporcao : lado;
    try {
      pdf.addImage(preparado.dataUrl, "PNG", x, y + (lado - altura) / 2, largura, altura);
      return largura;
    } catch {
      // Imagem que o jsPDF recusou: cai no desenho vetorial abaixo.
    }
  }

  // O brasão do repositório, em primitivas. Traço escuro e cheio, para sair
  // legível também em IMPRESSORA PRETO E BRANCO.
  const u = lado / 512;
  const em = (v) => v * u;

  pdf.setFillColor(...TINTA.papel);
  pdf.setDrawColor(...TINTA.navy);
  pdf.setLineWidth(em(16));
  const escudo = [
    [em(392), 0],
    [0, em(190)],
    [0, em(98), em(-80), em(162), em(-196), em(206)],
    [em(-116), em(-44), em(-196), em(-108), em(-196), em(-206)],
    [0, em(-190)],
  ];
  pdf.lines(escudo, x + em(60), y + em(72), [1, 1], "FD", true);

  // A faixa escura do chefe do escudo.
  pdf.setFillColor(...TINTA.navy);
  pdf.rect(x + em(60), y + em(72), em(392), em(78), "F");

  // A estrela de cinco pontas, em dourado.
  const estrela = [
    [em(13), em(40)], [em(42), 0], [em(-34), em(25)], [em(13), em(40)],
    [em(-34), em(-25)], [em(-34), em(25)], [em(13), em(-40)], [em(-34), em(-25)], [em(42), 0],
  ];
  pdf.setFillColor(...TINTA.ouro);
  pdf.lines(estrela, x + em(256), y + em(78), [1, 1], "F", true);

  // As três linhas de água.
  pdf.setDrawColor(...TINTA.navy);
  pdf.setLineWidth(em(11));
  [200, 240, 280].forEach((base) => {
    pdf.line(x + em(104), y + em(base), x + em(408), y + em(base));
  });

  pdf.setFont("times", "bold");
  pdf.setFontSize(lado * 1.35);
  pdf.setTextColor(...TINTA.navy);
  pdf.text("SJL", x + lado / 2, y + em(398), { align: "center" });
  return lado;
}

/**
 * O desenhista de uma folha: mantém o cursor vertical, o rodapé institucional e
 * sabe abrir folha de continuação quando o conteúdo de uma página excede a
 * altura útil.
 *
 * Folha de continuação é a exceção, não a regra: no uso normal cada documento
 * do processo cabe na sua folha. Ela existe para NÃO cortar informação.
 */
function criarPincel(pdf, dados) {
  const largura = PAGINA.largura;
  const margem = PAGINA.margemLado;
  const util = largura - margem * 2;
  const limite = PAGINA.altura - PAGINA.margemBase - 4;
  const estado = { y: 0, titulo: "", pagina: 0, totalFolhas: 0, folhasUsadas: 0, recuo: 0 };

  // O recuo é o que permite desenhar conteúdo DENTRO de uma moldura sem que o
  // texto encoste na borda dela.
  const xEsq = () => margem + estado.recuo;
  const largUtil = () => util - estado.recuo * 2;

  // A identidade que ESTA folha imprime: a congelada do processo, ou a vigente.
  const identidade = normalizarIdentidade(dados?.identidade);

  /**
   * Escreve um texto institucional garantindo que ele CAIBA na largura dada.
   *
   * O órgão e as linhas do rodapé são configuráveis, então podem vir mais longos
   * que o padrão. Aqui a fonte diminui até caber, em vez de o texto invadir a
   * margem ou empurrar o conteúdo para uma segunda folha.
   */
  const textoQueCabe = (valor, xInicio, yLinha, tamanho, largMax, alinhamento = "left") => {
    let corpo = tamanho;
    pdf.setFontSize(corpo);
    while (corpo > 4.5 && pdf.getTextWidth(valor) > largMax) {
      corpo -= 0.25;
      pdf.setFontSize(corpo);
    }
    pdf.text(valor, xInicio, yLinha, alinhamento === "center" ? { align: "center" } : undefined);
    pdf.setFontSize(tamanho);
  };

  /** O rodapé institucional da prefeitura, em TODAS as folhas. */
  const rodapeInstitucional = () => {
    const y = PAGINA.altura - PAGINA.margemBase;
    pdf.setDrawColor(...TINTA.navy);
    pdf.setLineWidth(0.3);
    pdf.line(margem, y, largura - margem, y);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(...TINTA.navy);
    textoQueCabe(identidade.rodape_endereco, largura / 2, y + 3.4, 7, util, "center");

    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...TINTA.apoio);
    textoQueCabe(identidade.rodape_contato, largura / 2, y + 6.6, 7, util, "center");

    pdf.setFontSize(6.5);
    pdf.text(
      `Processo nº ${dados.numero} — Página ${estado.pagina} de ${estado.totalFolhas} — `
      + `Emitido em ${dados.emissao} por ${dados.emissor}`,
      largura / 2, y + 9.6, { align: "center" },
    );
  };

  const cabecalho = (continuacao) => {
    // O brasão sai em TODAS as folhas, discreto: 16 mm na folha do documento e
    // 10 mm na de continuação. A largura devolvida é a real, para que um brasão
    // mais estreito que alto não abra um vão no meio do cabeçalho.
    const lado = continuacao ? 10 : 16;
    const topo = PAGINA.margemTopo;
    const largBrasao = desenharBrasaoPdf(pdf, margem, topo, lado, dados);
    const x = margem + largBrasao + 4;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(continuacao ? 8 : 10);
    pdf.setTextColor(...TINTA.navy);
    textoQueCabe(identidade.orgao, x, topo + (continuacao ? 3.8 : 4.6), continuacao ? 8 : 10, largura - margem - x - 34);

    if (!continuacao) {
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TINTA.apoio);
      pdf.text(identidade.estado, x, topo + 8);
    }

    pdf.setFont("times", "bold");
    pdf.setFontSize(continuacao ? 9 : 13);
    pdf.setTextColor(...TINTA.navy);
    pdf.text(continuacao ? `${estado.titulo} (continuação)` : estado.titulo, x, topo + (continuacao ? 8 : 13.2));

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...TINTA.apoio);
    pdf.text("PROCESSO DE DIÁRIA Nº", largura - margem, topo + 3.4, { align: "right" });
    pdf.setFont("times", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(...TINTA.navy);
    pdf.text(dados.numero, largura - margem, topo + 8.2, { align: "right" });

    const base = topo + (continuacao ? 11 : 17.5);
    pdf.setDrawColor(...TINTA.navy);
    pdf.setLineWidth(continuacao ? 0.3 : 0.5);
    pdf.line(margem, base, largura - margem, base);
    estado.y = base + 4;
  };

  return {
    estado,
    largura,
    margem,
    util,
    limite,

    /** Abre a primeira folha de um documento do processo. */
    abrirPagina(titulo, pagina, totalFolhas) {
      if (estado.folhasUsadas > 0) pdf.addPage();
      estado.folhasUsadas += 1;
      estado.titulo = titulo;
      estado.pagina = pagina;
      estado.totalFolhas = totalFolhas;
      estado.recuo = 0;
      cabecalho(false);
    },

    /** Garante espaço; quando não há, abre folha de continuação. */
    espaco(necessario) {
      if (estado.y + necessario <= limite) return;
      rodapeInstitucional();
      pdf.addPage();
      estado.folhasUsadas += 1;
      estado.pagina += 1;
      estado.totalFolhas += 1;
      cabecalho(true);
    },

    fecharPagina() {
      rodapeInstitucional();
    },

    /** Empurra o cursor para baixo (o respiro entre blocos do formulário). */
    respiro(altura = 3) {
      estado.y += altura;
    },

    secao(rotulo) {
      this.espaco(12);
      pdf.setFillColor(...TINTA.navy);
      pdf.rect(xEsq(), estado.y, largUtil(), 5, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(...TINTA.branco);
      pdf.text(String(rotulo).toUpperCase(), xEsq() + 2, estado.y + 3.5);
      estado.y += 7;
    },

    /** Um parágrafo corrido do formulário. */
    paragrafo(conteudo, { negrito = false, tamanho = 10, centralizado = false } = {}) {
      const entre = tamanho * 0.48;
      const linhas = pdf.splitTextToSize(String(conteudo ?? ""), largUtil());
      this.espaco(linhas.length * entre + 2);
      pdf.setFont("helvetica", negrito ? "bold" : "normal");
      pdf.setFontSize(tamanho);
      pdf.setTextColor(...TINTA.navy);
      linhas.forEach((linha, indice) => {
        if (centralizado) {
          pdf.text(linha, largura / 2, estado.y + entre * 0.8 + indice * entre, { align: "center" });
        } else {
          pdf.text(linha, xEsq(), estado.y + entre * 0.8 + indice * entre);
        }
      });
      estado.y += linhas.length * entre + 2;
    },

    /**
     * Uma linha do formulário: rótulo em negrito e o valor sobre a linha
     * pontilhada, como em "Requisita: ___ Diária(s) ...".
     */
    linha(rotulo, valor, { destaque = false } = {}) {
      const entre = 4.8;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      const largRotulo = pdf.getTextWidth(`${rotulo} `);
      pdf.setFont("helvetica", destaque ? "bold" : "normal");
      const linhas = pdf.splitTextToSize(String(valor ?? ""), largUtil() - largRotulo);
      const altura = Math.max(1, linhas.length) * entre;
      this.espaco(altura + 2);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(...TINTA.navy);
      pdf.text(rotulo, xEsq(), estado.y + 3.4);

      pdf.setFont("helvetica", destaque ? "bold" : "normal");
      pdf.setDrawColor(...TINTA.linha);
      pdf.setLineWidth(0.2);
      const total = Math.max(1, linhas.length);
      for (let indice = 0; indice < total; indice += 1) {
        const y = estado.y + 3.4 + indice * entre;
        pdf.text(linhas[indice] ?? "", xEsq() + largRotulo, y);
        pdf.line(xEsq() + largRotulo, y + 1.2, xEsq() + largUtil(), y + 1.2);
      }

      estado.y += altura + 2;
    },

    /** Uma faixa de campos rotulados, em colunas proporcionais. */
    campos(itens) {
      const altura = 9;
      this.espaco(altura + 2);
      let x = xEsq();
      pdf.setDrawColor(...TINTA.linha);
      pdf.setLineWidth(0.2);

      itens.forEach((item) => {
        const larguraCampo = largUtil() * (item.largura ?? 1 / itens.length);
        pdf.rect(x, estado.y, larguraCampo, altura);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6.5);
        pdf.setTextColor(...TINTA.apoio);
        pdf.text(String(item.rotulo).toUpperCase(), x + 1.8, estado.y + 3);

        pdf.setFont("helvetica", item.destaque ? "bold" : "normal");
        pdf.setFontSize(9.5);
        pdf.setTextColor(...TINTA.navy);
        const cabe = pdf.splitTextToSize(String(item.valor ?? SEM_REGISTRO), larguraCampo - 3.6)[0] ?? "";
        pdf.text(cabe, x + 1.8, estado.y + 7);

        x += larguraCampo;
      });

      estado.y += altura + 1.5;
    },

    /**
     * Um quadro do formulário: cabeçalho das colunas e UMA linha de conteúdo.
     *
     * É o quadro de valores da página 1 ("Quantidade | Valor da(s) Diária(s) R$
     * | Valor por Extenso") e os dois quadros da página 2.
     */
    quadro(colunas) {
      const alturaCabecalho = 6;
      const entre = 3.9;

      // Cada célula pode ter várias partes rotuladas (o favorecido tem nome,
      // endereço e CPF empilhados); a altura da linha é a da maior delas.
      const preparadas = colunas.map((coluna) => {
        const larguraColuna = largUtil() * (coluna.largura ?? 1 / colunas.length);
        const partes = (coluna.partes ?? [{ valor: coluna.valor, negrito: coluna.negrito }]).map((parte) => ({
          rotulo: texto(parte.rotulo),
          negrito: parte.negrito === true,
          linhas: pdf.splitTextToSize(String(parte.valor ?? SEM_REGISTRO), larguraColuna - 4),
        }));
        const alturaConteudo = partes.reduce(
          (soma, parte) => soma + (parte.rotulo !== "" ? 2.9 : 0) + parte.linhas.length * entre,
          0,
        );
        return { larguraColuna, partes, alturaConteudo };
      });

      const alturaLinha = Math.max(9, ...preparadas.map((c) => c.alturaConteudo + 3.4));
      this.espaco(alturaCabecalho + alturaLinha + 3);

      // Cabeçalho.
      let x = xEsq();
      pdf.setFillColor(...TINTA.faixa);
      pdf.rect(xEsq(), estado.y, largUtil(), alturaCabecalho, "F");
      pdf.setDrawColor(...TINTA.navy);
      pdf.setLineWidth(0.25);
      preparadas.forEach((coluna, indice) => {
        pdf.rect(x, estado.y, coluna.larguraColuna, alturaCabecalho);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7.5);
        pdf.setTextColor(...TINTA.navy);
        pdf.text(String(colunas[indice].rotulo).toUpperCase(), x + 2, estado.y + 4);
        x += coluna.larguraColuna;
      });
      estado.y += alturaCabecalho;

      // Conteúdo.
      x = xEsq();
      preparadas.forEach((coluna) => {
        pdf.rect(x, estado.y, coluna.larguraColuna, alturaLinha);
        let y = estado.y + 3.6;
        coluna.partes.forEach((parte) => {
          if (parte.rotulo !== "") {
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(6.5);
            pdf.setTextColor(...TINTA.apoio);
            pdf.text(parte.rotulo.toUpperCase(), x + 2, y);
            y += 2.9;
          }
          pdf.setFont("helvetica", parte.negrito ? "bold" : "normal");
          pdf.setFontSize(9.5);
          pdf.setTextColor(...TINTA.navy);
          parte.linhas.forEach((linha) => {
            pdf.text(linha, x + 2, y);
            y += entre;
          });
        });
        x += coluna.larguraColuna;
      });
      estado.y += alturaLinha + 2;
    },

    /**
     * O RELATÓRIO DE ATIVIDADES: um quadro PAUTADO, com as linhas impressas.
     *
     * As linhas saem no papel para o relatório poder ser escrito à mão quando a
     * prestação de contas ainda não foi digitada -- e o texto já digitado
     * assenta sobre elas, porque a entrelinha é a distância entre as linhas.
     */
    pautado(conteudo, { linhas: minimoDeLinhas = 16 } = {}) {
      const valor = texto(conteudo);
      const escritas = valor === "" ? [] : pdf.splitTextToSize(valor, largUtil() - 5);
      const quantas = Math.max(minimoDeLinhas, escritas.length);
      const altura = quantas * PAUTA + 2;
      this.espaco(altura + 3);

      pdf.setDrawColor(...TINTA.linha);
      pdf.setLineWidth(0.2);
      pdf.rect(xEsq(), estado.y, largUtil(), altura);

      for (let indice = 0; indice < quantas; indice += 1) {
        const y = estado.y + 1 + (indice + 1) * PAUTA;
        pdf.line(xEsq() + 2, y, xEsq() + largUtil() - 2, y);
      }

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(...TINTA.navy);
      escritas.forEach((linha, indice) => {
        pdf.text(linha, xEsq() + 2.5, estado.y + 1 + (indice + 1) * PAUTA - 1.4);
      });

      estado.y += altura + 2;
    },

    /** "São José da Laje - AL, 10 de março de 2026", centralizado. */
    localData(conteudo) {
      this.espaco(12);
      this.respiro(5);
      this.paragrafo(conteudo, { centralizado: true });
    },

    /** Área de assinaturas lado a lado, como no papel. */
    assinaturas(nomes, { aoPe = true } = {}) {
      const altura = 14;
      this.espaco(altura + 4);
      // Se ainda há folga, as assinaturas descem para perto do rodapé.
      const piso = limite - altura;
      if (aoPe && estado.y < piso) estado.y = piso;
      else estado.y += 8;

      const larguraCampo = (largUtil() - 6 * (nomes.length - 1)) / nomes.length;
      let x = xEsq();
      nomes.forEach((item) => {
        pdf.setDrawColor(...TINTA.navy);
        pdf.setLineWidth(0.3);
        pdf.line(x, estado.y, x + larguraCampo, estado.y);

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        pdf.setTextColor(...TINTA.navy);
        pdf.text(texto(item.nome) === SEM_REGISTRO ? " " : (texto(item.nome) || " "),
          x + larguraCampo / 2, estado.y + 3.4, { align: "center" });

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.setTextColor(...TINTA.apoio);
        pdf.text(item.papel, x + larguraCampo / 2, estado.y + 7, { align: "center" });

        x += larguraCampo + 6;
      });
      estado.y += altura;
    },

    /** Linhas rotuladas para completar à mão (Nome, CPF, Cargo). */
    linhasAMao(rotulos) {
      rotulos.forEach((rotulo) => {
        this.espaco(8);
        estado.y += 5;
        pdf.setDrawColor(...TINTA.apoio);
        pdf.setLineWidth(0.2);
        pdf.line(xEsq(), estado.y, xEsq() + largUtil(), estado.y);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(...TINTA.apoio);
        pdf.text(rotulo, xEsq() + 1, estado.y - 1.2);
      });
      estado.y += 2;
    },

    /**
     * Uma moldura em volta de um bloco do formulário (a autorização da
     * prefeita). O conteúdo é desenhado com recuo, para não encostar na borda.
     */
    moldura(rotulo, desenhar) {
      this.espaco(60);
      const inicio = estado.y;
      estado.recuo = 3;
      estado.y += 3;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TINTA.apoio);
      pdf.text(String(rotulo).toUpperCase(), xEsq(), estado.y + 2.6);
      estado.y += 5;

      desenhar();

      estado.y += 3;
      pdf.setDrawColor(...TINTA.navy);
      pdf.setLineWidth(0.35);
      pdf.rect(margem, inicio, util, estado.y - inicio);
      estado.recuo = 0;
      estado.y += 2;
    },

    aviso(mensagem) {
      if (!mensagem) return;
      const linhas = pdf.splitTextToSize(mensagem, largUtil() - 4);
      const altura = linhas.length * 3.4 + 3.4;
      this.espaco(altura + 2);
      pdf.setDrawColor(...TINTA.navy);
      pdf.setLineWidth(0.35);
      pdf.rect(xEsq(), estado.y, largUtil(), altura);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TINTA.navy);
      linhas.forEach((linha, indice) => pdf.text(linha, xEsq() + 2, estado.y + 3.6 + indice * 3.4));
      estado.y += altura + 1.5;
    },
  };
}

function textoDoAviso(dados) {
  if (dados.cancelado) {
    const motivo = dados.motivoCancelamento ? ` Motivo: ${dados.motivoCancelamento}.` : "";
    return `PROCESSO CANCELADO.${motivo} O registro, a numeração e o histórico foram preservados.`;
  }
  if (dados.rascunho) return "RASCUNHO. Documento ainda não finalizado — sujeito a alteração.";
  return "";
}

/** Página 1: REQUISIÇÃO DE DIÁRIAS. */
function paginaRequisicaoPdf(pincel, dados, pagina, total) {
  pincel.abrirPagina(TITULO_PAGINA_1, pagina, total);
  pincel.aviso(textoDoAviso(dados));

  pincel.respiro(2);
  pincel.paragrafo(
    `O(a) servidor(a) abaixo identificado(a), na conformidade da ${dados.requisicao.lei}`,
  );

  pincel.respiro(1);
  pincel.linha(
    "Requisita:",
    `${dados.requisicao.quantidade} Diária(s) destinada(s) ao custeio de despesas ${dados.requisicao.custeio}`,
  );
  pincel.linha("Objetivando:", dados.requisicao.objetivando);
  pincel.linha("Data da(s) Diária(s):", dados.requisicao.dataDiarias);

  pincel.secao("Identificação do Servidor");
  pincel.campos([
    { rotulo: "Nome", valor: dados.servidor.nome, largura: 0.66 },
    { rotulo: "CPF", valor: dados.servidor.cpf, largura: 0.34 },
  ]);
  pincel.campos([{ rotulo: "Endereço", valor: dados.servidor.endereco, largura: 1 }]);
  pincel.campos([
    { rotulo: "Secretaria", valor: dados.servidor.secretaria, largura: 0.5 },
    { rotulo: "Cargo", valor: dados.servidor.cargo, largura: 0.5 },
  ]);
  pincel.campos([
    { rotulo: "Horário de Saída", valor: dados.servidor.horarioSaida, largura: 0.5 },
    { rotulo: "Tipo de Diária", valor: dados.servidor.tipoDiaria, largura: 0.5 },
  ]);

  pincel.respiro(2);
  pincel.quadro([
    { rotulo: "Quantidade", valor: dados.valor.quantidade, negrito: true, largura: 0.2 },
    { rotulo: "Valor da(s) Diária(s) R$", valor: dados.valor.totalSimples, negrito: true, largura: 0.28 },
    { rotulo: "Valor por Extenso", valor: dados.valor.extenso, largura: 0.52 },
  ]);

  pincel.localData(dados.localEData);
  pincel.assinaturas([
    { nome: dados.servidor.nome, papel: "Assinatura do Servidor" },
    { nome: "", papel: "Responsável pela Secretaria" },
    { nome: "", papel: "Assinatura da Prefeita" },
  ]);
  pincel.fecharPagina();
}

/** Página 2: LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO. */
function paginaLiquidacaoPdf(pincel, dados, pagina, total) {
  pincel.abrirPagina(TITULO_PAGINA_2, pagina, total);
  pincel.aviso(textoDoAviso(dados));

  pincel.respiro(2);
  pincel.linha("Requisitante:", dados.requisitante);

  pincel.respiro(2);
  pincel.paragrafo("A Senhora Prefeita", { negrito: true });
  pincel.respiro(1);
  pincel.paragrafo(
    "Pelo presente, venho solicitar AUTORIZAÇÃO de pagamento em favor do(a) beneficiário(a) abaixo "
    + "identificado(a), o(a) qual: Realizou viagens e/ou deslocamentos, conforme descrito abaixo, e que ATESTO "
    + "a necessidade e a realização das mesmas.",
  );

  pincel.secao("Quadro Resumo");
  pincel.quadro([
    { rotulo: "Objetivando", valor: dados.requisicao.objetivando, largura: 0.5 },
    { rotulo: "Quantidade", valor: dados.valor.quantidadeTexto, negrito: true, largura: 0.2 },
    { rotulo: "Requisitante", valor: dados.requisitante, largura: 0.3 },
  ]);

  pincel.respiro(2);
  pincel.quadro([
    {
      rotulo: "Favorecido(a)",
      largura: 0.4,
      partes: [
        { rotulo: "Nome", valor: dados.servidor.nome, negrito: true },
        { rotulo: "Endereço", valor: dados.servidor.endereco },
        { rotulo: "CNPJ/CPF", valor: dados.servidor.cpf },
      ],
    },
    {
      rotulo: "Dados Bancários",
      largura: 0.32,
      partes: [
        { rotulo: "Banco", valor: dados.banco.banco },
        { rotulo: "Agência", valor: dados.banco.agencia },
        { rotulo: "Conta", valor: dados.banco.conta },
      ],
    },
    {
      rotulo: "Valor (R$)",
      largura: 0.28,
      partes: [
        { valor: dados.valor.total, negrito: true },
        { rotulo: "Valor por extenso", valor: dados.valor.extenso },
      ],
    },
  ]);

  pincel.moldura("Autorização da Prefeita", () => {
    pincel.paragrafo("Ciente / Autorizo.", { negrito: true });
    pincel.paragrafo(`À ${SECRETARIA_DE_FINANCAS}, para as providências de pagamento.`);
    pincel.localData(dados.localEData);
    pincel.assinaturas([{ nome: "", papel: "Assinatura da Prefeita" }], { aoPe: false });
    pincel.linhasAMao(["Nome:", "CPF:", "Cargo:"]);
  });

  pincel.fecharPagina();
}

/** Página 3: PRESTAÇÃO DE CONTAS DE DIÁRIAS. */
function paginaPrestacaoPdf(pincel, dados, pagina, total) {
  pincel.abrirPagina(TITULO_PAGINA_3, pagina, total);
  pincel.aviso(textoDoAviso(dados));

  pincel.secao("Relatório de Atividades");
  pincel.pautado(dados.prestacao.relatorio);

  pincel.respiro(2);
  pincel.paragrafo("Sem mais a acrescentar, subscrevo-me.");
  pincel.paragrafo("Eis a prestação de contas, a qual submeto à apreciação e aprovação.");

  pincel.localData(dados.prestacao.localEData);
  pincel.assinaturas([
    {
      nome: dados.servidor.nome,
      papel: dados.servidor.cargo === SEM_REGISTRO ? "Cargo do(a) servidor(a)" : dados.servidor.cargo,
    },
  ]);
  pincel.fecharPagina();
}

const FOLHAS_PDF = {
  requisicao: paginaRequisicaoPdf,
  liquidacao: paginaLiquidacaoPdf,
  prestacao: paginaPrestacaoPdf,
};

/**
 * O PDF do processo: UM ÚNICO ARQUIVO com as três páginas.
 *
 * Desenhado com as primitivas do jsPDF, em milímetros sobre A4 -- não é imagem
 * da tela. Cada documento entra por `addPage()` incondicional, então a
 * Liquidação e a Prestação de Contas SEMPRE começam em página nova.
 */
export function montarPdfDoProcesso(dados, { escopo = "completo" } = {}) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const folhas = folhasDoEscopo(escopo);
  const pincel = criarPincel(pdf, dados);

  folhas.forEach((folha, indice) => {
    (FOLHAS_PDF[folha] ?? paginaRequisicaoPdf)(pincel, dados, indice + 1, folhas.length);
  });

  return pdf;
}

/** Gera e baixa o PDF. */
export function gerarPdfDoProcesso(dados, { escopo = "completo" } = {}) {
  const pdf = montarPdfDoProcesso(dados, { escopo });
  pdf.save(nomeDoArquivo(dados, "pdf", escopo));
}
