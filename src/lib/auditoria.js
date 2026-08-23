import { supabase } from "./supabaseClient";
import { mensagemAmigavel } from "./erros";

/**
 * Camada de dados da trilha de auditoria (tabela public.auditoria_eventos,
 * criada pela migration 20260811130000_auditoria_eventos.sql).
 *
 * A tabela é somente-inserção e somente-leitura: nenhuma tela altera ou apaga
 * um evento, e a consulta só abre para quem tem pode_visualizar no módulo
 * 'auditoria'.
 *
 * Regra de ouro do registro: auditar NUNCA derruba a ação principal. Se o
 * insert falhar (rede, permissão, tabela ainda não criada no banco),
 * `registrarEvento` devolve uma mensagem e a tela segue como antes.
 */

export const TABELA = "auditoria_eventos";

/** Quantos eventos a tela carrega por vez ("Carregar mais" traz o próximo lote). */
export const POR_PAGINA = 30;

// Cores dos níveis: informação=azul, atenção=amarelo, crítico=vermelho.
const NIVEIS = {
  informacao: { label: "Informação", cor: "#2563EB", bg: "#EAF1FF", ponto: "#2563EB" },
  atencao: { label: "Atenção", cor: "#A16207", bg: "#FEF7DF", ponto: "#CA8A04" },
  critico: { label: "Crítico", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
};

export function nivelInfo(valor) {
  return NIVEIS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9", ponto: "#94A3B8" };
}

/** Um evento crítico ganha destaque próprio na lista (ícone de alerta). */
export function eventoCritico(evento) {
  return evento?.nivel === "critico";
}

const MODULOS = {
  saldos: "Saldos",
  fornecedores: "Fornecedores",
  pagamentos: "Pagamentos",
  tributario: "Tributário",
  certidoes: "Certidões",
  relatorios: "Relatórios",
  auditoria: "Auditoria",
  administracao: "Administração",
  usuarios: "Usuários",
  tarefas: "Tarefas",
  acesso: "Acesso",
};

export function moduloLabel(valor) {
  return MODULOS[valor] ?? valor ?? "--";
}

const ACOES = {
  criou: "Criou",
  alterou: "Alterou",
  excluiu: "Excluiu",
  aprovou: "Aprovou",
  rejeitou: "Rejeitou",
  // Certidões: renovar preserva a emissão anterior como histórico, e mudar a
  // situação à mão (ex.: "Em renovação") é uma decisão de quem acompanha o
  // documento — as duas ficam distinguíveis na trilha.
  renovou_certidao: "Renovou certidão",
  alterou_situacao: "Alterou a situação",
  // Lixeira do sistema (Configurações > Sistema): desfazer a exclusão lógica ou
  // concluí-la apagando a linha do banco. A segunda é sempre nível crítico.
  restaurou: "Restaurou da Lixeira",
  excluiu_definitivamente: "Excluiu definitivamente",
  login: "Entrou no sistema",
  logout: "Saiu do sistema",
  exportou_auditoria: "Exportou relatório de auditoria",
  restauracao_backup: "Solicitou restauração de backup",
};

export function acaoLabel(valor) {
  return ACOES[valor] ?? valor ?? "--";
}

export function resultadoLabel(valor) {
  if (valor === "falha") return "Falha";
  return "Sucesso";
}

/** Opções dos selects de filtro, na ordem em que aparecem na tela. */
function opcoes(dicionario) {
  return Object.entries(dicionario).map(([valor, label]) => ({ valor, label }));
}

export const OPCOES_MODULO = opcoes(MODULOS);
export const OPCOES_ACAO = opcoes(ACOES);
export const OPCOES_NIVEL = Object.entries(NIVEIS).map(([valor, info]) => ({ valor, label: info.label }));
export const OPCOES_RESULTADO = [
  { valor: "sucesso", label: "Sucesso" },
  { valor: "falha", label: "Falha" },
];

/** Estado inicial (e o "Limpar Filtros") da área de consulta. */
export const FILTROS_VAZIOS = {
  dataInicial: "",
  dataFinal: "",
  usuarioId: "",
  modulo: "",
  acao: "",
  nivel: "",
  resultado: "",
  busca: "",
  // Instante (ISO) a partir do qual os eventos entram. Não existe no formulário
  // de filtros: quem preenche é o atalho do alerta de ações críticas, que precisa
  // de uma janela em horas ("últimas 24 horas") e não em dias.
  desde: "",
};

/** Algum filtro está preenchido? (usado no contador e no aviso de "nada encontrado") */
export function filtroPreenchido(filtros) {
  return Object.keys(FILTROS_VAZIOS).some((campo) => String(filtros?.[campo] ?? "").trim() !== "");
}

/** Quantos filtros estão em uso — vira o número no botão de filtros. */
export function quantidadeDeFiltros(filtros) {
  return Object.keys(FILTROS_VAZIOS).filter((campo) => String(filtros?.[campo] ?? "").trim() !== "").length;
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

/**
 * Id do usuário logado em public.usuarios.
 *
 * As telas de cadastro não recebem esse id por props; para não mudar o
 * comportamento visual delas, a trilha descobre o usuário por conta própria e
 * guarda o resultado por sessão (a política de insert exige que o usuario_id
 * seja exatamente o da sessão). Sair do sistema recarrega a página, então o
 * cache nunca sobrevive a uma troca de usuário.
 */
let usuarioEmCache = null;

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

/**
 * Grava um evento na trilha de auditoria.
 *
 * @param modulo           'saldos' | 'fornecedores' | 'usuarios' | 'pagamentos' | 'tarefas' | ...
 * @param acao             'criou' | 'alterou' | 'excluiu' | 'aprovou' | 'rejeitou' | 'login' | 'logout'
 * @param registroAfetado  descrição do registro, ex: "Fornecedor XYZ LTDA"
 * @param valorAnterior    jsonb com o estado antes (opcional)
 * @param valorNovo        jsonb com o estado depois (opcional)
 * @param resultado        'sucesso' (padrão) ou 'falha'
 * @param nivel            'informacao' (padrão), 'atencao' ou 'critico'
 * @param usuarioId        id em public.usuarios; quando omitido, é descoberto aqui
 *
 * @returns null quando registrou; mensagem pronta para exibição quando falhou.
 */
export async function registrarEvento({
  modulo,
  acao,
  registroAfetado = null,
  valorAnterior = null,
  valorNovo = null,
  resultado = "sucesso",
  nivel = "informacao",
  usuarioId = null,
}) {
  try {
    const autor = usuarioId ?? (await usuarioAtualId());
    if (!autor) return "Esta ação não pôde ser registrada na auditoria do sistema.";

    const { error } = await supabase.from(TABELA).insert({
      usuario_id: autor,
      modulo,
      acao,
      registro_afetado: registroAfetado,
      valor_anterior: valorAnterior,
      valor_novo: valorNovo,
      resultado,
      nivel,
    });
    if (error) throw error;
    return null;
  } catch (e) {
    return mensagemAmigavel(e, "Esta ação não pôde ser registrada na auditoria do sistema.");
  }
}

/**
 * Início e fim do dia escolhido, no fuso de quem está consultando: a coluna
 * data_hora é timestamptz, então o intervalo vai para o banco como instante.
 */
function inicioDoDia(dataISO) {
  const data = new Date(`${dataISO}T00:00:00`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function fimDoDia(dataISO) {
  const data = new Date(`${dataISO}T23:59:59.999`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/**
 * Valor pronto para entrar em um filtro `or` do PostgREST. As aspas duplas
 * permitem vírgulas e parênteses no texto pesquisado (o registro afetado dos
 * eventos de usuários é "Nome (e-mail)", por exemplo).
 */
function valorCitado(texto) {
  return `"${String(texto).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Ids dos usuários cujo nome casa parcialmente com o termo pesquisado. A busca
 * livre procura em duas frentes (nome de quem agiu e registro afetado) e o nome
 * mora em outra tabela, por isso ele é resolvido antes da consulta principal.
 * Se a leitura de usuários não estiver disponível, a busca segue só pelo
 * registro afetado em vez de falhar.
 */
async function idsDeUsuariosPorNome(termo) {
  try {
    const { data, error } = await supabase
      .from("usuarios")
      .select("id")
      .ilike("nome_completo", `%${termo}%`);
    if (error) throw error;
    return (data ?? []).map((u) => u.id).filter(Boolean);
  } catch {
    return [];
  }
}

/** Usuários para o select de filtro (todos os cadastros, em ordem alfabética). */
export async function listarUsuariosParaFiltro() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome_completo")
    .order("nome_completo");
  if (error) throw error;
  return data ?? [];
}

/**
 * Lote de eventos para a tela de consulta, do mais recente para o mais antigo.
 *
 * Todos os filtros são aplicados no banco e se combinam entre si (E, nunca OU):
 * um período com módulo "saldos" e nível "crítico" traz apenas os eventos que
 * atendem às três condições. A única exceção interna é a busca livre, que
 * procura ao mesmo tempo no nome de quem agiu e no registro afetado.
 *
 * @param pagina  índice do lote, começando em 0
 * @param filtros { dataInicial, dataFinal, usuarioId, modulo, acao, nivel, resultado, busca }
 * @returns { eventos, temMais }
 */
export async function listarEventos({ pagina = 0, porPagina = POR_PAGINA, filtros = null } = {}) {
  const inicio = pagina * porPagina;
  // Pede um a mais que o lote para saber se ainda existe algo depois dele.
  const fim = inicio + porPagina;

  let consulta = supabase
    .from(TABELA)
    .select(
      "id, data_hora, modulo, acao, registro_afetado, valor_anterior, valor_novo, resultado, nivel, usuarios ( id, nome_completo )",
    );

  const f = filtros ?? {};
  const de = f.dataInicial ? inicioDoDia(f.dataInicial) : null;
  const ate = f.dataFinal ? fimDoDia(f.dataFinal) : null;
  if (de) consulta = consulta.gte("data_hora", de);
  if (ate) consulta = consulta.lte("data_hora", ate);
  // Janela em horas do alerta de ações críticas; soma-se ao período, quando os dois vêm juntos.
  if (f.desde) consulta = consulta.gte("data_hora", f.desde);
  if (f.usuarioId) consulta = consulta.eq("usuario_id", f.usuarioId);
  if (f.modulo) consulta = consulta.eq("modulo", f.modulo);
  if (f.acao) consulta = consulta.eq("acao", f.acao);
  if (f.nivel) consulta = consulta.eq("nivel", f.nivel);
  if (f.resultado) consulta = consulta.eq("resultado", f.resultado);

  const termo = String(f.busca ?? "").trim();
  if (termo) {
    const alvo = `%${termo}%`;
    const ids = await idsDeUsuariosPorNome(termo);
    consulta = ids.length
      ? consulta.or(`registro_afetado.ilike.${valorCitado(alvo)},usuario_id.in.(${ids.join(",")})`)
      : consulta.ilike("registro_afetado", alvo);
  }

  const { data, error } = await consulta.order("data_hora", { ascending: false }).range(inicio, fim);
  if (error) throw error;

  const lote = data ?? [];
  return { eventos: lote.slice(0, porPagina), temMais: lote.length > porPagina };
}

/** Nome de quem fez a ação, já com o texto de apoio para eventos sem autor. */
export function nomeDoAutor(evento) {
  return evento?.usuarios?.nome_completo || "Usuário não identificado";
}

// ---------------------------------------------------------------------------
// Alerta de ações críticas recentes
// ---------------------------------------------------------------------------

/** Janela do destaque que abre a lista de Auditoria. */
export const HORAS_ALERTA_CRITICO = 24;

/** Instante de início da janela do alerta, em ISO (o que vai para o banco). */
function inicioDaJanela(horas, agora = new Date()) {
  return new Date(agora.getTime() - horas * 60 * 60 * 1000).toISOString();
}

/**
 * Quantos eventos de nível 'critico' foram registrados nas últimas horas.
 *
 * A contagem é feita no banco (head + count), sem trazer os eventos, e ignora os
 * filtros da tela: o alerta avisa sobre o sistema inteiro, não sobre o recorte
 * que está sendo consultado. A leitura passa pela mesma política de select, então
 * quem não tem permissão de auditoria também não conta eventos.
 */
export async function contarCriticosRecentes({ horas = HORAS_ALERTA_CRITICO } = {}) {
  const desde = inicioDaJanela(horas);
  const { count, error } = await supabase
    .from(TABELA)
    .select("id", { count: "exact", head: true })
    .eq("nivel", "critico")
    .gte("data_hora", desde);
  if (error) throw error;
  return { total: count ?? 0, desde };
}

/** Filtros que deixam na lista apenas as ações críticas da janela do alerta. */
export function filtrosCriticosRecentes({ horas = HORAS_ALERTA_CRITICO, desde = null } = {}) {
  return { ...FILTROS_VAZIOS, nivel: "critico", desde: desde ?? inicioDaJanela(horas) };
}

/** O atalho do alerta está valendo, sozinho, na consulta atual? */
export function ehFiltroCriticosRecentes(filtros) {
  if (filtros?.nivel !== "critico" || String(filtros?.desde ?? "").trim() === "") return false;
  // Com qualquer outro filtro por cima, a lista já não é mais "só as críticas recentes".
  return Object.keys(FILTROS_VAZIOS)
    .filter((campo) => campo !== "nivel" && campo !== "desde")
    .every((campo) => String(filtros?.[campo] ?? "").trim() === "");
}

// ---------------------------------------------------------------------------
// Exportação da trilha
// ---------------------------------------------------------------------------

/** Teto de eventos por documento exportado (impressão, PDF ou planilha). */
export const LIMITE_EXPORTACAO = 2000;

/** Tamanho de cada consulta da exportação, para não pedir tudo de uma vez. */
const LOTE_EXPORTACAO = 500;

/**
 * Todos os eventos que atendem aos filtros aplicados, para gerar o documento.
 *
 * A tela mostra a trilha em lotes de 30 ("Carregar mais"), mas o relatório precisa
 * do recorte completo: os lotes são buscados em sequência até acabarem ou até o
 * teto de segurança. `limitado` avisa que o documento saiu com os eventos mais
 * recentes do recorte, e não com todos.
 *
 * @returns { eventos, limitado }
 */
export async function listarEventosParaExportacao({ filtros = null, limite = LIMITE_EXPORTACAO } = {}) {
  const eventos = [];
  let pagina = 0;
  let temMais = true;

  while (temMais && eventos.length < limite) {
    const lote = await listarEventos({ pagina, porPagina: LOTE_EXPORTACAO, filtros });
    eventos.push(...lote.eventos);
    temMais = lote.temMais;
    pagina += 1;
  }

  return { eventos: eventos.slice(0, limite), limitado: temMais || eventos.length > limite };
}

/** Como cada formato de exportação é descrito na trilha. */
const FORMATOS_EXPORTACAO = {
  impressao: "Impressão",
  pdf: "PDF",
  excel: "Excel",
};

export function formatoExportacaoLabel(formato) {
  return FORMATOS_EXPORTACAO[formato] ?? "Documento";
}

/**
 * Registra na própria trilha que um relatório de auditoria foi emitido.
 *
 * Consultar a auditoria é uma ação sensível: quem exportou, quando, com quais
 * filtros e quantos eventos saíram ficam gravados como 'atencao'. Vale a regra de
 * ouro do módulo — se o registro falhar, o documento já foi gerado e a tela apenas
 * avisa.
 *
 * @returns null quando registrou; mensagem pronta para exibição quando falhou.
 */
export function registrarExportacaoAuditoria({
  formato,
  periodo = "",
  filtros = "",
  quantidade = 0,
  limitado = false,
  usuarioId = null,
}) {
  const rotulo = formatoExportacaoLabel(formato);
  return registrarEvento({
    modulo: "auditoria",
    acao: "exportou_auditoria",
    nivel: "atencao",
    registroAfetado: `Relatório de auditoria (${rotulo}) — ${quantidade} ${
      quantidade === 1 ? "evento" : "eventos"
    }`,
    valorNovo: {
      formato: rotulo,
      periodo: periodo || "Todo o período registrado",
      filtros: filtros || "Nenhum filtro aplicado",
      eventos_exportados: quantidade,
      // Só aparece no detalhe quando o recorte passou do teto e o documento saiu cortado.
      ...(limitado ? { limite_aplicado: LIMITE_EXPORTACAO } : {}),
    },
    usuarioId,
  });
}

// ---------------------------------------------------------------------------
// Comparação Antes/Depois do detalhe da ação
// ---------------------------------------------------------------------------

const CAMPOS = {
  nome: "Nome",
  nome_completo: "Nome",
  nome_conta: "Nome da conta",
  numero_conta: "Número da conta",
  cargo: "Cargo",
  telefone: "Telefone",
  email: "E-mail",
  perfil: "Perfil de acesso",
  status: "Status",
  situacao: "Situação",
  saldo: "Saldo",
  data_saldo: "Data do saldo",
  saldo_inicial: "Saldo inicial",
  valor: "Valor",
  valor_pago: "Valor pago",
  conta: "Conta",
  contas: "Contas",
  banco: "Banco",
  secretaria: "Secretaria",
  fornecedor: "Fornecedor",
  razao_social: "Razão social",
  nome_fantasia: "Nome fantasia",
  cpf_cnpj: "CPF/CNPJ",
  descricao: "Descrição",
  titulo: "Título",
  aprovada: "Aprovada",
  data_pagamento: "Data do pagamento",
  aliquota_iss_fixa: "Alíquota ISS fixa",
  aliquota_ir_fixa: "Alíquota IR fixa",
  // Parâmetros tributários da tela de Configurações.
  aliquota_iss_padrao: "Alíquota padrão de ISS (%)",
  aliquota_ir_padrao: "Alíquota padrão de IRPJ (%)",
  // Campos do evento de exportação da própria auditoria.
  formato: "Formato",
  periodo: "Período",
  filtros: "Filtros",
  eventos_exportados: "Eventos exportados",
  limite_aplicado: "Limite aplicado",
  // Campos da categoria Notificações da tela de Configurações.
  tarefa_atribuida: "Aviso de tarefa atribuída",
  tarefa_vence_hoje: "Aviso de tarefa próxima do vencimento",
  tarefa_atrasada: "Aviso de tarefa atrasada",
  tarefa_aguardando_aprovacao: "Aviso de alteração pendente de aprovação",
  acao_critica: "Aviso de ação crítica",
  // Campos das certidões (cadastro, edição, renovação e exclusão).
  numero_documento: "Número / documento",
  tipo_certidao: "Tipo de certidão",
  data_emissao: "Data de emissão",
  data_vencimento: "Data de vencimento",
  observacoes: "Observações",
  arquivo: "Documento anexado",
  certidao_anterior: "Emissão anterior",
  // Campos comuns a todas as exclusões (lógicas ou físicas).
  motivo_exclusao: "Motivo da exclusão",
  vinculos: "Registros ligados",
  // Campos do evento de solicitação de restauração de backup.
  justificativa: "Justificativa",
  solicitado_em: "Solicitado em",
  executada: "Restauração executada",
  observacao: "Observação",
};

/** Nome de campo em português; o que não estiver no dicionário vira texto simples. */
export function campoLabel(chave) {
  if (CAMPOS[chave]) return CAMPOS[chave];
  const texto = String(chave ?? "").replace(/_/g, " ").trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : "--";
}

/** Valor de um campo pronto para leitura na tela. */
export function valorLegivel(valor) {
  if (valor === null || valor === undefined || valor === "") return "--";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") return valor.toLocaleString("pt-BR");
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

function comoObjeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function mesmoValor(a, b) {
  const normalizar = (v) => (v === undefined || v === null ? null : v);
  return JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
}

/**
 * O que mudou no registro, campo por campo.
 *
 * Só entram os campos presentes em valor_anterior ou valor_novo, e apenas
 * quando o conteúdo dos dois lados é diferente: campo que não mudou não aparece
 * na comparação. Eventos de criação (sem valor_anterior) e de exclusão (sem
 * valor_novo) também passam por aqui e mostram apenas o lado que existe.
 */
export function comparacaoAntesDepois(evento) {
  const antes = comoObjeto(evento?.valor_anterior);
  const depois = comoObjeto(evento?.valor_novo);
  const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])];

  return chaves
    .filter((chave) => !mesmoValor(antes[chave], depois[chave]))
    .map((chave) => ({
      campo: chave,
      label: campoLabel(chave),
      antes: valorLegivel(antes[chave]),
      depois: valorLegivel(depois[chave]),
      tinhaAntes: Object.prototype.hasOwnProperty.call(antes, chave),
      temDepois: Object.prototype.hasOwnProperty.call(depois, chave),
    }));
}
