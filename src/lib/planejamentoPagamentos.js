import { paraNumeroMoeda } from "./moeda.js";

export function valorPlanejamento(valor) {
  return Math.round(paraNumeroMoeda(valor) * 100) / 100;
}

export function alternarSelecao(idsSelecionados, id) {
  const proximo = new Set(idsSelecionados);
  if (proximo.has(id)) proximo.delete(id);
  else proximo.add(id);
  return proximo;
}

export function selecionarTodosVisiveis(idsSelecionados, idsVisiveis) {
  const proximo = new Set(idsSelecionados);
  const todosMarcados = idsVisiveis.length > 0 && idsVisiveis.every((id) => proximo.has(id));
  idsVisiveis.forEach((id) => todosMarcados ? proximo.delete(id) : proximo.add(id));
  return proximo;
}

export function somarContasSelecionadas(contas, idsSelecionados) {
  return valorPlanejamento(contas.filter((conta) => idsSelecionados.has(conta.id)).reduce((total, conta) => total + valorPlanejamento(conta.saldo), 0));
}

export function somarPagamentos(pagamentos) {
  return valorPlanejamento(pagamentos.reduce((total, pagamento) => total + valorPlanejamento(pagamento.valor_a_pagar), 0));
}

export function calcularRestante(saldo, totalProgramado) {
  return valorPlanejamento(valorPlanejamento(saldo) - valorPlanejamento(totalProgramado));
}

export function definirValorProgramado(pagamentos, pagamentoAlvo, valor) {
  return pagamentos.map((pagamento) => pagamento === pagamentoAlvo ? { ...pagamento, valor_a_pagar: valorPlanejamento(valor) } : pagamento);
}

/**
 * Ordem "maior valor em aberto primeiro": primeiro quem tem valor em aberto, do
 * maior para o menor; quem está com R$ 0,00 vai para o fim, em ordem
 * alfabética. Aqui só se ordena -- nenhum valor é recalculado.
 *
 * NÃO é mais a ordem PADRÃO da Proposta: a programação diária abre em ordem
 * alfabética pelo nome exibido (`ordenarFornecedoresPorNome`, de
 * lib/nomesFornecedor.js), porque é essa a ordem em que a lista é lida na
 * reunião. Esta ordem continua aqui, inteira e testada, para o dia em que a tela
 * oferecer a escolha da ordenação.
 */
export function ordenarFornecedoresPorAberto(fornecedores) {
  return [...fornecedores].sort((a, b) => {
    const abertoA = valorPlanejamento(a.valor_em_aberto);
    const abertoB = valorPlanejamento(b.valor_em_aberto);
    if ((abertoA > 0) !== (abertoB > 0)) return abertoA > 0 ? -1 : 1;
    if (abertoA !== abertoB) return abertoB - abertoA;
    return String(a.razao_social ?? "").localeCompare(String(b.razao_social ?? ""), "pt-BR");
  });
}

/**
 * Identidade de cada item da programação na tela, para o React reconhecer a
 * MESMA linha depois de a lista reordenar.
 *
 * Reordenar é só exibição, e a linha não pode ser identificada pela posição:
 * acrescentar um fornecedor empurra os seguintes para baixo e, com chave de
 * posição, o React remontaria essas linhas -- o campo de valor em que a pessoa
 * está digitando perderia o foco e a renomeação aberta fecharia sozinha.
 *
 * A chave vem do que o item É: o id quando ele já está gravado, o
 * `fornecedor_id` quando é fornecedor cadastrado ainda não salvo, e o nome
 * digitado quando é avulso. Dois avulsos com o mesmo nome são numerados na ordem
 * de inclusão, que não muda quando a lista é reordenada.
 *
 * Devolve um Map do próprio objeto do item para a chave: nada é gravado no item,
 * nenhum vínculo é criado por nome e nenhum valor é tocado.
 */
export function chavesDeExibicaoDosPagamentos(pagamentos = []) {
  const repeticoes = new Map();
  const chaves = new Map();
  (pagamentos ?? []).forEach((pagamento) => {
    const base = baseDaChaveDeExibicao(pagamento);
    const repeticao = (repeticoes.get(base) ?? 0) + 1;
    repeticoes.set(base, repeticao);
    chaves.set(pagamento, repeticao === 1 ? base : `${base}#${repeticao}`);
  });
  return chaves;
}

function preenchido(valor) {
  return valor !== null && valor !== undefined && String(valor).trim() !== "";
}

function baseDaChaveDeExibicao(pagamento) {
  if (preenchido(pagamento?.id)) return `id:${pagamento.id}`;
  if (preenchido(pagamento?.fornecedor_id)) return `fornecedor:${pagamento.fornecedor_id}`;
  return `avulso:${String(pagamento?.nome_avulso ?? "").trim().toLowerCase()}`;
}
