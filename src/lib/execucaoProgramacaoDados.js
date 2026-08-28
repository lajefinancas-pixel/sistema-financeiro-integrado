// Consultas e comandos da Fase 2 dos Pagamentos Diários.
//
// Toda a gravação desta fase passa por função do banco (RPC), nunca por update
// solto na tabela: é lá que ficam a atomicidade da transferência, a trava de
// idempotência e a conferência de permissão. Aqui só há o transporte e a
// tradução dos erros.

import { supabase } from "./supabaseClient";
import { carregarSaldosDasContas } from "./saldosContasDados";
import { secretariasRelacionadas } from "./segregacaoSecretarias.js";
import { classificarFalhaFase1 } from "./estruturaPagamentosFase1.js";

export { secretariasRelacionadas } from "./segregacaoSecretarias.js";

/** A falha é "a migration da Fase 2 ainda não rodou"? */
export function estruturaFase2Ausente(erro) {
  return classificarFalhaFase1(erro).tipo === "estrutura";
}

/** Identificador único da transferência: é ele que impede a operação em dobro. */
export function novaChaveIdempotencia() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `transf-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Contas que podem aparecer no painel de transferência, com saldo atual.
 *
 * Traz as contas da secretaria da programação e as das secretarias que podem
 * legitimamente trocar com ela, para que a tela consiga oferecer a exceção de
 * Finanças sem abrir a porta para o resto.
 */
export async function carregarContasParaTransferencia({ secretariaId, secretarias = [] } = {}) {
  const atual = secretarias.find((item) => String(item.id) === String(secretariaId)) ?? { id: secretariaId, nome: "" };
  const idsSecretarias = secretariasRelacionadas(atual, secretarias);

  const { data: brutas, error } = await supabase
    .from("contas_bancarias")
    .select("id, nome_conta, numero_conta, secretaria_id, bancos(nome)")
    .in("secretaria_id", idsSecretarias)
    .eq("ativo", true)
    .order("nome_conta");
  if (error) throw error;

  const nomePorSecretaria = new Map(secretarias.map((item) => [String(item.id), item.nome]));
  const { contas } = await carregarSaldosDasContas({
    contas: (brutas ?? []).map((conta) => ({
      id: conta.id,
      nome_conta: conta.nome_conta,
      numero_conta: conta.numero_conta,
      banco: conta.bancos?.nome || "--",
      secretaria_id: conta.secretaria_id,
      secretaria: nomePorSecretaria.get(String(conta.secretaria_id)) || "--",
      secretaria_nome: nomePorSecretaria.get(String(conta.secretaria_id)) || "",
    })),
    comReservas: false,
  });

  return contas;
}

/**
 * Razão das transferências da programação: as confirmadas, as estornadas e os
 * próprios estornos, na ordem em que aconteceram.
 */
export async function carregarTransferenciasDaProgramacao(programacaoId) {
  const { data, error } = await supabase
    .from("transferencias_contas")
    .select(
      "id, lote_id, programacao_id, conta_origem_id, conta_destino_id, valor, saldo_origem_antes, saldo_origem_depois, saldo_destino_antes, saldo_destino_depois, data_movimento, observacao, usuario_id, criado_em, status, estorno_de_transferencia_id, motivo_estorno, estornada_em"
    )
    .eq("programacao_id", programacaoId)
    .order("criado_em", { ascending: false });
  if (error) throw error;

  const linhas = data ?? [];
  const idsUsuarios = [...new Set(linhas.map((linha) => linha.usuario_id).filter(Boolean))];
  let nomes = new Map();
  if (idsUsuarios.length) {
    // Falha aqui não pode esconder a razão: sem o nome, mostra o essencial.
    const { data: usuarios } = await supabase.from("usuarios").select("id, nome_completo").in("id", idsUsuarios);
    nomes = new Map((usuarios ?? []).map((usuario) => [String(usuario.id), usuario.nome_completo]));
  }

  return linhas.map((linha) => ({ ...linha, usuario_nome: nomes.get(String(linha.usuario_id)) || "--" }));
}

/** Aprova a programação. Não move saldo nenhum -- APROVADO NÃO É PAGO. */
export async function aprovarProgramacao({ programacaoId, saldoConsiderado, totalProgramado, restante }) {
  const { data, error } = await supabase.rpc("aprovar_programacao_pagamento", {
    p_programacao_id: programacaoId,
    p_saldo_considerado: saldoConsiderado ?? null,
    p_total_programado: totalProgramado ?? null,
    p_restante: restante ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * Define a conta de origem de um ou mais pagamentos.
 *
 * A mesma chamada atende os três caminhos da tela: um pagamento, os pagamentos
 * marcados e todos. CONTA DEFINIDA NÃO É DÉBITO.
 */
export async function definirContaDePagamentos({ programacaoId, pagamentoIds, contaId }) {
  const { data, error } = await supabase.rpc("definir_conta_origem_pagamento", {
    p_programacao_id: programacaoId,
    p_pagamento_ids: pagamentoIds,
    p_conta_id: contaId ?? null,
  });
  if (error) throw error;
  return data;
}

/** As cinco permissões desta fase, com o padrão do módulo como reserva. */
export const ACOES_FASE_2 = [
  "aprovar_programacao",
  "executar_programacao",
  "definir_conta_pagamento",
  "executar_transferencia",
  "estornar_transferencia",
];

/**
 * Resolve as permissões da fase.
 *
 * Enquanto a migration não rodar, `pode_em_pagamentos_fase2` não existe: nesse
 * caso vale a permissão do módulo Pagamentos, que é o mesmo padrão que a matriz
 * de permissões já mostra. Assim ninguém fica sem acesso por causa da ordem em
 * que as coisas são aplicadas.
 */
export async function carregarPermissoesFase2(permissaoModulo) {
  const padrao = {
    aprovar_programacao: permissaoModulo?.pode_aprovar === true,
    executar_programacao: permissaoModulo?.pode_aprovar === true,
    definir_conta_pagamento: permissaoModulo?.pode_editar !== false,
    executar_transferencia: permissaoModulo?.pode_aprovar === true,
    estornar_transferencia: permissaoModulo?.pode_excluir === true,
  };

  const resultados = await Promise.all(
    ACOES_FASE_2.map(async (acao) => {
      try {
        const { data, error } = await supabase.rpc("pode_em_pagamentos_fase2", { p_acao: acao });
        if (error) throw error;
        return [acao, data === true];
      } catch (falha) {
        return [acao, padrao[acao]];
      }
    })
  );

  return Object.fromEntries(resultados);
}
