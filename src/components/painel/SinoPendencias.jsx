import React from "react";
import { Bell, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TEXTO_SEM_PENDENCIA, unirPendencias } from "../../lib/pendenciasPainel";

/**
 * O sino do topo do Painel Principal.
 *
 * Ele mostra exatamente as pendências que o painel já mostra — a lista vem
 * pronta de lib/pendenciasPainel.js, que só junta as linhas de "Precisa da
 * Minha Atenção" e de "Pendências e Alertas". O contador é o tamanho dessa
 * lista, então o número do sino e a lista aberta nunca discordam.
 *
 * Não é um sistema de notificações: não há registro persistido, marcação de
 * lida, histórico nem e-mail. É uma janela para o que o painel já calculou, com
 * um atalho para a tela de cada pendência.
 *
 * Fecha ao clicar/tocar fora e com Esc. O toque no iPad usa os mesmos botões do
 * resto do sistema (`pointerdown` para o clique fora, com `touchstart` de
 * reserva em navegador sem eventos de ponteiro).
 */
export default function SinoPendencias({ atencao, alertas, carregando = false }) {
  const navigate = useNavigate();
  const [aberto, setAberto] = React.useState(false);
  const caixaRef = React.useRef(null);

  const pendencias = React.useMemo(() => unirPendencias({ atencao, alertas }), [atencao, alertas]);

  React.useEffect(() => {
    if (!aberto) return undefined;

    function aoApontar(evento) {
      if (caixaRef.current && !caixaRef.current.contains(evento.target)) setAberto(false);
    }
    function aoTeclar(evento) {
      if (evento.key === "Escape") setAberto(false);
    }

    // Um evento só por ambiente: no iPad o `pointerdown` já cobre o toque, e o
    // `touchstart` fica para quem não tem eventos de ponteiro.
    const eventos =
      typeof window !== "undefined" && window.PointerEvent
        ? ["pointerdown"]
        : ["mousedown", "touchstart"];
    eventos.forEach((nome) => document.addEventListener(nome, aoApontar));
    document.addEventListener("keydown", aoTeclar);

    return () => {
      eventos.forEach((nome) => document.removeEventListener(nome, aoApontar));
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  function abrirPendencia(item) {
    setAberto(false);
    if (item.rota) navigate(item.rota);
  }

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-label={
          pendencias.length > 0
            ? `Pendências — ${pendencias.length}`
            : "Pendências — nenhuma no momento"
        }
        className="relative w-9 h-9 rounded-lg bg-white border border-black/5 flex items-center justify-center shadow-sm touch-manipulation"
      >
        <Bell size={16} className="text-[#0F2A44]/70" />
        {pendencias.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
            {pendencias.length}
          </span>
        )}
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Pendências do painel"
          className="absolute right-0 mt-2 w-[320px] sm:w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl border border-black/10 shadow-xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-black/5">
            <div className="text-sm font-semibold text-[#0F2A44]">Pendências</div>
            <div className="text-[11px] text-[#0F2A44]/45 mt-0.5">
              {carregando
                ? "Carregando..."
                : pendencias.length === 0
                  ? "Nada aguardando você agora"
                  : `${pendencias.length} ${pendencias.length === 1 ? "item" : "itens"} do painel`}
            </div>
          </div>

          <div className="max-h-[340px] overflow-y-auto">
            {pendencias.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={20} className="text-[#0F2A44]/15 mx-auto mb-2" />
                <p className="text-xs text-[#0F2A44]/45">
                  {carregando ? "Carregando pendências..." : TEXTO_SEM_PENDENCIA}
                </p>
              </div>
            ) : (
              <ul>
                {pendencias.map((item) => (
                  <li key={item.id} className="border-b border-black/5 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => abrirPendencia(item)}
                      className="w-full min-h-[44px] px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-black/[0.02] active:bg-black/[0.04] touch-manipulation"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: item.cor }}
                        />
                        <span className="text-sm text-[#0F2A44]">{item.texto}</span>
                      </span>
                      <ChevronRight size={14} className="text-[#0F2A44]/30 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
