// Valor monetário escrito por extenso, em português do Brasil.
//
// O modelo oficial da Requisição de Diárias e da Liquidação traz uma coluna
// "VALOR POR EXTENSO" ao lado do valor em número: é o que o papel exige, e é
// gerado aqui a partir do próprio valor, sem digitação.
//
// R$ 1.250,00 -> "mil, duzentos e cinquenta reais"
// R$ 1.100,50 -> "mil e cem reais e cinquenta centavos"
//
// Só texto: nada aqui grava, calcula saldo ou toca em pagamento. O arquivo é
// carregado direto pelos testes, sem o resolvedor de módulos do Vite, então
// mora aqui só função pura.

import { paraNumeroMoeda } from "./moeda.js";

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];

const DEZ_A_DEZENOVE = [
  "dez", "onze", "doze", "treze", "quatorze",
  "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
];

const DEZENAS = [
  "", "", "vinte", "trinta", "quarenta",
  "cinquenta", "sessenta", "setenta", "oitenta", "noventa",
];

const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos",
  "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos",
];

/** As escalas que um valor de diária alcança, com folga. */
const ESCALAS = [
  { singular: "", plural: "" },
  { singular: "mil", plural: "mil" },
  { singular: "milhão", plural: "milhões" },
  { singular: "bilhão", plural: "bilhões" },
  { singular: "trilhão", plural: "trilhões" },
];

/** 1 a 999 por extenso: "cem", "cento e um", "duzentos e cinquenta". */
function grupoPorExtenso(valor) {
  if (valor <= 0 || valor > 999) return "";
  if (valor === 100) return "cem"; // "cem" exato; 101 já é "cento e um"

  const centena = Math.floor(valor / 100);
  const resto = valor % 100;
  const partes = [];

  if (centena > 0) partes.push(CENTENAS[centena]);

  if (resto >= 10 && resto < 20) {
    partes.push(DEZ_A_DEZENOVE[resto - 10]);
  } else {
    const dezena = Math.floor(resto / 10);
    const unidade = resto % 10;
    if (dezena > 0) partes.push(DEZENAS[dezena]);
    if (unidade > 0) partes.push(UNIDADES[unidade]);
  }

  return partes.join(" e ");
}

/** Os grupos de três dígitos, do mais significativo para o menos. */
function gruposDeTres(inteiro) {
  const grupos = [];
  let resto = inteiro;
  while (resto > 0) {
    grupos.unshift(resto % 1000);
    resto = Math.floor(resto / 1000);
  }
  return grupos;
}

/**
 * Número inteiro por extenso.
 *
 * A ligadura entre os grupos é a da escrita formal brasileira: vírgula entre
 * eles ("mil, duzentos e cinquenta") e "e" antes do último quando ele é menor
 * que cem ou centena redonda ("mil e um", "mil e cem").
 */
export function inteiroPorExtenso(valor) {
  const inteiro = Math.trunc(Math.abs(Number(valor) || 0));
  if (inteiro === 0) return "zero";

  const grupos = gruposDeTres(inteiro);
  const escritos = [];

  grupos.forEach((grupo, indice) => {
    if (grupo === 0) return;
    const escala = ESCALAS[grupos.length - 1 - indice] ?? ESCALAS[0];
    if (!escala.singular) {
      escritos.push({ valor: grupo, texto: grupoPorExtenso(grupo) });
      return;
    }
    // "mil" nunca leva "um" na frente: 1.000 é "mil", não "um mil".
    const nome = grupo === 1 ? escala.singular : escala.plural;
    const prefixo = grupo === 1 && escala.singular === "mil" ? "" : `${grupoPorExtenso(grupo)} `;
    escritos.push({ valor: grupo, texto: `${prefixo}${nome}` });
  });

  if (escritos.length === 1) return escritos[0].texto;

  const ultimo = escritos[escritos.length - 1];
  const anteriores = escritos.slice(0, -1).map((parte) => parte.texto);
  const ligadura = ultimo.valor < 100 || ultimo.valor % 100 === 0 ? " e " : ", ";
  return `${anteriores.join(", ")}${ligadura}${ultimo.texto}`;
}

/**
 * "real", "reais" ou "de reais".
 *
 * Milhão, bilhão e trilhão redondos pedem a preposição -- "um milhão DE reais"
 * --, mas só quando o número termina na escala: 1.500.000 é "um milhão e
 * quinhentos mil reais", sem "de".
 */
function moedaDoInteiro(reais) {
  if (reais === 1) return "real";
  if (reais >= 1000000 && reais % 1000000 === 0) return "de reais";
  return "reais";
}

/**
 * O valor em reais por extenso, como o documento pede.
 *
 * Aceita o que o resto do sistema aceita como dinheiro (número do banco,
 * "1.250,00", "R$ 20"), pelo mesmo utilitário de moeda das outras telas.
 */
export function valorPorExtenso(valor) {
  const numero = paraNumeroMoeda(valor);
  const centavosTotais = Math.round(Math.abs(numero) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;

  const partes = [];
  if (reais > 0) partes.push(`${inteiroPorExtenso(reais)} ${moedaDoInteiro(reais)}`);
  if (centavos > 0) {
    partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  if (partes.length === 0) return "zero real";

  const escrito = partes.join(" e ");
  return numero < 0 ? `menos ${escrito}` : escrito;
}
