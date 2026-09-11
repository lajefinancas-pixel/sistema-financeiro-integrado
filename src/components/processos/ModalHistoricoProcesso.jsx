import React from "react";
import { X } from "lucide-react";
import { textoHistorico, tituloDoProcesso } from "../../lib/processosDiarias.js";

/**
 * O histórico do processo: quem fez o quê, quando.
 *
 * É a trilha PRÓPRIA do processo, a mesma que a Auditoria recebe -- as duas são
 * escritas juntas, e nenhuma delas é editável. Linha de histórico não altera o
 * documento e não paga nada.
 */
export default function ModalHistoricoProcesso({
  processo,
  registros = [],
  carregando = false,
  erro = null,
  onFechar,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-8 sm:px-4">
      <div className="w-full max-w-xl rounded-2xl border border-black/5 bg-white shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">Histórico</div>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-[#0F2A44]">
              {tituloDoProcesso(processo)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-[#0F2A44]/40 hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          {erro && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>
          )}

          {carregando ? (
            <p className="py-6 text-center text-sm text-[#0F2A44]/50">Carregando o histórico...</p>
          ) : registros.length === 0 ? (
            <p className="py-6 text-center text-sm text-[#0F2A44]/50">
              Nenhum registro ainda para este processo.
            </p>
          ) : (
            <ol className="space-y-3 border-l border-black/10 pl-4">
              {registros.map((registro) => (
                <li key={registro.id} className="relative">
                  <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-[#C9A227]" />
                  <p className="text-sm text-[#0F2A44]">{textoHistorico(registro)}</p>
                  <p className="mt-0.5 text-[11px] text-[#0F2A44]/45">
                    {quando(registro.criado_em)}
                    {registro.usuario?.nome_completo ? ` · ${registro.usuario.nome_completo}` : ""}
                  </p>
                  {(registro.detalhes?.anterior || registro.detalhes?.novo) && (
                    <p className="mt-1 text-[11px] text-[#0F2A44]/45">
                      {resumoDeCampos(registro.detalhes)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="border-t border-black/5 px-5 py-4 text-[11px] text-[#0F2A44]/45">
          O histórico é somente leitura e acompanha o processo mesmo depois do cancelamento.
        </div>
      </div>
    </div>
  );
}

function quando(valor) {
  if (!valor) return "--";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Campos alterados: destino, valor total" — o detalhe fica na Auditoria. */
function resumoDeCampos(detalhes) {
  const campos = Object.keys(detalhes?.novo ?? detalhes?.anterior ?? {});
  if (campos.length === 0) return "";
  return `Campos alterados: ${campos.slice(0, 6).join(", ")}${campos.length > 6 ? "..." : ""}`;
}
