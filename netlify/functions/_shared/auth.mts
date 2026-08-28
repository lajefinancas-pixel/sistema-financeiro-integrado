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

/**
 * Campos de um erro do Supabase/PostgREST.
 *
 * ERA AQUI QUE O DIAGNÓSTICO MORRIA. No caminho normal do postgrest-js a falha
 * chega como OBJETO SIMPLES ({ message, details, hint, code }), não como Error.
 * O `error instanceof Error` de antes dava false para ela, então a resposta saía
 * com a frase literal "Não foi possível concluir a operação." e code, message,
 * details e hint eram descartados sem nem passar pelo log. Nenhuma etapa nomeada
 * em função do banco chegava à tela, porque a etapa era jogada fora um degrau
 * antes do navegador.
 */
type CamposDoErro = {
  message: string | null;
  code: string | null;
  details: string | null;
  hint: string | null;
};

function camposDoErro(error: unknown): CamposDoErro {
  const texto = (valor: unknown) => {
    if (typeof valor === "string" && valor.trim()) return valor;
    if (typeof valor === "number") return String(valor);
    return null;
  };
  if (error instanceof Error) {
    const comExtras = error as Error & Record<string, unknown>;
    return {
      message: texto(error.message),
      code: texto(comExtras.code),
      details: texto(comExtras.details),
      hint: texto(comExtras.hint),
    };
  }
  if (error && typeof error === "object") {
    const bruto = error as Record<string, unknown>;
    return {
      message: texto(bruto.message) ?? texto(bruto.error),
      code: texto(bruto.code),
      details: texto(bruto.details),
      hint: texto(bruto.hint),
    };
  }
  return { message: texto(error), code: null, details: null, hint: null };
}

export function errorResponse(error: unknown) {
  if (error instanceof Response) return error;

  const campos = camposDoErro(error);

  // Log ANTES de qualquer resposta: o erro completo do Supabase fica na função,
  // com código, mensagem crua, DETAIL e HINT, mesmo que a tela mostre outra
  // frase. Sem isso não há como saber qual recusa o banco deu.
  console.error("[api] operação recusada pelo banco", {
    code: campos.code,
    message: campos.message,
    details: campos.details,
    hint: campos.hint,
  });

  // Os quatro campos seguem para o navegador. O status continua 500 para não
  // mudar o comportamento de nenhuma tela; quem trata a falha decide o que
  // mostrar a partir do código, e o texto técnico fica no console.
  return Response.json(
    {
      error: campos.message ?? "Não foi possível concluir a operação.",
      code: campos.code,
      details: campos.details,
      hint: campos.hint,
    },
    { status: 500 }
  );
}
