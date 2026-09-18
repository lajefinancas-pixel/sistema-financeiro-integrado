import React from "react";
import { formatBRL, paraNumeroMoeda } from "../lib/moeda";
import { valorPorExtenso } from "../lib/valorPorExtenso";

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
  const [centavos, setCentavos] = React.useState(() => paraCentavos(valor));
  const [emFoco, setEmFoco] = React.useState(false);
  const referencia = React.useRef(null);

  React.useEffect(() => {
    setCentavos(paraCentavos(valor));
  }, [valor]);

  function publicar(proximos) {
    const seguro = Math.max(0, Number(proximos) || 0);
    const numero = seguro / 100;
    const texto = formatBRL(numero);
    setCentavos(seguro);
    onValorChange?.(paraNumeroMoeda(texto), texto);
    requestAnimationFrame(() => cursorNoFim(referencia.current));
  }

  function aoFocar(evento) {
    setEmFoco(true);
    cursorNoFim(evento.target);
    onFocus?.(evento);
  }

  function aoDesfocar(evento) {
    setEmFoco(false);
    onBlur?.(evento);
  }

  function aoTeclar(evento) {
    if (/^\d$/.test(evento.key)) {
      evento.preventDefault();
      publicar(centavos * 10 + Number(evento.key));
    } else if (evento.key === "Backspace" || evento.key === "Delete") {
      evento.preventDefault();
      publicar(Math.floor(centavos / 10));
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "PageUp", "PageDown", ",", "."].includes(evento.key)) {
      evento.preventDefault();
      cursorNoFim(evento.currentTarget);
    }
  }

  function aoColar(evento) {
    evento.preventDefault();
    publicar(Math.round(paraNumeroMoeda(evento.clipboardData.getData("text")) * 100));
  }

  const numero = centavos / 100;
  return <div className="min-w-0">
    <input
      {...atributos}
      ref={referencia}
      type="text"
      inputMode="numeric"
      value={formatBRL(numero)}
      onChange={() => {}}
      onKeyDown={aoTeclar}
      onPaste={aoColar}
      onClick={(evento) => cursorNoFim(evento.currentTarget)}
      onSelect={(evento) => cursorNoFim(evento.currentTarget)}
      onFocus={aoFocar}
      onBlur={aoDesfocar}
      className={className}
    />
    {emFoco && numero >= 10000 && <small className="mt-1 block text-[10px] leading-snug text-[var(--color-brand-navy,#0F2A44)]/55">{valorPorExtenso(numero)}</small>}
  </div>;
}

function paraCentavos(valor) {
  return Math.max(0, Math.round(paraNumeroMoeda(valor) * 100));
}

function cursorNoFim(campo) {
  if (!campo || document.activeElement !== campo) return;
  const fim = campo.value.length;
  campo.setSelectionRange(fim, fim);
}
