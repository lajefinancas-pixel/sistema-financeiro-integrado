import { supabase } from "./supabaseClient";
import { notificar } from "./notificacoes";

/**
 * Camada de dados da página "Tarefas".
 *
 * Tabelas usadas:
 *   tarefas                 -> a tarefa em si (responsável, prazo, prioridade, status...)
 *   tarefas_historico       -> trilha do que aconteceu com cada tarefa (coluna "detalhes" é jsonb)
 *   subtarefas              -> checklist de etapas da tarefa (descricao, concluida, ordem)
 *   tarefas_comentarios     -> comentários da equipe (texto, usuario_id, criado_em)
 *   tarefas_anexos          -> arquivos enviados para o bucket "tarefas-anexos"
 *   tarefas_compartilhadas  -> quem mais acompanha a tarefa além da responsável
 *   notificacoes            -> avisos gerados para a equipe (ver lib/notificacoes.js)
 *   usuarios                -> nome do responsável e de quem criou
 *   secretarias             -> opções do campo "Secretaria relacionada" (gravado como texto)
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

/** Regras de repetição gravadas em tarefas.recorrencia (jsonb). */
export const RECORRENCIAS = [
  { id: "nao_repete", label: "Não repete" },
  { id: "dia_util", label: "Todo dia útil" },
  { id: "semanal", label: "Semanalmente" },
  { id: "mensal", label: "Mensalmente" },
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

const COLUNAS_BASE = `
  id, titulo, descricao, status, prioridade, categoria, prazo, horario_limite,
  secretaria_relacionada, responsavel_id, criado_por, criado_em, concluida_em,
  concluida_por, observacao_final,
  responsavel:usuarios!tarefas_responsavel_id_fkey ( id, nome_completo ),
  autor:usuarios!tarefas_criado_por_fkey ( id, nome_completo ),
  finalizador:usuarios!tarefas_concluida_por_fkey ( id, nome_completo )
`;

/**
 * Colunas dos recursos finais (tarefa importante, recorrência e aprovação).
 * Elas vêm da migration 20260810180000; enquanto ela não for aplicada o Postgres
 * responde 42703 e a coluna sai das consultas, para a tela continuar abrindo —
 * sem o recurso, mas sem quebrar o que já existia.
 */
const COLUNAS_OPCIONAIS = ["importante", "recorrencia", "aprovada", "aprovada_por", "aprovada_em"];
const colunasPresentes = new Set(COLUNAS_OPCIONAIS);

/** true quando a coluna opcional existe no banco (usado para esconder campos). */
export function temColuna(nome) {
  return colunasPresentes.has(nome);
}

function colunasTarefa() {
  const extras = COLUNAS_OPCIONAIS.filter((coluna) => colunasPresentes.has(coluna));
  return extras.length === 0 ? COLUNAS_BASE : `${COLUNAS_BASE}, ${extras.join(", ")}`;
}

/** Mantém no registro apenas os campos opcionais que existem no banco. */
function camposSuportados(registro) {
  const copia = { ...registro };
  COLUNAS_OPCIONAIS.forEach((coluna) => {
    if (!colunasPresentes.has(coluna)) delete copia[coluna];
  });
  return copia;
}

/**
 * Executa a consulta montada por "construir" e, quando o banco reclama de uma
 * coluna opcional que ainda não existe, refaz a consulta sem ela.
 */
async function comColunasDisponiveis(construir) {
  for (let tentativa = 0; tentativa <= COLUNAS_OPCIONAIS.length; tentativa += 1) {
    const { data, error } = await construir(colunasTarefa());
    if (!error) return data;

    const ausente =
      error.code === "42703"
        ? COLUNAS_OPCIONAIS.find(
            (coluna) => colunasPresentes.has(coluna) && new RegExp(`\\b${coluna}\\b`).test(error.message ?? ""),
          )
        : null;
    if (!ausente) throw error;
    colunasPresentes.delete(ausente);
  }
  throw new Error("Não foi possível montar a consulta de tarefas.");
}

/** Tarefas ordenadas por prazo (mais próximo primeiro; sem prazo por último). */
export async function listarTarefas() {
  const data = await comColunasDisponiveis((colunas) =>
    supabase
      .from("tarefas")
      .select(colunas)
      .order("prazo", { ascending: true, nullsFirst: false })
      .order("criado_em", { ascending: false }),
  );
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
 * ela volta como aviso para a tela decidir o que mostrar. Quando a tarefa nasce
 * com outra pessoa como responsável, essa pessoa também recebe uma notificação.
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
    importante: campos.importante === true,
    recorrencia: regraRecorrencia(campos.recorrencia),
    status: "nova",
    criado_por: usuarioId,
  };

  const data = await comColunasDisponiveis((colunas) =>
    supabase.from("tarefas").insert(camposSuportados(registro)).select(colunas).single(),
  );

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

  await notificarAtribuicao(data, usuarioId);

  return { tarefa: data, avisoHistorico: erroHistorico?.message ?? null };
}

/** Aviso de "esta tarefa é sua" — só quando o responsável é outra pessoa. */
function notificarAtribuicao(tarefa, usuarioId) {
  if (!tarefa?.responsavel_id || tarefa.responsavel_id === usuarioId) return Promise.resolve(null);
  return notificar({
    usuario_id: tarefa.responsavel_id,
    tarefa_id: tarefa.id,
    tipo: "tarefa_atribuida",
    mensagem: `A tarefa "${tarefa.titulo}" foi atribuída a você.`,
  });
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
 * "Minhas tarefas"
 * ---------------------------------------------------------------------- */

/**
 * As faixas da aba "Minhas tarefas". Cada tarefa entra em uma faixa só: a
 * ordem de decisão está em grupoMinhaTarefa.
 */
export const GRUPOS_MINHAS = [
  { id: "hoje", titulo: "Para hoje", cor: "#B45309" },
  { id: "proximas", titulo: "Próximas", cor: "#2563EB" },
  { id: "em_andamento", titulo: "Em andamento", cor: "#EAB308" },
  { id: "aguardando", titulo: "Aguardando", cor: "#7C3AED" },
  { id: "atrasadas", titulo: "Atrasadas", cor: "#DC2626" },
  { id: "concluidas", titulo: "Concluídas", cor: "#16A34A" },
];

/**
 * Faixa da tarefa em "Minhas tarefas". O prazo manda antes do status: uma
 * tarefa em andamento que vence hoje aparece em "Para hoje", e uma vencida
 * aparece em "Atrasadas". Tarefas canceladas ficam fora (retornam null).
 */
export function grupoMinhaTarefa(tarefa) {
  const status = tarefa?.status ?? "nova";
  if (status === "concluida") return "concluidas";
  if (status === "cancelada") return null;
  if (estaAtrasada(tarefa)) return "atrasadas";
  if (tarefa?.prazo === hojeISO()) return "hoje";
  if (status === "em_andamento") return "em_andamento";
  if (status === "aguardando_resposta" || status === "em_analise") return "aguardando";
  return "proximas";
}

export function agruparMinhasTarefas(tarefas) {
  const mapa = Object.fromEntries(GRUPOS_MINHAS.map((g) => [g.id, []]));
  (tarefas ?? []).forEach((tarefa) => {
    const grupo = grupoMinhaTarefa(tarefa);
    if (grupo) mapa[grupo].push(tarefa);
  });
  return mapa;
}

/* -------------------------------------------------------------------------
 * Recorrência
 * ---------------------------------------------------------------------- */

/** Valor gravado em tarefas.recorrencia a partir da opção escolhida na tela. */
export function regraRecorrencia(tipo) {
  const valida = RECORRENCIAS.some((r) => r.id === tipo && r.id !== "nao_repete");
  return valida ? { tipo } : null;
}

/** Tipo de repetição da tarefa (null quando ela não se repete). */
export function recorrenciaTipo(tarefa) {
  const tipo = tarefa?.recorrencia?.tipo ?? null;
  return tipo && tipo !== "nao_repete" && RECORRENCIAS.some((r) => r.id === tipo) ? tipo : null;
}

export function recorrenciaLabel(tipo) {
  return RECORRENCIAS.find((r) => r.id === tipo)?.label ?? "Não repete";
}

function dataParaISO(data) {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * Prazo da próxima ocorrência. A conta parte do prazo atual, mas nunca de uma
 * data já vencida: uma tarefa diária concluída com atraso volta a partir de hoje.
 */
export function proximoPrazo(tipo, prazoAtual) {
  const hoje = hojeISO();
  const partida = prazoAtual && prazoAtual >= hoje ? prazoAtual : hoje;
  const [ano, mes, dia] = partida.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);

  if (tipo === "semanal") {
    data.setDate(data.getDate() + 7);
  } else if (tipo === "mensal") {
    // Dia 31 em mês curto cai no último dia do mês seguinte.
    const diaOriginal = data.getDate();
    data.setDate(1);
    data.setMonth(data.getMonth() + 1);
    const ultimoDia = new Date(data.getFullYear(), data.getMonth() + 1, 0).getDate();
    data.setDate(Math.min(diaOriginal, ultimoDia));
  } else if (tipo === "dia_util") {
    do {
      data.setDate(data.getDate() + 1);
    } while (data.getDay() === 0 || data.getDay() === 6);
  } else {
    return null;
  }

  return dataParaISO(data);
}

/**
 * Cria a próxima ocorrência de uma tarefa recorrente que acabou de ser
 * concluída, repetindo título, responsável, categoria e demais campos do
 * cadastro com o prazo recalculado pela regra.
 *
 * É um efeito secundário da conclusão: qualquer falha volta como aviso, sem
 * desfazer a conclusão já gravada.
 */
async function gerarProximaOcorrencia(tarefa, usuarioId) {
  const tipo = recorrenciaTipo(tarefa);
  if (!tipo) return { ocorrencia: null, aviso: null };

  const prazo = proximoPrazo(tipo, tarefa.prazo);
  const registro = {
    titulo: tarefa.titulo,
    descricao: tarefa.descricao ?? null,
    responsavel_id: tarefa.responsavel_id ?? null,
    prazo,
    horario_limite: tarefa.horario_limite ?? null,
    prioridade: tarefa.prioridade ?? "normal",
    categoria: tarefa.categoria ?? null,
    secretaria_relacionada: tarefa.secretaria_relacionada ?? null,
    importante: tarefa.importante === true,
    recorrencia: tarefa.recorrencia ?? null,
    status: "nova",
    criado_por: usuarioId ?? null,
  };

  try {
    const nova = await comColunasDisponiveis((colunas) =>
      supabase.from("tarefas").insert(camposSuportados(registro)).select(colunas).single(),
    );

    await registrarHistorico(nova.id, usuarioId, "criou", {
      titulo: nova.titulo,
      status: nova.status,
      prazo: nova.prazo,
      responsavel_id: nova.responsavel_id,
      origem: "recorrencia",
    });
    await registrarHistorico(tarefa.id, usuarioId, "gerou_recorrencia", {
      tipo,
      prazo,
      tarefa_gerada_id: nova.id,
    });
    await notificarAtribuicao(nova, usuarioId);

    return { ocorrencia: nova, aviso: null };
  } catch (e) {
    return { ocorrencia: null, aviso: e.message ?? "Não foi possível gerar a próxima ocorrência." };
  }
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
      return d.origem === "recorrencia" ? "criou a tarefa (repetição automática)" : "criou a tarefa";
    case "mudou_status": {
      const de = statusInfo(d.status_anterior).label;
      const para = statusInfo(d.status_novo).label;
      return `alterou o status de ${de} para ${para}`;
    }
    case "concluiu":
      return d.observacao_final ? `concluiu a tarefa — "${d.observacao_final}"` : "concluiu a tarefa";
    case "reabriu":
      return "reabriu a tarefa";
    case "delegou":
      return `delegou a tarefa para ${d.responsavel_novo_nome ?? "outra pessoa"}`;
    case "compartilhou":
      return `compartilhou a tarefa com ${(d.nomes ?? []).join(", ") || "outros usuários"}`;
    case "removeu_compartilhamento":
      return `deixou de compartilhar a tarefa com ${d.nome ?? "um usuário"}`;
    case "enviou_para_aprovacao":
      return d.observacao_final
        ? `concluiu e enviou para aprovação — "${d.observacao_final}"`
        : "concluiu e enviou para aprovação";
    case "aprovou":
      return "aprovou a conclusão da tarefa";
    case "devolveu":
      return `devolveu a tarefa para correção — "${d.motivo ?? "sem motivo informado"}"`;
    case "gerou_recorrencia":
      return `gerou a próxima ocorrência para ${formatarData(d.prazo)}`;
    default:
      return registro?.acao ? String(registro.acao).replace(/_/g, " ") : "registrou uma alteração";
  }
}

/* -------------------------------------------------------------------------
 * Mudança de status, conclusão, aprovação e devolução
 * ---------------------------------------------------------------------- */

/**
 * Move a tarefa para outro status (usado pelo arrastar e soltar do quadro).
 * Soltar em "Concluídas" chama concluirTarefa, que carimba concluida_em/por —
 * ou manda para análise, quando a tarefa é importante; sair de "concluida"
 * limpa esses campos para a tarefa não ficar com dados de encerramento antigos.
 */
export async function mudarStatusTarefa(tarefa, novoStatus, usuarioId) {
  if (!tarefa?.id || tarefa.status === novoStatus) {
    return { tarefa, avisoHistorico: null };
  }

  // Concluir pelo quadro segue o mesmo caminho do modal: tarefa importante vai
  // para análise à espera do aval, e tarefa que se repete gera a próxima.
  if (novoStatus === "concluida") {
    return concluirTarefa(tarefa, usuarioId, tarefa.observacao_final);
  }

  const alteracao = { status: novoStatus };
  if (tarefa.status === "concluida") {
    alteracao.concluida_em = null;
    alteracao.concluida_por = null;
    alteracao.observacao_final = null;
  }

  const data = await comColunasDisponiveis((colunas) =>
    supabase.from("tarefas").update(camposSuportados(alteracao)).eq("id", tarefa.id).select(colunas).single(),
  );

  const avisoHistorico = await registrarHistorico(tarefa.id, usuarioId, "mudou_status", {
    status_anterior: tarefa.status,
    status_novo: novoStatus,
  });

  return { tarefa: data, avisoHistorico };
}

/** true quando a conclusão da tarefa depende do aval da gestora. */
export function exigeAprovacao(tarefa) {
  return tarefa?.importante === true && temColuna("importante");
}

/** true quando a tarefa está parada esperando o aval da gestora. */
export function aguardandoAprovacao(tarefa) {
  return tarefa?.status === "em_analise";
}

/** Usuários com "aprovar" no módulo tarefas — as gestoras do fluxo. */
export async function listarAprovadores() {
  const { data, error } = await supabase
    .from("permissoes_efetivas")
    .select("usuario_id")
    .eq("modulo", MODULO)
    .eq("pode_aprovar", true);
  if (error) throw error;
  return (data ?? []).map((linha) => linha.usuario_id).filter(Boolean);
}

/**
 * Botão "Concluir tarefa".
 *
 * Tarefa comum: grava status, carimbo de conclusão e observação final.
 * Tarefa marcada como importante: em vez de concluir direto, vai para
 * "em_analise" e as gestoras são avisadas de que há algo para aprovar.
 *
 * Quando a tarefa realmente se encerra e tem regra de repetição, a próxima
 * ocorrência é criada em seguida.
 */
export async function concluirTarefa(tarefa, usuarioId, observacao) {
  const texto = observacao?.trim() || null;
  const paraAprovacao = exigeAprovacao(tarefa);

  const alteracao = paraAprovacao
    ? { status: "em_analise", observacao_final: texto, aprovada: null, aprovada_por: null, aprovada_em: null }
    : {
        status: "concluida",
        concluida_em: new Date().toISOString(),
        concluida_por: usuarioId ?? null,
        observacao_final: texto,
      };

  const data = await comColunasDisponiveis((colunas) =>
    supabase.from("tarefas").update(camposSuportados(alteracao)).eq("id", tarefa.id).select(colunas).single(),
  );

  const avisoHistorico = await registrarHistorico(
    tarefa.id,
    usuarioId,
    paraAprovacao ? "enviou_para_aprovacao" : "concluiu",
    { status_anterior: tarefa.status, observacao_final: texto },
  );

  if (paraAprovacao) {
    await avisarAprovadores(data, usuarioId);
    return { tarefa: data, avisoHistorico, paraAprovacao: true, ocorrencia: null };
  }

  const { ocorrencia, aviso } = await gerarProximaOcorrencia(data, usuarioId);
  return {
    tarefa: data,
    avisoHistorico: avisoHistorico ?? aviso,
    paraAprovacao: false,
    ocorrencia,
  };
}

/** Aviso de "há tarefa aguardando aprovação" para quem pode aprovar. */
async function avisarAprovadores(tarefa, usuarioId) {
  try {
    const aprovadores = await listarAprovadores();
    return await notificar(
      aprovadores
        .filter((id) => id !== usuarioId)
        .map((id) => ({
          usuario_id: id,
          tarefa_id: tarefa.id,
          tipo: "tarefa_aguardando_aprovacao",
          mensagem: `A tarefa "${tarefa.titulo}" foi concluída e aguarda sua aprovação.`,
        })),
    );
  } catch (e) {
    return e.message ?? null;
  }
}

/**
 * "Aprovar": encerra a tarefa que estava em análise, guardando quem aprovou e
 * quando. A responsável é avisada e, se a tarefa se repete, a próxima
 * ocorrência é gerada agora — o ciclo só recomeça depois do aval.
 */
export async function aprovarTarefa(tarefa, usuarioId) {
  const agora = new Date().toISOString();
  const alteracao = {
    status: "concluida",
    aprovada: true,
    aprovada_por: usuarioId ?? null,
    aprovada_em: agora,
    concluida_em: tarefa.concluida_em ?? agora,
    concluida_por: tarefa.concluida_por ?? tarefa.responsavel_id ?? usuarioId ?? null,
  };

  const data = await comColunasDisponiveis((colunas) =>
    supabase.from("tarefas").update(camposSuportados(alteracao)).eq("id", tarefa.id).select(colunas).single(),
  );

  const avisoHistorico = await registrarHistorico(tarefa.id, usuarioId, "aprovou", {
    status_anterior: tarefa.status,
  });

  if (data.responsavel_id && data.responsavel_id !== usuarioId) {
    await notificar({
      usuario_id: data.responsavel_id,
      tarefa_id: data.id,
      tipo: "tarefa_aprovada",
      mensagem: `A tarefa "${data.titulo}" foi aprovada e está concluída.`,
    });
  }

  const { ocorrencia, aviso } = await gerarProximaOcorrencia(data, usuarioId);
  return { tarefa: data, avisoHistorico: avisoHistorico ?? aviso, ocorrencia };
}

/**
 * "Devolver para correção": o motivo é obrigatório, a tarefa volta para
 * "em andamento" e a responsável recebe a notificação com o motivo.
 */
export async function devolverTarefa(tarefa, usuarioId, motivo) {
  const texto = motivo?.trim();
  if (!texto) throw new Error("Informe o motivo da devolução.");

  const alteracao = {
    status: "em_andamento",
    aprovada: false,
    aprovada_por: null,
    aprovada_em: null,
    concluida_em: null,
    concluida_por: null,
  };

  const data = await comColunasDisponiveis((colunas) =>
    supabase.from("tarefas").update(camposSuportados(alteracao)).eq("id", tarefa.id).select(colunas).single(),
  );

  const avisoHistorico = await registrarHistorico(tarefa.id, usuarioId, "devolveu", {
    status_anterior: tarefa.status,
    motivo: texto,
  });

  if (data.responsavel_id && data.responsavel_id !== usuarioId) {
    await notificar({
      usuario_id: data.responsavel_id,
      tarefa_id: data.id,
      tipo: "tarefa_devolvida",
      mensagem: `A tarefa "${data.titulo}" foi devolvida para correção: ${texto}`,
    });
  }

  return { tarefa: data, avisoHistorico };
}

/* -------------------------------------------------------------------------
 * Delegação e compartilhamento
 * ---------------------------------------------------------------------- */

/** Troca a responsável pela tarefa e avisa quem recebeu. */
export async function delegarTarefa(tarefa, novoResponsavelId, usuarioId, nomeNovoResponsavel) {
  if (!novoResponsavelId || novoResponsavelId === tarefa.responsavel_id) {
    return { tarefa, avisoHistorico: null };
  }

  const data = await comColunasDisponiveis((colunas) =>
    supabase
      .from("tarefas")
      .update({ responsavel_id: novoResponsavelId })
      .eq("id", tarefa.id)
      .select(colunas)
      .single(),
  );

  const avisoHistorico = await registrarHistorico(tarefa.id, usuarioId, "delegou", {
    responsavel_anterior_id: tarefa.responsavel_id ?? null,
    responsavel_novo_id: novoResponsavelId,
    responsavel_novo_nome: nomeNovoResponsavel ?? data.responsavel?.nome_completo ?? null,
  });

  await notificarAtribuicao(data, usuarioId);

  return { tarefa: data, avisoHistorico };
}

/**
 * Quem acompanha a tarefa além da responsável. A tabela guarda só os ids; o
 * nome sai da lista de usuários que a tela já carrega.
 */
export async function listarCompartilhamentos(tarefaId) {
  const { data, error } = await supabase
    .from("tarefas_compartilhadas")
    .select("id, tarefa_id, usuario_id")
    .eq("tarefa_id", tarefaId);
  if (error) throw error;
  return data ?? [];
}

/** Ids das tarefas compartilhadas com uma pessoa (usado em "Minhas tarefas"). */
export async function listarTarefasCompartilhadasComigo(usuarioId) {
  if (!usuarioId) return [];
  const { data, error } = await supabase
    .from("tarefas_compartilhadas")
    .select("tarefa_id")
    .eq("usuario_id", usuarioId);
  if (error) throw error;
  return (data ?? []).map((linha) => linha.tarefa_id).filter(Boolean);
}

/**
 * Compartilha a tarefa com os usuários escolhidos (seleção múltipla). Quem já
 * estava na lista é ignorado, cada pessoa nova recebe uma notificação e a ação
 * fica registrada no histórico.
 */
export async function compartilharTarefa(tarefa, usuarioIds, usuarioId, nomesPorId = {}) {
  const jaCompartilhada = await listarCompartilhamentos(tarefa.id);
  const jaTem = new Set(jaCompartilhada.map((linha) => linha.usuario_id));
  const novos = [...new Set(usuarioIds ?? [])].filter((id) => id && !jaTem.has(id));

  if (novos.length === 0) return { adicionados: [], avisoHistorico: null };

  const { data, error } = await supabase
    .from("tarefas_compartilhadas")
    .insert(novos.map((id) => ({ tarefa_id: tarefa.id, usuario_id: id })))
    .select("id, tarefa_id, usuario_id");
  if (error) throw error;

  const nomes = novos.map((id) => nomesPorId[id]).filter(Boolean);
  const avisoHistorico = await registrarHistorico(tarefa.id, usuarioId, "compartilhou", {
    usuarios: novos,
    nomes,
  });

  await notificar(
    novos
      .filter((id) => id !== usuarioId)
      .map((id) => ({
        usuario_id: id,
        tarefa_id: tarefa.id,
        tipo: "tarefa_compartilhada",
        mensagem: `A tarefa "${tarefa.titulo}" foi compartilhada com você.`,
      })),
  );

  return { adicionados: data ?? [], avisoHistorico };
}

export async function removerCompartilhamento(compartilhamento, usuarioId, nome) {
  const { error } = await supabase.from("tarefas_compartilhadas").delete().eq("id", compartilhamento.id);
  if (error) throw error;

  return registrarHistorico(compartilhamento.tarefa_id, usuarioId, "removeu_compartilhamento", {
    usuario_id: compartilhamento.usuario_id,
    nome: nome ?? null,
  });
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

/**
 * Avisa quem acompanha a tarefa que entrou um comentário novo: a responsável,
 * quem criou a tarefa e as pessoas com quem ela foi compartilhada — menos quem
 * acabou de comentar.
 */
export async function notificarComentario(tarefa, autorId, nomeAutor) {
  if (!tarefa?.id) return null;

  let compartilhados = [];
  try {
    compartilhados = (await listarCompartilhamentos(tarefa.id)).map((linha) => linha.usuario_id);
  } catch {
    compartilhados = [];
  }

  const destinatarios = [...new Set([tarefa.responsavel_id, tarefa.criado_por, ...compartilhados])].filter(
    (id) => id && id !== autorId,
  );

  return notificar(
    destinatarios.map((id) => ({
      usuario_id: id,
      tarefa_id: tarefa.id,
      tipo: "tarefa_comentario",
      mensagem: `${nomeAutor ?? "Alguém"} comentou na tarefa "${tarefa.titulo}".`,
    })),
  );
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
