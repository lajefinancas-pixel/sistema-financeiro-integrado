import React from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Seção compacta "Precisa da minha atenção" do Painel Principal.
 *
 * Junta numa lista curta o que está pesando agora: certidões vencidas ou perto
 * do vencimento (a mesma contagem do card de Certidões), tarefas atrasadas e
 * tarefas vencendo hoje. Cada linha é um atalho para o módulo de origem — o
 * detalhe continua lá.
 *
 * A seção some inteira para quem não enxerga nem tarefas nem certidões.
 */
export default function CardPrecisaAtencao({ itens, visivel }) {
  const navigate = useNavigate();
  if (!visivel) return null;

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <h2 className="text-base font-semibold mb-3">Precisa da Minha Atenção</h2>

      {itens.length === 0 ? (
        <div className="text-sm text-[#16A34A] flex items-center gap-1.5">
          ✓ Está tudo em dia por aqui.
        </div>
      ) : (
        <div className="space-y-2">
          {itens.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.rota)}
              className="w-full flex items-center justify-between text-left px-3 py-2.5 rounded-lg hover:bg-black/[0.02] border border-black/5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.cor }} />
                <span className="text-sm text-[#0F2A44] truncate">{item.texto}</span>
              </div>
              <ChevronRight size={14} className="text-[#0F2A44]/30 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
