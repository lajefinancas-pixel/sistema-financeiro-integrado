// Regras da Fase 2 dos Pagamentos Diários: revisão, aprovação e execução.
//
// Tudo aqui é conta pura, sem banco e sem tela, para poder ser testado direto.
// A divisão de responsabilidade que o módulo assume:
//
//   PROGRAMAR NÃO É PAGAR    -> Fase 1, já entregue.
//   APROVAR NÃO É PAGAR      -> aprovar só troca o status e registra a
//                               conferência. Nenhum saldo se move.
//   ATRIBUIR CONTA NÃO DEBITA CONTA -> definir a conta de um pagamento é só um
//                               vínculo; o débito acontece na baixa (Fase 3).
//
// A única operação desta fase que movimenta saldo é a transferência entre contas
// confirmada -- e ela vive em regrasTransferencia.js.

export const STATUS_ELABORACAO = "em_elaboracao";
export const STATUS_EM_ANALISE = "em_analise";
export const STATUS_APROVADA = "aprovada";

/** Rótulo do status como aparece na tela. */
export function statusLabelExecucao(status, fechado = false) {
  if (fechado) return "HISTÓRICO";
  if (status === STATUS_APROVADA) return "APROVADA / AGUARDANDO EXECUÇÃO";
  if (status === STATUS_EM_ANALISE) return "EM ANÁLISE";
  return "EM ELABORAÇÃO";
}

/** A programação já foi aprovada e está na etapa de execução? */
export function emExecucao(programacao) {
  return programacao?.status === STATUS_APROVADA && programacao?.fechado !== true;
}

/**
 * A proposta ainda pode ser revista?
 *
 * Sim em elaboração e em análise -- é exatamente a revisão depois da reunião com
 * o gestor: acrescentar fornecedor, retirar fornecedor, alterar valor,
 * acrescentar conta e retirar conta, tudo na MESMA programação. Depois de
 * aprovada, a proposta fica travada e o que muda é a execução.
 */
export function podeRevisarProposta(programacao) {
  if (!programacao) return false;
  if (programacao.fechado === true) return false;
  return programacao.status !== STATUS_APROVADA;
}

/** Voltou da análise: a tela mostra o painel de revisão em vez de "em elaboração". */
export function emRevisaoPosAnalise(programacao) {
  return programacao?.status === STATUS_EM_ANALISE && programacao?.fechado !== true;
}

function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

/**
 * Resumo mostrado antes de confirmar a aprovação.
 *
 * É o que o gestor confere na tela: contas selecionadas, saldo disponível,
 * quantidade de fornecedores, total aprovado e restante.
 */
export function resumoAprovacao({ contasSelecionadas = [], pagamentos = [] } = {}) {
  const saldoDisponivel = arredondar(
    contasSelecionadas.reduce((soma, conta) => soma + Number(conta.saldo ?? conta.saldoDisponivel ?? 0), 0)
  );
  const totalAprovado = arredondar(
    pagamentos.reduce((soma, pagamento) => soma + Number(pagamento.valor_a_pagar ?? 0), 0)
  );
  return {
    quantidadeContas: contasSelecionadas.length,
    contas: contasSelecionadas,
    saldoDisponivel,
    quantidadeFornecedores: pagamentos.length,
    totalAprovado,
    restante: arredondar(saldoDisponivel - totalAprovado),
    acimaDoSaldo: totalAprovado > saldoDisponivel,
  };
}

/** Impedimentos para aprovar. Lista vazia significa que pode aprovar. */
export function impedimentosParaAprovar({ programacao, contasSelecionadas = [], pagamentos = [] } = {}) {
  const impedimentos = [];
  if (!programacao) impedimentos.push("Abra uma programação para aprovar.");
  if (programacao?.fechado === true) impedimentos.push("Programações históricas fechadas não podem ser aprovadas.");
  if (programacao?.status === STATUS_APROVADA) impedimentos.push("Esta programação já está aprovada.");
  if (contasSelecionadas.length === 0) impedimentos.push("Selecione ao menos uma conta de trabalho.");
  if (pagamentos.length === 0) impedimentos.push("Inclua ao menos um fornecedor na programação.");
  return impedimentos;
}

/**
 * Contas que podem ser atribuídas a um pagamento.
 *
 * Só as contas da secretaria da programação E que estão entre as contas de
 * trabalho selecionadas. Não existe conta única obrigatória para a programação
 * inteira: a conta é definida por pagamento.
 */
export function contasAtribuiveis({ contas = [], contasSelecionadas, secretariaId } = {}) {
  const selecionadas =
    contasSelecionadas instanceof Set ? contasSelecionadas : new Set(contasSelecionadas ?? []);
  return contas.filter((conta) => {
    if (!selecionadas.has(conta.id)) return false;
    if (secretariaId == null) return true;
    return String(conta.secretaria_id ?? secretariaId) === String(secretariaId);
  });
}

/** Aplica uma conta aos pagamentos escolhidos, preservando os demais. */
export function aplicarContaEmPagamentos(pagamentos, idsSelecionados, contaId) {
  const alvo = new Set((idsSelecionados ?? []).map((id) => String(id)));
  return (pagamentos ?? []).map((pagamento) =>
    alvo.has(String(pagamento.id)) ? { ...pagamento, conta_origem_id: contaId } : pagamento
  );
}

/** Aplica uma conta a todos os pagamentos. Depois disso ainda dá para trocar um a um. */
export function aplicarContaEmTodos(pagamentos, contaId) {
  return (pagamentos ?? []).map((pagamento) => ({ ...pagamento, conta_origem_id: contaId }));
}

/** Quantos pagamentos já têm conta definida, quantos faltam e quanto cai em cada conta. */
export function resumoExecucao(pagamentos = [], contas = []) {
  const porConta = new Map();
  let comConta = 0;
  let semConta = 0;
  let total = 0;

  for (const pagamento of pagamentos) {
    const valor = Number(pagamento.valor_a_pagar ?? 0);
    total = arredondar(total + valor);
    const contaId = pagamento.conta_origem_id;
    if (contaId == null) {
      semConta += 1;
      continue;
    }
    comConta += 1;
    const atual = porConta.get(contaId) ?? { contaId, quantidade: 0, total: 0 };
    atual.quantidade += 1;
    atual.total = arredondar(atual.total + valor);
    porConta.set(contaId, atual);
  }

  const distribuicao = [...porConta.values()].map((item) => {
    const conta = contas.find((c) => String(c.id) === String(item.contaId));
    const saldo = Number(conta?.saldo ?? conta?.saldoDisponivel ?? 0);
    return {
      ...item,
      conta: conta ?? null,
      nome: conta?.nome_conta ?? `Conta ${item.contaId}`,
      saldo: arredondar(saldo),
      // Só conferência: a conta não é debitada nesta fase.
      saldoAposPagamentos: arredondar(saldo - item.total),
      acimaDoSaldo: item.total > saldo,
    };
  });

  return {
    comConta,
    semConta,
    total,
    completo: pagamentos.length > 0 && semConta === 0,
    distribuicao: distribuicao.sort((a, b) => b.total - a.total),
    contasAcimaDoSaldo: distribuicao.filter((item) => item.acimaDoSaldo),
  };
}

/**
 * Contas que precisam de dinheiro para dar conta dos pagamentos que lhes foram
 * atribuídos -- é a partir daqui que a transferência entre contas faz sentido.
 */
export function contasQuePrecisamDeReforco(pagamentos = [], contas = []) {
  return resumoExecucao(pagamentos, contas)
    .contasAcimaDoSaldo.map((item) => ({
      contaId: item.contaId,
      nome: item.nome,
      saldo: item.saldo,
      necessario: item.total,
      falta: arredondar(item.total - item.saldo),
    }));
}
