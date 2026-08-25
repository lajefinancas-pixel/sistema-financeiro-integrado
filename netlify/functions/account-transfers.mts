import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { transferOperationMirrors } from "../../db/schema.js";
import { authenticatedSupabase, errorResponse } from "./_shared/auth.mjs";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("Método não permitido.", { status: 405 });
    const { supabase, user } = await authenticatedSupabase(req);
    const body = await req.json();

    if (body.action === "reverse") {
      const { data, error } = await supabase.rpc("estornar_transferencia", {
        p_transferencia_id: body.transferId,
        p_observacao: body.note || null,
      });
      if (error) throw error;
      return Response.json(data);
    }

    const { data, error } = await supabase.rpc("confirmar_transferencias_programacao", {
      p_programacao_id: body.programId,
      p_conta_destino_id: body.destinationAccountId,
      p_transferencias: (body.transfers ?? []).map((item: any) => ({ conta_origem_id: item.sourceAccountId, valor: item.amount })),
      p_chave_idempotencia: body.idempotencyKey,
      p_observacao: body.note || null,
    });
    if (error) throw error;

    const ids = Array.isArray(data?.transferencias) ? data.transferencias : [];
    if (ids.length) {
      await db.insert(transferOperationMirrors).values(ids.map((id: string, index: number) => ({
        externalTransferId: id,
        idempotencyKey: body.idempotencyKey,
        programId: String(body.programId),
        sourceAccountId: String(body.transfers[index]?.sourceAccountId),
        destinationAccountId: String(body.destinationAccountId),
        amount: String(body.transfers[index]?.amount ?? 0),
        userId: String(user.id),
        note: body.note || null,
        payload: data,
      }))).onConflictDoNothing();
    }
    return Response.json(data);
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = { path: "/api/account-transfers" };
