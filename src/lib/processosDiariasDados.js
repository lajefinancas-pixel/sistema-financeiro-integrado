// Camada de dados dos Processos de Diária.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nenhuma função deste arquivo toca
// em pagamentos, baixas, valores em aberto, saldos, contas bancárias,
// transferências ou programações. Confira por busca: as únicas tabelas escritas
// aqui são processos_diarias, processos_diarias_historico e auditoria_eventos, e
// as únicas lidas fora do módulo são secretarias, fornecedores e usuarios.
//
// Criar, salvar, finalizar, cancelar, duplicar e imprimir NÃO debitam conta, NÃO
// dão baixa em NF, NÃO alteram saldo, NÃO marcam fornecedor como pago, NÃO criam
// pagamento e NÃO alteram a Programação Diária.

import { supabase } from "./supabaseClient.js";
import { registrarEvento } from "./auditoria.js";
import {
  MODULO_DIARIAS,
  TABELA_HISTORICO,
  TABELA_PROCESSOS,
  alteracaoManualDeValor,
  alteracaoManualDeValorUnitario,
  diferencaParaAuditoria,
  formularioParaBanco,
  identificacaoDoProcesso,
  numeroDoProcesso,
} from "./processosDiarias.js";
import { congelarTabelaNoProcesso } from "./processosDiariasTabela.js";
import { congelarIdentidadeNoProcesso } from "./processosIdentidade.js";

/* -------------------------------------------------------------------------
 * Banco sem a migration deste envio
 * ---------------------------------------------------------------------- */

/**
 * true quando o erro é "as tabelas do módulo não existem neste banco".
 *
 * A migration 20260911160000 é rodada à mão no SQL Editor do Supabase, então
 * existe a janela entre o deploy e a execução dela. Nela a tela mostra o recado
 * da migration em vez de um erro técnico -- e nenhum outro módulo é afetado.
 */
export function estruturaDeProcessosAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) {
    return true;
  }
  const mensagem = String(erro?.message ?? "");
  if (/schema cache/i.test(mensagem)) return true;
  return mensagem.includes(TABELA_PROCESSOS) || mensagem.includes("proximo_numero_processo_diaria");
}

/** true quando o banco recusou por permissão (RLS ou o gatilho do módulo). */
export function semPermissaoNoBanco(erro) {
  const codigo = String(erro?.code ?? "");
  if (codigo === "42501" || codigo === "P0001") return true;
  return /row-level security|permissão|permissao|Sem permissão/i.test(String(erro?.message ?? ""));
}

/* -------------------------------------------------------------------------
 * Quem está gravando
 * ---------------------------------------------------------------------- */

let usuarioEmCache = null;

/**
 * O id em public.usuarios de quem está na sessão (não o id do auth).
 *
 * As colunas de autoria do módulo apontam para public.usuarios, e é esse id que
 * a auditoria também usa -- assim o autor do processo e o autor do evento na
 * trilha são a mesma pessoa, sem tradução no meio.
 */
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

// ⚠️ `beneficiario_matricula` NÃO entra aqui. A matrícula saiu do formulário e
// do documento; a coluna continua no banco com o que já foi gravado, e o sistema
// parou de lê-la e de escrevê-la.
const COLUNAS = [
  "id", "ano", "numero", "data_processo",
  // A SOLICITANTE (cadastro próprio de Processos) e os dados dela CONGELADOS no
  // processo. `secretaria_id` é o cadastro financeiro e fica só para o processo
  // antigo continuar abrindo com a secretaria que gravou.
  "solicitante_id", "solicitante_nome", "solicitante_secretario",
  "solicitante_secretario_cpf", "solicitante_secretario_cargo",
  "secretaria_id", "fornecedor_id",
  "beneficiario_nome", "beneficiario_cpf", "beneficiario_endereco",
  "objeto", "valor_total", "valor_total_manual", "valor_extenso", "valor_extenso_manual",
  "beneficiario_cargo", "beneficiario_lotacao",
  "tipo_diaria", "custeio_despesas", "data_diarias",
  "diaria_faixa", "diaria_categoria", "diaria_pernoite", "valor_unitario_manual",
  "diaria_valor_unitario", "diaria_pernoite_percentual", "diaria_tabela_versao",
  "diaria_tabela_id", "identidade_visual",
  "destino", "data_saida", "hora_saida", "data_retorno", "hora_retorno",
  "quantidade_diarias", "valor_unitario", "finalidade",
  "banco_codigo", "banco", "agencia", "conta", "pix", "titular", "observacoes",
  // O vínculo interno com o cadastro de SERVIDORES e quem assinou pela
  // secretaria. As colunas `transporte` e `transporte_outro` saíram desta lista:
  // o campo não existe no modelo oficial, e elas ficam no banco só com o
  // histórico já gravado.
  "beneficiario_servidor_id", "assinante_secretaria_servidor_id",
  "assinante_secretaria_nome", "assinante_secretaria_cpf", "assinante_secretaria_cargo",
  "liquidacao_data", "liquidacao_data_saida", "liquidacao_data_retorno",
  "liquidacao_quantidade", "liquidacao_valor", "liquidacao_relatorio",
  "liquidacao_documentos", "liquidacao_responsavel", "liquidacao_observacoes",
  "prestacao_relatorio", "prestacao_data",
  "situacao", "finalizada_em", "cancelada_em", "motivo_cancelamento",
  "criado_em", "atualizado_em",
].join(",");

const SELECAO = `${COLUNAS}`
  + ", solicitante:processos_secretarias_solicitantes ( id, nome, nome_curto, secretario, secretario_cpf, secretario_cargo )"
  + ", secretaria:secretarias ( id, nome )";

/**
 * Os processos de diária da lista.
 *
 * Rascunho excluído (exclusão lógica) não aparece; cancelado APARECE, porque o
 * cancelamento é informação do documento, não remoção dele.
 */
export async function carregarProcessos({ incluirExcluidos = false } = {}) {
  let consulta = supabase.from(TABELA_PROCESSOS).select(SELECAO);
  if (!incluirExcluidos) consulta = consulta.is("excluido_em", null);

  const { data, error } = await consulta
    .order("ano", { ascending: false })
    .order("numero", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Um processo, para abrir a tela dele direto. */
export async function carregarProcesso(id) {
  const { data, error } = await supabase.from(TABELA_PROCESSOS).select(SELECAO).eq("id", id).single();
  if (error) throw error;
  return data;
}

/**
 * As secretarias do cadastro FINANCEIRO (`public.secretarias`).
 *
 * ⚠️ Esta lista NÃO é mais a que o formulário do processo oferece para escolher:
 * quem REQUISITA a diária vem do cadastro próprio de SECRETARIAS SOLICITANTES
 * (`carregarSolicitantes`, em processosCadastrosDados.js). Ela continua sendo
 * lida aqui por um motivo só: processo criado ANTES daquele cadastro existir
 * gravou o id daqui, e precisa continuar mostrando o nome da secretaria dele.
 *
 * É LEITURA. Nada neste módulo altera, mescla ou apaga o cadastro financeiro de
 * secretarias -- ele continua servindo contas bancárias, fornecedores, Saldos,
 * Pagamentos e relatórios, exatamente como antes.
 */
export async function carregarSecretarias() {
  const { data, error } = await supabase.from("secretarias").select("id,nome").order("nome");
  if (error) throw error;
  return data ?? [];
}

/** O histórico próprio do processo, do mais recente para o mais antigo. */
export async function listarHistorico(processoId) {
  const { data, error } = await supabase
    .from(TABELA_HISTORICO)
    .select("id, processo_id, acao, detalhes, criado_em, usuario:usuarios ( id, nome_completo )")
    .eq("processo_id", processoId)
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------------------------------------
 * Histórico e auditoria
 * ---------------------------------------------------------------------- */

/**
 * Grava uma linha no histórico do processo.
 *
 * Como a auditoria do sistema, o histórico NUNCA derruba a ação principal: se a
 * gravação da trilha falhar, o processo já foi salvo e continua salvo.
 */
async function registrarHistorico(processoId, acao, detalhes = {}, usuarioId = null) {
  try {
    const autor = usuarioId ?? (await usuarioAtualId());
    await supabase.from(TABELA_HISTORICO).insert({
      processo_id: processoId,
      acao,
      detalhes,
      usuario_id: autor,
    });
  } catch (falha) {
    console.error("[Processos · Diárias] O histórico desta ação não pôde ser gravado.", falha);
  }
}

/**
 * Trilha completa de uma ação: auditoria do sistema + histórico do processo.
 *
 * `nivel` segue o padrão do sistema: informação para o dia a dia, atenção para
 * o que foge dele (alteração manual de valor) e crítico para o cancelamento.
 */
async function registrarTrilha({
  processo,
  processoId,
  acao,
  acaoAuditoria,
  anterior = null,
  novo = null,
  detalhes = {},
  nivel = "informacao",
  usuarioId = null,
}) {
  const autor = usuarioId ?? (await usuarioAtualId());
  await registrarHistorico(processoId, acao, detalhes, autor);
  await registrarEvento({
    modulo: MODULO_DIARIAS,
    acao: acaoAuditoria ?? acao,
    registroAfetado: identificacaoDoProcesso(processo),
    valorAnterior: anterior,
    valorNovo: novo,
    nivel,
    usuarioId: autor,
  });
}

/* -------------------------------------------------------------------------
 * Numeração
 * ---------------------------------------------------------------------- */

/**
 * Pede ao banco o próximo número do ano.
 *
 * É o banco que emite e consome o número, na mesma transação -- dois usuários
 * criando ao mesmo tempo recebem números diferentes, e número emitido nunca
 * volta para a fila, nem quando o processo é cancelado.
 */
export async function proximoNumero(ano) {
  const { data, error } = await supabase.rpc("proximo_numero_processo_diaria", { p_ano: ano });
  if (error) throw error;
  const numero = Number(data);
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error("O banco não devolveu o número do processo.");
  }
  return numero;
}

/* -------------------------------------------------------------------------
 * Gravação
 * ---------------------------------------------------------------------- */

/**
 * Cria o processo (as três páginas, no mesmo registro) como RASCUNHO.
 *
 * O número é emitido aqui, na criação, para que as três páginas já saiam com
 * ele. Criar um processo NÃO gera pagamento, NÃO debita conta e NÃO altera saldo.
 *
 * @param origem quando a criação veio de uma duplicação: `{ id, numero }` do
 *               processo original, que NÃO é alterado por isto.
 */
export async function criarProcesso(formulario, { ano = new Date().getFullYear(), origem = null } = {}) {
  const autor = await usuarioAtualId();
  const numero = await proximoNumero(ano);

  const linha = {
    ...formularioParaBanco(formulario),
    ano,
    numero,
    situacao: "rascunho",
    criado_por: autor,
    atualizado_por: autor,
  };

  const { data, error } = await supabase.from(TABELA_PROCESSOS).insert(linha).select(SELECAO).single();
  if (error) throw error;

  const duplicado = origem?.id ? { de_processo: origem.numero ?? null } : {};
  await registrarTrilha({
    processo: data,
    processoId: data.id,
    acao: origem?.id ? "duplicou" : "criou",
    acaoAuditoria: origem?.id ? "duplicou_processo" : "criou",
    novo: { ...linha, ...duplicado },
    detalhes: origem?.id ? { descricao: `Duplicado do processo nº ${origem.numero ?? "--"}` } : {},
    usuarioId: autor,
  });

  return data;
}

/**
 * Salva as alterações do rascunho.
 *
 * Serve para o botão Salvar e para o salvamento automático -- os dois gravam a
 * mesma coisa, e é por isso que fechar a tela, perder a sessão ou oscilar a
 * internet não perde o trabalho. Um rascunho NUNCA é apagado por o usuário ter
 * saído da tela.
 *
 * `silencioso` é o salvamento automático: ele grava, mas não enche a trilha de
 * uma linha por tecla digitada. A gravação do botão Salvar, a finalização, o
 * cancelamento e a alteração manual de valor sempre entram na trilha.
 */
export async function salvarProcesso(processoAnterior, formulario, { silencioso = false } = {}) {
  const id = processoAnterior?.id ?? formulario?.id;
  if (!id) throw new Error("Processo sem identificador: não há o que salvar.");

  const autor = await usuarioAtualId();
  const linha = formularioParaBanco(formulario);

  const { data, error } = await supabase
    .from(TABELA_PROCESSOS)
    .update({ ...linha, atualizado_em: new Date().toISOString(), atualizado_por: autor })
    .eq("id", id)
    .select(SELECAO)
    .single();
  if (error) throw error;

  const diferenca = diferencaParaAuditoria(processoAnterior ?? {}, { ...formulario, ...linha });
  const manual = alteracaoManualDeValor(processoAnterior ?? {}, { ...formulario, ...linha });
  const manualUnitario = alteracaoManualDeValorUnitario(processoAnterior ?? {}, { ...formulario, ...linha });

  // O valor unitário digitado à mão, por cima do que a Tabela de Diárias daria,
  // também é registrado SEMPRE -- é o que o item 5 pede que fique na auditoria.
  if (manualUnitario) {
    await registrarTrilha({
      processo: data,
      processoId: id,
      acao: "alterou_valor_unitario_manual",
      acaoAuditoria: "alterou_valor_unitario_manual",
      anterior: { valor_unitario: manualUnitario.valor_unitario_anterior },
      novo: manualUnitario,
      detalhes: { descricao: "Valor unitário digitado à mão, por cima do valor da Tabela de Diárias" },
      nivel: "atencao",
      usuarioId: autor,
    });
  }

  // A alteração manual do total é registrada SEMPRE, mesmo no salvamento
  // automático: é exatamente o que o item 6 pede que fique na auditoria.
  if (manual) {
    await registrarTrilha({
      processo: data,
      processoId: id,
      acao: "alterou_valor_manual",
      acaoAuditoria: "alterou_valor_manual",
      anterior: { valor_total: processoAnterior?.valor_total ?? null, valor_calculado: manual.valor_calculado },
      novo: manual,
      detalhes: { descricao: "Valor total digitado à mão, diferente de quantidade × valor unitário" },
      nivel: "atencao",
      usuarioId: autor,
    });
  }

  if (!silencioso && diferenca.houveAlteracao) {
    await registrarTrilha({
      processo: data,
      processoId: id,
      acao: "alterou",
      acaoAuditoria: "alterou",
      anterior: diferenca.anterior,
      novo: diferenca.novo,
      usuarioId: autor,
    });
  }

  return data;
}

/**
 * As colunas de congelamento que a FINALIZAÇÃO grava.
 *
 * A faixa, a categoria e o pernoite escolhidos já foram gravados no salvamento
 * do conteúdo -- eles são campos do formulário. O que entra aqui é só o que o
 * gatilho trata como controle, para que quem tem permissão de finalizar não
 * precise também de permissão de editar.
 */
const CAMPOS_CONGELADOS = [
  "diaria_valor_unitario",
  "diaria_pernoite_percentual",
  "diaria_tabela_versao",
  "diaria_tabela_id",
  "identidade_visual",
];

function colunasDeCongelamento(congelado) {
  const linha = {};
  CAMPOS_CONGELADOS.forEach((campo) => {
    if (campo in congelado) linha[campo] = congelado[campo];
  });
  return linha;
}

/**
 * FINALIZA o processo. FINALIZAR NÃO É PAGAR.
 *
 * Fecha o documento para alteração e nada mais: não gera pagamento, não debita
 * conta, não altera saldo, não dá baixa em nota e não mexe na Programação
 * Diária. Salva o conteúdo atual junto, para que o que foi finalizado seja
 * exatamente o que estava na tela.
 *
 * CONGELA, no mesmo update, o valor unitário usado, a faixa, a categoria, o
 * percentual de pernoite, a identificação da versão da Tabela de Diárias vigente
 * e a identidade visual em vigor. É o item 6 e o item 12: atualizar a tabela ou
 * trocar o brasão depois disto NÃO altera este processo -- ele passa a imprimir
 * do que guardou, e o gatilho do banco recusa qualquer reescrita do congelado.
 *
 * @param tabela     a Tabela de Diárias vigente no momento da finalização.
 * @param identidade a identidade visual vigente no momento da finalização.
 */
export async function finalizarProcesso(processoAnterior, formulario, { tabela = null, identidade = null } = {}) {
  const id = processoAnterior?.id ?? formulario?.id;
  if (!id) throw new Error("Processo sem identificador: não há o que finalizar.");

  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  // O conteúdo vai no update anterior, porque o gatilho do banco separa editar
  // de finalizar: alterar conteúdo E situação no mesmo update exigiria as duas
  // permissões de quem só pode finalizar.
  await salvarProcesso(processoAnterior, formulario, { silencioso: true });

  // O congelamento entra JUNTO com a situação, e não no salvamento de conteúdo:
  // as colunas dele estão na lista de controle do gatilho, então quem tem
  // permissão de finalizar consegue gravá-las sem precisar de permissão de editar.
  const congelado = colunasDeCongelamento({
    ...(tabela ? congelarTabelaNoProcesso(formulario, tabela) : {}),
    ...(identidade ? congelarIdentidadeNoProcesso(identidade) : {}),
  });

  const { data, error } = await supabase
    .from(TABELA_PROCESSOS)
    .update({
      ...congelado,
      situacao: "finalizada",
      finalizada_em: agora,
      finalizada_por: autor,
      atualizado_em: agora,
      atualizado_por: autor,
    })
    .eq("id", id)
    .select(SELECAO)
    .single();
  if (error) throw error;

  await registrarTrilha({
    processo: data,
    processoId: id,
    acao: "finalizou",
    acaoAuditoria: "finalizou_processo",
    anterior: { situacao: processoAnterior?.situacao ?? "rascunho" },
    novo: { situacao: "finalizada", finalizada_em: agora, ...congelado },
    detalhes: { descricao: "Documento fechado. Finalizar não é pagar: nenhum valor foi pago." },
    nivel: "atencao",
    usuarioId: autor,
  });

  return data;
}

/**
 * Reabre um processo finalizado para edição.
 *
 * Existe porque o alternativo seria cancelar e refazer -- o que queimaria um
 * número de processo por causa de um erro de digitação. A reabertura fica na
 * trilha, como tudo o mais.
 */
export async function reabrirProcesso(processo) {
  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABELA_PROCESSOS)
    .update({
      situacao: "rascunho",
      finalizada_em: null,
      finalizada_por: null,
      atualizado_em: agora,
      atualizado_por: autor,
    })
    .eq("id", processo.id)
    .select(SELECAO)
    .single();
  if (error) throw error;

  await registrarTrilha({
    processo: data,
    processoId: processo.id,
    acao: "reabriu",
    acaoAuditoria: "reabriu_processo",
    anterior: { situacao: "finalizada" },
    novo: { situacao: "rascunho" },
    nivel: "atencao",
    usuarioId: autor,
  });

  return data;
}

/**
 * CANCELA (anula) o processo, preservando registro, número e histórico.
 *
 * É a saída do processo finalizado, que não tem exclusão comum. O número
 * cancelado continua ocupado: ele não volta para a fila e não é reutilizado.
 */
export async function cancelarProcesso(processo, motivo) {
  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABELA_PROCESSOS)
    .update({
      situacao: "cancelada",
      cancelada_em: agora,
      cancelada_por: autor,
      motivo_cancelamento: String(motivo ?? "").trim() || null,
      atualizado_em: agora,
      atualizado_por: autor,
    })
    .eq("id", processo.id)
    .select(SELECAO)
    .single();
  if (error) throw error;

  await registrarTrilha({
    processo: data,
    processoId: processo.id,
    acao: "cancelou",
    acaoAuditoria: "cancelou_processo",
    anterior: { situacao: processo?.situacao ?? "rascunho" },
    novo: { situacao: "cancelada", motivo_cancelamento: motivo ?? null },
    detalhes: { motivo: String(motivo ?? "").trim() },
    nivel: "critico",
    usuarioId: autor,
  });

  return data;
}

/**
 * Exclusão LÓGICA do rascunho: a linha continua no banco, fora da lista.
 *
 * Só rascunho. Processo finalizado não tem exclusão comum -- o banco também
 * recusa, no gatilho -- e a saída dele é cancelar.
 */
export async function excluirRascunho(processo, motivo) {
  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABELA_PROCESSOS)
    .update({
      excluido_em: agora,
      excluido_por: autor,
      motivo_exclusao: String(motivo ?? "").trim() || null,
      atualizado_em: agora,
      atualizado_por: autor,
    })
    .eq("id", processo.id)
    .select("id")
    .single();
  if (error) throw error;

  await registrarTrilha({
    processo,
    processoId: processo.id,
    acao: "excluiu",
    acaoAuditoria: "excluiu",
    anterior: { situacao: processo?.situacao ?? "rascunho", numero: numeroDoProcesso(processo) },
    novo: { excluido_em: agora, motivo_exclusao: motivo ?? null },
    detalhes: { motivo: String(motivo ?? "").trim() },
    nivel: "critico",
    usuarioId: autor,
  });

  return data;
}

/**
 * Registra na trilha que o documento foi impresso ou virou PDF.
 *
 * Imprimir não altera o processo -- nada do documento muda, e nenhum valor é
 * pago. O registro existe porque interessa saber quem levou aquele papel para
 * fora do sistema.
 */
export async function registrarSaidaDoDocumento(processo, { acao = "imprimiu", detalhes = {} } = {}) {
  try {
    await registrarHistorico(processo?.id, acao, detalhes);
  } catch (falha) {
    console.error("[Processos · Diárias] A saída do documento não pôde ser registrada.", falha);
  }
}
