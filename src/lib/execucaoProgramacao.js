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

// ---------------------------------------------------------------------------
// Reabrir a programação: desfazer a APROVAÇÃO, nunca os dados
// ---------------------------------------------------------------------------
//
// Aprovada trava a proposta -- e até aqui não havia caminho de volta. Reabrir é
// a ação de EXCEÇÃO que devolve a programação para "em elaboração" quando o
// gestor pede um ajuste depois de aprovar.
//
// REABRIR NÃO DESFAZ DADOS. Ela troca o status e limpa os campos da aprovação.
// Contas de trabalho, fornecedores, valores, conta de cada pagamento, saldos
// congelados, baixas, transferências e saldos reais das contas continuam
// exatamente como estão -- desfazer cada uma dessas coisas tem caminho próprio,
// com registro próprio.

/** Mínimo de caracteres da justificativa da reabertura. */
export const JUSTIFICATIVA_MINIMA_REABERTURA = 10;

/**
 * A programação pode ser reaberta?
 *
 * Só a aprovada. Fechada é histórico: continua sem poder ser alterada, e isso
 * não muda com permissão nenhuma.
 */
export function podeReabrirProgramacao(programacao) {
  if (!programacao) return false;
  if (programacao.fechado === true) return false;
  return programacao.status === STATUS_APROVADA;
}

/** A justificativa informada satisfaz o mínimo exigido? */
export function justificativaReaberturaValida(texto) {
  return String(texto ?? "").trim().length >= JUSTIFICATIVA_MINIMA_REABERTURA;
}

export const MOTIVO_REABERTURA_SEM_PERMISSAO =
  "Você não tem permissão para reabrir programações aprovadas.";
export const MOTIVO_REABERTURA_STATUS =
  "Somente uma programação aprovada pode ser reaberta.";
export const MOTIVO_REABERTURA_FECHADA =
  "Programações históricas fechadas não podem ser reabertas.";
export const MOTIVO_REABERTURA_ESTRUTURA =
  "A função de reabertura ainda não está disponível no banco desta tela.";
export const MOTIVO_REABERTURA_JUSTIFICATIVA =
  `Escreva a justificativa da reabertura, com pelo menos ${JUSTIFICATIVA_MINIMA_REABERTURA} caracteres.`;

/**
 * Impedimentos para reabrir. Lista vazia significa que pode reabrir.
 *
 * Nada aqui é decidido de novo: são as mesmas condições que o banco exige,
 * nomeadas para a tela poder dizer o motivo em vez de ficar em silêncio.
 */
export function impedimentosParaReabrir({
  programacao,
  podeReabrir = true,
  estruturaAusente = false,
  justificativa = null,
} = {}) {
  const impedimentos = [];
  if (!programacao) impedimentos.push("Abra uma programação para reabrir.");
  if (programacao?.fechado === true) impedimentos.push(MOTIVO_REABERTURA_FECHADA);
  else if (programacao && programacao.status !== STATUS_APROVADA) impedimentos.push(MOTIVO_REABERTURA_STATUS);
  if (podeReabrir === false) impedimentos.push(MOTIVO_REABERTURA_SEM_PERMISSAO);
  if (estruturaAusente) impedimentos.push(MOTIVO_REABERTURA_ESTRUTURA);
  if (justificativa !== null && !justificativaReaberturaValida(justificativa)) {
    impedimentos.push(MOTIVO_REABERTURA_JUSTIFICATIVA);
  }
  return impedimentos;
}

function plural(quantidade, singular, pluralizado) {
  return Number(quantidade) === 1 ? singular : pluralizado;
}

/**
 * Avisos mostrados antes de confirmar a reabertura.
 *
 * Baixa registrada e transferência vinculada NÃO são desfeitas por reabrir --
 * e quem confirma precisa saber disso antes, não depois. O aviso não bloqueia:
 * cada uma delas tem estorno próprio, e é lá que se desfaz.
 *
 * Contagem desconhecida (`null`) não é zero: quando não deu para conferir, o
 * aviso diz que não deu, em vez de afirmar que não existe nada.
 */
export function avisosDaReabertura({ baixas = 0, transferencias = 0 } = {}) {
  const avisos = [];
  const numeroBaixas = baixas == null ? null : Number(baixas);
  const numeroTransferencias = transferencias == null ? null : Number(transferencias);

  if (numeroBaixas == null || numeroTransferencias == null) {
    avisos.push(
      "Não foi possível conferir as baixas e as transferências desta programação. Reabrir não desfaz nenhuma delas — confira na aba de Baixas e no painel de execução antes de confirmar."
    );
  }
  if (numeroBaixas > 0) {
    avisos.push(
      `Esta programação tem ${numeroBaixas} ${plural(numeroBaixas, "baixa registrada", "baixas registradas")}. Reabrir NÃO desfaz baixa nenhuma: o pagamento continua registrado e o valor em aberto da nota fica como está. Para desfazer uma baixa, use o estorno na aba de Baixas.`
    );
  }
  if (numeroTransferencias > 0) {
    avisos.push(
      `Esta programação tem ${numeroTransferencias} ${plural(numeroTransferencias, "transferência vinculada", "transferências vinculadas")}. Reabrir NÃO desfaz transferência nenhuma: os saldos das contas continuam como estão. Para desfazer uma transferência, use o estorno no painel de execução.`
    );
  }
  return avisos;
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
 *
 * A comparação dos ids é feita por TEXTO, como no resto do sistema: o id da
 * conta chega como número do banco em um caminho e como texto de campo de tela
 * em outro, e `Set.has` não considera 7 igual a "7". Era isso que podia deixar
 * a lista de contas atribuíveis vazia com as contas de trabalho selecionadas na
 * tela -- e, com ela vazia, a atribuição inteira ficava sem oferta de conta.
 * Nenhuma regra muda aqui: as contas oferecidas são exatamente as mesmas.
 */
export function contasAtribuiveis({ contas = [], contasSelecionadas, secretariaId } = {}) {
  const selecionadas = new Set(
    [...(contasSelecionadas instanceof Set ? contasSelecionadas : contasSelecionadas ?? [])].map(String)
  );
  return contas.filter((conta) => {
    if (!selecionadas.has(String(conta.id))) return false;
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
    // Saldo DESCONHECIDO não é zero. Em programação de data anterior o saldo
    // exibido é o congelado do dia em que ela foi montada, e conta sem esse
    // registro aparece como "--": tratá-la como R$ 0,00 faria a tela acusar
    // "saldo insuficiente" a partir de um valor que ninguém gravou.
    const bruto = conta?.saldo ?? conta?.saldoDisponivel ?? null;
    const saldo = bruto == null || bruto === "" || !Number.isFinite(Number(bruto)) ? null : arredondar(Number(bruto));
    return {
      ...item,
      conta: conta ?? null,
      nome: conta?.nome_conta ?? `Conta ${item.contaId}`,
      saldo,
      saldoRegistrado: saldo != null,
      // Só conferência: a conta não é debitada nesta fase.
      saldoAposPagamentos: saldo == null ? null : arredondar(saldo - item.total),
      acimaDoSaldo: saldo != null && item.total > saldo,
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

/**
 * Por que a atribuição de conta está indisponível -- em palavras, na tela.
 *
 * Botão que não faz nada ao ser clicado é o pior estado possível: quem clica
 * não sabe se o sistema falhou, se falta permissão ou se falta um passo. Estas
 * funções devolvem a RAZÃO do impedimento, para o botão ficar desabilitado
 * dizendo o motivo em vez de ficar em silêncio.
 *
 * Elas não decidem nada de novo: só nomeiam as condições que a tela e o banco
 * já exigiam antes. Nenhuma permissão é ampliada e nenhuma trava é removida.
 */
export const MOTIVO_SEM_PERMISSAO_CONTA =
  "Você não tem permissão para definir a conta de pagamento.";
export const MOTIVO_SEM_PERMISSAO_EXECUCAO =
  "Você não tem permissão para executar a programação, e é ela que libera a definição da conta de cada pagamento.";
export const MOTIVO_ESTRUTURA_AUSENTE =
  "A estrutura da etapa de execução não está disponível no banco desta tela.";
export const MOTIVO_SEM_CONTAS =
  "Nenhuma conta de trabalho desta secretaria está disponível para atribuição. Reabra a programação e selecione as contas antes de executar.";
export const MOTIVO_SEM_FORNECEDORES = "Nenhum fornecedor nesta programação.";
export const MOTIVO_SEM_CONTA_ESCOLHIDA =
  'Escolha primeiro a conta em "Conta para atribuição", acima.';
export const MOTIVO_SEM_MARCADOS = "Marque ao menos um fornecedor na lista abaixo.";
export const MOTIVO_GRAVANDO = "Aguarde: a alteração anterior ainda está sendo gravada.";

/**
 * Razão pela qual definir a conta está bloqueado, independente do escopo.
 * Devolve "" quando não há impedimento nenhum.
 */
export function motivoContaIndisponivel({
  podeDefinirConta = true,
  podeExecutar = true,
  estruturaAusente = false,
  contasDisponiveis = 0,
  salvando = false,
} = {}) {
  if (estruturaAusente) return MOTIVO_ESTRUTURA_AUSENTE;
  if (podeDefinirConta === false) return MOTIVO_SEM_PERMISSAO_CONTA;
  if (podeExecutar === false) return MOTIVO_SEM_PERMISSAO_EXECUCAO;
  if (Number(contasDisponiveis) <= 0) return MOTIVO_SEM_CONTAS;
  if (salvando) return MOTIVO_GRAVANDO;
  return "";
}

/**
 * Razão pela qual a atribuição em lote está bloqueada.
 *
 * `escopo` é "selecionados" (os fornecedores marcados) ou "todos".
 */
export function motivoAtribuicaoEmLote({
  escopo = "selecionados",
  totalPagamentos = 0,
  quantidadeMarcada = 0,
  contaEscolhida = null,
  ...comum
} = {}) {
  const bloqueio = motivoContaIndisponivel(comum);
  if (bloqueio) return bloqueio;
  if (Number(totalPagamentos) <= 0) return MOTIVO_SEM_FORNECEDORES;
  if (contaEscolhida == null || contaEscolhida === "") return MOTIVO_SEM_CONTA_ESCOLHIDA;
  if (escopo === "selecionados" && Number(quantidadeMarcada) <= 0) return MOTIVO_SEM_MARCADOS;
  return "";
}
