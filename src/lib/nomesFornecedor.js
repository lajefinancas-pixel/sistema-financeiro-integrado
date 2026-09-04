/**
 * Nome do fornecedor: apelido, razão social e nome de exibição da programação.
 *
 * Um fornecedor pode ter três nomes ao mesmo tempo, e eles NÃO se substituem:
 *
 *   1. RAZÃO SOCIAL -- o nome oficial do cadastro ("José da Silva Comércio de
 *      Alimentos Ltda."). Continua gravada como sempre e continua sendo a que
 *      vai para documento oficial e fiscal.
 *   2. APELIDO / NOME DE EXIBIÇÃO -- opcional, do CADASTRO ("Zé Alimentos").
 *      Serve para a pessoa reconhecer o fornecedor na tela e para a busca
 *      encontrá-lo. Não altera a razão social nem nada mais do cadastro.
 *   3. NOME DE EXIBIÇÃO DA PROGRAMAÇÃO -- opcional, do ITEM de uma programação
 *      diária ("Zé Alimentos — Merenda"). Vale só naquela programação, mora em
 *      `pagamentos.nome_exibicao_programacao` e NÃO toca o cadastro.
 *
 * A ordem de precedência para MOSTRAR é sempre a mesma, na tela e no papel:
 * nome de exibição da programação -> apelido -> razão social.
 *
 * O VÍNCULO É PELO ID, NUNCA PELO NOME. Nada aqui identifica fornecedor por
 * texto: estas funções só escolhem o que escrever na tela. A busca de notas,
 * processos e baixas continua sendo feita por `fornecedor_id`.
 *
 * Tudo é função pura, sem banco e sem tela, para que a mesma escolha valha na
 * listagem, na busca, na impressão e no teste automatizado.
 */

/** Nome mostrado quando não há nenhum nome no cadastro. */
export const SEM_NOME = "Fornecedor sem nome";

/** Nome mostrado para o item de programação sem fornecedor cadastrado. */
export const SEM_NOME_AVULSO = "Fornecedor avulso";

/** Limite do nome de exibição da programação, igual ao do campo da tela. */
export const LIMITE_NOME_EXIBICAO = 120;

function textoLimpo(valor) {
  return String(valor ?? "").trim();
}

function semAcento(texto) {
  return textoLimpo(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function somenteDigitos(texto) {
  return String(texto ?? "").replace(/\D+/g, "");
}

/* -------------------------------------------------------------------------
 * Os nomes do cadastro
 * ---------------------------------------------------------------------- */

/** Apelido cadastrado, ou "" quando o fornecedor não tem apelido. */
export function apelidoDoFornecedor(fornecedor) {
  return textoLimpo(fornecedor?.apelido);
}

/** O fornecedor tem apelido cadastrado? */
export function temApelido(fornecedor) {
  return apelidoDoFornecedor(fornecedor) !== "";
}

/**
 * Nome OFICIAL do fornecedor -- razão social primeiro. É o que vai para
 * documento oficial e fiscal, e o apelido nunca entra aqui.
 */
export function nomeOficialDoFornecedor(fornecedor) {
  return (
    textoLimpo(fornecedor?.razao_social) ||
    textoLimpo(fornecedor?.nome_fantasia) ||
    textoLimpo(fornecedor?.nome) ||
    SEM_NOME
  );
}

/**
 * Nome que a tela operacional mostra em destaque: o apelido quando existe,
 * senão o nome oficial (exatamente como era antes do apelido existir).
 */
export function nomeExibicaoDoFornecedor(fornecedor) {
  return apelidoDoFornecedor(fornecedor) || nomeOficialDoFornecedor(fornecedor);
}

/**
 * Linha secundária da exibição: a razão social, e só quando ela não é o que já
 * está em destaque. Sem apelido cadastrado não há segunda linha -- a tela fica
 * como é hoje.
 */
export function complementoDoFornecedor(fornecedor) {
  const apelido = apelidoDoFornecedor(fornecedor);
  if (apelido === "") return "";
  const oficial = nomeOficialDoFornecedor(fornecedor);
  return oficial === apelido ? "" : oficial;
}

/* -------------------------------------------------------------------------
 * O nome de exibição do item da programação
 * ---------------------------------------------------------------------- */

/**
 * Limpa o nome de exibição digitado na programação: espaços fora, limite de
 * tamanho aplicado e campo vazio virando `null` (= "usar o nome de sempre").
 */
export function normalizarNomeExibicao(valor) {
  const texto = textoLimpo(valor).replace(/\s+/g, " ");
  if (texto === "") return null;
  return texto.slice(0, LIMITE_NOME_EXIBICAO);
}

/** O item da programação tem nome de exibição personalizado? */
export function temNomeExibicaoPersonalizado(pagamento) {
  return normalizarNomeExibicao(pagamento?.nome_exibicao_programacao) !== null;
}

/** O cadastro ligado ao item da programação (nulo no fornecedor avulso). */
function cadastroDoPagamento(pagamento) {
  return pagamento?.fornecedores ?? pagamento?.fornecedor ?? null;
}

/**
 * Nome OFICIAL do item da programação: razão social do fornecedor vinculado.
 * Não considera apelido nem nome de exibição -- é o nome de documento.
 * Item avulso (sem fornecedor cadastrado) fica com o nome digitado nele.
 */
export function nomeOficialDoPagamento(pagamento) {
  const cadastro = cadastroDoPagamento(pagamento);
  const oficial =
    textoLimpo(cadastro?.razao_social) ||
    textoLimpo(cadastro?.nome_fantasia) ||
    textoLimpo(cadastro?.nome);
  if (oficial !== "") return oficial;
  return textoLimpo(pagamento?.nome_avulso) || SEM_NOME_AVULSO;
}

/**
 * Nome do item da programação como a tela e o papel o mostram:
 * nome de exibição da programação -> apelido -> razão social.
 *
 * É a MESMA função usada na impressão, no PDF e na planilha, para que o papel
 * não possa divergir da tela. Nenhuma delas altera o cadastro.
 */
export function nomeExibicaoDoPagamento(pagamento) {
  const personalizado = normalizarNomeExibicao(pagamento?.nome_exibicao_programacao);
  if (personalizado) return personalizado;
  const apelido = apelidoDoFornecedor(cadastroDoPagamento(pagamento));
  if (apelido !== "") return apelido;
  return nomeOficialDoPagamento(pagamento);
}

/**
 * Linha secundária do item da programação: a razão social, quando ela não é o
 * que já está em destaque. Vazia quando não há nome personalizado nem apelido.
 */
export function complementoDoPagamento(pagamento) {
  const exibicao = nomeExibicaoDoPagamento(pagamento);
  const oficial = nomeOficialDoPagamento(pagamento);
  return oficial === exibicao ? "" : oficial;
}

/* -------------------------------------------------------------------------
 * Busca do fornecedor
 * ---------------------------------------------------------------------- */

/**
 * Textos considerados na busca de fornecedor: nome, razão social, nome
 * fantasia e apelido. O CPF/CNPJ é comparado à parte, por dígitos.
 */
export function textosDeBuscaDoFornecedor(fornecedor) {
  return [fornecedor?.nome, fornecedor?.razao_social, fornecedor?.nome_fantasia, fornecedor?.apelido]
    .map(textoLimpo)
    .filter((campo) => campo !== "");
}

/**
 * O fornecedor atende ao termo digitado?
 *
 * Considera razão social, nome, nome fantasia, APELIDO e CPF/CNPJ. Acento e
 * pontuação não importam: "ze", "Zé" e "12.345" encontram o mesmo cadastro que
 * "ZÉ" e "12345". Digitar "Zé" encontra o fornecedor cujo apelido é
 * "Zé Alimentos" sem deixar de encontrar quem tem "Zé" na razão social.
 */
export function fornecedorAtendeBusca(fornecedor, termo) {
  const busca = textoLimpo(termo);
  if (busca === "") return true;

  const digitos = somenteDigitos(busca);
  if (digitos.length >= 3 && somenteDigitos(fornecedor?.cpf_cnpj).includes(digitos)) return true;

  const alvo = semAcento(busca);
  if (alvo === "") return true;
  return textosDeBuscaDoFornecedor(fornecedor).some((campo) => semAcento(campo).includes(alvo));
}

/** A mesma busca aplicada a uma lista. Termo vazio devolve a lista inteira. */
export function filtrarFornecedoresPorTermo(fornecedores = [], termo = "") {
  return (fornecedores ?? []).filter((fornecedor) => fornecedorAtendeBusca(fornecedor, termo));
}

/* -------------------------------------------------------------------------
 * Estrutura ainda não criada no banco
 * ---------------------------------------------------------------------- */

/** Colunas criadas pela migration 20260905120000. */
export const COLUNA_APELIDO = "apelido";
export const COLUNA_NOME_EXIBICAO = "nome_exibicao_programacao";

/**
 * A falha significa "as colunas de apelido / nome de exibição ainda não existem
 * neste banco" (migration 20260905120000 não rodada)? Mesmo critério usado para
 * agência e PIX: estrutura ausente não é erro de uso, e a tela repete a consulta
 * sem a coluna nova em vez de mostrar erro.
 */
export function estruturaDeApelidoAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) return true;
  return /schema cache|apelido|nome_exibicao_programacao/i.test(String(erro?.message ?? ""));
}
