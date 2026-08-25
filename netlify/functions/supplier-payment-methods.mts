import type { Config } from "@netlify/functions";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { supplierPaymentMethodEvents, supplierPaymentMethods } from "../../db/schema.js";
import { authenticatedSupabase, errorResponse, requireSpecialPermission } from "./_shared/auth.mjs";

const allowedKinds = new Set(["pix", "bank"]);

function cleanPayload(input: any) {
  const kind = String(input.kind ?? "");
  if (!allowedKinds.has(kind)) throw new Error("Forma de pagamento inválida.");
  const holderName = String(input.holderName ?? "").trim();
  if (!holderName) throw new Error("Informe o nome do titular.");
  if (kind === "pix" && !String(input.pixKey ?? "").trim()) throw new Error("Informe a chave PIX.");
  if (kind === "bank" && (!String(input.bankName ?? "").trim() || !String(input.account ?? "").trim())) {
    throw new Error("Informe banco e conta.");
  }
  return {
    kind,
    label: String(input.label ?? "").trim() || null,
    pixKeyType: kind === "pix" ? String(input.pixKeyType ?? "").trim() || null : null,
    pixKey: kind === "pix" ? String(input.pixKey ?? "").trim() : null,
    bankName: kind === "bank" ? String(input.bankName ?? "").trim() : null,
    bankCode: kind === "bank" ? String(input.bankCode ?? "").trim() || null : null,
    agency: kind === "bank" ? String(input.agency ?? "").trim() || null : null,
    account: kind === "bank" ? String(input.account ?? "").trim() : null,
    accountDigit: kind === "bank" ? String(input.accountDigit ?? "").trim() || null : null,
    accountType: kind === "bank" ? String(input.accountType ?? "").trim() || null : null,
    holderName,
    holderDocument: String(input.holderDocument ?? "").trim() || null,
    isPrimary: input.isPrimary === true,
  };
}

export default async (req: Request) => {
  try {
    const { supabase, user } = await authenticatedSupabase(req);
    const url = new URL(req.url);
    const supplierId = url.searchParams.get("supplierId") || "";
    const supplierIds = (url.searchParams.get("supplierIds") || "").split(",").filter(Boolean);

    if (req.method === "GET") {
      const permissions = await Promise.all(["visualizar_pix", "visualizar_dados_bancarios"].map(async (action) => {
        const { data } = await supabase.rpc("tem_permissao_especial", { p_acao: action });
        return data === true;
      }));
      const kinds = [permissions[0] && "pix", permissions[1] && "bank"].filter(Boolean) as string[];
      if (!kinds.length) return Response.json(supplierIds.length ? {} : []);
      if (supplierIds.length) {
        const rows = await db.select({ supplierId: supplierPaymentMethods.supplierId }).from(supplierPaymentMethods)
          .where(and(inArray(supplierPaymentMethods.supplierId, supplierIds), inArray(supplierPaymentMethods.kind, kinds)));
        return Response.json(Object.fromEntries(supplierIds.map((id) => [id, rows.some((row) => row.supplierId === id)])));
      }
      if (!supplierId) return Response.json({ error: "Fornecedor obrigatório." }, { status: 400 });
      const rows = await db.select().from(supplierPaymentMethods)
        .where(and(eq(supplierPaymentMethods.supplierId, supplierId), inArray(supplierPaymentMethods.kind, kinds)))
        .orderBy(desc(supplierPaymentMethods.isPrimary), desc(supplierPaymentMethods.updatedAt));
      return Response.json(rows);
    }

    if (!supplierId) return Response.json({ error: "Fornecedor obrigatório." }, { status: 400 });

    const body = await req.json();
    const payload = cleanPayload(body);
    const permissionPrefix = payload.kind === "pix" ? "pix" : "dados_bancarios";

    if (req.method === "POST") {
      await requireSpecialPermission(supabase, `cadastrar_${permissionPrefix}`);
      const [created] = await db.transaction(async (tx) => {
        if (payload.isPrimary) await tx.update(supplierPaymentMethods).set({ isPrimary: false }).where(eq(supplierPaymentMethods.supplierId, supplierId));
        const rows = await tx.insert(supplierPaymentMethods).values({ ...payload, supplierId, createdBy: user.id, updatedBy: user.id }).returning();
        await tx.insert(supplierPaymentMethodEvents).values({ supplierId, paymentMethodId: rows[0].id, action: "created", newValue: rows[0], userId: user.id });
        return rows;
      });
      await supabase.from("auditoria_eventos").insert({ usuario_id: user.id, modulo: "fornecedores", acao: "alterou", registro_afetado: `Dados para pagamento do fornecedor ${supplierId}`, valor_anterior: null, valor_novo: created, nivel: "critico" });
      return Response.json(created, { status: 201 });
    }

    const id = String(body.id ?? "");
    const [previous] = await db.select().from(supplierPaymentMethods).where(and(eq(supplierPaymentMethods.id, id), eq(supplierPaymentMethods.supplierId, supplierId))).limit(1);
    if (!previous) return Response.json({ error: "Forma de pagamento não encontrada." }, { status: 404 });

    if (req.method === "PATCH") {
      await requireSpecialPermission(supabase, `editar_${permissionPrefix}`);
      const [updated] = await db.transaction(async (tx) => {
        if (payload.isPrimary) await tx.update(supplierPaymentMethods).set({ isPrimary: false }).where(eq(supplierPaymentMethods.supplierId, supplierId));
        const rows = await tx.update(supplierPaymentMethods).set({ ...payload, updatedBy: user.id, updatedAt: new Date() }).where(eq(supplierPaymentMethods.id, id)).returning();
        await tx.insert(supplierPaymentMethodEvents).values({ supplierId, paymentMethodId: id, action: "updated", previousValue: previous, newValue: rows[0], userId: user.id });
        return rows;
      });
      await supabase.from("auditoria_eventos").insert({ usuario_id: user.id, modulo: "fornecedores", acao: "alterou", registro_afetado: `Dados para pagamento do fornecedor ${supplierId}`, valor_anterior: previous, valor_novo: updated, nivel: "critico" });
      return Response.json(updated);
    }

    if (req.method === "DELETE") {
      await requireSpecialPermission(supabase, "excluir_dados_bancarios");
      await db.transaction(async (tx) => {
        await tx.insert(supplierPaymentMethodEvents).values({ supplierId, paymentMethodId: id, action: "deleted", previousValue: previous, userId: user.id });
        await tx.delete(supplierPaymentMethods).where(eq(supplierPaymentMethods.id, id));
      });
      await supabase.from("auditoria_eventos").insert({ usuario_id: user.id, modulo: "fornecedores", acao: "excluiu", registro_afetado: `Dados para pagamento do fornecedor ${supplierId}`, valor_anterior: previous, valor_novo: null, nivel: "critico" });
      return new Response(null, { status: 204 });
    }
    return new Response("Método não permitido.", { status: 405 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = { path: "/api/supplier-payment-methods" };
