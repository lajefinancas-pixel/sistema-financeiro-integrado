// Formatação e leitura de valores em real brasileiro.
//
// O valor continua sendo guardado como número decimal (é isso que vai para o
// banco); tudo aqui é apresentação: exibir "R$ 1.000.000,00" e interpretar o
// que o usuário digita sem confundir separador de milhar com decimal.

const FORMATADOR_BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "R$ 1.000.000,00" (inclusive para negativos: "-R$ 1.000,00"). */
export function formatBRL(valor) {
  return FORMATADOR_BRL.format(paraNumeroMoeda(valor));
}

/**
 * Mesma coisa, mas sem espaço especial nem símbolos fora do ASCII -- usado em
 * PDF e planilha, onde o "R$" com espaço fino sai torto.
 */
export function formatBRLSimples(valor) {
  return formatBRL(valor)
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/\u2212/g, "-");
}

/** Formato de célula de planilha equivalente a formatBRL. */
export const FORMATO_MOEDA_PLANILHA = "R$ #,##0.00";

/**
 * Variação percentual já com o sinal: "+12,5%", "-3,2%", "0,0%".
 *
 * `null`/`undefined` viram "--": é o caso em que não existe base de comparação
 * (o lado anterior era zero), e não uma variação de 0%.
 */
export function formatarPercentual(valor) {
  const numero = Number(valor);
  if (valor === null || valor === undefined || valor === "" || !Number.isFinite(numero)) return "--";
  const absoluto = Math.abs(numero).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sinal = numero > 0 ? "+" : numero < 0 ? "-" : "";
  return `${sinal}${absoluto}%`;
}

/**
 * Separa o texto digitado em sinal, parte inteira e centavos.
 *
 * Regra: a vírgula sempre manda, porque é o separador decimal brasileiro
 * ("2.500,50" -> 2500,50). O ponto só vale como decimal quando aparece uma
 * única vez com até duas casas depois ("2500.50" -> 2500,50); nos outros casos
 * ele é separador de milhar ("1.000.000" -> 1000000).
 */
function separarPartes(texto) {
  const bruto = String(texto ?? "");
  const negativo = /-/.test(bruto);
  const limpo = bruto.replace(/[^\d.,]/g, "");

  let inteiro = limpo;
  let decimal = "";
  let temSeparador = false;

  const ultimaVirgula = limpo.lastIndexOf(",");
  if (ultimaVirgula > -1) {
    inteiro = limpo.slice(0, ultimaVirgula);
    decimal = limpo.slice(ultimaVirgula + 1);
    temSeparador = true;
  } else {
    const ultimoPonto = limpo.lastIndexOf(".");
    const casasDepois = limpo.length - ultimoPonto - 1;
    const pontoUnico = limpo.indexOf(".") === ultimoPonto;
    if (ultimoPonto > -1 && pontoUnico && casasDepois > 0 && casasDepois <= 2) {
      inteiro = limpo.slice(0, ultimoPonto);
      decimal = limpo.slice(ultimoPonto + 1);
      temSeparador = true;
    }
  }

  return {
    negativo,
    inteiro: inteiro.replace(/\D/g, ""),
    decimal: decimal.replace(/\D/g, "").slice(0, 2),
    temSeparador,
    temDigito: /\d/.test(limpo),
  };
}

// Número escrito pela máquina, não por uma pessoa: o que o banco devolve em
// coluna numeric, o que vem de JSON ou de uma soma feita em código. Chega sem
// "R$" e com ponto decimal.
const MAQUINA_DECIMAL = /^-?\d+\.\d+$/;
// Agrupamento brasileiro de milhar com um único ponto: "1.234", "999.000".
const MILHAR_BR = /^-?\d{1,3}\.\d{3}$/;

/**
 * Lê um número de máquina, quando ele não pode ser confundido com milhar.
 *
 * "1.234" continua valendo mil duzentos e trinta e quatro: é agrupamento
 * brasileiro válido e é o que quem digita quer dizer. Já "12345.678" não é
 * agrupamento nenhum (grupo de cinco dígitos antes do ponto), então tratar o
 * ponto como milhar multiplicava o valor por mil -- 12.345,678 virava
 * R$ 12.345.678,00. O texto vindo do campo com máscara sempre traz "R$" e por
 * isso nunca entra por aqui: a digitação segue exatamente como antes.
 */
function numeroDeMaquina(valor) {
  const texto = String(valor).trim();
  if (!MAQUINA_DECIMAL.test(texto) || MILHAR_BR.test(texto)) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

/** Número decimal a partir de qualquer entrada (número, "1.000,50", "R$ 20"). */
export function paraNumeroMoeda(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (valor === null || valor === undefined || valor === "") return 0;

  const deMaquina = numeroDeMaquina(valor);
  if (deMaquina !== null) return deMaquina;

  const { negativo, inteiro, decimal, temDigito } = separarPartes(valor);
  if (!temDigito) return 0;

  const numero = Number(`${inteiro || "0"}.${decimal || "0"}`);
  if (!Number.isFinite(numero)) return 0;
  return negativo ? -numero : numero;
}

function agruparMilhar(digitos) {
  return (digitos || "0").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Máscara aplicada a cada tecla: agrupa o milhar na hora e preserva os
 * centavos que o usuário ainda está digitando (não força ",00" no meio da
 * digitação, senão seria impossível informar centavos).
 */
export function mascararMoedaDigitando(texto) {
  const { negativo, inteiro, decimal, temSeparador, temDigito } = separarPartes(texto);
  if (!temDigito) return negativo ? "-" : "";

  const corpo = agruparMilhar(inteiro) + (temSeparador ? `,${decimal}` : "");
  return `${negativo ? "-" : ""}R$ ${corpo}`;
}

/** Texto final do campo depois de sair dele: sempre com os centavos completos. */
export function mascararMoedaCompleta(texto) {
  const { temDigito } = separarPartes(texto);
  if (!temDigito) return "";
  return formatBRL(paraNumeroMoeda(texto));
}
