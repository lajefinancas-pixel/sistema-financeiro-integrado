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
  complementoDoEncaminhamentoDaLiquidacao,
} from "./processosEncaminhamento.js";
import {
  IDENTIDADE_PADRAO,
  identidadeDoProcesso,
  logoDoDocumento,
} from "./processosIdentidade.js";
// ⚠️ O CABEÇALHO, O RODAPÉ, AS ASSINATURAS E AS REGRAS DE DATA VÊM DAQUI, e não
// deste arquivo: são as mesmas dos cinco documentos do módulo. Nada disto é
// copiado documento a documento -- corrigir o layout é mexer no arquivo comum,
// e a correção vale para as diárias na mesma hora.
import {
  COR,
  DESPACHO_PREFEITA,
  MUNICIPIO as MUNICIPIO_COMUM,
  SEM_REGISTRO as SEM_REGISTRO_COMUM,
  TINTA,
  avisoHtml,
  cabecalhoHtml,
  criarPincelBase,
  emData,
  escapar,
  estilosComuns,
  faixaDeAssinaturasHtml,
  ladoDoRequisitanteHtml,
  localEData,
  ou,
  quadroDaPrefeitaHtml,
  rodapeHtml,
  texto,
  textoDoAviso,
} from "./processosDocumentoComum.js";
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
export const MUNICIPIO = MUNICIPIO_COMUM;

/** A secretaria a quem a autorização da prefeita é destinada (página 2). */
export const SECRETARIA_DE_FINANCAS = "SECRETARIA DE FINANÇAS";

/**
 * O destino da autorização, completado com a secretaria do encaminhamento.
 *
 * É o MESMO texto nas quatro folhas que têm autorização da prefeita, vindo do
 * arquivo comum -- e não mais um por documento.
 */
export const DESPACHO_PAGINA_1 = DESPACHO_PREFEITA;

export const SEM_REGISTRO = SEM_REGISTRO_COMUM;

/** Os três escopos de saída: o processo completo ou um documento só. */
export const ESCOPOS = [
  { id: "completo", rotulo: "Processo completo (2 páginas)" },
  { id: "requisicao", rotulo: "Somente a Requisição" },
  { id: "liquidacao", rotulo: "Somente a Liquidação" },
];

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

/** O valor em algarismo, como o modelo pede: "R$ 1.250,00" sai como "1.250,00". */
function moedaSimples(valor) {
  return formatBRLSimples(paraNumeroMoeda(valor));
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
 * O complemento de "À SECRETARIA DE ___" na autorização da página 1.
 *
 * É A SECRETARIA DO ENCAMINHAMENTO -- a que a prefeita manda providenciar --, e
 * não a solicitante. Ela sai do que o processo GRAVOU; sem nada gravado, o
 * documento cai no que já fazia antes e, no limite, escreve Finanças. ⚠️ Este
 * campo NÃO SAI EM BRANCO no papel.
 */
function destinoDoDespacho(processo, secretaria) {
  return complementoDoEncaminhamento(processo, secretaria);
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
      // A SECRETARIA DO ENCAMINHAMENTO DESTA FOLHA, no MESMO formato da página
      // 1: só o núcleo, porque o "À SECRETARIA DE" já está impresso no quadro.
      // ⚠️ É A ESCOLHA DA LIQUIDAÇÃO, não a da requisição: as duas folhas têm
      // campo próprio, e esta tem FINANÇAS por padrão -- é quem paga, e é o que
      // o modelo oficial já traz impresso. NUNCA SAI EM BRANCO no papel.
      destino: complementoDoEncaminhamentoDaLiquidacao(p),
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

/**
 * O CSS da folha: o comum dos cinco documentos mais os quadros que só este tem.
 *
 * ⚠️ O cabeçalho, o aviso, a linha de local e data, AS ASSINATURAS, a caixa da
 * prefeita, a faixa lado a lado e o rodapé vêm de `estilosComuns()`. Eles não
 * são redefinidos aqui: é um só layout para os cinco documentos.
 */
function estilos() {
  return `
    ${estilosComuns()}

    .linha-doc { margin: 3.4mm 0 0; }
    .linha-doc b { letter-spacing: .04em; }
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
  `;
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

    // ⚠️ LADO A LADO: à ESQUERDA o local, a data DESTA folha e a assinatura do
    // requisitante com NOME, CARGO e CPF; à DIREITA a autorização da prefeita,
    // na MESMA faixa horizontal. O layout sai do arquivo comum.
    + faixaDeAssinaturasHtml({
      esquerda: ladoDoRequisitanteHtml({
        localEData: dados.requisicao.localEData,
        assinatura: dados.assinaturas.requisitante,
      }),
      direita: quadroDaPrefeitaHtml({
        prefeita: dados.prefeita,
        destino: dados.requisicao.despacho,
        em: dados.requisicao.emData,
      }),
    })

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

    // ⚠️ A MESMA FAIXA DA PÁGINA 1, e pelo mesmo motivo: empilhadas, a
    // assinatura de quem solicita e a autorização da prefeita gastavam o dobro
    // da altura e empurravam a liquidação para uma segunda folha.
    + faixaDeAssinaturasHtml({
      esquerda: ladoDoRequisitanteHtml({
        localEData: dados.liquidacao.localEData,
        assinatura: dados.assinaturas.liquidacao,
      }),
      direita: quadroDaPrefeitaHtml({
        prefeita: dados.prefeita,
        destino: dados.liquidacao.destino,
        em: dados.liquidacao.emData,
      }),
    })

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
 * O desenhista de uma folha dos documentos de material/serviço.
 *
 * ⚠️ O MIOLO É COMPARTILHADO: cabeçalho, brasão, rodapé institucional, quebra
 * de folha, local/data, assinatura com identificação, moldura, quadro da
 * prefeita e faixa lado a lado vivem em processosDocumentoComum.js e são os
 * MESMOS dos cinco documentos do módulo. Aqui ficam só os blocos que existem
 * apenas neste formulário: as opções com caixa, o quadro do favorecido, o
 * quadro resumo e a tabela de itens.
 */
function criarPincel(pdf, dados) {
  const base = criarPincelBase(pdf, dados);
  const { estado, limite, xEsq, largUtil } = base;

  return {
    ...base,

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
        // cabeçalho das colunas repetido -- nunca partido ao meio. A quebra é a
        // do arquivo comum (rodapé + folha de continuação); aqui só se repete o
        // cabeçalho quando ela aconteceu.
        if (estado.y + altura > limite) {
          const folhasAntes = estado.folhasUsadas;
          this.espaco(altura);
          if (estado.folhasUsadas !== folhasAntes) desenharCabecalho();
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
  };
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

  // ⚠️ AS DUAS ÁREAS DE ASSINATURA SAEM LADO A LADO, na mesma faixa: o
  // REQUISITANTE à esquerda -- com o local, a data DESTA folha e a
  // identificação abaixo do traço -- e a AUTORIZAÇÃO DA PREFEITA à direita. Uma
  // abaixo da outra gastava o dobro da altura e jogava a requisição para uma
  // segunda folha. O desenho é o do arquivo comum, o mesmo das outras folhas.
  // ⚠️ Isto é da REQUISIÇÃO DE MATERIAL/SERVIÇO: na REQUISIÇÃO DE DIÁRIAS as
  // três assinaturas continuam uma abaixo da outra, como definido lá.
  pincel.faixaDeAssinaturas({
    localEData: dados.requisicao.localEData,
    assinatura: dados.assinaturas.requisitante,
    prefeita: dados.prefeita,
    destino: dados.requisicao.despacho,
    em: dados.requisicao.emData,
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

  // ⚠️ A MESMA FAIXA DA PÁGINA 1: quem solicita à esquerda, a autorização da
  // prefeita à direita. Empilhadas, as duas gastavam a folha inteira.
  pincel.faixaDeAssinaturas({
    localEData: dados.liquidacao.localEData,
    assinatura: dados.assinaturas.liquidacao,
    prefeita: dados.prefeita,
    destino: dados.liquidacao.destino,
    em: dados.liquidacao.emData,
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
