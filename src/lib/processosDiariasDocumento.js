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
// O PAPEL NÃO TRAZ O NÚMERO DO PROCESSO NEM NUMERAÇÃO DE FOLHAS. O número
// continua existindo no sistema -- é por ele que se controla, se busca e se
// lista o processo, e é ele que nomeia o arquivo do PDF --, mas não é impresso
// em lugar nenhum do documento, nem no cabeçalho nem no rodapé. "Página 1 de 3"
// e "Folha 1" também não saem: o modelo oficial da prefeitura não os tem.
//
// PAGINAÇÃO. A regra de quebra não mudou: cada documento começa em folha
// PRÓPRIA -- na impressão pelo `page-break-after` da folha, no PDF por um
// `addPage()` incondicional. No uso normal o processo completo sai em exatamente
// três páginas; conteúdo excepcionalmente grande transborda para uma folha a
// mais em vez de ser cortado: informação do documento não é truncada para
// forçar três páginas.
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
  dataDaLiquidacao,
  dataDaPrestacao,
  dataDaRequisicao,
  dataDasDiarias,
  nomeDaSecretaria,
  numeroDoProcesso,
  quantidadeDeDiarias,
  relatorioDaPrestacao,
  situacaoInfo,
  valorExtensoDoProcesso,
} from "./processosDiarias.js";
import {
  IDENTIDADE_PADRAO,
  identidadeDoProcesso,
  logoDoDocumento,
} from "./processosIdentidade.js";
import { prefeitaDoProcesso } from "./processosPrefeita.js";
import { tipoDiariaComposto } from "./processosDiariasTabela.js";
import { complementoDoEncaminhamento } from "./processosEncaminhamento.js";
import { bancoDoDocumento } from "./processosBancos.js";
// ⚠️ O CABEÇALHO, O RODAPÉ, AS ASSINATURAS E AS REGRAS DE DATA VÊM DAQUI, e não
// deste arquivo: são as MESMAS dos cinco documentos do módulo. Nada disto é
// copiado documento a documento -- corrigir o layout é mexer no arquivo comum,
// e a correção vale para os serviços/materiais na mesma hora.
import {
  COR,
  MUNICIPIO as MUNICIPIO_COMUM,
  SEM_REGISTRO as SEM_REGISTRO_COMUM,
  TINTA,
  assinaturaHtml,
  assinaturasEmpilhadasHtml,
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

/**
 * O rodapé institucional de fábrica, impresso em TODAS as páginas do processo.
 *
 * Três linhas, com o CEP no endereço e o CNPJ em linha própria. É o padrão do
 * módulo e vale para todos os documentos dele, atuais e futuros. Continua
 * configurável em Configurações → Processos, e processo já finalizado imprime o
 * rodapé que congelou.
 */
export const RODAPE_INSTITUCIONAL = {
  endereco: IDENTIDADE_PADRAO.rodape_endereco,
  contato: IDENTIDADE_PADRAO.rodape_contato,
  cnpj: IDENTIDADE_PADRAO.rodape_cnpj,
};

/**
 * O município que assina o documento, nas linhas de "Local e data".
 *
 * ⚠️ VEM DO ARQUIVO COMUM: é a MESMA grafia nos cinco documentos do módulo.
 * Antes as diárias escreviam "São José da Laje - AL" e os serviços
 * "São José da Laje/AL"; agora as duas saem iguais.
 */
export const MUNICIPIO = MUNICIPIO_COMUM;

/** A secretaria a quem a autorização da prefeita é destinada (página 2). */
export const SECRETARIA_DE_FINANCAS = "Secretaria Municipal de Finanças";

export const SEM_REGISTRO = SEM_REGISTRO_COMUM;

/** Os quatro escopos de saída: o processo completo ou um documento só. */
export const ESCOPOS = [
  { id: "completo", rotulo: "Processo completo (3 páginas)" },
  { id: "requisicao", rotulo: "Somente a Requisição" },
  { id: "liquidacao", rotulo: "Somente a Liquidação" },
  { id: "prestacao", rotulo: "Somente a Prestação de Contas" },
];

/** O espaçamento das linhas do RELATÓRIO DE ATIVIDADES, em milímetros. */
const PAUTA = 7;

/* -------------------------------------------------------------------------
 * Dados do documento
 * ---------------------------------------------------------------------- */

function moeda(valor) {
  return formatBRL(paraNumeroMoeda(valor));
}

function moedaSimples(valor) {
  return formatBRLSimples(paraNumeroMoeda(valor));
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
function logoAceito(logo, enderecoDaFolha) {
  if (!logo || !logo.dataUrl) return null;
  const origem = texto(logo.url);
  if (origem === "") return null;
  return origem === texto(enderecoDaFolha) ? logo : null;
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

/**
 * Tudo o que as três páginas mostram, lido UMA VEZ do processo.
 *
 * Os dados compartilhados aparecem em mais de uma página porque são os MESMOS
 * dados -- não há cópia aqui, só leitura do mesmo registro. É o que garante que
 * o nome do servidor na Requisição e o favorecido da Liquidação nunca divirjam.
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
  // O ENDEREÇO DA IMAGEM QUE ESTA FOLHA IMPRIME, resolvido uma única vez:
  // a imagem da identidade dos Processos, senão a logomarca cadastrada do
  // sistema (Configurações → Aparência), senão o brasão do repositório.
  const logoEndereco = logoDoDocumento(identidadeDaFolha, logoSistema);

  return {
    // ⚠️ A IDENTIDADE VISUAL DA FOLHA. Processo já finalizado imprime a que ele
    // congelou; rascunho imprime a vigente. Trocar o brasão ou o rodapé hoje
    // não reescreve o documento emitido antes -- a mesma regra dos dados do
    // secretário e da prefeita.
    identidade: identidadeDaFolha,
    // A imagem do cabeçalho. Imagem cadastrada tem preferência sobre o desenho
    // embutido no código, que é último recurso.
    logoEndereco,
    // A versão rasterizada do brasão, quando a tela conseguiu preparar uma: é o
    // que faz o PDF sair sem serrilhado. Só é aceita se tiver sido preparada a
    // partir da MESMA imagem que esta folha deve imprimir -- assim um processo
    // que congelou o brasão antigo não sai com o brasão novo por atalho.
    logo: logoAceito(logo, logoEndereco),

    // ⚠️ A PREFEITA QUE AUTORIZA. Processo já finalizado imprime a que ele
    // congelou; rascunho imprime a vigente no cadastro. Trocar o cadastro
    // (mudança de gestão) NÃO reescreve documento já finalizado.
    prefeita: prefeitaDoProcesso(p, prefeita),

    numero: numeroDoProcesso(p) || SEM_REGISTRO,
    ano: p.ano ?? null,
    situacao: situacaoInfo(p.situacao).rotulo,
    cancelado: texto(p.situacao) === "cancelada",
    rascunho: texto(p.situacao) === "rascunho",
    motivoCancelamento: texto(p.motivo_cancelamento),
    data: dataBR(p.data_processo) || SEM_REGISTRO,
    secretaria: ou(secretaria),
    requisitante: requisitanteDe(secretaria),
    // Emissão e emissor NÃO saem no papel: são informação de sistema. Ficam no
    // dado do documento porque o histórico do processo, dentro do sistema, os
    // mostra na tela -- e só ali.
    emissao: emissao || agoraBR(),
    emissor: ou(emissor),

    // PÁGINA 1 — o que se requisita.
    requisicao: {
      lei: LEI_DAS_DIARIAS,
      quantidade: quantidadeNumero(p.quantidade_diarias),
      custeio: ou(p.custeio_despesas),
      objetivando: objetivandoDe(p),
      dataDiarias: ou(dataDasDiarias(p)),
      // A DATA DESTA FOLHA, no MESMO formato das outras quatro. Em branco, a
      // folha cai na data de abertura do processo, que é o que ela sempre
      // imprimiu.
      localEData: localEData(dataDaRequisicao(p), p.ano),
      emData: emData(dataDaRequisicao(p)),
      // A secretaria do encaminhamento, para o despacho "À SECRETARIA DE ___".
      // ⚠️ NÃO é a secretaria solicitante: vem do cadastro do módulo
      // FINANCEIRO, apenas lido. Nunca sai em branco no papel.
      despacho: complementoDoEncaminhamento(p, secretaria),
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

    // QUEM ASSINA, quando o processo identificou a pessoa.
    //
    // É conteúdo GRAVADO no processo, não uma leitura do cadastro de
    // servidores: documento antigo continua mostrando quem assinou naquele
    // momento, mesmo que o cargo da pessoa mude depois. Em branco, a linha sai
    // só com o traço, para assinar à mão -- como sempre saiu.
    assinaturas: {
      // O SERVIDOR que pede a diária: nome, cargo e CPF saem do próprio
      // processo, que os gravou do cadastro de servidores.
      servidor: {
        nome: texto(p.beneficiario_nome),
        cargo: texto(p.beneficiario_cargo),
        cpf: texto(p.beneficiario_cpf),
      },
      secretaria: {
        nome: texto(p.assinante_secretaria_nome),
        cpf: texto(p.assinante_secretaria_cpf),
        cargo: texto(p.assinante_secretaria_cargo),
      },
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
      // "001 — Banco do Brasil": número e nome juntos, como no modelo oficial.
      // Registro antigo, gravado quando o banco era texto livre, continua
      // saindo só com o nome -- não havia número escolhido naquela época.
      banco: ou(bancoDoDocumento(p)),
      codigo: texto(p.banco_codigo),
      nome: texto(p.banco),
      agencia: ou(p.agencia),
      conta: ou(p.conta),
      pix: ou(p.pix),
      titular: ou(p.titular),
    },

    // PÁGINA 2 — a data da LIQUIDAÇÃO. Cada página assina com a data DELA: em
    // branco, a página 2 sai com a data do processo, que é o comportamento que
    // ela sempre teve.
    liquidacao: {
      data: texto(p.liquidacao_data),
      localEData: localEData(dataDaLiquidacao(p), p.ano),
      emData: emData(dataDaLiquidacao(p)),
      // A SECRETARIA DO ENCAMINHAMENTO desta folha -- a que a prefeita manda
      // providenciar o pagamento. Só o NÚCLEO do nome, porque o "À SECRETARIA
      // DE" já vem impresso no quadro comum. O modelo oficial traz Finanças, e
      // Finanças continua sendo o padrão quando nada foi escolhido. ⚠️ Ela não
      // é a secretaria solicitante: vem do cadastro do módulo FINANCEIRO, só
      // lido, e NUNCA sai em branco no papel.
      destino: complementoDoEncaminhamento(p),
    },

    // PÁGINA 3 — a prestação de contas, que pode estar pendente.
    prestacao: {
      relatorio: relatorioDaPrestacao(p),
      data: texto(p.prestacao_data),
      // Esta folha NÃO cai para a data de abertura: a prestação de contas
      // acontece depois da viagem, e sem data ela sai com as linhas em branco.
      localEData: localEData(dataDaPrestacao(p), p.ano),
    },

    // A data da PÁGINA 1, repetida no topo por compatibilidade com quem já a
    // lia daqui. O valor é o mesmo de `requisicao.localEData`.
    localEData: localEData(dataDaRequisicao(p), p.ano),
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

/**
 * O CSS da folha.
 *
 * ⚠️ A BASE VEM DO ARQUIVO COMUM -- página, cabeçalho, aviso, local/data,
 * assinaturas (empilhadas, única e na faixa lado a lado), caixa de autorização
 * da prefeita e rodapé. Aqui ficam SÓ os blocos que existem apenas nos
 * documentos de diária: a grade de identificação do servidor, os quadros e o
 * relatório pautado.
 */
function estilos() {
  return `${estilosComuns()}

    h2 { margin: 4mm 0 1.6mm; padding: 1.2mm 2mm; background: ${COR.navy}; color: #fff; font-size: 8pt;
      font-weight: bold; letter-spacing: .1em; text-transform: uppercase; }

    .abertura { margin: 4mm 0 0; text-align: justify; }
    .linha-doc { margin: 2.6mm 0 0; }
    .linha-doc b { letter-spacing: .02em; }
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
  `;
}

function campo(rotulo, valor, classe = "c50", forte = false) {
  return `<div class="campo ${classe}${forte ? " forte" : ""}">`
    + `<span class="rotulo">${escapar(rotulo)}</span>`
    + `<span class="valor">${escapar(valor)}</span></div>`;
}

/** Página 1: REQUISIÇÃO DE DIÁRIAS. */
function folhaRequisicao(dados) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_1)
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

    + `<p class="local-data">${escapar(dados.requisicao.localEData)}</p>`

    // ⚠️ AS TRÊS ASSINATURAS, UMA EMBAIXO DA OUTRA -- a EXCEÇÃO do módulo. Nas
    // outras folhas com autorização da prefeita elas saem lado a lado; aqui o
    // modelo oficial as tem empilhadas (servidor, responsável pela secretaria e
    // prefeita), e é assim que continuam saindo. Abaixo de cada traço vêm NOME,
    // CARGO e CPF -- a linha do CPF só quando o cadastro tem CPF.
    + assinaturasEmpilhadasHtml([
      {
        nome: dados.assinaturas.servidor.nome,
        papel: "Assinatura do Servidor",
        cargo: dados.assinaturas.servidor.cargo,
        cpf: dados.assinaturas.servidor.cpf,
      },
      {
        nome: dados.assinaturas.secretaria.nome,
        papel: "Responsável pela Secretaria",
        cargo: dados.assinaturas.secretaria.cargo,
        cpf: dados.assinaturas.secretaria.cpf,
      },
      {
        nome: dados.prefeita.nome,
        papel: "Assinatura da Prefeita",
        cargo: dados.prefeita.cargo,
        cpf: dados.prefeita.cpf,
      },
    ])

    + rodapeHtml(dados)
    + `</div>`;
}

/** Página 2: LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO (sempre em folha nova). */
function folhaLiquidacao(dados) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_2)
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

    // ⚠️ ESQUERDA e DIREITA na MESMA faixa, como nas folhas de
    // material/serviço: à esquerda o local, a data DESTA folha e o traço de quem
    // atesta, com NOME, CARGO e CPF abaixo; à direita a caixa de autorização da
    // prefeita. Empilhados, os dois blocos gastavam a folha inteira, e a
    // identificação da prefeita saía em linhas "Nome: ___ / CPF: ___ / Cargo:
    // ___" para completar à mão, que o cadastro já dispensa.
    + faixaDeAssinaturasHtml({
      esquerda: ladoDoRequisitanteHtml({
        localEData: dados.liquidacao.localEData,
        assinatura: {
          nome: dados.assinaturas.secretaria.nome,
          cargo: dados.assinaturas.secretaria.cargo,
          cpf: dados.assinaturas.secretaria.cpf,
        },
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

/** Página 3: PRESTAÇÃO DE CONTAS DE DIÁRIAS (sempre em folha nova). */
function folhaPrestacao(dados) {
  return `<div class="folha">`
    + cabecalhoHtml(dados, TITULO_PAGINA_3)
    + avisoHtml(dados)

    + `<h2>Relatório de Atividades</h2>`
    + `<div class="pautado">${escapar(dados.prestacao.relatorio)}</div>`

    + `<p class="fecho">Sem mais a acrescentar, subscrevo-me.</p>`
    + `<p class="fecho">Eis a prestação de contas, a qual submeto à apreciação e aprovação.</p>`

    + `<p class="local-data">${escapar(dados.prestacao.localEData)}</p>`

    // A PRESTAÇÃO DE CONTAS NÃO TEM AUTORIZAÇÃO DA PREFEITA: ela é o relatório
    // do servidor depois da viagem. Por isso esta folha NÃO tem a faixa lado a
    // lado -- tem uma assinatura só, no mesmo layout das outras: traço, NOME,
    // CARGO e CPF.
    + assinaturaHtml({
      nome: dados.assinaturas.servidor.nome,
      cargo: dados.assinaturas.servidor.cargo || "Cargo do(a) servidor(a)",
      cpf: dados.assinaturas.servidor.cpf,
    })

    + rodapeHtml(dados)
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
  const corpo = folhas
    .map((folha) => (FOLHAS_HTML[folha] ?? folhaRequisicao)(dados))
    .join("");

  // O título da janela de impressão. Sem o número do processo: o navegador pode
  // imprimir o título no cabeçalho da folha, e ele não deve sair no papel.
  const titulo = "Processo de Diária";
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
 * O desenhista de uma folha dos documentos de diária.
 *
 * ⚠️ O MIOLO É COMPARTILHADO: cabeçalho, brasão, rodapé institucional, quebra
 * de folha, local/data, assinatura com identificação, assinaturas empilhadas,
 * moldura, quadro da prefeita e faixa lado a lado vivem em
 * processosDocumentoComum.js e são os MESMOS dos cinco documentos do módulo.
 * Aqui ficam só os blocos que existem apenas nestes formulários: a faixa de
 * campos rotulados, os quadros e o relatório pautado.
 */
function criarPincel(pdf, dados) {
  const base = criarPincelBase(pdf, dados);
  const { estado, xEsq, largUtil } = base;

  return {
    ...base,

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
  };
}

/** Página 1: REQUISIÇÃO DE DIÁRIAS. */
function paginaRequisicaoPdf(pincel, dados) {
  pincel.abrirPagina(TITULO_PAGINA_1);
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

  pincel.localData(dados.requisicao.localEData);
  // ⚠️ AS TRÊS ASSINATURAS, UMA EMBAIXO DA OUTRA, na mesma folha -- a EXCEÇÃO
  // do módulo, como o modelo oficial desta requisição a tem. Abaixo de cada
  // traço: NOME, CARGO e CPF.
  pincel.assinaturasEmpilhadas([
    {
      nome: dados.assinaturas.servidor.nome,
      papel: "Assinatura do Servidor",
      cargo: dados.assinaturas.servidor.cargo,
      cpf: dados.assinaturas.servidor.cpf,
    },
    {
      nome: dados.assinaturas.secretaria.nome,
      papel: "Responsável pela Secretaria",
      cargo: dados.assinaturas.secretaria.cargo,
      cpf: dados.assinaturas.secretaria.cpf,
    },
    {
      nome: dados.prefeita.nome,
      papel: "Assinatura da Prefeita",
      cargo: dados.prefeita.cargo,
      cpf: dados.prefeita.cpf,
    },
  ]);
  pincel.fecharPagina();
}

/** Página 2: LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO. */
function paginaLiquidacaoPdf(pincel, dados) {
  pincel.abrirPagina(TITULO_PAGINA_2);
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

  // ⚠️ A MESMA FAIXA DAS FOLHAS DE MATERIAL/SERVIÇO: à esquerda o local, a data
  // DESTA folha e o traço de quem atesta, com NOME, CARGO e CPF; à direita a
  // caixa de autorização da prefeita, já com o nome e o CPF do cadastro.
  pincel.faixaDeAssinaturas({
    localEData: dados.liquidacao.localEData,
    assinatura: {
      nome: dados.assinaturas.secretaria.nome,
      cargo: dados.assinaturas.secretaria.cargo,
      cpf: dados.assinaturas.secretaria.cpf,
    },
    prefeita: dados.prefeita,
    destino: dados.liquidacao.destino,
    em: dados.liquidacao.emData,
  });

  pincel.fecharPagina();
}

/** Página 3: PRESTAÇÃO DE CONTAS DE DIÁRIAS. */
function paginaPrestacaoPdf(pincel, dados) {
  pincel.abrirPagina(TITULO_PAGINA_3);
  pincel.aviso(textoDoAviso(dados));

  pincel.secao("Relatório de Atividades");
  pincel.pautado(dados.prestacao.relatorio);

  pincel.respiro(2);
  pincel.paragrafo("Sem mais a acrescentar, subscrevo-me.");
  pincel.paragrafo("Eis a prestação de contas, a qual submeto à apreciação e aprovação.");

  pincel.localData(dados.prestacao.localEData);
  // A PRESTAÇÃO DE CONTAS NÃO TEM AUTORIZAÇÃO DA PREFEITA -- é o relatório do
  // servidor depois da viagem --, então não tem faixa lado a lado: tem uma
  // assinatura só, no layout comum (traço, NOME, CARGO e CPF).
  pincel.assinatura({
    nome: dados.assinaturas.servidor.nome,
    cargo: dados.assinaturas.servidor.cargo || "Cargo do(a) servidor(a)",
    cpf: dados.assinaturas.servidor.cpf,
    aoPe: true,
  });
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

  folhas.forEach((folha) => {
    (FOLHAS_PDF[folha] ?? paginaRequisicaoPdf)(pincel, dados);
  });

  return pdf;
}

/** Gera e baixa o PDF. */
export function gerarPdfDoProcesso(dados, { escopo = "completo" } = {}) {
  const pdf = montarPdfDoProcesso(dados, { escopo });
  pdf.save(nomeDoArquivo(dados, "pdf", escopo));
}
