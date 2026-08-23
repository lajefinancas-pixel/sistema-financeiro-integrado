import React from "react";
import { Eraser, Filter, SlidersHorizontal } from "lucide-react";
import { ATALHOS, OPCOES_SITUACAO_FILTRO, haFiltroAtivo } from "../../lib/filtrosCertidoes";

/**
 * Área de filtros da listagem de certidões.
 *
 * O formulário é do componente; a tela decide o que fazer com ele. Os campos só
 * valem depois de "Aplicar Filtros" — os atalhos rápidos são a exceção, porque
 * um atalho que precisa de um segundo clique para valer não é atalho.
 *
 * Todos os filtros somam entre si (E): fornecedor + tipo + período de
 * vencimento devolvem as certidões que atendem às três condições.
 */

const CLASSE_CAMPO =
  "w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] " +
  "outline-none focus:border-[#0F2A44] bg-white";

function Campo({ rotulo, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[#0F2A44]/70">{rotulo}</span>
      {children}
    </label>
  );
}

export default function FiltrosCertidoes({
  filtros,
  onMudar,
  onAplicar,
  onLimpar,
  onAtalho,
  secretarias,
  tipos,
  totalEncontrado,
  totalGeral,
}) {
  // Em telas estreitas a área abre pelo botão, para não empurrar a lista.
  const [aberto, setAberto] = React.useState(false);
  const filtrando = haFiltroAtivo(filtros);

  function alterar(campo, valor) {
    onMudar({ ...filtros, [campo]: valor });
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm mb-4 print:hidden">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-black/5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#0F2A44]/50">
          <SlidersHorizontal size={13} /> Filtros
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#0F2A44]/45 tabular-nums">
            {filtrando ? `${totalEncontrado} de ${totalGeral}` : `${totalGeral}`}
          </span>
          <button
            type="button"
            onClick={() => setAberto((atual) => !atual)}
            aria-expanded={aberto}
            className="sm:hidden text-xs px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/60"
          >
            {aberto ? "Ocultar" : "Mostrar"}
          </button>
        </div>
      </div>

      <div className={`${aberto ? "block" : "hidden"} sm:block px-4 sm:px-5 py-4`}>
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            onAplicar();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Campo rotulo="Fornecedor">
              <input
                type="search"
                value={filtros.fornecedor}
                onChange={(e) => alterar("fornecedor", e.target.value)}
                placeholder="Razão social ou nome fantasia"
                className={CLASSE_CAMPO}
              />
            </Campo>

            <Campo rotulo="CNPJ / CPF">
              <input
                type="search"
                value={filtros.cnpj}
                onChange={(e) => alterar("cnpj", e.target.value)}
                placeholder="Somente os números"
                inputMode="numeric"
                className={CLASSE_CAMPO}
              />
            </Campo>

            <Campo rotulo="Secretaria">
              <select
                value={filtros.secretariaId}
                onChange={(e) => alterar("secretariaId", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todas as secretarias</option>
                {secretarias.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Tipo de certidão">
              <select
                value={filtros.tipoId}
                onChange={(e) => alterar("tipoId", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todos os tipos</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo rotulo="Situação">
              <select
                value={filtros.situacao}
                onChange={(e) => alterar("situacao", e.target.value)}
                className={CLASSE_CAMPO}
              >
                <option value="">Todas as situações</option>
                {OPCOES_SITUACAO_FILTRO.map((opcao) => (
                  <option key={opcao.id} value={opcao.id}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <Campo rotulo="Emissão — inicial">
              <input
                type="date"
                value={filtros.emissaoInicial}
                onChange={(e) => alterar("emissaoInicial", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>
            <Campo rotulo="Emissão — final">
              <input
                type="date"
                value={filtros.emissaoFinal}
                onChange={(e) => alterar("emissaoFinal", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>
            <Campo rotulo="Vencimento — inicial">
              <input
                type="date"
                value={filtros.vencimentoInicial}
                onChange={(e) => alterar("vencimentoInicial", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>
            <Campo rotulo="Vencimento — final">
              <input
                type="date"
                value={filtros.vencimentoFinal}
                onChange={(e) => alterar("vencimentoFinal", e.target.value)}
                className={CLASSE_CAMPO}
              />
            </Campo>
          </div>

          {/* Atalhos: valem no clique e continuam somando com os campos acima. */}
          <div className="mt-4">
            <span className="text-xs font-medium text-[#0F2A44]/70">Atalhos rápidos</span>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {ATALHOS.map((atalho) => {
                const ativo = filtros.atalho === atalho.id;
                return (
                  <button
                    key={atalho.id}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => onAtalho(ativo ? "" : atalho.id)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      ativo
                        ? "border-[#0F2A44] bg-[#0F2A44] text-white"
                        : "border-black/10 text-[#0F2A44]/65 hover:bg-black/[0.03]"
                    }`}
                  >
                    {atalho.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-4 pt-4 border-t border-black/5">
            <button
              type="submit"
              className="flex items-center justify-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
            >
              <Filter size={15} />
              Aplicar Filtros
            </button>
            <button
              type="button"
              onClick={onLimpar}
              disabled={!filtrando}
              className="flex items-center justify-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
            >
              <Eraser size={15} />
              Limpar Filtros
            </button>
            <span className="text-[11px] text-[#0F2A44]/40 sm:ml-1">
              Os filtros preenchidos somam entre si.
            </span>
          </div>
        </form>
      </div>
    </section>
  );
}
