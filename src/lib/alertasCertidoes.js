import { supabase } from "./supabaseClient";
import { mensagemAmigavel } from "./erros";
import { diasAte, formatarData, nomeFornecedor } from "./certidoes";
import { notificar } from "./notificacoes";

/**
 * Alertas de vencimento das certidões.
 *
 * Os avisos ficam na tabela public.notificacoes — a mesma do módulo Tarefas —
 * usando as colunas certidao_id, certidao_estagio e dispensada_em criadas pela
 * migration 20260823130000_certidoes_alertas_notificacoes.sql.
 *
 * Regras que sustentam o desenho:
 *
 *  1. UMA pendência por certidão. Enquanto o aviso estiver ativo, abrir a tela
 *     de novo não gera outro: a varredura reconhece a pendência que já existe.
 *     O índice único (usuario_id, certidao_id) garante isso também no banco.
 *
 *  2. O aviso ACOMPANHA o prazo. Quando a certidão passa de "faltam 30 dias"
 *     para "faltam 7", a mesma linha é reescrita (e volta a aparecer como não
 *     lida) em vez de virar um segundo aviso.
 *
 *  3. A pendência SOME quando a certidão é renovada ou regularizada — ou seja,
 *     quando o vencimento sai da janela de alerta. A varredura apaga o aviso.
 *
 *  4. Dispensar encerra a pendência. Ela só volta se o prazo apertar além do
 *     ponto em que foi dispensada (quem dispensou o aviso de 30 dias ainda
 *     precisa saber quando a certidão vencer).
 *
 * A varredura roda no navegador de quem está logado, quando a tela abre — o
 * mesmo desenho dos avisos de prazo das tarefas. Cada pessoa recebe os avisos
 * das certidões que enxerga (o RLS do módulo já filtra a lista).
 */

/** Prazos padrão, em dias antes do vencimento. O 0 é o próprio dia. */
export const PRAZOS_PADRAO = [30, 15, 7, 0];

/** Identificador do estágio gravado em notificacoes.certidao_estagio. */
function estagioDoPrazo(dias) {
  return `d${dias}`;
}

/**
 * Quanto mais alto, mais urgente — usado para ordenar a lista e para saber se o
 * prazo apertou desde o aviso anterior. Valores finitos de propósito: a
 * comparação também serve de critério de ordenação.
 */
function severidade(estagio) {
  if (estagio === "vencida") return 1_000_000;
  const dias = Number(String(estagio ?? "").slice(1));
  return Number.isFinite(dias) ? -dias : -1_000_000;
}

export function tipoDoEstagio(estagio) {
  return estagio === "vencida" ? "certidao_vencida" : "certidao_a_vencer";
}

/* -------------------------------------------------------------------------
 * Prazos configurados
 * ---------------------------------------------------------------------- */

/**
 * Os prazos podem ser ajustados na chave 'notificacoes' de
 * public.configuracoes_sistema, no campo "certidoes_prazos" (ex.: [45, 30, 7]).
 * É a única chave que qualquer usuário ativo pode ler, então a consulta não
 * depende de permissão em Configurações.
 *
 * Falha fechada nos padrões: qualquer problema de leitura (rede, campo ausente,
 * valor inválido) mantém 30/15/7/no dia. Um erro de configuração nunca pode
 * deixar a equipe sem aviso de certidão vencendo.
 */
let prazosEmCache = null;

export function limparCachePrazosCertidao() {
  prazosEmCache = null;
}

export async function prazosDeAlerta() {
  if (!prazosEmCache) {
    prazosEmCache = (async () => {
      try {
        const { data, error } = await supabase
          .from("configuracoes_sistema")
          .select("valor")
          .eq("chave", "notificacoes")
          .limit(1);
        if (error) throw error;

        const bruto = data?.[0]?.valor?.certidoes_prazos;
        if (!Array.isArray(bruto)) return PRAZOS_PADRAO;

        const limpos = [...new Set(bruto.map(Number).filter((n) => Number.isInteger(n) && n >= 0))];
        return limpos.length > 0 ? limpos.sort((a, b) => b - a) : PRAZOS_PADRAO;
      } catch {
        return PRAZOS_PADRAO;
      }
    })();
  }
  return prazosEmCache;
}

/* -------------------------------------------------------------------------
 * Leitura do estado de cada certidão
 * ---------------------------------------------------------------------- */

/**
 * Em que estágio de alerta a certidão está: 'vencida', ou o menor prazo já
 * alcançado ('d7', 'd15'...). Devolve null quando não há o que avisar — tipo
 * sem vencimento, ou vencimento ainda longe.
 *
 * A avaliação é pela data, não pela situação gravada: uma certidão marcada
 * como "Em renovação" continua vencendo, e esconder isso seria perder o
 * controle do documento. Quem não quiser o lembrete pode dispensá-lo.
 */
export function estagioAlerta(certidao, prazos = PRAZOS_PADRAO) {
  if (!certidao?.data_vencimento) return null;
  const dias = diasAte(certidao.data_vencimento);
  if (dias === null) return null;
  if (dias < 0) return "vencida";

  const alcancado = [...prazos].sort((a, b) => a - b).find((prazo) => dias <= prazo);
  return alcancado === undefined ? null : estagioDoPrazo(alcancado);
}

/** Texto do aviso, no tom das demais notificações do sistema. */
export function mensagemAlerta(certidao, estagio) {
  const tipo = certidao?.tipos_certidao?.nome ?? "Certidão";
  const fornecedor = nomeFornecedor(certidao?.fornecedores);
  const vencimento = formatarData(certidao?.data_vencimento);
  const dias = diasAte(certidao?.data_vencimento);

  if (estagio === "vencida") {
    const atraso = Math.abs(dias ?? 0);
    return `${tipo} de ${fornecedor} está vencida desde ${vencimento} (${atraso} ${
      atraso === 1 ? "dia" : "dias"
    }).`;
  }
  if (dias === 0) return `${tipo} de ${fornecedor} vence hoje (${vencimento}).`;
  return `${tipo} de ${fornecedor} vence em ${dias} ${dias === 1 ? "dia" : "dias"} (${vencimento}).`;
}

/**
 * Resumo curto para o card do Painel Principal: quantas vencem dentro da janela
 * de alerta e quantas já venceram.
 */
export function resumoCertidoes(certidoes, prazos = PRAZOS_PADRAO) {
  const janela = Math.max(...prazos, 0);
  let aVencer = 0;
  let vencidas = 0;

  (certidoes ?? []).forEach((certidao) => {
    if (!certidao?.data_vencimento) return;
    const dias = diasAte(certidao.data_vencimento);
    if (dias === null) return;
    if (dias < 0) vencidas += 1;
    else if (dias <= janela) aVencer += 1;
  });

  const partes = [];
  if (aVencer > 0) partes.push(`${aVencer} ${aVencer === 1 ? "vence" : "vencem"} em até ${janela} dias`);
  if (vencidas > 0) partes.push(`${vencidas} ${vencidas === 1 ? "vencida" : "vencidas"}`);

  return {
    total: (certidoes ?? []).length,
    aVencer,
    vencidas,
    janela,
    regular: partes.length === 0,
    texto: partes.length === 0 ? "Certidões regulares" : partes.join(", "),
  };
}

/* -------------------------------------------------------------------------
 * Pendências gravadas
 * ---------------------------------------------------------------------- */

/**
 * Aviso claro para o caso de a migration dos alertas ainda não ter sido rodada
 * no banco: sem as colunas novas em "notificacoes" o PostgREST responde 42703
 * (coluna inexistente), e a mensagem genérica não ajudaria quem administra.
 */
function erroDeEstrutura(erro) {
  const codigo = String(erro?.code ?? "");
  if (codigo === "42703" || codigo === "PGRST204") {
    return "Os alertas de vencimento ainda não estão disponíveis: a atualização do banco de dados precisa ser aplicada.";
  }
  return null;
}

const COLUNAS_ALERTA =
  "id, certidao_id, certidao_estagio, tipo, mensagem, lida, dispensada_em, criado_em";

/**
 * Avisos de certidão de quem está logado que ainda não foram dispensados,
 * do mais urgente para o menos urgente (vencidas primeiro).
 */
export async function listarAlertasCertidoes(usuarioId) {
  if (!usuarioId) return [];
  const { data, error } = await supabase
    .from("notificacoes")
    .select(COLUNAS_ALERTA)
    .eq("usuario_id", usuarioId)
    .not("certidao_id", "is", null)
    .is("dispensada_em", null)
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return [...(data ?? [])].sort((a, b) => severidade(b.certidao_estagio) - severidade(a.certidao_estagio));
}

/** Encerra a pendência sem apagar o histórico do aviso. */
export async function dispensarAlerta(alertaId) {
  const { error } = await supabase
    .from("notificacoes")
    .update({ dispensada_em: new Date().toISOString(), lida: true })
    .eq("id", alertaId);
  if (error) throw error;
}

/**
 * Acerta os avisos de vencimento de quem está logado a partir da lista de
 * certidões já carregada na tela: cria o que falta, atualiza o que apertou de
 * prazo e apaga o que foi renovado ou regularizado.
 *
 * Nunca lança: avisar é efeito secundário e não pode derrubar a listagem.
 * Devolve { alertas, erro } com as pendências ativas depois da varredura.
 */
export async function sincronizarAlertasCertidoes(usuarioId, certidoes) {
  if (!usuarioId) return { alertas: [], erro: null };

  const prazos = await prazosDeAlerta();
  const lista = certidoes ?? [];

  const estagioPorCertidao = new Map();
  lista.forEach((certidao) => {
    const estagio = estagioAlerta(certidao, prazos);
    if (estagio) estagioPorCertidao.set(certidao.id, estagio);
  });

  const { data, error } = await supabase
    .from("notificacoes")
    .select(COLUNAS_ALERTA)
    .eq("usuario_id", usuarioId)
    .not("certidao_id", "is", null);
  if (error) {
    return {
      alertas: [],
      erro:
        erroDeEstrutura(error) ??
        mensagemAmigavel(error, "Não foi possível verificar os alertas de vencimento."),
    };
  }

  const gravados = new Map((data ?? []).map((linha) => [linha.certidao_id, linha]));
  const novas = [];
  const atualizacoes = [];

  estagioPorCertidao.forEach((estagio, certidaoId) => {
    const certidao = lista.find((c) => c.id === certidaoId);
    const linha = gravados.get(certidaoId);
    const conteudo = {
      certidao_estagio: estagio,
      tipo: tipoDoEstagio(estagio),
      mensagem: mensagemAlerta(certidao, estagio),
    };

    if (!linha) {
      novas.push({ usuario_id: usuarioId, certidao_id: certidaoId, ...conteudo });
      return;
    }

    const ativa = !linha.dispensada_em;
    if (ativa && linha.certidao_estagio === estagio) return; // pendência já existe
    if (!ativa && severidade(estagio) <= severidade(linha.certidao_estagio)) return; // dispensada

    atualizacoes.push({
      id: linha.id,
      ...conteudo,
      lida: false,
      dispensada_em: null,
      criado_em: new Date().toISOString(),
    });
  });

  // Renovadas ou regularizadas: o vencimento saiu da janela e a pendência morre.
  //
  // Uma lista vazia não apaga nada: pode ser só falta de permissão de leitura no
  // módulo (o RLS devolve zero linhas), e nesse caso apagar os avisos de quem
  // enxerga as certidões seria perder alerta legítimo.
  const resolvidas =
    lista.length === 0
      ? []
      : (data ?? [])
          .filter((linha) => !estagioPorCertidao.has(linha.certidao_id))
          .map((linha) => linha.id);

  const falhas = await Promise.all([
    novas.length > 0 ? notificar(novas) : null,
    ...atualizacoes.map(async ({ id, ...campos }) => {
      const { error: erroUpdate } = await supabase.from("notificacoes").update(campos).eq("id", id);
      return erroUpdate ? mensagemAmigavel(erroUpdate, "Alguns alertas de certidão não foram atualizados.") : null;
    }),
    resolvidas.length > 0
      ? supabase
          .from("notificacoes")
          .delete()
          .in("id", resolvidas)
          .then(({ error: erroDelete }) =>
            erroDelete ? mensagemAmigavel(erroDelete, "Alguns alertas já resolvidos continuam na lista.") : null,
          )
      : null,
  ]);

  const erro = falhas.find(Boolean) ?? null;

  try {
    return { alertas: await listarAlertasCertidoes(usuarioId), erro };
  } catch (e) {
    return { alertas: [], erro: erro ?? mensagemAmigavel(e, "Não foi possível carregar os alertas de vencimento.") };
  }
}
