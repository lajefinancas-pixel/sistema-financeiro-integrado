// Saldo CONGELADO da programação diária de pagamentos.
//
// A programação é um DOCUMENTO: os valores que ela mostra são os que estavam na
// mesa no dia em que a decisão foi tomada. Quem abre a programação de 02/09
// precisa ver o saldo que as contas tinham em 02/09 -- não o saldo de hoje, e
// não um saldo recalculado a partir do histórico.
//
// O congelamento não é feito aqui: ele já existe no banco.
//
//   programacao_contas.saldo_considerado        -> o saldo de CADA conta no
//                                                  momento em que a programação
//                                                  foi montada/salva.
//   programacoes_pagamento.saldo_considerado    -> o total considerado, gravado
//                                                  no cabeçalho da programação.
//
// Este módulo é só leitura e apresentação, sem banco e sem React:
//
//   1. decide QUANDO a tela mostra o saldo congelado e quando ela continua
//      mostrando o saldo atual (programação sendo montada agora);
//   2. lê o saldo gravado de cada conta, sem recalcular e sem inventar valor;
//   3. quando não existe registro do saldo congelado (programação antiga,
//      anterior à coluna), devolve AUSÊNCIA -- `null`, que a tela e o papel
//      mostram como "--". Nunca o saldo atual disfarçado de saldo da época.
//
// Nada aqui altera saldo, lançamento de saldos_historico ou dado já gravado.

/** O que a tela e o papel mostram quando não existe saldo congelado gravado. */
export const TEXTO_SEM_REGISTRO = "--";

/** Data de hoje em "AAAA-MM-DD", no fuso de quem está usando o sistema. */
export function dataDeHoje(agora = new Date()) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

/** A data da programação em "AAAA-MM-DD" (aceita data ou data e hora). */
export function dataDaProgramacao(programacao) {
  const valor = programacao?.data_programacao;
  if (valor == null) return "";
  return String(valor).slice(0, 10);
}

/**
 * Valor de saldo REGISTRADO, ou `null` quando não há registro.
 *
 * Texto vazio, nulo e valor não numérico são ausência de registro -- e ausência
 * de registro não vira zero, porque zero é um valor e seria uma afirmação sobre
 * o dia da decisão que ninguém gravou.
 */
export function saldoRegistrado(valor) {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100) / 100;
}

/**
 * A programação ainda está sendo montada agora?
 *
 * Sim quando ela é do dia corrente (ou de data futura, que também está sendo
 * montada agora), não está aprovada e não está fechada. Nesse caso a tela
 * continua funcionando como sempre: busca o saldo atual das contas, e marcar ou
 * desmarcar conta recalcula o Saldo da Programação na hora.
 */
export function programacaoEmMontagem({ programacao, hoje = dataDeHoje() } = {}) {
  if (!programacao) return true;
  if (programacao.fechado === true) return false;
  if (programacao.status === "aprovada") return false;
  const data = dataDaProgramacao(programacao);
  if (data === "") return true;
  return data >= hoje;
}

/**
 * A programação deve mostrar o saldo CONGELADO?
 *
 * Sim para programação de data anterior, já aprovada ou fechada. É o oposto de
 * "ainda está sendo montada".
 */
export function usaSaldoCongelado({ programacao, hoje = dataDeHoje() } = {}) {
  return !programacaoEmMontagem({ programacao, hoje });
}

/**
 * Saldo congelado por conta, a partir das linhas de `programacao_contas`.
 *
 * @param linhas [{ conta_id, saldo_considerado }]
 * @returns Map<string, number|null> -- `null` é conta sem registro
 */
export function mapaSaldosCongelados(linhas) {
  const mapa = new Map();
  for (const linha of linhas ?? []) {
    mapa.set(String(linha?.conta_id), saldoRegistrado(linha?.saldo_considerado));
  }
  return mapa;
}

/**
 * A programação inteira está SEM registro de saldo congelado?
 *
 * A coluna `saldo_considerado` foi criada com `not null default 0`, então a
 * programação montada antes dela ficou com zero em todas as contas e zero no
 * cabeçalho -- zero que ninguém digitou e que não descreve dia nenhum. Quando é
 * esse o caso, a tela mostra "--" e avisa, em vez de exibir R$ 0,00 como se
 * fosse o saldo da época.
 *
 * Já em programação COM registro (qualquer conta ou o cabeçalho com valor), uma
 * conta em 0,00 é zero de verdade e continua sendo mostrada como R$ 0,00.
 */
export function semRegistroDeSaldoCongelado({ linhas, saldoCabecalho } = {}) {
  const contas = linhas ?? [];
  if (contas.length === 0) return false;
  const algumaConta = contas.some((linha) => (saldoRegistrado(linha?.saldo_considerado) ?? 0) > 0);
  if (algumaConta) return false;
  return (saldoRegistrado(saldoCabecalho) ?? 0) <= 0;
}

/**
 * As contas com o saldo da programação no lugar do saldo atual.
 *
 * O campo `saldo` -- o que as telas já mostram -- passa a carregar o valor
 * congelado, ou `null` quando não existe registro. O saldo atual continua
 * disponível em `saldoAtual` para quem precisa dele (é o que a etapa de
 * execução usa, porque lá a conferência é com o dinheiro de hoje).
 *
 * Nenhuma conta é criada, removida ou reordenada aqui.
 */
export function aplicarSaldosCongelados(contas, { saldos, semRegistro = false } = {}) {
  const mapa = saldos instanceof Map ? saldos : new Map(Object.entries(saldos ?? {}));
  return (contas ?? []).map((conta) => {
    const chave = String(conta?.id);
    // `saldoGravado` é o valor que está no banco, exatamente como está -- é o
    // que a tela regrava ao salvar, para que salvar de novo não troque o
    // documento pelos números de hoje.
    const gravado = mapa.has(chave) ? mapa.get(chave) : null;
    const congelado = semRegistro ? null : gravado;
    return {
      ...conta,
      saldo: congelado,
      // `saldoDisponivel` acompanha o congelado para que nenhuma leitura que
      // usa "saldo, ou o disponível" caia de volta no saldo de hoje quando a
      // conta não tem valor gravado (é o caso do resumo da aprovação).
      saldoDisponivel: congelado,
      saldoAtual: conta?.saldo ?? null,
      saldoDisponivelAtual: conta?.saldoDisponivel ?? null,
      saldoCongelado: congelado,
      saldoGravado: gravado,
      saldoCongeladoRegistrado: congelado != null,
    };
  });
}

/**
 * Soma dos saldos congelados EXIBIDOS.
 *
 * Conta sem registro não entra na soma (ela aparece como "--"), então o total
 * mostrado é sempre exatamente a soma do que está na tela. Nada é estimado para
 * cobrir a conta sem registro.
 */
export function somarSaldosCongelados(contas) {
  const total = (contas ?? []).reduce((soma, conta) => soma + (saldoRegistrado(conta?.saldo) ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** Quantas das contas exibidas não têm saldo congelado gravado. */
export function contasSemSaldoCongelado(contas) {
  return (contas ?? []).filter((conta) => saldoRegistrado(conta?.saldo) == null).length;
}

/**
 * Aviso mostrado quando a programação está exibindo saldo congelado.
 *
 * Dois textos, e nenhum deles inventa valor: o normal explica que os valores
 * são os do dia da decisão; o de programação sem registro diz que o saldo da
 * época não foi gravado e por isso aparece "--".
 */
export function avisoSaldoCongelado({ dataFormatada, semRegistro = false, quantidadeSemRegistro = 0 } = {}) {
  const dia = dataFormatada ? ` de ${dataFormatada}` : "";
  if (semRegistro) {
    return `Esta programação${dia} não tem o saldo das contas gravado da época em que foi montada. Os saldos aparecem como "${TEXTO_SEM_REGISTRO}" e não entram no Saldo da Programação: o saldo atual das contas não é mostrado aqui, porque não era esse o valor considerado naquele dia.`;
  }
  const faltando = quantidadeSemRegistro > 0
    ? ` ${quantidadeSemRegistro} ${quantidadeSemRegistro === 1 ? "conta não tem" : "contas não têm"} o saldo daquele dia gravado e aparece${quantidadeSemRegistro === 1 ? "" : "m"} como "${TEXTO_SEM_REGISTRO}", sem entrar na soma.`
    : "";
  return `Programação${dia} já registrada: os saldos mostrados são os que foram considerados quando ela foi montada, não os saldos de hoje.${faltando}`;
}

/**
 * O saldo que vai para o banco quando esta programação é salva.
 *
 * Programação sendo montada agora grava o saldo atual, como sempre. Programação
 * que já tem saldo congelado gravado REGRAVA o mesmo valor -- salvar não
 * atualiza o documento para os números de hoje. Conta acrescentada depois, que
 * ainda não tem registro, grava o saldo considerado no momento em que entrou.
 */
export function saldoParaGravar({ conta, modoCongelado = false } = {}) {
  if (!modoCongelado) return saldoRegistrado(conta?.saldo) ?? 0;
  const gravado = saldoRegistrado(conta?.saldoGravado);
  if (gravado != null) return gravado;
  return saldoRegistrado(conta?.saldoAtual) ?? saldoRegistrado(conta?.saldo) ?? 0;
}
