import type { Config } from "@netlify/functions";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { authenticatedSupabase, errorResponse } from "./_shared/auth.mts";

type Pedido = { processoPdfBase64?: string; fornecedorId?: string; certidoes?: Array<{ id?: string; vencida?: boolean; nome?: string }> };
const resposta = (error: string, status: number) => Response.json({ error }, { status });

export default async function (req: Request) {
  if (req.method !== "POST") return resposta("Método não permitido.", 405);
  try {
    const { supabase } = await authenticatedSupabase(req, { exigirCadastro: false });
    const pedido = (await req.json()) as Pedido;
    const fornecedorId = String(pedido.fornecedorId ?? "").trim();
    const processoBase64 = String(pedido.processoPdfBase64 ?? "");
    const escolhidas = (pedido.certidoes ?? []).filter((item) => item?.id);
    if (!fornecedorId || !processoBase64) return resposta("Dados do processo incompletos.", 400);

    const ids = escolhidas.map((item) => String(item.id));
    const consulta = ids.length
      ? await supabase.from("certidoes")
          .select("id, fornecedor_id, arquivo_url, data_vencimento, situacao, tipos_certidao(nome)")
          .eq("fornecedor_id", fornecedorId).in("id", ids)
          .is("excluido_em", null).is("substituida_por", null)
      : { data: [], error: null };
    if (consulta.error) throw consulta.error;
    if ((consulta.data ?? []).length !== ids.length) {
      return resposta("Uma ou mais certidões não pertencem ao fornecedor ou não estão disponíveis.", 400);
    }

    const porId = new Map((consulta.data ?? []).map((item: any) => [String(item.id), item]));
    const destino = await PDFDocument.load(Buffer.from(processoBase64, "base64"));
    const fonte = await destino.embedFont(StandardFonts.HelveticaBold);
    const fonteNormal = await destino.embedFont(StandardFonts.Helvetica);
    for (const escolha of escolhidas) {
      const certidao: any = porId.get(String(escolha.id));
      if (!certidao?.arquivo_url) continue;
      const arquivo = await fetch(certidao.arquivo_url);
      if (!arquivo.ok) throw new Error(`Não foi possível ler o anexo da certidão ${certidao.id}.`);
      const origem = await PDFDocument.load(await arquivo.arrayBuffer());
      const hoje = new Date().toISOString().slice(0, 10);
      const vencida = certidao.situacao === "vencida" || (certidao.data_vencimento && certidao.data_vencimento < hoje);
      if (vencida) {
        const pagina = destino.addPage([595.28, 841.89]);
        pagina.drawRectangle({ x: 52, y: 610, width: 491, height: 124, color: rgb(0.99, 0.93, 0.93), borderColor: rgb(0.72, 0.12, 0.12), borderWidth: 2 });
        pagina.drawText("ATENÇÃO: CERTIDÃO VENCIDA", { x: 86, y: 682, size: 22, font: fonte, color: rgb(0.62, 0.06, 0.06) });
        const nome = String(escolha.nome || certidao.tipos_certidao?.nome || "Certidão").slice(0, 74);
        pagina.drawText(nome, { x: 86, y: 644, size: 13, font: fonte, color: rgb(0.35, 0.08, 0.08) });
        pagina.drawText("O documento anexado a seguir estava vencido na data da geração deste processo.", { x: 86, y: 620, size: 9, font: fonteNormal, color: rgb(0.35, 0.08, 0.08) });
      }
      const paginas = await destino.copyPages(origem, origem.getPageIndices());
      paginas.forEach((pagina) => destino.addPage(pagina));
    }
    return new Response(await destino.save(), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="processo-com-certidoes.pdf"', "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const config: Config = { path: "/api/processos/mesclar-pdf", method: "POST" };
