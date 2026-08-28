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
  // 22P02 (invalid_text_representation) quase nunca é o valor que o usuário
  // digitou: na prática é uma comparação no banco entre tipos incompatíveis --
  // texto contra enum, texto contra boolean. Acusar o formato do valor mandava
  // quem usa o sistema procurar defeito onde não havia. O código sai junto para
  // poder ser relatado, e o erro completo está no console.
  "22P02":
    "O banco recusou a operação por incompatibilidade de tipo entre um valor e a coluna correspondente (código 22P02). Não é o valor que você digitou. O erro completo está no console do navegador (F12).",
  "22003": "O valor informado é maior do que o sistema aceita.",
  "42501": "Você não tem permissão para fazer isso.",
  PGRST301: "Sua sessão expirou. Entre novamente para continuar.",
  PGRST116: "O registro procurado não foi encontrado.",
  "401": "Sua sessão expirou. Entre novamente para continuar.",
  "403": "Você não tem permissão para fazer isso.",
  // Recusas da portaria das funções Netlify (netlify/functions/_shared/auth.mts).
  // Sem estas linhas o código chegava à tela e caía na genérica, porque
  // `ehTecnico` trata todo erro com `code` como texto de backend -- era mais uma
  // recusa que o usuário via como "não foi possível" e ninguém conseguia
  // localizar.
  AUTH_SEM_TOKEN: "Sua sessão expirou. Entre novamente para continuar.",
  AUTH_SESSAO_INVALIDA: "Sua sessão expirou. Entre novamente para continuar.",
  AUTH_CONFIG_AUSENTE:
    "O servidor está sem a configuração de acesso ao banco de dados (código AUTH_CONFIG_AUSENTE). Avise o responsável pelo sistema: não é nada que você tenha feito.",
  AUTH_SEM_CADASTRO:
    "Seu acesso não está vinculado a um cadastro de usuário que o sistema consiga ler (código AUTH_SEM_CADASTRO). Peça ao administrador para conferir o seu cadastro.",
  AUTH_SEM_PERMISSAO_ESPECIAL: "Você não tem permissão para fazer isso.",
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

// Códigos com que as funções deste sistema falam com quem usa a tela: P0001 é o
// `raise exception 'texto'` sem errcode, e 42501 é usado com texto próprio nas
// recusas por permissão.
const CODIGOS_DE_MENSAGEM_ESCRITA = new Set(["P0001", "42501"]);

/**
 * Mensagem redigida em português dentro de uma função do banco.
 *
 * As funções da aplicação levantam `raise exception` com frases escritas para o
 * usuário ("Não é possível aprovar uma programação sem fornecedores."). Como
 * todo erro do PostgREST carrega `code`, `ehTecnico` classificava essas frases
 * como texto de backend e as trocava pela mensagem genérica da tela -- o usuário
 * recebia uma explicação inventada em vez do motivo real da recusa. Aqui elas
 * voltam a passar, mas só quando o código é de mensagem escrita e o texto tem
 * cara de português para pessoas, sem nenhuma assinatura técnica.
 */
function mensagemEscritaNoBanco(erro, texto) {
  if (!texto) return null;
  const codigo = String(erro?.code ?? "");
  if (!CODIGOS_DE_MENSAGEM_ESCRITA.has(codigo)) return null;
  if (PADROES_TECNICOS.some((padrao) => padrao.test(texto))) return null;
  if (!PADROES_AMIGAVEIS.some((padrao) => padrao.test(texto))) return null;
  return texto;
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

  const escritaNoBanco = mensagemEscritaNoBanco(erro, texto);
  if (escritaNoBanco) return escritaNoBanco;

  const codigo = String(erro?.code ?? erro?.status ?? "");
  if (MENSAGENS_POR_CODIGO[codigo]) return MENSAGENS_POR_CODIGO[codigo];

  if (!texto) return padrao;
  return ehTecnico(erro, texto) ? padrao : texto;
}

/**
 * Guarda o erro original no console, para quem for investigar depois.
 *
 * O objeto de erro do Supabase aparece no console como `{}` em alguns
 * navegadores, porque `code`, `details` e `hint` não são enumeráveis na hora de
 * imprimir. Por isso os campos são copiados um a um: sem eles não há como saber
 * qual foi a recusa do banco por trás da mensagem mostrada na tela.
 */
function registrarDetalhe(erro) {
  if (typeof console === "undefined") return;
  try {
    const detalhe =
      erro && typeof erro === "object"
        ? {
            code: erro.code ?? null,
            message: erro.message ?? null,
            details: erro.details ?? null,
            hint: erro.hint ?? null,
            status: erro.status ?? null,
          }
        : { message: String(erro) };
    console.error("[erro tratado]", detalhe, erro);
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
