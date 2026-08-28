import type { Config } from "@netlify/functions";
import { authenticatedSupabase, errorResponse } from "./_shared/auth.mjs";

/**
 * Transferência entre contas próprias e estorno.
 *
 * A operação inteira acontece dentro de uma função do banco: a saída e a entrada
 * ficam na mesma transação (atômica) e a chave de idempotência tem índice único
 * (a mesma transferência nunca acontece duas vezes). Aqui só há autenticação,
 * tradução do corpo da requisição e a cópia de conferência.
 */
export default async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Método não permitido.", code: "METODO_NAO_PERMITIDO" }, { status: 405 });
    }
    // exigirCadastro: false -- de propósito. A autorização desta operação é
    // inteira do banco: confirmar_transferencias_programacao e
    // estornar_transferencia recusam com 42501 quando auth.uid() é nulo e quando
    // public.pode_em_pagamentos_fase2('executar_transferencia') é falso, e essa
    // permissão só existe para quem TEM cadastro ativo em public.usuarios.
    // Repetir a conferência aqui não acrescenta nada e cria uma recusa a mais:
    // esta leitura passa pela RLS de public.usuarios, então um login legítimo que
    // não consiga ler a própria linha era barrado ANTES de a função do banco ser
    // chamada -- sem etapa, sem código e sem detalhe, porque nada do banco tinha
    // sido executado. A transferência é a única operação de rotina que passa por
    // uma função Netlify; o resto das telas fala direto com o Supabase e por isso
    // nunca encostou nesta portaria.
    const { supabase, registroId, authId } = await authenticatedSupabase(req, { exigirCadastro: false });
    const body = await req.json();

    if (body.action === "reverse") {
      const motivo = String(body.note ?? "").trim();
      if (!motivo) return Response.json({ error: "Informe o motivo do estorno." }, { status: 400 });

      const { data, error } = await supabase.rpc("estornar_transferencia", {
        p_transferencia_id: body.transferId,
        p_observacao: motivo,
      });
      if (error) {
        registrarRecusa("estornar_transferencia", { p_transferencia_id: body.transferId }, error);
        throw error;
      }
      return Response.json(data);
    }

    const pernas = (body.transfers ?? []).map((item: any) => ({
      conta_origem_id: Number(item.sourceAccountId),
      valor: Number(item.amount),
    }));
    if (!pernas.length) return Response.json({ error: "Informe ao menos uma conta de origem com valor." }, { status: 400 });
    if (!String(body.idempotencyKey ?? "").trim()) {
      return Response.json({ error: "A transferência precisa de um identificador único." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("confirmar_transferencias_programacao", {
      p_programacao_id: Number(body.programId),
      p_conta_destino_id: Number(body.destinationAccountId),
      p_transferencias: pernas,
      p_chave_idempotencia: String(body.idempotencyKey).trim(),
      p_observacao: body.note || null,
    });
    if (error) {
      registrarRecusa(
        "confirmar_transferencias_programacao",
        {
          p_programacao_id: Number(body.programId),
          p_conta_destino_id: Number(body.destinationAccountId),
          p_transferencias: pernas,
        },
        error
      );
      throw error;
    }

    await espelharParaConferencia({ data, body, userId: registroId ?? authId });
    return Response.json(data);
  } catch (error) {
    return errorResponse(error);
  }
};

/**
 * Erro completo do Supabase no log da função, com os argumentos da chamada.
 *
 * A recusa do banco chega como objeto simples ({ message, details, hint, code }),
 * e é o DETAIL que carrega a etapa nomeada, a restrição recusada e o tipo real
 * de cada coluna. Nada disso pode depender de alguém abrir o console do
 * navegador: fica registrado aqui, do lado do servidor, antes de qualquer
 * resposta. Não há valor de conta bancária nem chave de idempotência no log --
 * só ids e os campos do erro.
 */
function registrarRecusa(funcao: string, argumentos: Record<string, unknown>, error: unknown) {
  const campo = (nome: string) => {
    const valor = (error as Record<string, unknown> | null)?.[nome];
    return typeof valor === "string" && valor.trim() ? valor : null;
  };
  console.error("[account-transfers] o banco recusou a chamada", {
    funcao,
    argumentos,
    code: campo("code"),
    message: campo("message"),
    details: campo("details"),
    hint: campo("hint"),
  });
}

/**
 * Cópia de conferência das transferências efetivadas.
 *
 * É deliberadamente à prova de falha: quando esta função é chamada, o dinheiro
 * JÁ se moveu e a transação do banco já fechou. Se a cópia falhasse para cima,
 * o usuário veria erro numa transferência que deu certo e tentaria de novo. A
 * razão oficial da transferência é a do Supabase; esta é um espelho.
 */
async function espelharParaConferencia({ data, body, userId }: { data: any; body: any; userId: string }) {
  try {
    const pernas = Array.isArray(data?.transferencias) ? data.transferencias : [];
    if (!pernas.length || data?.ja_confirmada) return;

    const { db } = await import("../../db/index.js");
    const { transferOperationMirrors } = await import("../../db/schema.js");

    await db
      .insert(transferOperationMirrors)
      .values(
        pernas.map((perna: any) => ({
          externalTransferId: String(perna?.id ?? perna),
          idempotencyKey: String(body.idempotencyKey ?? ""),
          programId: String(body.programId ?? ""),
          sourceAccountId: String(perna?.conta_origem_id ?? ""),
          destinationAccountId: String(body.destinationAccountId ?? ""),
          amount: String(perna?.valor ?? 0),
          userId: String(userId),
          note: body.note || null,
          payload: data,
        }))
      )
      .onConflictDoNothing();
  } catch (falha) {
    console.error("[account-transfers] cópia de conferência não gravada", falha);
  }
}

export const config: Config = { path: "/api/account-transfers" };
