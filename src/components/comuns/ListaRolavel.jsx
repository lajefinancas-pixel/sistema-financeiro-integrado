import React from "react";
import { ChevronDown } from "lucide-react";

/**
 * Uma LISTA QUE ROLA DE VERDADE -- e que diz quando ainda há item abaixo.
 *
 * O problema que ela resolve: a lista de bancos mostrava os primeiros itens,
 * cortava o próximo pela metade e não dava sinal nenhum de que havia mais --
 * quem usava não sabia que era possível rolar, e no toque do iPad a rolagem
 * escapava para a página atrás em vez de andar dentro da lista.
 *
 * Aqui a rolagem é DENTRO da caixa (classe `lista-rolavel`, no index.css: barra
 * sempre visível no computador, rolagem por toque no iPad e `overscroll` contido
 * para o dedo não arrastar o formulário de trás), e enquanto houver item abaixo
 * a lista mostra o aviso "mais abaixo — role a lista", que desaparece ao chegar
 * ao fim.
 *
 * Apresentação, nada mais: não filtra, não ordena e não altera dado nenhum.
 */
export default function ListaRolavel({
  children,
  altura = "max-h-72",
  className = "",
  classeExterna = "",
  rotulo,
  aoRolar,
}) {
  const caixa = React.useRef(null);
  const [rolavel, setRolavel] = React.useState(false);
  const [noFim, setNoFim] = React.useState(true);

  // Medir a cada render é de propósito: a lista muda de tamanho quando a busca
  // filtra, e o aviso precisa acompanhar. `setState` com o mesmo valor não
  // provoca novo render, então isto não vira laço.
  const medir = React.useCallback(() => {
    const elemento = caixa.current;
    if (!elemento) return;
    const sobra = elemento.scrollHeight - elemento.clientHeight;
    setRolavel(sobra > 4);
    setNoFim(elemento.scrollTop >= sobra - 4);
  }, []);

  React.useEffect(() => {
    medir();
  });

  return (
    <div className={`relative ${classeExterna}`}>
      <ul
        ref={caixa}
        aria-label={rotulo}
        onScroll={() => {
          medir();
          aoRolar?.();
        }}
        className={`lista-rolavel ${altura} ${className}`}
      >
        {children}
      </ul>

      {/* O SINAL DE QUE HÁ MAIS: some ao chegar ao fim da lista. Não captura
          clique nem toque -- a rolagem e a escolha passam por ele. */}
      {rolavel && !noFim && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center
            rounded-b-lg bg-gradient-to-t from-white via-white/85 to-transparent pb-1 pt-6"
        >
          <span className="flex items-center gap-1 text-[11px] font-medium text-[#0F2A44]/60">
            <ChevronDown size={12} /> mais abaixo — role a lista
          </span>
        </div>
      )}
    </div>
  );
}
