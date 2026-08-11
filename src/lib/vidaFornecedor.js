// Pagamentos já efetivados, agrupados por fornecedor.
//
// É só leitura para a "Vida do Fornecedor" da tela de Fornecedores: o valor de
// cada linha é o `valor_a_pagar` que a própria tela de Pagamentos Diários
// gravou, e a conta utilizada vem da razão de débitos (pagamento_movimentacoes).
// Nada aqui recalcula saldo, rateio ou situação de pagamento.
//
// A leitura é paginada porque o PostgREST devolve no máximo 1000 linhas por
// consulta -- um histórico maior que isso viria pela metade.

import { supabase } from "./supabaseClient";
import { buscarPaginado } from "./saldosContasDados";
import { paraNumeroMoeda } from "./moeda";

const SITUACOES_PAGAMENTO = {
  pago: "Pago",
  cancelado: "Cancelado",
  pendente: "Pendente",
};

function soData(v) {
  return v ? String(v).slice(0, 10) : "";
}

/** "Banco do Brasil -- Conta Movimento (12345-6)" a partir do cadastro da conta. */
function nomeDaConta(conta) {
  if (!conta) return "";
  const partes = [conta.bancos?.nome, conta.nome_conta].filter(Boolean);
  const texto = partes.join(" -- ");
  return conta.numero_conta ? `${texto} (${conta.numero_conta})` : texto;
}

/**
 * `{ [fornecedor_id]: [{ id, data, valor, contas, secretaria, status, descricao }] }`,
 * da movimentação mais recente para a mais antiga.
 */
export async function carregarPagamentosPorFornecedor() {
  const pagamentos = await buscarPaginado(() =>
    supabase
      .from("pagamentos")
      .select("id, fornecedor_id, programacao_id, valor_a_pagar, situacao, descricao")
      .eq("situacao", "pago")
      .order("id", { ascending: true })
  );
  if (pagamentos.length === 0) return {};

  const [programacoes, movimentacoes, contas, secretarias] = await Promise.all([
    buscarPaginado(() =>
      supabase
        .from("programacoes_pagamento")
        .select("id, data_programacao, secretaria_id")
        .order("id", { ascending: true })
    ),
    // A conta utilizada é enriquecimento: se a razão de débitos não estiver
    // disponível, os pagamentos continuam aparecendo sem o nome da conta.
    buscarPaginado(() =>
      supabase
        .from("pagamento_movimentacoes")
        .select("pagamento_id, conta_id")
        .order("id", { ascending: true })
    ).catch(() => []),
    supabase
      .from("contas_bancarias")
      .select("id, nome_conta, numero_conta, bancos(nome)")
      .then(({ data, error }) => {
        if (error) return [];
        return data ?? [];
      }),
    supabase
      .from("secretarias")
      .select("id, nome")
      .then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      }),
  ]);

  const programacaoPorId = new Map(programacoes.map((p) => [String(p.id), p]));
  const nomeDaSecretaria = new Map(secretarias.map((s) => [String(s.id), s.nome]));
  const contaPorId = new Map(contas.map((c) => [String(c.id), c]));

  // Um pagamento pode ter saído de mais de uma conta (rateio): todas aparecem.
  const contasDoPagamento = {};
  movimentacoes.forEach((m) => {
    const nome = nomeDaConta(contaPorId.get(String(m.conta_id)));
    if (!nome) return;
    const lista = (contasDoPagamento[String(m.pagamento_id)] ??= []);
    if (!lista.includes(nome)) lista.push(nome);
  });

  const porFornecedor = {};
  pagamentos.forEach((p) => {
    if (!p.fornecedor_id) return; // pagamento avulso não pertence a um cadastro
    const programacao = programacaoPorId.get(String(p.programacao_id)) ?? {};
    (porFornecedor[String(p.fornecedor_id)] ??= []).push({
      id: p.id,
      data: soData(programacao.data_programacao),
      valor: paraNumeroMoeda(p.valor_a_pagar),
      contas: contasDoPagamento[String(p.id)] ?? [],
      secretaria: nomeDaSecretaria.get(String(programacao.secretaria_id)) ?? "",
      status: SITUACOES_PAGAMENTO[p.situacao] ?? "Pendente",
      descricao: p.descricao ?? "",
    });
  });

  Object.values(porFornecedor).forEach((lista) =>
    lista.sort((a, b) => String(b.data).localeCompare(String(a.data)))
  );
  return porFornecedor;
}
