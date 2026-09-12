import { createClient } from "@supabase/supabase-js";

/**
 * Envia a imagem de identidade visual do sistema para o Storage.
 *
 * SEGUNDA PORTA, não a primeira: a tela tenta o envio direto do navegador, que
 * passa pela política do bucket 'configuracoes'. Esta função existe para o caso
 * em que essa política não existe no banco -- criar política em storage.objects
 * pelo SQL Editor falha por dono do objeto em alguns projetos, e o resultado era
 * a tela recusando QUALQUER imagem sem dizer por quê. Aqui a mesma permissão que
 * a política exigiria (edição no módulo 'administracao') é conferida no código,
 * o bucket é garantido e a gravação usa a chave de serviço.
 *
 * O que esta função NÃO faz: não cria pagamento, não dá baixa, não altera saldo,
 * não mexe em nota, transferência, programação ou processo. Ela grava UM arquivo
 * no bucket 'configuracoes' e devolve a URL pública dele. Quem grava a URL na
 * configuração é a tela, com a permissão da própria pessoa.
 */

const MODULO = "administracao";

/** As únicas pastas aceitas: a logo das telas e o brasão dos documentos. */
const PASTAS = new Set(["logomarca", "processos-brasao"]);

const BUCKET = "configuracoes";

/** Teto absoluto do arquivo, igual ao do navegador (src/lib/logomarcaImagem.js). */
const LIMITE_MB = 25;

const EXTENSOES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

function json(corpo: unknown, status = 200) {
  return Response.json(corpo, { status });
}

function extensaoDe(tipo: string, nome: string) {
  const porTipo = EXTENSOES[tipo.toLowerCase()];
  if (porTipo) return porTipo;
  const doNome = (nome.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return doNome || "png";
}

export default async (req: Request) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chaveServico = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chaveServico) {
    console.error(
      "[logomarca] envio pelo servidor indisponível: falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no ambiente das funções.",
    );
    return json(
      {
        erro:
          "O envio da imagem pelo servidor não está configurado (falta a chave de serviço do " +
          "Supabase nas variáveis do site). Avise o responsável pelo sistema.",
        code: "CONFIG_AUSENTE",
      },
      503,
    );
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ erro: "Sessão não informada.", code: "SEM_TOKEN" }, 401);

  const admin = createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sessao, error: erroSessao } = await admin.auth.getUser(token);
  if (erroSessao || !sessao?.user) {
    return json({ erro: "Sessão inválida ou expirada.", code: "SESSAO_INVALIDA" }, 401);
  }

  const { data: solicitante, error: erroSolicitante } = await admin
    .from("usuarios")
    .select("id, status")
    .eq("auth_id", sessao.user.id)
    .maybeSingle();
  if (erroSolicitante) {
    console.error("[logomarca] não foi possível ler o cadastro de quem chamou", erroSolicitante);
    return json({ erro: "Não foi possível confirmar suas permissões.", code: "PERMISSAO_ILEGIVEL" }, 500);
  }
  if (!solicitante || solicitante.status !== "ativo") {
    return json({ erro: "Seu usuário não está ativo no sistema.", code: "USUARIO_INATIVO" }, 403);
  }

  const { data: permissao, error: erroPermissao } = await admin
    .from("permissoes_efetivas")
    .select("pode_editar")
    .eq("usuario_id", solicitante.id)
    .eq("modulo", MODULO)
    .maybeSingle();
  if (erroPermissao) {
    console.error("[logomarca] não foi possível ler a permissão do módulo administracao", erroPermissao);
    return json({ erro: "Não foi possível confirmar suas permissões.", code: "PERMISSAO_ILEGIVEL" }, 500);
  }
  if (!permissao?.pode_editar) {
    return json(
      { erro: "Você não tem permissão para alterar a identidade visual do sistema.", code: "SEM_PERMISSAO" },
      403,
    );
  }

  let formulario: FormData;
  try {
    formulario = await req.formData();
  } catch (e) {
    console.error("[logomarca] corpo da requisição não é um formulário com arquivo", e);
    return json({ erro: "A imagem não chegou ao servidor. Tente novamente.", code: "CORPO_INVALIDO" }, 400);
  }

  const pastaPedida = String(formulario.get("pasta") ?? "logomarca");
  const pasta = PASTAS.has(pastaPedida) ? pastaPedida : "logomarca";
  const arquivo = formulario.get("arquivo");

  if (!arquivo || typeof arquivo === "string") {
    return json({ erro: "Nenhuma imagem foi recebida pelo servidor.", code: "SEM_ARQUIVO" }, 400);
  }

  const tipo = String(arquivo.type || "");
  const nome = String((arquivo as File).name || "logomarca");
  if (tipo && !tipo.toLowerCase().startsWith("image/")) {
    return json(
      { erro: "O arquivo enviado não é uma imagem. Envie um arquivo JPG, PNG ou SVG.", code: "FORMATO" },
      415,
    );
  }
  if (arquivo.size > LIMITE_MB * 1024 * 1024) {
    return json(
      { erro: `A imagem passa do máximo de ${LIMITE_MB} MB que o servidor recebe.`, code: "TAMANHO" },
      413,
    );
  }

  // Garante o depósito. `getBucket` não falhar é o caminho normal; criar só
  // acontece em banco onde a migration do bucket nunca rodou.
  const { error: erroBucket } = await admin.storage.getBucket(BUCKET);
  if (erroBucket) {
    console.error("[logomarca] bucket 'configuracoes' não encontrado; criando", erroBucket);
    const { error: erroCriar } = await admin.storage.createBucket(BUCKET, { public: true });
    if (erroCriar && !/already exists/i.test(erroCriar.message ?? "")) {
      console.error("[logomarca] não foi possível criar o bucket 'configuracoes'", erroCriar);
      return json(
        {
          erro:
            "O servidor não conseguiu preparar o depósito de imagens do sistema. Avise o " +
            "responsável pelo sistema.",
          code: "BUCKET",
          details: erroCriar.message ?? null,
        },
        500,
      );
    }
  }

  const caminho = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensaoDe(tipo, nome)}`;
  const conteudo = new Uint8Array(await arquivo.arrayBuffer());

  const { error: erroEnvio } = await admin.storage.from(BUCKET).upload(caminho, conteudo, {
    cacheControl: "3600",
    upsert: false,
    contentType: tipo || "image/png",
  });
  if (erroEnvio) {
    // O erro completo fica no log da função; a tela recebe o motivo e o código.
    console.error("[logomarca] a chave de serviço também não conseguiu gravar no bucket", erroEnvio);
    return json(
      {
        erro:
          "O servidor não conseguiu gravar a imagem no depósito do sistema. Avise o responsável " +
          "pelo sistema: o erro completo está no log da função.",
        code: "ENVIO",
        details: erroEnvio.message ?? null,
      },
      500,
    );
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(caminho);
  if (!data?.publicUrl) {
    return json(
      { erro: "A imagem subiu, mas o endereço público dela não pôde ser montado.", code: "URL" },
      500,
    );
  }

  console.log("[logomarca] imagem gravada pelo servidor", { caminho, usuario: solicitante.id });
  return json({ url: data.publicUrl, caminho });
};

export const config = {
  path: "/api/configuracoes/logomarca",
  method: "POST",
};
