import React from "react";
import { ChevronDown, ChevronUp, Eraser, Filter, SlidersHorizontal, X } from "lucide-react";
import {
  OPCOES_ACAO,
  OPCOES_MODULO,
  OPCOES_NIVEL,
  OPCOES_RESULTADO,
  quantidadeDeFiltros,
} from "../../lib/auditoria";

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
 * Área de consulta da trilha de auditoria: a busca livre (que vale na hora) e os
 * filtros do período/usuário/módulo/ação/nível/resultado, aplicados juntos ao
 * clicar em "Aplicar Filtros" — a mesma convenção da tela de Fornecedores.
 *
 * O componente só cuida do formulário; quem consulta o banco é a página.
 */
export default function FiltrosAuditoria({
  filtros,
  onAlterar,
  onAplicar,
  onLimpar,
  usuarios = [],
  erroUsuarios = null,
  aplicados,
  resumo = null,
}) {
  const [aberto, setAberto] = React.useState(false);
  const emUso = quantidadeDeFiltros(aplicados);

  function alterar(campo, valor) {
    onAlterar({ ...filtros, [campo]: valor });
  }

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={filtros.busca}
            onChange={(e) => alterar("busca", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAplicar();
              }
            }}
            placeholder="🔎 Pesquisar na auditoria"
            aria-label="Pesquisar na auditoria"
            className="w-full px-3 py-2.5 pr-9 rounded-lg border border-black/10 text-sm text-[#0F2A44]"
          />
          {filtros.busca && (
            <button
              type="button"
              onClick={() => alterar("busca", "")}
              title="Limpar a pesquisa"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-[#0F2A44]/40 hover:text-[#0F2A44] hover:bg-black/5"
            >
              <X size={15} />
            </button>
          )}
        </div>
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
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                aberto || emUso > 0 ? "bg-white/20" : "bg-[#0F2A44] text-white"
              }`}
            >
              {emUso}
            </span>
          )}
          {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      <p className="text-[11px] text-[#0F2A44]/40 mt-1.5">
        A pesquisa procura ao mesmo tempo no nome de quem fez a ação e no registro afetado, por parte do
        texto.
      </p>

      {aberto && (
        <div className="mt-4 pt-4 border-t border-black/5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Campo label="Data inicial">
              <input
                type="date"
                value={filtros.dataInicial}
                onChange={(e) => alterar("dataInicial", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>
            <Campo label="Data final">
              <input
                type="date"
                value={filtros.dataFinal}
                onChange={(e) => alterar("dataFinal", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>
            <Campo label="Usuário">
              <select
                value={filtros.usuarioId}
                onChange={(e) => alterar("usuarioId", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todos os usuários</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome_completo}
                  </option>
                ))}
              </select>
              {erroUsuarios && (
                <span className="block text-[10px] text-[#0F2A44]/45 mt-1">
                  A lista de usuários não pôde ser carregada; os demais filtros continuam valendo.
                </span>
              )}
            </Campo>
            <Campo label="Módulo">
              <select
                value={filtros.modulo}
                onChange={(e) => alterar("modulo", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todos os módulos</option>
                {OPCOES_MODULO.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Tipo de ação">
              <select
                value={filtros.acao}
                onChange={(e) => alterar("acao", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todas as ações</option>
                {OPCOES_ACAO.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Nível">
              <select
                value={filtros.nivel}
                onChange={(e) => alterar("nivel", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todos os níveis</option>
                {OPCOES_NIVEL.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Resultado">
              <select
                value={filtros.resultado}
                onChange={(e) => alterar("resultado", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Sucesso e falha</option>
                {OPCOES_RESULTADO.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onAplicar}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
            >
              <Filter size={15} /> Aplicar Filtros
            </button>
            <button
              type="button"
              onClick={onLimpar}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
            >
              <Eraser size={15} /> Limpar Filtros
            </button>
            {resumo && <span className="text-xs text-[#0F2A44]/50 ml-1">{resumo}</span>}
          </div>
          <p className="text-[10px] text-[#0F2A44]/40">
            Os filtros se somam: o resultado atende a todas as condições escolhidas ao mesmo tempo.
          </p>
        </div>
      )}
    </div>
  );
}
