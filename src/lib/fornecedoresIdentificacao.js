import { supabase } from "./supabaseClient";
import { nomeFornecedor } from "./certidoes";

/**
 * Fornecedores vistos pelo módulo "Certidões" — só identificação.
 *
 * A fonte preferencial é a view public.fornecedores_identificacao
 * (migration 20260824120000_fornecedores_identificacao_certidoes.sql), que
 * devolve apenas id, razão social, nome fantasia, CPF/CNPJ, secretaria e
 * situação. Nada de dados bancários, valores em aberto, notas, histórico de
 * pagamentos ou informação tributária passa por aqui.
 *
 * Quem libera a lista é a permissão do módulo Certidões (certidoes.pode_visualizar
 * — a tela só chega a pedir os fornecedores depois de conferi-la) e nunca a do
 * módulo Fornecedores. É essa troca que faz o seletor funcionar para quem cuida
 * da regularidade documental e não tem (nem deve ter) acesso ao módulo
 * Fornecedores.
 *
 * O MÓDULO NÃO HERDA MAIS NENHUM FILTRO DA TELA DE FORNECEDORES.
 * Enquanto a view não existir no banco, a leitura cai no cadastro
 * (public.fornecedores) — mas por uma consulta própria, escrita aqui, que pede
 * só as colunas de identificação. Era o caminho antigo, que reaproveitava a
 * consulta da tela de Fornecedores, que zerava o seletor: ela vem com os
 * recortes daquele módulo (o "só ativos" da listagem, o filtro de exclusão
 * lógica montado pelo utilitário compartilhado e o vínculo obrigatório com
 * secretarias). Qualquer um deles, sozinho, é capaz de devolver lista vazia —
 * ou derrubar a consulta inteira — para quem só tem Certidões, mesmo com o
 * cadastro cheio e o RLS liberado.
 *
 * O único recorte que sobra é "fornecedor excluído não aparece", e ele é
 * aplicado sobre o resultado já em memória: nenhuma coluna ausente e nenhuma
 * tabela vizinha sem permissão consegue transformar a lista inteira em zero.
 */

/** Nome da view. */
export const FONTE_IDENTIFICACAO = "fornecedores_identificacao";

const COLUNAS = "id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, secretaria_nome, ativo";

/** Cadastro (retaguarda): as mesmas colunas de identificação, uma a uma. */
const CADASTRO = "fornecedores";
const COLUNAS_CADASTRO = "id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, ativo";
const COLUNA_EXCLUSAO = "excluido_em";

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
 * O erro é "esta coluna não existe aqui" (banco sem a migration da exclusão
 * lógica), e não uma falha de uso?
 */
function colunaAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42703", "PGRST202", "PGRST204"].includes(codigo)) return true;
  return new RegExp(COLUNA_EXCLUSAO, "i").test(String(erro?.message ?? ""));
}

/**
 * Linha no mesmo formato que o restante do módulo já espera do fornecedor (com
 * `secretarias.nome` aninhado), para que filtros, agrupamento por fornecedor e
 * exportações continuem lendo os mesmos campos de antes.
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
 * Nome da secretaria de cada fornecedor, buscado à parte.
 *
 * Separado de propósito: pedir `secretarias ( id, nome )` embutido na consulta
 * do cadastro faz a leitura dos fornecedores depender da permissão de outra
 * tabela — sem ela, a consulta inteira falha e o seletor fica vazio. Aqui, sem
 * acesso às secretarias a lista continua completa; só o rótulo da secretaria
 * deixa de aparecer.
 */
async function nomesDasSecretarias(linhas) {
  const ids = [
    ...new Set(
      linhas.map((linha) => linha?.secretaria_id).filter((id) => id !== null && id !== undefined),
    ),
  ];
  if (ids.length === 0) return new Map();

  try {
    const { data, error } = await supabase.from("secretarias").select("id, nome").in("id", ids);
    if (error) return new Map();
    return new Map((data ?? []).map((s) => [String(s.id), s.nome ?? ""]));
  } catch {
    return new Map();
  }
}

/**
 * Leitura de retaguarda: a identificação direto do cadastro, usada enquanto a
 * view não existir no banco.
 *
 * A coluna de exclusão lógica é pedida junto quando existe, e o descarte dos
 * excluídos acontece em memória — em banco sem essa migration a consulta é
 * refeita sem ela, em vez de falhar.
 */
async function lerIdentificacaoDoCadastro() {
  let { data, error } = await supabase
    .from(CADASTRO)
    .select(`${COLUNAS_CADASTRO}, ${COLUNA_EXCLUSAO}`)
    .order("razao_social", { nullsFirst: false });

  if (error && colunaAusente(error)) {
    ({ data, error } = await supabase
      .from(CADASTRO)
      .select(COLUNAS_CADASTRO)
      .order("razao_social", { nullsFirst: false }));
  }
  if (error) throw error;

  const vigentes = (data ?? []).filter((linha) => !linha?.[COLUNA_EXCLUSAO]);
  const secretarias = await nomesDasSecretarias(vigentes);

  return vigentes.map((linha) =>
    normalizar({ ...linha, secretaria_nome: secretarias.get(String(linha?.secretaria_id)) ?? "" }),
  );
}

/**
 * Fornecedores disponíveis para escolha no módulo Certidões.
 *
 * A view responde primeiro. Ela não existir (migration pendente) — ou existir e
 * não devolver nenhuma linha, o que só acontece quando algum recorte dentro
 * dela zera o resultado — leva à leitura direta da identificação no cadastro.
 * A tela só chega até aqui depois de confirmar certidoes.pode_visualizar, e o
 * RLS do banco continua valendo nas duas leituras; o que muda é que uma lista
 * vazia deixa de ser o desfecho silencioso de um filtro que não é deste módulo.
 *
 * ATENÇÃO ao mexer na view: a retaguarda por lista vazia é segura porque hoje
 * `secretarias_do_meu_usuario_em_certidoes()` devolve NULL (ninguém é restrito
 * a secretaria alguma) e a view não recorta nada além disso. No dia em que essa
 * restrição por secretaria passar a existir de fato, este trecho precisa sair
 * daqui — senão um usuário restrito cujo recorte devolva zero linhas passaria a
 * ver o cadastro inteiro.
 */
export async function listarFornecedoresIdentificacao() {
  const { data, error } = await supabase
    .from(FONTE_IDENTIFICACAO)
    .select(COLUNAS)
    .order("razao_social", { nullsFirst: false });

  if (error) {
    if (fonteAusente(error)) return lerIdentificacaoDoCadastro();
    throw error;
  }

  const daView = (data ?? []).map(normalizar);
  if (daView.length > 0) return daView;

  // Sem linha nenhuma: confere no cadastro antes de dar a lista por vazia. Se
  // essa leitura também não vier (RLS, por exemplo), vale o resultado da view.
  try {
    return await lerIdentificacaoDoCadastro();
  } catch {
    return daView;
  }
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
