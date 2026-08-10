// Tratamento genérico de erros da aplicação.
//
// Nenhuma tela deve mostrar texto de backend para o usuário: nome de tabela
// ("public.filtros_favoritos"), "schema cache", "relation does not exist",
// erro de SQL/PostgREST/Supabase ou stack trace. Todo lugar que exibe erro
// passa a falha por `mensagemAmigavel(erro, "mensagem do contexto")`, que
// devolve algo compreensível e guarda o detalhe técnico apenas no console.

export const MENSAGEM_GENERICA =
  "Não foi possível concluir esta ação agora. Tente novamente em alguns instantes.";

/** Erro criado pela própria aplicação: a mensagem já é escrita para o usuário. */
export class ErroAmigavel extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroAmigavel";
    this.amigavel = true;
  }
}

export function erroAmigavel(mensagem) {
  return new ErroAmigavel(mensagem);
}

// Falhas de banco/permissão que têm uma explicação melhor que a genérica.
const MENSAGENS_POR_CODIGO = {
  "23505": "Já existe um registro com esses dados.",
  "23503": "Este registro está ligado a outros lançamentos e não pode ser alterado ou excluído.",
  "23502": "Preencha todos os campos obrigatórios.",
  "22P02": "Algum valor informado está em um formato inválido.",
  "22003": "O valor informado é maior do que o sistema aceita.",
  "42501": "Você não tem permissão para fazer isso.",
  PGRST301: "Sua sessão expirou. Entre novamente para continuar.",
  PGRST116: "O registro procurado não foi encontrado.",
  "401": "Sua sessão expirou. Entre novamente para continuar.",
  "403": "Você não tem permissão para fazer isso.",
};

// Mensagens conhecidas do Supabase Auth, em inglês, traduzidas.
const TRADUCOES = [
  [/invalid login credentials/i, "Usuário ou senha inválidos."],
  [/email not confirmed/i, "Este e-mail ainda não foi confirmado."],
  [/user already registered|already been registered/i, "Já existe uma conta de acesso com este e-mail."],
  [/password should be at least/i, "A senha é curta demais. Use pelo menos 6 caracteres."],
  [/email rate limit|too many requests/i, "Muitas tentativas em pouco tempo. Espere um instante e tente de novo."],
  [/invalid.*(token|jwt)|jwt expired|refresh token/i, "Sua sessão expirou. Entre novamente para continuar."],
];

// Assinaturas de texto técnico que nunca devem chegar à tela.
const PADROES_TECNICOS = [
  /schema cache/i,
  /\b(relation|column|table|function|constraint|operator|type)\b.*\b(does not exist|already exists)\b/i,
  /does not exist/i,
  /\bpublic\.[a-z0-9_]+/i,
  /\b(select|insert|update|delete)\b.*\b(from|into|set|where)\b/i,
  /syntax error/i,
  /duplicate key value|violates .*constraint|foreign key|not-null/i,
  /permission denied/i,
  /row-level security|rls\b/i,
  /postgrest|pgrst|supabase|postgres|sql\b/i,
  /jwt|bearer|api key|apikey/i,
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|AbortError)\b/,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/, // linha de stack trace
  /\bundefined is not\b|\bis not a function\b|cannot read propert/i,
  /^\s*\{[\s\S]*\}\s*$/, // JSON cru
];

// Sinais de que o texto foi escrito para o usuário (nossas próprias mensagens).
const PADROES_AMIGAVEIS = [
  /[áàâãéêíóôõúüç]/i,
  /\b(nao|preencha|informe|selecione|senha|filtro|conta|valor|usuario|tarefa|registro|sessao|nome)\b/i,
];

function textoDoErro(erro) {
  if (typeof erro === "string") return erro.trim();
  const bruto =
    erro?.message ?? erro?.error_description ?? erro?.msg ?? erro?.error ?? erro?.details ?? "";
  const texto = typeof bruto === "string" ? bruto : "";
  // Se vier um stack trace junto, fica só com a primeira linha.
  return texto.split("\n")[0].trim();
}

function ehFalhaDeRede(erro, texto) {
  return (
    /failed to fetch|networkerror|network request failed|load failed|fetch event|timeout|ecconnreset|offline/i.test(texto) ||
    erro?.name === "AbortError" ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  );
}

function ehTecnico(erro, texto) {
  // Erro vindo do Postgres/PostgREST: tem code/details/hint e nunca é para a tela.
  if (erro && typeof erro === "object" && (erro.details || erro.hint || erro.code)) return true;
  if (PADROES_TECNICOS.some((padrao) => padrao.test(texto))) return true;
  // Sobrou texto sem cara de mensagem em português: trata como técnico.
  return !PADROES_AMIGAVEIS.some((padrao) => padrao.test(texto));
}

/**
 * Mensagem que pode ser mostrada ao usuário.
 *
 * @param erro qualquer coisa capturada num catch (Error, erro do Supabase, texto)
 * @param mensagemPadrao o que dizer quando a falha é técnica -- escreva algo do
 *        contexto da tela, ex: "Não foi possível carregar seus filtros salvos."
 */
export function mensagemAmigavel(erro, mensagemPadrao = MENSAGEM_GENERICA) {
  const padrao = String(mensagemPadrao || MENSAGEM_GENERICA);
  if (erro === null || erro === undefined) return padrao;

  registrarDetalhe(erro);

  // Mensagem escrita pela aplicação: sai como está.
  if (erro?.amigavel === true) return erro.message || padrao;

  const texto = textoDoErro(erro);

  if (ehFalhaDeRede(erro, texto)) {
    return "Sem conexão com o servidor agora. Verifique sua internet e tente novamente.";
  }

  const traducao = TRADUCOES.find(([padraoTexto]) => padraoTexto.test(texto));
  if (traducao) return traducao[1];

  const codigo = String(erro?.code ?? erro?.status ?? "");
  if (MENSAGENS_POR_CODIGO[codigo]) return MENSAGENS_POR_CODIGO[codigo];

  if (!texto) return padrao;
  return ehTecnico(erro, texto) ? padrao : texto;
}

/** Guarda o erro original no console, para quem for investigar depois. */
function registrarDetalhe(erro) {
  if (typeof console === "undefined") return;
  try {
    console.warn("[erro tratado]", erro);
  } catch {
    // console indisponível: não há o que fazer.
  }
}

/**
 * Executa uma operação assíncrona sem deixar a falha estourar na tela.
 * Devolve { ok, dados, erro } com `erro` já pronto para exibição, para que uma
 * consulta secundária (filtros salvos, por exemplo) falhe sem levar o resto da
 * tela junto.
 */
export async function comTratamento(operacao, mensagemPadrao) {
  try {
    return { ok: true, dados: await operacao(), erro: null };
  } catch (e) {
    return { ok: false, dados: null, erro: mensagemAmigavel(e, mensagemPadrao) };
  }
}
