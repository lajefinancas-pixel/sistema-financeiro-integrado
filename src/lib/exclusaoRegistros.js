import { supabase } from "./supabaseClient";
import { registrarEvento } from "./auditoria";
import { erroAmigavel } from "./erros";

/**
 * Regras de exclusão que valem em TODO o sistema.
 *
 * Três coisas acontecem sempre que alguém exclui um registro:
 *   1. a tela pede confirmação em um modal padrão (ModalConfirmarExclusao);
 *   2. registros sensíveis (conta bancária, pagamento, fornecedor, certidão)
 *      exigem o "Motivo da exclusão" digitado nesse modal;
 *   3. a exclusão vira um evento 'excluiu' em auditoria_eventos, com o motivo.
 *
 * Em fornecedores, certidões e pagamentos a exclusão é LÓGICA: em vez de apagar
 * a linha, grava-se `excluido_em` e `excluido_por` e a linha some das listagens.
 * Saldos das contas continua como sempre foi — a conta bancária é desativada,
 * sem exclusão lógica, porque a lógica financeira de saldos não muda nesta etapa.
 */

/** Tabelas em que excluir é gravar `excluido_em` em vez de apagar a linha. */
export const TABELAS_EXCLUSAO_LOGICA = ["fornecedores", "certidoes", "pagamentos"];

/** Tamanho mínimo do motivo — o campo é obrigatório, não pode ser um "x". */
export const MOTIVO_MINIMO = 5;

/** O motivo informado serve? (usado pelo modal para habilitar o botão) */
export function motivoValido(motivo) {
  return String(motivo ?? "").trim().length >= MOTIVO_MINIMO;
}

/** Motivo limpo e pronto para ir à auditoria; lança quando obrigatório e vazio. */
export function normalizarMotivo(motivo, { obrigatorio = false } = {}) {
  const texto = String(motivo ?? "").trim();
  if (!obrigatorio) return texto || null;
  if (!motivoValido(texto)) {
    throw erroAmigavel(
      `Informe o motivo da exclusão (pelo menos ${MOTIVO_MINIMO} caracteres).`,
    );
  }
  return texto;
}

// ---------------------------------------------------------------------------
// Compatibilidade com bancos que ainda não receberam a migration
// ---------------------------------------------------------------------------

/**
 * Erros que significam "a coluna de exclusão lógica ainda não existe aqui", e
 * não uma falha de uso. Mesmo critério de `estruturaDeRateioAusente`.
 */
function colunaAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42703", "PGRST204", "PGRST205"].includes(codigo)) return true;
  return /excluido_em/i.test(String(erro?.message ?? ""));
}

// Uma sondagem por tabela por sessão; o resultado (uma promessa) fica em cache.
const suporte = new Map();

/**
 * A tabela já tem as colunas de exclusão lógica?
 *
 * Enquanto a migration não for aplicada no Supabase, a resposta é `false` e o
 * sistema continua funcionando como antes: as telas não filtram por
 * `excluido_em` e a exclusão volta a ser física (ou a inativação de sempre).
 */
export function suportaExclusaoLogica(tabela) {
  if (!suporte.has(tabela)) {
    const consulta = supabase
      .from(tabela)
      .select("excluido_em")
      .limit(1)
      .then(({ error }) => !(error && colunaAusente(error)))
      .catch(() => false);
    suporte.set(tabela, consulta);
  }
  return suporte.get(tabela);
}

/**
 * Devolve a função que aplica "excluido_em is null" à consulta — ou a
 * identidade, quando a tabela ainda não tem a coluna.
 *
 * Vem como função, e não como consulta já filtrada, de propósito: a consulta do
 * PostgREST é "thenable", então devolvê-la de uma função async dispararia a
 * busca antes da hora e não daria mais para encadear .range() (paginação).
 *
 *   const vigentes = await filtroVigentes("pagamentos");
 *   const { data } = await vigentes(supabase.from("pagamentos").select("id"));
 */
export async function filtroVigentes(tabela) {
  const suportado = await suportaExclusaoLogica(tabela);
  return (consulta) => (suportado ? consulta.is("excluido_em", null) : consulta);
}

// ---------------------------------------------------------------------------
// Exclusão
// ---------------------------------------------------------------------------

/**
 * Exclui logicamente um registro: grava quem excluiu e quando.
 *
 * @param tabela        'fornecedores' | 'certidoes' | 'pagamentos'
 * @param id            id do registro
 * @param usuarioId     id em public.usuarios de quem está excluindo
 * @param camposExtras  colunas adicionais gravadas junto (ex.: { ativo: false })
 * @param aoNaoSuportar o que fazer no banco sem a migration (padrão: delete)
 *
 * @returns { logica: true } quando gravou a exclusão lógica.
 */
export async function excluirRegistro({
  tabela,
  id,
  usuarioId = null,
  camposExtras = null,
  aoNaoSuportar = null,
}) {
  if (await suportaExclusaoLogica(tabela)) {
    const { error } = await supabase
      .from(tabela)
      .update({
        ...(camposExtras ?? {}),
        excluido_em: new Date().toISOString(),
        excluido_por: usuarioId ?? null,
      })
      .eq("id", id);
    if (error) throw error;
    return { logica: true };
  }

  if (aoNaoSuportar) {
    await aoNaoSuportar();
    return { logica: false };
  }

  const { error } = await supabase.from(tabela).delete().eq("id", id);
  if (error) throw error;
  return { logica: false };
}

/**
 * Registra a exclusão na trilha de auditoria.
 *
 * O motivo entra em `valor_novo.motivo_exclusao`, que a tela de Auditoria já
 * exibe na comparação Antes/Depois do evento.
 */
export async function auditarExclusao({
  modulo,
  registroAfetado,
  motivo = null,
  valorAnterior = null,
  logica = true,
  nivel = "atencao",
  usuarioId = null,
}) {
  return registrarEvento({
    modulo,
    acao: "excluiu",
    registroAfetado,
    valorAnterior,
    valorNovo: {
      situacao: logica ? "Excluído do sistema (exclusão lógica)" : "Excluído do sistema",
      motivo_exclusao: motivo || "Não informado",
    },
    nivel,
    usuarioId,
  });
}

// ---------------------------------------------------------------------------
// Relacionamentos que impedem a exclusão
// ---------------------------------------------------------------------------

/** Quantos registros vigentes de uma tabela apontam para o fornecedor. */
async function contarVinculo(tabela, fornecedorId) {
  try {
    const vigentes = await filtroVigentes(tabela);
    const { count, error } = await vigentes(
      supabase.from(tabela).select("id", { count: "exact", head: true }).eq("fornecedor_id", fornecedorId),
    );
    if (error) throw error;
    return count ?? 0;
  } catch {
    // Sem permissão de leitura no módulo (ou tabela ausente): o vínculo não
    // pode ser confirmado e não deve inventar um bloqueio.
    return 0;
  }
}

/**
 * Pagamentos e certidões ainda ligados ao fornecedor.
 *
 * Existindo qualquer um deles, o fornecedor não é excluído: a tela oferece
 * "Inativar fornecedor" no lugar, para não deixar pagamento ou documento
 * apontando para um cadastro que sumiu.
 */
export async function vinculosDoFornecedor(fornecedorId) {
  const [pagamentos, certidoes] = await Promise.all([
    contarVinculo("pagamentos", fornecedorId),
    contarVinculo("certidoes", fornecedorId),
  ]);
  return { pagamentos, certidoes, total: pagamentos + certidoes };
}

/** Frase do bloqueio ("2 pagamentos e 1 certidão"), ou null quando não há vínculo. */
export function textoDosVinculos(vinculos) {
  if (!vinculos || vinculos.total === 0) return null;
  const partes = [];
  if (vinculos.pagamentos > 0) {
    partes.push(`${vinculos.pagamentos} ${vinculos.pagamentos === 1 ? "pagamento" : "pagamentos"}`);
  }
  if (vinculos.certidoes > 0) {
    partes.push(`${vinculos.certidoes} ${vinculos.certidoes === 1 ? "certidão" : "certidões"}`);
  }
  return partes.join(" e ");
}
