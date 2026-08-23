import React from "react";
import { Pencil, Plus, Settings2 } from "lucide-react";
import { Etiqueta } from "./badges";

/**
 * Seção "Tipos de Certidão": o catálogo que alimenta o cadastro. Os seis tipos
 * padrão chegam pela migration; a equipe cadastra os demais por aqui.
 */
export default function TiposCertidao({ tipos, carregando, podeCadastrar, podeEditar, onNovo, onEditar }) {
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <p className="text-sm text-[#0F2A44]/60">
          {carregando
            ? "Carregando tipos de documento..."
            : `${tipos.length} ${tipos.length === 1 ? "tipo cadastrado" : "tipos cadastrados"}. Tipos inativos não aparecem no cadastro de certidões.`}
        </p>
        {podeCadastrar && (
          <button
            type="button"
            onClick={onNovo}
            className="self-start flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-[#0F2A44]/15 text-[#0F2A44] hover:bg-white whitespace-nowrap"
          >
            <Plus size={16} />
            Novo tipo de documento
          </button>
        )}
      </div>

      {!carregando && tipos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-6 py-12 text-center">
          <Settings2 size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
          <div className="text-sm text-[#0F2A44]/40">
            Nenhum tipo de documento cadastrado ainda.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tipos.map((tipo) => (
            <div
              key={tipo.id}
              className={`bg-white rounded-2xl border shadow-sm p-4 flex flex-col ${
                tipo.ativo === false ? "border-black/5 opacity-70" : "border-black/5"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#0F2A44] leading-snug">{tipo.nome}</h3>
                {podeEditar && (
                  <button
                    type="button"
                    onClick={() => onEditar(tipo)}
                    title="Editar tipo"
                    aria-label={`Editar ${tipo.nome}`}
                    className="w-8 h-8 -mr-1 -mt-0.5 rounded-lg flex items-center justify-center text-[#0F2A44]/40 hover:text-[#0F2A44] hover:bg-black/5 shrink-0"
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>

              {tipo.descricao && (
                <p className="text-xs text-[#0F2A44]/55 mt-1.5 leading-relaxed">{tipo.descricao}</p>
              )}

              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-black/5">
                {tipo.possui_vencimento === false ? (
                  <Etiqueta>Sem vencimento</Etiqueta>
                ) : (
                  <Etiqueta>
                    {tipo.prazo_padrao_dias ? `Validade de ${tipo.prazo_padrao_dias} dias` : "Vencimento por documento"}
                  </Etiqueta>
                )}
                {tipo.obrigatorio && <Etiqueta tom="dourado">Obrigatório</Etiqueta>}
                {tipo.ativo === false && <Etiqueta tom="inativo">Inativo</Etiqueta>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
