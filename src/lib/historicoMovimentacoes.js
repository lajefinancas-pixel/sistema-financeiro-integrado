import { supabase } from "./supabaseClient";
import { mensagemAmigavel } from "./erros";

/**
 * Camada de dados da linha do tempo de movimentações da tela "Histórico".
 *
 * A linha do tempo junta duas trilhas que já existem no banco, sem criar tabela
 * nova e sem alterar nenhuma delas:
 *
 *   public.auditoria_eventos  -> cadastros, alterações e exclusões de saldos,
 *                                fornecedores, tarefas e usuários;
 *   public.tarefas_historico  -> conclusões de tarefa (a conclusão não passa
 *                                pela trilha de auditoria).
 *
 * Cada trilha tem a própria política de leitura (auditoria exige visualização em
 * 'auditoria'; o histórico de tarefas exige visualização em 'tarefas'), e é o
 * banco que decide o que a pessoa enxerga. Por isso as duas consultas são
 * independentes: se uma não estiver liberada, a outra continua aparecendo e a
 * tela mostra um aviso em vez de ficar vazia.
 *
 * Todos os filtros valem juntos (E, nunca OU) e são resolvidos no banco.
 */

const TABELA_EVENTOS = "auditoria_eventos";
const TABELA_CONCLUSOES = "tarefas_historico";

/** Quantas movimentações a linha do tempo mostra por página. */
export const POR_PAGINA = 20;

const COLUNAS_EVENTO =
  "id, data_hora, modulo, acao, registro_afetado, valor_anterior, valor_novo, usuarios ( id, nome_completo )";

const COLUNAS_CONCLUSAO =
  "id, criado_em, detalhes, usuario:usuarios ( id, nome_completo ), tarefa:tarefas!inner ( id, titulo, secretaria_relacionada )";

/** Módulos que a tela de Histórico acompanha. */
const MODULOS = {
  saldos: "Saldos",
  fornecedores: "Fornecedores",
  tarefas: "Tarefas",
  usuarios: "Usuários",
};

export const OPCOES_MODULO = Object.entries(MODULOS).map(([valor, label]) => ({ valor, label }));

export function moduloLabel(valor) {
  return MODULOS[valor] ?? valor ?? "--";
}

/**
 * Tipos de movimentação, como aparecem no select. Cada tipo é o recorte das
 * ações já gravadas nas trilhas:
 *
 *   acoes    -> valores de auditoria_eventos.acao que entram no tipo;
 *   modulos  -> quando o tipo só existe em um módulo (alteração de saldo);
 *   conclusao-> o tipo vem do histórico de tarefas, não da auditoria.
 */
const TIPOS = {
  cadastro: { label: "Cadastro", cor: "#16A34A", bg: "#EAF7EF", acoes: ["criou"] },
  alteracao: { label: "Alteração", cor: "#2563EB", bg: "#EAF1FF", acoes: ["alterou"] },
  exclusao: { label: "Exclusão", cor: "#DC2626", bg: "#FEF2F2", acoes: ["excluiu"] },
  conclusao_tarefa: { label: "Conclusão de tarefa", cor: "#7C3AED", bg: "#F3EDFE", conclusao: true },
  alteracao_saldo: {
    label: "Alteração de saldo",
    cor: "#A16207",
    bg: "#FEF7DF",
    acoes: ["alterou"],
    modulos: ["saldos"],
  },
};

export const OPCOES_TIPO = Object.entries(TIPOS).map(([valor, info]) => ({ valor, label: info.label }));

export function tipoInfo(valor) {
  return TIPOS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9" };
}

/** Módulos que guardam secretaria no registro — o filtro só se aplica a eles. */
export const MODULOS_COM_SECRETARIA = ["saldos", "fornecedores", "tarefas"];

export function moduloTemSecretaria(modulo) {
  return !modulo || MODULOS_COM_SECRETARIA.includes(modulo);
}

/** Estado inicial da área de filtros (e o resultado do "Limpar Filtros"). */
export const FILTROS_VAZIOS = {
  dataInicial: "",
  dataFinal: "",
  usuarioId: "",
  secretaria: "",
  modulo: "",
  tipo: "",
};

export function filtroPreenchido(filtros) {
  return Object.keys(FILTROS_VAZIOS).some((campo) => String(filtros?.[campo] ?? "").trim() !== "");
}

/** Quantos filtros estão em uso — vira o número mostrado ao lado do título. */
export function quantidadeDeFiltros(filtros) {
  return Object.keys(FILTROS_VAZIOS).filter((campo) => String(filtros?.[campo] ?? "").trim() !== "").length;
}

/* -------------------------------------------------------------------------
 * Datas
 * ---------------------------------------------------------------------- */

/** Data no formato aceito pelo input type="date", no fuso de quem está usando. */
function paraISO(data) {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

export function hojeISO() {
  return paraISO(new Date());
}

/** Data de N dias atrás (0 = hoje), usada pelos atalhos de período. */
export function diasAtrasISO(dias) {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  return paraISO(data);
}

/**
 * Início e fim do dia escolhido como instante: as colunas de data são
 * timestamptz, então o intervalo precisa ir para o banco já resolvido.
 */
function inicioDoDia(dataISO) {
  const data = new Date(`${dataISO}T00:00:00`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function fimDoDia(dataISO) {
  const data = new Date(`${dataISO}T23:59:59.999`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
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

/** Dia da movimentação, para agrupar a linha do tempo por data. */
export function diaDaMovimentacao(valor) {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "" : paraISO(data);
}

export function formatarDia(diaISO) {
  if (!diaISO) return "--";
  const data = new Date(`${diaISO}T00:00:00`);
  if (Number.isNaN(data.getTime())) return "--";
  const texto = data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  if (diaISO === hojeISO()) return `Hoje — ${texto}`;
  if (diaISO === diasAtrasISO(1)) return `Ontem — ${texto}`;
  return texto;
}

/* -------------------------------------------------------------------------
 * Listas dos selects
 * ---------------------------------------------------------------------- */

export async function listarUsuariosParaFiltro() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome_completo")
    .order("nome_completo");
  if (error) throw error;
  return data ?? [];
}

export async function listarSecretariasParaFiltro() {
  const { data, error } = await supabase
    .from("secretarias")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome");
  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------------------------------------
 * Consultas
 * ---------------------------------------------------------------------- */

/**
 * Valor pronto para entrar em um filtro `or` do PostgREST: as aspas duplas
 * permitem espaços, vírgulas e parênteses no nome da secretaria.
 */
function valorCitado(texto) {
  return `"${String(texto).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Módulos e ações que sobram depois de cruzar o filtro de módulo com o filtro de
 * tipo. `null` significa que o recorte escolhido não existe na auditoria (por
 * exemplo: tipo "Conclusão de tarefa"), e a consulta nem chega a ser feita.
 */
function recorteDaAuditoria(f) {
  const tipo = f.tipo ? TIPOS[f.tipo] : null;
  if (f.tipo && (!tipo || tipo.conclusao)) return null;

  const permitidos = tipo?.modulos ?? Object.keys(MODULOS);
  const modulos = f.modulo ? permitidos.filter((m) => m === f.modulo) : permitidos;
  if (modulos.length === 0) return null;

  return { modulos, acoes: tipo?.acoes ?? ["criou", "alterou", "excluiu"] };
}

function aplicarPeriodo(consulta, f, coluna) {
  const de = f.dataInicial ? inicioDoDia(f.dataInicial) : null;
  const ate = f.dataFinal ? fimDoDia(f.dataFinal) : null;
  let q = consulta;
  if (de) q = q.gte(coluna, de);
  if (ate) q = q.lte(coluna, ate);
  return q;
}

/**
 * Consulta da trilha de auditoria com os filtros aplicados, ou null quando o
 * recorte escolhido não pode ter eventos de auditoria.
 *
 * A secretaria não é uma coluna da trilha: ela aparece no registro afetado
 * ("Secretaria — Banco · Conta", em saldos) ou no estado gravado do registro
 * (valor_novo/valor_anterior, em fornecedores e saldos). O filtro procura nos
 * três lugares ao mesmo tempo.
 */
function consultaDeEventos(f, { contar = false } = {}) {
  const recorte = recorteDaAuditoria(f);
  if (!recorte) return null;
  if (f.secretaria && f.modulo === "usuarios") return null;

  const base = supabase.from(TABELA_EVENTOS);
  let q = contar ? base.select("id", { count: "exact", head: true }) : base.select(COLUNAS_EVENTO);

  q = q.in("modulo", recorte.modulos).in("acao", recorte.acoes).eq("resultado", "sucesso");
  q = aplicarPeriodo(q, f, "data_hora");
  if (f.usuarioId) q = q.eq("usuario_id", f.usuarioId);
  if (f.secretaria) {
    const alvo = valorCitado(`%${f.secretaria}%`);
    q = q.or(
      [
        `registro_afetado.ilike.${alvo}`,
        `valor_novo->>secretaria.ilike.${alvo}`,
        `valor_anterior->>secretaria.ilike.${alvo}`,
      ].join(","),
    );
  }
  return q;
}

/** Consulta das conclusões de tarefa, ou null quando o recorte as exclui. */
function consultaDeConclusoes(f, { contar = false } = {}) {
  if (f.modulo && f.modulo !== "tarefas") return null;
  if (f.tipo && f.tipo !== "conclusao_tarefa") return null;

  const base = supabase.from(TABELA_CONCLUSOES);
  let q = contar
    ? base.select("id, tarefa:tarefas!inner ( id )", { count: "exact", head: true })
    : base.select(COLUNAS_CONCLUSAO);

  q = q.eq("acao", "concluiu");
  q = aplicarPeriodo(q, f, "criado_em");
  if (f.usuarioId) q = q.eq("usuario_id", f.usuarioId);
  if (f.secretaria) q = q.eq("tarefa.secretaria_relacionada", f.secretaria);
  return q;
}

/** Secretaria mostrada na linha do tempo, quando o registro carrega uma. */
function secretariaDoEvento(evento) {
  const gravada = evento?.valor_novo?.secretaria ?? evento?.valor_anterior?.secretaria;
  if (gravada) return String(gravada);
  // Contas bancárias entram na trilha como "Secretaria — Banco · Conta".
  if (evento?.modulo === "saldos" && typeof evento?.registro_afetado === "string") {
    const [inicio, resto] = evento.registro_afetado.split(" — ");
    if (resto) return inicio;
  }
  return null;
}

/** Tipo de movimentação de um evento da auditoria. */
function tipoDoEvento(evento) {
  if (evento.modulo === "saldos" && evento.acao === "alterou") return "alteracao_saldo";
  if (evento.acao === "criou") return "cadastro";
  if (evento.acao === "excluiu") return "exclusao";
  return "alteracao";
}

function eventoParaMovimentacao(evento) {
  return {
    id: `auditoria:${evento.id}`,
    instante: evento.data_hora,
    modulo: evento.modulo,
    tipo: tipoDoEvento(evento),
    usuario: evento.usuarios?.nome_completo || "Usuário não identificado",
    registro: evento.registro_afetado || "Registro não identificado",
    secretaria: secretariaDoEvento(evento),
    detalhe: null,
  };
}

function conclusaoParaMovimentacao(registro) {
  const observacao = registro?.detalhes?.observacao_final ?? null;
  return {
    id: `tarefa:${registro.id}`,
    instante: registro.criado_em,
    modulo: "tarefas",
    tipo: "conclusao_tarefa",
    usuario: registro.usuario?.nome_completo || "Usuário não identificado",
    registro: registro.tarefa?.titulo ? `Tarefa "${registro.tarefa.titulo}"` : "Tarefa concluída",
    secretaria: registro.tarefa?.secretaria_relacionada ?? null,
    detalhe: observacao ? `Observação final: ${observacao}` : null,
  };
}

function instanteEm(movimentacao) {
  const data = new Date(movimentacao.instante);
  return Number.isNaN(data.getTime()) ? 0 : data.getTime();
}

/**
 * Página da linha do tempo, da movimentação mais recente para a mais antiga.
 *
 * Como as duas trilhas são tabelas diferentes, a paginação é feita sobre a
 * junção: cada consulta traz o suficiente para cobrir todas as páginas já
 * abertas e o corte acontece depois da ordenação por data/hora.
 *
 * @param pagina  índice da página, começando em 0
 * @param filtros { dataInicial, dataFinal, usuarioId, secretaria, modulo, tipo }
 * @returns { movimentacoes, temMais, avisos }
 */
export async function listarMovimentacoes({ pagina = 0, porPagina = POR_PAGINA, filtros = null } = {}) {
  const f = { ...FILTROS_VAZIOS, ...(filtros ?? {}) };
  const teto = (pagina + 1) * porPagina;
  // Um a mais que o teto revela se ainda existe movimentação depois desta página.
  const limite = teto + 1;

  const consultaEventos = consultaDeEventos(f);
  const consultaConclusoes = consultaDeConclusoes(f);

  const [eventos, conclusoes] = await Promise.all([
    consultaEventos
      ? consultaEventos.order("data_hora", { ascending: false }).limit(limite)
      : Promise.resolve({ data: [], error: null }),
    consultaConclusoes
      ? consultaConclusoes.order("criado_em", { ascending: false }).limit(limite)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // As duas trilhas falharam: não há o que mostrar, a tela exibe o erro.
  if (eventos.error && conclusoes.error) throw eventos.error;

  const avisos = [];
  if (eventos.error) {
    avisos.push(
      mensagemAmigavel(
        eventos.error,
        "Os cadastros, alterações e exclusões não puderam ser carregados; as conclusões de tarefa continuam na lista.",
      ),
    );
  }
  if (conclusoes.error) {
    avisos.push(
      mensagemAmigavel(
        conclusoes.error,
        "As conclusões de tarefa não puderam ser carregadas; as demais movimentações continuam na lista.",
      ),
    );
  }

  const juntas = [
    ...(eventos.data ?? []).map(eventoParaMovimentacao),
    ...(conclusoes.data ?? []).map(conclusaoParaMovimentacao),
  ].sort((a, b) => instanteEm(b) - instanteEm(a));

  return { movimentacoes: juntas.slice(0, teto), temMais: juntas.length > teto, avisos };
}

/**
 * Quantas movimentações atendem a um recorte — é o número dos cards de acesso
 * rápido. A contagem é feita no banco (head + count) e devolve null quando a
 * leitura não está liberada, para o card aparecer sem número em vez de sumir.
 */
export async function contarMovimentacoes(filtros = null) {
  const f = { ...FILTROS_VAZIOS, ...(filtros ?? {}) };
  const consultaEventos = consultaDeEventos(f, { contar: true });
  const consultaConclusoes = consultaDeConclusoes(f, { contar: true });

  const [eventos, conclusoes] = await Promise.all([
    consultaEventos ?? Promise.resolve({ count: 0, error: null }),
    consultaConclusoes ?? Promise.resolve({ count: 0, error: null }),
  ]);

  if (eventos.error && conclusoes.error) return null;
  return (eventos.error ? 0 : (eventos.count ?? 0)) + (conclusoes.error ? 0 : (conclusoes.count ?? 0));
}

/* -------------------------------------------------------------------------
 * Cards de acesso rápido
 * ---------------------------------------------------------------------- */

/**
 * Atalhos do topo da tela. Cada um é um conjunto de filtros: clicar preenche a
 * área de filtros e consulta, em vez de abrir uma lista à parte.
 */
export const ATALHOS = [
  {
    chave: "hoje",
    titulo: "Alterações de hoje",
    descricao: "Tudo o que foi movimentado no dia de hoje",
    icone: "hoje",
    filtros: () => ({ ...FILTROS_VAZIOS, dataInicial: hojeISO(), dataFinal: hojeISO() }),
  },
  {
    chave: "semana",
    titulo: "Últimos 7 dias",
    descricao: "As movimentações da última semana",
    icone: "semana",
    filtros: () => ({ ...FILTROS_VAZIOS, dataInicial: diasAtrasISO(6), dataFinal: hojeISO() }),
  },
  {
    chave: "saldos",
    titulo: "Alterações de saldo",
    descricao: "Saldos de contas que mudaram de valor",
    icone: "saldos",
    filtros: () => ({ ...FILTROS_VAZIOS, modulo: "saldos", tipo: "alteracao_saldo" }),
  },
  {
    chave: "tarefas",
    titulo: "Tarefas concluídas",
    descricao: "Conclusões registradas pela equipe",
    icone: "tarefas",
    filtros: () => ({ ...FILTROS_VAZIOS, modulo: "tarefas", tipo: "conclusao_tarefa" }),
  },
];

/** O atalho é exatamente o recorte que está valendo na consulta? */
export function atalhoAtivo(atalho, aplicados) {
  const alvo = atalho.filtros();
  return Object.keys(FILTROS_VAZIOS).every(
    (campo) => String(alvo[campo] ?? "") === String(aplicados?.[campo] ?? ""),
  );
}
