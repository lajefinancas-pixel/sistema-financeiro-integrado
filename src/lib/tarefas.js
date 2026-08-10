import { supabase } from "./supabaseClient";

/**
 * Camada de dados da página "Tarefas".
 *
 * Tabelas usadas:
 *   tarefas              -> a tarefa em si (responsável, prazo, prioridade, status...)
 *   tarefas_historico    -> trilha do que aconteceu com cada tarefa (coluna "detalhes" é jsonb)
 *   subtarefas           -> checklist de etapas da tarefa (descricao, concluida, ordem)
 *   tarefas_comentarios  -> comentários da equipe (texto, usuario_id, criado_em)
 *   tarefas_anexos       -> arquivos enviados para o bucket "tarefas-anexos"
 *   usuarios             -> nome do responsável e de quem criou
 *   secretarias          -> opções do campo "Secretaria relacionada" (gravado como texto)
 *
 * O status "atrasada" não é gravado: ele é derivado do prazo (prazo anterior a hoje
 * em tarefas que não estão concluídas nem canceladas).
 */

export const MODULO = "tarefas";

export const STATUS = {
  nova: { label: "Nova", cor: "#475569", bg: "#F1F5F9", ponto: "#94A3B8" },
  recebida: { label: "Recebida", cor: "#2563EB", bg: "#EAF1FF", ponto: "#2563EB" },
  em_andamento: { label: "Em andamento", cor: "#8A6100", bg: "#FEF6DF", ponto: "#EAB308" },
  aguardando_resposta: { label: "Aguardando resposta", cor: "#7C3AED", bg: "#F3EDFF", ponto: "#7C3AED" },
  em_analise: { label: "Em análise", cor: "#C2410C", bg: "#FFF1E6", ponto: "#F97316" },
  concluida: { label: "Concluída", cor: "#15803D", bg: "#EAFBF0", ponto: "#16A34A" },
  atrasada: { label: "Atrasada", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
  cancelada: { label: "Cancelada", cor: "#334155", bg: "#E2E8F0", ponto: "#334155" },
};

export const PRIORIDADES = {
  baixa: { label: "Baixa", cor: "#475569", bg: "#F1F5F9" },
  normal: { label: "Normal", cor: "#2563EB", bg: "#EAF1FF" },
  alta: { label: "Alta", cor: "#B45309", bg: "#FEF3E2" },
  urgente: { label: "Urgente", cor: "#DC2626", bg: "#FEF2F2" },
};

export const CATEGORIAS = [
  { id: "financeiro", label: "Financeiro" },
  { id: "pagamento", label: "Pagamento" },
  { id: "fornecedor", label: "Fornecedor" },
  { id: "tributario", label: "Tributário" },
  { id: "relatorio", label: "Relatório" },
  { id: "documento", label: "Documento" },
  { id: "conferencia", label: "Conferência" },
  { id: "banco", label: "Banco" },
  { id: "administrativo", label: "Administrativo" },
  { id: "outro", label: "Outro" },
];

export function statusInfo(chave) {
  return STATUS[chave] ?? { label: chave ?? "--", cor: "#475569", bg: "#F1F5F9", ponto: "#94A3B8" };
}

export function prioridadeInfo(chave) {
  return PRIORIDADES[chave] ?? { label: chave ?? "--", cor: "#475569", bg: "#F1F5F9" };
}

export function categoriaLabel(chave) {
  return CATEGORIAS.find((c) => c.id === chave)?.label ?? (chave || "--");
}

/** Data de hoje no formato aceito pela coluna "prazo" (date), no fuso local. */
export function hojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const STATUS_ENCERRADOS = ["concluida", "cancelada"];

/** Prazo já vencido em tarefa que continua aberta. */
export function estaAtrasada(tarefa) {
  if (!tarefa?.prazo) return false;
  if (STATUS_ENCERRADOS.includes(tarefa.status)) return false;
  return tarefa.prazo < hojeISO();
}

/** Status mostrado na tela: "atrasada" tem prioridade sobre o status gravado. */
export function statusVisual(tarefa) {
  if (estaAtrasada(tarefa)) return "atrasada";
  return tarefa?.status ?? "nova";
}

export function formatarData(valor) {
  if (!valor) return "--";
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "--";
  return `${dia}/${mes}/${ano}`;
}

export function formatarHora(valor) {
  if (!valor) return null;
  return String(valor).slice(0, 5);
}

export function formatarDataHora(valor) {
  if (!valor) return "--";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "--";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Vence em 3 dias", "Venceu há 2 dias", "Vence hoje" -- texto de apoio do prazo. */
export function textoPrazo(tarefa) {
  if (!tarefa?.prazo) return null;
  const hoje = hojeISO();
  const dias = Math.round((new Date(`${tarefa.prazo}T00:00:00`) - new Date(`${hoje}T00:00:00`)) / 86400000);
  if (STATUS_ENCERRADOS.includes(tarefa.status)) return null;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  if (dias > 1) return `Vence em ${dias} dias`;
  if (dias === -1) return "Venceu ontem";
  return `Venceu há ${Math.abs(dias)} dias`;
}

const COLUNAS_TAREFA = `
  id, titulo, descricao, status, prioridade, categoria, prazo, horario_limite,
  secretaria_relacionada, responsavel_id, criado_por, criado_em, concluida_em,
  concluida_por, observacao_final,
  responsavel:usuarios!tarefas_responsavel_id_fkey ( id, nome_completo ),
  autor:usuarios!tarefas_criado_por_fkey ( id, nome_completo ),
  finalizador:usuarios!tarefas_concluida_por_fkey ( id, nome_completo )
`;

/** Tarefas ordenadas por prazo (mais próximo primeiro; sem prazo por último). */
export async function listarTarefas() {
  const { data, error } = await supabase
    .from("tarefas")
    .select(COLUNAS_TAREFA)
    .order("prazo", { ascending: true, nullsFirst: false })
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listarUsuarios() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome_completo, cargo, status")
    .order("nome_completo", { ascending: true });
  if (error) throw error;
  return (data ?? []).filter((u) => u.status !== "inativo");
}

export async function listarSecretarias() {
  const { data, error } = await supabase
    .from("secretarias")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Cria a tarefa com status inicial "nova" e registra a linha de histórico
 * correspondente (acao: "criou"). A falha do histórico não desfaz a tarefa:
 * ela volta como aviso para a tela decidir o que mostrar.
 */
export async function criarTarefa(campos, usuarioId) {
  const registro = {
    titulo: campos.titulo.trim(),
    descricao: campos.descricao?.trim() || null,
    responsavel_id: campos.responsavel_id || null,
    prazo: campos.prazo || null,
    horario_limite: campos.horario_limite || null,
    prioridade: campos.prioridade || "normal",
    categoria: campos.categoria || null,
    secretaria_relacionada: campos.secretaria_relacionada || null,
    status: "nova",
    criado_por: usuarioId,
  };

  const { data, error } = await supabase.from("tarefas").insert(registro).select(COLUNAS_TAREFA).single();
  if (error) throw error;

  const { error: erroHistorico } = await supabase.from("tarefas_historico").insert({
    tarefa_id: data.id,
    usuario_id: usuarioId,
    acao: "criou",
    detalhes: {
      titulo: data.titulo,
      status: data.status,
      prioridade: data.prioridade,
      prazo: data.prazo,
      responsavel_id: data.responsavel_id,
    },
  });

  return { tarefa: data, avisoHistorico: erroHistorico?.message ?? null };
}

/* -------------------------------------------------------------------------
 * Quadro (Kanban)
 * ---------------------------------------------------------------------- */

/**
 * As quatro colunas do quadro. "aceita" lista os status gravados que caem
 * naquela coluna e "destino" é o status escrito quando o card é solto nela.
 * Tarefas canceladas não pertencem a nenhuma coluna e ficam fora do quadro.
 */
export const COLUNAS_QUADRO = [
  { id: "recebida", titulo: "Recebidas", aceita: ["nova", "recebida"], destino: "recebida" },
  { id: "em_andamento", titulo: "Em andamento", aceita: ["em_andamento", "em_analise"], destino: "em_andamento" },
  { id: "aguardando_resposta", titulo: "Aguardando", aceita: ["aguardando_resposta"], destino: "aguardando_resposta" },
  { id: "concluida", titulo: "Concluídas", aceita: ["concluida"], destino: "concluida" },
];

/** Coluna do quadro em que a tarefa aparece (null quando fica de fora). */
export function colunaDaTarefa(tarefa) {
  const status = tarefa?.status ?? "nova";
  return COLUNAS_QUADRO.find((c) => c.aceita.includes(status))?.id ?? null;
}

/* -------------------------------------------------------------------------
 * Histórico / linha do tempo
 * ---------------------------------------------------------------------- */

const COLUNAS_HISTORICO = `
  id, tarefa_id, acao, detalhes, criado_em,
  usuario:usuarios ( id, nome_completo )
`;

export async function listarHistorico(tarefaId) {
  const { data, error } = await supabase
    .from("tarefas_historico")
    .select(COLUNAS_HISTORICO)
    .eq("tarefa_id", tarefaId)
    .order("criado_em", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Grava uma linha na trilha da tarefa. O histórico nunca derruba a ação
 * principal: a falha volta como texto para a tela mostrar como aviso.
 */
export async function registrarHistorico(tarefaId, usuarioId, acao, detalhes) {
  const { error } = await supabase
    .from("tarefas_historico")
    .insert({ tarefa_id: tarefaId, usuario_id: usuarioId, acao, detalhes: detalhes ?? {} });
  return error?.message ?? null;
}

/** Frase da linha do tempo, no formato "<nome> <texto>". */
export function textoHistorico(registro) {
  const d = registro?.detalhes ?? {};
  switch (registro?.acao) {
    case "criou":
      return "criou a tarefa";
    case "mudou_status": {
      const de = statusInfo(d.status_anterior).label;
      const para = statusInfo(d.status_novo).label;
      return `alterou o status de ${de} para ${para}`;
    }
    case "concluiu":
      return d.observacao_final ? `concluiu a tarefa — "${d.observacao_final}"` : "concluiu a tarefa";
    case "reabriu":
      return "reabriu a tarefa";
    default:
      return registro?.acao ? String(registro.acao).replace(/_/g, " ") : "registrou uma alteração";
  }
}

/* -------------------------------------------------------------------------
 * Mudança de status e conclusão
 * ---------------------------------------------------------------------- */

/**
 * Move a tarefa para outro status (usado pelo arrastar e soltar do quadro).
 * Entrar em "concluida" carimba concluida_em/concluida_por; sair de "concluida"
 * limpa esses campos para a tarefa não ficar com dados de encerramento antigos.
 */
export async function mudarStatusTarefa(tarefa, novoStatus, usuarioId) {
  if (!tarefa?.id || tarefa.status === novoStatus) {
    return { tarefa, avisoHistorico: null };
  }

  const alteracao = { status: novoStatus };
  if (novoStatus === "concluida") {
    alteracao.concluida_em = new Date().toISOString();
    alteracao.concluida_por = usuarioId ?? null;
  } else if (tarefa.status === "concluida") {
    alteracao.concluida_em = null;
    alteracao.concluida_por = null;
    alteracao.observacao_final = null;
  }

  const { data, error } = await supabase
    .from("tarefas")
    .update(alteracao)
    .eq("id", tarefa.id)
    .select(COLUNAS_TAREFA)
    .single();
  if (error) throw error;

  const avisoHistorico = await registrarHistorico(tarefa.id, usuarioId, "mudou_status", {
    status_anterior: tarefa.status,
    status_novo: novoStatus,
  });

  return { tarefa: data, avisoHistorico };
}

/** Botão "Concluir tarefa": grava status, carimbo de conclusão e observação final. */
export async function concluirTarefa(tarefa, usuarioId, observacao) {
  const texto = observacao?.trim() || null;
  const { data, error } = await supabase
    .from("tarefas")
    .update({
      status: "concluida",
      concluida_em: new Date().toISOString(),
      concluida_por: usuarioId ?? null,
      observacao_final: texto,
    })
    .eq("id", tarefa.id)
    .select(COLUNAS_TAREFA)
    .single();
  if (error) throw error;

  const avisoHistorico = await registrarHistorico(tarefa.id, usuarioId, "concluiu", {
    status_anterior: tarefa.status,
    observacao_final: texto,
  });

  return { tarefa: data, avisoHistorico };
}

/* -------------------------------------------------------------------------
 * Checklist (subtarefas)
 * ---------------------------------------------------------------------- */

export async function listarSubtarefas(tarefaId) {
  const { data, error } = await supabase
    .from("subtarefas")
    .select("id, tarefa_id, descricao, concluida, ordem")
    .eq("tarefa_id", tarefaId)
    .order("ordem", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function criarSubtarefa(tarefaId, descricao, itensAtuais = []) {
  const maiorOrdem = itensAtuais.reduce((maior, item) => Math.max(maior, item.ordem ?? 0), 0);
  const { data, error } = await supabase
    .from("subtarefas")
    .insert({
      tarefa_id: tarefaId,
      descricao: descricao.trim(),
      concluida: false,
      ordem: maiorOrdem + 1,
    })
    .select("id, tarefa_id, descricao, concluida, ordem")
    .single();
  if (error) throw error;
  return data;
}

export async function marcarSubtarefa(subtarefaId, concluida) {
  const { data, error } = await supabase
    .from("subtarefas")
    .update({ concluida })
    .eq("id", subtarefaId)
    .select("id, tarefa_id, descricao, concluida, ordem")
    .single();
  if (error) throw error;
  return data;
}

export async function excluirSubtarefa(subtarefaId) {
  const { error } = await supabase.from("subtarefas").delete().eq("id", subtarefaId);
  if (error) throw error;
}

/** "X de Y etapas concluídas — Z%" */
export function progressoChecklist(itens) {
  const total = itens?.length ?? 0;
  const feitos = (itens ?? []).filter((i) => i.concluida).length;
  const percentual = total === 0 ? 0 : Math.round((feitos / total) * 100);
  return { total, feitos, percentual };
}

/* -------------------------------------------------------------------------
 * Comentários
 * ---------------------------------------------------------------------- */

const COLUNAS_COMENTARIO = `
  id, tarefa_id, texto, criado_em,
  usuario:usuarios ( id, nome_completo )
`;

export async function listarComentarios(tarefaId) {
  const { data, error } = await supabase
    .from("tarefas_comentarios")
    .select(COLUNAS_COMENTARIO)
    .eq("tarefa_id", tarefaId)
    .order("criado_em", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function criarComentario(tarefaId, usuarioId, texto) {
  const { data, error } = await supabase
    .from("tarefas_comentarios")
    .insert({ tarefa_id: tarefaId, usuario_id: usuarioId, texto: texto.trim() })
    .select(COLUNAS_COMENTARIO)
    .single();
  if (error) throw error;
  return data;
}

/* -------------------------------------------------------------------------
 * Anexos
 * ---------------------------------------------------------------------- */

export const BUCKET_ANEXOS = "tarefas-anexos";

const COLUNAS_ANEXO = `
  id, tarefa_id, tipo, nome_arquivo, arquivo_url, criado_em,
  usuario:usuarios ( id, nome_completo )
`;

const TIPOS_ARQUIVO = [
  { tipo: "imagem", extensoes: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"] },
  { tipo: "pdf", extensoes: ["pdf"] },
  { tipo: "planilha", extensoes: ["xls", "xlsx", "xlsm", "csv", "ods"] },
  { tipo: "documento", extensoes: ["doc", "docx", "odt", "rtf", "txt"] },
  { tipo: "apresentacao", extensoes: ["ppt", "pptx", "odp"] },
  { tipo: "compactado", extensoes: ["zip", "rar", "7z", "tar", "gz"] },
];

/** Rótulo curto guardado em tarefas_anexos.tipo, deduzido da extensão. */
export function tipoDoArquivo(nomeArquivo) {
  const extensao = String(nomeArquivo ?? "").split(".").pop()?.toLowerCase() ?? "";
  return TIPOS_ARQUIVO.find((t) => t.extensoes.includes(extensao))?.tipo ?? "outro";
}

/** Nome seguro para o caminho no Storage (sem acento, espaço ou símbolo). */
function nomeNoStorage(nomeArquivo) {
  const semAcento = String(nomeArquivo ?? "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const limpo = semAcento.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-{2,}/g, "-");
  return limpo.slice(-120) || "arquivo";
}

export async function listarAnexos(tarefaId) {
  const { data, error } = await supabase
    .from("tarefas_anexos")
    .select(COLUNAS_ANEXO)
    .eq("tarefa_id", tarefaId)
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Envia o arquivo para o bucket e registra a linha em tarefas_anexos.
 * Se o registro falhar, o arquivo enviado é removido para o bucket não
 * acumular órfãos.
 */
export async function enviarAnexo(tarefaId, arquivo, usuarioId) {
  const caminho = `${tarefaId}/${Date.now()}-${nomeNoStorage(arquivo.name)}`;

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_ANEXOS)
    .upload(caminho, arquivo, { cacheControl: "3600", upsert: false });
  if (erroUpload) throw erroUpload;

  const { data: publico } = supabase.storage.from(BUCKET_ANEXOS).getPublicUrl(caminho);

  const { data, error } = await supabase
    .from("tarefas_anexos")
    .insert({
      tarefa_id: tarefaId,
      usuario_id: usuarioId,
      tipo: tipoDoArquivo(arquivo.name),
      nome_arquivo: arquivo.name,
      arquivo_url: publico?.publicUrl ?? null,
    })
    .select(COLUNAS_ANEXO)
    .single();

  if (error) {
    await supabase.storage.from(BUCKET_ANEXOS).remove([caminho]);
    throw error;
  }
  return data;
}

export async function excluirAnexo(anexo) {
  const { error } = await supabase.from("tarefas_anexos").delete().eq("id", anexo.id);
  if (error) throw error;

  // O caminho fica no fim da URL pública, depois do nome do bucket.
  const marca = `/${BUCKET_ANEXOS}/`;
  const posicao = String(anexo.arquivo_url ?? "").indexOf(marca);
  if (posicao >= 0) {
    const caminho = decodeURIComponent(anexo.arquivo_url.slice(posicao + marca.length));
    await supabase.storage.from(BUCKET_ANEXOS).remove([caminho]);
  }
}
