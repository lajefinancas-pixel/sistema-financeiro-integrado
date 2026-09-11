// Camada de dados da TABELA DE DIÁRIAS (public.processos_diarias_tabela).
//
// A tabela é um PARÂMETRO documental. Nenhuma função deste arquivo toca em
// pagamentos, baixas, valores em aberto, saldos, contas bancárias,
// transferências ou programações: as únicas tabelas escritas aqui são
// processos_diarias_tabela e auditoria_eventos.
//
// VERSÃO ANTIGA NUNCA É APAGADA. Salvar uma atualização INSERE uma versão nova e
// baixa a bandeira `vigente` da anterior -- não existe update de conteúdo e não
// existe delete. É isso que mantém consultável a tabela pela qual um processo de
// 2025 foi calculado.

import { supabase } from "./supabaseClient.js";
import { registrarEvento } from "./auditoria.js";
import { erroAmigavel, mensagemAmigavel } from "./erros.js";
import { MODULO_DIARIAS_TABELA } from "./processosDiarias.js";
import {
  TABELA_DIARIAS,
  TABELA_PADRAO,
  diferencaDaTabela,
  normalizarTabela,
  primeiroErroDaTabela,
  tituloDaTabela,
  validarTabela,
} from "./processosDiariasTabela.js";

const COLUNAS = "id, titulo, atualizada_em, pernoite_percentual, memoria_calculo, valores, vigente, criado_em, criado_por";

/** true quando o erro é "a tabela de diárias ainda não existe neste banco". */
export function tabelaDeDiariasAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) return true;
  const mensagem = String(erro?.message ?? "");
  if (/schema cache/i.test(mensagem)) return true;
  return mensagem.includes(TABELA_DIARIAS);
}

async function usuarioAtualId() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;
  const { data, error } = await supabase.from("usuarios").select("id").eq("auth_id", auth.user.id).limit(1);
  if (error) return null;
  return data?.[0]?.id ?? null;
}

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

/**
 * A tabela VIGENTE, já normalizada.
 *
 * Banco sem a migration, ou banco ainda sem nenhuma versão gravada, devolve a
 * tabela padrão (a informada pela prefeitura, atualizada em 23/03/2026) com
 * `ausente: true` -- a tela avisa, o formulário continua funcionando e o valor
 * unitário segue digitável à mão.
 */
export async function carregarTabelaVigente() {
  try {
    const { data, error } = await supabase
      .from(TABELA_DIARIAS)
      .select(COLUNAS)
      .eq("vigente", true)
      .limit(1);
    if (error) throw error;

    const linha = data?.[0] ?? null;
    if (!linha) return { tabela: normalizarTabela(TABELA_PADRAO), ausente: false, semVersao: true };
    return { tabela: normalizarTabela(linha), ausente: false, semVersao: false };
  } catch (e) {
    if (tabelaDeDiariasAusente(e)) {
      return { tabela: normalizarTabela(TABELA_PADRAO), ausente: true, semVersao: true };
    }
    throw erroAmigavel(mensagemAmigavel(e, "Não foi possível carregar a Tabela de Diárias."));
  }
}

/**
 * TODAS as versões, da mais recente para a mais antiga.
 *
 * É a consulta às versões anteriores que o item 7 pede: a tabela antiga não é
 * apagada porque os processos antigos dependem dela.
 */
export async function listarVersoesDaTabela() {
  try {
    const { data, error } = await supabase
      .from(TABELA_DIARIAS)
      .select(COLUNAS)
      .order("atualizada_em", { ascending: false })
      .order("criado_em", { ascending: false });
    if (error) throw error;

    const autores = await nomesDosAutores((data ?? []).map((l) => l.criado_por));
    return (data ?? []).map((linha) => ({
      ...normalizarTabela(linha),
      vigente: linha.vigente === true,
      criado_em: linha.criado_em ?? null,
      autor: autores[linha.criado_por] ?? null,
    }));
  } catch (e) {
    if (tabelaDeDiariasAusente(e)) return [];
    throw erroAmigavel(mensagemAmigavel(e, "Não foi possível carregar as versões da Tabela de Diárias."));
  }
}

async function nomesDosAutores(ids) {
  const unicos = [...new Set((ids ?? []).filter(Boolean))];
  if (unicos.length === 0) return {};
  try {
    const { data, error } = await supabase.from("usuarios").select("id, nome_completo").in("id", unicos);
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((u) => [u.id, u.nome_completo]));
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------
 * Gravação: sempre uma VERSÃO NOVA
 * ---------------------------------------------------------------------- */

/**
 * Publica uma atualização da Tabela de Diárias.
 *
 * Insere uma VERSÃO NOVA e baixa a bandeira da anterior. A versão anterior
 * continua no banco, íntegra: nenhum valor é reescrito e nenhuma linha é
 * apagada. Processos já criados não são tocados -- eles guardam o valor unitário
 * dentro de si e nunca voltam a consultar a tabela.
 *
 * A alteração vai para a AUDITORIA com usuário, data, valores anteriores e
 * novos, célula a célula.
 */
export async function salvarNovaVersaoDaTabela(tabelaAnterior, valores) {
  const erros = validarTabela(valores);
  const primeiro = primeiroErroDaTabela(erros);
  if (primeiro) throw erroAmigavel(primeiro);

  const pronta = normalizarTabela(valores);
  const autor = await usuarioAtualId();

  const { data, error } = await supabase
    .from(TABELA_DIARIAS)
    .insert({
      titulo: pronta.titulo,
      atualizada_em: pronta.atualizada_em,
      pernoite_percentual: pronta.pernoite_percentual,
      memoria_calculo: pronta.memoria_calculo || null,
      valores: pronta.valores,
      vigente: false,
      criado_por: autor,
    })
    .select(COLUNAS)
    .single();

  if (error) {
    if (tabelaDeDiariasAusente(error)) {
      throw erroAmigavel(
        "A Tabela de Diárias ainda não existe neste banco. Rode a migration do módulo no SQL Editor do Supabase.",
      );
    }
    throw erroAmigavel(
      mensagemAmigavel(
        error,
        error?.code === "42501"
          ? "Você não tem permissão para editar a Tabela de Diárias."
          : "Não foi possível salvar a Tabela de Diárias. Tente novamente.",
      ),
    );
  }

  // A vigência muda em dois passos para que o índice de "uma só vigente" nunca
  // veja duas: primeiro a antiga desce, depois a nova sobe.
  const { error: erroBaixa } = await supabase
    .from(TABELA_DIARIAS)
    .update({ vigente: false })
    .eq("vigente", true)
    .neq("id", data.id);
  if (erroBaixa) throw erroAmigavel(mensagemAmigavel(erroBaixa, "A versão foi gravada, mas não entrou em vigor."));

  const { error: erroSubida } = await supabase
    .from(TABELA_DIARIAS)
    .update({ vigente: true })
    .eq("id", data.id);
  if (erroSubida) throw erroAmigavel(mensagemAmigavel(erroSubida, "A versão foi gravada, mas não entrou em vigor."));

  const diferenca = diferencaDaTabela(tabelaAnterior, pronta);
  await registrarEvento({
    modulo: MODULO_DIARIAS_TABELA,
    acao: "alterou_tabela_diarias",
    registroAfetado: tituloDaTabela(pronta),
    valorAnterior: diferenca.anterior,
    valorNovo: diferenca.novo,
    nivel: "atencao",
    usuarioId: autor,
  });

  return { ...normalizarTabela(data), vigente: true };
}
