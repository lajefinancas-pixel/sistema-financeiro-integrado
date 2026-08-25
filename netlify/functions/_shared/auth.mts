import { createClient } from "@supabase/supabase-js";

export async function authenticatedSupabase(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new Response("Não autorizado.", { status: 401 });

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Response("Configuração de autenticação indisponível.", { status: 503 });

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Response("Sessão inválida.", { status: 401 });

  const { data: usuarios, error: userError } = await supabase
    .from("usuarios")
    .select("id,nome_completo")
    .eq("auth_id", data.user.id)
    .limit(1);
  if (userError || !usuarios?.[0]) throw new Response("Usuário não encontrado.", { status: 403 });
  return { supabase, user: usuarios[0], token };
}

export async function requireSpecialPermission(supabase: any, action: string) {
  const { data, error } = await supabase.rpc("tem_permissao_especial", { p_acao: action });
  if (error || data !== true) throw new Response("Você não possui permissão para esta operação.", { status: 403 });
}

export function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
  return Response.json({ error: message }, { status: 500 });
}
