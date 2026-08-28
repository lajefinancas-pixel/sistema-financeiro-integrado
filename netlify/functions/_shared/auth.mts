import { createClient } from "@supabase/supabase-js";

/**
 * Recusa da PORTARIA (esta função), não do banco.
 *
 * ERA AQUI QUE O DIAGNÓSTICO AINDA MORRIA. As quatro saídas de
 * `authenticatedSupabase` levantavam `new Response("texto", { status })`, e
 * `errorResponse` devolve todo Response intacto. Consequência, para quem estava
 * na tela: o corpo é TEXTO, então o `response.json()` do navegador falha, o
 * objeto de erro sai sem `code`, sem `details` e sem `hint`, e a tela mostra a
 * frase genérica. Do lado do servidor não sobrava nem log, porque a portaria
 * levantava antes de qualquer `console.error`. Uma recusa aqui era, palavra por
 * palavra, "sem etapa, sem código, sem detalhe" -- exatamente o sintoma que as
 * funções do banco já não produzem mais, cada uma nomeando a sua etapa.
 *
 * Agora toda recusa da portaria sai como JSON com um CÓDIGO PRÓPRIO e é
 * registrada antes de subir. Os códigos são estáveis e não colidem com os do
 * Postgres/PostgREST:
 *
 *   AUTH_SEM_TOKEN       -> a requisição chegou sem Authorization
 *   AUTH_CONFIG_AUSENTE  -> a função não tem VITE_SUPABASE_URL/ANON_KEY no
 *                           ambiente de execução (só no de build, por exemplo)
 *   AUTH_SESSAO_INVALIDA -> o token não vale mais (expirado, revogado)
 *   AUTH_SEM_CADASTRO    -> o login não achou linha em public.usuarios por
 *                           auth_id: ou não existe, ou a RLS da tabela não
 *                           deixa o próprio usuário ler a própria linha
 */
function recusaDaPortaria(
  code: string,
  message: string,
  status: number,
  details: string | null = null,
  hint: string | null = null,
) {
  console.error("[api] a portaria recusou a requisição antes de chamar o banco", {
    code,
    message,
    details,
    hint,
    status,
  });
  return new Response(JSON.stringify({ error: message, code, details, hint }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Autentica a requisição e devolve o cliente Supabase que fala pelo usuário.
 *
 * `exigirCadastro` decide o que fazer quando a linha de public.usuarios não é
 * encontrada por auth_id:
 *
 *   true  (padrão) -> recusa com 403. É o necessário para quem grava com o id
 *                     de public.usuarios do lado da função (a trilha de
 *                     auditoria gravada aqui tem RLS amarrando usuario_id ao
 *                     usuário da sessão, e sem o id não há o que gravar).
 *   false          -> segue com registroId nulo e deixa a decisão para o banco.
 *                     É o certo para quem chama uma função SECURITY DEFINER que
 *                     já resolve o usuário e já confere a permissão sozinha:
 *                     a portaria não tem nada a acrescentar e, se recusar aqui,
 *                     recusa uma operação que o banco teria aprovado.
 */
export async function authenticatedSupabase(req: Request, { exigirCadastro = true } = {}) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) {
    throw recusaDaPortaria("AUTH_SEM_TOKEN", "Não autorizado.", 401);
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw recusaDaPortaria(
      "AUTH_CONFIG_AUSENTE",
      "Configuração de autenticação indisponível.",
      503,
      `faltando no ambiente de execução da função: ${[!url && "VITE_SUPABASE_URL", !key && "VITE_SUPABASE_ANON_KEY"]
        .filter(Boolean)
        .join(", ")}`,
      "As duas variáveis precisam estar visíveis para as funções, não só para o build.",
    );
  }

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw recusaDaPortaria(
      "AUTH_SESSAO_INVALIDA",
      "Sessão inválida.",
      401,
      error?.message ?? "getUser não devolveu usuário para o token enviado.",
    );
  }

  // A linha de public.usuarios é lida COM O JWT DO USUÁRIO, então ela passa pela
  // RLS da tabela. Vazio aqui não significa "não existe": significa "este login
  // não conseguiu ler a própria linha". Os dois casos ficam separados no log, e
  // o motivo vai no details da recusa quando ela acontece.
  const { data: usuarios, error: userError } = await supabase
    .from("usuarios")
    .select("id,nome_completo")
    .eq("auth_id", data.user.id)
    .limit(1);

  const registro = usuarios?.[0] ?? null;
  if (!registro) {
    const detalhe = userError
      ? `a leitura de public.usuarios por auth_id foi recusada (code=${userError.code ?? "-"}): ${userError.message}`
      : "a leitura de public.usuarios por auth_id não devolveu linha: ou não há cadastro para este login, ou a RLS da tabela não permite que ele leia a própria linha";

    if (exigirCadastro) {
      throw recusaDaPortaria("AUTH_SEM_CADASTRO", "Usuário não encontrado.", 403, detalhe);
    }
    // Segue adiante: quem chamou disse que o banco decide. Fica registrado, para
    // que a ausência do cadastro nunca seja uma falha silenciosa.
    console.error("[api] login autenticado sem cadastro legível em public.usuarios", {
      code: "AUTH_SEM_CADASTRO",
      details: detalhe,
      authId: data.user.id,
    });
  }

  return {
    supabase,
    // Mantido como antes para quem exige cadastro: `user.id` é o id de
    // public.usuarios. Com exigirCadastro:false ele pode ser nulo, e aí
    // `authId` é o único identificador disponível.
    user: registro ?? { id: null, nome_completo: null },
    registroId: registro?.id ?? null,
    authId: data.user.id,
    token,
  };
}

export async function requireSpecialPermission(supabase: any, action: string) {
  const { data, error } = await supabase.rpc("tem_permissao_especial", { p_acao: action });
  if (error || data !== true) {
    throw recusaDaPortaria(
      "AUTH_SEM_PERMISSAO_ESPECIAL",
      "Você não possui permissão para esta operação.",
      403,
      error ? `tem_permissao_especial falhou (code=${error.code ?? "-"}): ${error.message}` : `ação recusada: ${action}`,
    );
  }
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
