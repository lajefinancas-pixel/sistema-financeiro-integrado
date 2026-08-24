import { supabase } from "./supabaseClient";
import { erroAmigavel, mensagemAmigavel } from "./erros";

/**
 * Camada de dados da categoria BACKUP da tela de Configurações
 * (tabela public.backups_log).
 *
 * A tabela guarda TRÊS coisas, distinguidas pela coluna `tipo`:
 *
 *   'automatico'  -> execução da rotina agendada. Não tem autor: ninguém clicou
 *                    nada. Quem grava essas linhas é o backend, não esta tela.
 *   'manual'      -> execução pedida por alguém no botão "Gerar Backup Agora".
 *   'restauracao' -> solicitação de restauração registrada na tela, com
 *                    justificativa. Restaurar um banco não é coisa que uma
 *                    aplicação web faça: o registro documenta o pedido.
 *
 * ---------------------------------------------------------------------------
 * ATENÇÃO — o que "gerar backup" faz HOJE e o que ainda falta
 * ---------------------------------------------------------------------------
 * Nesta etapa, "Gerar Backup Agora" registra a execução e calcula um tamanho
 * APROXIMADO (contagem de linhas das tabelas principais × tamanho médio por
 * linha). Ele NÃO produz um arquivo de dump: um dump de verdade precisa de
 * credencial de serviço do banco, o que jamais pode viver no navegador.
 *
 * A geração real do arquivo depende de uma Edge Function do Supabase (rodando
 * com a service role key, gravando o arquivo em Storage e devolvendo o tamanho
 * verdadeiro), a ser configurada numa etapa técnica separada. Quando ela
 * existir, o único ponto a trocar é `executarBackup()` mais abaixo: o resto do
 * fluxo — abrir a linha 'em_andamento', fechar como 'concluido'/'falhou',
 * histórico, permissões — já está pronto para receber o número real.
 *
 * O mesmo vale para o backup automático: a rotina agendada é infraestrutura,
 * fora deste código. Enquanto ela não gravar nada, a tela diz honestamente
 * "nenhum registro" em vez de exibir uma data inventada.
 */

export const TABELA = "backups_log";

/** Quantos registros o histórico carrega de uma vez. */
export const LIMITE_HISTORICO = 50;

/** Justificativa mínima aceita em uma solicitação de restauração. */
export const MINIMO_JUSTIFICATIVA = 20;

/**
 * Janela prevista da rotina automática — valor informativo, exibido em
 * "Próximo backup automático". A execução em si é agendada na infraestrutura;
 * este horário é a referência combinada para ela.
 */
export const HORARIO_BACKUP_AUTOMATICO = { hora: 2, minuto: 0 };

/** "todo dia às 02:00" */
export function descricaoAgendamentoAutomatico() {
  const { hora, minuto } = HORARIO_BACKUP_AUTOMATICO;
  const doisDigitos = (n) => String(n).padStart(2, "0");
  return `todo dia às ${doisDigitos(hora)}:${doisDigitos(minuto)}`;
}

/** Próxima ocorrência do horário agendado, a partir de agora. */
export function proximoBackupAutomatico(agora = new Date()) {
  const { hora, minuto } = HORARIO_BACKUP_AUTOMATICO;
  const proximo = new Date(agora);
  proximo.setHours(hora, minuto, 0, 0);
  if (proximo <= agora) proximo.setDate(proximo.getDate() + 1);
  return proximo;
}

/* -------------------------------------------------------------------------
 * Rótulos e cores
 * ---------------------------------------------------------------------- */

// 'backup' é o tipo das linhas informativas gravadas antes desta etapa; fica na
// lista para que o histórico continue legível.
const TIPOS = {
  automatico: { label: "Automático", cor: "#0F2A44", bg: "#EEF2F6" },
  manual: { label: "Manual", cor: "#1D4ED8", bg: "#EAF1FF" },
  backup: { label: "Backup", cor: "#0F2A44", bg: "#EEF2F6" },
  restauracao: { label: "Restauração", cor: "#B91C1C", bg: "#FEF2F2" },
};

// 'registrado' e 'falha' também são valores antigos, mantidos pelo mesmo motivo.
const STATUS = {
  em_andamento: { label: "Em andamento", cor: "#A16207", bg: "#FEF7DF", simbolo: "…" },
  concluido: { label: "Concluído", cor: "#15803D", bg: "#EAFBF0", simbolo: "✓" },
  falhou: { label: "Falhou", cor: "#DC2626", bg: "#FEF2F2", simbolo: "⚠" },
  registrado: { label: "Registrado", cor: "#A16207", bg: "#FEF7DF", simbolo: "•" },
  falha: { label: "Falha", cor: "#DC2626", bg: "#FEF2F2", simbolo: "⚠" },
};

export function tipoInfo(valor) {
  return TIPOS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9" };
}

export function statusInfo(valor) {
  return STATUS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9", simbolo: "•" };
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

/** Só a data ("23/08/2026") — coluna "Data" do histórico. */
export function formatarData(valor) {
  if (!valor) return "--";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "--";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Só a hora ("02:00") — coluna "Hora" do histórico. */
export function formatarHora(valor) {
  if (!valor) return "--";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "--";
  return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** 1536000 -> "1,5 MB". Nulo vira "--": tamanho desconhecido não é zero. */
export function formatarTamanho(bytes) {
  if (bytes === null || bytes === undefined) return "--";
  const numero = Number(bytes);
  if (!Number.isFinite(numero) || numero < 0) return "--";
  if (numero < 1024) return `${numero} B`;

  const unidades = ["KB", "MB", "GB", "TB"];
  let valor = numero / 1024;
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }
  const casas = valor >= 100 ? 0 : 1;
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })} ${unidades[indice]}`;
}

/** Quanto tempo o backup levou, quando já terminou. */
export function duracaoLegivel(inicio, fim) {
  if (!inicio || !fim) return null;
  const decorrido = new Date(fim).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(decorrido) || decorrido < 0) return null;
  const segundos = Math.round(decorrido / 1000);
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  return `${minutos}min ${String(segundos % 60).padStart(2, "0")}s`;
}

/* -------------------------------------------------------------------------
 * Tolerância a banco desatualizado
 * ---------------------------------------------------------------------- */

/**
 * A tabela ainda não existe no banco? (migration não aplicada)
 *
 * 42P01 é o "relation does not exist" do Postgres; PGRST205 é a mesma situação
 * vista pelo PostgREST, que não encontra a tabela no schema publicado.
 */
function tabelaAusente(erro) {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

/**
 * As colunas desta etapa (iniciado_em, tamanho_bytes, ...) ainda não existem?
 *
 * 42703 é o "column does not exist"; PGRST204 é o PostgREST não achando a coluna
 * no schema cache. Nesse caso a tela ainda funciona em modo reduzido, lendo só
 * as colunas antigas — e avisa que a migration precisa ser aplicada.
 */
function colunaAusente(erro) {
  return erro?.code === "42703" || erro?.code === "PGRST204";
}

const COLUNAS_COMPLETAS =
  "id, tipo, status, descricao, justificativa, iniciado_em, concluido_em, tamanho_bytes, detalhes_erro, criado_em, usuarios ( id, nome_completo )";

const COLUNAS_LEGADO =
  "id, tipo, status, descricao, justificativa, criado_em, usuarios ( id, nome_completo )";

// Lembra, entre chamadas, se o banco já tem as colunas desta etapa — para não
// gastar uma consulta perdida a cada carregamento de tela.
let estruturaCompleta = null;

/**
 * Executa uma consulta na tabela tentando primeiro o formato completo e caindo
 * para o antigo quando o banco ainda não recebeu a migration.
 *
 * @param montar (query, completa) => query — aplica filtros e ordenação
 * @returns { data, error, completa }
 */
async function consultar(montar) {
  if (estruturaCompleta !== false) {
    const resposta = await montar(supabase.from(TABELA).select(COLUNAS_COMPLETAS), true);
    if (!resposta.error) {
      estruturaCompleta = true;
      return { ...resposta, completa: true };
    }
    if (!colunaAusente(resposta.error)) return { ...resposta, completa: true };
    estruturaCompleta = false;
  }

  const resposta = await montar(supabase.from(TABELA).select(COLUNAS_LEGADO), false);
  return { ...resposta, completa: false };
}

/** Forma única de registro usada pela tela, venha o banco completo ou antigo. */
function normalizar(linha, completa) {
  if (!linha) return null;
  return {
    id: linha.id,
    tipo: linha.tipo,
    status: linha.status,
    descricao: linha.descricao ?? null,
    justificativa: linha.justificativa ?? null,
    iniciadoEm: (completa ? linha.iniciado_em : null) ?? linha.criado_em ?? null,
    concluidoEm: completa ? linha.concluido_em ?? null : null,
    tamanhoBytes: completa ? linha.tamanho_bytes ?? null : null,
    detalhesErro: completa ? linha.detalhes_erro ?? null : null,
    criadoEm: linha.criado_em ?? null,
    usuario: linha.usuarios ?? null,
  };
}

/** Nome de quem gerou. Backup automático não tem autor — e isso é dito assim. */
export function nomeDoAutor(registro) {
  if (registro?.tipo === "automatico") return "Rotina automática";
  return registro?.usuario?.nome_completo || registro?.usuarios?.nome_completo || "Usuário não identificado";
}

/* -------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------- */

/**
 * Panorama da categoria: o último backup de cada tipo e o próximo agendado.
 *
 * @returns {
 *   disponivel,          // false quando a tabela ainda não existe no banco
 *   estruturaCompleta,   // false quando faltam as colunas desta etapa
 *   ultimoAutomatico,    // registro mais recente do tipo 'automatico', ou null
 *   ultimoManual,        // idem para 'manual'
 *   proximoAutomatico,   // Date prevista da próxima execução agendada
 *   totalRegistros,
 * }
 */
export async function resumoBackups() {
  const vazio = {
    disponivel: false,
    estruturaCompleta: false,
    ultimoAutomatico: null,
    ultimoManual: null,
    proximoAutomatico: proximoBackupAutomatico(),
    totalRegistros: 0,
  };

  const ordem = (query, completa) =>
    query.order(completa ? "iniciado_em" : "criado_em", { ascending: false });

  const automatico = await consultar((query, completa) =>
    ordem(query, completa).eq("tipo", "automatico").limit(1)
  );
  if (automatico.error) {
    if (tabelaAusente(automatico.error)) return vazio;
    throw erroAmigavel(
      mensagemAmigavel(automatico.error, "Não foi possível consultar os registros de backup.")
    );
  }

  const manual = await consultar((query, completa) =>
    ordem(query, completa).eq("tipo", "manual").limit(1)
  );
  if (manual.error) {
    if (tabelaAusente(manual.error)) return vazio;
    throw erroAmigavel(
      mensagemAmigavel(manual.error, "Não foi possível consultar os registros de backup.")
    );
  }

  // Contagem exata no banco (head: true não traz as linhas), para que o número
  // exibido seja o total real e não o tamanho da página consultada.
  let totalRegistros = 0;
  const contagem = await supabase
    .from(TABELA)
    .select("id", { count: "exact", head: true })
    .in("tipo", ["automatico", "manual", "backup"]);
  if (!contagem.error) totalRegistros = contagem.count ?? 0;

  return {
    disponivel: true,
    estruturaCompleta: automatico.completa && manual.completa,
    ultimoAutomatico: normalizar(automatico.data?.[0], automatico.completa),
    ultimoManual: normalizar(manual.data?.[0], manual.completa),
    proximoAutomatico: proximoBackupAutomatico(),
    totalRegistros,
  };
}

/** Histórico completo, dos mais recentes para os mais antigos. */
export async function listarRegistros({ limite = LIMITE_HISTORICO } = {}) {
  const resposta = await consultar((query, completa) =>
    query.order(completa ? "iniciado_em" : "criado_em", { ascending: false }).limit(limite)
  );

  if (resposta.error) {
    if (tabelaAusente(resposta.error)) {
      return { disponivel: false, estruturaCompleta: false, registros: [] };
    }
    throw erroAmigavel(
      mensagemAmigavel(resposta.error, "Não foi possível carregar o histórico de backups.")
    );
  }

  return {
    disponivel: true,
    estruturaCompleta: resposta.completa,
    registros: (resposta.data ?? []).map((linha) => normalizar(linha, resposta.completa)),
  };
}

/* -------------------------------------------------------------------------
 * Permissões da categoria
 * ---------------------------------------------------------------------- */

/**
 * As cinco permissões do módulo 'backup', concedidas separadamente pelo
 * Administrador na aba "Permissões" da tela de usuário.
 *
 * O sistema modela permissão como "cinco ações por módulo" (as colunas
 * pode_visualizar / pode_cadastrar / pode_editar / pode_excluir / pode_aprovar).
 * O Backup usa esse mesmo mecanismo com um módulo próprio; o mapa abaixo é o
 * significado de cada coluna nesta categoria, e é o mesmo enunciado na migration
 * 20260823180000 e em lib/permissoesUsuario.js.
 */
export const PERMISSOES_BACKUP = [
  { chave: "visualizar", campo: "pode_visualizar", label: "Visualizar backups" },
  { chave: "gerar", campo: "pode_cadastrar", label: "Gerar backup manual" },
  { chave: "historico", campo: "pode_aprovar", label: "Visualizar histórico" },
  { chave: "restaurar", campo: "pode_excluir", label: "Restaurar backup" },
  { chave: "administrar", campo: "pode_editar", label: "Administrar configurações de backup" },
];

const SEM_PERMISSAO = Object.fromEntries(PERMISSOES_BACKUP.map((p) => [p.chave, false]));

/**
 * Permissões efetivas do usuário no módulo 'backup'.
 *
 * `moduloDisponivel: false` significa que o banco ainda não conhece o módulo —
 * migration não aplicada. Nesse caso a tela cai no comportamento anterior
 * (permissão de edição em Administração), para não trancar quem já administrava
 * o sistema antes desta etapa.
 */
export async function carregarPermissoesBackup(usuarioId) {
  if (!usuarioId) return { ...SEM_PERMISSAO, moduloDisponivel: false };

  const campos = PERMISSOES_BACKUP.map((p) => p.campo).join(", ");
  const { data, error } = await supabase
    .from("permissoes_efetivas")
    .select(campos)
    .eq("usuario_id", usuarioId)
    .eq("modulo", "backup")
    .limit(1);

  if (error || !data?.[0]) return { ...SEM_PERMISSAO, moduloDisponivel: false };

  const linha = data[0];
  const resultado = { moduloDisponivel: true };
  PERMISSOES_BACKUP.forEach(({ chave, campo }) => {
    resultado[chave] = linha[campo] === true;
  });
  return resultado;
}

/* -------------------------------------------------------------------------
 * Geração de backup manual
 * ---------------------------------------------------------------------- */

/**
 * Tabelas consideradas no cálculo aproximado do tamanho, com uma média de bytes
 * por linha estimada a partir do número e do tipo de colunas de cada uma.
 *
 * Isto é uma ESTIMATIVA declarada, não uma medição: o tamanho real de um dump
 * depende de índices, texto livre, anexos e compactação. O número serve para dar
 * ordem de grandeza ao registro enquanto a Edge Function de backup — que devolve
 * o tamanho verdadeiro do arquivo — não estiver configurada.
 */
const TABELAS_ESTIMATIVA = [
  { tabela: "usuarios", bytesPorLinha: 900 },
  { tabela: "fornecedores", bytesPorLinha: 1400 },
  { tabela: "contas_bancarias", bytesPorLinha: 600 },
  { tabela: "saldos_historico", bytesPorLinha: 400 },
  { tabela: "pagamentos", bytesPorLinha: 1200 },
  { tabela: "pagamento_movimentacoes", bytesPorLinha: 500 },
  { tabela: "programacoes_pagamento", bytesPorLinha: 700 },
  { tabela: "certidoes", bytesPorLinha: 900 },
  { tabela: "tarefas", bytesPorLinha: 1100 },
  { tabela: "tarefas_historico", bytesPorLinha: 500 },
  { tabela: "auditoria_eventos", bytesPorLinha: 800 },
  { tabela: "notificacoes", bytesPorLinha: 400 },
];

/** Peso fixo do esquema (tabelas, índices, funções) no arquivo de backup. */
const OVERHEAD_ESTRUTURA_BYTES = 64 * 1024;

/**
 * Tamanho aproximado do backup: contagem real de linhas × média por linha.
 *
 * Tabela que não responde (não existe neste banco, sem permissão de leitura) é
 * simplesmente ignorada e contabilizada em `indisponiveis`, para que a estimativa
 * saia mesmo assim e a tela possa dizer o quanto ela é parcial.
 */
export async function estimarTamanhoBackup() {
  const resultados = await Promise.all(
    TABELAS_ESTIMATIVA.map(async ({ tabela, bytesPorLinha }) => {
      // "*" com head:true não traz linha nenhuma — só o total. Contar por "*"
      // em vez de por uma coluna evita depender de a tabela ter "id".
      const { count, error } = await supabase
        .from(tabela)
        .select("*", { count: "exact", head: true });
      if (error) return { tabela, ok: false, linhas: 0, bytes: 0 };
      const linhas = count ?? 0;
      return { tabela, ok: true, linhas, bytes: linhas * bytesPorLinha };
    })
  );

  const consultadas = resultados.filter((r) => r.ok);
  return {
    bytes: consultadas.reduce((total, r) => total + r.bytes, 0) + OVERHEAD_ESTRUTURA_BYTES,
    linhas: consultadas.reduce((total, r) => total + r.linhas, 0),
    tabelas: consultadas.length,
    indisponiveis: resultados.length - consultadas.length,
  };
}

/**
 * PONTO DE TROCA para a etapa técnica seguinte.
 *
 * Hoje: mede o banco e devolve um tamanho estimado, sem produzir arquivo algum.
 * Amanhã: uma chamada à Edge Function de backup do Supabase, que roda com a
 * service role key, gera o dump, grava no Storage e devolve o tamanho real —
 * algo como:
 *
 *   const { data, error } = await supabase.functions.invoke("gerar-backup");
 *   if (error) throw error;
 *   return { bytes: data.tamanho_bytes, ... };
 *
 * Nada mais do fluxo precisa mudar quando isso acontecer: quem abre e fecha a
 * linha em backups_log é `gerarBackupManual`, logo abaixo.
 */
async function executarBackup() {
  const estimativa = await estimarTamanhoBackup();
  return {
    bytes: estimativa.bytes,
    detalhe:
      `Tamanho estimado a partir de ${estimativa.linhas.toLocaleString("pt-BR")} registros ` +
      `em ${estimativa.tabelas} tabelas do sistema.`,
    parcial: estimativa.indisponiveis > 0,
  };
}

/** Abre a linha do backup manual como 'em_andamento'. */
export async function iniciarBackupManual({ usuarioId }) {
  if (!usuarioId) {
    throw erroAmigavel("Não foi possível identificar o usuário para registrar o backup.");
  }

  const { data, error } = await supabase
    .from(TABELA)
    .insert({
      tipo: "manual",
      status: "em_andamento",
      descricao: "Backup manual solicitado na tela de Configurações",
      usuario_id: usuarioId,
    })
    .select("id")
    .single();

  if (error) {
    if (tabelaAusente(error) || colunaAusente(error)) {
      throw erroAmigavel(
        "A estrutura de backup ainda não foi aplicada neste banco de dados. Peça a quem administra o ambiente para rodar a migration da categoria Backup."
      );
    }
    throw erroAmigavel(mensagemAmigavel(error, "Não foi possível iniciar o backup."));
  }

  return data.id;
}

/** Fecha a linha como 'concluido', com o tamanho apurado. */
export async function concluirBackupManual({ id, tamanhoBytes, descricao }) {
  const { error } = await supabase
    .from(TABELA)
    .update({
      status: "concluido",
      concluido_em: new Date().toISOString(),
      tamanho_bytes: Math.max(0, Math.round(tamanhoBytes ?? 0)),
      ...(descricao ? { descricao } : {}),
    })
    .eq("id", id);

  if (error) throw erroAmigavel(mensagemAmigavel(error, "Não foi possível concluir o backup."));
}

/**
 * Fecha a linha como 'falhou'. Nunca lança: já estamos tratando uma falha, e um
 * erro aqui não pode esconder o erro original de quem está na tela.
 */
export async function falharBackupManual({ id, detalhesErro }) {
  try {
    await supabase
      .from(TABELA)
      .update({
        status: "falhou",
        concluido_em: new Date().toISOString(),
        detalhes_erro: String(detalhesErro ?? "").slice(0, 1000) || "Falha não detalhada.",
      })
      .eq("id", id);
  } catch {
    // Sem o que fazer: a falha original é a que importa para quem está na tela.
  }
}

/**
 * "Gerar Backup Agora", do começo ao fim.
 *
 * Abre a linha 'em_andamento', executa o backup e fecha como 'concluido' com o
 * tamanho — ou como 'falhou' com o motivo, se algo der errado no meio. A linha
 * nunca fica pendurada em 'em_andamento' por causa de um erro tratável.
 *
 * @returns { tamanhoBytes, detalhe, parcial }
 */
export async function gerarBackupManual({ usuarioId }) {
  const id = await iniciarBackupManual({ usuarioId });

  try {
    const resultado = await executarBackup();
    await concluirBackupManual({
      id,
      tamanhoBytes: resultado.bytes,
      descricao: `Backup manual — ${resultado.detalhe}`,
    });
    return { tamanhoBytes: resultado.bytes, detalhe: resultado.detalhe, parcial: resultado.parcial };
  } catch (e) {
    await falharBackupManual({ id, detalhesErro: e?.message });
    throw e;
  }
}

/* -------------------------------------------------------------------------
 * Solicitação de restauração
 * ---------------------------------------------------------------------- */

/** A justificativa informada é aceitável? Devolve o texto limpo ou lança. */
export function justificativaValida(texto) {
  const justificativa = String(texto ?? "").trim().replace(/\s+/g, " ");
  if (justificativa.length < MINIMO_JUSTIFICATIVA) {
    throw erroAmigavel(
      `Descreva o motivo da restauração com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres. A justificativa fica registrada na Auditoria.`
    );
  }
  return justificativa;
}

/**
 * Registra a solicitação de restauração no histórico de backups.
 *
 * Nada é restaurado aqui: a restauração de um banco é feita na infraestrutura,
 * fora da aplicação. Este registro é o documento do pedido — e acompanha o
 * evento crítico gravado na trilha de auditoria pela própria tela.
 *
 * @returns null quando registrou; mensagem pronta para exibição quando falhou.
 */
export async function registrarSolicitacaoRestauracao({ justificativa, usuarioId }) {
  if (!usuarioId) return "A solicitação não pôde ser registrada no histórico de backups.";

  const { error } = await supabase.from(TABELA).insert({
    tipo: "restauracao",
    status: "registrado",
    descricao: "Solicitação de restauração registrada pela tela de Configurações",
    justificativa,
    usuario_id: usuarioId,
  });

  if (!error) return null;
  if (tabelaAusente(error)) {
    return "O histórico de backups ainda não existe no banco, então a solicitação foi registrada apenas na Auditoria.";
  }
  return mensagemAmigavel(error, "A solicitação não pôde ser registrada no histórico de backups.");
}

/* -------------------------------------------------------------------------
 * Vigilância do backup diário (alerta do Painel Principal)
 * ---------------------------------------------------------------------- */

/**
 * A partir de quantas horas sem backup concluído a rotina diária é considerada
 * não cumprida.
 *
 * A rotina roda uma vez por dia (HORARIO_BACKUP_AUTOMATICO). Esperar exatamente
 * 24 h acenderia o alerta enquanto a execução do dia ainda estivesse começando;
 * esperar 48 h deixaria um dia inteiro passar em silêncio. Trinta horas é o
 * meio-termo: um dia perdido acende o alerta já na manhã seguinte, e um atraso
 * de algumas horas na própria rotina não vira alarme falso.
 */
export const HORAS_SEM_BACKUP_AUTOMATICO = 30;

/** Motivos possíveis do alerta, com o texto de apoio de cada um. */
const MOTIVOS_ALERTA = {
  falhou:
    "A última execução da rotina automática terminou com falha e nenhum backup foi concluído depois dela.",
  atrasado:
    `Nenhum backup foi concluído nas últimas ${HORAS_SEM_BACKUP_AUTOMATICO} horas — a rotina diária não chegou ao fim no horário previsto.`,
  nunca:
    "Nenhuma execução da rotina automática de backup foi registrada no sistema até agora.",
};

export function motivoAlertaBackup(valor) {
  return MOTIVOS_ALERTA[valor] ?? null;
}

/** Instante de referência de um registro (início da execução). */
function instanteDoRegistro(registro) {
  const valor = registro?.iniciadoEm ?? registro?.criadoEm ?? null;
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * A rotina diária de backup está em dia?
 *
 * Responde à pergunta que o Painel Principal faz: existe hoje um backup válido,
 * ou alguém precisa ir olhar? Duas situações acendem o alerta:
 *
 *   1. o backup automático mais recente terminou com status 'falhou';
 *   2. não há nenhum backup concluído dentro da janela de vigilância — sinal de
 *      que a rotina agendada simplesmente não rodou.
 *
 * O que APAGA o alerta é a existência de um backup válido mais recente. "Válido"
 * é um registro concluído, automático OU manual: quem abre o alerta, vai em
 * Configurações → Backup e gera um backup manual resolveu de fato o problema que
 * o alerta aponta, e o painel precisa reconhecer isso.
 *
 * Uma execução automática ainda 'em_andamento' dentro da janela não é falha: a
 * rotina está rodando agora, e o alerta espera o desfecho.
 *
 * Nunca lança: o painel não pode quebrar por causa desta consulta. Quando a
 * tabela não existe ou a leitura falha, devolve `disponivel: false` e nenhum
 * alerta — afirmar que o backup falhou sem ter conseguido ler o registro seria
 * inventar informação.
 *
 * @returns { disponivel, alerta, motivo, ultimoAutomatico, ultimoValido }
 */
export async function situacaoBackupDiario({ agora = new Date() } = {}) {
  const semDados = {
    disponivel: false,
    alerta: false,
    motivo: null,
    ultimoAutomatico: null,
    ultimoValido: null,
  };

  const limite = new Date(agora.getTime() - HORAS_SEM_BACKUP_AUTOMATICO * 60 * 60 * 1000);
  const ordenar = (query, completa) =>
    query.order(completa ? "iniciado_em" : "criado_em", { ascending: false });

  let automatico;
  let concluidos;
  try {
    automatico = await consultar((query, completa) =>
      ordenar(query, completa).eq("tipo", "automatico").limit(1)
    );
    if (automatico.error) return semDados;

    concluidos = await consultar((query, completa) =>
      ordenar(query, completa).in("tipo", ["automatico", "manual"]).eq("status", "concluido").limit(1)
    );
    if (concluidos.error) return semDados;
  } catch {
    return semDados;
  }

  const ultimoAutomatico = normalizar(automatico.data?.[0], automatico.completa);
  const ultimoValido = normalizar(concluidos.data?.[0], concluidos.completa);

  const emQueAutomatico = instanteDoRegistro(ultimoAutomatico);
  const emQueValido = instanteDoRegistro(ultimoValido);

  const base = { disponivel: true, ultimoAutomatico, ultimoValido };

  // 1. A rotina falhou. Só um backup concluído DEPOIS da falha limpa o alerta.
  if (ultimoAutomatico?.status === "falhou") {
    const cobertoDepois = emQueValido && emQueAutomatico && emQueValido > emQueAutomatico;
    if (!cobertoDepois) return { ...base, alerta: true, motivo: "falhou" };
    return { ...base, alerta: false, motivo: null };
  }

  // 2. Existe backup concluído dentro da janela? Então está em dia.
  if (emQueValido && emQueValido >= limite) return { ...base, alerta: false, motivo: null };

  // 3. A execução automática começou há pouco e ainda não terminou: aguarda.
  if (
    ultimoAutomatico?.status === "em_andamento" &&
    emQueAutomatico &&
    emQueAutomatico >= limite
  ) {
    return { ...base, alerta: false, motivo: null };
  }

  return { ...base, alerta: true, motivo: ultimoAutomatico ? "atrasado" : "nunca" };
}

/* -------------------------------------------------------------------------
 * Permissões consultadas fora da tela de Configurações
 * ---------------------------------------------------------------------- */

/**
 * Pergunta ao banco o resultado de uma das funções de permissão da categoria
 * (public.pode_ver_backups / public.pode_gerar_backup_manual).
 *
 * Devolve null quando a função não existe neste banco (migration não aplicada)
 * ou a chamada falha — cabe a quem chamou decidir o que fazer nesse caso.
 */
async function perguntarAoBanco(funcao) {
  try {
    const { data, error } = await supabase.rpc(funcao);
    if (error) return null;
    return data === true;
  } catch {
    return null;
  }
}

/**
 * O usuário pode ver a situação dos backups? (mesma regra de pode_ver_backups())
 *
 * Usada pelo alerta do Painel Principal, que fica fora da tela de Configurações
 * e por isso precisa perguntar a permissão por conta própria. Sem ela o alerta
 * não aparece: para quem não enxerga backups, o RLS devolve zero registros, e
 * zero registros não podem ser lidos como "a rotina não rodou".
 */
export async function permissaoVerBackups(usuarioId) {
  const doBanco = await perguntarAoBanco("pode_ver_backups");
  if (doBanco !== null) return doBanco;

  if (!usuarioId) return false;

  const permissoes = await carregarPermissoesBackup(usuarioId);
  if (permissoes.moduloDisponivel && permissoes.visualizar) return true;

  // A mesma porta que a função do banco abre: quem já visualiza Administração
  // enxerga a situação dos backups, porque a categoria vive nas Configurações.
  const { data, error } = await supabase
    .from("permissoes_efetivas")
    .select("pode_visualizar")
    .eq("usuario_id", usuarioId)
    .eq("modulo", "administracao")
    .limit(1);

  if (error) return false;
  return data?.[0]?.pode_visualizar === true;
}

/**
 * O usuário pode gerar um backup manual? (mesma regra de pode_gerar_backup_manual())
 *
 * Usada pela opção "Criar backup antes de continuar" nas operações críticas.
 * Quando o banco ainda não conhece o módulo 'backup', devolve false: sem a
 * estrutura da categoria o insert seria recusado pelo RLS, e oferecer a opção
 * só levaria a pessoa a um erro no meio de uma operação crítica.
 */
export async function permissaoGerarBackupManual(usuarioId) {
  const doBanco = await perguntarAoBanco("pode_gerar_backup_manual");
  if (doBanco !== null) return doBanco;

  if (!usuarioId) return false;
  const permissoes = await carregarPermissoesBackup(usuarioId);
  return permissoes.moduloDisponivel === true && permissoes.gerar === true;
}
