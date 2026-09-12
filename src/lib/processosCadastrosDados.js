// Camada de dados dos CADASTROS PRÓPRIOS do módulo Processos:
// SECRETARIAS SOLICITANTES, BANCOS e a PREFEITA (chefe do Poder Executivo).
//
// ⚠️ CONFIRA POR BUSCA. As únicas tabelas escritas aqui são
// processos_secretarias_solicitantes, processos_bancos, processos_prefeita e
// auditoria_eventos.
// NÃO aparecem neste arquivo: `secretarias`, `contas_bancarias`, `fornecedores`,
// `pagamentos`, `pagamentos_baixas`, `valores_em_aberto`, `saldos_historico`,
// `transferencias_contas` nem `programacoes_pagamento`. O cadastro de
// secretarias do MÓDULO FINANCEIRO segue intocado, e os dois cadastros
// coexistem, cada um com a sua finalidade.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO: nada aqui debita conta, dá baixa em
// NF, altera saldo, marca fornecedor como pago ou cria pagamento.

import { supabase } from "./supabaseClient.js";
import { registrarEvento } from "./auditoria.js";
import { MODULO_DIARIAS } from "./processosDiarias.js";
import {
  TABELA_SOLICITANTES,
  diferencaDoSolicitante,
  nomeOficialDoSolicitante,
  solicitanteParaBanco,
} from "./processosSecretariasSolicitantes.js";
import {
  TABELA_BANCOS,
  bancoParaBanco,
  diferencaDoBanco,
  numeroDoBancoFormatado,
  rotuloDoBanco,
} from "./processosBancos.js";
import {
  TABELA_PREFEITA,
  diferencaDaPrefeita,
  prefeitaParaBanco,
} from "./processosPrefeita.js";

/* -------------------------------------------------------------------------
 * Banco sem a migration deste envio
 * ---------------------------------------------------------------------- */

const CODIGOS_DE_ESTRUTURA = ["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"];

/**
 * true quando o erro é "este cadastro ainda não existe neste banco".
 *
 * A migration é rodada à mão no SQL Editor do Supabase, então existe a janela
 * entre o deploy e a execução dela. Nela a tela mostra o recado da migration em
 * vez de um erro técnico, e nenhum outro módulo é afetado.
 */
export function estruturaDeCadastroAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (CODIGOS_DE_ESTRUTURA.includes(codigo)) return true;
  const mensagem = String(erro?.message ?? "");
  if (/schema cache/i.test(mensagem)) return true;
  return (
    mensagem.includes(TABELA_SOLICITANTES)
    || mensagem.includes(TABELA_BANCOS)
    || mensagem.includes(TABELA_PREFEITA)
  );
}

/** true quando o banco recusou por permissão (a RLS dos cadastros). */
export function semPermissaoDeCadastro(erro) {
  const codigo = String(erro?.code ?? "");
  if (codigo === "42501" || codigo === "P0001") return true;
  return /row-level security|permissão|permissao/i.test(String(erro?.message ?? ""));
}

/** true quando o banco recusou por repetição (o índice único do cadastro). */
export function registroDuplicadoNoBanco(erro) {
  return String(erro?.code ?? "") === "23505";
}

/* -------------------------------------------------------------------------
 * O ESTADO EXPLÍCITO de cada leitura de cadastro
 * ---------------------------------------------------------------------- */

/**
 * O que uma leitura de cadastro devolve.
 *
 * ⚠️ POR QUE NÃO É UM ARRAY. Enquanto era, a tela não tinha como diferenciar as
 * duas situações que produzem a MESMA lista vazia:
 *
 *   - a estrutura ainda não existe neste banco (a migration é rodada à mão no
 *     SQL Editor do Supabase) -- aí o recado da migration é o certo;
 *   - a estrutura existe e simplesmente NÃO TEM NENHUM REGISTRO ainda -- aí o
 *     certo é o convite a cadastrar o primeiro, e um aviso vermelho de migration
 *     seria mentira.
 *
 * Por isso o estado vem nomeado: `registros` é sempre um array (a tela nunca
 * quebra), `estruturaAusente` diz qual das duas situações é, e `erro` guarda a
 * falha técnica de verdade para quem quiser mostrá-la.
 */
function estadoDoCadastro({ registros = [], estruturaAusente = false, erro = null } = {}) {
  return { registros, estruturaAusente, erro };
}

/**
 * Registra a falha TÉCNICA REAL no console do navegador.
 *
 * A tela mostra um recado em português; o motivo exato -- código, mensagem e
 * detalhe devolvidos pelo banco -- fica aqui, porque é ele que resolve o
 * atendimento. Antes o erro era engolido em silêncio e a tela acusava migration
 * pendente mesmo quando o problema era outro.
 */
function registrarFalhaDeCadastro(tabela, erro) {
  console.error(
    `[Processos] A leitura de ${tabela} falhou.`,
    {
      codigo: erro?.code ?? null,
      mensagem: erro?.message ?? null,
      detalhe: erro?.details ?? null,
      dica: erro?.hint ?? null,
    },
    erro,
  );
}

/**
 * Os registros de uma leitura, para quem só quer a lista.
 *
 * Aceita também o array puro, para o código que ainda chama do jeito antigo.
 */
export function registrosDoCadastro(estado) {
  if (Array.isArray(estado)) return estado;
  return estado?.registros ?? [];
}

/* -------------------------------------------------------------------------
 * Quem está gravando
 * ---------------------------------------------------------------------- */

let usuarioEmCache;

async function usuarioAtualId() {
  if (usuarioEmCache !== undefined) return usuarioEmCache;

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return null;

  const { data, error } = await supabase.from("usuarios").select("id").eq("auth_id", auth.user.id).limit(1);
  if (error) return null;

  usuarioEmCache = data?.[0]?.id ?? null;
  return usuarioEmCache;
}

async function auditar({ acao, registro, anterior = null, novo = null }) {
  try {
    await registrarEvento({
      modulo: MODULO_DIARIAS,
      acao,
      registroAfetado: registro,
      valorAnterior: anterior,
      valorNovo: novo,
      nivel: "informacao",
      usuarioId: await usuarioAtualId(),
    });
  } catch (falha) {
    console.error("[Processos] A auditoria desta ação não pôde ser gravada.", falha);
  }
}

/* -------------------------------------------------------------------------
 * SECRETARIAS SOLICITANTES
 * ---------------------------------------------------------------------- */

const COLUNAS_SOLICITANTE = [
  "id", "nome", "nome_curto", "secretario", "secretario_cpf", "secretario_cargo",
  "situacao", "criado_em", "atualizado_em",
].join(",");

/**
 * As secretarias SOLICITANTES cadastradas.
 *
 * Devolve o ESTADO da leitura -- `{ registros, estruturaAusente, erro }` --, e
 * não um array solto: cadastro vazio e estrutura ausente produzem a mesma lista
 * vazia, e só a tela sabe o que dizer em cada caso.
 *
 * Com a estrutura ausente o módulo continua abrindo, e os processos já criados
 * continuam mostrando a secretaria que gravaram.
 */
export async function carregarSolicitantes({ apenasAtivas = false } = {}) {
  let consulta = supabase.from(TABELA_SOLICITANTES).select(COLUNAS_SOLICITANTE).order("nome");
  if (apenasAtivas) consulta = consulta.eq("situacao", "ativo");

  const { data, error } = await consulta;
  if (error) {
    registrarFalhaDeCadastro(TABELA_SOLICITANTES, error);
    if (estruturaDeCadastroAusente(error)) {
      return estadoDoCadastro({ estruturaAusente: true, erro: error });
    }
    throw error;
  }
  return estadoDoCadastro({ registros: data ?? [] });
}

export async function criarSolicitante(formulario) {
  const autor = await usuarioAtualId();
  const linha = {
    ...solicitanteParaBanco(formulario),
    situacao: "ativo",
    criado_por: autor,
    atualizado_por: autor,
  };

  const { data, error } = await supabase
    .from(TABELA_SOLICITANTES)
    .insert(linha)
    .select(COLUNAS_SOLICITANTE)
    .single();
  if (error) throw error;

  await auditar({ acao: "criar_secretaria_solicitante", registro: nomeOficialDoSolicitante(data), novo: linha });
  return data;
}

/**
 * Salva a edição do cadastro.
 *
 * ⚠️ Isto NÃO reescreve documento antigo. O processo finalizado guardou dentro
 * dele o nome da secretaria e os dados do secretário vigentes no momento; trocar
 * o secretário aqui vale para os processos daqui para a frente.
 */
export async function salvarSolicitante(id, formulario, { anterior = null } = {}) {
  const autor = await usuarioAtualId();
  const linha = {
    ...solicitanteParaBanco(formulario),
    atualizado_em: new Date().toISOString(),
    atualizado_por: autor,
  };

  const { data, error } = await supabase
    .from(TABELA_SOLICITANTES)
    .update(linha)
    .eq("id", id)
    .select(COLUNAS_SOLICITANTE)
    .single();
  if (error) throw error;

  const mudou = diferencaDoSolicitante(anterior, data);
  await auditar({
    acao: "editar_secretaria_solicitante",
    registro: nomeOficialDoSolicitante(data),
    anterior: mudou.anterior,
    novo: mudou.novo,
  });
  return data;
}

/**
 * Inativa ou reativa a secretaria solicitante.
 *
 * A exclusão é LÓGICA: a linha nunca é apagada, porque processos antigos
 * apontam para ela. Inativada, ela para de aparecer para escolha e continua
 * aparecendo nos processos que já a usaram.
 */
export async function alternarSituacaoDoSolicitante(id, situacao, { anterior = null } = {}) {
  const autor = await usuarioAtualId();
  const { data, error } = await supabase
    .from(TABELA_SOLICITANTES)
    .update({ situacao, atualizado_em: new Date().toISOString(), atualizado_por: autor })
    .eq("id", id)
    .select(COLUNAS_SOLICITANTE)
    .single();
  if (error) throw error;

  await auditar({
    acao: situacao === "inativo" ? "inativar_secretaria_solicitante" : "reativar_secretaria_solicitante",
    registro: nomeOficialDoSolicitante(data),
    anterior: { situacao: anterior?.situacao ?? null },
    novo: { situacao },
  });
  return data;
}

/* -------------------------------------------------------------------------
 * BANCOS
 * ---------------------------------------------------------------------- */

const COLUNAS_BANCO = ["id", "numero", "nome", "situacao", "criado_em", "atualizado_em"].join(",");

/**
 * Os bancos cadastrados, em ordem de número.
 *
 * Devolve o ESTADO da leitura -- `{ registros, estruturaAusente, erro }` --,
 * pelo mesmo motivo das solicitantes: "ainda não existe a estrutura" e "existe e
 * está vazia" são coisas diferentes, e a tela precisa distingui-las.
 *
 * A lista é REFERÊNCIA PÚBLICA -- só número e nome --, lida por qualquer pessoa
 * autenticada: ela alimenta a escolha do banco em todo o sistema, e não apenas
 * nos documentos.
 */
export async function carregarBancos({ apenasAtivos = false } = {}) {
  let consulta = supabase.from(TABELA_BANCOS).select(COLUNAS_BANCO).order("numero");
  if (apenasAtivos) consulta = consulta.eq("situacao", "ativo");

  const { data, error } = await consulta;
  if (error) {
    registrarFalhaDeCadastro(TABELA_BANCOS, error);
    if (estruturaDeCadastroAusente(error)) {
      return estadoDoCadastro({ estruturaAusente: true, erro: error });
    }
    throw error;
  }
  return estadoDoCadastro({ registros: data ?? [] });
}

export async function criarBanco(formulario) {
  const autor = await usuarioAtualId();
  const linha = {
    ...bancoParaBanco(formulario),
    situacao: "ativo",
    criado_por: autor,
    atualizado_por: autor,
  };

  const { data, error } = await supabase.from(TABELA_BANCOS).insert(linha).select(COLUNAS_BANCO).single();
  if (error) {
    if (registroDuplicadoNoBanco(error)) {
      const falha = new Error(
        `Já existe um banco cadastrado com o número ${numeroDoBancoFormatado(formulario?.numero)}.`,
      );
      falha.code = "BANCO_DUPLICADO";
      throw falha;
    }
    throw error;
  }

  await auditar({ acao: "criar_banco_processos", registro: rotuloDoBanco(data), novo: linha });
  return data;
}

export async function salvarBanco(id, formulario, { anterior = null } = {}) {
  const autor = await usuarioAtualId();
  const linha = {
    ...bancoParaBanco(formulario),
    atualizado_em: new Date().toISOString(),
    atualizado_por: autor,
  };

  const { data, error } = await supabase
    .from(TABELA_BANCOS)
    .update(linha)
    .eq("id", id)
    .select(COLUNAS_BANCO)
    .single();
  if (error) {
    if (registroDuplicadoNoBanco(error)) {
      const falha = new Error(
        `Já existe um banco cadastrado com o número ${numeroDoBancoFormatado(formulario?.numero)}.`,
      );
      falha.code = "BANCO_DUPLICADO";
      throw falha;
    }
    throw error;
  }

  const mudou = diferencaDoBanco(anterior, data);
  await auditar({
    acao: "editar_banco_processos",
    registro: rotuloDoBanco(data),
    anterior: mudou.anterior,
    novo: mudou.novo,
  });
  return data;
}

/**
 * Inativa ou reativa o banco.
 *
 * ⚠️ Exclusão LÓGICA, e por um motivo forte: o número e o nome do banco ficam
 * GRAVADOS COMO TEXTO no cadastro do servidor e no processo. Inativar aqui tira
 * o banco da lista de escolha e não altera nenhum documento já emitido.
 */
export async function alternarSituacaoDoBanco(id, situacao, { anterior = null } = {}) {
  const autor = await usuarioAtualId();
  const { data, error } = await supabase
    .from(TABELA_BANCOS)
    .update({ situacao, atualizado_em: new Date().toISOString(), atualizado_por: autor })
    .eq("id", id)
    .select(COLUNAS_BANCO)
    .single();
  if (error) throw error;

  await auditar({
    acao: situacao === "inativo" ? "inativar_banco_processos" : "reativar_banco_processos",
    registro: rotuloDoBanco(data),
    anterior: { situacao: anterior?.situacao ?? null },
    novo: { situacao },
  });
  return data;
}

/* -------------------------------------------------------------------------
 * A PREFEITA — chefe do Poder Executivo
 * ---------------------------------------------------------------------- */

const COLUNAS_PREFEITA = [
  "id", "nome", "cpf", "cargo", "vigencia_inicio", "vigencia_fim",
  "situacao", "criado_em", "atualizado_em",
].join(",");

/**
 * Os cadastros da prefeita, do mais recente para o mais antigo.
 *
 * A lista é histórica de propósito: mudança de gestão entra como LINHA NOVA, e a
 * anterior continua no cadastro. Processos já finalizados não dependem desta
 * consulta -- eles imprimem o que congelaram.
 *
 * Devolve o ESTADO da leitura -- `{ registros, estruturaAusente, erro }` --, para
 * a tela saber se o cadastro está vazio ou se a estrutura ainda não existe neste
 * banco. Nos dois casos o módulo continua abrindo, e os documentos saem com a
 * identificação em branco, como antes.
 */
export async function carregarPrefeitas({ apenasAtivas = false } = {}) {
  let consulta = supabase
    .from(TABELA_PREFEITA)
    .select(COLUNAS_PREFEITA)
    .order("vigencia_inicio", { ascending: false, nullsFirst: false })
    .order("criado_em", { ascending: false });
  if (apenasAtivas) consulta = consulta.eq("situacao", "ativo");

  const { data, error } = await consulta;
  if (error) {
    registrarFalhaDeCadastro(TABELA_PREFEITA, error);
    if (estruturaDeCadastroAusente(error)) {
      return estadoDoCadastro({ estruturaAusente: true, erro: error });
    }
    throw error;
  }
  return estadoDoCadastro({ registros: data ?? [] });
}

/**
 * Cadastra a prefeita.
 *
 * ⚠️ NÃO altera documento nenhum: quem já foi finalizado guardou dentro de si a
 * identificação que imprimiu. Este cadastro vale para os processos daqui para a
 * frente.
 */
export async function criarPrefeita(formulario) {
  const autor = await usuarioAtualId();
  const linha = {
    ...prefeitaParaBanco(formulario),
    criado_por: autor,
    atualizado_por: autor,
  };

  const { data, error } = await supabase
    .from(TABELA_PREFEITA)
    .insert(linha)
    .select(COLUNAS_PREFEITA)
    .single();
  if (error) throw error;

  await auditar({ acao: "cadastrar_prefeita", registro: data?.nome ?? "", novo: linha });
  return data;
}

/**
 * Salva a edição do cadastro da prefeita.
 *
 * ⚠️ ISTO NUNCA REESCREVE DOCUMENTO FINALIZADO. O processo finalizado gravou o
 * nome, o CPF e o cargo vigentes no ato da finalização, e o gatilho do banco
 * recusa qualquer reescrita desse congelamento. Mudança de gestão vale para os
 * processos seguintes.
 */
export async function salvarPrefeita(id, formulario, { anterior = null } = {}) {
  const autor = await usuarioAtualId();
  const linha = {
    ...prefeitaParaBanco(formulario),
    atualizado_em: new Date().toISOString(),
    atualizado_por: autor,
  };

  const { data, error } = await supabase
    .from(TABELA_PREFEITA)
    .update(linha)
    .eq("id", id)
    .select(COLUNAS_PREFEITA)
    .single();
  if (error) throw error;

  const mudou = diferencaDaPrefeita(anterior, data);
  await auditar({
    acao: "editar_prefeita",
    registro: data?.nome ?? "",
    anterior: mudou.anterior,
    novo: mudou.novo,
  });
  return data;
}

/**
 * Inativa ou reativa o cadastro.
 *
 * A exclusão é LÓGICA, como nos outros cadastros do módulo: a linha nunca é
 * apagada, porque ela é a memória de quem autorizava os documentos daquela
 * época. Inativada, ela deixa de alimentar documento novo.
 */
export async function alternarSituacaoDaPrefeita(id, situacao, { anterior = null } = {}) {
  const autor = await usuarioAtualId();
  const { data, error } = await supabase
    .from(TABELA_PREFEITA)
    .update({ situacao, atualizado_em: new Date().toISOString(), atualizado_por: autor })
    .eq("id", id)
    .select(COLUNAS_PREFEITA)
    .single();
  if (error) throw error;

  await auditar({
    acao: situacao === "inativo" ? "inativar_prefeita" : "reativar_prefeita",
    registro: data?.nome ?? "",
    anterior: { situacao: anterior?.situacao ?? null },
    novo: { situacao },
  });
  return data;
}
