import React from "react";
import { Eraser } from "lucide-react";
import { OPCOES_TIPO, quantidadeDeFiltros } from "../../lib/lixeira";
import PainelFiltros from "../comuns/PainelFiltros";

const CLASSE_CAMPO = "w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44]";

function Campo({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#0F2A44]/70">{label}</label>
      {children}
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
 * Chips do recorte que está valendo na lista. Aqui o filtro vale na hora, então
 * o que está no formulário é o que está filtrando. Só monta rótulos: nenhum
 * critério é criado, removido ou reinterpretado aqui.
 */
function montarChips({ filtros, usuarios, onRemover }) {
  const f = filtros ?? {};
  const chips = [];

  if (f.tipo) {
    const label = OPCOES_TIPO.find((o) => o.valor === f.tipo)?.label ?? f.tipo;
    chips.push({ chave: "tipo", rotulo: label, remover: () => onRemover({ tipo: "" }) });
  }
  if (f.usuarioId) {
    const nome = usuarios.find((u) => String(u.id) === String(f.usuarioId))?.nome ?? "Usuário";
    chips.push({ chave: "usuario", rotulo: `Excluído por: ${nome}`, remover: () => onRemover({ usuarioId: "" }) });
  }
  if (f.dataInicial || f.dataFinal) {
    chips.push({
      chave: "periodo",
      rotulo: `Excluído entre ${dataBR(f.dataInicial)} e ${dataBR(f.dataFinal)}`,
      remover: () => onRemover({ dataInicial: "", dataFinal: "" }),
    });
  }
  return chips;
}

/**
 * Filtros da Lixeira: tipo de registro, quem excluiu e período da exclusão.
 *
 * Diferente da Auditoria, aqui o filtro vale na hora: a lista inteira já está
 * carregada na tela e o recorte é feito em memória, sem nova consulta.
 *
 * A área usa o PainelFiltros compartilhado das demais telas: recolhida por
 * padrão, com contagem e chips removíveis quando fechada.
 */
export default function FiltrosLixeira({ filtros, onAlterar, onLimpar, usuarios = [], total, exibidos }) {
  const emUso = quantidadeDeFiltros(filtros);

  function alterar(campo, valor) {
    onAlterar({ ...filtros, [campo]: valor });
  }

  const remover = React.useCallback(
    (alteracao) => onAlterar({ ...filtros, ...alteracao }),
    [filtros, onAlterar],
  );

  const chips = React.useMemo(
    () => montarChips({ filtros, usuarios, onRemover: remover }),
    [filtros, usuarios, remover],
  );

  return (
    <PainelFiltros
      className="mb-5"
      chips={chips}
      // O contador segue a contagem de sempre: cada campo preenchido conta um,
      // inclusive as duas pontas do período.
      totalAtivos={emUso}
      onLimpar={onLimpar}
      resumo={
        emUso > 0 ? (
          <>
            Mostrando <strong className="text-[#0F2A44]">{exibidos}</strong> de {total}{" "}
            {total === 1 ? "registro excluído" : "registros excluídos"}.
          </>
        ) : (
          <>
            <strong className="text-[#0F2A44]">{total}</strong>{" "}
            {total === 1 ? "registro excluído" : "registros excluídos"} na Lixeira.
          </>
        )
      }
    >
      <div className="space-y-4 pt-3">
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
    </PainelFiltros>
  );
}
