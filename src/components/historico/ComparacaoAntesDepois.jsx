import React from "react";
import { ArrowRight } from "lucide-react";

/**
 * Comparação "Antes e Depois" de uma movimentação, campo por campo.
 *
 * A lista já chega pronta da camada de dados (`movimentacao.mudancas`) e traz
 * SOMENTE os campos que realmente mudaram: campo com o mesmo conteúdo nos dois
 * lados não aparece aqui. Cadastros mostram apenas o lado "Depois" e exclusões
 * apenas o lado "Antes".
 */

/** Um lado da comparação: cinza para o valor antigo, azul para o que ficou valendo. */
function Valor({ texto, destaque }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-xs break-words ${
        destaque
          ? "bg-[#EAF1FF] text-[#1D4ED8]"
          : "bg-black/[0.04] text-[#0F2A44]/60 line-through decoration-black/20"
      }`}
    >
      {texto}
    </span>
  );
}

export default function ComparacaoAntesDepois({ mudancas }) {
  if (!mudancas || mudancas.length === 0) return null;

  return (
    <div className="mt-2.5 rounded-xl border border-black/5 overflow-hidden bg-[#FBFAF8]">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[#0F2A44]/40 bg-[#F5F3EF]">
            <th className="py-2 px-3 font-medium">Campo</th>
            <th className="py-2 px-3 font-medium">Antes</th>
            <th className="py-2 px-3 font-medium">Depois</th>
          </tr>
        </thead>
        <tbody>
          {mudancas.map((m) => (
            <tr key={m.campo} className="border-t border-black/5 align-top">
              <td className="py-2 px-3 font-medium text-[#0F2A44] whitespace-nowrap">{m.label}</td>
              <td className="py-2 px-3">
                {m.tinhaAntes ? (
                  <Valor texto={m.antes} />
                ) : (
                  <span className="text-[11px] text-[#0F2A44]/35">não existia</span>
                )}
              </td>
              <td className="py-2 px-3">
                <div className="flex items-start gap-1.5">
                  <ArrowRight size={12} className="text-[#0F2A44]/25 mt-1 shrink-0" />
                  {m.temDepois ? (
                    <Valor texto={m.depois} destaque />
                  ) : (
                    <span className="text-[11px] text-[#0F2A44]/35 mt-0.5">removido</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-[#0F2A44]/40 px-3 py-2 border-t border-black/5">
        A comparação mostra apenas os campos que mudaram nesta movimentação.
      </p>
    </div>
  );
}
