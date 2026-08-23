import React from "react";
import { ChevronDown, ChevronUp, Eraser, SlidersHorizontal } from "lucide-react";
import { OPCOES_TIPO, quantidadeDeFiltros } from "../../lib/lixeira";

const CLASSE_CAMPO = "w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44]";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#0F2A44]/70">{label}</label>
      {children}
    </div>
  );
}

/**
 * Filtros da Lixeira: tipo de registro, quem excluiu e período da exclusão.
 *
 * Diferente da Auditoria, aqui o filtro vale na hora: a lista inteira já está
 * carregada na tela e o recorte é feito em memória, sem nova consulta.
 */
export default function FiltrosLixeira({ filtros, onAlterar, onLimpar, usuarios = [], total, exibidos }) {
  const [aberto, setAberto] = React.useState(false);
  const emUso = quantidadeDeFiltros(filtros);

  function alterar(campo, valor) {
    onAlterar({ ...filtros, [campo]: valor });
  }

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
        <p className="text-sm text-[#0F2A44]/60">
          {emUso > 0 ? (
            <>
              Mostrando <strong className="text-[#0F2A44]">{exibidos}</strong> de {total}{" "}
              {total === 1 ? "registro excluído" : "registros excluídos"}.
            </>
          ) : (
            <>
              <strong className="text-[#0F2A44]">{total}</strong>{" "}
              {total === 1 ? "registro excluído" : "registros excluídos"} na Lixeira.
            </>
          )}
        </p>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className={`flex items-center justify-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border ${
            aberto || emUso > 0
              ? "bg-[#0F2A44] text-white border-[#0F2A44]"
              : "border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
          }`}
        >
          <SlidersHorizontal size={15} />
          Filtros
          {emUso > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">{emUso}</span>
          )}
          {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {aberto && (
        <div className="mt-4 pt-4 border-t border-black/5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Campo label="Tipo de registro">
              <select
                value={filtros.tipo}
                onChange={(e) => alterar("tipo", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todos os tipos</option>
                {OPCOES_TIPO.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Excluído por">
              <select
                value={filtros.usuarioId}
                onChange={(e) => alterar("usuarioId", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Qualquer usuário</option>
                {usuarios.map((usuario) => (
                  <option key={usuario.id} value={usuario.id}>
                    {usuario.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Excluído a partir de">
              <input
                type="date"
                value={filtros.dataInicial}
                onChange={(e) => alterar("dataInicial", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>

            <Campo label="Excluído até">
              <input
                type="date"
                value={filtros.dataFinal}
                onChange={(e) => alterar("dataFinal", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>
          </div>

          {emUso > 0 && (
            <button
              type="button"
              onClick={onLimpar}
              className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
            >
              <Eraser size={13} />
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
