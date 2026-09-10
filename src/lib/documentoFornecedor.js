// UM DOCUMENTO, UM CADASTRO -- a conferência de CPF/CNPJ repetido contra o
// banco, antes de gravar o fornecedor.
//
// COMO A TRAVA É FEITA, EM TRÊS CAMADAS
//
//   1. LISTA JÁ CARREGADA na tela -- resposta imediata para o caso comum: o
//      fornecedor está ali na frente, ativo, e já tem aquele documento.
//   2. CONSULTA AO BANCO (public.fornecedor_com_documento) -- alcança o que a
//      lista da tela não traz: cadastro INATIVO, cadastro na LIXEIRA e cadastro
//      de outra secretaria. É ela que permite dizer o NOME do fornecedor.
//   3. ÍNDICE ÚNICO NO BANCO (fornecedores_cpf_cnpj_unico_idx) -- a palavra
//      final. Pega dois cadastros simultâneos e qualquer caminho que não passe
//      por esta tela. Quando ele barra, a falha é traduzida para a mesma
//      mensagem clara em vez de erro de banco.
//
// As camadas 2 e 3 chegam pela migration
// 20260910130000_fornecedor_documento_unico.sql, que precisa ser rodada
// manualmente no SQL Editor do Supabase. Enquanto ela não roda, a camada 1
// continua valendo e o cadastro NÃO é bloqueado por falha de consulta: a
// conferência serve para explicar, nunca para travar o trabalho por um erro
// que não é da usuária.

import { supabase } from "./supabaseClient";
import { erroAmigavel } from "./erros";
import {
  AVISO_MIGRATION_DOCUMENTO_UNICO,
  FUNCAO_CONSULTA_DOCUMENTO,
  chaveDocumento,
  estruturaDeDocumentoUnicoAusente,
  fornecedorComMesmoDocumento,
  mensagemDocumentoDuplicado,
  mensagemDocumentoDuplicadoSemIdentificacao,
} from "./documentoFornecedorRegras";

// As regras puras (normalização, comparação e as mensagens) ficam em
// ./documentoFornecedorRegras.js e são reexportadas aqui.
export {
  INDICE_DOCUMENTO_UNICO,
  FUNCAO_CONSULTA_DOCUMENTO,
  AVISO_MIGRATION_DOCUMENTO_UNICO,
  chaveDocumento,
  documentoInformado,
  mesmoDocumento,
  rotuloDocumento,
  situacaoDoFornecedor,
  fornecedorComMesmoDocumento,
  mensagemDocumentoDuplicado,
  mensagemDocumentoDuplicadoSemIdentificacao,
  duplicidadeDeDocumento,
  estruturaDeDocumentoUnicoAusente,
} from "./documentoFornecedorRegras";

/**
 * Quem já usa este CPF/CNPJ, segundo o banco.
 *
 * Devolve apenas identificação (id, nome, documento e situação). Qualquer falha
 * -- migration não rodada, sem permissão para a consulta, rede -- devolve null
 * com o motivo no console: a gravação continua, e o índice único do banco
 * segue sendo a trava de verdade.
 *
 * @param ignorarId id do próprio fornecedor, na edição.
 */
export async function consultarFornecedorPorDocumento({ cpfCnpj = "", ignorarId = null } = {}) {
  const documento = chaveDocumento(cpfCnpj);
  if (documento === "") return null;

  try {
    const { data, error } = await supabase.rpc(FUNCAO_CONSULTA_DOCUMENTO, {
      p_documento: documento,
      p_ignorar_id: ignorarId == null ? null : String(ignorarId),
    });
    if (error) throw error;
    if (!data?.encontrado) return null;
    return data.fornecedor ?? null;
  } catch (e) {
    if (estruturaDeDocumentoUnicoAusente(e)) {
      console.warn(`[Fornecedores] ${AVISO_MIGRATION_DOCUMENTO_UNICO}`, e);
    } else {
      console.error("[Fornecedores] não foi possível consultar o CPF/CNPJ no banco", e);
    }
    return null;
  }
}

/**
 * O documento está livre para este cadastro? Recusa com mensagem clara quando
 * não está -- a MESMA conferência serve para cadastrar (sem ignorarId) e para
 * editar (com o id do próprio fornecedor em ignorarId, para ele não conflitar
 * consigo mesmo).
 *
 * Fornecedor sem CPF/CNPJ informado passa direto: não entra na trava.
 *
 * @throws ErroAmigavel quando o documento já pertence a outro fornecedor.
 */
export async function conferirDocumentoDisponivel({
  cpfCnpj = "",
  ignorarId = null,
  fornecedores = [],
} = {}) {
  if (chaveDocumento(cpfCnpj) === "") return true;

  const naTela = fornecedorComMesmoDocumento({ fornecedores, cpfCnpj, ignorarId });
  if (naTela) throw erroAmigavel(mensagemDocumentoDuplicado(naTela, cpfCnpj));

  const noBanco = await consultarFornecedorPorDocumento({ cpfCnpj, ignorarId });
  if (noBanco) throw erroAmigavel(mensagemDocumentoDuplicado(noBanco, cpfCnpj));

  return true;
}

/**
 * A recusa do índice único traduzida para gente: tenta descobrir de quem é o
 * cadastro para poder dizer o nome, e cai na mensagem sem nome quando não
 * consegue.
 */
export async function mensagemDeDuplicidadeDoBanco({ cpfCnpj = "", ignorarId = null } = {}) {
  const fornecedor = await consultarFornecedorPorDocumento({ cpfCnpj, ignorarId });
  return fornecedor
    ? mensagemDocumentoDuplicado(fornecedor, cpfCnpj)
    : mensagemDocumentoDuplicadoSemIdentificacao(cpfCnpj);
}
