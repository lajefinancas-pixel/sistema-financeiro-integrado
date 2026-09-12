// O documento do Processo de Serviços/Materiais: as DUAS páginas, em impressão
// e em PDF.
//
// É o modelo oficial da Prefeitura Municipal de São José da Laje - AL, folha por
// folha, campo por campo:
//
//   1. REQUISIÇÃO DE MATERIAL/SERVIÇO -- o requisitante, o pedido de
//      AUTORIZAÇÃO à Senhora Prefeita com as QUATRO opções (uma marcada), o
//      QUADRO DESCRITIVO com ITEM, QUANT. e DISCRIMINAÇÃO, o local e a data, a
//      autorização da prefeita e a assinatura do requisitante.
//   2. LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO -- o requisitante, o pedido de
//      autorização de pagamento com as DUAS atestações (uma marcada), o QUADRO
//      RESUMO, o quadro do favorecido com dados bancários e valor (em algarismo
//      e por extenso), e a autorização da prefeita à Secretaria de Finanças.
//
// ⚠️ A REQUISIÇÃO NÃO TEM VALORES. O quadro descritivo tem TRÊS colunas --
// ITEM, QUANT. e DISCRIMINAÇÃO -- e nenhuma é de valor: nem unitário, nem
// total, nem nenhuma outra. Valor aparece somente na página 2. Confira por
// busca: nada em `folhaRequisicao` nem em `paginaRequisicaoPdf` imprime moeda.
//
// O PAPEL NÃO TRAZ O NÚMERO DO PROCESSO NEM NUMERAÇÃO DE FOLHAS. O número
// continua existindo no sistema -- é por ele que se controla, se busca e se
// lista o processo, e é ele que nomeia o arquivo do PDF --, mas não é impresso
// em lugar nenhum do documento, nem no cabeçalho nem no rodapé. "Página 1 de 2"
// e "Folha 1" também não saem: o modelo oficial da prefeitura não os tem.
//
// PAGINAÇÃO. Cada documento começa em folha PRÓPRIA -- na impressão pelo
// `page-break-after` da folha, no PDF por um `addPage()` incondicional. Com
// poucos itens a requisição sai COMPACTA, numa folha; com muitos, o QUADRO
// DESCRITIVO CONTINUA na folha seguinte, repetindo o cabeçalho das colunas, sem
// cortar item e SEM reduzir a fonte a ponto de ficar ilegível.
//
// NÃO EXISTE SAÍDA EM WORD. As saídas são duas: a impressão do navegador e o
// PDF -- as duas desenhadas deste mesmo arquivo, a partir dos mesmos dados.
//
// O DOCUMENTO NÃO É FINANCEIRO. Imprimir ou gerar o PDF não debita conta, não
// dá baixa em NF, não altera saldo, não marca fornecedor como pago e não cria
// pagamento. A página 2 chama-se "Liquidação/Solicitação de Pagamento" porque é
// o nome do formulário: ela SOLICITA a autorização da prefeita em papel, e nada
// mais.

import { jsPDF } from "jspdf";
import { formatBRLSimples, paraNumeroMoeda } from "./moeda.js";
import { imprimirDocumentoHtml } from "./impressaoNavegador.js";
import {
  ATESTADOS,
  TIPOS_REQUISICAO,
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  dataBR,
  dataDaLiquidacao,
  dataDaRequisicao,
  itensParaDocumento,
  nomeDaSecretaria,
  numeroDoProcesso,
  situacaoServicoInfo,
  valorExtensoDoProcesso,
} from "./processosServicos.js";
import {
  complementoDoEncaminhamento,
  destinoDaLiquidacao,
} from "./processosEncaminhamento.js";
import {
  BRASAO_ARQUIVO,
  BRASAO_SVG,
  IDENTIDADE_PADRAO,
  identidadeDoProcesso,
  logoDoDocumento,
  normalizarIdentidade,
} from "./processosIdentidade.js";
import { bancoDoDocumento } from "./processosBancos.js";
import { prefeitaDoProcesso } from "./processosPrefeita.js";

/**
 * O cabeçalho institucional de fábrica.
 *
 * O que o documento IMPRIME é `dados.identidade` -- a identidade configurada em
 * Configurações → Processos, ou a congelada no processo quando ele já foi
 * finalizado. Isto é só o ponto de partida.
 */
export const IDENTIDADE = {
  orgao: IDENTIDADE_PADRAO.orgao,
  estado: IDENTIDADE_PADRAO.estado,
};

/**
 * O rodapé institucional, impresso em TODAS as páginas do processo.
 *
 * Três linhas, com o CEP no endereço e o CNPJ em linha própria -- o mesmo
 * padrão das diárias, porque é o mesmo papel timbrado da prefeitura.
 */
export const RODAPE_INSTITUCIONAL = {
  endereco: IDENTIDADE_PADRAO.rodape_endereco,
  contato: IDENTIDADE_PADRAO.rodape_contato,
  cnpj: IDENTIDADE_PADRAO.rodape_cnpj,
};

/** O município que assina o documento, como o modelo oficial o escreve. */
export const MUNICIPIO = "São José da Laje/AL";

/** A secretaria a quem a autorização da prefeita é destinada (página 2). */
export const SECRETARIA_DE_FINANCAS = "SECRETARIA DE FINANÇAS";

/** O destino da autorização da página 1, completado com a secretaria. */
export const DESPACHO_PAGINA_1 = "À SECRETARIA MUNICIPAL DE";

export const SEM_REGISTRO = "--";

/** Os três escopos de saída: o processo completo ou um documento só. */
export const ESCOPOS = [
  { id: "completo", rotulo: "Processo completo (2 páginas)" },
  { id: "requisicao", rotulo: "Somente a Requisição" },
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

// A4 retrato. A margem de baixo é maior porque o rodapé institucional tem três
// linhas: endereço com CEP, contato e CNPJ.
const PAGINA = { largura: 210, altura: 297, margemTopo: 10, margemBase: 18, margemLado: 13 };

/**
 * Quantas linhas o QUADRO DESCRITIVO imprime quando NENHUM item foi digitado.
 *
 * O formulário oficial já vem com a linha "01" desenhada, para ser completada à
 * mão. Processo sem item nenhum sai assim: com linhas em branco e o número já
 * impresso, e não com um quadro vazio inútil.
 */
const LINHAS_EM_BRANCO = 3;

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

/** O valor em algarismo, como o modelo pede: "R$ 1.250,00" sai como "1.250,00". */
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

/**
 * A imagem preparada só vale para a identidade que ela representa.
 *
 * Documento já finalizado imprime o brasão que congelou, e uma imagem preparada
 * a partir de outra URL é descartada em favor do desenho vetorial.
 */
function logoAceito(logo, enderecoDaFolha) {
  if (!logo || !logo.dataUrl) return null;
  const origem = texto(logo.url);
  if (origem === "") return null;
  return origem === texto(enderecoDaFolha) ? logo : null;
}

/**
 * "SECRETARIA MUNICIPAL DE EDUCAÇÃO" -- o REQUISITANTE das duas páginas.
 *
 * O prefixo não é repetido quando a secretaria já vem cadastrada com ele: o
 * papel sairia "Secretaria Municipal de Secretaria de Educação".
 */
function requisitanteDe(nome) {
  const limpo = texto(nome);
  if (limpo === "") return SEM_REGISTRO;
  return /^secretaria/i.test(limpo) ? limpo : `Secretaria Municipal de ${limpo}`;
}

/**
 * O complemento de "À SECRETARIA MUNICIPAL DE ___" na autorização da página 1.
 *
 * É A SECRETARIA DO ENCAMINHAMENTO -- a que a prefeita manda providenciar --, e
 * não a solicitante. Ela sai do que o processo GRAVOU; sem nada gravado, o
 * documento cai no que já fazia antes e, no limite, escreve Finanças. ⚠️ Este
 * campo NÃO SAI EM BRANCO no papel.
 */
function destinoDoDespacho(processo, secretaria) {
  return complementoDoEncaminhamento(processo, secretaria);
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * "São José da Laje/AL, 10 de março de 2026" -- ou com o dia e o mês em branco.
 *
 * Sem data preenchida o papel sai como o formulário oficial: para completar à
 * mão, já com o ano do exercício.
 */
function localEData(data, ano) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(data));
  if (partes) {
    const mes = MESES[Number(partes[2]) - 1] ?? "";
    return `${MUNICIPIO}, ${Number(partes[3])} de ${mes} de ${partes[1]}`;
  }
  const exercicio = Number(ano);
  const fim = Number.isFinite(exercicio) && exercicio > 0 ? String(Math.trunc(exercicio)) : "______";
  return `${MUNICIPIO}, _______ de ________________ de ${fim}`;
}

/** "Em, 10/03/2026" ou "Em, _____/______/________", como no modelo. */
function emData(data) {
  const formatada = dataBR(data);
  return formatada === "" ? "Em, _____/______/________" : `Em, ${formatada}`;
}

/**
 * As QUATRO opções da página 1, com a escolhida MARCADA e as outras em branco.
 *
 * É exatamente o que o papel da prefeitura tem: as quatro linhas sempre saem, e
 * só uma leva a marca.
 */
function opcoesDoTipo(tipo) {
  const escolhido = texto(tipo);
  return TIPOS_REQUISICAO.map((item) => ({
    id: item.id,
    rotulo: item.rotulo,
    marcado: item.id === escolhido,
  }));
}

/** As DUAS atestações da página 2, com a escolhida marcada. */
function opcoesDoAtestado(atestado) {
  const escolhido = texto(atestado);
  return ATESTADOS.map((item) => ({
    id: item.id,
    rotulo: item.rotulo,
    marcado: item.id === escolhido,
  }));
}

/**
 * As linhas do QUADRO DESCRITIVO.
 *
 * ⚠️ TRÊS COLUNAS, NENHUMA DE VALOR. O número do item é a POSIÇÃO dele na lista,
 * então remover um item renumera os seguintes sozinho -- não há buraco na
 * sequência e não há número gravado para desencontrar.
 */
function linhasDoQuadroDescritivo(processo) {
  const itens = itensParaDocumento(processo);
  if (itens.length > 0) {
    return itens.map((item) => ({
      numero: item.numero,
      quantidade: texto(item.quantidade),
      discriminacao: texto(item.discriminacao),
    }));
  }
  // Sem item digitado, o quadro sai como o formulário em branco: com o número
  // impresso e as linhas para completar à mão.
  return Array.from({ length: LINHAS_EM_BRANCO }, (_, indice) => ({
    numero: String(indice + 1).padStart(2, "0"),
    quantidade: "",
    discriminacao: "",
  }));
}

/**
 * Tudo o que as duas páginas mostram, lido UMA VEZ do processo.
 *
 * Os dados compartilhados aparecem nas duas páginas porque são os MESMOS dados
 * -- não há cópia aqui, só leitura do mesmo registro. É o que garante que o
 * requisitante da Requisição e o da Liquidação nunca divirjam.
 */
export function dadosDoDocumento(
  processo,
  {
    secretarias = [],
    emissor = "",
    emissao = null,
    identidade = null,
    logo = null,
    logoSistema = null,
    prefeita = null,
  } = {},
) {
  const p = processo ?? {};
  const secretaria = nomeDaSecretaria(p, secretarias);
  const identidadeDaFolha = identidadeDoProcesso(p, identidade);
  // O ENDEREÇO DA IMAGEM QUE ESTA FOLHA IMPRIME: a imagem da identidade dos
  // Processos, senão a logomarca cadastrada do sistema (Configurações →
  // Aparência), senão o brasão do repositório.
  const logoEndereco = logoDoDocumento(identidadeDaFolha, logoSistema);

  return {
    // ⚠️ A IDENTIDADE VISUAL DA FOLHA. Processo já finalizado imprime a que ele
    // congelou; rascunho imprime a vigente. Trocar o brasão ou o rodapé hoje
    // não reescreve o documento emitido antes.
    identidade: identidadeDaFolha,
    // A imagem do cabeçalho. Imagem cadastrada tem preferência sobre o desenho
    // embutido no código, que é último recurso.
    logoEndereco,
    logo: logoAceito(logo, logoEndereco),

    // ⚠️ A PREFEITA QUE AUTORIZA. Processo já finalizado imprime a que ele
    // congelou; rascunho imprime a vigente no cadastro. Trocar o cadastro
    // (mudança de gestão) NÃO reescreve documento já finalizado.
    prefeita: prefeitaDoProcesso(p, prefeita),

    // O número existe para o sistema e para o nome do arquivo. NÃO É IMPRESSO.
    numero: numeroDoProcesso(p) || SEM_REGISTRO,
    ano: p.ano ?? null,
    situacao: situacaoServicoInfo(p.situacao).rotulo,
    cancelado: texto(p.situacao) === "cancelada",
    rascunho: texto(p.situacao) === "rascunho",
    motivoCancelamento: texto(p.motivo_cancelamento),
    data: dataBR(p.data_processo) || SEM_REGISTRO,
    secretaria: ou(secretaria),
    // O "REQUISITANTE:" das DUAS páginas: a secretaria solicitante.
    requisitante: requisitanteDe(secretaria),
    // Emissão e emissor NÃO saem no papel: são informação de sistema. Ficam no
    // dado do documento porque o histórico do processo, dentro do sistema, os
    // mostra na tela -- e só ali.
    emissao: emissao || agoraBR(),
    emissor: ou(emissor),

    // PÁGINA 1 -- a requisição.
    requisicao: {
      opcoes: opcoesDoTipo(p.tipo),
      itens: linhasDoQuadroDescritivo(p),
      // Verdadeiro quando o quadro saiu em branco, para a folha não anunciar
      // itens que não existem.
      semItens: itensParaDocumento(p).length === 0,
      despacho: destinoDoDespacho(p, secretaria),
      // A DATA DESTA FOLHA é a da requisição, e não a da liquidação: a
      // requisição é feita num dia e a liquidação, dias ou semanas depois.
      localEData: localEData(dataDaRequisicao(p), p.ano),
      emData: emData(dataDaRequisicao(p)),
    },

    // QUEM ASSINA. É conteúdo GRAVADO no processo, não uma leitura do cadastro
    // de servidores: documento antigo continua mostrando quem assinou naquele
    // momento, mesmo que o cargo da pessoa mude depois. Em branco, a linha sai
    // só com o traço, para assinar à mão -- como o formulário oficial é.
    assinaturas: {
      requisitante: {
        nome: texto(p.requisitante_nome),
        cpf: texto(p.requisitante_cpf),
        cargo: texto(p.requisitante_cargo),
      },
      liquidacao: {
        nome: texto(p.liquidacao_assinante_nome),
        cpf: texto(p.liquidacao_assinante_cpf),
        cargo: texto(p.liquidacao_assinante_cargo),
      },
    },

    // PÁGINA 2 -- a liquidação.
    liquidacao: {
      opcoes: opcoesDoAtestado(p.atestado),
      referencia: ou(p.referencia),
      // A FUNDAMENTAÇÃO é a nota fiscal: o número dela quando o processo
      // consultou uma NF registrada, ou o que foi escrito à mão.
      fundamentacao: ou(
        texto(p.fundamentacao)
        || (texto(p.nota_numero) !== "" ? `Nota fiscal nº ${texto(p.nota_numero)}` : ""),
      ),
      orgao: requisitanteDe(secretaria),
      // A SECRETARIA DO ENCAMINHAMENTO desta folha. O modelo oficial traz
      // Finanças, e Finanças continua sendo o padrão quando nada foi escolhido.
      destino: destinoDaLiquidacao(p),
      // A DATA DESTA FOLHA é a da liquidação.
      localEData: localEData(dataDaLiquidacao(p), p.ano),
      emData: emData(dataDaLiquidacao(p)),
    },

    favorecido: {
      nome: ou(p.favorecido_nome),
      cpfCnpj: ou(p.favorecido_cpf_cnpj),
      endereco: ou(p.favorecido_endereco),
    },

    banco: {
      // "001 — Banco do Brasil": número e nome juntos, como no modelo oficial.
      banco: ou(bancoDoDocumento(p)),
      agencia: ou(p.agencia),
      conta: ou(p.conta),
      pix: ou(p.pix),
      titular: texto(p.titular),
    },

    // O ÚNICO valor do processo, e ele só aparece na PÁGINA 2.
    valor: {
      algarismo: moedaSimples(p.valor_total),
      extenso: ou(valorExtensoDoProcesso(p)),
    },

    // A NF consultada, quando houve. É informação do documento, e nada aqui
    // altera a nota: ela não recebeu baixa e o valor em aberto dela é o mesmo.
    nota: {
      numero: texto(p.nota_numero),
      emissao: dataBR(p.nota_emissao),
    },
  };
}

/** As folhas que a saída vai ter, na ordem do processo. */
export function folhasDoEscopo(escopo) {
  if (escopo === "requisicao") return ["requisicao"];
  if (escopo === "liquidacao") return ["liquidacao"];
  return ["requisicao", "liquidacao"];
}

/** "processo-servico-0001-2026.pdf" */
export function nomeDoArquivo(dados, extensao = "pdf", escopo = "completo") {
  const numero = String(dados?.numero ?? "").replace("/", "-").replace(/[^\w-]/g, "");
  const sufixos = { requisicao: "-requisicao", liquidacao: "-liquidacao" };
  return `processo-servico-${numero || "sem-numero"}${sufixos[escopo] ?? ""}.${extensao}`;
}

/* -------------------------------------------------------------------------
 * Impressão (HTML)
 * ---------------------------------------------------------------------- */

// O brasão do repositório, embutido no documento para que a folha nunca saia sem
// ele por causa de uma imagem que não carregou na janela de impressão.
function brasaoSvg(lado) {
  return BRASAO_SVG.replace(/^<svg /, `<svg width="${lado}mm" height="${lado}mm" `)
    .replace(/ width="512" height="512"/, "");
}

/** O brasão do CABEÇALHO, em TODAS as folhas. */
function brasaoDoDocumento(dados, lado) {
  const endereco = texto(dados?.logoEndereco) || texto(dados?.identidade?.logo_url);
  // O desenho vetorial só entra quando NÃO existe imagem cadastrada.
  const url = texto(dados?.logo?.dataUrl) || (endereco === BRASAO_ARQUIVO ? "" : endereco);
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
       documento do processo começar em folha nova. A altura é MÍNIMA, não fixa
       -- muitos itens transbordam para uma folha a mais em vez de ser cortados,
       e a fonte NÃO diminui para forçar uma folha só. */
    .folha { position: relative; width: ${PAGINA.largura}mm; min-height: ${PAGINA.altura}mm;
      padding: ${PAGINA.margemTopo}mm ${PAGINA.margemLado}mm ${PAGINA.margemBase + 4}mm;
      page-break-after: always; break-after: page; }
    .folha:last-child { page-break-after: auto; break-after: auto; }

    .cabecalho { display: flex; align-items: center; gap: 4mm; border-bottom: 1.4pt solid ${COR.navy}; padding-bottom: 2mm; }
    .cabecalho svg { display: block; flex: 0 0 auto; }
    .cabecalho img.brasao { display: block; flex: 0 0 auto; width: auto; object-fit: contain; }
    .orgao { font-size: 10pt; font-weight: bold; letter-spacing: .08em; }
    .estado { margin-top: .4mm; color: ${COR.apoio}; font-size: 7.5pt; font-weight: bold; letter-spacing: .16em; }
    .titulo { margin: 1.2mm 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 13pt; letter-spacing: .02em; }
    /* O cabeçalho não tem selo: o número do processo NÃO é impresso. */

    .aviso { margin-top: 2.5mm; border: .8pt solid ${COR.navy}; padding: 1.6mm 2mm; font-size: 8pt; }
    .aviso strong { letter-spacing: .06em; text-transform: uppercase; }

    .linha-doc { margin: 3.4mm 0 0; }
    .linha-doc b { letter-spacing: .04em; }
    .preenchido { border-bottom: .5pt dotted ${COR.apoio}; padding: 0 1mm; }
    .abertura { margin: 3.4mm 0 0; text-align: justify; }

    /* AS OPÇÕES DO FORMULÁRIO: as quatro da requisição e as duas da liquidação.
       Todas saem sempre; a escolhida leva a marca e as outras ficam em branco,
       como no papel. */
    .opcoes { margin: 2.6mm 0 0; }
    .opcoes .opcao { margin-top: 1.6mm; display: flex; gap: 2mm; align-items: flex-start; }
    .opcoes .caixa { flex: 0 0 auto; font-family: "Courier New", Courier, monospace; font-size: 10pt;
      font-weight: bold; letter-spacing: .04em; }
    .opcoes .texto-opcao { text-align: justify; }
    .opcoes .marcada .texto-opcao { font-weight: bold; }

    h2 { margin: 4.6mm 0 0; padding: 1.2mm 2mm; background: ${COR.navy}; color: #fff; font-size: 8pt;
      font-weight: bold; letter-spacing: .1em; text-transform: uppercase; }

    table.quadro { width: 100%; border-collapse: collapse; margin-top: 1.6mm; }
    table.quadro th { border: .5pt solid ${COR.navy}; background: ${COR.faixa}; padding: 1.4mm 2mm;
      font-size: 7.5pt; letter-spacing: .06em; text-transform: uppercase; text-align: left; }
    table.quadro th .ajuda { display: block; font-weight: normal; text-transform: none; letter-spacing: 0;
      font-size: 6.5pt; color: ${COR.apoio}; }
    table.quadro td { border: .5pt solid ${COR.navy}; padding: 1.8mm 2mm; font-size: 9.5pt; vertical-align: top;
      overflow-wrap: break-word; }
    /* As linhas do quadro descritivo não se partem no meio na quebra de folha:
       item cortado ao meio não é documento. */
    table.quadro tr { page-break-inside: avoid; break-inside: avoid; }
    table.quadro thead { display: table-header-group; }
    table.quadro td.numero { font-weight: bold; white-space: nowrap; text-align: center; }
    table.quadro td.quant { white-space: nowrap; text-align: center; }
    table.quadro td.vazia { height: 8mm; }
    table.quadro td b { display: block; }
    table.quadro td span.rotulo { display: block; font-size: 6.5pt; letter-spacing: .08em;
      text-transform: uppercase; color: ${COR.apoio}; margin-top: 1.2mm; }
    table.quadro td span.rotulo:first-child { margin-top: 0; }
    /* O QUADRO RESUMO: rótulo à esquerda, conteúdo à direita. */
    table.quadro td.rotulo-linha { width: 32%; background: ${COR.faixa}; font-size: 7.5pt; font-weight: bold;
      letter-spacing: .06em; text-transform: uppercase; }

    .local-data { margin-top: 8mm; text-align: center; font-size: 10pt; }

    .autorizacao { margin-top: 5mm; border: .8pt solid ${COR.navy}; padding: 3mm; }
    .autorizacao .rotulo-caixa { font-size: 7.5pt; font-weight: bold; letter-spacing: .1em;
      text-transform: uppercase; color: ${COR.apoio}; }
    .autorizacao p { margin: 1.6mm 0 0; }
    .autorizacao .ciente { font-weight: bold; letter-spacing: .08em; }

    /* A FAIXA DE ASSINATURAS da folha da requisição: o requisitante à
       ESQUERDA e a autorização da prefeita à DIREITA, na MESMA faixa
       horizontal -- nunca uma abaixo da outra. Empilhadas, as duas gastavam o
       dobro da altura e empurravam a requisição para uma segunda folha.
       ⚠️ Isto é da REQUISIÇÃO: nas DIÁRIAS as assinaturas continuam
       empilhadas, como definido lá. */
    .faixa-assinaturas { display: flex; align-items: stretch; gap: 6mm; margin-top: 6mm;
      page-break-inside: avoid; break-inside: avoid; }
    /* O quadro da prefeita fica um pouco mais largo: é ele que tem texto dentro
       -- "À SECRETARIA MUNICIPAL DE ______" precisa caber numa linha. */
    .faixa-assinaturas > * { min-width: 0; }
    .faixa-assinaturas .lado { flex: 42 1 0; }
    .faixa-assinaturas .autorizacao { flex: 58 1 0; }
    /* A coluna da esquerda empurra a assinatura para o pé da faixa, na altura da
       linha de assinatura da prefeita. */
    .faixa-assinaturas .lado { display: flex; flex-direction: column; justify-content: flex-end; }
    .faixa-assinaturas .autorizacao { margin-top: 0; }
    .faixa-assinaturas .assinatura-unica { margin: 10mm auto 0; width: 100%; max-width: 78mm; }

    .assinatura-unica { margin: 12mm auto 0; width: 90mm; border-top: .7pt solid ${COR.navy}; padding-top: 1.4mm;
      text-align: center; font-size: 7.5pt; color: ${COR.apoio}; }
    .assinatura-unica strong { display: block; font-size: 9pt; color: ${COR.navy}; }
    .assinatura-unica .cargo { display: block; font-size: 7pt; }

    .rodape { position: absolute; left: ${PAGINA.margemLado}mm; right: ${PAGINA.margemLado}mm; bottom: 6mm;
      border-top: .5pt solid ${COR.navy}; padding-top: 1.2mm; text-align: center; color: ${COR.apoio}; font-size: 7pt; }
    .rodape .endereco { color: ${COR.navy}; font-weight: bold; }
  `;
}

/**
 * O cabeçalho da folha: brasão, órgão, estado e o título do documento.
 *
 * SEM o número do processo e SEM numeração de folha. Os dois existem no
 * sistema, para controle e busca, e nenhum dos dois vai para o papel.
 */
function cabecalhoHtml(dados, titulo) {
  const identidade = normalizarIdentidade(dados?.identidade);
  return `<div class="cabecalho">${brasaoDoDocumento(dados, 16)}`
    + `<div><div class="orgao">${escapar(identidade.orgao)}</div>`
    + `<div class="estado">${escapar(identidade.estado)}</div>`
    + `<div class="titulo">${escapar(titulo)}</div></div>`
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

/** As opções do formulário, com a marca do modelo: "[ X ]" ou "(  X  )". */
function opcoesHtml(opcoes, { marca = "[", fecha = "]" } = {}) {
  const caixa = (marcado) => (marcado ? `${marca} X ${fecha}` : `${marca}&nbsp;&nbsp;&nbsp;&nbsp;${fecha}`);
  return `<div class="opcoes">`
    + opcoes
      .map(
        (opcao) =>
          `<div class="opcao${opcao.marcado ? " marcada" : ""}">`
          + `<span class="caixa">${caixa(opcao.marcado)}</span>`
          + `<span class="texto-opcao">${escapar(opcao.rotulo)}</span></div>`,
      )
      .join("")
    + `</div>`;
}

/**
 * O rodapé institucional, igual em todas as folhas.
 *
 * Endereço com CEP, contato e CNPJ, em três linhas. NADA de informação de
 * sistema: quem emitiu e quando não pertencem ao documento oficial -- isso fica
 * só no histórico do processo, dentro do sistema. Sem número de processo e sem
 * numeração de folha.
 */
function rodapeHtml(dados) {
  const identidade = normalizarIdentidade(dados?.identidade);
  const cnpj = identidade.rodape_cnpj === "" ? "" : `<div>${escapar(identidade.rodape_cnpj)}</div>`;
  return `<div class="rodape">`
    + `<div class="endereco">${escapar(identidade.rodape_endereco)}</div>`
    + `<div>${escapar(identidade.rodape_contato)}</div>`
    + cnpj
    + `</div>`;
}

/** Uma linha de assinatura: o traço, o nome gravado e o rótulo do papel. */
function assinaturaHtml(nome, papel, cargo = "") {
  return `<div class="assinatura-unica">`
    + `<strong>${nome ? escapar(nome) : "&nbsp;"}</strong>${escapar(papel)}`
    + (cargo ? `<span class="cargo">${escapar(cargo)}</span>` : "")
    + `</div>`;
}

/**
 * A assinatura da PREFEITA nas caixas de CIENTE/AUTORIZO.
 *
 * Nome e cargo vêm do cadastro de Configurações → Processos → Prefeita, sem
 * redigitação em cada processo, e a identificação abaixo da linha sai pronta.
 * `comCpf` acrescenta o CPF: ele cabe na caixa larga da página 2, e ficaria
 * apertado na caixa estreita da página 1. Sem cadastro, a linha sai só com o
 * traço e o rótulo PREFEITA, para assinar e identificar à mão -- como antes.
 */
function assinaturaDaPrefeitaHtml(prefeita, { comCpf = false } = {}) {
  const partes = [texto(prefeita?.cargo)];
  if (comCpf) partes.push(texto(prefeita?.cpf) === "" ? "" : `CPF: ${texto(prefeita.cpf)}`);
  return assinaturaHtml(
    texto(prefeita?.nome),
    "PREFEITA",
    partes.filter((parte) => parte !== "").join(" — "),
  );
}

/**
 * Página 1: REQUISIÇÃO DE MATERIAL/SERVIÇO.
 *
 * ⚠️ SEM VALORES. Nenhuma coluna, nenhuma linha e nenhum campo desta folha traz
 * valor unitário, valor total ou qualquer outra moeda.
 */
function folhaRequisicao(dados) {
  const itens = dados.requisicao.itens
    .map(
      (item) =>
        `<tr><td class="numero">${escapar(item.numero)}</td>`
        + `<td class="quant${item.quantidade === "" ? " vazia" : ""}">${escapar(item.quantidade)}</td>`
        + `<td${item.discriminacao === "" ? ' class="vazia"' : ""}>${escapar(item.discriminacao)}</td></tr>`,
    )
    .join("");

  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_1)
    + avisoHtml(dados)

    + `<p class="linha-doc"><b>REQUISITANTE:</b> <span class="preenchido">${escapar(dados.requisitante)}</span></p>`
    + `<p class="linha-doc"><b>A: Senhora Prefeita.</b></p>`
    + `<p class="abertura">Pelo presente, venho solicitar AUTORIZAÇÃO para:</p>`
    + opcoesHtml(dados.requisicao.opcoes)
    + `<p class="abertura">... do que se descreve abaixo:</p>`

    + `<h2>Quadro Descritivo</h2>`
    // TRÊS COLUNAS: ITEM, QUANT. e DISCRIMINAÇÃO. Nenhuma de valor.
    + `<table class="quadro"><thead><tr>`
    + `<th style="width:12%">Item</th>`
    + `<th style="width:16%">Quant.</th>`
    + `<th>Discriminação</th>`
    + `</tr></thead><tbody>${itens}</tbody></table>`

    + `<p class="local-data">${escapar(dados.requisicao.localEData)}</p>`

    // ⚠️ LADO A LADO: à ESQUERDA o requisitante, à DIREITA a autorização da
    // prefeita, na MESMA faixa horizontal.
    + `<div class="faixa-assinaturas">`
    + `<div class="lado">`
    + assinaturaHtml(
      dados.assinaturas.requisitante.nome,
      "(assinatura, nome e identificação funcional do requisitante)",
      dados.assinaturas.requisitante.cargo,
    )
    + `</div>`
    + `<div class="autorizacao">`
    + `<div class="rotulo-caixa">Autorização da prefeita</div>`
    + `<p class="ciente">CIENTE/AUTORIZO</p>`
    + `<p>${escapar(DESPACHO_PAGINA_1)} <span class="preenchido">${escapar(dados.requisicao.despacho)}</span></p>`
    + `<p>Para providências que o caso requer</p>`
    + `<p>${escapar(dados.requisicao.emData)}</p>`
    + assinaturaDaPrefeitaHtml(dados.prefeita)
    + `</div>`
    + `</div>`

    + rodapeHtml(dados)
    + `</div>`;
}

/** Página 2: LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO (sempre em folha nova). */
function folhaLiquidacao(dados) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_2)
    + avisoHtml(dados)

    + `<p class="linha-doc"><b>REQUISITANTE:</b> <span class="preenchido">${escapar(dados.requisitante)}</span></p>`
    + `<p class="linha-doc"><b>A: Senhora Prefeita.</b></p>`
    + `<p class="abertura">Pelo presente, venho solicitar AUTORIZAÇÃO de pagamento em favor do(a) `
    + `beneficiário(a) abaixo identificado(a), o(a) qual:</p>`
    + opcoesHtml(dados.liquidacao.opcoes, { marca: "(", fecha: ")" })

    + `<h2>Quadro Resumo</h2>`
    + `<table class="quadro"><tbody>`
    + `<tr><td class="rotulo-linha">Referência</td><td>${escapar(dados.liquidacao.referencia)}</td></tr>`
    + `<tr><td class="rotulo-linha">Fundamentação</td><td>${escapar(dados.liquidacao.fundamentacao)}</td></tr>`
    + `<tr><td class="rotulo-linha">Órgão requisitante</td><td>${escapar(dados.liquidacao.orgao)}</td></tr>`
    + `</tbody></table>`

    + `<table class="quadro"><thead><tr>`
    + `<th style="width:40%">Favorecido(a)<span class="ajuda">(Nome e endereço completos)</span></th>`
    + `<th style="width:32%">Dados bancários<span class="ajuda">(banco, agência e conta corrente)</span></th>`
    + `<th>Valor<span class="ajuda">(em algarismo e por extenso)</span></th>`
    + `</tr></thead><tbody><tr>`
    + `<td><span class="rotulo">Nome/Razão social</span><b>${escapar(dados.favorecido.nome)}</b>`
    + `<span class="rotulo">CPF/CNPJ</span>${escapar(dados.favorecido.cpfCnpj)}`
    + `<span class="rotulo">Endereço</span>${escapar(dados.favorecido.endereco)}</td>`
    + `<td><span class="rotulo">Banco</span>${escapar(dados.banco.banco)}`
    + `<span class="rotulo">AG</span>${escapar(dados.banco.agencia)}`
    + `<span class="rotulo">C</span>${escapar(dados.banco.conta)}`
    + `<span class="rotulo">Chave PIX</span>${escapar(dados.banco.pix)}</td>`
    + `<td><b>R$ ${escapar(dados.valor.algarismo)}</b>`
    + `<span class="rotulo">Por extenso</span>${escapar(dados.valor.extenso)}</td>`
    + `</tr></tbody></table>`

    + `<div class="autorizacao">`
    + `<div class="rotulo-caixa">Autorização da prefeita</div>`
    + `<p class="ciente">CIENTE/AUTORIZO</p>`
    + `<p>À ${escapar(dados.liquidacao.destino)}</p>`
    + `<p>Para providências que o caso requer &nbsp; ${escapar(dados.liquidacao.emData)}</p>`
    + assinaturaDaPrefeitaHtml(dados.prefeita, { comCpf: true })
    + `</div>`

    + `<p class="local-data">${escapar(dados.liquidacao.localEData)}</p>`
    + assinaturaHtml(
      dados.assinaturas.liquidacao.nome,
      "Assinatura",
      dados.assinaturas.liquidacao.cargo,
    )

    + rodapeHtml(dados)
    + `</div>`;
}

const FOLHAS_HTML = {
  requisicao: folhaRequisicao,
  liquidacao: folhaLiquidacao,
};

/**
 * O documento inteiro em HTML: as duas folhas em um só arquivo.
 *
 * É o MESMO HTML usado na pré-visualização da tela e na impressão -- o que se vê
 * antes de imprimir é o documento, não uma imitação dele.
 */
export function htmlDoProcesso(dados, { escopo = "completo" } = {}) {
  const corpo = folhasDoEscopo(escopo)
    .map((folha) => (FOLHAS_HTML[folha] ?? folhaRequisicao)(dados))
    .join("");

  // O título da janela de impressão. Sem o número do processo: o navegador pode
  // imprimir o título no cabeçalho da folha, e ele não deve sair no papel.
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">`
    + `<title>Processo de Serviços/Materiais</title>`
    + `<style>${estilos()}</style></head><body>${corpo}</body></html>`;
}

/** Imprime o processo em um quadro próprio, fora da árvore da página. */
export function imprimirProcesso(dados, { escopo = "completo" } = {}) {
  imprimirDocumentoHtml(htmlDoProcesso(dados, { escopo }));
}

/* -------------------------------------------------------------------------
 * PDF (arquivo único, duas páginas)
 * ---------------------------------------------------------------------- */

/**
 * O BRASÃO NO PDF, em todas as páginas.
 *
 * Quando a tela conseguiu preparar a imagem (`dados.logo`), ela entra
 * RASTERIZADA EM ALTA RESOLUÇÃO, respeitando a proporção original. Sem imagem
 * preparada, o brasão vetorial do repositório é desenhado com primitivas: a
 * folha NUNCA sai sem brasão, e nada depende de link externo na hora de gerar.
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

  pdf.setFillColor(...TINTA.navy);
  pdf.rect(x + em(60), y + em(72), em(392), em(78), "F");

  const estrela = [
    [em(13), em(40)], [em(42), 0], [em(-34), em(25)], [em(13), em(40)],
    [em(-34), em(-25)], [em(-34), em(25)], [em(13), em(-40)], [em(-34), em(-25)], [em(42), 0],
  ];
  pdf.setFillColor(...TINTA.ouro);
  pdf.lines(estrela, x + em(256), y + em(78), [1, 1], "F", true);

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
 * sabe abrir folha de continuação quando o conteúdo excede a altura útil.
 *
 * Folha de continuação é a exceção, não a regra: com poucos itens cada
 * documento cabe na folha dele. Ela existe para NÃO cortar informação e para
 * não obrigar a fonte a encolher.
 */
function criarPincel(pdf, dados) {
  const largura = PAGINA.largura;
  const margem = PAGINA.margemLado;
  const util = largura - margem * 2;
  const limite = PAGINA.altura - PAGINA.margemBase - 4;
  // `folhasUsadas` existe só para saber se já há folha aberta (o `addPage()` do
  // documento seguinte). NÃO é numeração: o papel não traz número de folha.
  // `colX`/`colLarg` são a COLUNA corrente: fora de uma faixa lado a lado elas
  // ficam em zero e todo o desenho usa a largura inteira da folha, como sempre.
  // `travado` impede a quebra de folha no meio de uma faixa -- meia faixa numa
  // folha e meia na outra não é documento.
  const estado = { y: 0, titulo: "", folhasUsadas: 0, recuo: 0, colX: 0, colLarg: 0, travado: false };

  const xBase = () => (estado.colLarg > 0 ? estado.colX : margem);
  const largBase = () => (estado.colLarg > 0 ? estado.colLarg : util);
  const xEsq = () => xBase() + estado.recuo;
  const largUtil = () => largBase() - estado.recuo * 2;

  // A identidade que ESTA folha imprime: a congelada do processo, ou a vigente.
  const identidade = normalizarIdentidade(dados?.identidade);

  /**
   * Escreve um texto institucional garantindo que ele CAIBA na largura dada.
   *
   * O órgão e as linhas do rodapé são configuráveis, então podem vir mais longos
   * que o padrão. Aqui a fonte diminui até caber, em vez de o texto invadir a
   * margem.
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
    textoQueCabe(identidade.rodape_contato, largura / 2, y + 6.4, 7, util, "center");

    // A linha do CNPJ sai só quando existe: identidade congelada antiga trazia
    // o CNPJ junto do contato, e repeti-lo seria erro no documento.
    if (identidade.rodape_cnpj !== "") {
      textoQueCabe(identidade.rodape_cnpj, largura / 2, y + 9.4, 7, util, "center");
    }
  };

  const cabecalho = (continuacao) => {
    const lado = continuacao ? 10 : 16;
    const topo = PAGINA.margemTopo;
    const largBrasao = desenharBrasaoPdf(pdf, margem, topo, lado, dados);
    const x = margem + largBrasao + 4;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(continuacao ? 8 : 10);
    pdf.setTextColor(...TINTA.navy);
    textoQueCabe(identidade.orgao, x, topo + (continuacao ? 3.8 : 4.6), continuacao ? 8 : 10, largura - margem - x);

    if (!continuacao) {
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TINTA.apoio);
      pdf.text(identidade.estado, x, topo + 8);
    }

    pdf.setFont("times", "bold");
    pdf.setFontSize(continuacao ? 9 : 13);
    pdf.setTextColor(...TINTA.navy);
    pdf.text(continuacao ? `${estado.titulo} (continuação)` : estado.titulo, x, topo + (continuacao ? 8 : 13.2));

    // ⚠️ O NÚMERO DO PROCESSO NÃO É IMPRESSO. Ele fica no sistema, para
    // controle, busca e listagem, e nomeia o arquivo do PDF -- mas não sai no
    // cabeçalho nem em nenhum outro canto da folha.

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
    abrirPagina(titulo) {
      if (estado.folhasUsadas > 0) pdf.addPage();
      estado.folhasUsadas += 1;
      estado.titulo = titulo;
      estado.recuo = 0;
      cabecalho(false);
    },

    /** Garante espaço; quando não há, abre folha de continuação. */
    espaco(necessario) {
      // Dentro de uma faixa lado a lado a folha já foi garantida antes de a
      // faixa começar: aqui a quebra é proibida, para as duas colunas não se
      // separarem.
      if (estado.travado) return;
      if (estado.y + necessario <= limite) return;
      rodapeInstitucional();
      pdf.addPage();
      estado.folhasUsadas += 1;
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
          // No meio da COLUNA corrente -- que, fora de uma faixa, é a folha toda.
          pdf.text(linha, xBase() + largBase() / 2, estado.y + entre * 0.8 + indice * entre, { align: "center" });
        } else {
          pdf.text(linha, xEsq(), estado.y + entre * 0.8 + indice * entre);
        }
      });
      estado.y += linhas.length * entre + 2;
    },

    /**
     * Uma linha do formulário: rótulo em negrito e o valor sobre a linha
     * pontilhada, como em "REQUISITANTE: ______".
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

    /**
     * AS OPÇÕES DO FORMULÁRIO, uma por linha, com a caixa do modelo.
     *
     * As quatro da requisição e as duas da liquidação passam por aqui: todas
     * saem sempre, a escolhida com o "X" e as outras em branco.
     */
    opcoes(lista, { marca = "[", fecha = "]" } = {}) {
      const entre = 4.6;
      pdf.setFont("courier", "bold");
      pdf.setFontSize(10);
      const largCaixa = pdf.getTextWidth(`${marca}  X  ${fecha} `);

      lista.forEach((opcao) => {
        pdf.setFont("helvetica", opcao.marcado ? "bold" : "normal");
        pdf.setFontSize(10);
        const linhas = pdf.splitTextToSize(String(opcao.rotulo ?? ""), largUtil() - largCaixa);
        this.espaco(linhas.length * entre + 1.6);

        pdf.setFont("courier", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(...TINTA.navy);
        pdf.text(opcao.marcado ? `${marca} X ${fecha}` : `${marca}    ${fecha}`, xEsq(), estado.y + 3.4);

        pdf.setFont("helvetica", opcao.marcado ? "bold" : "normal");
        pdf.setFontSize(10);
        linhas.forEach((linha, indice) => {
          pdf.text(linha, xEsq() + largCaixa, estado.y + 3.4 + indice * entre);
        });

        estado.y += linhas.length * entre + 1.6;
      });
      estado.y += 1;
    },

    /**
     * Um quadro do formulário: cabeçalho das colunas e UMA linha de conteúdo.
     *
     * É o quadro do FAVORECIDO da página 2 ("Favorecido(a) | Dados bancários |
     * Valor"), com as partes rotuladas empilhadas dentro de cada célula.
     */
    quadro(colunas) {
      const alturaCabecalho = 8;
      const entre = 3.9;

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

      // Cabeçalho, com a linha de ajuda do modelo ("(Nome e endereço completos)").
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
        pdf.text(String(colunas[indice].rotulo).toUpperCase(), x + 2, estado.y + 3.4);
        const ajuda = texto(colunas[indice].ajuda);
        if (ajuda !== "") {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(6.5);
          pdf.setTextColor(...TINTA.apoio);
          pdf.text(
            pdf.splitTextToSize(ajuda, coluna.larguraColuna - 4)[0] ?? "",
            x + 2, estado.y + 6.4,
          );
        }
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
     * O QUADRO RESUMO: rótulo à esquerda, conteúdo à direita, uma linha por
     * item (REFERÊNCIA, FUNDAMENTAÇÃO, ÓRGÃO REQUISITANTE).
     */
    quadroResumo(linhas) {
      const entre = 3.9;
      const largRotulo = largUtil() * 0.32;
      const largValor = largUtil() - largRotulo;

      linhas.forEach((item) => {
        const escritas = pdf.splitTextToSize(String(item.valor ?? SEM_REGISTRO), largValor - 4);
        const altura = Math.max(8, escritas.length * entre + 3.4);
        this.espaco(altura + 2);

        pdf.setDrawColor(...TINTA.navy);
        pdf.setLineWidth(0.25);
        pdf.setFillColor(...TINTA.faixa);
        pdf.rect(xEsq(), estado.y, largRotulo, altura, "F");
        pdf.rect(xEsq(), estado.y, largRotulo, altura);
        pdf.rect(xEsq() + largRotulo, estado.y, largValor, altura);

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7.5);
        pdf.setTextColor(...TINTA.navy);
        pdf.text(String(item.rotulo).toUpperCase(), xEsq() + 2, estado.y + 4.6);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        escritas.forEach((linha, indice) => {
          pdf.text(linha, xEsq() + largRotulo + 2, estado.y + 4.4 + indice * entre);
        });

        estado.y += altura;
      });
      estado.y += 2;
    },

    /**
     * O QUADRO DESCRITIVO da página 1: cabeçalho das colunas e N LINHAS.
     *
     * ⚠️ TRÊS COLUNAS -- ITEM, QUANT. e DISCRIMINAÇÃO --, NENHUMA DE VALOR.
     *
     * Com poucos itens o quadro sai compacto; com muitos, ele CONTINUA na folha
     * seguinte, repetindo o cabeçalho das colunas. Nenhum item é cortado ao meio
     * e a fonte NÃO diminui: o corpo do texto é o mesmo do resto do documento,
     * qualquer que seja a quantidade de itens.
     */
    tabelaDeItens(itens) {
      const entre = 4.2;
      const alturaCabecalho = 6;
      const proporcoes = [0.12, 0.16, 0.72];

      const desenharCabecalho = () => {
        this.espaco(alturaCabecalho + 10);
        let x = xEsq();
        pdf.setFillColor(...TINTA.faixa);
        pdf.rect(xEsq(), estado.y, largUtil(), alturaCabecalho, "F");
        pdf.setDrawColor(...TINTA.navy);
        pdf.setLineWidth(0.25);
        ["Item", "Quant.", "Discriminação"].forEach((rotulo, indice) => {
          const larguraColuna = largUtil() * proporcoes[indice];
          pdf.rect(x, estado.y, larguraColuna, alturaCabecalho);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(7.5);
          pdf.setTextColor(...TINTA.navy);
          pdf.text(rotulo.toUpperCase(), x + 2, estado.y + 4);
          x += larguraColuna;
        });
        estado.y += alturaCabecalho;
      };

      desenharCabecalho();

      itens.forEach((item) => {
        const largDiscriminacao = largUtil() * proporcoes[2] - 4;
        const escritas = pdf.splitTextToSize(texto(item.discriminacao), largDiscriminacao);
        const altura = Math.max(8, escritas.length * entre + 3.2);

        // Item que não cabe na folha vai INTEIRO para a folha seguinte, com o
        // cabeçalho das colunas repetido -- nunca partido ao meio.
        if (estado.y + altura > limite) {
          rodapeInstitucional();
          pdf.addPage();
          estado.folhasUsadas += 1;
          cabecalho(true);
          desenharCabecalho();
        }

        let x = xEsq();
        pdf.setDrawColor(...TINTA.navy);
        pdf.setLineWidth(0.25);
        proporcoes.forEach((proporcao) => {
          const larguraColuna = largUtil() * proporcao;
          pdf.rect(x, estado.y, larguraColuna, altura);
          x += larguraColuna;
        });

        const meio = (proporcao, anterior) => xEsq() + largUtil() * (anterior + proporcao / 2);

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9.5);
        pdf.setTextColor(...TINTA.navy);
        pdf.text(texto(item.numero), meio(proporcoes[0], 0), estado.y + 5.4, { align: "center" });

        pdf.setFont("helvetica", "normal");
        pdf.text(texto(item.quantidade), meio(proporcoes[1], proporcoes[0]), estado.y + 5.4, { align: "center" });

        escritas.forEach((linha, indice) => {
          pdf.text(
            linha,
            xEsq() + largUtil() * (proporcoes[0] + proporcoes[1]) + 2,
            estado.y + 5.2 + indice * entre,
          );
        });

        estado.y += altura;
      });

      estado.y += 2;
    },

    /** "São José da Laje/AL, 10 de março de 2026", centralizado. */
    localData(conteudo) {
      this.espaco(12);
      this.respiro(5);
      this.paragrafo(conteudo, { centralizado: true });
    },

    /**
     * Uma área de assinatura: o vão para assinar à mão, o traço, o nome gravado
     * e o rótulo do papel.
     */
    assinatura({ nome = "", papel = "", cargo = "", aoPe = false } = {}) {
      const vaoDaCaneta = 10;
      const peDaLinha = 8;
      const linhaDoCargo = texto(cargo) ? 3 : 0;
      const altura = vaoDaCaneta + peDaLinha + linhaDoCargo;
      this.espaco(altura + 2);
      const piso = limite - altura;
      if (aoPe && estado.y < piso) estado.y = piso;

      const larguraCampo = Math.min(95, largUtil());
      const centro = xEsq() + largUtil() / 2;

      estado.y += vaoDaCaneta;
      pdf.setDrawColor(...TINTA.navy);
      pdf.setLineWidth(0.3);
      pdf.line(centro - larguraCampo / 2, estado.y, centro + larguraCampo / 2, estado.y);

      const escrito = texto(nome);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(...TINTA.navy);
      pdf.text(escrito === "" || escrito === SEM_REGISTRO ? " " : escrito, centro, estado.y + 3.4, { align: "center" });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...TINTA.apoio);
      pdf.splitTextToSize(String(papel), largUtil()).slice(0, 1).forEach((linha) => {
        pdf.text(linha, centro, estado.y + 7, { align: "center" });
      });
      if (linhaDoCargo > 0) {
        pdf.setFontSize(7);
        pdf.text(texto(cargo), centro, estado.y + 10, { align: "center" });
      }

      estado.y += peDaLinha + linhaDoCargo;
    },

    /**
     * Uma moldura em volta de um bloco do formulário (a autorização da
     * prefeita). O conteúdo é desenhado com recuo, para não encostar na borda.
     */
    moldura(rotulo, desenhar) {
      this.espaco(50);
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
      pdf.rect(xBase(), inicio, largBase(), estado.y - inicio);
      estado.recuo = 0;
      estado.y += 2;
    },

    /**
     * DUAS ÁREAS LADO A LADO, na MESMA faixa horizontal.
     *
     * É a base do fim da página 1: o REQUISITANTE à esquerda e a AUTORIZAÇÃO DA
     * PREFEITA à direita, uma ao lado da outra. Empilhadas, as duas gastavam o
     * dobro da altura e empurravam o documento para uma segunda folha.
     *
     * As duas colunas começam no MESMO y; a faixa termina na mais alta das duas,
     * e a folha é garantida ANTES de a faixa começar, para nenhuma das metades
     * sobrar para a folha seguinte.
     */
    faixaLadoALado({ esquerda, direita, proporcao = 0.5, vao = 6, altura = 62 } = {}) {
      this.espaco(altura + 2);
      const topo = estado.y;
      const largEsquerda = (util - vao) * proporcao;
      const largDireita = util - vao - largEsquerda;

      const desenharColuna = (x, larg, desenhar) => {
        estado.colX = x;
        estado.colLarg = larg;
        estado.y = topo;
        estado.travado = true;
        if (typeof desenhar === "function") desenhar();
        estado.travado = false;
        const fim = estado.y;
        estado.colX = 0;
        estado.colLarg = 0;
        return fim;
      };

      const fimEsquerda = desenharColuna(margem, largEsquerda, esquerda);
      const fimDireita = desenharColuna(margem + largEsquerda + vao, largDireita, direita);

      estado.y = Math.max(fimEsquerda, fimDireita);
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

/**
 * Página 1: REQUISIÇÃO DE MATERIAL/SERVIÇO.
 *
 * ⚠️ SEM VALORES. Nenhuma chamada desta função imprime moeda: o quadro tem
 * ITEM, QUANT. e DISCRIMINAÇÃO, e mais nada.
 */
function paginaRequisicaoPdf(pincel, dados) {
  pincel.abrirPagina(TITULO_PAGINA_1);
  pincel.aviso(textoDoAviso(dados));

  pincel.respiro(2);
  pincel.linha("REQUISITANTE:", dados.requisitante);
  pincel.respiro(1);
  pincel.paragrafo("A: Senhora Prefeita.", { negrito: true });
  pincel.respiro(1);
  pincel.paragrafo("Pelo presente, venho solicitar AUTORIZAÇÃO para:");

  // AS QUATRO OPÇÕES: a escolhida marcada, as outras em branco.
  pincel.opcoes(dados.requisicao.opcoes);
  pincel.paragrafo("... do que se descreve abaixo:");

  pincel.secao("Quadro Descritivo");
  pincel.tabelaDeItens(dados.requisicao.itens);

  pincel.localData(dados.requisicao.localEData);

  // ⚠️ AS DUAS ÁREAS DE ASSINATURA SAEM LADO A LADO, na mesma faixa: o
  // REQUISITANTE à esquerda e a AUTORIZAÇÃO DA PREFEITA à direita. Uma abaixo da
  // outra gastava o dobro da altura e jogava a requisição para uma segunda
  // folha. ⚠️ Isto é da REQUISIÇÃO: nas DIÁRIAS as assinaturas continuam uma
  // abaixo da outra, como definido lá.
  pincel.faixaLadoALado({
    // O quadro da prefeita fica um pouco mais largo: é ele que tem texto dentro.
    proporcao: 0.42,
    // O respiro à esquerda é o que deixa a linha de assinatura do requisitante
    // na mesma altura da linha da prefeita, dentro do quadro ao lado.
    esquerda: () => {
      pincel.respiro(35);
      pincel.assinatura({
        nome: dados.assinaturas.requisitante.nome,
        papel: "(assinatura, nome e identificação funcional do requisitante)",
        cargo: dados.assinaturas.requisitante.cargo,
      });
    },
    direita: () => {
      pincel.moldura("Autorização da prefeita", () => {
        pincel.paragrafo("CIENTE/AUTORIZO", { negrito: true });
        pincel.linha(DESPACHO_PAGINA_1, dados.requisicao.despacho);
        pincel.paragrafo("Para providências que o caso requer");
        pincel.paragrafo(dados.requisicao.emData);
        // Nome e cargo saem do cadastro da prefeita, sem redigitação.
        pincel.assinatura({
          nome: dados.prefeita.nome,
          papel: "PREFEITA",
          cargo: dados.prefeita.cargo,
        });
      });
    },
  });

  pincel.fecharPagina();
}

/** Página 2: LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO. */
function paginaLiquidacaoPdf(pincel, dados) {
  pincel.abrirPagina(TITULO_PAGINA_2);
  pincel.aviso(textoDoAviso(dados));

  pincel.respiro(2);
  pincel.linha("REQUISITANTE:", dados.requisitante);
  pincel.respiro(1);
  pincel.paragrafo("A: Senhora Prefeita.", { negrito: true });
  pincel.respiro(1);
  pincel.paragrafo(
    "Pelo presente, venho solicitar AUTORIZAÇÃO de pagamento em favor do(a) beneficiário(a) abaixo "
    + "identificado(a), o(a) qual:",
  );

  // AS DUAS ATESTAÇÕES: a escolhida marcada, a outra em branco.
  pincel.opcoes(dados.liquidacao.opcoes, { marca: "(", fecha: ")" });

  pincel.secao("Quadro Resumo");
  pincel.quadroResumo([
    { rotulo: "Referência", valor: dados.liquidacao.referencia },
    { rotulo: "Fundamentação", valor: dados.liquidacao.fundamentacao },
    { rotulo: "Órgão requisitante", valor: dados.liquidacao.orgao },
  ]);

  pincel.respiro(1);
  pincel.quadro([
    {
      rotulo: "Favorecido(a)",
      ajuda: "(Nome e endereço completos)",
      largura: 0.4,
      partes: [
        { rotulo: "Nome/Razão social", valor: dados.favorecido.nome, negrito: true },
        { rotulo: "CPF/CNPJ", valor: dados.favorecido.cpfCnpj },
        { rotulo: "Endereço", valor: dados.favorecido.endereco },
      ],
    },
    {
      rotulo: "Dados bancários",
      ajuda: "(banco, agência e conta corrente)",
      largura: 0.32,
      partes: [
        { rotulo: "Banco", valor: dados.banco.banco },
        { rotulo: "AG", valor: dados.banco.agencia },
        { rotulo: "C", valor: dados.banco.conta },
        { rotulo: "Chave PIX", valor: dados.banco.pix },
      ],
    },
    {
      rotulo: "Valor",
      ajuda: "(em algarismo e por extenso)",
      largura: 0.28,
      partes: [
        { valor: `R$ ${dados.valor.algarismo}`, negrito: true },
        { rotulo: "Por extenso", valor: dados.valor.extenso },
      ],
    },
  ]);

  pincel.moldura("Autorização da prefeita", () => {
    pincel.paragrafo("CIENTE/AUTORIZO", { negrito: true });
    pincel.paragrafo(`À ${dados.liquidacao.destino}`);
    pincel.paragrafo(`Para providências que o caso requer     ${dados.liquidacao.emData}`);
    // A caixa desta folha é larga: cabe o CPF junto do cargo na identificação.
    pincel.assinatura({
      nome: dados.prefeita.nome,
      papel: "PREFEITA",
      cargo: [dados.prefeita.cargo, dados.prefeita.cpf === "" ? "" : `CPF: ${dados.prefeita.cpf}`]
        .filter((parte) => parte !== "")
        .join(" — "),
    });
  });

  pincel.localData(dados.liquidacao.localEData);
  pincel.assinatura({
    nome: dados.assinaturas.liquidacao.nome,
    papel: "Assinatura",
    cargo: dados.assinaturas.liquidacao.cargo,
  });

  pincel.fecharPagina();
}

const FOLHAS_PDF = {
  requisicao: paginaRequisicaoPdf,
  liquidacao: paginaLiquidacaoPdf,
};

/**
 * O PDF do processo: UM ÚNICO ARQUIVO com as duas páginas.
 *
 * Desenhado com as primitivas do jsPDF, em milímetros sobre A4 -- não é imagem
 * da tela. Cada documento entra por `addPage()` incondicional, então a
 * Liquidação SEMPRE começa em página nova.
 */
export function montarPdfDoProcesso(dados, { escopo = "completo" } = {}) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pincel = criarPincel(pdf, dados);

  folhasDoEscopo(escopo).forEach((folha) => {
    (FOLHAS_PDF[folha] ?? paginaRequisicaoPdf)(pincel, dados);
  });

  return pdf;
}

/** Gera e baixa o PDF. */
export function gerarPdfDoProcesso(dados, { escopo = "completo" } = {}) {
  const pdf = montarPdfDoProcesso(dados, { escopo });
  pdf.save(nomeDoArquivo(dados, "pdf", escopo));
}
