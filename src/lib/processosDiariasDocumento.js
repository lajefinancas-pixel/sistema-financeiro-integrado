// O documento do Processo de Diária: as DUAS páginas, em impressão e em PDF.
//
// Não é captura de tela: é um documento com layout próprio, A4 retrato, com
// cabeçalho institucional, identificação do processo, conteúdo em blocos,
// totais, área de assinaturas e rodapé com a numeração das folhas.
//
// PAGINAÇÃO. A Solicitação começa na página 1 e a Liquidação SEMPRE começa em
// folha nova, independentemente do tamanho do conteúdo -- na impressão pelo
// `page-break-after` da folha, no PDF por um `addPage()` incondicional. No uso
// normal o processo sai em exatamente duas páginas; conteúdo excepcionalmente
// grande (uma finalidade de vinte linhas) transborda para uma folha a mais em
// vez de ser cortado: informação do documento não é truncada para forçar duas
// páginas.
//
// O DOCUMENTO NÃO É FINANCEIRO. Imprimir ou gerar o PDF não debita conta, não
// dá baixa em NF, não altera saldo e não cria pagamento. A página 2 chama-se
// "Solicitação de Liquidação da Diária" porque é o nome do formulário: é papel.

import { jsPDF } from "jspdf";
import { formatBRL, formatBRLSimples, paraNumeroMoeda } from "./moeda.js";
import { imprimirDocumentoHtml } from "./impressaoNavegador.js";
import {
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  TRANSPORTES,
  dataBR,
  dataHoraBR,
  nomeDaSecretaria,
  numeroDoProcesso,
  quantidadeDeDiarias,
  situacaoInfo,
  transporteRotulo,
  valorNaLiquidacao,
} from "./processosDiarias.js";

/**
 * Identidade institucional, a mesma de relatoriosCabecalho.INSTITUICAO e do topo
 * da barra lateral. Repetida como texto porque este arquivo é carregado direto
 * pelos testes, sem o resolvedor de módulos do Vite.
 */
export const IDENTIDADE = {
  orgao: "SECRETARIA DE FINANÇAS",
  lema: "GESTÃO QUE TRANSFORMA",
};

export const SEM_REGISTRO = "--";

/** Os três escopos de saída: o processo completo ou uma página só. */
export const ESCOPOS = [
  { id: "completo", rotulo: "Processo completo (2 páginas)" },
  { id: "solicitacao", rotulo: "Somente a Solicitação" },
  { id: "liquidacao", rotulo: "Somente a Liquidação" },
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

// A4 retrato com margens enxutas: é o que faz o processo caber em duas folhas
// sem apertar a leitura.
const PAGINA = { largura: 210, altura: 297, margemTopo: 10, margemBase: 12, margemLado: 13 };

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

function quantidadeTexto(valor) {
  const numero = quantidadeDeDiarias(valor);
  if (numero <= 0) return SEM_REGISTRO;
  const formatado = Number.isInteger(numero) ? String(numero) : numero.toFixed(1).replace(".", ",");
  return `${formatado} ${numero === 1 ? "diária" : "diárias"}`;
}

/**
 * Tudo o que as duas páginas mostram, lido UMA VEZ do processo.
 *
 * Os dados compartilhados aparecem nas duas páginas porque são os mesmos dados
 * -- não há cópia aqui, só leitura do mesmo registro. Os campos espelhados da
 * liquidação passam por `valorNaLiquidacao`: mostram o que a liquidação
 * informou, ou o que a solicitação diz enquanto ela não informou nada diferente.
 */
export function dadosDoDocumento(processo, { secretarias = [], emissor = "", emissao = null } = {}) {
  const p = processo ?? {};
  return {
    numero: numeroDoProcesso(p) || SEM_REGISTRO,
    situacao: situacaoInfo(p.situacao).rotulo,
    cancelado: texto(p.situacao) === "cancelada",
    rascunho: texto(p.situacao) === "rascunho",
    motivoCancelamento: texto(p.motivo_cancelamento),
    data: dataBR(p.data_processo) || SEM_REGISTRO,
    secretaria: ou(nomeDaSecretaria(p, secretarias)),
    emissao: emissao || agoraBR(),
    emissor: ou(emissor),

    beneficiario: {
      nome: ou(p.beneficiario_nome),
      cpf: ou(p.beneficiario_cpf),
      matricula: ou(p.beneficiario_matricula),
      cargo: ou(p.beneficiario_cargo),
      lotacao: ou(p.beneficiario_lotacao),
    },

    viagem: {
      destino: ou(p.destino),
      saida: ou(dataHoraBR(p.data_saida, p.hora_saida)),
      retorno: ou(dataHoraBR(p.data_retorno, p.hora_retorno)),
      quantidade: quantidadeTexto(p.quantidade_diarias),
      unitario: moeda(p.valor_unitario),
      unitarioSimples: moedaSimples(p.valor_unitario),
      total: moeda(p.valor_total),
      totalSimples: moedaSimples(p.valor_total),
    },

    objeto: ou(p.objeto),
    finalidade: ou(p.finalidade),
    transporteEscolhido: texto(p.transporte),
    transporte: ou(transporteRotulo(p)),
    observacoes: ou(p.observacoes),

    banco: {
      banco: ou(p.banco),
      agencia: ou(p.agencia),
      conta: ou(p.conta),
      pix: ou(p.pix),
      titular: ou(p.titular),
    },

    liquidacao: {
      data: ou(dataBR(p.liquidacao_data)),
      saida: ou(dataBR(valorNaLiquidacao(p, "liquidacao_data_saida"))),
      retorno: ou(dataBR(valorNaLiquidacao(p, "liquidacao_data_retorno"))),
      quantidade: quantidadeTexto(valorNaLiquidacao(p, "liquidacao_quantidade")),
      valor: moeda(valorNaLiquidacao(p, "liquidacao_valor")),
      valorSimples: moedaSimples(valorNaLiquidacao(p, "liquidacao_valor")),
      relatorio: ou(p.liquidacao_relatorio),
      documentos: ou(p.liquidacao_documentos),
      responsavel: ou(p.liquidacao_responsavel),
      observacoes: ou(p.liquidacao_observacoes),
    },
  };
}

/** As folhas que a saída vai ter, na ordem. */
export function folhasDoEscopo(escopo) {
  if (escopo === "solicitacao") return ["solicitacao"];
  if (escopo === "liquidacao") return ["liquidacao"];
  return ["solicitacao", "liquidacao"];
}

/** "processo-diaria-0001-2026.pdf" */
export function nomeDoArquivo(dados, extensao = "pdf", escopo = "completo") {
  const numero = String(dados?.numero ?? "").replace("/", "-").replace(/[^\w-]/g, "");
  const sufixo = escopo === "solicitacao" ? "-solicitacao" : escopo === "liquidacao" ? "-liquidacao" : "";
  return `processo-diaria-${numero || "sem-numero"}${sufixo}.${extensao}`;
}

/* -------------------------------------------------------------------------
 * Impressão (HTML)
 * ---------------------------------------------------------------------- */

// O brasão da Secretaria, o mesmo de public/brasao.svg, embutido no documento
// para que a folha nunca saia sem ele por causa de uma imagem que não carregou.
function brasaoSvg(lado) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}mm" height="${lado}mm" viewBox="0 0 512 512" role="img" aria-label="Brasão da Secretaria de Finanças">`
    + `<rect width="512" height="512" rx="48" fill="#0F2A44"/>`
    + `<g transform="translate(76,64) scale(3)">`
    + `<path d="M60 6 L63 15 L72 15 L65 21 L67 30 L60 25 L53 30 L55 21 L48 15 L57 15 Z" fill="#C9A227"/>`
    + `<path d="M60 22 L92 32 V70 C92 96 78 112 60 122 C42 112 28 96 28 70 V32 Z" fill="#FBFAF7" stroke="#0F2A44" stroke-width="3.5"/>`
    + `<text x="60" y="82" text-anchor="middle" font-size="46" font-style="italic" font-family="Georgia, 'Times New Roman', serif" fill="#0F2A44">F</text>`
    + `</g></svg>`;
}

function estilos() {
  return `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { color: ${COR.navy}; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; line-height: 1.3;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    /* A folha tem a altura da página e sempre quebra depois: é isto que faz a
       Liquidação começar em folha nova, qualquer que seja o tamanho do conteúdo.
       A altura é MÍNIMA, não fixa -- conteúdo excepcional transborda para uma
       folha a mais em vez de ser cortado. */
    .folha { position: relative; width: ${PAGINA.largura}mm; min-height: ${PAGINA.altura}mm;
      padding: ${PAGINA.margemTopo}mm ${PAGINA.margemLado}mm ${PAGINA.margemBase + 8}mm;
      page-break-after: always; break-after: page; }
    .folha:last-child { page-break-after: auto; break-after: auto; }

    .cabecalho { display: flex; align-items: center; gap: 4mm; border-bottom: 1.4pt solid ${COR.navy}; padding-bottom: 2mm; }
    .cabecalho svg { display: block; flex: 0 0 auto; }
    .orgao { font-size: 9pt; font-weight: bold; letter-spacing: .14em; }
    .lema { margin-top: .4mm; color: ${COR.ouro}; font-size: 6.5pt; font-weight: bold; letter-spacing: .18em; }
    .titulo { margin: 1mm 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 13pt; letter-spacing: .01em; }
    .selo { margin-left: auto; text-align: right; font-size: 7.5pt; color: ${COR.apoio}; white-space: nowrap; }
    .selo strong { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 12pt; color: ${COR.navy}; }
    .pagina-de { font-size: 6.5pt; letter-spacing: .1em; text-transform: uppercase; }

    .identificacao { display: flex; gap: 3mm; margin-top: 2.5mm; }
    .identificacao div { flex: 1; border: .5pt solid ${COR.linha}; background: ${COR.faixa}; padding: 1.4mm 2mm; overflow: hidden; }
    .identificacao span { display: block; font-size: 6.5pt; letter-spacing: .08em; text-transform: uppercase; color: ${COR.apoio}; }
    .identificacao strong { font-size: 9pt; }

    .aviso { margin-top: 2.5mm; border: .8pt solid ${COR.navy}; padding: 1.6mm 2mm; font-size: 7.5pt; }
    .aviso strong { letter-spacing: .06em; text-transform: uppercase; }

    h2 { margin: 3.5mm 0 1.4mm; padding: 1.1mm 2mm; background: ${COR.navy}; color: #fff; font-size: 7.5pt;
      font-weight: bold; letter-spacing: .1em; text-transform: uppercase; }

    .grade { display: flex; flex-wrap: wrap; border: .5pt solid ${COR.linha}; border-bottom: 0; }
    .campo { border-bottom: .5pt solid ${COR.linha}; border-right: .5pt solid ${COR.linha}; padding: 1.3mm 2mm; overflow: hidden; }
    .campo:last-child { border-right: 0; }
    .campo .rotulo { display: block; font-size: 6.3pt; letter-spacing: .08em; text-transform: uppercase; color: ${COR.apoio}; }
    .campo .valor { display: block; font-size: 9pt; overflow-wrap: break-word; }
    .campo.destaque .valor { font-weight: bold; }
    .c100 { width: 100%; border-right: 0; }
    .c50 { width: 50%; }
    .c33 { width: 33.34%; }
    .c25 { width: 25%; }
    .c67 { width: 66.66%; }
    /* Fim de linha da grade: sem borda à direita, para o quadro fechar reto. */
    .fim { border-right: 0; }

    .texto { border: .5pt solid ${COR.linha}; padding: 1.8mm 2mm; min-height: 16mm; font-size: 9pt;
      white-space: pre-wrap; overflow-wrap: break-word; }
    .texto.curto { min-height: 11mm; }

    .transportes { display: flex; flex-wrap: wrap; gap: 2mm 5mm; border: .5pt solid ${COR.linha}; padding: 1.8mm 2mm; font-size: 8.5pt; }
    .transportes span { display: inline-flex; align-items: center; gap: 1.4mm; }
    .caixa { display: inline-block; width: 3.2mm; height: 3.2mm; border: .7pt solid ${COR.navy}; text-align: center;
      line-height: 3mm; font-size: 7pt; font-weight: bold; }

    .total { display: flex; align-items: center; justify-content: flex-end; gap: 4mm; margin-top: 2mm;
      background: ${COR.navy}; color: #fff; padding: 2mm 2.5mm; }
    .total span { font-size: 8pt; font-weight: bold; letter-spacing: .1em; text-transform: uppercase; }
    .total strong { font-size: 13pt; }

    .declaracao { margin-top: 3mm; font-size: 8pt; text-align: justify; color: ${COR.apoio}; }

    .assinaturas { display: flex; gap: 6mm; margin-top: 9mm; }
    .assinaturas div { flex: 1; border-top: .7pt solid ${COR.navy}; padding-top: 1.4mm; text-align: center;
      font-size: 7.5pt; color: ${COR.apoio}; }
    .assinaturas strong { display: block; font-size: 8pt; color: ${COR.navy}; }

    .rodape { position: absolute; left: ${PAGINA.margemLado}mm; right: ${PAGINA.margemLado}mm; bottom: 6mm;
      display: flex; justify-content: space-between; gap: 6mm; border-top: .5pt solid ${COR.linha};
      padding-top: 1.2mm; color: ${COR.apoio}; font-size: 6.8pt; }
    .rodape span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
}

function cabecalhoHtml(dados, titulo, indice, total) {
  return `<div class="cabecalho">${brasaoSvg(15)}`
    + `<div><div class="orgao">${escapar(IDENTIDADE.orgao)}</div>`
    + `<div class="lema">${escapar(IDENTIDADE.lema)}</div>`
    + `<div class="titulo">${escapar(titulo)}</div></div>`
    + `<div class="selo"><span class="pagina-de">Processo de diária nº</span><strong>${escapar(dados.numero)}</strong>`
    + `<span class="pagina-de">Página ${indice} de ${total}</span></div>`
    + `</div>`;
}

function identificacaoHtml(dados) {
  return `<div class="identificacao">`
    + `<div><span>Data do processo</span><strong>${escapar(dados.data)}</strong></div>`
    + `<div><span>Secretaria</span><strong>${escapar(dados.secretaria)}</strong></div>`
    + `<div><span>Situação do documento</span><strong>${escapar(dados.situacao)}</strong></div>`
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

function campo(rotulo, valor, classe = "c50", destaque = false) {
  return `<div class="campo ${classe}${destaque ? " destaque" : ""}">`
    + `<span class="rotulo">${escapar(rotulo)}</span>`
    + `<span class="valor">${escapar(valor)}</span></div>`;
}

function transportesHtml(dados) {
  const itens = TRANSPORTES.map((opcao) => {
    const marcado = dados.transporteEscolhido === opcao.id;
    const rotulo = opcao.id === "outro" && marcado && dados.transporte !== SEM_REGISTRO
      ? dados.transporte
      : opcao.rotulo;
    return `<span><i class="caixa">${marcado ? "X" : ""}</i>${escapar(rotulo)}</span>`;
  }).join("");
  return `<div class="transportes">${itens}</div>`;
}

function rodapeHtml(dados, titulo, indice, total) {
  return `<div class="rodape">`
    + `<span>${escapar(titulo)} — Processo nº ${escapar(dados.numero)} — ${escapar(dados.secretaria)}</span>`
    + `<span>Emitido em ${escapar(dados.emissao)} por ${escapar(dados.emissor)} — Página ${indice} de ${total}</span>`
    + `</div>`;
}

/** Página 1: SOLICITAÇÃO DE DIÁRIA. */
function folhaSolicitacao(dados, indice, total) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_1, indice, total)
    + identificacaoHtml(dados)
    + avisoHtml(dados)

    + `<h2>1. Beneficiário</h2>`
    + `<div class="grade">`
    + campo("Nome", dados.beneficiario.nome, "c67")
    + campo("CPF", dados.beneficiario.cpf, "c33 fim")
    + campo("Matrícula", dados.beneficiario.matricula, "c25")
    + campo("Cargo / função", dados.beneficiario.cargo, "c25")
    + campo("Secretaria", dados.secretaria, "c25")
    + campo("Lotação", dados.beneficiario.lotacao, "c25 fim")
    + `</div>`

    + `<h2>2. Viagem</h2>`
    + `<div class="grade">`
    + campo("Destino", dados.viagem.destino, "c100")
    + campo("Data e hora de saída", dados.viagem.saida, "c50")
    + campo("Data e hora de retorno", dados.viagem.retorno, "c50 fim")
    + campo("Quantidade de diárias", dados.viagem.quantidade, "c33", true)
    + campo("Valor unitário", dados.viagem.unitario, "c33", true)
    + campo("Valor total", dados.viagem.total, "c33 fim", true)
    + `</div>`

    + `<h2>3. Objeto / finalidade da viagem</h2>`
    + (dados.objeto !== SEM_REGISTRO
      ? `<div class="grade"><div class="campo c100"><span class="rotulo">Objeto</span><span class="valor">${escapar(dados.objeto)}</span></div></div>`
      : "")
    + `<div class="texto">${escapar(dados.finalidade)}</div>`

    + `<h2>4. Meio de transporte</h2>`
    + transportesHtml(dados)

    + `<h2>5. Dados bancários para crédito</h2>`
    + `<div class="grade">`
    + campo("Banco", dados.banco.banco, "c33")
    + campo("Agência", dados.banco.agencia, "c33")
    + campo("Conta", dados.banco.conta, "c33 fim")
    + campo("Chave PIX", dados.banco.pix, "c50")
    + campo("Titular", dados.banco.titular, "c50 fim")
    + `</div>`

    + `<h2>6. Observações</h2>`
    + `<div class="texto curto">${escapar(dados.observacoes === SEM_REGISTRO ? "" : dados.observacoes)}</div>`

    + `<div class="total"><span>Valor total da diária</span><strong>${escapar(dados.viagem.total)}</strong></div>`

    + `<div class="declaracao">Declaro que as informações acima são verdadeiras e que a viagem se destina exclusivamente ao interesse do serviço público. `
    + `Este documento é a solicitação da diária e não constitui autorização de pagamento.</div>`

    + `<div class="assinaturas">`
    + `<div><strong>${escapar(dados.beneficiario.nome)}</strong>Beneficiário</div>`
    + `<div><strong>&nbsp;</strong>Chefia imediata</div>`
    + `<div><strong>&nbsp;</strong>Ordenador de despesa</div>`
    + `</div>`

    + rodapeHtml(dados, TITULO_PAGINA_1, indice, total)
    + `</div>`;
}

/** Página 2: SOLICITAÇÃO DE LIQUIDAÇÃO DA DIÁRIA (sempre em folha nova). */
function folhaLiquidacao(dados, indice, total) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_2, indice, total)
    + identificacaoHtml(dados)
    + avisoHtml(dados)

    + `<h2>1. Beneficiário e objeto (dados do processo)</h2>`
    + `<div class="grade">`
    + campo("Nome", dados.beneficiario.nome, "c67")
    + campo("CPF", dados.beneficiario.cpf, "c33 fim")
    + campo("Secretaria", dados.secretaria, "c50")
    + campo("Destino", dados.viagem.destino, "c50 fim")
    + campo("Objeto / finalidade", dados.objeto !== SEM_REGISTRO ? dados.objeto : dados.finalidade, "c100")
    + `</div>`

    + `<h2>2. Viagem realizada</h2>`
    + `<div class="grade">`
    + campo("Data da liquidação", dados.liquidacao.data, "c33")
    + campo("Saída realizada", dados.liquidacao.saida, "c33")
    + campo("Retorno realizado", dados.liquidacao.retorno, "c33 fim")
    + campo("Diárias realizadas", dados.liquidacao.quantidade, "c50", true)
    + campo("Valor a liquidar", dados.liquidacao.valor, "c50 fim", true)
    + `</div>`

    + `<h2>3. Relatório da viagem</h2>`
    + `<div class="texto">${escapar(dados.liquidacao.relatorio === SEM_REGISTRO ? "" : dados.liquidacao.relatorio)}</div>`

    + `<h2>4. Documentos comprobatórios apresentados</h2>`
    + `<div class="texto curto">${escapar(dados.liquidacao.documentos === SEM_REGISTRO ? "" : dados.liquidacao.documentos)}</div>`

    + `<h2>5. Dados bancários para crédito</h2>`
    + `<div class="grade">`
    + campo("Banco", dados.banco.banco, "c33")
    + campo("Agência", dados.banco.agencia, "c33")
    + campo("Conta", dados.banco.conta, "c33 fim")
    + campo("Chave PIX", dados.banco.pix, "c50")
    + campo("Titular", dados.banco.titular, "c50 fim")
    + `</div>`

    + `<h2>6. Conferência e observações</h2>`
    + `<div class="grade">`
    + campo("Responsável pela conferência", dados.liquidacao.responsavel, "c50")
    + campo("Valor da diária concedida", dados.viagem.total, "c50 fim", true)
    + `</div>`
    + `<div class="texto curto">${escapar(dados.liquidacao.observacoes === SEM_REGISTRO ? "" : dados.liquidacao.observacoes)}</div>`

    + `<div class="total"><span>Valor a liquidar</span><strong>${escapar(dados.liquidacao.valor)}</strong></div>`

    + `<div class="declaracao">Solicito a liquidação da diária concedida no processo acima, referente à viagem efetivamente realizada nas condições declaradas. `
    + `Este documento é a solicitação de liquidação: não é baixa de pagamento e não autoriza, por si, débito em conta.</div>`

    + `<div class="assinaturas">`
    + `<div><strong>${escapar(dados.beneficiario.nome)}</strong>Beneficiário</div>`
    + `<div><strong>&nbsp;</strong>Conferência / chefia imediata</div>`
    + `<div><strong>&nbsp;</strong>Ordenador de despesa</div>`
    + `</div>`

    + rodapeHtml(dados, TITULO_PAGINA_2, indice, total)
    + `</div>`;
}

/**
 * O documento inteiro em HTML: as duas folhas em um só arquivo.
 *
 * É o MESMO HTML usado na pré-visualização da tela e na impressão -- o que se vê
 * antes de imprimir é o documento, não uma imitação dele.
 */
export function htmlDoProcesso(dados, { escopo = "completo" } = {}) {
  const folhas = folhasDoEscopo(escopo);
  const total = folhas.length;
  const corpo = folhas
    .map((folha, indice) =>
      folha === "solicitacao"
        ? folhaSolicitacao(dados, indice + 1, total)
        : folhaLiquidacao(dados, indice + 1, total))
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
 * PDF (arquivo único, duas páginas)
 * ---------------------------------------------------------------------- */

// O mesmo brasão desenhado com primitivas do PDF: nada de captura de tela, e
// nada de imagem externa que possa faltar na hora de gerar.
function desenharBrasaoPdf(pdf, x, y, lado) {
  pdf.setFillColor(...TINTA.navy);
  pdf.roundedRect(x, y, lado, lado, lado * 0.09, lado * 0.09, "F");

  const estrela = [[3, 9], [9, 0], [-7, 6], [2, 9], [-7, -5], [-7, 5], [2, -9], [-7, -6], [9, 0]];
  pdf.setFillColor(...TINTA.ouro);
  pdf.lines(
    estrela.map(([dx, dy]) => [(dx / 24) * lado * 0.2, (dy / 24) * lado * 0.2]),
    x + lado * 0.5, y + lado * 0.1, [1, 1], "F", true,
  );

  const largura = lado * 0.5;
  const altura = lado * 0.62;
  const escudo = [
    [0.5 * largura, 0.1 * altura],
    [0, 0.38 * altura],
    [0, 0.26 * altura, -0.21875 * largura, 0.42 * altura, -0.5 * largura, 0.52 * altura],
    [-0.28125 * largura, -0.1 * altura, -0.5 * largura, -0.26 * altura, -0.5 * largura, -0.52 * altura],
    [0, -0.38 * altura],
    [0.5 * largura, -0.1 * altura],
  ];
  pdf.setFillColor(...TINTA.papel);
  pdf.lines(escudo, x + (lado - largura) / 2 + largura / 2, y + lado * 0.26, [1, 1], "F", true);

  pdf.setFont("times", "bolditalic");
  pdf.setFontSize(lado * 1.5);
  pdf.setTextColor(...TINTA.navy);
  pdf.text("F", x + lado / 2, y + lado * 0.74, { align: "center" });
}

/**
 * O desenhista de uma folha: mantém o cursor vertical e sabe abrir folha de
 * continuação quando o conteúdo de uma página excede a altura útil.
 *
 * Folha de continuação é a exceção, não a regra: no uso normal cada página do
 * processo cabe na sua folha. Ela existe para NÃO cortar informação.
 */
function criarPincel(pdf, dados) {
  const largura = PAGINA.largura;
  const margem = PAGINA.margemLado;
  const util = largura - margem * 2;
  const limite = PAGINA.altura - PAGINA.margemBase - 6;
  const estado = { y: 0, titulo: "", pagina: 0, totalFolhas: 0, folhasUsadas: 0 };

  const linhaRodape = () => {
    pdf.setDrawColor(...TINTA.linha);
    pdf.setLineWidth(0.2);
    const y = PAGINA.altura - PAGINA.margemBase;
    pdf.line(margem, y, largura - margem, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.8);
    pdf.setTextColor(...TINTA.apoio);
    pdf.text(`${estado.titulo} — Processo nº ${dados.numero} — ${dados.secretaria}`, margem, y + 3);
    pdf.text(
      `Emitido em ${dados.emissao} por ${dados.emissor} — Página ${estado.pagina} de ${estado.totalFolhas}`,
      largura - margem, y + 3, { align: "right" },
    );
  };

  const cabecalho = (continuacao) => {
    const lado = continuacao ? 9 : 15;
    const topo = PAGINA.margemTopo;
    desenharBrasaoPdf(pdf, margem, topo, lado);
    const x = margem + lado + 4;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(continuacao ? 7.5 : 9);
    pdf.setTextColor(...TINTA.navy);
    pdf.text(IDENTIDADE.orgao, x, topo + (continuacao ? 3.6 : 4.4));

    if (!continuacao) {
      pdf.setFontSize(6.5);
      pdf.setTextColor(...TINTA.ouro);
      pdf.text(IDENTIDADE.lema, x, topo + 7.4);
    }

    pdf.setFont("times", "bold");
    pdf.setFontSize(continuacao ? 9 : 13);
    pdf.setTextColor(...TINTA.navy);
    pdf.text(continuacao ? `${estado.titulo} (continuação)` : estado.titulo, x, topo + (continuacao ? 7.6 : 12.4));

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

    /** Abre a primeira folha de uma página do processo. */
    abrirPagina(titulo, pagina, totalFolhas) {
      if (estado.folhasUsadas > 0) pdf.addPage();
      estado.folhasUsadas += 1;
      estado.titulo = titulo;
      estado.pagina = pagina;
      estado.totalFolhas = totalFolhas;
      cabecalho(false);
    },

    /** Garante espaço; quando não há, abre folha de continuação. */
    espaco(necessario) {
      if (estado.y + necessario <= limite) return;
      linhaRodape();
      pdf.addPage();
      estado.folhasUsadas += 1;
      estado.pagina += 1;
      estado.totalFolhas += 1;
      cabecalho(true);
    },

    fecharPagina() {
      linhaRodape();
    },

    secao(rotulo) {
      this.espaco(12);
      pdf.setFillColor(...TINTA.navy);
      pdf.rect(margem, estado.y, util, 5, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TINTA.branco);
      pdf.text(String(rotulo).toUpperCase(), margem + 2, estado.y + 3.5);
      estado.y += 7;
    },

    /** Uma faixa de campos rotulados, em colunas proporcionais. */
    campos(itens) {
      const altura = 9;
      this.espaco(altura + 2);
      let x = margem;
      pdf.setDrawColor(...TINTA.linha);
      pdf.setLineWidth(0.2);

      itens.forEach((item) => {
        const larguraCampo = util * (item.largura ?? 1 / itens.length);
        pdf.rect(x, estado.y, larguraCampo, altura);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6.3);
        pdf.setTextColor(...TINTA.apoio);
        pdf.text(String(item.rotulo).toUpperCase(), x + 1.8, estado.y + 3);

        pdf.setFont("helvetica", item.destaque ? "bold" : "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(...TINTA.navy);
        const cabe = pdf.splitTextToSize(String(item.valor ?? SEM_REGISTRO), larguraCampo - 3.6)[0] ?? "";
        pdf.text(cabe, x + 1.8, estado.y + 7);

        x += larguraCampo;
      });

      estado.y += altura + 1.5;
    },

    /** Bloco de texto livre em quadro: cresce com o conteúdo, nunca corta. */
    bloco(conteudo, { minimo = 16 } = {}) {
      const valor = texto(conteudo) === SEM_REGISTRO ? "" : texto(conteudo);
      const linhas = valor === "" ? [] : pdf.splitTextToSize(valor, util - 4);
      const altura = Math.max(minimo, linhas.length * 3.8 + 3.4);
      this.espaco(altura + 2);

      pdf.setDrawColor(...TINTA.linha);
      pdf.setLineWidth(0.2);
      pdf.rect(margem, estado.y, util, altura);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...TINTA.navy);
      linhas.forEach((linha, indice) => {
        pdf.text(linha, margem + 2, estado.y + 4.2 + indice * 3.8);
      });

      estado.y += altura + 1.5;
    },

    /** As cinco opções de transporte, com a escolhida marcada. */
    transporte(escolhido, rotuloOutro) {
      const altura = 8;
      this.espaco(altura + 2);
      pdf.setDrawColor(...TINTA.linha);
      pdf.setLineWidth(0.2);
      pdf.rect(margem, estado.y, util, altura);

      let x = margem + 2.5;
      TRANSPORTES.forEach((opcao) => {
        const marcado = escolhido === opcao.id;
        pdf.setDrawColor(...TINTA.navy);
        pdf.setLineWidth(0.25);
        pdf.rect(x, estado.y + 2.6, 3, 3);
        if (marcado) {
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(7);
          pdf.setTextColor(...TINTA.navy);
          pdf.text("X", x + 0.65, estado.y + 5);
        }
        const rotulo = opcao.id === "outro" && marcado && rotuloOutro ? rotuloOutro : opcao.rotulo;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(...TINTA.navy);
        pdf.text(rotulo, x + 4.2, estado.y + 5);
        x += 4.2 + pdf.getTextWidth(rotulo) + 6;
      });

      estado.y += altura + 1.5;
    },

    total(rotulo, valor) {
      const altura = 10;
      this.espaco(altura + 2);
      pdf.setFillColor(...TINTA.navy);
      pdf.rect(margem, estado.y, util, altura, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(...TINTA.branco);
      pdf.text(String(rotulo).toUpperCase(), margem + 2.5, estado.y + 6.4);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(String(valor), largura - margem - 2.5, estado.y + 6.8, { align: "right" });
      estado.y += altura + 1.5;
    },

    declaracao(conteudo) {
      const linhas = pdf.splitTextToSize(String(conteudo), util);
      this.espaco(linhas.length * 3.4 + 3);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(...TINTA.apoio);
      linhas.forEach((linha, indice) => pdf.text(linha, margem, estado.y + 3 + indice * 3.4));
      estado.y += linhas.length * 3.4 + 3;
    },

    /** Área de assinaturas: vai para o pé da folha, como no papel. */
    assinaturas(nomes) {
      const altura = 14;
      this.espaco(altura + 2);
      // Se ainda há folga, as assinaturas descem para perto do rodapé.
      const piso = limite - altura;
      if (estado.y < piso) estado.y = piso;

      const larguraCampo = (util - 6 * (nomes.length - 1)) / nomes.length;
      let x = margem;
      nomes.forEach((item) => {
        pdf.setDrawColor(...TINTA.navy);
        pdf.setLineWidth(0.3);
        pdf.line(x, estado.y, x + larguraCampo, estado.y);

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(...TINTA.navy);
        pdf.text(texto(item.nome) || " ", x + larguraCampo / 2, estado.y + 3.4, { align: "center" });

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.setTextColor(...TINTA.apoio);
        pdf.text(item.papel, x + larguraCampo / 2, estado.y + 7, { align: "center" });

        x += larguraCampo + 6;
      });
      estado.y += altura;
    },

    aviso(mensagem) {
      if (!mensagem) return;
      const linhas = pdf.splitTextToSize(mensagem, util - 4);
      const altura = linhas.length * 3.4 + 3.4;
      this.espaco(altura + 2);
      pdf.setDrawColor(...TINTA.navy);
      pdf.setLineWidth(0.35);
      pdf.rect(margem, estado.y, util, altura);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TINTA.navy);
      linhas.forEach((linha, indice) => pdf.text(linha, margem + 2, estado.y + 3.6 + indice * 3.4));
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

function paginaSolicitacaoPdf(pincel, dados, pagina, total) {
  pincel.abrirPagina(TITULO_PAGINA_1, pagina, total);
  pincel.campos([
    { rotulo: "Data do processo", valor: dados.data, largura: 0.28 },
    { rotulo: "Secretaria", valor: dados.secretaria, largura: 0.44 },
    { rotulo: "Situação do documento", valor: dados.situacao, largura: 0.28 },
  ]);
  pincel.aviso(textoDoAviso(dados));

  pincel.secao("1. Beneficiário");
  pincel.campos([
    { rotulo: "Nome", valor: dados.beneficiario.nome, largura: 0.66 },
    { rotulo: "CPF", valor: dados.beneficiario.cpf, largura: 0.34 },
  ]);
  pincel.campos([
    { rotulo: "Matrícula", valor: dados.beneficiario.matricula, largura: 0.25 },
    { rotulo: "Cargo / função", valor: dados.beneficiario.cargo, largura: 0.25 },
    { rotulo: "Secretaria", valor: dados.secretaria, largura: 0.25 },
    { rotulo: "Lotação", valor: dados.beneficiario.lotacao, largura: 0.25 },
  ]);

  pincel.secao("2. Viagem");
  pincel.campos([{ rotulo: "Destino", valor: dados.viagem.destino, largura: 1 }]);
  pincel.campos([
    { rotulo: "Data e hora de saída", valor: dados.viagem.saida, largura: 0.5 },
    { rotulo: "Data e hora de retorno", valor: dados.viagem.retorno, largura: 0.5 },
  ]);
  pincel.campos([
    { rotulo: "Quantidade de diárias", valor: dados.viagem.quantidade, largura: 1 / 3, destaque: true },
    { rotulo: "Valor unitário", valor: dados.viagem.unitarioSimples, largura: 1 / 3, destaque: true },
    { rotulo: "Valor total", valor: dados.viagem.totalSimples, largura: 1 / 3, destaque: true },
  ]);

  pincel.secao("3. Objeto / finalidade da viagem");
  if (dados.objeto !== SEM_REGISTRO) {
    pincel.campos([{ rotulo: "Objeto", valor: dados.objeto, largura: 1 }]);
  }
  pincel.bloco(dados.finalidade);

  pincel.secao("4. Meio de transporte");
  pincel.transporte(dados.transporteEscolhido, dados.transporte);

  pincel.secao("5. Dados bancários para crédito");
  pincel.campos([
    { rotulo: "Banco", valor: dados.banco.banco, largura: 1 / 3 },
    { rotulo: "Agência", valor: dados.banco.agencia, largura: 1 / 3 },
    { rotulo: "Conta", valor: dados.banco.conta, largura: 1 / 3 },
  ]);
  pincel.campos([
    { rotulo: "Chave PIX", valor: dados.banco.pix, largura: 0.5 },
    { rotulo: "Titular", valor: dados.banco.titular, largura: 0.5 },
  ]);

  pincel.secao("6. Observações");
  pincel.bloco(dados.observacoes, { minimo: 11 });

  pincel.total("Valor total da diária", dados.viagem.totalSimples);
  pincel.declaracao(
    "Declaro que as informações acima são verdadeiras e que a viagem se destina exclusivamente ao interesse do "
    + "serviço público. Este documento é a solicitação da diária e não constitui autorização de pagamento.",
  );
  pincel.assinaturas([
    { nome: dados.beneficiario.nome, papel: "Beneficiário" },
    { nome: "", papel: "Chefia imediata" },
    { nome: "", papel: "Ordenador de despesa" },
  ]);
  pincel.fecharPagina();
}

function paginaLiquidacaoPdf(pincel, dados, pagina, total) {
  pincel.abrirPagina(TITULO_PAGINA_2, pagina, total);
  pincel.campos([
    { rotulo: "Data do processo", valor: dados.data, largura: 0.28 },
    { rotulo: "Secretaria", valor: dados.secretaria, largura: 0.44 },
    { rotulo: "Situação do documento", valor: dados.situacao, largura: 0.28 },
  ]);
  pincel.aviso(textoDoAviso(dados));

  pincel.secao("1. Beneficiário e objeto (dados do processo)");
  pincel.campos([
    { rotulo: "Nome", valor: dados.beneficiario.nome, largura: 0.66 },
    { rotulo: "CPF", valor: dados.beneficiario.cpf, largura: 0.34 },
  ]);
  pincel.campos([
    { rotulo: "Secretaria", valor: dados.secretaria, largura: 0.5 },
    { rotulo: "Destino", valor: dados.viagem.destino, largura: 0.5 },
  ]);
  pincel.campos([
    {
      rotulo: "Objeto / finalidade",
      valor: dados.objeto !== SEM_REGISTRO ? dados.objeto : dados.finalidade,
      largura: 1,
    },
  ]);

  pincel.secao("2. Viagem realizada");
  pincel.campos([
    { rotulo: "Data da liquidação", valor: dados.liquidacao.data, largura: 1 / 3 },
    { rotulo: "Saída realizada", valor: dados.liquidacao.saida, largura: 1 / 3 },
    { rotulo: "Retorno realizado", valor: dados.liquidacao.retorno, largura: 1 / 3 },
  ]);
  pincel.campos([
    { rotulo: "Diárias realizadas", valor: dados.liquidacao.quantidade, largura: 0.5, destaque: true },
    { rotulo: "Valor a liquidar", valor: dados.liquidacao.valorSimples, largura: 0.5, destaque: true },
  ]);

  pincel.secao("3. Relatório da viagem");
  pincel.bloco(dados.liquidacao.relatorio);

  pincel.secao("4. Documentos comprobatórios apresentados");
  pincel.bloco(dados.liquidacao.documentos, { minimo: 11 });

  pincel.secao("5. Dados bancários para crédito");
  pincel.campos([
    { rotulo: "Banco", valor: dados.banco.banco, largura: 1 / 3 },
    { rotulo: "Agência", valor: dados.banco.agencia, largura: 1 / 3 },
    { rotulo: "Conta", valor: dados.banco.conta, largura: 1 / 3 },
  ]);
  pincel.campos([
    { rotulo: "Chave PIX", valor: dados.banco.pix, largura: 0.5 },
    { rotulo: "Titular", valor: dados.banco.titular, largura: 0.5 },
  ]);

  pincel.secao("6. Conferência e observações");
  pincel.campos([
    { rotulo: "Responsável pela conferência", valor: dados.liquidacao.responsavel, largura: 0.5 },
    { rotulo: "Valor da diária concedida", valor: dados.viagem.totalSimples, largura: 0.5, destaque: true },
  ]);
  pincel.bloco(dados.liquidacao.observacoes, { minimo: 11 });

  pincel.total("Valor a liquidar", dados.liquidacao.valorSimples);
  pincel.declaracao(
    "Solicito a liquidação da diária concedida no processo acima, referente à viagem efetivamente realizada nas "
    + "condições declaradas. Este documento é a solicitação de liquidação: não é baixa de pagamento e não autoriza, "
    + "por si, débito em conta.",
  );
  pincel.assinaturas([
    { nome: dados.beneficiario.nome, papel: "Beneficiário" },
    { nome: "", papel: "Conferência / chefia imediata" },
    { nome: "", papel: "Ordenador de despesa" },
  ]);
  pincel.fecharPagina();
}

/**
 * O PDF do processo: UM ÚNICO ARQUIVO com as duas páginas.
 *
 * Desenhado com as primitivas do jsPDF, em milímetros sobre A4 -- não é imagem
 * da tela. A Liquidação entra por `addPage()` incondicional, então ela SEMPRE
 * começa em página nova.
 */
export function montarPdfDoProcesso(dados, { escopo = "completo" } = {}) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const folhas = folhasDoEscopo(escopo);
  const pincel = criarPincel(pdf, dados);

  folhas.forEach((folha, indice) => {
    if (folha === "solicitacao") paginaSolicitacaoPdf(pincel, dados, indice + 1, folhas.length);
    else paginaLiquidacaoPdf(pincel, dados, indice + 1, folhas.length);
  });

  return pdf;
}

/** Gera e baixa o PDF. */
export function gerarPdfDoProcesso(dados, { escopo = "completo" } = {}) {
  const pdf = montarPdfDoProcesso(dados, { escopo });
  pdf.save(nomeDoArquivo(dados, "pdf", escopo));
}
