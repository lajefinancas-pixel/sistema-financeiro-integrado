// Consultas da Central de Relatórios.
//
// Nada de saldo é calculado aqui: o Saldo Real, o Valor Reservado e o Saldo
// Disponível de cada conta vêm da fonte única (carregarSaldosDasContas), a mesma
// usada pelo Painel Principal, por Saldos das Contas e por Pagamentos Diários --
// assim um relatório nunca mostra um total diferente do que a tela mostra.
//
// Os fornecedores são lidos sem o filtro de "ativo", porque a Central tem um
// relatório de ativos/inativos; as telas de cadastro continuam vendo só os ativos.

import { supabase } from "./supabaseClient";
import { carregarSaldosDasContas } from "./saldosContasDados";

/** Contas bancárias com saldo, prontas para os relatórios financeiros. */
export async function carregarBaseFinanceira() {
  const { data: secs, error: erroSecretarias } = await supabase
    .from("secretarias")
    .select("id, nome")
    .order("nome");
  if (erroSecretarias) throw erroSecretarias;

  const { data: contas, error: erroContas } = await supabase
    .from("contas_bancarias")
    .select("id, nome_conta, numero_conta, tipo_conta, secretaria_id, bancos(nome)")
    .eq("ativo", true);
  if (erroContas) throw erroContas;

  const nomeDaSecretaria = new Map((secs ?? []).map((s) => [String(s.id), s.nome]));

  const { contas: comSaldo, rateioIndisponivel } = await carregarSaldosDasContas({
    contas: (contas ?? []).map((c) => ({
      id: c.id,
      secretaria_id: c.secretaria_id,
      secretaria: nomeDaSecretaria.get(String(c.secretaria_id)) ?? "Sem secretaria",
      banco: c.bancos?.nome ?? "--",
      nome_conta: c.nome_conta,
      numero_conta: c.numero_conta,
      tipo_conta: c.tipo_conta,
    })),
  });

  return { secretarias: secs ?? [], contas: comSaldo, rateioIndisponivel };
}

/** Cadastro de fornecedores (ativos e inativos) com o nome da secretaria. */
export async function carregarBaseFornecedores() {
  const { data, error } = await supabase
    .from("fornecedores")
    .select(
      "id, razao_social, nome_fantasia, cpf_cnpj, telefone, email, ativo, created_at, secretaria_id, secretarias(nome)"
    )
    .order("razao_social");
  if (error) throw error;

  return {
    fornecedores: (data ?? []).map((f) => ({
      ...f,
      secretaria: f.secretarias?.nome ?? "Sem secretaria",
    })),
  };
}
