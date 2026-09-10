// UM DOCUMENTO, UM CADASTRO -- regras puras da trava de fornecedor duplicado
// por CPF/CNPJ.
//
// O problema que estas regras resolvem: o mesmo fornecedor cadastrado duas
// vezes com o mesmo CPF/CNPJ espalha notas, certidões e valores em aberto entre
// dois registros, e nenhuma das duas fichas mostra a situação real dele.
//
// COMO A COMPARAÇÃO É FEITA
//
// Só pelos DÍGITOS. "12.345.678/0001-90" e "12345678000190" são o mesmo
// documento. A normalização existe apenas para COMPARAR: o valor gravado no
// cadastro continua exatamente como foi digitado.
//
// QUEM ENTRA NA VERIFICAÇÃO
//
// Todos os cadastros: ativo, INATIVO e o que está na LIXEIRA (exclusão lógica).
// Inativar ou excluir não deixa de ser o mesmo fornecedor -- o caminho certo é
// reativar ou restaurar o cadastro que já existe, e é isso que a mensagem
// oferece. Fornecedor SEM CPF/CNPJ não entra na trava: fica sem documento para
// comparar e continua permitido.
//
// Este arquivo é puro (sem banco e sem tela) para poder ser testado direto.
// Quem usa a tela importa de ./documentoFornecedor.js, que reexporta tudo daqui
// e acrescenta a consulta ao banco.

import { nomeOficialDoFornecedor } from "./nomesFornecedor.js";

/** Nome do índice único criado pela migration 20260910130000. */
export const INDICE_DOCUMENTO_UNICO = "fornecedores_cpf_cnpj_unico_idx";

/** Consulta de leitura criada pela mesma migration. */
export const FUNCAO_CONSULTA_DOCUMENTO = "fornecedor_com_documento";

/**
 * Aviso mostrado quando a trava do banco ainda não existe neste banco -- a
 * migration acima não foi rodada no SQL Editor do Supabase.
 */
export const AVISO_MIGRATION_DOCUMENTO_UNICO =
  "A trava de CPF/CNPJ repetido ainda não está no banco. Rode a migration " +
  "20260910130000_fornecedor_documento_unico.sql no SQL Editor do Supabase. " +
  "Até lá, a conferência vale apenas pela tela.";

/** O documento reduzido ao que importa para comparar: só os dígitos. */
export function chaveDocumento(valor) {
  return String(valor ?? "").replace(/\D+/g, "");
}

/** O CPF/CNPJ foi informado? (pontuação sozinha não é documento) */
export function documentoInformado(valor) {
  return chaveDocumento(valor) !== "";
}

/** Os dois textos são o mesmo documento, ignorando pontuação? */
export function mesmoDocumento(a, b) {
  const chave = chaveDocumento(a);
  return chave !== "" && chave === chaveDocumento(b);
}

/** Como o documento é chamado na mensagem, pela quantidade de dígitos. */
export function rotuloDocumento(valor) {
  const digitos = chaveDocumento(valor).length;
  if (digitos === 11) return "CPF";
  if (digitos === 14) return "CNPJ";
  return "CPF/CNPJ";
}

/**
 * Situação do cadastro para efeito da mensagem: "ativo", "inativo" (ativo =
 * false) ou "excluido" (na Lixeira, exclusão lógica). Quando o banco já
 * respondeu a situação, ela é respeitada.
 */
export function situacaoDoFornecedor(fornecedor) {
  const informada = String(fornecedor?.situacao ?? "").trim();
  if (["ativo", "inativo", "excluido"].includes(informada)) return informada;
  if (fornecedor?.excluido_em) return "excluido";
  if (fornecedor?.ativo === false) return "inativo";
  return "ativo";
}

/**
 * Fornecedor já cadastrado com o MESMO documento, dentro de uma lista já
 * carregada.
 *
 * @param ignorarId id do próprio fornecedor, na edição -- ele nunca conflita
 *                  consigo mesmo.
 * @returns o fornecedor em conflito, ou null.
 */
export function fornecedorComMesmoDocumento({ fornecedores = [], cpfCnpj = "", ignorarId = null } = {}) {
  const chave = chaveDocumento(cpfCnpj);
  if (chave === "") return null;

  const ignorar = ignorarId == null ? null : String(ignorarId);
  return (
    (fornecedores ?? []).find(
      (fornecedor) =>
        (ignorar === null || String(fornecedor?.id) !== ignorar) &&
        chaveDocumento(fornecedor?.cpf_cnpj) === chave,
    ) ?? null
  );
}

/**
 * A recusa explicada: diz o NOME do fornecedor que já tem aquele documento,
 * para a pessoa entender que não é erro de digitação, é o mesmo fornecedor --
 * e diz o que fazer no lugar de cadastrar outra vez.
 */
export function mensagemDocumentoDuplicado(fornecedor, documentoDigitado = "") {
  const documento = String(fornecedor?.cpf_cnpj ?? "").trim() || String(documentoDigitado ?? "").trim();
  const rotulo = rotuloDocumento(documento || documentoDigitado);
  const nome = nomeOficialDoFornecedor(fornecedor);
  const inicio = `Este ${rotulo}${documento ? ` (${documento})` : ""} já está cadastrado para "${nome}".`;

  switch (situacaoDoFornecedor(fornecedor)) {
    case "inativo":
      return (
        `${inicio} Esse cadastro está INATIVO. É o mesmo fornecedor, não erro de digitação: ` +
        "reative o cadastro que já existe em vez de criar outro com o mesmo documento."
      );
    case "excluido":
      return (
        `${inicio} Esse cadastro está na LIXEIRA. É o mesmo fornecedor, não erro de digitação: ` +
        "restaure o cadastro pela Lixeira em vez de criar outro com o mesmo documento."
      );
    default:
      return (
        `${inicio} É o mesmo fornecedor, não erro de digitação: use o cadastro que já existe. ` +
        "Se algum dado dele mudou, atualize o cadastro existente."
      );
  }
}

/**
 * A mesma recusa quando o banco barrou a gravação e não foi possível descobrir
 * de quem é o cadastro (por exemplo, quem está cadastrando não tem acesso a
 * ele). O documento continua sendo dito, para a pessoa saber o que conferir.
 */
export function mensagemDocumentoDuplicadoSemIdentificacao(documentoDigitado = "") {
  const documento = String(documentoDigitado ?? "").trim();
  const rotulo = rotuloDocumento(documento);
  return (
    `Este ${rotulo}${documento ? ` (${documento})` : ""} já está cadastrado em outro fornecedor. ` +
    "Um CPF/CNPJ pertence a um único cadastro: procure o fornecedor pelo documento na lista " +
    "(inclusive entre os inativos e na Lixeira) e use o cadastro que já existe."
  );
}

/** A falha do banco é a trava do documento repetido (índice único)? */
export function duplicidadeDeDocumento(erro) {
  const texto = `${erro?.message ?? ""} ${erro?.details ?? ""} ${erro?.hint ?? ""}`;
  if (new RegExp(INDICE_DOCUMENTO_UNICO, "i").test(texto)) return true;
  return String(erro?.code ?? "") === "23505" && /cpf_cnpj/i.test(texto);
}

/**
 * A falha significa "a trava ainda não existe neste banco" (migration
 * 20260910130000 não rodada)? Mesmo critério já usado para apelido, agência e
 * PIX: estrutura ausente não é erro de uso -- a tela segue com a conferência
 * que consegue fazer, em vez de mostrar erro.
 */
export function estruturaDeDocumentoUnicoAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42883", "42P01", "PGRST202", "PGRST200", "PGRST204", "PGRST205"].includes(codigo)) return true;
  return new RegExp(`schema cache|${FUNCAO_CONSULTA_DOCUMENTO}`, "i").test(String(erro?.message ?? ""));
}
