// Camada de dados dos Processos de Serviços/Materiais.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nenhuma função deste arquivo toca
// em pagamentos, baixas, valores em aberto, saldos, contas bancárias,
// transferências ou programações. Confira por busca: as únicas tabelas
// ESCRITAS aqui são processos_servicos, processos_servicos_historico e
// auditoria_eventos. Fora do módulo só há LEITURA: fornecedores, usuarios,
// secretarias e valores_em_aberto.
//
// Criar, salvar, finalizar, cancelar, duplicar e imprimir NÃO debitam conta,
// NÃO dão baixa em NF, NÃO alteram saldo, NÃO marcam fornecedor como pago, NÃO
// criam pagamento e NÃO alteram a Programação Diária. "Liquidação/Solicitação
// de Pagamento" é o nome do DOCUMENTO -- não é baixa de pagamento.
//
// ⚠️ VINCULAR NF É APENAS CONSULTA. `carregarNotasDoFornecedor` só LÊ
// `valores_em_aberto`; não existe neste arquivo um único update, insert ou
// delete naquela tabela, e o valor em aberto da nota continua o que era.

import { supabase } from "./supabaseClient.js";
import { registrarEvento } from "./auditoria.js";
import {
  MODULO_SERVICOS,
  TABELA_SERVICOS,
  TABELA_SERVICOS_HISTORICO,
  diferencaParaAuditoria,
  formularioParaBanco,
  identificacaoDoProcesso,
  numeroDoProcesso,
  vinculoDeNotaRegistrado,
} from "./processosServicos.js";
import { congelarIdentidadeNoProcesso } from "./processosIdentidade.js";

/* -------------------------------------------------------------------------
 * Banco sem a migration deste envio
 * ---------------------------------------------------------------------- */

/**
 * true quando o erro é "as tabelas desta subaba não existem neste banco".
 *
 * A migration 20260911260000 é rodada à mão no SQL Editor do Supabase, então
 * existe a janela entre o deploy e a execução dela. Nela a tela mostra o recado
 * da migration em vez de um erro técnico -- e nenhum outro módulo é afetado.
 */
export function estruturaDeServicosAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) {
    return true;
  }
  const mensagem = String(erro?.message ?? "");
  if (/schema cache/i.test(mensagem)) return true;
  return mensagem.includes(TABELA_SERVICOS) || mensagem.includes("proximo_numero_processo_servico");
}

/** true quando o banco recusou por permissão (RLS ou o gatilho da subaba). */
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
 * As colunas de autoria da tabela apontam para public.usuarios, e é esse id que
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

// UM PROCESSO = UMA LINHA = DOIS DOCUMENTOS. As colunas dos Dados Gerais são
// compartilhadas pelas duas páginas; as da requisição e as da liquidação
// convivem na mesma linha, e é por isso que não existe registro independente de
// liquidação nem subaba separada para ela.
const COLUNAS = [
  "id", "ano", "numero", "data_processo",
  // A SOLICITANTE (cadastro próprio de Processos) e os dados dela CONGELADOS no
  // processo, para o documento antigo continuar saindo com quem assinou.
  "solicitante_id", "solicitante_nome", "solicitante_secretario",
  "solicitante_secretario_cpf", "solicitante_secretario_cargo",
  "objeto", "observacoes",
  // Página 1 -- Requisição de Material/Serviço. ⚠️ `itens` NÃO tem coluna de
  // valor: a requisição não tem valores, e eles só aparecem na página 2.
  "tipo", "itens", "despacho_secretaria",
  "requisitante_servidor_id", "requisitante_nome", "requisitante_cpf", "requisitante_cargo",
  // Página 2 -- Liquidação/Solicitação de Pagamento.
  "atestado", "referencia", "fundamentacao",
  "fornecedor_id", "favorecido_nome", "favorecido_cpf_cnpj", "favorecido_endereco",
  "banco_codigo", "banco", "agencia", "conta", "pix", "titular",
  "valor_total", "valor_extenso", "valor_extenso_manual",
  "liquidacao_data", "liquidacao_assinante_servidor_id", "liquidacao_assinante_nome",
  "liquidacao_assinante_cpf", "liquidacao_assinante_cargo", "liquidacao_observacoes",
  // A NF consultada: cópia dos dados dela dentro do processo. A nota original
  // não é alterada por nada disto.
  "nota_id", "nota_numero", "nota_emissao",
  "nota_valor_bruto", "nota_retencoes", "nota_valor_liquido",
  "identidade_visual",
  "situacao", "finalizada_em", "cancelada_em", "motivo_cancelamento",
  "criado_em", "atualizado_em",
].join(",");

const SELECAO = `${COLUNAS}`
  + ", solicitante:processos_secretarias_solicitantes ( id, nome, nome_curto, secretario, secretario_cpf, secretario_cargo )"
  + ", fornecedor:fornecedores ( id, razao_social, nome_fantasia, cpf_cnpj )";

/**
 * Os processos de serviços/materiais da lista.
 *
 * Rascunho excluído (exclusão lógica) não aparece; cancelado APARECE, porque o
 * cancelamento é informação do documento, não remoção dele.
 */
export async function carregarProcessosServicos({ incluirExcluidos = false } = {}) {
  let consulta = supabase.from(TABELA_SERVICOS).select(SELECAO);
  if (!incluirExcluidos) consulta = consulta.is("excluido_em", null);

  const { data, error } = await consulta
    .order("ano", { ascending: false })
    .order("numero", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Um processo, para abrir a tela dele direto. */
export async function carregarProcessoServico(id) {
  const { data, error } = await supabase.from(TABELA_SERVICOS).select(SELECAO).eq("id", id).single();
  if (error) throw error;
  return data;
}

/** O histórico próprio do processo, do mais recente para o mais antigo. */
export async function listarHistorico(processoId) {
  const { data, error } = await supabase
    .from(TABELA_SERVICOS_HISTORICO)
    .select("id, processo_id, acao, detalhes, criado_em, usuario:usuarios ( id, nome_completo )")
    .eq("processo_id", processoId)
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------------------------------------
 * Consulta de apoio: fornecedor e NF já registrada
 * ---------------------------------------------------------------------- */

// O cadastro de fornecedores é SOMENTE LEITURA para este módulo. Preencher o
// documento à mão não cria fornecedor, e alterar um valor no documento não
// altera o cadastro: o vínculo interno permanece, o cadastro não é tocado.
const COLUNAS_FORNECEDOR = "id,razao_social,nome_fantasia,cpf_cnpj,telefone,email,descricao";

/**
 * O fornecedor escolhido, com o que o cadastro tiver.
 *
 * As colunas de endereço não existem no cadastro em todos os bancos, então a
 * consulta tenta as opcionais e, se o banco não as tiver, repete sem elas: o
 * endereço do documento é então digitado à mão, sem alterar o cadastro.
 */
export async function carregarFornecedorCompleto(fornecedorId) {
  if (!fornecedorId) return null;

  const consultar = async (colunas) =>
    supabase.from("fornecedores").select(colunas).eq("id", fornecedorId).limit(1);

  let resposta = await consultar(`${COLUNAS_FORNECEDOR},apelido,endereco`);
  if (resposta.error) resposta = await consultar(`${COLUNAS_FORNECEDOR},apelido`);
  if (resposta.error) resposta = await consultar(COLUNAS_FORNECEDOR);
  if (resposta.error) throw resposta.error;
  return resposta.data?.[0] ?? null;
}

// As colunas da NF que o documento aproveita. É a mesma leitura que as Baixas e
// as áreas de fornecedores já fazem -- nada é criado nem alterado aqui.
const COLUNAS_NOTA =
  "id,fornecedor_id,numero_processo,numero_empenho,numero_nota_fiscal,data_nota_fiscal,"
  + "parcela,valor_bruto,valor,valor_pago,desconto_iss,desconto_ir,data_vencimento,situacao";

/**
 * As NFs/processos financeiros JÁ REGISTRADOS do fornecedor.
 *
 * ⚠️ SOMENTE LEITURA, E SÓ PARA CONSULTA. Selecionar uma nota aqui copia número,
 * emissão, bruto, retenções e líquido PARA DENTRO do processo. A nota original
 * não é alterada, não recebe baixa, não muda de situação e não tem o valor em
 * aberto mexido -- este arquivo não escreve em `valores_em_aberto`.
 *
 * Traz também as já quitadas: a nota paga é justamente a que explica um
 * documento antigo, e o modelo pede o número dela na FUNDAMENTAÇÃO.
 */
export async function carregarNotasDoFornecedor(fornecedorId) {
  if (!fornecedorId) return [];
  const { data, error } = await supabase
    .from("valores_em_aberto")
    .select(COLUNAS_NOTA)
    .eq("fornecedor_id", fornecedorId)
    .order("data_nota_fiscal", { ascending: false, nullsFirst: false });
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
    await supabase.from(TABELA_SERVICOS_HISTORICO).insert({
      processo_id: processoId,
      acao,
      detalhes,
      usuario_id: autor,
    });
  } catch (falha) {
    console.error("[Processos · Serviços/Materiais] O histórico desta ação não pôde ser gravado.", falha);
  }
}

/**
 * Trilha completa de uma ação: auditoria do sistema + histórico do processo.
 *
 * `nivel` segue o padrão do sistema: informação para o dia a dia, atenção para
 * o que fecha o documento e crítico para cancelamento e exclusão.
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
    modulo: MODULO_SERVICOS,
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
 * volta para a fila, nem quando o processo é cancelado. O número é INTERNO: ele
 * organiza a lista e a busca, e NÃO é impresso no papel.
 */
export async function proximoNumero(ano) {
  const { data, error } = await supabase.rpc("proximo_numero_processo_servico", { p_ano: ano });
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
 * Cria o processo (as duas páginas, no mesmo registro) como RASCUNHO.
 *
 * O número é emitido aqui, na criação, para que as duas páginas pertençam ao
 * mesmo processo desde o começo. Criar um processo NÃO gera pagamento, NÃO
 * debita conta e NÃO altera saldo.
 *
 * @param origem quando a criação veio de uma duplicação: `{ id, numero }` do
 *               processo original, que NÃO é alterado por isto.
 */
export async function criarProcessoServico(
  formulario,
  { ano = new Date().getFullYear(), origem = null } = {},
) {
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

  const { data, error } = await supabase.from(TABELA_SERVICOS).insert(linha).select(SELECAO).single();
  if (error) throw error;

  const duplicado = origem?.id ? { de_processo: origem.numero ?? null } : {};
  await registrarTrilha({
    processo: data,
    processoId: data.id,
    acao: origem?.id ? "duplicou" : "criou",
    acaoAuditoria: origem?.id ? "duplicou_processo" : "criou",
    novo: { ...linha, ...duplicado },
    detalhes: origem?.id
      ? { descricao: `Duplicado do processo nº ${origem.numero ?? "--"}, que não foi alterado` }
      : {},
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
 * saído da tela, e ele existe mesmo sem as duas páginas completas.
 *
 * `silencioso` é o salvamento automático: ele grava, mas não enche a trilha de
 * uma linha por tecla digitada. A gravação do botão Salvar, a finalização, o
 * cancelamento e o vínculo de uma NF sempre entram na trilha.
 */
export async function salvarProcessoServico(processoAnterior, formulario, { silencioso = false } = {}) {
  const id = processoAnterior?.id ?? formulario?.id;
  if (!id) throw new Error("Processo sem identificador: não há o que salvar.");

  const autor = await usuarioAtualId();
  const linha = formularioParaBanco(formulario);

  const { data, error } = await supabase
    .from(TABELA_SERVICOS)
    .update({ ...linha, atualizado_em: new Date().toISOString(), atualizado_por: autor })
    .eq("id", id)
    .select(SELECAO)
    .single();
  if (error) throw error;

  const diferenca = diferencaParaAuditoria(processoAnterior ?? {}, { ...formulario, ...linha });
  const nota = vinculoDeNotaRegistrado(processoAnterior ?? {}, { ...formulario, ...linha });

  // O vínculo com uma NF já registrada é anotado SEMPRE, mesmo no salvamento
  // automático: é consulta, mas é consulta que entra no documento, e interessa
  // saber de qual nota veio o valor. A nota em si continua intocada.
  if (nota) {
    await registrarTrilha({
      processo: data,
      processoId: id,
      acao: "vinculou_nota",
      acaoAuditoria: "vinculou_nota",
      anterior: { nota_numero: processoAnterior?.nota_numero ?? null },
      novo: nota,
      detalhes: {
        descricao:
          "Nota fiscal consultada para preencher o documento. A NF não foi alterada, "
          + "não recebeu baixa e o valor em aberto dela continua o mesmo.",
      },
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
 * Os dados da secretaria solicitante, do requisitante e de quem assina já são
 * campos do formulário e foram gravados no salvamento do conteúdo. O que entra
 * aqui é só o que o gatilho trata como controle, para que quem tem permissão de
 * finalizar não precise também de permissão de editar.
 */
const CAMPOS_CONGELADOS = ["identidade_visual"];

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
 * Fecha os dois documentos para alteração e nada mais: não gera pagamento, não
 * debita conta, não altera saldo, não dá baixa em nota, não marca o fornecedor
 * como pago e não mexe na Programação Diária. Salva o conteúdo atual junto, para
 * que o que foi finalizado seja exatamente o que estava na tela.
 *
 * CONGELA, no mesmo update, a identidade visual em vigor: trocar o brasão ou o
 * rodapé depois disto NÃO altera este processo -- ele passa a imprimir do que
 * guardou, e o gatilho do banco recusa qualquer reescrita do congelado.
 *
 * @param identidade a identidade visual vigente no momento da finalização.
 */
export async function finalizarProcessoServico(processoAnterior, formulario, { identidade = null } = {}) {
  const id = processoAnterior?.id ?? formulario?.id;
  if (!id) throw new Error("Processo sem identificador: não há o que finalizar.");

  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  // O conteúdo vai num update anterior, porque o gatilho do banco separa editar
  // de finalizar: alterar conteúdo E situação no mesmo update exigiria as duas
  // permissões de quem só pode finalizar.
  await salvarProcessoServico(processoAnterior, formulario, { silencioso: true });

  const congelado = colunasDeCongelamento(identidade ? congelarIdentidadeNoProcesso(identidade) : {});

  const { data, error } = await supabase
    .from(TABELA_SERVICOS)
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
export async function reabrirProcessoServico(processo) {
  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABELA_SERVICOS)
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
 * Cancelar um documento também não desfaz pagamento nenhum -- não havia
 * pagamento para desfazer.
 */
export async function cancelarProcessoServico(processo, motivo) {
  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABELA_SERVICOS)
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
export async function excluirRascunhoServico(processo, motivo) {
  const autor = await usuarioAtualId();
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABELA_SERVICOS)
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
    console.error("[Processos · Serviços/Materiais] A saída do documento não pôde ser registrada.", falha);
  }
}
