import React from "react";
import { Eraser, Filter } from "lucide-react";
import {
  MODULOS_COM_SECRETARIA,
  OPCOES_MODULO,
  OPCOES_TIPO,
  moduloLabel,
  moduloTemSecretaria,
  quantidadeDeFiltros,
} from "../../lib/historicoMovimentacoes";
import PainelFiltros from "../comuns/PainelFiltros";

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

/** Data ISO no formato de leitura da tela; vazio vira reticências no chip. */
function dataBR(valor) {
  if (!valor) return "...";
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Chips do recorte que está de fato valendo na linha do tempo (os filtros
 * APLICADOS, não o que ainda está sendo escolhido no formulário). Só monta
 * rótulos: nenhum critério é criado, removido ou reinterpretado aqui.
 */
function montarChips({ aplicados, usuarios, onRemover }) {
  const f = aplicados ?? {};
  const chips = [];
  const remover = (alteracao) => (onRemover ? () => onRemover(alteracao) : undefined);

  if (f.dataInicial || f.dataFinal) {
    chips.push({
      chave: "periodo",
      rotulo: `Período: ${dataBR(f.dataInicial)} a ${dataBR(f.dataFinal)}`,
      remover: remover({ dataInicial: "", dataFinal: "" }),
    });
  }
  if (f.usuarioId) {
    const nome = usuarios.find((u) => String(u.id) === String(f.usuarioId))?.nome_completo ?? "Usuário";
    chips.push({ chave: "usuario", rotulo: nome, remover: remover({ usuarioId: "" }) });
  }
  // A secretaria é filtrada pelo nome: o próprio valor já é o rótulo.
  if (f.secretaria) {
    chips.push({ chave: "secretaria", rotulo: f.secretaria, remover: remover({ secretaria: "" }) });
  }
  if (f.modulo) {
    chips.push({ chave: "modulo", rotulo: moduloLabel(f.modulo), remover: remover({ modulo: "" }) });
  }
  if (f.tipo) {
    const label = OPCOES_TIPO.find((o) => o.valor === f.tipo)?.label ?? f.tipo;
    chips.push({ chave: "tipo", rotulo: label, remover: remover({ tipo: "" }) });
  }
  return chips;
}

/**
 * Área de filtros da linha do tempo do Histórico: período, usuário, secretaria,
 * módulo e tipo de movimentação. Os campos só valem depois de "Aplicar Filtros"
 * — a mesma convenção das telas de Fornecedores e Auditoria — e se somam entre
 * si (E), nunca um ou outro.
 *
 * A área fica dentro do PainelFiltros compartilhado: abre e fecha sem perder
 * nada do formulário, e com o painel fechado o recorte aplicado aparece em
 * chips removíveis.
 *
 * O componente cuida apenas do formulário; quem consulta o banco é a página.
 */
export default function FiltrosHistorico({
  filtros,
  aplicados,
  onAlterar,
  onAplicar,
  onLimpar,
  onRemover,
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
  const emUso = aplicados ?? filtros;
  const chips = React.useMemo(
    () => montarChips({ aplicados: emUso, usuarios, onRemover }),
    [emUso, usuarios, onRemover],
  );

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
    <PainelFiltros
      className="mb-5"
      rotulo="Filtrar movimentações"
      chips={chips}
      // O contador segue a mesma contagem já usada na página: cada campo
      // preenchido conta um, inclusive as duas pontas do período.
      totalAtivos={quantidadeDeFiltros(emUso)}
      onLimpar={onLimpar}
      resumo={resumo}
    >
      <div className="pt-3">
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
    </PainelFiltros>
  );
}
