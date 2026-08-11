// Consultas da Central de Relatórios.
//
// Nada de saldo é calculado aqui: o Saldo Real, o Valor Reservado e o Saldo
// Disponível de cada conta vêm da fonte única (carregarSaldosDasContas), a mesma
// usada pelo Painel Principal, por Saldos das Contas e por Pagamentos Diários --
// assim um relatório nunca mostra um total diferente do que a tela mostra.
//
// Os fornecedores são lidos sem o filtro de "ativo", porque a Central tem um
// relatório de ativos/inativos; as telas de cadastro continuam vendo só os ativos.
//
// As bases de Tributário, Usuários e Gestão e Auditoria seguem a mesma ideia:
// nada é recalculado aqui. O tributário lê as retenções já lançadas em
// valores_em_aberto -- as mesmas que a tela de Fornecedores usa nos filtros
// tributários --, identificando o fornecedor pelo cadastro. As tarefas vêm de
// listarTarefas (a consulta da própria página Tarefas) e a trilha vem de
// tarefas_historico, que é a base de auditoria disponível hoje.

import { supabase } from "./supabaseClient";
import { buscarPaginado, carregarSaldosDasContas } from "./saldosContasDados";
import { paraNumeroMoeda } from "./moeda";
import { somar } from "./rateioPagamentos";
import { soData } from "./relatoriosCatalogo";
import {
  categoriaLabel,
  estaAtrasada,
  formatarDataHora,
  listarTarefas,
  prioridadeInfo,
  statusInfo,
  textoHistorico,
} from "./tarefas";

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

/**
 * Posição das mesmas contas numa data passada -- é o lado "mês anterior" dos
 * relatórios comparativos. O saldo vem da mesma fonte única, só com o corte de
 * data (`ate`), então o valor histórico é lido do saldos_historico e não estimado.
 *
 * As contas são repassadas sem nenhum campo de saldo de propósito: quando uma
 * conta não tem histórico até aquela data, ela precisa aparecer com zero, e não
 * herdar o saldo de hoje. Reservas ficam de fora -- a comparação é de saldo real.
 */
export async function carregarSaldosNaData({ contas, ate }) {
  const { contas: comSaldo } = await carregarSaldosDasContas({
    contas: (contas ?? []).map((c) => ({
      id: c.id,
      secretaria_id: c.secretaria_id,
      secretaria: c.secretaria,
      banco: c.banco,
      nome_conta: c.nome_conta,
      numero_conta: c.numero_conta,
      tipo_conta: c.tipo_conta,
    })),
    ate,
    comReservas: false,
  });
  return comSaldo;
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

/* -------------------------------------------------------------------------
 * Pagamentos (fonte dos relatórios personalizados)
 * ---------------------------------------------------------------------- */

// Situação de um pagamento lançado na programação. A tela de Pagamentos
// Diários trata "pago" como efetivado e qualquer outra coisa como pendente;
// aqui o rótulo apenas repete essa leitura, sem recalcular nada.
const SITUACOES_PAGAMENTO = {
  pago: "Pago",
  cancelado: "Cancelado",
  pendente: "Pendente",
};

function rotuloSituacaoPagamento(situacao) {
  return SITUACOES_PAGAMENTO[situacao] ?? "Pendente";
}

/**
 * Pagamentos lançados nas programações, com a secretaria, a data e o fornecedor
 * já resolvidos. Nenhum saldo é calculado aqui: o valor é o `valor_a_pagar` que
 * a própria tela de Pagamentos Diários gravou.
 *
 * A leitura é paginada porque o PostgREST devolve no máximo 1000 linhas por
 * consulta -- um histórico maior que isso viria pela metade.
 */
export async function carregarBasePagamentos() {
  const { data: secs, error: erroSecretarias } = await supabase
    .from("secretarias")
    .select("id, nome");
  if (erroSecretarias) throw erroSecretarias;

  const programacoes = await buscarPaginado(() =>
    supabase
      .from("programacoes_pagamento")
      .select("id, nome_programacao, data_programacao, secretaria_id, fechado")
      .order("id", { ascending: true })
  );

  const pagamentos = await buscarPaginado(() =>
    supabase
      .from("pagamentos")
      .select(
        "id, programacao_id, valor_a_pagar, situacao, nome_avulso, descricao, fornecedores(razao_social), valores_em_aberto(numero_nota_fiscal)"
      )
      .order("id", { ascending: true })
  );

  const nomeDaSecretaria = new Map((secs ?? []).map((s) => [String(s.id), s.nome]));
  const programacaoPorId = new Map((programacoes ?? []).map((p) => [String(p.id), p]));

  return {
    pagamentos: (pagamentos ?? []).map((p) => {
      const programacao = programacaoPorId.get(String(p.programacao_id)) ?? {};
      return {
        id: p.id,
        fornecedor: p.fornecedores?.razao_social ?? p.nome_avulso ?? "Sem fornecedor",
        secretaria: nomeDaSecretaria.get(String(programacao.secretaria_id)) ?? "Sem secretaria",
        programacao: programacao.nome_programacao ?? "",
        data: soData(programacao.data_programacao),
        nota: p.valores_em_aberto?.numero_nota_fiscal ?? "",
        descricao: p.descricao ?? "",
        valor: paraNumeroMoeda(p.valor_a_pagar),
        status: rotuloSituacaoPagamento(p.situacao),
        status_chave: p.situacao ?? "pendente",
        movimento: programacao.fechado === true ? "Fechado" : "Aberto",
      };
    }),
  };
}

/* -------------------------------------------------------------------------
 * Tributário
 * ---------------------------------------------------------------------- */

const SITUACOES_LANCAMENTO = {
  em_aberto: "Em aberto",
  programado: "Programado",
  parcialmente_pago: "Parcialmente pago",
  pago: "Pago",
  suspenso: "Suspenso",
  cancelado: "Cancelado",
};

/** "5,00%" -- vazio quando não há alíquota informada. */
function textoAliquota(valor) {
  const numero = paraNumeroMoeda(valor);
  if (numero <= 0) return "";
  return `${numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Pendência tributária: lançamento fora do Simples, com alíquota informada e
 * nenhuma retenção aplicada. É a mesma regra do filtro tributário da tela de
 * Fornecedores -- o relatório só a repete, não cria critério novo.
 */
function pendenciaTributaria(v) {
  return (
    v.optante_simples === false &&
    (paraNumeroMoeda(v.aliquota_iss) > 0 || paraNumeroMoeda(v.aliquota_ir) > 0) &&
    paraNumeroMoeda(v.desconto_iss) <= 0 &&
    paraNumeroMoeda(v.desconto_ir) <= 0
  );
}

/**
 * Lançamentos dos fornecedores com os dados tributários que já existem no
 * cadastro: base de cálculo, alíquotas, ISS e IRPJ retidos e a situação do
 * pagamento. O "*" dos lançamentos é intencional (igual à tela de Fornecedores):
 * bancos com colunas tributárias a mais ou a menos continuam respondendo, sem
 * quebrar o relatório.
 */
export async function carregarBaseTributaria() {
  const { data: forns, error: erroFornecedores } = await supabase
    .from("fornecedores")
    .select("id, razao_social, cpf_cnpj, secretarias(nome)");
  if (erroFornecedores) throw erroFornecedores;


  const { data: valores, error: erroValores } = await supabase.from("valores_em_aberto").select("*");
  if (erroValores) throw erroValores;

  const fornecedorPorId = new Map((forns ?? []).map((f) => [String(f.id), f]));

  const lancamentos = (valores ?? []).map((v) => {
    const f = fornecedorPorId.get(String(v.fornecedor_id)) ?? {};
    const valorIss = paraNumeroMoeda(v.desconto_iss);
    const valorIr = paraNumeroMoeda(v.desconto_ir);
    const bruto = paraNumeroMoeda(v.valor_bruto ?? v.valor);

    return {
      id: v.id,
      fornecedor_id: v.fornecedor_id ?? null,
      razao_social: f.razao_social ?? "Fornecedor não identificado",
      cpf_cnpj: f.cpf_cnpj ?? "",
      secretaria: f.secretarias?.nome ?? "Sem secretaria",
      nota: v.numero_nota_fiscal ?? "",
      data_nota: soData(v.data_nota_fiscal),
      valor_bruto: bruto,
      base_calculo: paraNumeroMoeda(v.base_calculo ?? bruto),
      aliquota_iss_texto: textoAliquota(v.aliquota_iss),
      aliquota_ir_texto: textoAliquota(v.aliquota_ir),
      valor_iss: valorIss,
      valor_ir: valorIr,
      total_retido: somar([valorIss, valorIr]),
      valor_liquido: paraNumeroMoeda(v.valor),
      situacao: SITUACOES_LANCAMENTO[v.situacao] ?? v.situacao ?? "",
      pendencia: pendenciaTributaria(v),
    };
  });

  return { lancamentos };
}

/* -------------------------------------------------------------------------
 * Usuários e Gestão (tarefas)
 * ---------------------------------------------------------------------- */

/**
 * Tarefas com os nomes já resolvidos (responsável, quem criou, quem concluiu e
 * quem aprovou). A consulta é a mesma da página Tarefas, que já sabe conviver
 * com bancos onde as colunas de aprovação ainda não existem; quando faltam,
 * "aprovada" simplesmente não vem e o relatório de aprovações fica vazio.
 */
export async function carregarBaseTarefas() {
  const [tarefas, usuarios] = await Promise.all([
    listarTarefas(),
    supabase.from("usuarios").select("id, nome_completo"),
  ]);

  // O nome de quem aprovou vem desta lista (a coluna guarda só o id). Se a
  // leitura de usuários não estiver disponível, o relatório segue com os demais
  // dados e apenas essa coluna fica em branco.
  const nomePorId = new Map((usuarios.data ?? []).map((u) => [String(u.id), u.nome_completo]));
  const nomeDe = (id, alternativa) => nomePorId.get(String(id)) ?? alternativa ?? "";

  return {
    tarefas: (tarefas ?? []).map((t) => ({
      id: t.id,
      titulo: t.titulo ?? "--",
      status: statusInfo(t.status).label,
      status_chave: t.status ?? "nova",
      prioridade: prioridadeInfo(t.prioridade).label,
      categoria: categoriaLabel(t.categoria),
      secretaria: t.secretaria_relacionada ?? "",
      responsavel: t.responsavel?.nome_completo ?? "Sem responsável",
      autor: t.autor?.nome_completo ?? "",
      prazo: soData(t.prazo),
      atrasada: estaAtrasada(t),
      prazo_situacao: !t.prazo ? "Sem prazo" : estaAtrasada(t) ? "Atrasada" : "Em dia",
      concluida_em: t.concluida_em ?? null,
      concluida_em_texto: t.concluida_em ? formatarDataHora(t.concluida_em) : "",
      concluida_por: t.finalizador?.nome_completo ?? nomeDe(t.concluida_por),
      observacao_final: t.observacao_final ?? "",
      aprovada: t.aprovada === true,
      aprovada_por: nomeDe(t.aprovada_por),
      aprovada_em: t.aprovada_em ?? null,
      aprovada_em_texto: t.aprovada_em ? formatarDataHora(t.aprovada_em) : "",
    })),
  };
}

/* -------------------------------------------------------------------------
 * Atividades e Auditoria (trilha das tarefas)
 * ---------------------------------------------------------------------- */

// Enquanto a tabela de auditoria completa não existir, tarefas_historico é a
// trilha disponível: é ela que guarda quem fez o quê e quando.
const ACOES_HISTORICO = {
  criou: "Criação",
  mudou_status: "Mudança de status",
  concluiu: "Conclusão",
  reabriu: "Reabertura",
  delegou: "Delegação",
  compartilhou: "Compartilhamento",
  removeu_compartilhamento: "Fim do compartilhamento",
  enviou_para_aprovacao: "Envio para aprovação",
  aprovou: "Aprovação",
  devolveu: "Devolução",
  gerou_recorrencia: "Repetição automática",
};

/** Teto de leitura da trilha: a base avisa quando ele é alcançado. */
export const LIMITE_HISTORICO = 2000;

function rotuloAcao(acao) {
  if (ACOES_HISTORICO[acao]) return ACOES_HISTORICO[acao];
  const texto = String(acao ?? "").replace(/_/g, " ").trim();
  return texto === "" ? "Registro" : texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Registros da trilha, do mais recente para o mais antigo. */
export async function carregarBaseHistorico() {
  const { data, error } = await supabase
    .from("tarefas_historico")
    .select(
      "id, tarefa_id, acao, detalhes, criado_em, usuario:usuarios ( id, nome_completo ), tarefa:tarefas ( id, titulo )"
    )
    .order("criado_em", { ascending: false })
    .limit(LIMITE_HISTORICO);
  if (error) throw error;

  const registros = (data ?? []).map((r) => ({
    id: r.id,
    usuario: r.usuario?.nome_completo ?? "Usuário não identificado",
    acao: rotuloAcao(r.acao),
    acao_chave: r.acao ?? "",
    descricao: textoHistorico(r),
    tarefa: r.tarefa?.titulo ?? "Tarefa removida",
    criado_em: r.criado_em ?? null,
    quando: formatarDataHora(r.criado_em),
  }));

  return {
    registros,
    limite: LIMITE_HISTORICO,
    truncado: registros.length >= LIMITE_HISTORICO,
  };
}
