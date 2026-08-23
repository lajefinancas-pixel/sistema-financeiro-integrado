import { supabase } from "./supabaseClient";
import { mensagemAmigavel } from "./erros";

/**
 * Camada de dados das notificações (tabela "notificacoes").
 *
 * Colunas usadas: id, usuario_id, tarefa_id, tipo, mensagem, lida, criado_em.
 *
 * Notificar é sempre um efeito secundário: nenhuma falha aqui pode derrubar a
 * ação principal (criar tarefa, comentar, devolver...). Por isso as funções de
 * gravação devolvem a mensagem de erro em vez de lançá-la — quem chamou decide
 * se mostra um aviso na tela.
 */

const COLUNAS = "id, usuario_id, tarefa_id, tipo, mensagem, lida, criado_em";

export const TIPOS = {
  tarefa_atribuida: { label: "Tarefa atribuída", cor: "#2563EB" },
  tarefa_compartilhada: { label: "Tarefa compartilhada", cor: "#7C3AED" },
  tarefa_vence_hoje: { label: "Vence hoje", cor: "#B45309" },
  tarefa_atrasada: { label: "Tarefa atrasada", cor: "#DC2626" },
  tarefa_comentario: { label: "Novo comentário", cor: "#0F2A44" },
  tarefa_devolvida: { label: "Devolvida para correção", cor: "#DC2626" },
  tarefa_aprovada: { label: "Tarefa aprovada", cor: "#15803D" },
  tarefa_aguardando_aprovacao: { label: "Aguardando aprovação", cor: "#C2410C" },
  acao_critica: { label: "Ação crítica", cor: "#DC2626" },
  certidao_a_vencer: { label: "Certidão a vencer", cor: "#A16207" },
  certidao_vencida: { label: "Certidão vencida", cor: "#DC2626" },
};

export function tipoInfo(chave) {
  return TIPOS[chave] ?? { label: "Notificação", cor: "#475569" };
}

/* -------------------------------------------------------------------------
 * Preferências de notificação (Configurações > Notificações)
 * ---------------------------------------------------------------------- */

/**
 * Tipos desligados na chave 'notificacoes' de public.configuracoes_sistema.
 *
 * A leitura é feita uma vez por carregamento de página e guardada em cache: a
 * geração de avisos acontece dentro de outras ações (criar tarefa, enviar para
 * aprovação...) e não pode virar uma consulta a mais a cada linha gravada.
 *
 * Falha aberta de propósito: se a preferência não puder ser lida (rede, tabela
 * ainda não migrada, permissão), o sistema segue notificando como sempre fez.
 * Um erro de leitura nunca deve silenciar avisos da equipe.
 */
let preferenciasEmCache = null;

/** Esquece o cache — chamado logo depois de salvar a categoria Notificações. */
export function limparCachePreferenciasNotificacao() {
  preferenciasEmCache = null;
}

async function tiposDesativados() {
  if (!preferenciasEmCache) {
    preferenciasEmCache = (async () => {
      try {
        const { data, error } = await supabase
          .from("configuracoes_sistema")
          .select("valor")
          .eq("chave", "notificacoes")
          .limit(1);
        if (error) throw error;

        const valor = data?.[0]?.valor;
        if (!valor || typeof valor !== "object" || Array.isArray(valor)) return new Set();
        return new Set(
          Object.entries(valor)
            .filter(([, ligado]) => ligado === false)
            .map(([tipo]) => tipo)
        );
      } catch {
        return new Set();
      }
    })();
  }
  return preferenciasEmCache;
}

export async function listarNotificacoes(usuarioId, { apenasNaoLidas = false, limite = 40 } = {}) {
  if (!usuarioId) return [];
  let consulta = supabase
    .from("notificacoes")
    .select(COLUNAS)
    .eq("usuario_id", usuarioId)
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (apenasNaoLidas) consulta = consulta.eq("lida", false);

  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}

export async function marcarComoLida(notificacaoId) {
  const { error } = await supabase.from("notificacoes").update({ lida: true }).eq("id", notificacaoId);
  if (error) throw error;
}

export async function marcarTodasComoLidas(usuarioId) {
  if (!usuarioId) return;
  const { error } = await supabase
    .from("notificacoes")
    .update({ lida: true })
    .eq("usuario_id", usuarioId)
    .eq("lida", false);
  if (error) throw error;
}

/**
 * Grava as notificações informadas. Linhas sem destinatário são descartadas, um
 * mesmo destinatário não recebe a mesma linha duas vezes na chamada e os tipos
 * desligados em Configurações > Notificações não são gerados.
 * Devolve a mensagem de erro (ou null quando tudo foi gravado).
 *
 * Além dos avisos de tarefa, a mesma função grava os avisos de vencimento de
 * certidão (src/lib/alertasCertidoes.js): nesses casos a linha traz
 * certidao_id/certidao_estagio no lugar de tarefa_id.
 */
export async function notificar(linhas) {
  const desativados = await tiposDesativados();
  const vistos = new Set();
  const registros = (Array.isArray(linhas) ? linhas : [linhas])
    .filter((linha) => linha?.usuario_id && linha?.tipo && linha?.mensagem)
    .filter((linha) => !desativados.has(linha.tipo))
    .filter((linha) => {
      const chave = `${linha.usuario_id}|${linha.tipo}|${linha.tarefa_id ?? ""}|${linha.certidao_id ?? ""}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .map((linha) => ({
      usuario_id: linha.usuario_id,
      tarefa_id: linha.tarefa_id ?? null,
      certidao_id: linha.certidao_id ?? null,
      certidao_estagio: linha.certidao_estagio ?? null,
      tipo: linha.tipo,
      mensagem: linha.mensagem,
      lida: false,
    }));

  if (registros.length === 0) return null;

  const { error } = await supabase.from("notificacoes").insert(registros);
  return error ? mensagemAmigavel(error, "Alguns avisos da equipe não foram gerados agora.") : null;
}

/** Início do dia de hoje no fuso local, no formato aceito pelo filtro de criado_em. */
function inicioDeHoje() {
  const agora = new Date();
  agora.setHours(0, 0, 0, 0);
  return agora.toISOString();
}

/**
 * Cria as notificações de prazo das tarefas de quem está logado: "vence hoje"
 * para o prazo do dia e "atrasada" para o prazo já vencido.
 *
 * A varredura roda quando a página abre. Para não repetir o mesmo aviso a cada
 * carregamento, só entram as tarefas que ainda não geraram aquele tipo de
 * notificação hoje — ou seja, no máximo um aviso por tarefa por dia.
 */
export async function sincronizarNotificacoesDePrazo(usuarioId, tarefas, hoje) {
  if (!usuarioId || !hoje) return null;

  const encerradas = ["concluida", "cancelada"];
  const pendentes = (tarefas ?? []).filter(
    (t) => t.responsavel_id === usuarioId && t.prazo && !encerradas.includes(t.status),
  );
  const doDia = pendentes.filter((t) => t.prazo === hoje);
  const vencidas = pendentes.filter((t) => t.prazo < hoje);
  if (doDia.length === 0 && vencidas.length === 0) return null;

  const { data, error } = await supabase
    .from("notificacoes")
    .select("tarefa_id, tipo")
    .eq("usuario_id", usuarioId)
    .gte("criado_em", inicioDeHoje());
  if (error) return mensagemAmigavel(error, "Não foi possível verificar os avisos de prazo agora.");

  const jaAvisado = new Set((data ?? []).map((n) => `${n.tarefa_id}|${n.tipo}`));
  const novas = [];

  doDia.forEach((t) => {
    if (jaAvisado.has(`${t.id}|tarefa_vence_hoje`)) return;
    novas.push({
      usuario_id: usuarioId,
      tarefa_id: t.id,
      tipo: "tarefa_vence_hoje",
      mensagem: `A tarefa "${t.titulo}" vence hoje.`,
    });
  });

  vencidas.forEach((t) => {
    if (jaAvisado.has(`${t.id}|tarefa_atrasada`)) return;
    novas.push({
      usuario_id: usuarioId,
      tarefa_id: t.id,
      tipo: "tarefa_atrasada",
      mensagem: `A tarefa "${t.titulo}" está atrasada.`,
    });
  });

  return notificar(novas);
}
