// Camada de dados do cadastro de SERVIDORES do módulo Processos.
//
// ⚠️ ESTE ARQUIVO NÃO TOCA NO CADASTRO DE FORNECEDORES. Confira por busca: a
// única tabela escrita aqui é processos_servidores (mais auditoria_eventos), e
// as únicas lidas fora dela são secretarias e usuarios. `fornecedores` não
// aparece -- servidor não é fornecedor, e um cadastro nunca escreve no outro.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Cadastrar, editar, inativar e
// reativar servidor NÃO debitam conta, NÃO dão baixa em NF, NÃO alteram saldo,
// NÃO marcam fornecedor como pago, NÃO criam pagamento e NÃO alteram a
// Programação Diária.

import { supabase } from "./supabaseClient.js";
import { registrarEvento } from "./auditoria.js";
import {
  ACOES_AUDITORIA_SERVIDORES,
  MODULO_SERVIDORES,
  TABELA_SERVIDORES,
  cpfEmUso,
  diferencaDoServidor,
  mensagemDeCpfDuplicado,
  servidorParaBanco,
  somenteDigitos,
} from "./processosServidores.js";

/* -------------------------------------------------------------------------
 * Banco sem a migration deste envio
 * ---------------------------------------------------------------------- */

/**
 * true quando o erro é "o cadastro de servidores não existe neste banco".
 *
 * A migration é rodada à mão no SQL Editor do Supabase, então existe a janela
 * entre o deploy e a execução dela. Nela a tela mostra o recado da migration em
 * vez de um erro técnico -- e nenhum outro módulo é afetado.
 */
export function estruturaDeServidoresAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) {
    return true;
  }
  const mensagem = String(erro?.message ?? "");
  if (/schema cache/i.test(mensagem)) return true;
  return mensagem.includes(TABELA_SERVIDORES);
}

/** true quando o banco recusou por permissão (RLS ou o gatilho do cadastro). */
export function semPermissaoDeServidores(erro) {
  const codigo = String(erro?.code ?? "");
  if (codigo === "42501" || codigo === "P0001") return true;
  return /row-level security|permissão|permissao|Sem permissão/i.test(String(erro?.message ?? ""));
}

/**
 * true quando o banco recusou por CPF repetido (o índice único por dígitos).
 *
 * A tela avisa antes, com o nome de quem já usa o CPF. Este é o caso da corrida
 * -- duas pessoas cadastrando o mesmo CPF ao mesmo tempo -- em que a trava final
 * do banco é a que decide.
 */
export function cpfDuplicadoNoBanco(erro) {
  if (String(erro?.code ?? "") !== "23505") return false;
  const texto = `${erro?.message ?? ""} ${erro?.details ?? ""}`;
  return /cpf/i.test(texto);
}

/* -------------------------------------------------------------------------
 * Quem está gravando
 * ---------------------------------------------------------------------- */

let usuarioEmCache = null;

/** O id em public.usuarios de quem está na sessão (não o id do auth). */
async function usuarioAtualId() {
  if (usuarioEmCache) return usuarioEmCache;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  const { data, error } = await supabase
    .from("usuarios")
    .select("id")
    .eq("auth_id", auth.user.id)
    .limit(1);
  if (error) return null;

  usuarioEmCache = data?.[0]?.id ?? null;
  return usuarioEmCache;
}

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

const COLUNAS = [
  "id", "nome", "cpf", "endereco", "matricula", "cargo", "secretaria_id", "lotacao",
  "categoria_diaria", "telefone", "email",
  "banco", "agencia", "conta", "pix", "pix_titular",
  "situacao", "inativado_em", "motivo_inativacao",
  "criado_em", "atualizado_em",
].join(",");

const SELECAO = `${COLUNAS}, secretaria:secretarias ( id, nome )`;

/**
 * Os servidores do cadastro -- ATIVOS E INATIVOS.
 *
 * O inativo APARECE na lista, e é de propósito: a exclusão é lógica, processos
 * antigos continuam apontando para ele, e quem procura precisa saber que a
 * pessoa existe no cadastro (inclusive para reativá-la em vez de duplicá-la).
 * A tela filtra por situação quando quem usa quiser ver só os ativos.
 */
export async function carregarServidores() {
  const { data, error } = await supabase
    .from(TABELA_SERVIDORES)
    .select(SELECAO)
    .order("nome", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Um servidor, para abrir o cadastro dele direto. */
export async function carregarServidor(id) {
  const { data, error } = await supabase.from(TABELA_SERVIDORES).select(SELECAO).eq("id", id).single();
  if (error) throw error;
  return data;
}

/* -------------------------------------------------------------------------
 * Auditoria
 * ---------------------------------------------------------------------- */

/** Como o servidor aparece na trilha de auditoria. */
function identificacaoDoServidor(servidor) {
  const nome = String(servidor?.nome ?? "").trim() || "servidor";
  const cpf = somenteDigitos(servidor?.cpf);
  return cpf === "" ? nome : `${nome} (CPF ${cpf})`;
}

/**
 * Registra criação, alteração e inativação na auditoria do sistema.
 *
 * Guarda QUEM, QUANDO, o valor ANTERIOR e o NOVO -- é o que permite responder
 * "quem mudou o CPF deste servidor, e quando". Como no resto do sistema, a
 * trilha nunca derruba a ação principal.
 */
async function registrarNaAuditoria({ acao, servidor, anterior = null, novo = null, nivel = "informacao", usuarioId = null }) {
  try {
    await registrarEvento({
      modulo: MODULO_SERVIDORES,
      acao,
      registroAfetado: identificacaoDoServidor(servidor),
      valorAnterior: anterior,
      valorNovo: novo,
      nivel,
      usuarioId: usuarioId ?? (await usuarioAtualId()),
    });
  } catch (falha) {
    console.error("[Processos · Servidores] A auditoria desta ação não pôde ser gravada.", falha);
  }
}

/* -------------------------------------------------------------------------
 * Conferência do CPF antes de gravar
 * ---------------------------------------------------------------------- */

/**
 * Recusa o CPF repetido ANTES de gravar, dizendo DE QUEM ele é.
 *
 * A consulta é por DÍGITOS, no banco: não depende do que a lista da tela tem em
 * memória, então pega também o cadastro que outra pessoa acabou de criar. O
 * índice único da migration é a trava final; esta é a mensagem clara.
 */
async function recusarCpfRepetido(cpf, { ignorarId = null } = {}) {
  const numeros = somenteDigitos(cpf);
  if (numeros === "") return;

  const { data, error } = await supabase
    .from(TABELA_SERVIDORES)
    .select("id, nome, cpf, cargo, situacao");
  // Falha de leitura não impede a gravação: o banco ainda recusa o duplicado
  // pelo índice único, e a tela traduz esse erro.
  if (error) return;

  const conflito = cpfEmUso(data ?? [], cpf, { ignorarId });
  if (conflito) {
    const falha = new Error(mensagemDeCpfDuplicado(conflito));
    falha.code = "CPF_DUPLICADO";
    throw falha;
  }
}

/* -------------------------------------------------------------------------
 * Gravação
 * ---------------------------------------------------------------------- */

/**
 * Cria o servidor no cadastro.
 *
 * Nasce ATIVO. Isto grava SÓ em processos_servidores: nenhum fornecedor é
 * criado, nenhum fornecedor é alterado, e nada financeiro acontece.
 */
export async function criarServidor(formulario) {
  const autor = await usuarioAtualId();
  await recusarCpfRepetido(formulario?.cpf);

  const linha = {
    ...servidorParaBanco(formulario),
    situacao: "ativo",
    criado_por: autor,
    atualizado_por: autor,
  };

  const { data, error } = await supabase.from(TABELA_SERVIDORES).insert(linha).select(SELECAO).single();
  if (error) {
    if (cpfDuplicadoNoBanco(error)) {
      const falha = new Error(
        "Este CPF já está cadastrado em outro servidor. Abra a lista e procure pelo CPF para ver de quem é.",
      );
      falha.code = "CPF_DUPLICADO";
      throw falha;
    }
    throw error;
  }

  await registrarNaAuditoria({
    acao: ACOES_AUDITORIA_SERVIDORES.criar,
    servidor: data,
    novo: linha,
    usuarioId: autor,
  });

  return data;
}

/**
 * Salva a edição do cadastro.
 *
 * `situacao` NÃO é gravada aqui: mudar a situação é inativar ou reativar, tem
 * permissão própria e caminho próprio. A auditoria guarda o antes e o depois de
 * cada campo que mudou.
 */
export async function salvarServidor(id, formulario, { anterior = null } = {}) {
  const autor = await usuarioAtualId();
  await recusarCpfRepetido(formulario?.cpf, { ignorarId: id });

  const linha = {
    ...servidorParaBanco(formulario),
    atualizado_em: new Date().toISOString(),
    atualizado_por: autor,
  };

  const { data, error } = await supabase
    .from(TABELA_SERVIDORES)
    .update(linha)
    .eq("id", id)
    .select(SELECAO)
    .single();
  if (error) {
    if (cpfDuplicadoNoBanco(error)) {
      const falha = new Error(
        "Este CPF já está cadastrado em outro servidor. Abra a lista e procure pelo CPF para ver de quem é.",
      );
      falha.code = "CPF_DUPLICADO";
      throw falha;
    }
    throw error;
  }

  const mudancas = diferencaDoServidor(anterior, data);
  if (Object.keys(mudancas).length > 0) {
    await registrarNaAuditoria({
      acao: ACOES_AUDITORIA_SERVIDORES.editar,
      servidor: data,
      anterior: Object.fromEntries(Object.entries(mudancas).map(([campo, v]) => [campo, v.de])),
      novo: Object.fromEntries(Object.entries(mudancas).map(([campo, v]) => [campo, v.para])),
      usuarioId: autor,
    });
  }

  return data;
}

/**
 * INATIVA o servidor -- a "exclusão" deste cadastro.
 *
 * ⚠️ A LINHA NUNCA É APAGADA. Processos antigos apontam para ela, e apagá-la
 * quebraria documento já emitido. O servidor inativo só deixa de ser oferecido
 * para novos processos; os antigos continuam íntegros, com o nome, o CPF e o
 * cargo que já estão gravados neles.
 */
export async function inativarServidor(id, { motivo = "", anterior = null } = {}) {
  const autor = await usuarioAtualId();

  const { data, error } = await supabase
    .from(TABELA_SERVIDORES)
    .update({
      situacao: "inativo",
      inativado_em: new Date().toISOString(),
      inativado_por: autor,
      motivo_inativacao: String(motivo ?? "").trim() || null,
      atualizado_em: new Date().toISOString(),
      atualizado_por: autor,
    })
    .eq("id", id)
    .select(SELECAO)
    .single();
  if (error) throw error;

  await registrarNaAuditoria({
    acao: ACOES_AUDITORIA_SERVIDORES.inativar,
    servidor: data,
    anterior: { situacao: anterior?.situacao ?? "ativo" },
    novo: { situacao: "inativo", motivo_inativacao: data?.motivo_inativacao ?? null },
    nivel: "atencao",
    usuarioId: autor,
  });

  return data;
}

/** REATIVA o servidor inativado. O cadastro volta a ser oferecido nos processos. */
export async function reativarServidor(id, { anterior = null } = {}) {
  const autor = await usuarioAtualId();

  const { data, error } = await supabase
    .from(TABELA_SERVIDORES)
    .update({
      situacao: "ativo",
      inativado_em: null,
      inativado_por: null,
      motivo_inativacao: null,
      atualizado_em: new Date().toISOString(),
      atualizado_por: autor,
    })
    .eq("id", id)
    .select(SELECAO)
    .single();
  if (error) throw error;

  await registrarNaAuditoria({
    acao: ACOES_AUDITORIA_SERVIDORES.reativar,
    servidor: data,
    anterior: { situacao: anterior?.situacao ?? "inativo" },
    novo: { situacao: "ativo" },
    nivel: "atencao",
    usuarioId: autor,
  });

  return data;
}
