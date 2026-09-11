// Relação de valores: o terceiro modo de impressão.
//
// É a forma mais enxuta de levar uma área ao gestor: DUAS colunas, nome e
// valor, mais o TOTAL no fim. Nada além disso vai para o papel -- sem CNPJ,
// secretaria, situação, certidão, dados bancários, NF, processo, evento, data,
// observação, ícone ou botão.
//
// Este arquivo é só cálculo puro (sem banco e sem tela): quais itens entram, em
// que ordem e quanto somam. Quem imprime, quem gera o PDF e quem exporta a
// planilha usam o MESMO resultado daqui, então os três nunca divergem -- é o
// mesmo desenho dos relatórios que já existiam.
//
// NADA É RECALCULADO AQUI. O valor de cada item chega pronto de quem chamou: da
// tela da área (que o lê de `resumoFinanceiroDoRegistro`, ou seja, das baixas
// das NFs vinculadas) ou do resultado do relatório (que sai das mesmas
// funções). Esta relação apenas escolhe, ordena e soma o que recebeu -- é por
// isso que o total impresso bate exatamente com o total da tela.

import { centavos } from "./regrasBaixas.js";
import { paraNumeroMoeda } from "./moeda.js";

/** Nome mostrado quando o registro não tem descrição preenchida. */
export const SEM_NOME_NA_RELACAO = "--";

/**
 * As duas ordens oferecidas ao gerar. Nome A-Z é o padrão (é a ordem em que as
 * listagens já aparecem na tela); "maior valor primeiro" serve à análise rápida.
 */
export const ORDENS_DA_RELACAO = [
  { id: "nome", rotulo: "Nome (A-Z)", descricao: "Ordem alfabética, como na tela." },
  { id: "valor", rotulo: "Maior valor primeiro", descricao: "Do maior para o menor valor." },
];

export const ORDEM_PADRAO_DA_RELACAO = "nome";

/**
 * As opções de geração, no estado inicial: ordem alfabética e TODOS os
 * registros da tela.
 *
 * `somenteEmAberto` começa desligado de propósito: assim a relação sai com os
 * mesmos registros e o mesmo total que a tela mostra, e só recorta quando quem
 * emite pedir.
 */
export const OPCOES_PADRAO_DA_RELACAO = { ordem: ORDEM_PADRAO_DA_RELACAO, somenteEmAberto: false };

/** As opções vindas da tela, normalizadas (ordem desconhecida volta ao padrão). */
export function opcoesDaRelacao(opcoes = {}) {
  const ordem = ORDENS_DA_RELACAO.some((o) => o.id === opcoes?.ordem)
    ? opcoes.ordem
    : ORDEM_PADRAO_DA_RELACAO;
  return { ordem, somenteEmAberto: opcoes?.somenteEmAberto === true };
}

function textoDoNome(valor) {
  const texto = String(valor ?? "").trim();
  return texto === "" ? SEM_NOME_NA_RELACAO : texto;
}

function compararNome(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { sensitivity: "base" });
}

/** Um item da relação: só nome e valor, e o valor já em centavos fechados. */
export function itemDaRelacao(nome, valor) {
  return { nome: textoDoNome(nome), valor: centavos(paraNumeroMoeda(valor)) };
}

/**
 * Só os itens com saldo em aberto (valor acima de zero).
 *
 * Valor zerado é registro já quitado e fica de fora; valor negativo também não
 * está "em aberto" (as baixas passaram do valor do registro), então também sai.
 */
export function itensEmAberto(itens = []) {
  return itens.filter((item) => centavos(item?.valor) > 0);
}

/** Os itens na ordem pedida: nome A-Z, ou maior valor primeiro (nome desempata). */
export function ordenarItensDaRelacao(itens = [], ordem = ORDEM_PADRAO_DA_RELACAO) {
  const lista = [...itens];
  if (ordem === "valor") {
    return lista.sort(
      (a, b) => centavos(b?.valor) - centavos(a?.valor) || compararNome(a?.nome, b?.nome),
    );
  }
  return lista.sort((a, b) => compararNome(a?.nome, b?.nome));
}

/** A soma dos itens -- o TOTAL que vai impresso, fechado em centavos. */
export function totalDaRelacao(itens = []) {
  return itens.reduce((soma, item) => centavos(soma + centavos(item?.valor)), 0);
}

/**
 * A relação pronta para o papel: `{ titulo, rotuloNome, rotuloValor, itens,
 * registros, total, ordem, somenteEmAberto }`.
 *
 * `itens` chega como a tela o montou (já filtrado pela busca e pelos filtros
 * aplicados); daqui para frente só o recorte "somente em aberto" e a ordem
 * escolhida mexem na lista. O total é sempre a soma dos itens que saem
 * impressos -- nunca um número guardado à parte.
 */
export function montarRelacaoDeValores({
  titulo = "Relação de valores",
  rotuloNome = "Nome",
  rotuloValor = "Valor",
  itens = [],
  opcoes = {},
} = {}) {
  const escolhidas = opcoesDaRelacao(opcoes);
  const normalizados = (itens ?? [])
    .filter(Boolean)
    .map((item) => itemDaRelacao(item.nome, item.valor));
  const selecionados = escolhidas.somenteEmAberto ? itensEmAberto(normalizados) : normalizados;
  const ordenados = ordenarItensDaRelacao(selecionados, escolhidas.ordem);

  return {
    titulo: String(titulo ?? "").trim() || "Relação de valores",
    rotuloNome: String(rotuloNome ?? "").trim() || "Nome",
    rotuloValor: String(rotuloValor ?? "").trim() || "Valor",
    itens: ordenados,
    registros: ordenados.length,
    total: totalDaRelacao(ordenados),
    ordem: escolhidas.ordem,
    somenteEmAberto: escolhidas.somenteEmAberto,
  };
}

/* -------------------------------------------------------------------------
 * A relação a partir de um relatório da Central
 * ---------------------------------------------------------------------- */

const TIPOS_NUMERICOS = ["moeda", "numero", "percentual"];

function ehColunaDeTexto(coluna) {
  return !TIPOS_NUMERICOS.includes(coluna?.tipo);
}

/**
 * Quais colunas do relatório viram as duas da relação.
 *
 * O relatório pode dizer isso de propósito (`relacao: { nome, valor }` no
 * catálogo) -- é o caso de Patrocínios, Aluguéis e Bandas, em que o nome é a
 * descrição do registro e o valor é o Saldo. Quando ele não diz, a escolha é a
 * óbvia: a primeira coluna de texto e a coluna de dinheiro que já responde pelo
 * total do relatório.
 *
 * Devolve `null` quando o relatório não tem as duas colunas -- aí a relação de
 * valores simplesmente não é oferecida para ele.
 */
export function definicaoDaRelacao(resultado) {
  const colunas = resultado?.colunas ?? [];
  if (colunas.length === 0) return null;
  const porChave = (chave) => colunas.find((coluna) => coluna?.chave === chave) ?? null;

  const declarada = resultado?.relacao ?? null;
  const colunaNome = declarada?.nome ? porChave(declarada.nome) : colunas.find(ehColunaDeTexto);
  const colunaValor = declarada?.valor
    ? porChave(declarada.valor)
    : (resultado?.campoTotal && porChave(resultado.campoTotal)?.tipo === "moeda"
        ? porChave(resultado.campoTotal)
        : [...colunas].reverse().find((coluna) => coluna?.tipo === "moeda" && coluna?.somavel)) ??
      null;

  if (!colunaNome || !colunaValor) return null;
  return {
    nome: colunaNome.chave,
    valor: colunaValor.chave,
    rotuloNome: declarada?.rotuloNome ?? colunaNome.label ?? "Nome",
    rotuloValor: declarada?.rotuloValor ?? colunaValor.label ?? "Valor",
  };
}

/** O relatório tem as duas colunas de que a relação de valores precisa? */
export function relacaoDisponivel(resultado) {
  return definicaoDaRelacao(resultado) !== null;
}

/**
 * A relação de valores de um relatório já gerado.
 *
 * As linhas vêm dos grupos do próprio resultado -- as MESMAS que a tela mostra
 * e que a impressão detalhada e a compacta levam ao papel. A relação só reduz a
 * duas colunas; ela não refaz conta nenhuma.
 */
export function relacaoDoResultado(resultado, opcoes = {}, { titulo } = {}) {
  const definicao = definicaoDaRelacao(resultado);
  if (!definicao) return null;

  const linhas = (resultado?.grupos ?? []).flatMap((grupo) => grupo?.linhas ?? []);
  return montarRelacaoDeValores({
    titulo: titulo ?? resultado?.nome,
    rotuloNome: definicao.rotuloNome,
    rotuloValor: definicao.rotuloValor,
    itens: linhas.map((linha) => ({ nome: linha?.[definicao.nome], valor: linha?.[definicao.valor] })),
    opcoes,
  });
}
