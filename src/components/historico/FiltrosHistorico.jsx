import React from "react";
import { Eraser, Filter } from "lucide-react";
import {
  MODULOS_COM_SECRETARIA,
  OPCOES_MODULO,
  OPCOES_TIPO,
  moduloLabel,
  moduloTemSecretaria,
} from "../../lib/historicoMovimentacoes";

const CLASSE_CAMPO =
  "w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] disabled:bg-black/[0.03] disabled:text-[#0F2A44]/40";

function Campo({ label, ajuda = null, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#0F2A44]/70">{label}</label>
      {children}
      {ajuda && <span className="block text-[10px] text-[#0F2A44]/45 mt-1">{ajuda}</span>}
    </div>
  );
}

/**
 * Área de filtros da linha do tempo do Histórico: período, usuário, secretaria,
 * módulo e tipo de movimentação. Os campos só valem depois de "Aplicar Filtros"
 * — a mesma convenção das telas de Fornecedores e Auditoria — e se somam entre
 * si (E), nunca um ou outro.
 *
 * O componente cuida apenas do formulário; quem consulta o banco é a página.
 */
export default function FiltrosHistorico({
  filtros,
  onAlterar,
  onAplicar,
  onLimpar,
  usuarios = [],
  secretarias = [],
  erroUsuarios = null,
  erroSecretarias = null,
  resumo = null,
}) {
  // Usuários e secretárias só aparecem no cadastro de alguns módulos; quando o
  // filtro de módulo aponta para um sem secretaria, o campo sai de cena para não
  // devolver uma lista vazia sem explicação.
  const secretariaVale = moduloTemSecretaria(filtros.modulo);

  function alterar(campo, valor) {
    onAlterar({ ...filtros, [campo]: valor });
  }

  function alterarModulo(valor) {
    // Trocar para um módulo sem secretaria zera o campo, senão o filtro seguiria
    // valendo escondido e a lista voltaria vazia sem motivo aparente.
    const proximo = { ...filtros, modulo: valor };
    if (!moduloTemSecretaria(valor)) proximo.secretaria = "";
    onAlterar(proximo);
  }

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-[#0F2A44]">Filtrar movimentações</h3>
        {resumo && <span className="text-xs text-[#0F2A44]/50">{resumo}</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Campo label="Data inicial">
          <input
            type="date"
            value={filtros.dataInicial}
            max={filtros.dataFinal || undefined}
            onChange={(e) => alterar("dataInicial", e.target.value)}
            className={CLASSE_CAMPO}
          />
        </Campo>

        <Campo label="Data final">
          <input
            type="date"
            value={filtros.dataFinal}
            min={filtros.dataInicial || undefined}
            onChange={(e) => alterar("dataFinal", e.target.value)}
            className={CLASSE_CAMPO}
          />
        </Campo>

        <Campo
          label="Usuário"
          ajuda={
            erroUsuarios
              ? "A lista de usuários não pôde ser carregada; os demais filtros continuam valendo."
              : null
          }
        >
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
        </Campo>

        <Campo
          label="Secretaria"
          ajuda={
            !secretariaVale
              ? `Registros de ${moduloLabel(filtros.modulo)} não têm secretaria.`
              : erroSecretarias
                ? "A lista de secretarias não pôde ser carregada; os demais filtros continuam valendo."
                : `Vale para ${MODULOS_COM_SECRETARIA.map(moduloLabel).join(", ")}.`
          }
        >
          <select
            value={filtros.secretaria}
            disabled={!secretariaVale}
            onChange={(e) => alterar("secretaria", e.target.value)}
            className={CLASSE_CAMPO}
          >
            <option value="">Todas as secretarias</option>
            {secretarias.map((s) => (
              <option key={s.id} value={s.nome}>
                {s.nome}
              </option>
            ))}
          </select>
        </Campo>

        <Campo label="Módulo">
          <select
            value={filtros.modulo}
            onChange={(e) => alterarModulo(e.target.value)}
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

        <Campo label="Tipo de movimentação">
          <select value={filtros.tipo} onChange={(e) => alterar("tipo", e.target.value)} className={CLASSE_CAMPO}>
            <option value="">Todos os tipos</option>
            {OPCOES_TIPO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.label}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
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
      </div>

      <p className="text-[10px] text-[#0F2A44]/40 mt-2">
        Os filtros se somam: a linha do tempo mostra o que atende a todas as condições escolhidas ao mesmo tempo.
      </p>
    </div>
  );
}
