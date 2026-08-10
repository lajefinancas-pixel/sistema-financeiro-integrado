import { createClient } from "@supabase/supabase-js";
import { gerarSenhaProvisoria } from "../../src/lib/senhaProvisoria.js";

const MODULO = "administracao";

function json(corpo: unknown, status = 200) {
  return Response.json(corpo, { status });
}

/**
 * Redefine a senha de um usuário da equipe e devolve a nova senha provisória
 * para a administradora repassar. Trocar a senha de outra pessoa exige a chave
 * de serviço do Supabase, por isso a operação vive aqui e não no navegador.
 *
 * Antes de trocar qualquer senha a função confirma que quem chamou está
 * autenticado e tem permissão de edição no módulo "administracao".
 */
export default async (req: Request) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chaveServico = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chaveServico) {
    return json(
      {
        erro:
          "Redefinição de senha indisponível: defina as variáveis de ambiente SUPABASE_URL e " +
          "SUPABASE_SERVICE_ROLE_KEY no site para habilitar esta ação.",
      },
      503
    );
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ erro: "Sessão não informada." }, 401);

  let usuarioId: string | undefined;
  try {
    const corpo = await req.json();
    usuarioId = corpo?.usuario_id;
  } catch {
    return json({ erro: "Requisição inválida." }, 400);
  }
  if (!usuarioId) return json({ erro: "Informe o usuário que terá a senha redefinida." }, 400);

  const admin = createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sessao, error: erroSessao } = await admin.auth.getUser(token);
  if (erroSessao || !sessao?.user) return json({ erro: "Sessão inválida ou expirada." }, 401);

  const { data: solicitante, error: erroSolicitante } = await admin
    .from("usuarios")
    .select("id, status")
    .eq("auth_id", sessao.user.id)
    .maybeSingle();
  if (erroSolicitante) return json({ erro: "Não foi possível confirmar suas permissões." }, 500);
  if (!solicitante || solicitante.status !== "ativo") {
    return json({ erro: "Seu usuário não está ativo no sistema." }, 403);
  }

  const { data: permissao, error: erroPermissao } = await admin
    .from("permissoes_efetivas")
    .select("pode_editar")
    .eq("usuario_id", solicitante.id)
    .eq("modulo", MODULO)
    .maybeSingle();
  if (erroPermissao) return json({ erro: "Não foi possível confirmar suas permissões." }, 500);
  if (!permissao?.pode_editar) {
    return json({ erro: "Você não tem permissão para redefinir senhas." }, 403);
  }

  const { data: alvo, error: erroAlvo } = await admin
    .from("usuarios")
    .select("auth_id, email")
    .eq("id", usuarioId)
    .maybeSingle();
  if (erroAlvo) return json({ erro: "Não foi possível localizar o usuário." }, 500);
  if (!alvo?.auth_id) {
    return json({ erro: "Este usuário ainda não possui conta de acesso vinculada." }, 404);
  }

  const senha = gerarSenhaProvisoria();
  const { error: erroSenha } = await admin.auth.admin.updateUserById(alvo.auth_id, { password: senha });
  if (erroSenha) return json({ erro: `Não foi possível redefinir a senha: ${erroSenha.message}` }, 500);

  return json({ senha, email: alvo.email });
};

export const config = {
  path: "/api/equipe/redefinir-senha",
  method: "POST",
};
