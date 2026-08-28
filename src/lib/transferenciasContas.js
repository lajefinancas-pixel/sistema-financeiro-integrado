// Transporte da transferência entre contas próprias.
//
// A confirmação e o estorno vão para /api/account-transfers, que chama as
// funções do banco. Duas coisas ficam do lado do banco de propósito, porque só
// lá elas são garantidas:
//
//   ATOMICIDADE  -> saída e entrada acontecem na MESMA transação. Se uma perna
//                   falha, nenhuma vale. Nunca há saída sem entrada nem entrada
//                   sem saída.
//   IDEMPOTÊNCIA -> a chave viaja no corpo da requisição e tem índice único no
//                   banco. Duplo clique, F5, reenvio, lentidão e dupla
//                   confirmação chegam com a MESMA chave e a segunda tentativa
//                   não move nada -- devolve o resultado da primeira.
//
// Por isso a chave é criada UMA vez, quando o usuário monta a transferência, e
// não a cada clique no botão.

import { supabase } from "./supabaseClient";
import { detalheDoBanco } from "./estruturaPagamentosFase1";
export { calcularConferenciaTransferencias, conferirTransferenciaMultipla, pernasParaEnvio } from "./regrasTransferencia";

/**
 * Recusa do banco na transferência, com os campos que explicam a falha.
 *
 * Continua sendo um Error (quem só lê `.message` não muda), mas carrega code,
 * details e hint como um erro do Supabase. É o que faz `mensagemAmigavel`
 * reconhecer a falha: com `code` presente ela mostra a frase escrita para o
 * usuário quando o código é P0001 ou 42501, e a mensagem da tela quando o texto
 * é técnico -- em vez de tratar toda recusa como desconhecida.
 */
export class ErroDaTransferencia extends Error {
  constructor({ message, code, details, hint, status }) {
    super(message || "Não foi possível confirmar as transferências.");
    this.name = "ErroDaTransferencia";
    this.code = code ?? null;
    this.details = details ?? null;
    this.hint = hint ?? null;
    this.status = status ?? null;
  }
}

/**
 * Corpo da resposta, mesmo quando ele não é JSON.
 *
 * Ler a resposta só como JSON, caindo para objeto vazio quando o parse falha,
 * era um apagão a mais: as recusas da
 * portaria da função Netlify saíam como TEXTO puro ("Usuário não encontrado.",
 * "Sessão inválida.", "Configuração de autenticação indisponível."), o parse
 * falhava, o corpo virava {} e a falha subia sem mensagem, sem código e sem
 * detalhe -- indistinguível de uma recusa do banco. Agora a portaria responde
 * JSON, e o texto continua sendo lido como último recurso: qualquer camada no
 * caminho (proxy, 404 de função, gateway) que devolva texto ainda chega à tela
 * com o status como código.
 */
async function corpoDaResposta(response) {
  const bruto = await response.text().catch(() => "");
  if (!bruto.trim()) return {};
  try {
    const analisado = JSON.parse(bruto);
    return analisado && typeof analisado === "object" ? analisado : { error: String(analisado) };
  } catch {
    return { error: bruto.trim().slice(0, 500) };
  }
}

export async function confirmarTransferencias(payload) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/account-transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
    body: JSON.stringify(payload),
  });
  const body = await corpoDaResposta(response);
  if (response.ok) return body;

  const falha = new ErroDaTransferencia({
    // Sem código no corpo, o status HTTP vira o código: `mensagemAmigavel` já
    // sabe traduzir 401 e 403, e sem isso a tela cairia na frase genérica.
    message: body.error,
    code: body.code ?? String(response.status),
    details: body.details,
    hint: body.hint,
    status: response.status,
  });

  // Erro COMPLETO no console ANTES de qualquer mensagem na tela. O DETAIL da
  // função do banco traz a etapa nomeada, a restrição recusada e o tipo real de
  // cada coluna; a etapa sai também separada, para não ser preciso ler o texto
  // inteiro. Nada disso vai para a tela -- lá aparece só a frase em português.
  if (typeof console !== "undefined") {
    console.error("[Pagamentos Fase 2] Transferência entre contas recusada pelo banco.", {
      code: falha.code,
      message: falha.message,
      details: falha.details,
      hint: falha.hint,
      status: falha.status,
      ...detalheDoBanco(falha),
    });
  }

  throw falha;
}

/**
 * Confirma uma transferência de VÁRIAS origens para UM destino.
 *
 * @param {object} entrada
 * @param {number|string} entrada.programacaoId  programação relacionada
 * @param {number|string} entrada.contaDestinoId conta que recebe
 * @param {Array<{sourceAccountId: number, amount: number}>} entrada.pernas
 * @param {string} entrada.chaveIdempotencia     criada uma vez por operação
 * @param {string} [entrada.observacao]
 */
export function confirmarTransferenciaEntreContas({
  programacaoId,
  contaDestinoId,
  pernas,
  chaveIdempotencia,
  observacao,
}) {
  if (!chaveIdempotencia) throw new Error("A transferência precisa de um identificador único.");
  if (!Array.isArray(pernas) || pernas.length === 0) throw new Error("Informe ao menos uma conta de origem com valor.");
  return confirmarTransferencias({
    programId: programacaoId,
    destinationAccountId: contaDestinoId,
    transfers: pernas,
    idempotencyKey: chaveIdempotencia,
    note: observacao || null,
  });
}

/**
 * Estorna uma transferência efetivada.
 *
 * Transferência não se exclui: o estorno lança a movimentação inversa e a
 * original continua na razão, no Histórico e na Auditoria. O motivo é
 * obrigatório -- é ele que explica o estorno para quem for auditar depois.
 */
export function estornarTransferencia(transferId, note) {
  if (!String(note ?? "").trim()) throw new Error("Informe o motivo do estorno.");
  return confirmarTransferencias({ action: "reverse", transferId, note: String(note).trim() });
}
