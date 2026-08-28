// Cadastro das contas bancárias do módulo Saldos das Contas.
//
// Aqui ficam as regras do CADASTRO da conta — banco, número, nome de uso
// interno, tipo, secretaria e fonte de recurso — e a situação dela (ativa ou
// desativada). O SALDO não está aqui: ele mora em public.saldos_historico, por
// data, e é gravado exclusivamente por ./lancamentoSaldos.js.
//
// Duas garantias que o resto do sistema depende:
//
//   1. Editar o cadastro nunca toca em saldo. As funções de atualização
//      escrevem apenas em contas_bancarias.
//   2. Desativar não é excluir. `ativo = false` tira a conta das telas de uso
//      corrente e mantém intactos todos os lançamentos e movimentações dela,
//      que continuam disponíveis em Histórico, Relatórios e Auditoria.
//
// A coluna fonte_recurso_id e a tabela public.fontes_recurso chegam pela
// migration 20260828120000. Enquanto ela não roda, as consultas daqui caem para
// a versão sem fonte de recurso em vez de derrubar a tela.

import { supabase } from "./supabaseClient";

// Todas as regras puras do cadastro (validação, duplicidade, comparação
// antes/depois) ficam em ./contasBancariasRegras.js e são reexportadas aqui.
export {
  TIPOS_CONTA,
  ROTULOS_CONTA,
  tipoContaLabel,
  chaveDoNumero,
  validarCadastroConta,
  saldoInicialInformado,
  contaDuplicada,
  mensagemDuplicidade,
  alteracoesDoCadastro,
  retratoDoCadastro,
  retratoDasAlteracoes,
} from "./contasBancariasRegras";

// ---------------------------------------------------------------------------
// Consultas e gravações
// ---------------------------------------------------------------------------

/**
 * Falhas que significam "a estrutura da fonte de recurso ainda não existe neste
 * banco" (migration 20260828120000 não rodada), e não erro de uso. Mesmo
 * critério de `estruturaDeRateioAusente`.
 */
export function estruturaDeFonteAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) return true;
  return /schema cache|fonte_recurso|fontes_recurso/i.test(String(erro?.message ?? ""));
}

const COLUNAS_BASE = "id, nome_conta, numero_conta, tipo_conta, secretaria_id, banco_id, ativo, bancos(nome)";
const COLUNAS_COM_FONTE = `${COLUNAS_BASE}, fonte_recurso_id`;

/**
 * Contas do cadastro. `situacao` é "ativas" (padrão), "inativas" ou "todas".
 *
 * Tenta trazer a fonte de recurso; se a coluna ainda não existe, repete a
 * consulta sem ela e avisa em `comFonteRecurso: false` — a tela então esconde o
 * campo em vez de mostrar erro.
 */
export async function carregarContasDoCadastro({ situacao = "ativas" } = {}) {
  async function consultar(colunas) {
    let consulta = supabase.from("contas_bancarias").select(colunas);
    if (situacao === "ativas") consulta = consulta.eq("ativo", true);
    if (situacao === "inativas") consulta = consulta.eq("ativo", false);
    const { data, error } = await consulta.order("id", { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  try {
    return { contas: await consultar(COLUNAS_COM_FONTE), comFonteRecurso: true };
  } catch (e) {
    if (!estruturaDeFonteAusente(e)) throw e;
    return { contas: await consultar(COLUNAS_BASE), comFonteRecurso: false };
  }
}

/** Catálogo de fontes de recurso; `null` quando a tabela ainda não existe. */
export async function carregarFontesRecurso() {
  try {
    const { data, error } = await supabase
      .from("fontes_recurso")
      .select("id, nome, ativo")
      .eq("ativo", true)
      .order("nome");
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    if (estruturaDeFonteAusente(e)) return null;
    throw e;
  }
}

export async function criarFonteRecurso(nome) {
  const { data, error } = await supabase
    .from("fontes_recurso")
    .insert({ nome: String(nome).trim() })
    .select("id, nome")
    .single();
  if (error) throw error;
  return data;
}

/** Payload do cadastro, sem nenhum campo de saldo. */
function payloadDoCadastro({ secretariaId, bancoId, nomeConta, numeroConta, tipoConta, fonteRecursoId }, { comFonteRecurso }) {
  const payload = {
    secretaria_id: secretariaId,
    banco_id: bancoId,
    nome_conta: String(nomeConta).trim(),
    numero_conta: String(numeroConta).trim(),
    tipo_conta: String(tipoConta).trim() || null,
  };
  if (comFonteRecurso) {
    payload.fonte_recurso_id = fonteRecursoId === "" || fonteRecursoId == null ? null : Number(fonteRecursoId);
  }
  return payload;
}

/**
 * Cria a conta. O saldo inicial NÃO entra aqui: quem o grava é
 * `lancarSaldoDaConta`, a mesma rotina do lançamento diário.
 */
export async function criarContaBancaria(dados, { comFonteRecurso = true } = {}) {
  const { data, error } = await supabase
    .from("contas_bancarias")
    .insert(payloadDoCadastro(dados, { comFonteRecurso }))
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

/** Atualiza só o cadastro. Nenhum saldo e nenhum histórico é tocado. */
export async function atualizarContaBancaria(id, dados, { comFonteRecurso = true } = {}) {
  const { error } = await supabase
    .from("contas_bancarias")
    .update(payloadDoCadastro(dados, { comFonteRecurso }))
    .eq("id", id);
  if (error) throw error;
}

/**
 * Desativa (ativo = false) ou reativa (ativo = true) a conta. É a única
 * "exclusão" que existe para conta bancária: o histórico financeiro fica
 * inteiro no banco.
 */
export async function definirSituacaoConta(id, ativo) {
  const { error } = await supabase.from("contas_bancarias").update({ ativo: ativo === true }).eq("id", id);
  if (error) throw error;
}

/**
 * Programações ainda em elaboração que já escolheram esta conta — a tela avisa
 * antes de confirmar a desativação. Programação fechada ou histórica não conta:
 * ela é registro do passado e continua íntegra.
 */
export async function programacoesEmElaboracaoComConta(contaId) {
  try {
    const { data, error } = await supabase
      .from("programacao_contas")
      .select("programacao_id, ativa, programacoes_pagamento(id, nome_programacao, data_programacao, status, fechado)")
      .eq("conta_id", contaId);
    if (error) throw error;

    const vistas = new Set();
    const lista = [];
    for (const linha of data ?? []) {
      const programacao = linha.programacoes_pagamento;
      if (!programacao) continue;
      if (linha.ativa === false) continue;
      if (programacao.fechado === true) continue;
      if (programacao.status !== "em_elaboracao") continue;
      const chave = String(programacao.id);
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      lista.push({
        id: programacao.id,
        nome: programacao.nome_programacao,
        data: programacao.data_programacao,
      });
    }
    return lista;
  } catch (e) {
    // Sem a estrutura de programação no ambiente não há o que avisar: a
    // desativação segue normalmente.
    if (estruturaDeFonteAusente(e)) return [];
    throw e;
  }
}
