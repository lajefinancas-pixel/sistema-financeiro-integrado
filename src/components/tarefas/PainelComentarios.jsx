import React from "react";
import { MessageSquare, Send } from "lucide-react";
import { Alerta } from "../equipe/comuns";
import { criarComentario, formatarDataHora, listarComentarios } from "../../lib/tarefas";

/** Iniciais do nome, usadas no círculo que identifica quem comentou. */
function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

/** Comentários da tarefa (tabela "tarefas_comentarios"), do mais antigo ao mais novo. */
export default function PainelComentarios({ tarefaId, usuarioId }) {
  const [comentarios, setComentarios] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [texto, setTexto] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);

  React.useEffect(() => {
    let ativo = true;
    setCarregando(true);
    listarComentarios(tarefaId)
      .then((lista) => ativo && setComentarios(lista))
      .catch((e) => ativo && setErro(e.message ?? "Não foi possível carregar os comentários."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [tarefaId]);

  async function enviar(evento) {
    evento.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const comentario = await criarComentario(tarefaId, usuarioId, texto);
      setComentarios((atual) => [...atual, comentario]);
      setTexto("");
    } catch (e) {
      setErro(e.message ?? "Não foi possível enviar o comentário.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <div className="text-sm text-[#0F2A44]/45">Carregando comentários...</div>;

  return (
    <div className="space-y-4">
      {erro && <Alerta>{erro}</Alerta>}

      {comentarios.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/10 py-7 text-center">
          <MessageSquare size={22} className="text-[#0F2A44]/20 mx-auto mb-2" />
          <p className="text-xs text-[#0F2A44]/40">Nenhum comentário ainda.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {comentarios.map((c) => (
            <li key={c.id} className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-full bg-[#0F2A44]/[0.06] text-[11px] font-semibold text-[#0F2A44]/60 flex items-center justify-center shrink-0">
                {iniciais(c.usuario?.nome_completo)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-[#0F2A44]">
                    {c.usuario?.nome_completo ?? "Usuário removido"}
                  </span>
                  <span className="text-[11px] text-[#0F2A44]/40">{formatarDataHora(c.criado_em)}</span>
                </div>
                <p className="text-sm text-[#0F2A44]/80 leading-relaxed whitespace-pre-wrap break-words mt-0.5">
                  {c.texto}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {usuarioId ? (
        <form onSubmit={enviar} className="pt-1 border-t border-black/5">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="Escreva um comentário..."
            className="w-full mt-3 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44] placeholder:text-[#0F2A44]/30 resize-y"
          />
          <div className="flex justify-end mt-2">
            <button
              type="submit"
              disabled={!texto.trim() || enviando}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
            >
              <Send size={14} />
              {enviando ? "Enviando..." : "Comentar"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-[#0F2A44]/40 pt-3 border-t border-black/5">
          Não foi possível identificar seu usuário para registrar comentários.
        </p>
      )}
    </div>
  );
}
