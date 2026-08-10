import React from "react";
import { formatBRL, mascararMoedaDigitando, mascararMoedaCompleta, paraNumeroMoeda } from "../lib/moeda";

/**
 * Campo de valor em real: mostra "R$ 1.000.000,00" enquanto o usuário digita e
 * entrega para o componente pai o número decimal puro (o que vai para o banco).
 *
 * - digitar "1000000" -> "R$ 1.000.000,00"
 * - digitar "2500,50" -> "R$ 2.500,50"
 *
 * Durante a digitação os centavos ficam como foram teclados; ao sair do campo o
 * texto é completado ("R$ 1.000.000,00").
 */
export default function CampoMoeda({ valor, onValorChange, className = "", onFocus, onBlur, ...atributos }) {
  const [texto, setTexto] = React.useState(() => textoInicial(valor));
  const [digitando, setDigitando] = React.useState(false);

  // Enquanto o campo está em uso, quem manda é o que o usuário digitou.
  React.useEffect(() => {
    if (!digitando) setTexto(textoInicial(valor));
  }, [valor, digitando]);

  function aoDigitar(evento) {
    const mascarado = mascararMoedaDigitando(evento.target.value);
    setTexto(mascarado);
    onValorChange?.(paraNumeroMoeda(mascarado), mascarado);
  }

  function aoFocar(evento) {
    setDigitando(true);
    // Seleciona o conteúdo para que a digitação substitua o valor anterior.
    evento.target.select();
    onFocus?.(evento);
  }

  function aoSair(evento) {
    setDigitando(false);
    const completo = mascararMoedaCompleta(evento.target.value);
    setTexto(completo);
    onValorChange?.(paraNumeroMoeda(completo), completo);
    onBlur?.(evento);
  }

  return (
    <input
      {...atributos}
      type="text"
      inputMode="decimal"
      value={texto}
      onChange={aoDigitar}
      onFocus={aoFocar}
      onBlur={aoSair}
      className={className}
    />
  );
}

function textoInicial(valor) {
  if (valor === "" || valor === null || valor === undefined) return "";
  return formatBRL(valor);
}
