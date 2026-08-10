import React from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import {
  listarNotificacoes,
  marcarComoLida,
  marcarTodasComoLidas,
  tipoInfo,
} from "../../lib/notificacoes";

/** "agora", "há 12 min", "há 3 h", "há 2 dias" — texto curto do momento do aviso. */
function tempoRelativo(valor) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const minutos = Math.floor((Date.now() - data.getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}

/**
 * Sino de notificações do topo da página (tabela "notificacoes").
 *
 * Mostra as não lidas por padrão — que é o que interessa no dia a dia — e
 * permite abrir a lista completa das últimas recebidas. Clicar em uma linha
 * marca como lida e abre a tarefa correspondente.
 */
export default function SinoNotificacoes({ usuarioId, recarga = 0, onAbrirTarefa }) {
  const [aberto, setAberto] = React.useState(false);
  const [notificacoes, setNotificacoes] = React.useState([]);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [verTodas, setVerTodas] = React.useState(false);
  const caixaRef = React.useRef(null);

  const carregar = React.useCallback(async () => {
    if (!usuarioId) return;
    setCarregando(true);
    setErro(null);
    try {
      setNotificacoes(await listarNotificacoes(usuarioId));
    } catch (e) {
      setErro(e.message ?? "Não foi possível carregar as notificações.");
    } finally {
      setCarregando(false);
    }
  }, [usuarioId]);

  React.useEffect(() => {
    carregar();
  }, [carregar, recarga]);

  // Fecha o painel ao clicar fora ou apertar Esc.
  React.useEffect(() => {
    if (!aberto) return undefined;
    function aoClicar(evento) {
      if (caixaRef.current && !caixaRef.current.contains(evento.target)) setAberto(false);
    }
    function aoTeclar(evento) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const naoLidas = notificacoes.filter((n) => !n.lida);
  const visiveis = verTodas ? notificacoes : naoLidas;

  async function lerUma(notificacao) {
    if (notificacao.lida) return;
    setNotificacoes((atual) => atual.map((n) => (n.id === notificacao.id ? { ...n, lida: true } : n)));
    try {
      await marcarComoLida(notificacao.id);
    } catch (e) {
      setErro(e.message ?? "Não foi possível marcar a notificação como lida.");
      carregar();
    }
  }

  async function lerTodas() {
    setNotificacoes((atual) => atual.map((n) => ({ ...n, lida: true })));
    try {
      await marcarTodasComoLidas(usuarioId);
    } catch (e) {
      setErro(e.message ?? "Não foi possível marcar as notificações como lidas.");
      carregar();
    }
  }

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label={`Notificações${naoLidas.length ? ` — ${naoLidas.length} não lidas` : ""}`}
        aria-expanded={aberto}
        className="relative w-[42px] h-[42px] rounded-lg border border-black/10 bg-white flex items-center justify-center text-[#0F2A44]/60 hover:text-[#0F2A44] hover:border-[#C9A227]/60"
      >
        <Bell size={17} />
        {naoLidas.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-semibold flex items-center justify-center">
            {naoLidas.length > 9 ? "9+" : naoLidas.length}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 mt-2 w-[330px] sm:w-[380px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl border border-black/10 shadow-xl z-40 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-black/5">
            <div>
              <div className="text-sm font-semibold text-[#0F2A44]">Notificações</div>
              <div className="text-[11px] text-[#0F2A44]/45">
                {naoLidas.length === 0
                  ? "Nenhuma não lida"
                  : `${naoLidas.length} não ${naoLidas.length === 1 ? "lida" : "lidas"}`}
              </div>
            </div>
            {naoLidas.length > 0 && (
              <button
                type="button"
                onClick={lerTodas}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/65 hover:bg-black/5"
              >
                <CheckCheck size={13} />
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[340px] overflow-y-auto">
            {erro && <div className="px-4 py-3 text-xs text-red-700 bg-red-50">{erro}</div>}

            {carregando ? (
              <div className="px-4 py-6 text-xs text-[#0F2A44]/45">Carregando...</div>
            ) : visiveis.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={20} className="text-[#0F2A44]/15 mx-auto mb-2" />
                <p className="text-xs text-[#0F2A44]/40">
                  {verTodas ? "Nenhuma notificação recebida." : "Tudo em dia por aqui."}
                </p>
              </div>
            ) : (
              <ul>
                {visiveis.map((n) => {
                  const info = tipoInfo(n.tipo);
                  return (
                    <li key={n.id} className="border-b border-black/5 last:border-b-0">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          lerUma(n);
                          if (n.tarefa_id && onAbrirTarefa) {
                            onAbrirTarefa(n.tarefa_id);
                            setAberto(false);
                          }
                        }}
                        onKeyDown={(evento) => {
                          if (evento.key === "Enter") lerUma(n);
                        }}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-black/[0.02] ${
                          n.lida ? "opacity-60" : ""
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: n.lida ? "#CBD5E1" : info.cor }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: info.cor }}>
                            {info.label}
                          </div>
                          <p className="text-sm text-[#0F2A44]/85 leading-snug mt-0.5 break-words">{n.mensagem}</p>
                          <div className="text-[11px] text-[#0F2A44]/40 mt-1">{tempoRelativo(n.criado_em)}</div>
                        </div>
                        {!n.lida && (
                          <button
                            type="button"
                            title="Marcar como lida"
                            onClick={(evento) => {
                              evento.stopPropagation();
                              lerUma(n);
                            }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#0F2A44]/35 hover:text-[#15803D] hover:bg-black/5 shrink-0"
                          >
                            <Check size={14} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => setVerTodas((v) => !v)}
            className="w-full px-4 py-2.5 text-[11px] text-[#0F2A44]/55 hover:bg-black/[0.03] border-t border-black/5"
          >
            {verTodas ? "Mostrar apenas as não lidas" : "Ver todas as notificações recentes"}
          </button>
        </div>
      )}
    </div>
  );
}
