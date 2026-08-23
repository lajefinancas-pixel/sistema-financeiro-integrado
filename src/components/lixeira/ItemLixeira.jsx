import React from "react";
import { AlertTriangle, Building2, CreditCard, FileCheck2, RotateCcw, UserRound } from "lucide-react";
import { formatarDataHora, tipoInfo } from "../../lib/lixeira";

const ICONES = {
  fornecedores: Building2,
  certidoes: FileCheck2,
  pagamentos: CreditCard,
};

const CORES = {
  fornecedores: { cor: "#0F2A44", bg: "#EEF2F7" },
  certidoes: { cor: "#15803D", bg: "#EAFBF0" },
  pagamentos: { cor: "#A16207", bg: "#FEF7DF" },
};

/** Etiqueta do tipo do registro (Fornecedor, Certidão, Pagamento). */
function EtiquetaTipo({ tipo }) {
  const info = tipoInfo(tipo);
  const cores = CORES[tipo] ?? { cor: "#475569", bg: "#F1F5F9" };
  const Icone = ICONES[tipo] ?? Building2;
  return (
    <span
      style={{ color: cores.cor, backgroundColor: cores.bg }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
    >
      <Icone size={12} />
      {info.label}
    </span>
  );
}

/**
 * Uma linha da Lixeira: o que era o registro, quem o excluiu, quando e por quê,
 * com as duas saídas possíveis.
 *
 * "Restaurar" e "Excluir definitivamente" ficam propositalmente separados: o
 * segundo é vermelho, tem ícone de alerta e só aparece para quem tem a permissão
 * específica — nada nele se parece com o botão que desfaz.
 */
export default function ItemLixeira({ item, podeRestaurar, podeExcluirDefinitivo, restaurando, onRestaurar, onExcluir }) {
  return (
    <li className="bg-white rounded-2xl border border-black/5 shadow-sm px-4 sm:px-5 py-4">
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <EtiquetaTipo tipo={item.tipo} />
            <h3 className="text-sm font-semibold text-[#0F2A44] break-words">{item.titulo}</h3>
          </div>

          <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
            {item.detalhes
              .filter((detalhe) => detalhe.valor && detalhe.valor !== "--")
              .map((detalhe) => (
                <li key={detalhe.rotulo} className="text-[11px] text-[#0F2A44]/55">
                  <span className="text-[#0F2A44]/35">{detalhe.rotulo}: </span>
                  {detalhe.valor}
                </li>
              ))}
          </ul>

          <div className="mt-3 pt-3 border-t border-black/5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-[#0F2A44]/55">
            <span className="inline-flex items-center gap-1.5">
              <UserRound size={12} className="text-[#0F2A44]/30" />
              Excluído por {item.excluidoPorNome || "usuário não identificado"}
            </span>
            <span>em {formatarDataHora(item.excluidoEm)}</span>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-[#0F2A44]/55">
            <span className="text-[#0F2A44]/35">Motivo informado: </span>
            {item.motivo ? (
              <span className="text-[#0F2A44]/75">{item.motivo}</span>
            ) : (
              <span className="italic">não localizado na trilha de auditoria.</span>
            )}
          </p>
        </div>

        <div className="flex flex-row lg:flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onRestaurar(item)}
            disabled={!podeRestaurar || restaurando}
            title={podeRestaurar ? undefined : "Você não tem permissão para restaurar registros."}
            className="flex items-center justify-center gap-1.5 text-xs px-3.5 py-2 rounded-lg border border-[#0F2A44]/20 text-[#0F2A44] hover:bg-[#0F2A44]/5 disabled:opacity-40 whitespace-nowrap"
          >
            <RotateCcw size={13} />
            {restaurando ? "Restaurando..." : "Restaurar"}
          </button>

          {podeExcluirDefinitivo && (
            <button
              type="button"
              onClick={() => onExcluir(item)}
              disabled={restaurando}
              className="flex items-center justify-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-[#DC2626] text-white hover:bg-[#DC2626]/90 disabled:opacity-40 whitespace-nowrap"
            >
              <AlertTriangle size={13} />
              Excluir definitivamente
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
