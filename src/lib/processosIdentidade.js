// A IDENTIDADE VISUAL dos documentos do módulo Processos: o brasão da
// prefeitura e os dados institucionais do cabeçalho e do rodapé.
//
// O BRASÃO MORA NO REPOSITÓRIO. O arquivo padrão é `public/brasao-sao-jose-da-laje.svg`,
// servido pela própria aplicação: o documento nunca depende de um link externo,
// de uma CDN ou de um bucket para sair com o brasão. Quem trocar o brasão em
// Configurações → Processos passa a usar a imagem enviada; sem imagem enviada, o
// arquivo do repositório continua valendo.
//
// ⚠️ TROCAR O BRASÃO NÃO ALTERA DOCUMENTO JÁ FINALIZADO. Ao finalizar, o
// processo guarda dentro dele a identidade vigente naquele momento -- a mesma
// regra já usada para os dados do secretário e da prefeita. Documento emitido em
// 2025 continua saindo com o brasão e o rodapé de 2025.
//
// Nada neste arquivo é financeiro: é papel timbrado. Não debita conta, não dá
// baixa em NF, não altera saldo e não cria pagamento.
//
// Carregado direto pelos testes: só funções puras, nada de React e nada de supabase.

/* -------------------------------------------------------------------------
 * O brasão do repositório
 * ---------------------------------------------------------------------- */

/** O caminho do brasão nos ativos estáticos da aplicação. */
export const BRASAO_ARQUIVO = "/brasao-sao-jose-da-laje.svg";

/**
 * O MESMO brasão, embutido como texto.
 *
 * Vetorial: amplia sem serrilhar, em tela, na impressora e no PDF. Desenhado em
 * traço cheio de contorno escuro, então sai legível também em IMPRESSORA
 * PRETO E BRANCO -- o azul e o dourado viram dois cinzas distintos, e o
 * contorno preserva o desenho.
 *
 * Está embutido para que a folha nunca saia sem o brasão por causa de uma imagem
 * que não carregou na janela de impressão. O conteúdo é idêntico ao do arquivo
 * `public/brasao-sao-jose-da-laje.svg`, e a suíte de testes confere isso.
 */
export const BRASAO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Brasão do Município de São José da Laje - AL"><title>Brasão do Município de São José da Laje - AL</title><path d="M60 72H452V262C452 360 372 424 256 468C140 424 60 360 60 262Z" fill="#FBFAF7" stroke="#0F2A44" stroke-width="16" stroke-linejoin="round"/><path d="M60 150H452" stroke="#0F2A44" stroke-width="12"/><path d="M60 72H452V150H60Z" fill="#0F2A44"/><path d="M256 78L269 118H311L277 143L290 183L256 158L222 183L235 143L201 118H243Z" fill="#C9A227" stroke="#FBFAF7" stroke-width="5" stroke-linejoin="round"/><g fill="none" stroke="#0F2A44" stroke-width="11" stroke-linecap="round"><path d="M104 200C130 182 156 218 182 200C208 182 234 218 260 200C286 182 312 218 338 200C364 182 390 218 408 203"/><path d="M104 240C130 222 156 258 182 240C208 222 234 258 260 240C286 222 312 258 338 240C364 222 390 258 408 243"/><path d="M110 280C136 262 162 298 188 280C214 262 240 298 266 280C292 262 318 298 344 280C362 268 380 280 396 288"/></g><text x="256" y="398" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="104" font-weight="bold" letter-spacing="6" fill="#0F2A44">SJL</text></svg>`;

/** A proporção do brasão do repositório (quadrado). Usada para não deformá-lo. */
export const BRASAO_PROPORCAO = 1;

/* -------------------------------------------------------------------------
 * Os dados institucionais
 * ---------------------------------------------------------------------- */

/**
 * A identidade de fábrica: o que o documento traz enquanto ninguém configurou
 * nada em Configurações → Processos.
 */
export const IDENTIDADE_PADRAO = Object.freeze({
  orgao: "PREFEITURA MUNICIPAL DE SÃO JOSÉ DA LAJE",
  estado: "ESTADO DE ALAGOAS",
  rodape_endereco: "Rua Dr. Oscar Gordilho, 23 - Centro - São José da Laje - Alagoas",
  rodape_contato: "Tel.: (82) 9.9395-5442 | E-mail: prefeitura@saojosedalaje.al.gov.br | CNPJ: 12.330.916/0001-99",
  // null = o brasão do repositório. Uma URL aqui é a imagem enviada na tela.
  logo_url: null,
});

export const LIMITE_TEXTO_IDENTIDADE = 200;

function texto(valor) {
  return String(valor ?? "").trim();
}

/** Uma identidade completa a partir do que veio do banco (ou de nada). */
export function normalizarIdentidade(bruta) {
  const origem = bruta && typeof bruta === "object" ? bruta : {};
  return {
    orgao: texto(origem.orgao) || IDENTIDADE_PADRAO.orgao,
    estado: texto(origem.estado) || IDENTIDADE_PADRAO.estado,
    rodape_endereco: texto(origem.rodape_endereco) || IDENTIDADE_PADRAO.rodape_endereco,
    rodape_contato: texto(origem.rodape_contato) || IDENTIDADE_PADRAO.rodape_contato,
    logo_url: texto(origem.logo_url) === "" ? null : texto(origem.logo_url),
  };
}

/** A imagem que o documento deve usar: a enviada, ou o brasão do repositório. */
export function logoDoDocumento(identidade) {
  return normalizarIdentidade(identidade).logo_url ?? BRASAO_ARQUIVO;
}

/** true quando o documento sai com o brasão do repositório, não com um enviado. */
export function usaBrasaoDoRepositorio(identidade) {
  return normalizarIdentidade(identidade).logo_url === null;
}

/* -------------------------------------------------------------------------
 * ⚠️ O congelamento
 * ---------------------------------------------------------------------- */

/**
 * A identidade que um processo IMPRIME.
 *
 * Processo com identidade congelada imprime a CONGELADA, sempre -- é o que
 * garante que trocar o brasão ou o rodapé hoje não reescreva o documento
 * emitido no ano passado. Processo ainda sem congelamento (rascunho, ou
 * anterior a esta entrega) imprime a vigente.
 */
export function identidadeDoProcesso(processo, identidadeAtual) {
  const congelada = processo?.identidade_visual;
  if (congelada && typeof congelada === "object" && Object.keys(congelada).length > 0) {
    return normalizarIdentidade(congelada);
  }
  return normalizarIdentidade(identidadeAtual);
}

/** true quando o processo já carrega a identidade visual congelada. */
export function temIdentidadeCongelada(processo) {
  const congelada = processo?.identidade_visual;
  return Boolean(congelada && typeof congelada === "object" && Object.keys(congelada).length > 0);
}

/**
 * O que é gravado DENTRO do processo ao finalizar: a identidade vigente.
 *
 * A URL da imagem é guardada, e não a imagem: cada envio de logo cria um arquivo
 * PRÓPRIO no Storage (nome com data e sufixo aleatório, sem sobrescrever), então
 * a URL congelada continua apontando para a imagem daquela época mesmo depois de
 * a prefeitura trocar o brasão.
 */
export function congelarIdentidadeNoProcesso(identidade) {
  return { identidade_visual: normalizarIdentidade(identidade) };
}

/* -------------------------------------------------------------------------
 * Edição
 * ---------------------------------------------------------------------- */

export function validarIdentidade(identidade) {
  const erros = {};
  const pronta = normalizarIdentidade(identidade);

  [
    ["orgao", "Informe o nome do órgão que aparece no cabeçalho."],
    ["estado", "Informe o estado que aparece no cabeçalho."],
    ["rodape_endereco", "Informe o endereço do rodapé institucional."],
    ["rodape_contato", "Informe a linha de contato do rodapé institucional."],
  ].forEach(([campo, mensagem]) => {
    if (texto(identidade?.[campo]) === "" && texto(IDENTIDADE_PADRAO[campo]) === "") erros[campo] = mensagem;
    if (pronta[campo].length > LIMITE_TEXTO_IDENTIDADE) {
      erros[campo] = `Este texto passa de ${LIMITE_TEXTO_IDENTIDADE} caracteres e não caberia na folha.`;
    }
  });

  return erros;
}

/** A primeira mensagem de erro, para o aviso de cima do formulário. */
export function primeiroErroDaIdentidade(erros) {
  const chaves = Object.keys(erros ?? {});
  return chaves.length === 0 ? null : erros[chaves[0]];
}

/** O que mudou, para a auditoria gravar o ANTES e o DEPOIS. */
export function diferencaDaIdentidade(anterior, nova) {
  const de = normalizarIdentidade(anterior);
  const para = normalizarIdentidade(nova);
  const antes = {};
  const depois = {};

  ["orgao", "estado", "rodape_endereco", "rodape_contato", "logo_url"].forEach((campo) => {
    if (de[campo] === para[campo]) return;
    antes[campo] = de[campo];
    depois[campo] = para[campo];
  });

  return { anterior: antes, novo: depois, houveAlteracao: Object.keys(depois).length > 0 };
}
