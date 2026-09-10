// Ligação das áreas de Fornecedores (Patrocínios, Aluguéis e Bandas) com a
// PROGRAMAÇÃO DIÁRIA que já existe.
//
// O QUE ESTE ARQUIVO É: a tradução de "um registro de área" para "um item da
// programação diária", e o recado que a pessoa lê nas duas telas. Só isso.
//
// O QUE ELE NÃO É, e não é esquecimento:
//
// - NÃO é um caminho paralelo de programação. Quem inclui o item na proposta é a
//   MESMA tela de Programação Diária, com a mesma lista de itens e a mesma
//   gravação (`salvar_planejamento_programacao`). Aqui só se monta o item que a
//   tela vai receber, no formato que ela já usa hoje.
// - NÃO é baixa, e não encosta em nenhuma. A baixa continua sendo exclusivamente
//   por NF/processo, na aba de Baixas. Nada aqui grava valor pago, e as áreas
//   continuam sem coluna de valor pago: Pago e Saldo delas são CALCULADOS a
//   partir das baixas das NFs vinculadas.
// - NÃO movimenta saldo de conta. PROGRAMADO ≠ PAGO e APROVADO ≠ PAGO continuam
//   valendo: mandar um registro para a programação é propor um pagamento, não
//   pagá-lo.
//
// O VÍNCULO DO PAGAMENTO CONTINUA SENDO fornecedor_id. `origem_tipo` e
// `origem_id` são informação adicional -- servem para o registro da área saber
// que foi programado -- e NUNCA são critério de busca de nota ou de processo.
// Item da programação sem origem (o caso normal) continua funcionando
// exatamente como hoje, com os dois campos vazios.
//
// Tudo aqui é função pura: sem banco, sem tela e sem React, para que a mesma
// regra valha na área, na programação e no teste automatizado.

import { formatBRL } from "./moeda.js";
import { normalizarNomeExibicao } from "./nomesFornecedor.js";
import {
  AREAS,
  cadastroDoRegistro,
  nomeDoFornecedorDoRegistro,
  resumoFinanceiroDoRegistro,
} from "./areasFornecedores.js";

/** Nome do arquivo da migration que cria as colunas de origem do item. */
export const MIGRATION_ORIGEM_PROGRAMACAO =
  "20260910150000_origem_do_item_na_programacao_diaria.sql";

/**
 * Recado de quando a migration da origem ainda não foi rodada neste banco.
 * Enquanto ela não rodar, adicionar à programação continua funcionando (o
 * fornecedor e o valor entram como sempre) -- só a origem não fica gravada.
 */
export const AVISO_MIGRATION_ORIGEM =
  "As colunas de origem do item da programação ainda não existem neste banco. Rode a migration " +
  `supabase/migrations/${MIGRATION_ORIGEM_PROGRAMACAO} no SQL Editor do Supabase para que a ` +
  "programação registre de qual patrocínio, aluguel ou banda o item veio. O fornecedor e o valor " +
  "entram na programação normalmente mesmo antes disso.";

/**
 * O `origem_tipo` de cada área, no singular, como a coluna do banco aceita.
 * A chave é o id da área; o valor é o que vai para `pagamentos.origem_tipo`.
 */
export const ORIGEM_POR_AREA = Object.freeze({
  patrocinios: "patrocinio",
  alugueis: "aluguel",
  bandas: "banda",
});

/** Os três valores aceitos em `pagamentos.origem_tipo`. */
export const ORIGENS_VALIDAS = Object.freeze(Object.values(ORIGEM_POR_AREA));

/** Como a origem aparece na tela e na etiqueta do item da programação. */
export const ROTULO_DA_ORIGEM = Object.freeze({
  patrocinio: "Patrocínio",
  aluguel: "Aluguel",
  banda: "Banda",
});

/** Prefixo do nome sugerido. Banda não tem prefixo: vale o nome artístico. */
const PREFIXO_SUGERIDO = Object.freeze({
  patrocinio: "Patrocínio",
  aluguel: "Aluguel",
  banda: "",
});

function textoLimpo(valor) {
  return String(valor ?? "").trim();
}

/** O `origem_tipo` da área (`patrocinio`, `aluguel`, `banda`). */
export function origemDaArea(area) {
  return ORIGEM_POR_AREA[area?.id ?? area] ?? null;
}

/** A área de um `origem_tipo`, ou null quando a origem é desconhecida/vazia. */
export function areaDaOrigem(origemTipo) {
  const alvo = textoLimpo(origemTipo).toLowerCase();
  const id = Object.keys(ORIGEM_POR_AREA).find((chave) => ORIGEM_POR_AREA[chave] === alvo);
  return id ? AREAS.find((area) => area.id === id) ?? null : null;
}

/** Rótulo da origem para a tela ("Patrocínio"), "" quando não há origem. */
export function rotuloDaOrigem(origemTipo) {
  return ROTULO_DA_ORIGEM[textoLimpo(origemTipo).toLowerCase()] ?? "";
}

/** O item da programação veio de uma área? (item sem origem é o caso normal.) */
export function itemTemOrigem(pagamento) {
  return (
    ORIGENS_VALIDAS.includes(textoLimpo(pagamento?.origem_tipo).toLowerCase()) &&
    textoLimpo(pagamento?.origem_id) !== ""
  );
}

/**
 * O texto que identifica o registro dentro da área, para o nome sugerido:
 *
 *   Patrocínio -> o nome/descrição do patrocínio;
 *   Aluguel    -> o objeto alugado e, na falta dele, a descrição;
 *   Banda      -> o nome da banda/artista.
 */
export function descricaoDoRegistroParaProgramacao(area, registro) {
  if (area?.id === "alugueis") {
    return textoLimpo(registro?.objeto) || textoLimpo(registro?.descricao);
  }
  return textoLimpo(registro?.[area?.campoTitulo]);
}

/**
 * O nome de exibição SUGERIDO para o item da programação:
 *
 *   Patrocínio — Festa de São José
 *   Aluguel — Imóvel
 *   Trio Pé de Serra                (banda: o nome artístico, sem prefixo)
 *
 * É SUGESTÃO, e só isso: entra no campo `nome_exibicao_programacao` do ITEM,
 * continua editável pelo lápis da programação e NÃO altera razão social,
 * apelido ou qualquer outro dado do cadastro do fornecedor. Sem descrição
 * nenhuma, devolve `null` -- o item mostra o nome de sempre do fornecedor.
 */
export function nomeSugeridoParaProgramacao(area, registro) {
  const descricao = descricaoDoRegistroParaProgramacao(area, registro);
  const prefixo = PREFIXO_SUGERIDO[origemDaArea(area)] ?? "";
  if (descricao === "") return prefixo === "" ? null : normalizarNomeExibicao(prefixo);
  if (prefixo === "") return normalizarNomeExibicao(descricao);
  return normalizarNomeExibicao(`${prefixo} — ${descricao}`);
}

/**
 * O valor a programar sugerido: o SALDO do registro (valor total menos o que as
 * baixas das NFs vinculadas já abateram). Registro sem NF vinculada vai com o
 * valor inteiro; registro já quitado vai com zero.
 *
 * Saldo negativo (baixas acima do valor do registro) vira 0 aqui, porque valor
 * a programar negativo o banco recusa -- e a listagem da área continua mostrando
 * o saldo negativo como ele é, sem esconder nada.
 *
 * É SUGESTÃO: na programação o valor continua editável como qualquer outro item.
 */
export function valorAProgramar(registro) {
  const { saldo } = resumoFinanceiroDoRegistro(registro);
  return saldo > 0 ? saldo : 0;
}

/**
 * O ENVIO: o pacote que a área entrega para a tela de Programação Diária.
 *
 * Leva o fornecedor e o valor a programar -- que é o que a programação precisa
 * --, mais o nome sugerido e a origem. Nada de nota, nada de processo, nada de
 * baixa e nada de saldo de conta.
 */
export function envioParaProgramacao(area, registro) {
  const cadastro = cadastroDoRegistro(registro);
  const origemTipo = origemDaArea(area);
  const origemId = textoLimpo(registro?.id);
  return {
    // Identidade do envio: é ela que impede o mesmo envio de ser aplicado duas
    // vezes quando a tela recarrega.
    chave: `${origemTipo}:${origemId}:${Date.now()}`,
    origem_tipo: origemTipo,
    origem_id: origemId,
    area_id: area?.id ?? null,
    area_rotulo: area?.rotulo ?? "",
    registro_descricao: descricaoDoRegistroParaProgramacao(area, registro),
    // O VÍNCULO: é por este id que a programação, a NF e a baixa se ligam ao
    // cadastro. O nome abaixo é só para a tela mostrar antes de recarregar.
    fornecedor_id: registro?.fornecedor_id ?? null,
    fornecedor: {
      razao_social: cadastro?.razao_social ?? null,
      nome_fantasia: cadastro?.nome_fantasia ?? null,
      apelido: cadastro?.apelido ?? null,
    },
    fornecedor_nome: nomeDoFornecedorDoRegistro(registro),
    // A programação é por secretaria: a do fornecedor é a que contém este item.
    secretaria_id: cadastro?.secretaria_id ?? registro?.secretaria_id ?? null,
    valor_a_pagar: valorAProgramar(registro),
    nome_exibicao_programacao: nomeSugeridoParaProgramacao(area, registro),
    enviado_em: new Date().toISOString(),
  };
}

/** O envio é utilizável? (fornecedor e origem completos, valor não negativo) */
export function envioValido(envio) {
  if (!envio || typeof envio !== "object") return false;
  if (envio.fornecedor_id == null || textoLimpo(envio.fornecedor_id) === "") return false;
  if (!ORIGENS_VALIDAS.includes(textoLimpo(envio.origem_tipo))) return false;
  if (textoLimpo(envio.origem_id) === "") return false;
  return Number(envio.valor_a_pagar) >= 0;
}

/**
 * O item da programação montado a partir do envio -- no MESMO formato dos itens
 * que a tela cria hoje ao marcar um fornecedor na lista. As duas únicas
 * diferenças são o nome sugerido (editável pelo lápis) e a origem.
 */
export function itemDeProgramacaoDoEnvio(envio) {
  return {
    id: null,
    fornecedor_id: envio.fornecedor_id,
    // O item guarda o cadastro só para MOSTRAR o nome; o vínculo é o id acima.
    fornecedores: {
      razao_social: envio.fornecedor?.razao_social ?? null,
      apelido: envio.fornecedor?.apelido ?? null,
    },
    nome_exibicao_programacao: envio.nome_exibicao_programacao ?? null,
    valor_a_pagar: Number(envio.valor_a_pagar) || 0,
    nome_avulso: null,
    cadastrar_fornecedor_posteriormente: false,
    origem_tipo: envio.origem_tipo,
    origem_id: envio.origem_id,
  };
}

/**
 * Aplica o envio na lista de itens da programação.
 *
 * Fornecedor QUE JÁ ESTÁ na programação não vira um segundo item: o item dele
 * fica onde está, com o VALOR QUE ESTAVA -- não é este envio que vai reescrever
 * um valor que alguém digitou --, e a origem e o nome sugerido só preenchem o
 * que estiver vazio. A pessoa lê o que aconteceu e ajusta o valor na própria
 * lista, se quiser.
 *
 * Função pura: devolve uma lista nova e não altera a recebida.
 */
export function aplicarEnvioNosPagamentos(pagamentos = [], envio) {
  const itens = Array.isArray(pagamentos) ? pagamentos : [];
  if (!envioValido(envio)) {
    return { pagamentos: itens, resultado: "invalido", mensagem: "" };
  }

  const existente = itens.find(
    (item) => String(item?.fornecedor_id ?? "") === String(envio.fornecedor_id),
  );

  if (existente) {
    return {
      pagamentos: itens.map((item) =>
        item !== existente
          ? item
          : {
              ...item,
              origem_tipo: itemTemOrigem(item) ? item.origem_tipo : envio.origem_tipo,
              origem_id: itemTemOrigem(item) ? item.origem_id : envio.origem_id,
              nome_exibicao_programacao:
                normalizarNomeExibicao(item.nome_exibicao_programacao) ??
                envio.nome_exibicao_programacao ??
                null,
            },
      ),
      resultado: "jaEstava",
      mensagem:
        `${envio.fornecedor_nome || "O fornecedor"} já estava nesta programação: o valor dele foi ` +
        `mantido como estava. ${rotuloDaOrigem(envio.origem_tipo)}` +
        `${envio.registro_descricao ? ` "${envio.registro_descricao}"` : ""} ficou registrado como ` +
        "origem do item. Ajuste o valor na própria lista, se for o caso, e salve a programação.",
    };
  }

  return {
    pagamentos: [...itens, itemDeProgramacaoDoEnvio(envio)],
    resultado: "adicionado",
    mensagem:
      `${rotuloDaOrigem(envio.origem_tipo)}` +
      `${envio.registro_descricao ? ` "${envio.registro_descricao}"` : ""} adicionado à programação: ` +
      `${envio.fornecedor_nome || "fornecedor"} com ${formatBRL(envio.valor_a_pagar)} a programar. ` +
      "O valor continua editável e o nome mostrado pode ser ajustado pelo lápis. " +
      "Confira e clique em Salvar programação — programar não é pagar.",
  };
}

/**
 * O recado de quando o envio chega e ainda NÃO há programação onde incluí-lo.
 *
 * Nenhuma regra nova é inventada aqui: sem programação aberta para a data, o
 * caminho continua sendo o de sempre -- criar a programação pelo botão "Nova
 * programação". Programação aprovada ou fechada também não recebe item novo,
 * como já era antes desta parte.
 */
export function avisoDeEnvioPendente(envio, { programacao, podeEditarProgramacao }) {
  if (!envioValido(envio)) return "";
  const identificacao =
    `${rotuloDaOrigem(envio.origem_tipo)}` +
    `${envio.registro_descricao ? ` "${envio.registro_descricao}"` : ""}` +
    `${envio.fornecedor_nome ? ` (${envio.fornecedor_nome})` : ""}`;

  if (!programacao) {
    return (
      `${identificacao} está esperando para entrar na programação. Não há programação aberta para ` +
      "a secretaria e a data selecionadas: crie uma em “Nova programação”, ou escolha outra " +
      "data, e o item entra em seguida."
    );
  }
  if (!podeEditarProgramacao) {
    return (
      `${identificacao} está esperando para entrar na programação. Esta programação está aprovada ` +
      "ou fechada e não recebe item novo: reabra-a, escolha outra programação da data ou crie uma " +
      "nova, e o item entra em seguida."
    );
  }
  return "";
}

/* -------------------------------------------------------------------------
 * A passagem de uma tela para a outra
 *
 * O envio viaja na sessão do navegador, como o sistema já faz em outras
 * passagens de tela (o submenu das áreas e o fornecedor escolhido na busca).
 * Não é dado gravado: é um recado de uma tela para a outra, apagado assim que
 * a programação o recebe.
 * ---------------------------------------------------------------------- */

export const CHAVE_ENVIO_PROGRAMACAO = "sfi.programacao.envioDeArea";

function deposito(alvo) {
  if (alvo) return alvo;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function guardarEnvio(envio, alvo) {
  const armazem = deposito(alvo);
  if (!armazem || !envioValido(envio)) return false;
  try {
    armazem.setItem(CHAVE_ENVIO_PROGRAMACAO, JSON.stringify(envio));
    return true;
  } catch {
    return false;
  }
}

export function lerEnvio(alvo) {
  const armazem = deposito(alvo);
  if (!armazem) return null;
  try {
    const bruto = armazem.getItem(CHAVE_ENVIO_PROGRAMACAO);
    if (!bruto) return null;
    const envio = JSON.parse(bruto);
    return envioValido(envio) ? envio : null;
  } catch {
    return null;
  }
}

export function limparEnvio(alvo) {
  const armazem = deposito(alvo);
  if (!armazem) return;
  try {
    armazem.removeItem(CHAVE_ENVIO_PROGRAMACAO);
  } catch {
    /* navegador sem armazenamento: nada a limpar */
  }
}
