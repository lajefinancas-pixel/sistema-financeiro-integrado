import { supabase } from "./supabaseClient";
import { listarFornecedores, nomeFornecedor } from "./certidoes";

/**
 * Fornecedores vistos pelo módulo "Certidões" — só identificação.
 *
 * A fonte é a view public.fornecedores_identificacao
 * (migration 20260824120000_fornecedores_identificacao_certidoes.sql), que
 * devolve apenas id, razão social, nome fantasia, CPF/CNPJ, secretaria e
 * situação. Nada de dados bancários, valores em aberto, notas, histórico de
 * pagamentos ou informação tributária passa por aqui.
 *
 * A view é liberada por permissão efetiva no módulo 'certidoes' — não por
 * fornecedores.pode_visualizar. É essa troca que faz o seletor funcionar para
 * quem cuida da regularidade documental e não tem (nem deve ter) acesso ao
 * módulo Fornecedores.
 *
 * Os únicos recortes aplicados são os dois pedidos pelo módulo, e ambos vivem
 * dentro da view: excluído = não e o controle de acesso por secretaria. Nenhum
 * filtro do módulo Fornecedores (ativo, situação documental, filtros salvos)
 * é herdado — era um deles que zerava a lista.
 */

/** Nome da view. */
export const FONTE_IDENTIFICACAO = "fornecedores_identificacao";

const COLUNAS = "id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, secretaria_nome, ativo";

/**
 * O erro significa "a view ainda não existe neste banco" (migration pendente),
 * e não uma falha de uso? Mesmo critério de `suportaExclusaoLogica`.
 */
function fonteAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) return true;
  return new RegExp(FONTE_IDENTIFICACAO, "i").test(String(erro?.message ?? ""));
}

/**
 * Linha da view no mesmo formato que o restante do módulo já espera do
 * fornecedor (com `secretarias.nome` aninhado), para que filtros, agrupamento
 * por fornecedor e exportações continuem lendo os mesmos campos de antes.
 */
function normalizar(linha) {
  const secretariaId = linha?.secretaria_id ?? null;
  return {
    id: linha?.id,
    razao_social: linha?.razao_social ?? null,
    nome_fantasia: linha?.nome_fantasia ?? null,
    cpf_cnpj: linha?.cpf_cnpj ?? null,
    ativo: linha?.ativo,
    secretaria_id: secretariaId,
    secretarias: secretariaId ? { id: secretariaId, nome: linha?.secretaria_nome ?? "" } : null,
  };
}

/**
 * Fornecedores disponíveis para escolha no módulo Certidões.
 *
 * Enquanto a migration não for aplicada no Supabase, a view não existe e a
 * consulta cai no caminho antigo (leitura de public.fornecedores). Assim a aba
 * continua funcionando como hoje para quem já tem os dois módulos, em vez de
 * quebrar; para quem só tem Certidões a lista segue vazia até a migration
 * rodar — e a tela mostra o aviso amigável, nunca um erro técnico.
 */
export async function listarFornecedoresIdentificacao() {
  const { data, error } = await supabase
    .from(FONTE_IDENTIFICACAO)
    .select(COLUNAS)
    .order("razao_social", { nullsFirst: false });

  if (error) {
    if (fonteAusente(error)) return listarFornecedores();
    throw error;
  }

  return (data ?? []).map(normalizar);
}

// ---------------------------------------------------------------------------
// Busca por digitação
// ---------------------------------------------------------------------------

function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function somenteDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/** CPF/CNPJ do fornecedor como texto exibível (vazio quando não há). */
export function documentoFornecedor(fornecedor) {
  return String(fornecedor?.cpf_cnpj ?? "").trim();
}

/**
 * Como o fornecedor aparece na lista: nome/razão social seguido do CPF/CNPJ.
 * O documento entra sempre que existe — é ele que separa dois cadastros
 * homônimos.
 */
export function rotuloFornecedor(fornecedor) {
  const documento = documentoFornecedor(fornecedor);
  return documento ? `${nomeFornecedor(fornecedor)} — ${documento}` : nomeFornecedor(fornecedor);
}

/** Nome fantasia, quando ele acrescenta alguma coisa ao nome já exibido. */
export function apelidoFornecedor(fornecedor) {
  const fantasia = String(fornecedor?.nome_fantasia ?? "").trim();
  if (!fantasia) return "";
  return normalizarTexto(fantasia) === normalizarTexto(nomeFornecedor(fornecedor)) ? "" : fantasia;
}

/**
 * O fornecedor combina com o que foi digitado?
 *
 * A busca cobre nome/razão social, nome fantasia e CPF/CNPJ. Digitar só os
 * números do documento funciona mesmo que o cadastro esteja com pontuação.
 */
export function fornecedorCombina(fornecedor, termo) {
  const busca = normalizarTexto(termo);
  if (!busca) return true;

  const texto = normalizarTexto(
    [nomeFornecedor(fornecedor), fornecedor?.razao_social, fornecedor?.nome_fantasia, fornecedor?.cpf_cnpj]
      .filter(Boolean)
      .join(" "),
  );
  if (texto.includes(busca)) return true;

  const digitos = somenteDigitos(termo);
  return digitos.length > 0 && somenteDigitos(fornecedor?.cpf_cnpj).includes(digitos);
}

/** A lista filtrada pelo que a pessoa digitou, na ordem em que veio. */
export function filtrarFornecedores(fornecedores, termo) {
  const lista = fornecedores ?? [];
  const busca = String(termo ?? "").trim();
  if (!busca) return lista;
  return lista.filter((f) => fornecedorCombina(f, busca));
}

// ---------------------------------------------------------------------------
// Nome do fornecedor nas certidões já cadastradas
// ---------------------------------------------------------------------------

/**
 * Completa cada certidão com o fornecedor vindo da fonte de identificação
 * quando a própria linha veio sem ele.
 *
 * A consulta de certidões traz o fornecedor embutido a partir de
 * public.fornecedores, e esse embutido obedece à RLS do módulo Fornecedores:
 * para quem só tem Certidões ele chega nulo e a listagem ficaria sem nome. Como
 * a lista de identificação já está carregada na tela, o vínculo é refeito aqui
 * — é o mesmo desempate que `filtrarCertidoes` já faz internamente.
 *
 * Só preenche o que está faltando: quem enxerga o fornecedor embutido continua
 * vendo exatamente o mesmo objeto de antes.
 */
export function comFornecedorIdentificado(certidoes, fornecedores) {
  const lista = certidoes ?? [];
  const disponiveis = fornecedores ?? [];
  if (lista.length === 0 || disponiveis.length === 0) return lista;
  if (lista.every((certidao) => certidao?.fornecedores)) return lista;

  const porId = new Map(disponiveis.map((item) => [String(item.id), item]));

  return lista.map((certidao) => {
    if (certidao?.fornecedores) return certidao;
    const fornecedor = porId.get(String(certidao?.fornecedor_id ?? "")) ?? null;
    return fornecedor ? { ...certidao, fornecedores: fornecedor } : certidao;
  });
}
