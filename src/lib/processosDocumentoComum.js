// O QUE OS DOCUMENTOS DO MÓDULO PROCESSOS TÊM EM COMUM.
//
// Os cinco documentos do módulo -- Requisição de Diárias,
// Liquidação/Solicitação de Pagamento (diária), Prestação de Contas de Diárias,
// Requisição de Material/Serviço e Liquidação/Solicitação de Pagamento
// (serviços/materiais) -- são folhas da MESMA prefeitura. O cabeçalho, o
// rodapé, o desenho das assinaturas, a caixa de autorização da prefeita e as
// regras de data são os mesmos em todas elas.
//
// ⚠️ ESTE ARQUIVO É O ÚNICO LUGAR ONDE ESSAS PEÇAS EXISTEM. Nada aqui é copiado
// documento a documento: `processosDiariasDocumento.js` e
// `processosServicosDocumento.js` IMPORTAM daqui. Corrigir o layout de
// assinatura, o rodapé, o cabeçalho ou a regra de data é mexer NESTE arquivo, e
// a correção aparece nos cinco documentos ao mesmo tempo -- foi exatamente o
// retrabalho que a cópia por documento vinha causando.
//
// O que mora aqui:
//   1. a paleta, as medidas da folha A4 e o município;
//   2. as REGRAS DE DATA: a linha "São José da Laje/AL, ___ de ___ de ____" e o
//      "Em, ___/___/____" da autorização da prefeita;
//   3. o cabeçalho (brasão, órgão, estado e título) em HTML e em PDF;
//   4. o rodapé institucional em HTML e em PDF;
//   5. o LAYOUT DE ASSINATURAS: a linha de assinatura com NOME / CARGO / CPF
//      abaixo dela, a caixa de autorização da prefeita e a FAIXA que põe o
//      requisitante e a prefeita LADO A LADO, na mesma faixa horizontal;
//   6. o motor de desenho do PDF (o "pincel" base), com o cursor vertical, a
//      quebra de folha e as primitivas que as cinco folhas usam.
//
// Documental, não financeiro: nada aqui debita conta, dá baixa em NF, altera
// saldo, cria pagamento ou toca na Programação Diária.
//
// Carregado direto pelos testes: só funções puras e jsPDF, nada de React e nada
// de supabase.

import { BRASAO_ARQUIVO, BRASAO_SVG, normalizarIdentidade } from "./processosIdentidade.js";
import { cpfFormatado } from "./processosServidores.js";

/* -------------------------------------------------------------------------
 * 1. Paleta, medidas e município
 * ---------------------------------------------------------------------- */

export const COR = {
  navy: "#0F2A44",
  ouro: "#C9A227",
  faixa: "#EEF2F7",
  linha: "#C8D2DE",
  apoio: "#5A6B7E",
};

export const TINTA = {
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
export const PAGINA = { largura: 210, altura: 297, margemTopo: 10, margemBase: 18, margemLado: 13 };

/** O município das cinco folhas, na linha de local e data. */
export const MUNICIPIO = "São José da Laje/AL";

/** O que sai no lugar de um dado que o processo não tem. */
export const SEM_REGISTRO = "--";

/* -------------------------------------------------------------------------
 * A CAIXA DE AUTORIZAÇÃO DA PREFEITA, palavra por palavra
 * ---------------------------------------------------------------------- */

/** O rótulo da caixa. */
export const ROTULO_AUTORIZACAO = "Autorização da prefeita";

export const CIENTE_AUTORIZO = "CIENTE/AUTORIZO";

/**
 * O despacho: "À SECRETARIA DE ______".
 *
 * ⚠️ O complemento é a SECRETARIA DO ENCAMINHAMENTO -- a que RECEBE o processo
 * para as providências --, lida do cadastro de secretarias do MÓDULO
 * FINANCEIRO. Não é a secretaria solicitante. E ele NUNCA sai em branco no
 * papel: sem escolha gravada o documento cai em Finanças, como o modelo oficial.
 */
export const DESPACHO_PREFEITA = "À SECRETARIA DE";

export const PROVIDENCIAS = "Para providências que o caso requer";

/** O papel impresso abaixo da linha de assinatura da prefeita. */
export const PAPEL_PREFEITA = "PREFEITA";

/* -------------------------------------------------------------------------
 * 2. Regras de data
 * ---------------------------------------------------------------------- */

export function texto(valor) {
  return String(valor ?? "").trim();
}

/** O valor, ou "--" quando o processo não tem o dado. */
export function ou(valor) {
  const limpo = texto(valor);
  return limpo === "" ? SEM_REGISTRO : limpo;
}

export function escapar(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "10/03/2026" a partir de "2026-03-10". */
export function dataPorExtensoCurta(valor) {
  const bruto = texto(valor);
  if (bruto === "") return "";
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : bruto;
}

/**
 * "São José da Laje/AL, 10 de março de 2026" -- ou com o dia e o mês em branco.
 *
 * ⚠️ CADA FOLHA CHAMA ISTO COM A DATA DELA. A requisição é feita num dia, a
 * liquidação dias depois e a prestação de contas depois ainda: a folha imprime
 * a data DELA, nunca a da folha vizinha.
 *
 * Sem data preenchida o papel sai como o formulário oficial: para completar à
 * mão, já com o ano do exercício.
 */
export function localEData(data, ano) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(data));
  if (partes) {
    const mes = MESES[Number(partes[2]) - 1] ?? "";
    return `${MUNICIPIO}, ${Number(partes[3])} de ${mes} de ${partes[1]}`;
  }
  const exercicio = Number(ano);
  const fim = Number.isFinite(exercicio) && exercicio > 0 ? String(Math.trunc(exercicio)) : "______";
  return `${MUNICIPIO}, ______ de ____________________ de ${fim}`;
}

/**
 * "Em, 10/03/2026" ou "Em, ___/___/____", o campo de data da prefeita.
 *
 * É a MESMA data da folha: a autorização da requisição leva a data da
 * requisição, a da liquidação leva a data da liquidação.
 */
export function emData(data) {
  const formatada = dataPorExtensoCurta(data);
  return formatada === "" ? "Em, ___/___/____" : `Em, ${formatada}`;
}

/* -------------------------------------------------------------------------
 * A identificação abaixo da assinatura
 * ---------------------------------------------------------------------- */

/**
 * "CPF: 000.000.000-00" -- ou VAZIO quando o signatário não tem CPF cadastrado.
 *
 * ⚠️ Sem CPF cadastrado a linha NÃO SAI. Um "CPF:" sozinho no papel é pior que
 * a ausência dele: o documento parece incompleto por erro do sistema.
 */
export function etiquetaDeCpf(cpf) {
  const limpo = texto(cpf);
  if (limpo === "" || limpo === SEM_REGISTRO) return "";
  return `CPF: ${cpfFormatado(limpo)}`;
}

/**
 * As linhas que saem ABAIXO da linha de assinatura, na ordem do modelo:
 * o papel (quando existe), o CARGO e o CPF.
 *
 * O NOME sai em destaque, logo abaixo do traço, e por isso não entra aqui.
 */
export function linhasDaIdentificacao({ papel = "", cargo = "", cpf = "" } = {}) {
  return [texto(papel), texto(cargo), etiquetaDeCpf(cpf)].filter((linha) => linha !== "");
}

/* -------------------------------------------------------------------------
 * 3. O brasão do cabeçalho
 * ---------------------------------------------------------------------- */

// O brasão do repositório, embutido no documento para que a folha nunca saia sem
// ele por causa de uma imagem que não carregou na janela de impressão.
function brasaoSvg(lado) {
  return BRASAO_SVG.replace(/^<svg /, `<svg width="${lado}mm" height="${lado}mm" `)
    .replace(/ width="512" height="512"/, "");
}

/**
 * O brasão do CABEÇALHO, em TODAS as folhas dos cinco documentos.
 *
 * Brasão enviado em Configurações → Processos sai como imagem; sem imagem
 * enviada, sai o vetor do repositório. Nos dois casos a ALTURA é a que manda e a
 * largura é automática, com um teto de largura -- é o que impede a folha de
 * deformar o brasão.
 */
export function brasaoDoDocumento(dados, lado) {
  const endereco = texto(dados?.logoEndereco) || texto(dados?.identidade?.logo_url);
  // O desenho vetorial só entra quando NÃO existe imagem cadastrada.
  const url = texto(dados?.logo?.dataUrl) || (endereco === BRASAO_ARQUIVO ? "" : endereco);
  if (url === "") return brasaoSvg(lado);
  return `<img class="brasao" src="${escapar(url)}" alt="${escapar(dados?.identidade?.orgao ?? "")}"`
    + ` style="height:${lado}mm;max-width:${(lado * 1.6).toFixed(1)}mm">`;
}

/** O mesmo brasão, desenhado no PDF. Devolve a largura que ele ocupou. */
export function desenharBrasaoPdf(pdf, x, y, lado, dados = null) {
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

/* -------------------------------------------------------------------------
 * 4. O CSS comum das cinco folhas
 * ---------------------------------------------------------------------- */

/**
 * A folha, o cabeçalho, o aviso, a linha de local e data, AS ASSINATURAS, a
 * caixa da prefeita e o rodapé.
 *
 * Cada documento acrescenta a isto o CSS dos quadros que só ele tem.
 */
export function estilosComuns() {
  return `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { color: ${COR.navy}; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.35;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    /* A folha tem a altura da página e sempre quebra depois: é isto que faz cada
       documento do processo começar em folha nova. A altura é MÍNIMA, não fixa
       -- conteúdo excepcional transborda para uma folha a mais em vez de ser
       cortado, e a fonte NÃO diminui para forçar uma folha só. */
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
    /* O cabeçalho não tem selo: o número do processo NÃO é impresso. */

    .aviso { margin-top: 2.5mm; border: .8pt solid ${COR.navy}; padding: 1.6mm 2mm; font-size: 8pt; }
    .aviso strong { letter-spacing: .06em; text-transform: uppercase; }

    .preenchido { border-bottom: .5pt dotted ${COR.apoio}; padding: 0 1mm; }

    .local-data { margin-top: 8mm; text-align: center; font-size: 10pt; }

    /* AS ASSINATURAS EMPILHADAS, uma embaixo da outra: é o layout da REQUISIÇÃO
       DE DIÁRIAS, onde as três assinaturas (servidor, responsável pela
       secretaria e prefeita) saem em coluna, como no modelo oficial. O vão acima
       de cada traço é o espaço para assinar à mão. */
    .assinaturas { margin-top: 6mm; }
    .assinaturas > div { width: 95mm; margin: 9mm auto 0; border-top: .7pt solid ${COR.navy};
      padding-top: 1.4mm; text-align: center; font-size: 7.5pt; color: ${COR.apoio}; }
    .assinaturas strong { display: block; font-size: 8.5pt; color: ${COR.navy}; }
    .assinaturas .cargo { display: block; font-size: 7pt; }

    /* UMA linha de assinatura: o traço, o NOME em destaque e, abaixo dele, a
       identificação -- CARGO e CPF. ⚠️ Nada mais entra aqui: a antiga legenda
       entre parênteses sob o traço do requisitante saiu, por ser redundante com
       o nome, o cargo e o CPF que o sistema já imprime. */
    .assinatura-unica { margin: 12mm auto 0; width: 90mm; border-top: .7pt solid ${COR.navy}; padding-top: 1.4mm;
      text-align: center; font-size: 7.5pt; color: ${COR.apoio}; }
    .assinatura-unica strong { display: block; font-size: 9pt; color: ${COR.navy}; }
    .assinatura-unica .cargo { display: block; font-size: 7pt; }

    /* A CAIXA DE AUTORIZAÇÃO DA PREFEITA. */
    .autorizacao { margin-top: 5mm; border: .8pt solid ${COR.navy}; padding: 3mm; }
    .autorizacao .rotulo-caixa { font-size: 7.5pt; font-weight: bold; letter-spacing: .1em;
      text-transform: uppercase; color: ${COR.apoio}; }
    .autorizacao p { margin: 1.6mm 0 0; }
    .autorizacao .ciente { font-weight: bold; letter-spacing: .08em; }

    /* ⚠️ A FAIXA DE ASSINATURAS: o requisitante à ESQUERDA (local, data, linha
       de assinatura e identificação) e a AUTORIZAÇÃO DA PREFEITA à DIREITA, na
       MESMA faixa horizontal -- nunca uma abaixo da outra. Empilhadas, as duas
       gastavam o dobro da altura e empurravam o documento para uma segunda
       folha. Vale em TODAS as folhas que têm autorização da prefeita; a exceção
       é a Requisição de Diárias, cujas três assinaturas seguem empilhadas. */
    .faixa-assinaturas { display: flex; align-items: stretch; gap: 6mm; margin-top: 6mm;
      page-break-inside: avoid; break-inside: avoid; }
    .faixa-assinaturas > * { min-width: 0; }
    /* O quadro da prefeita fica um pouco mais largo: é ele que tem texto dentro
       -- "À SECRETARIA DE ______" precisa caber numa linha. */
    .faixa-assinaturas .lado { flex: 42 1 0; display: flex; flex-direction: column; justify-content: flex-end; }
    .faixa-assinaturas .autorizacao { flex: 58 1 0; margin-top: 0; }
    .faixa-assinaturas .local-data { margin-top: 0; }
    .faixa-assinaturas .assinatura-unica { margin: 10mm auto 0; width: 100%; max-width: 78mm; }

    .rodape { position: absolute; left: ${PAGINA.margemLado}mm; right: ${PAGINA.margemLado}mm; bottom: 6mm;
      border-top: .5pt solid ${COR.navy}; padding-top: 1.2mm; text-align: center; color: ${COR.apoio}; font-size: 7pt; }
    .rodape .endereco { color: ${COR.navy}; font-weight: bold; }
  `;
}

/* -------------------------------------------------------------------------
 * 5. Cabeçalho, aviso, rodapé e assinaturas em HTML
 * ---------------------------------------------------------------------- */

/**
 * O cabeçalho da folha: brasão, órgão, estado e o título do documento.
 *
 * SEM o número do processo e SEM numeração de folha. Os dois existem no
 * sistema, para controle e busca, e nenhum dos dois vai para o papel.
 */
export function cabecalhoHtml(dados, titulo) {
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
export function avisoHtml(dados) {
  if (dados?.cancelado) {
    const motivo = dados.motivoCancelamento ? ` Motivo: ${dados.motivoCancelamento}.` : "";
    return `<div class="aviso"><strong>Processo cancelado.</strong>${escapar(motivo)} O registro, a numeração e o histórico foram preservados.</div>`;
  }
  if (dados?.rascunho) {
    return `<div class="aviso"><strong>Rascunho.</strong> Documento ainda não finalizado — sujeito a alteração.</div>`;
  }
  return "";
}

/**
 * O rodapé institucional, igual em todas as folhas dos cinco documentos.
 *
 * Endereço com CEP, contato e CNPJ, em três linhas. NADA de informação de
 * sistema: quem emitiu e quando não pertencem ao documento oficial -- isso fica
 * só no histórico do processo, dentro do sistema. Sem número de processo e sem
 * numeração de folha.
 */
export function rodapeHtml(dados) {
  const identidade = normalizarIdentidade(dados?.identidade);
  // A linha do CNPJ sai só quando existe. Identidade CONGELADA em processo
  // antigo trazia o CNPJ dentro da linha de contato; ali a terceira linha vem
  // vazia e o documento continua saindo exatamente como saiu na época.
  const cnpj = identidade.rodape_cnpj === "" ? "" : `<div>${escapar(identidade.rodape_cnpj)}</div>`;
  return `<div class="rodape">`
    + `<div class="endereco">${escapar(identidade.rodape_endereco)}</div>`
    + `<div>${escapar(identidade.rodape_contato)}</div>`
    + cnpj
    + `</div>`;
}

/**
 * UMA LINHA DE ASSINATURA, com a identificação abaixo dela.
 *
 * O traço para assinar à mão, o NOME em destaque e, embaixo, NOME DO
 * SIGNATÁRIO / CARGO / CPF -- e nada além disso. O CPF vem do cadastro
 * (Servidores ou Secretarias Solicitantes, conforme a origem do signatário) e
 * sai formatado; sem CPF cadastrado, a linha do CPF simplesmente não sai.
 *
 * `classe` vazia é o item de dentro da pilha de assinaturas (a Requisição de
 * Diárias); o padrão é a assinatura solta das outras folhas.
 */
export function assinaturaHtml({ nome = "", papel = "", cargo = "", cpf = "", classe = "assinatura-unica" } = {}) {
  const nomeImpresso = texto(nome);
  const abre = classe === "" ? `<div>` : `<div class="${classe}">`;
  return abre
    + `<strong>${nomeImpresso === "" || nomeImpresso === SEM_REGISTRO ? "&nbsp;" : escapar(nomeImpresso)}</strong>`
    + escapar(texto(papel))
    + linhasDaIdentificacao({ cargo, cpf })
      .map((linha) => `<span class="cargo">${escapar(linha)}</span>`)
      .join("")
    + `</div>`;
}

/** As assinaturas EMPILHADAS da Requisição de Diárias. */
export function assinaturasEmpilhadasHtml(itens) {
  return `<div class="assinaturas">`
    + itens.map((item) => assinaturaHtml({ ...item, classe: "" })).join("")
    + `</div>`;
}

/**
 * A CAIXA DE AUTORIZAÇÃO DA PREFEITA, igual nas quatro folhas que a têm.
 *
 * "CIENTE/AUTORIZO", "À SECRETARIA DE ______", "Para providências que o caso
 * requer", "Em, ___/___/____", a linha de assinatura e, abaixo dela, o nome, o
 * cargo e o CPF do Chefe do Poder Executivo, lidos do cadastro.
 *
 * ⚠️ O despacho sai SEMPRE PREENCHIDO: `destino` nunca chega vazio aqui -- sem
 * escolha gravada, o documento cai em Finanças, como o modelo oficial.
 */
export function quadroDaPrefeitaHtml({ prefeita = {}, destino = "", em = "" } = {}) {
  return `<div class="autorizacao">`
    + `<div class="rotulo-caixa">${escapar(ROTULO_AUTORIZACAO)}</div>`
    + `<p class="ciente">${escapar(CIENTE_AUTORIZO)}</p>`
    + `<p>${escapar(DESPACHO_PREFEITA)} <span class="preenchido">${escapar(destino)}</span></p>`
    + `<p>${escapar(PROVIDENCIAS)}</p>`
    + `<p>${escapar(em)}</p>`
    + assinaturaHtml({
      nome: prefeita?.nome,
      papel: PAPEL_PREFEITA,
      cargo: prefeita?.cargo,
      cpf: prefeita?.cpf,
    })
    + `</div>`;
}

/**
 * A FAIXA: o requisitante à esquerda, a prefeita à direita, no MESMO nível.
 *
 * `esquerda` é a coluna do requisitante (local e data, linha de assinatura e
 * identificação) e `direita` é a caixa da prefeita. As duas na mesma faixa
 * horizontal, ao pé da folha, e a folha continua sendo UMA.
 */
export function faixaDeAssinaturasHtml({ esquerda = "", direita = "" } = {}) {
  return `<div class="faixa-assinaturas">`
    + `<div class="lado">${esquerda}</div>`
    + direita
    + `</div>`;
}

/**
 * A coluna da ESQUERDA da faixa: a linha de local e data desta folha e, abaixo
 * dela, a assinatura de quem requisita, com nome, cargo e CPF.
 */
export function ladoDoRequisitanteHtml({ localEData: linhaDeData = "", assinatura = {} } = {}) {
  return `<p class="local-data">${escapar(linhaDeData)}</p>`
    + assinaturaHtml(assinatura);
}

/* -------------------------------------------------------------------------
 * 6. O PINCEL BASE do PDF
 * ---------------------------------------------------------------------- */

/**
 * O desenhista de uma folha: mantém o cursor vertical, o cabeçalho, o rodapé
 * institucional e sabe abrir folha de continuação quando o conteúdo excede a
 * altura útil.
 *
 * ⚠️ ESTE É O MOTOR DOS CINCO DOCUMENTOS. Cada documento acrescenta ao que vem
 * daqui apenas os quadros que só ele tem (o quadro descritivo de serviços, a
 * grade de campos e o relatório pautado das diárias) -- o cabeçalho, o rodapé,
 * a linha de local e data, as assinaturas, a caixa da prefeita e a faixa lado a
 * lado saem todas deste arquivo.
 *
 * Folha de continuação é a exceção, não a regra: no uso normal cada documento
 * cabe na sua folha. Ela existe para NÃO cortar informação.
 */
export function criarPincelBase(pdf, dados) {
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
    xBase,
    largBase,
    xEsq,
    largUtil,

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

    /** "São José da Laje/AL, 10 de março de 2026", centralizado. */
    localData(conteudo) {
      this.espaco(12);
      this.respiro(5);
      this.paragrafo(conteudo, { centralizado: true });
    },

    /**
     * UMA ÁREA DE ASSINATURA: o vão para assinar à mão, o traço, o NOME e, abaixo
     * dele, a identificação -- papel, CARGO e CPF.
     *
     * ⚠️ É o layout das assinaturas dos CINCO documentos. A linha do CPF só sai
     * quando o cadastro tem CPF; sem cadastro, nada de "CPF:" vazio no papel.
     */
    assinatura({ nome = "", papel = "", cargo = "", cpf = "", aoPe = false, vao = 10 } = {}) {
      const abaixo = linhasDaIdentificacao({ papel, cargo, cpf });
      const peDaLinha = 8 + Math.max(0, abaixo.length - 1) * 3;
      const altura = vao + peDaLinha;
      this.espaco(altura + 2);
      const piso = limite - altura;
      if (aoPe && estado.y < piso) estado.y = piso;

      const larguraCampo = Math.min(95, largUtil());
      const centro = xEsq() + largUtil() / 2;

      estado.y += vao;
      pdf.setDrawColor(...TINTA.navy);
      pdf.setLineWidth(0.3);
      pdf.line(centro - larguraCampo / 2, estado.y, centro + larguraCampo / 2, estado.y);

      const escrito = texto(nome);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(...TINTA.navy);
      pdf.text(escrito === "" || escrito === SEM_REGISTRO ? " " : escrito, centro, estado.y + 3.4, { align: "center" });

      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...TINTA.apoio);
      abaixo.forEach((linhaDaIdentificacao, indice) => {
        pdf.setFontSize(indice === 0 ? 7.5 : 7);
        pdf.splitTextToSize(linhaDaIdentificacao, largUtil()).slice(0, 1).forEach((parte) => {
          pdf.text(parte, centro, estado.y + 7 + indice * 3, { align: "center" });
        });
      });

      estado.y += peDaLinha;
    },

    /**
     * AS ASSINATURAS EMPILHADAS, uma embaixo da outra.
     *
     * ⚠️ É o layout da REQUISIÇÃO DE DIÁRIAS, e só dela: as três assinaturas
     * (servidor, responsável pela secretaria e prefeita) saem em coluna, como no
     * modelo oficial. Havendo folga, o bloco desce para o pé da folha.
     */
    assinaturasEmpilhadas(itens, { aoPe = true, vao = 9, vaoMinimo = 5 } = {}) {
      // O pé de cada assinatura -- o traço, o nome e as linhas de identificação
      // -- é fixo; o que dá é o VÃO DA CANETA acima do traço.
      const peDe = (item) => 8 + Math.max(0, linhasDaIdentificacao(item).length - 1) * 3;
      const pes = itens.reduce((soma, item) => soma + peDe(item), 0);

      // ⚠️ O VÃO ENCOLHE ATÉ CABER, em vez de as assinaturas caírem para uma
      // folha de continuação: o modelo oficial tem as três na MESMA folha, e
      // ganhar a linha do CARGO e a do CPF não pode custar uma folha a mais.
      const sobra = limite - estado.y - pes - 2;
      const porItem = itens.length > 0 ? sobra / itens.length : 0;
      const vaoUsado = Math.max(vaoMinimo, Math.min(vao, porItem));

      const altura = pes + vaoUsado * itens.length;
      this.espaco(altura + 2);
      const piso = limite - altura;
      if (aoPe && estado.y < piso) estado.y = piso;

      // O bloco inteiro já foi medido: daqui até o fim não há quebra de folha,
      // para as assinaturas não se separarem umas das outras.
      estado.travado = true;
      itens.forEach((item) => this.assinatura({ ...item, vao: vaoUsado, aoPe: false }));
      estado.travado = false;
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
     * A CAIXA DE AUTORIZAÇÃO DA PREFEITA no PDF, igual à do HTML e igual nas
     * quatro folhas que a têm.
     */
    quadroDaPrefeita({ prefeita = {}, destino = "", em = "" } = {}) {
      this.moldura(ROTULO_AUTORIZACAO, () => {
        this.paragrafo(CIENTE_AUTORIZO, { negrito: true });
        this.linha(DESPACHO_PREFEITA, destino);
        this.paragrafo(PROVIDENCIAS);
        this.paragrafo(em);
        this.assinatura({
          nome: prefeita?.nome,
          papel: PAPEL_PREFEITA,
          cargo: prefeita?.cargo,
          cpf: prefeita?.cpf,
        });
      });
    },

    /**
     * DUAS ÁREAS LADO A LADO, na MESMA faixa horizontal.
     *
     * É o pé das folhas que têm autorização da prefeita: o REQUISITANTE à
     * esquerda e a AUTORIZAÇÃO DA PREFEITA à direita, uma ao lado da outra.
     * Empilhadas, as duas gastavam o dobro da altura e empurravam o documento
     * para uma segunda folha.
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

    /**
     * O PÉ PADRÃO DAS FOLHAS QUE TÊM AUTORIZAÇÃO DA PREFEITA, no PDF.
     *
     * ⚠️ É O MESMO DESENHO NAS QUATRO FOLHAS QUE O TÊM -- requisição de
     * material/serviço, liquidação de material/serviço, liquidação de diária e
     * requisição de diária quando algum dia deixar de ser empilhada. À
     * ESQUERDA: o local e a data DESTA folha, o traço para assinar e, abaixo
     * dele, NOME, CARGO e CPF de quem requisita. À DIREITA: a caixa de
     * autorização da prefeita. Equivalente exato de faixaDeAssinaturasHtml +
     * ladoDoRequisitanteHtml + quadroDaPrefeitaHtml na versão de tela.
     *
     * O `recuoDaCaneta` é o vão que deixa o traço da esquerda na mesma altura
     * do traço de dentro da caixa da direita.
     */
    faixaDeAssinaturas({
      localEData: linhaDeData = "",
      assinatura = {},
      prefeita = {},
      destino = "",
      em = "",
      proporcao = 0.42,
      recuoDaCaneta = 30,
    } = {}) {
      this.faixaLadoALado({
        // A caixa da prefeita fica mais larga: é ela que tem texto dentro.
        proporcao,
        esquerda: () => {
          this.paragrafo(linhaDeData, { centralizado: true });
          this.respiro(recuoDaCaneta);
          this.assinatura(assinatura);
        },
        direita: () => this.quadroDaPrefeita({ prefeita, destino, em }),
      });
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

/** O texto do aviso de rascunho ou de cancelamento, igual nos cinco documentos. */
export function textoDoAviso(dados) {
  if (dados?.cancelado) {
    const motivo = dados.motivoCancelamento ? ` Motivo: ${dados.motivoCancelamento}.` : "";
    return `PROCESSO CANCELADO.${motivo} O registro, a numeração e o histórico foram preservados.`;
  }
  if (dados?.rascunho) return "RASCUNHO. Documento ainda não finalizado — sujeito a alteração.";
  return "";
}
