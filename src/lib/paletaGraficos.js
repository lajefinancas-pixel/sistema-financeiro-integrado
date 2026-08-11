// Paleta dos gráficos gerenciais.
//
// A ordem das cores é fixa: a série 1 sempre recebe o primeiro tom, a 2 o
// segundo, e assim por diante. Nunca circular a lista nem repintar as séries
// quando um filtro muda a quantidade delas -- a cor identifica o dado, não a
// posição dele no ranking.
//
// Paleta validada com o validador de paleta (superfície clara #FFFFFF,
// 8 tons): faixa de luminosidade, piso de croma, separação entre pares
// vizinhos em daltonismo (pior caso ΔE 8,6 protanopia / 8,1 tritanopia) e piso
// de visão normal (pior caso ΔE 17,5) -- todos aprovados. O tom institucional
// dourado ocupa o quarto lugar.
//
// Três tons ficaram com aviso de contraste sobre o branco (o verde, o dourado e
// o rosa). O aviso é atendido do jeito previsto: a rosca leva rótulo direto em
// cada fatia e a tabela detalhada continua sempre visível ao lado do gráfico --
// nenhuma informação depende só da cor.

export const PALETA_CATEGORICA = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#c9a227",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

/** Cor da fatia "Outros" da rosca: neutra de propósito, não é uma categoria. */
export const COR_OUTROS = "#8A97A5";

/** Fica no fim da lista, então nunca compete com uma série de verdade. */
export const CORES = {
  grade: "#E7EAEE",
  eixo: "#5A6B7C",
  texto: "#0F2A44",
  superficie: "#FFFFFF",
};

/**
 * Cor da série pela posição declarada -- acima de oito séries a lista não é
 * reciclada: `dadosDoGrafico` já agrupa o excedente em "Outros".
 */
export function corDaSerie(indice, nome) {
  if (String(nome ?? "").toLowerCase() === "outros") return COR_OUTROS;
  return PALETA_CATEGORICA[indice] ?? COR_OUTROS;
}

export const MAX_CATEGORIAS_ROSCA = 5;
