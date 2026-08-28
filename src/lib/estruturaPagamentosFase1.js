// Verificação de estrutura da Fase 1 dos Pagamentos Diários.
//
// Por que este arquivo existe: a tela decidia "a estrutura não existe" olhando o
// TEXTO do erro. Qualquer falha cuja mensagem, detalhe ou dica contivesse a
// palavra "status" ou "ativa" virava o aviso de migration -- inclusive falha de
// permissão, sessão expirada ou erro de relacionamento. E, no outro sentido, o
// aviso nunca dizia QUAL objeto faltava, então não havia como saber se ele
// estava certo ou errado sem abrir o banco.
//
// Aqui a decisão passa a ter três garantias:
//
//  1. Classificação por CÓDIGO, não por texto. Só os códigos que o Postgres e o
//     PostgREST usam para "objeto inexistente" viram "estrutura ausente".
//     42501 (permissão/RLS) e PGRST301 (sessão) nunca viram -- são outra coisa.
//
//  2. Imune a RLS. A sonda é um `select ... limit=0`: o PostgREST valida os
//     nomes das colunas antes de aplicar a policy, então coluna que existe
//     devolve `error: null` mesmo quando a policy não libera nenhuma linha.
//     Resultado vazio NUNCA é lido como estrutura ausente.
//
//  3. Diz o nome do objeto. Quando a consulta com todas as colunas falha, cada
//     coluna é sondada isoladamente para montar a lista exata do que falta.
//
// As duas funções (RPC) da Fase 1 não são sondadas de propósito: chamá-las
// gravaria dados. A ausência delas é classificada quando a tela realmente as
// chama -- PGRST202/42883, que significam "não existe função com esses nomes de
// parâmetro", ou seja, função ausente OU assinatura diferente da esperada.
//
// O cliente Supabase entra por parâmetro (a tela passa o dela), para este
// arquivo continuar testável fora do navegador.

/** Colunas que a tela de Pagamentos Diários precisa ler e gravar. */
export const ESTRUTURA_FASE_1 = [
  {
    tabela: "programacoes_pagamento",
    colunas: ["status", "saldo_considerado", "total_programado", "restante", "updated_at", "ultima_impressao_em"],
  },
  { tabela: "programacao_contas", colunas: ["saldo_considerado", "ativa", "ordem"] },
  { tabela: "pagamentos", colunas: ["cadastrar_fornecedor_posteriormente"] },
];

/** Assinaturas exatas esperadas pelas chamadas de RPC da tela. */
export const FUNCOES_FASE_1 = [
  {
    nome: "salvar_planejamento_programacao",
    assinatura:
      "(p_programacao_id integer, p_contas jsonb, p_pagamentos jsonb, p_saldo_considerado numeric, p_total_programado numeric, p_restante numeric)",
  },
  { nome: "marcar_programacao_em_analise", assinatura: "(p_programacao_id integer)" },
];

// Códigos que significam "este objeto não existe no banco".
const CODIGOS_ESTRUTURA = {
  "42P01": "tabela", // relation does not exist
  "42703": "coluna", // column does not exist
  "42883": "funcao", // function does not exist
  PGRST200: "relacionamento", // embed sem chave estrangeira
  PGRST202: "funcao", // função/assinatura fora do schema cache
  PGRST204: "coluna", // coluna fora do schema cache
  PGRST205: "tabela", // tabela fora do schema cache
};

// Códigos que NUNCA são falta de estrutura, por mais parecido que o texto seja.
const CODIGOS_PERMISSAO = ["42501", "PGRST301", "401", "403"];

const EXTRATORES = [
  /column ([a-z0-9_."]+) does not exist/i,
  /relation "?([a-z0-9_.]+)"? does not exist/i,
  /Could not find the function (public\.[a-z0-9_]+\([^)]*\))/i,
  /function ([a-z0-9_.]+\([^)]*\)) does not exist/i,
  /Could not find the table '([^']+)'/i,
  /Could not find the '([^']+)' column/i,
  /Could not find a relationship between '([^']+)'/i,
];

function textoDaFalha(falha) {
  return `${falha?.message ?? ""} ${falha?.details ?? ""} ${falha?.hint ?? ""}`;
}

/** Nome do objeto citado pelo banco, quando dá para extrair da mensagem. */
export function objetoDaFalha(falha) {
  const texto = textoDaFalha(falha);
  for (const extrator of EXTRATORES) {
    const achado = texto.match(extrator);
    if (achado) return achado[1].replace(/"/g, "");
  }
  return null;
}

/**
 * Campos estruturados que as funções do banco mandam dentro do DETAIL.
 *
 * As funções dos Pagamentos Diários escrevem `etapa=`, `constraint=`, `tabela=`,
 * `coluna=` e `detalhe=` no DETAIL do erro, porque um `raise exception` novo
 * perde os campos estruturados do erro original. Uma violação de chave
 * estrangeira (23503) só é identificável pelo NOME da constraint, e ela chega
 * empacotada em texto: aqui cada campo volta a ser campo, para o console apontar
 * a chave exata em um único teste em vez de exigir leitura da linha inteira.
 *
 * @returns {{etapa, constraint, tabela, coluna, detalhe}} com null no que faltar.
 */
export function detalheDoBanco(falha) {
  const texto = `${falha?.details ?? ""} ${falha?.hint ?? ""} ${falha?.message ?? ""}`;
  const campo = (nome) => {
    // Para em "outra_chave=" ou no separador "|": o valor pode ter espaços
    // (etapa e detalhe têm), mas nunca invade o campo seguinte.
    const achado = texto.match(new RegExp(`${nome}=([^|]+?)(?:\\s+[a-z_]+=|\\s*\\||$)`, "i"));
    const valor = achado ? achado[1].trim() : "";
    return valor && valor !== "-" ? valor : null;
  };
  return {
    etapa: campo("etapa"),
    constraint: campo("constraint"),
    tabela: campo("tabela") ?? campo("table"),
    coluna: campo("coluna") ?? campo("column"),
    detalhe: campo("detalhe"),
  };
}

/**
 * Classifica uma falha da Fase 1 sem olhar palavras soltas da mensagem.
 *
 * @returns { tipo: "estrutura" | "permissao" | "outro", alvo, objeto, codigo }
 */
export function classificarFalhaFase1(falha) {
  const codigo = String(falha?.code ?? falha?.status ?? "");
  if (CODIGOS_PERMISSAO.includes(codigo)) {
    return { tipo: "permissao", alvo: null, objeto: null, codigo };
  }

  const alvo =
    CODIGOS_ESTRUTURA[codigo] ||
    // Sem código reconhecido: "schema cache" só aparece em erro do PostgREST
    // sobre objeto inexistente, nunca em erro de dado ou de permissão.
    (!codigo && /schema cache/i.test(textoDaFalha(falha)) ? "objeto" : null);

  if (!alvo) return { tipo: "outro", alvo: null, objeto: null, codigo };
  return { tipo: "estrutura", alvo, objeto: objetoDaFalha(falha), codigo };
}

/** Consulta de sonda: valida os nomes das colunas sem trazer nenhuma linha. */
async function sondar(cliente, tabela, colunas) {
  try {
    const { error } = await cliente.from(tabela).select(colunas.join(",")).limit(0);
    return error ?? null;
  } catch (falha) {
    return falha;
  }
}

async function conferirTabela(cliente, item) {
  const erro = await sondar(cliente, item.tabela, item.colunas);
  if (!erro) return { faltando: [], naoVerificado: [], falhas: [] };

  const classificacao = classificarFalhaFase1(erro);
  const falhas = [{ objeto: item.tabela, erro, classificacao }];

  if (classificacao.tipo !== "estrutura") {
    // Permissão, rede ou qualquer outra coisa: não dá para afirmar que falta.
    return { faltando: [], naoVerificado: [item.tabela], falhas };
  }
  if (classificacao.alvo === "tabela") {
    return { faltando: [item.tabela], naoVerificado: [], falhas };
  }

  // Alguma coluna não existe: descobre exatamente quais.
  const porColuna = await Promise.all(
    item.colunas.map(async (coluna) => {
      const erroColuna = await sondar(cliente, item.tabela, [coluna]);
      if (!erroColuna) return null;
      return { coluna, erro: erroColuna, classificacao: classificarFalhaFase1(erroColuna) };
    })
  );

  const detalhes = porColuna.filter(Boolean);
  return {
    faltando: detalhes.filter((d) => d.classificacao.tipo === "estrutura").map((d) => `${item.tabela}.${d.coluna}`),
    naoVerificado: detalhes.filter((d) => d.classificacao.tipo !== "estrutura").map((d) => `${item.tabela}.${d.coluna}`),
    falhas: [...falhas, ...detalhes.map((d) => ({ objeto: `${item.tabela}.${d.coluna}`, erro: d.erro, classificacao: d.classificacao }))],
  };
}

/**
 * Confere a estrutura da Fase 1 no banco que esta tela está usando.
 *
 * @returns {{ ok: boolean, faltando: string[], naoVerificado: string[], falhas: object[] }}
 *   `faltando` lista o que o banco afirmou não existir. `naoVerificado` lista o
 *   que não deu para conferir (permissão, rede) -- e que por isso não é acusado.
 */
export async function verificarEstruturaFase1(cliente) {
  const partes = await Promise.all(ESTRUTURA_FASE_1.map((item) => conferirTabela(cliente, item)));
  const faltando = partes.flatMap((parte) => parte.faltando);
  const naoVerificado = partes.flatMap((parte) => parte.naoVerificado);
  return {
    ok: faltando.length === 0,
    faltando,
    naoVerificado,
    falhas: partes.flatMap((parte) => parte.falhas),
  };
}
