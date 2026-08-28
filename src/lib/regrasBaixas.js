import { formatBRL, paraNumeroMoeda } from "./moeda.js";

/**
 * Regras da BAIXA DE PAGAMENTO, sem banco e sem tela.
 *
 * A baixa é a confirmação de que o pagamento saiu de fato no banco. Ela é
 * independente da Programação Diária -- uma nota pode ser baixada sem nunca ter
 * sido programada -- e NÃO DEBITA O SALDO DA CONTA: o único efeito financeiro
 * dela é abater o valor em aberto da nota do fornecedor. O saldo continua sendo
 * movimentado exclusivamente pelos fluxos que já existiam.
 *
 * Tudo aqui é função pura sobre os dados que a tela já carregou, para que a
 * mesma conta valha na tela, na impressão e no teste automatizado. A gravação
 * mora em lib/baixasPagamentos.js e as garantias (transação, idempotência,
 * permissão, auditoria) moram nas funções do banco.
 */

/** Centavo de tolerância: comparação de dinheiro nunca usa igualdade exata. */
export const TOLERANCIA = 0.005;

/** Situações que encerram a nota: ela não recebe mais baixa nenhuma. */
export const SITUACOES_ENCERRADAS = ["pago", "cancelado"];

/* -------------------------------------------------------------------------
 * O que já existia (a tela antiga e os relatórios continuam usando)
 * ---------------------------------------------------------------------- */

export function situacaoPagamento(valorTotal, totalBaixado) {
  const total = paraNumeroMoeda(valorTotal);
  const baixado = paraNumeroMoeda(totalBaixado);
  if (baixado <= 0) return "em_aberto";
  if (baixado + 0.005 < total) return "parcialmente_pago";
  return "pago";
}

export function resumoBaixas(valorTotal, baixas = []) {
  const total = paraNumeroMoeda(valorTotal);
  const totalBaixado = baixas
    .filter((baixa) => baixa.status === "efetivada")
    .reduce((soma, baixa) => soma + paraNumeroMoeda(baixa.valor_pago), 0);
  return {
    valorTotal: total,
    totalBaixado,
    saldoEmAberto: Math.max(0, total - totalBaixado),
    situacao: situacaoPagamento(total, totalBaixado),
  };
}

export function validarValorBaixa(valor, saldoEmAberto) {
  const numero = paraNumeroMoeda(valor);
  const aberto = paraNumeroMoeda(saldoEmAberto);
  if (numero <= 0) return { ok: false, mensagem: "O valor da baixa deve ser maior que zero." };
  if (numero > aberto + 0.005) return { ok: false, mensagem: `O valor informado supera o saldo em aberto disponível.` };
  return { ok: true };
}

/* -------------------------------------------------------------------------
 * A nota do fornecedor
 * ---------------------------------------------------------------------- */

/** Arredonda para centavo, evitando o resto binário de 0.1 + 0.2. */
export function centavos(valor) {
  return Math.round(paraNumeroMoeda(valor) * 100) / 100;
}

/** Valor original da nota (o líquido gravado no lançamento). */
export function valorDaNota(nota) {
  return centavos(nota?.valor);
}

/** Quanto da nota já foi baixado. */
export function valorBaixadoDaNota(nota) {
  return centavos(nota?.valor_pago);
}

/**
 * Valor em aberto da nota: o original menos o que já foi baixado. É a mesma
 * conta que as telas de Fornecedores e de Pagamentos Diários já fazem
 * (`valor - valor_pago`), então nada muda de lugar.
 */
export function valorEmAbertoDaNota(nota) {
  return Math.max(0, centavos(valorDaNota(nota) - valorBaixadoDaNota(nota)));
}

/** A nota chegou a zero em aberto? Aí ela está quitada e sai da lista. */
export function notaQuitada(nota) {
  if (SITUACOES_ENCERRADAS.includes(String(nota?.situacao ?? ""))) return true;
  return valorEmAbertoDaNota(nota) <= TOLERANCIA;
}

/** A nota pode receber baixa? (só as que ainda têm valor em aberto) */
export function notaPodeReceberBaixa(nota) {
  if (String(nota?.situacao ?? "") === "cancelado") return false;
  return valorEmAbertoDaNota(nota) > TOLERANCIA;
}

/** Números de identificação da nota, na ordem em que a listagem os mostra. */
export function numeroDaNota(nota) {
  const nf = String(nota?.numero_nota_fiscal ?? "").trim();
  if (nf !== "") return nf;
  const empenho = String(nota?.numero_empenho ?? "").trim();
  if (empenho !== "") return `Empenho ${empenho}`;
  const processo = String(nota?.numero_processo ?? "").trim();
  if (processo !== "") return `Processo ${processo}`;
  return "Sem número";
}

/** Descrição curta da nota para a lista compacta e para os documentos. */
export function descricaoDaNota(nota) {
  const partes = [];
  const processo = String(nota?.numero_processo ?? "").trim();
  const empenho = String(nota?.numero_empenho ?? "").trim();
  const parcela = String(nota?.parcela ?? "").trim();
  if (processo !== "") partes.push(`Processo ${processo}`);
  if (empenho !== "") partes.push(`Empenho ${empenho}`);
  if (parcela !== "") partes.push(`Parcela ${parcela}`);
  return partes.join(" · ");
}

/**
 * Situação que a nota assume depois de uma baixa de `valor`.
 *
 * O sistema usa duas situações e só duas: 'em_aberto' e 'pago'. Baixa PARCIAL
 * mantém a nota 'em_aberto' -- o abatimento fica em `valor_pago` e o que resta
 * em aberto continua sendo `valor - valor_pago`. Só a quitação grava 'pago'.
 * É a mesma regra de `public.registrar_baixa_nota`.
 */
export function situacaoAposBaixa(nota, valor) {
  const aberto = centavos(valorEmAbertoDaNota(nota) - centavos(valor));
  return aberto <= TOLERANCIA ? "pago" : "em_aberto";
}

/**
 * `{ valorTotal, valorBaixado, valorEmAberto, situacao, quitada }` de uma nota.
 * É o que a linha da listagem e o cabeçalho do registro de baixa mostram.
 */
export function resumoDaNota(nota) {
  const valorTotal = valorDaNota(nota);
  const valorBaixado = valorBaixadoDaNota(nota);
  const valorEmAberto = valorEmAbertoDaNota(nota);
  return {
    valorTotal,
    valorBaixado,
    valorEmAberto,
    situacao: String(nota?.situacao ?? "em_aberto"),
    quitada: notaQuitada(nota),
  };
}

/** Soma das notas de uma listagem, para o resumo do topo e dos documentos. */
export function totaisDasNotas(notas = []) {
  return notas.reduce(
    (acumulado, nota) => ({
      notas: acumulado.notas + 1,
      valorTotal: centavos(acumulado.valorTotal + valorDaNota(nota)),
      valorBaixado: centavos(acumulado.valorBaixado + valorBaixadoDaNota(nota)),
      valorEmAberto: centavos(acumulado.valorEmAberto + valorEmAbertoDaNota(nota)),
    }),
    { notas: 0, valorTotal: 0, valorBaixado: 0, valorEmAberto: 0 },
  );
}

/* -------------------------------------------------------------------------
 * Validação do registro da baixa
 * ---------------------------------------------------------------------- */

/**
 * Confere o formulário de baixa ANTES de chamar o banco, com a mensagem que a
 * pessoa vai ler. As mesmas recusas existem dentro da função do banco -- aqui
 * elas só chegam mais rápido e sem termo técnico nenhum.
 *
 * @returns `{ ok: true }` ou `{ ok: false, campo, mensagem }`
 */
export function validarBaixaDeNota({ nota, valor, dataPagamento, contaId } = {}) {
  if (!nota) {
    return { ok: false, campo: "nota", mensagem: "Escolha a nota que está sendo paga." };
  }
  if (String(nota.situacao ?? "") === "cancelado") {
    return { ok: false, campo: "nota", mensagem: "Esta nota está cancelada e não recebe baixas." };
  }

  const emAberto = valorEmAbertoDaNota(nota);
  if (emAberto <= TOLERANCIA) {
    return { ok: false, campo: "nota", mensagem: "Esta nota já está quitada e não recebe novas baixas." };
  }

  const numero = centavos(valor);
  if (!Number.isFinite(numero) || numero <= 0) {
    return { ok: false, campo: "valor", mensagem: "Informe um valor pago maior que zero." };
  }
  if (numero > emAberto + TOLERANCIA) {
    return {
      ok: false,
      campo: "valor",
      // Dizer o limite é o que torna a recusa útil -- é a mesma frase que
      // public.registrar_baixa_nota devolve quando a recusa vem do banco.
      mensagem: `O valor pago (${formatBRL(numero)}) é maior do que o valor em aberto da nota (${formatBRL(emAberto)}). Informe um valor até o que está em aberto.`,
    };
  }

  if (!String(dataPagamento ?? "").trim()) {
    return { ok: false, campo: "dataPagamento", mensagem: "Informe a data do pagamento." };
  }
  if (!String(contaId ?? "").trim()) {
    return { ok: false, campo: "contaId", mensagem: "Escolha a conta bancária utilizada no pagamento." };
  }

  return { ok: true };
}

/** Justificativa do estorno: obrigatória e com conteúdo. */
export function validarEstorno(motivo) {
  const texto = String(motivo ?? "").trim();
  if (texto === "") {
    return { ok: false, mensagem: "Informe a justificativa do estorno." };
  }
  if (texto.length < 5) {
    return { ok: false, mensagem: "Explique o motivo do estorno com um pouco mais de detalhe." };
  }
  return { ok: true, motivo: texto };
}

/* -------------------------------------------------------------------------
 * O efeito da baixa e do estorno, em memória
 * ---------------------------------------------------------------------- */

/**
 * Aplica uma baixa a uma nota e devolve a nota nova e o registro da baixa.
 *
 * Este é o espelho em JavaScript do que `public.registrar_baixa_nota` faz no
 * banco, e é ele que o teste automatizado percorre de ponta a ponta. Repare no
 * que a função NÃO devolve: nada de saldo, conta debitada ou movimentação -- a
 * baixa registra o pagamento e abate o valor em aberto, e é só isso.
 *
 * A função é idempotente pela chave: chamar duas vezes com a mesma
 * `chaveIdempotencia` devolve a nota intocada na segunda vez.
 */
export function aplicarBaixa(nota, baixa = {}, baixasExistentes = []) {
  const chave = String(baixa.chaveIdempotencia ?? "").trim();
  if (chave !== "" && baixasExistentes.some((item) => item.chave_idempotencia === chave)) {
    return { nota, baixa: null, jaRegistrada: true };
  }

  const validacao = validarBaixaDeNota({
    nota,
    valor: baixa.valor,
    dataPagamento: baixa.dataPagamento ?? "hoje",
    contaId: baixa.contaId ?? "conta",
  });
  if (!validacao.ok) {
    return { nota, baixa: null, jaRegistrada: false, erro: validacao.mensagem };
  }

  const valor = centavos(baixa.valor);
  const valorPago = centavos(valorBaixadoDaNota(nota) + valor);
  const situacao = situacaoAposBaixa(nota, valor);

  return {
    jaRegistrada: false,
    nota: { ...nota, valor_pago: valorPago, situacao },
    baixa: {
      chave_idempotencia: chave || null,
      valor_em_aberto_id: nota.id,
      fornecedor_id: nota.fornecedor_id,
      valor_total_referencia: valorDaNota(nota),
      valor_pago: valor,
      data_pagamento: baixa.dataPagamento ?? null,
      conta_id: baixa.contaId ?? null,
      observacao: String(baixa.observacao ?? "").trim() || null,
      status: "efetivada",
      situacao_anterior: String(nota.situacao ?? "em_aberto"),
    },
  };
}

/**
 * Estorna uma baixa: devolve o valor para "em aberto" e PRESERVA o registro.
 * A baixa nunca é apagada -- ela muda de situação e guarda o motivo.
 */
export function aplicarEstorno(nota, baixaAlvo, motivo) {
  if (!baixaAlvo || baixaAlvo.status === "estornada") {
    return { nota, baixa: baixaAlvo, jaEstornada: true };
  }

  const validacao = validarEstorno(motivo);
  if (!validacao.ok) {
    return { nota, baixa: baixaAlvo, jaEstornada: false, erro: validacao.mensagem };
  }

  const valorPago = Math.max(0, centavos(valorBaixadoDaNota(nota) - centavos(baixaAlvo.valor_pago)));
  // A mesma regra do registro, pelo avesso: sobrando saldo em aberto a nota
  // volta para 'em_aberto', tenha o estorno zerado o valor baixado ou apenas
  // devolvido parte dele. Só continua 'pago' se nada sobrar em aberto.
  const abertoDepois = centavos(valorDaNota(nota) - valorPago);
  const situacao = abertoDepois <= TOLERANCIA ? "pago" : "em_aberto";

  return {
    jaEstornada: false,
    nota: { ...nota, valor_pago: valorPago, situacao },
    baixa: { ...baixaAlvo, status: "estornada", motivo_estorno: validacao.motivo },
  };
}

/* -------------------------------------------------------------------------
 * Permissões do módulo de Baixas
 * ---------------------------------------------------------------------- */

/**
 * As cinco permissões próprias do módulo, sobre as cinco colunas booleanas que
 * a Matriz de Permissões já tem -- o mesmo recurso de rótulos próprios que o
 * módulo de Backup usa. O mapa é o MESMO de src/lib/permissoesUsuario.js e de
 * `public.pode_em_baixas`.
 */
export const ACOES_BAIXAS = [
  { id: "visualizar", campo: "pode_visualizar", label: "Visualizar baixas", legada: "visualizar_baixas" },
  { id: "registrar", campo: "pode_cadastrar", label: "Registrar baixa", legada: "registrar_baixa" },
  { id: "imprimir", campo: "pode_editar", label: "Imprimir", legada: "visualizar_baixas" },
  { id: "exportar", campo: "pode_aprovar", label: "Exportar", legada: "visualizar_baixas" },
  { id: "estornar", campo: "pode_excluir", label: "Estornar baixa", legada: "estornar_baixa" },
];

export const PERMISSOES_BAIXAS_NENHUMA = Object.freeze({
  visualizar: false,
  registrar: false,
  imprimir: false,
  exportar: false,
  estornar: false,
});

// Sem linha do módulo 'baixas', imprimir e exportar seguem a visualização de
// 'pagamentos' -- é o mesmo padrão que a migration semeia nos perfis.
const CAMPO_DE_FALLBACK = {
  pode_visualizar: "pode_visualizar",
  pode_cadastrar: "pode_cadastrar",
  pode_editar: "pode_visualizar",
  pode_aprovar: "pode_visualizar",
  pode_excluir: "pode_excluir",
};

/**
 * Resolve as cinco permissões a partir do que já foi lido do banco.
 *
 * Ordem de decisão, a mesma de `public.pode_em_baixas`:
 *   1. o módulo 'baixas' do usuário;
 *   2. na falta dele, o módulo 'pagamentos', para ninguém ficar sem acesso;
 *   3. a concessão avulsa da aba de permissões especiais SOMA e nunca subtrai
 *      (aquela aba grava todas as ações, marcadas ou não, então um "não" dela
 *      não pode derrubar o que a Matriz de Permissões concedeu).
 */
export function resolverPermissoesBaixas({ baixas, pagamentos, especiais } = {}) {
  const resultado = {};
  ACOES_BAIXAS.forEach(({ id, campo, legada }) => {
    let valor = null;
    if (baixas) valor = baixas[campo] === true;
    else if (pagamentos) valor = pagamentos[CAMPO_DE_FALLBACK[campo]] === true;

    if (valor !== true && legada && especiais?.[legada] === true) valor = true;

    resultado[id] = valor === true;
  });
  return resultado;
}

/* -------------------------------------------------------------------------
 * Escolha do fornecedor e recorte da listagem
 * ---------------------------------------------------------------------- */

function semAcento(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function somenteDigitos(texto) {
  return String(texto ?? "").replace(/\D+/g, "");
}

/** Nome do fornecedor como a tela o mostra. */
export function nomeDoFornecedor(fornecedor) {
  return (
    String(fornecedor?.razao_social ?? "").trim() ||
    String(fornecedor?.nome_fantasia ?? "").trim() ||
    String(fornecedor?.nome ?? "").trim() ||
    "Fornecedor sem nome"
  );
}

/**
 * Busca do fornecedor por nome, razão social, nome fantasia e CNPJ/CPF.
 * Acento e pontuação não importam: "jose", "José" e "12.345" encontram o mesmo
 * cadastro que "JOSÉ" e "12345".
 */
export function fornecedorCombina(fornecedor, termo) {
  const busca = String(termo ?? "").trim();
  if (busca === "") return true;

  const digitos = somenteDigitos(busca);
  if (digitos.length >= 3 && somenteDigitos(fornecedor?.cpf_cnpj).includes(digitos)) return true;

  const alvo = semAcento(busca);
  return [fornecedor?.nome, fornecedor?.razao_social, fornecedor?.nome_fantasia]
    .map(semAcento)
    .some((campo) => campo !== "" && campo.includes(alvo));
}

export function filtrarFornecedores(fornecedores = [], termo = "") {
  return fornecedores.filter((fornecedor) => fornecedorCombina(fornecedor, termo));
}

/** Notas em aberto primeiro pelo vencimento mais antigo, depois pelo número. */
export function ordenarNotasEmAberto(notas = []) {
  return [...notas].sort((a, b) => {
    const venceA = String(a?.data_vencimento ?? "9999-12-31");
    const venceB = String(b?.data_vencimento ?? "9999-12-31");
    if (venceA !== venceB) return venceA.localeCompare(venceB);
    return numeroDaNota(a).localeCompare(numeroDaNota(b), "pt-BR");
  });
}

/** Só as notas que ainda têm valor em aberto, na ordem da listagem. */
export function notasEmAberto(notas = []) {
  return ordenarNotasEmAberto(notas.filter(notaPodeReceberBaixa));
}

/** Filtro vazio da tela (o que o botão "Limpar filtros" restaura). */
export const FILTRO_BAIXAS_VAZIO = {
  busca: "",
  fornecedorId: "",
  contaId: "",
  inicio: "",
  fim: "",
  situacao: "",
  somenteVencidas: false,
};

export function filtroBaixasAtivo(filtros = FILTRO_BAIXAS_VAZIO) {
  return (
    String(filtros.busca ?? "").trim() !== "" ||
    String(filtros.contaId ?? "") !== "" ||
    String(filtros.inicio ?? "") !== "" ||
    String(filtros.fim ?? "") !== "" ||
    String(filtros.situacao ?? "") !== "" ||
    filtros.somenteVencidas === true
  );
}

/**
 * Aplica os filtros da tela às notas em aberto do fornecedor escolhido.
 * `hoje` entra por parâmetro para o teste não depender do relógio.
 */
export function filtrarNotasDaTela(notas = [], filtros = FILTRO_BAIXAS_VAZIO, hoje = "") {
  const busca = String(filtros.busca ?? "").trim();
  const alvo = semAcento(busca);
  const inicio = String(filtros.inicio ?? "");
  const fim = String(filtros.fim ?? "");
  const situacao = String(filtros.situacao ?? "");

  return notas.filter((nota) => {
    if (situacao !== "" && String(nota.situacao ?? "") !== situacao) return false;

    const vencimento = String(nota.data_vencimento ?? "");
    if (inicio !== "" && (vencimento === "" || vencimento < inicio)) return false;
    if (fim !== "" && (vencimento === "" || vencimento > fim)) return false;

    if (filtros.somenteVencidas === true) {
      if (vencimento === "" || (hoje !== "" && vencimento >= hoje)) return false;
    }

    if (alvo !== "") {
      const texto = semAcento(`${numeroDaNota(nota)} ${descricaoDaNota(nota)}`);
      if (!texto.includes(alvo)) return false;
    }

    return true;
  });
}

/** Baixas efetivadas de uma nota, da mais recente para a mais antiga. */
export function baixasDaNota(nota, baixas = []) {
  const id = String(nota?.id ?? "");
  if (id === "") return [];
  return baixas
    .filter((baixa) => String(baixa.valor_em_aberto_id ?? "") === id)
    .sort((a, b) => String(b.data_pagamento ?? "").localeCompare(String(a.data_pagamento ?? "")));
}
