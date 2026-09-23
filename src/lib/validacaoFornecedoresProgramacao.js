import { nomeExibicaoDoPagamento } from "./nomesFornecedor.js";

/**
 * Confere os vínculos antes de chamar salvar_planejamento_programacao.
 *
 * A RPC usa SECURITY DEFINER e enxerga exatamente as linhas que a chave
 * estrangeira enxerga; uma consulta direta à tabela poderia confundir RLS com
 * fornecedor inexistente. Itens avulsos não têm vínculo e não entram aqui.
 */
export async function validarFornecedoresDaProgramacao(cliente, pagamentos = []) {
  const vinculados = pagamentos.filter((item) => item?.fornecedor_id != null && String(item.fornecedor_id).trim() !== "");
  const porId = new Map();
  vinculados.forEach((item) => porId.set(String(item.fornecedor_id), item));

  const resultados = await Promise.all([...porId.entries()].map(async ([id, item]) => {
    const { data, error } = await cliente.rpc("fornecedor_referenciavel", { p_fornecedor_id: Number(id) });
    if (error) throw error;
    return { id, item, situacao: data };
  }));

  const invalido = resultados.find((resultado) => resultado.situacao === "ausente");
  if (!invalido) return;

  const nome = nomeExibicaoDoPagamento(invalido.item);
  const erro = new Error(`O item “${nome}” aponta para o fornecedor ${invalido.id}, que não existe mais no cadastro. Remova o item, escolha o fornecedor novamente e salve.`);
  erro.name = "FornecedorInexistenteError";
  erro.code = "FORNECEDOR_INEXISTENTE";
  erro.details = `item=${nome} fornecedor_id=${invalido.id} situacao=ausente`;
  erro.hint = "O salvamento foi interrompido antes de enviar p_pagamentos; nenhum dado foi gravado.";
  erro.amigavel = true;
  throw erro;
}

