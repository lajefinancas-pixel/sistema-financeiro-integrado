import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-backup-secret",
};

function resposta(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function mensagemSegura(erro: unknown) {
  const texto = erro instanceof Error ? erro.message : String(erro ?? "Falha desconhecida");
  return texto.replace(/(token|key|secret|password)\s*[:=]\s*\S+/gi, "$1=[oculto]").slice(0, 1000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resposta({ erro: "Metodo nao permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return resposta({ erro: "A funcao de backup nao esta configurada no servidor." }, 500);
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let logId: string | null = null;

  try {
    const corpo = await req.json().catch(() => ({}));
    const automatico = corpo?.tipo === "automatico";
    let usuarioId: string | null = null;

    if (automatico) {
      const esperado = Deno.env.get("BACKUP_CRON_SECRET");
      if (!esperado || req.headers.get("x-backup-secret") !== esperado) {
        return resposta({ erro: "Rotina automatica nao autorizada." }, 401);
      }
    } else {
      const authorization = req.headers.get("Authorization");
      if (!authorization) return resposta({ erro: "Sessao obrigatoria." }, 401);
      const usuario = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: permitido, error: erroPermissao } = await usuario.rpc("pode_gerar_backup_manual");
      if (erroPermissao || permitido !== true) return resposta({ erro: "Sem permissao para gerar backup." }, 403);
      const { data: id, error: erroUsuario } = await usuario.rpc("meu_usuario_ativo_id");
      if (erroUsuario || !id) return resposta({ erro: "Usuario ativo nao identificado." }, 401);
      usuarioId = id;
    }

    const { data: log, error: erroLog } = await service.from("backups_log").insert({
      tipo: automatico ? "automatico" : "manual",
      status: "em_andamento",
      usuario_id: usuarioId,
      descricao: automatico ? "Backup automatico diario" : "Backup manual solicitado na tela de Configuracoes",
    }).select("id").single();
    if (erroLog) throw erroLog;
    logId = log.id;

    const { data: exportacao, error: erroExportacao } = await service.rpc("exportar_backup_completo");
    if (erroExportacao) throw erroExportacao;

    const json = new TextEncoder().encode(JSON.stringify(exportacao));
    const compactado = await new Response(
      new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const tamanhoBytes = compactado.byteLength;
    const instante = new Date().toISOString().replace(/[:.]/g, "-");
    const caminho = `${new Date().toISOString().slice(0, 10)}/${automatico ? "automatico" : "manual"}-${instante}-${logId}.json.gz`;

    const { error: erroUpload } = await service.storage.from("backups-sistema").upload(
      caminho,
      compactado,
      { contentType: "application/gzip", upsert: false },
    );
    if (erroUpload) throw erroUpload;

    const tabelas = Array.isArray(exportacao?.tabelas) ? exportacao.tabelas : [];
    const { error: erroConclusao } = await service.from("backups_log").update({
      status: "concluido",
      concluido_em: new Date().toISOString(),
      tamanho_bytes: tamanhoBytes,
      arquivo_caminho: caminho,
      tabelas_incluidas: tabelas,
      formato: "json.gz",
      descricao: `Backup real concluido com ${tabelas.length} tabelas.`,
      detalhes_erro: null,
    }).eq("id", logId);
    if (erroConclusao) throw erroConclusao;

    let downloadUrl: string | null = null;
    if (!automatico) {
      const { data: assinatura, error: erroAssinatura } = await service.storage
        .from("backups-sistema").createSignedUrl(caminho, 600, { download: caminho.split("/").at(-1) });
      if (erroAssinatura) throw erroAssinatura;
      downloadUrl = assinatura.signedUrl;
    }

    return resposta({
      id: logId,
      tamanho_bytes: tamanhoBytes,
      tabelas_incluidas: tabelas,
      arquivo_nome: caminho.split("/").at(-1),
      download_url: downloadUrl,
    });
  } catch (erro) {
    const detalhe = mensagemSegura(erro);
    if (logId) {
      await service.from("backups_log").update({
        status: "falhou",
        concluido_em: new Date().toISOString(),
        detalhes_erro: detalhe,
      }).eq("id", logId);
    }
    return resposta({ erro: detalhe }, 500);
  }
});

