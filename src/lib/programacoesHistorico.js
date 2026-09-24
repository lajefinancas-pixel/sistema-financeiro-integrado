const TAMANHO_PAGINA = 1000;

async function consultarTodas(criarConsulta) {
  const linhas = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await criarConsulta().range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    const pagina = data ?? [];
    linhas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return linhas;
    inicio += TAMANHO_PAGINA;
  }
}

/**
 * Leitura completa do histórico. A paginação explícita evita o limite padrão
 * de 1.000 linhas do PostgREST; nenhuma operação de escrita é feita aqui.
 */
export async function listarHistoricoProgramacoes(cliente) {
  const programacoes = await consultarTodas(() => cliente
    .from("programacoes_pagamento")
    .select("id, data_programacao, secretaria_id, status, fechado, total_programado, secretarias(nome)")
    .is("excluido_em", null)
    .order("data_programacao", { ascending: false })
    .order("id", { ascending: false }));

  const pagamentos = await consultarTodas(() => cliente
    .from("pagamentos")
    .select("id, programacao_id, fornecedor_id")
    .not("programacao_id", "is", null)
    .is("excluido_em", null)
    .order("id"));

  const fornecedoresPorProgramacao = new Map();
  for (const pagamento of pagamentos) {
    const chave = String(pagamento.programacao_id);
    if (!fornecedoresPorProgramacao.has(chave)) fornecedoresPorProgramacao.set(chave, new Set());
    // Cada item avulso representa um fornecedor próprio; fornecedores
    // cadastrados repetidos contam uma única vez na mesma programação.
    fornecedoresPorProgramacao.get(chave).add(
      pagamento.fornecedor_id == null ? `avulso:${pagamento.id}` : `fornecedor:${pagamento.fornecedor_id}`,
    );
  }

  return programacoes.map((item) => ({
    ...item,
    secretaria_nome: item.secretarias?.nome || "Secretaria não identificada",
    quantidade_fornecedores: fornecedoresPorProgramacao.get(String(item.id))?.size ?? 0,
  }));
}

export function filtrarEOrdenarProgramacoes(programacoes, filtros) {
  const numero = String(filtros.numero ?? "").trim();
  const data = String(filtros.data ?? "").trim();
  const secretaria = String(filtros.secretaria ?? "").trim();
  const status = String(filtros.status ?? "").trim();
  const resultado = programacoes.filter((item) => (
    (!numero || String(item.id).includes(numero))
    && (!data || item.data_programacao === data)
    && (!secretaria || String(item.secretaria_id) === secretaria)
    && (!status || (status === "historico" ? item.fechado === true : item.fechado !== true && item.status === status))
  ));

  return [...resultado].sort((a, b) => {
    if (filtros.ordenacao === "numero_asc") return Number(a.id) - Number(b.id);
    if (filtros.ordenacao === "numero_desc") return Number(b.id) - Number(a.id);
    const porData = String(b.data_programacao).localeCompare(String(a.data_programacao));
    return porData || Number(b.id) - Number(a.id);
  });
}
