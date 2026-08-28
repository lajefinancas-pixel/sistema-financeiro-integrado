// Verificação de estrutura da Fase 2 dos Pagamentos Diários (execução financeira).
//
// A tela precisa funcionar ANTES de a migration da Fase 2 rodar no SQL Editor:
// em vez de quebrar, ela mostra o aviso dizendo exatamente qual objeto falta e
// desliga só os botões que dependem dele. É o mesmo comportamento da entrega do
// cadastro de contas.
//
// A classificação da falha é reaproveitada da Fase 1 (por CÓDIGO, nunca pelo
// texto da mensagem), então falha de permissão e sessão expirada continuam sem
// virar "falta migration".
//
// As funções (RPC) não são sondadas de propósito: chamá-las moveria dinheiro. A
// ausência delas é classificada quando a tela realmente as chama.

import { classificarFalhaFase1 } from "./estruturaPagamentosFase1.js";

export { classificarFalhaFase1 } from "./estruturaPagamentosFase1.js";

/** Tabelas e colunas que a etapa de execução precisa ler e gravar. */
export const ESTRUTURA_FASE_2 = [
  { tabela: "programacoes_pagamento", colunas: ["aprovada_em", "aprovada_por"] },
  { tabela: "pagamentos", colunas: ["conta_origem_id"] },
  {
    tabela: "transferencia_lotes",
    colunas: ["id", "chave_idempotencia", "conta_destino_id", "valor_total", "quantidade_origens", "status"],
  },
  {
    tabela: "transferencias_contas",
    colunas: [
      "id",
      "lote_id",
      "programacao_id",
      "conta_origem_id",
      "conta_destino_id",
      "valor",
      "saldo_origem_antes",
      "saldo_origem_depois",
      "saldo_destino_antes",
      "saldo_destino_depois",
      "status",
      "motivo_estorno",
      "estorno_de_transferencia_id",
    ],
  },
];

/** Assinaturas exatas esperadas pelas chamadas de RPC desta fase. */
export const FUNCOES_FASE_2 = [
  {
    nome: "aprovar_programacao_pagamento",
    assinatura:
      "(p_programacao_id integer, p_saldo_considerado numeric, p_total_programado numeric, p_restante numeric)",
  },
  {
    nome: "definir_conta_origem_pagamento",
    assinatura: "(p_programacao_id integer, p_pagamento_ids integer[], p_conta_id integer)",
  },
  {
    nome: "confirmar_transferencias_programacao",
    assinatura:
      "(p_programacao_id integer, p_conta_destino_id integer, p_transferencias jsonb, p_chave_idempotencia text, p_observacao text)",
  },
  { nome: "estornar_transferencia", assinatura: "(p_transferencia_id uuid, p_observacao text)" },
  { nome: "pode_em_pagamentos_fase2", assinatura: "(p_acao text)" },
];

/** Consulta de sonda: valida os nomes das colunas sem trazer nenhuma linha. */
async function sondar(cliente, tabela, colunas) {
  try {
    const { error } = await cliente.from(tabela).select(colunas.join(",")).limit(0);
    return error ?? null;
  } catch (falha) {
    return falha;
  }
}

async function conferirTabela(cliente, item) {
  const erro = await sondar(cliente, item.tabela, item.colunas);
  if (!erro) return { faltando: [], naoVerificado: [], falhas: [] };

  const classificacao = classificarFalhaFase1(erro);
  const falhas = [{ objeto: item.tabela, erro, classificacao }];

  if (classificacao.tipo !== "estrutura") {
    // Permissão, rede ou qualquer outra coisa: não dá para afirmar que falta.
    return { faltando: [], naoVerificado: [item.tabela], falhas };
  }
  if (classificacao.alvo === "tabela") {
    return { faltando: [item.tabela], naoVerificado: [], falhas };
  }

  // Alguma coluna não existe: descobre exatamente quais.
  const porColuna = await Promise.all(
    item.colunas.map(async (coluna) => {
      const erroColuna = await sondar(cliente, item.tabela, [coluna]);
      if (!erroColuna) return null;
      return { coluna, erro: erroColuna, classificacao: classificarFalhaFase1(erroColuna) };
    })
  );

  const detalhes = porColuna.filter(Boolean);
  return {
    faltando: detalhes.filter((d) => d.classificacao.tipo === "estrutura").map((d) => `${item.tabela}.${d.coluna}`),
    naoVerificado: detalhes.filter((d) => d.classificacao.tipo !== "estrutura").map((d) => `${item.tabela}.${d.coluna}`),
    falhas: [
      ...falhas,
      ...detalhes.map((d) => ({ objeto: `${item.tabela}.${d.coluna}`, erro: d.erro, classificacao: d.classificacao })),
    ],
  };
}

/**
 * Confere a estrutura da Fase 2 no banco que esta tela está usando.
 *
 * @returns {{ ok: boolean, faltando: string[], naoVerificado: string[], falhas: object[] }}
 *   `faltando` lista o que o banco afirmou não existir. `naoVerificado` lista o
 *   que não deu para conferir (permissão, rede) -- e que por isso não é acusado.
 */
export async function verificarEstruturaFase2(cliente) {
  const partes = await Promise.all(ESTRUTURA_FASE_2.map((item) => conferirTabela(cliente, item)));
  const faltando = partes.flatMap((parte) => parte.faltando);
  const naoVerificado = partes.flatMap((parte) => parte.naoVerificado);
  return {
    ok: faltando.length === 0,
    faltando,
    naoVerificado,
    falhas: partes.flatMap((parte) => parte.falhas),
  };
}
