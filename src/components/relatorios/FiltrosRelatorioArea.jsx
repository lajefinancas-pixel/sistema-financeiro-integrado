import React from "react";
import PainelFiltros from "../comuns/PainelFiltros";
import { SITUACOES_AREA } from "../../lib/areasFornecedores";
import {
  descricaoDosFiltros,
  filtrosDoRelatorioDaArea,
  filtrosVaziosDoRelatorio,
  periodoDaArea,
  totalFiltrosDoRelatorio,
} from "../../lib/relatoriosAreasFornecedores";
import { textoPeriodo } from "../../lib/relatoriosCabecalho";

/**
 * Filtros dos relatórios de Patrocínios, Aluguéis e Bandas.
 *
 * É o MESMO painel recolhível das listagens (PainelFiltros) com os MESMOS tipos
 * de campo da tela de cada área -- período, secretaria, fornecedor, situação,
 * faixa de valores e os campos próprios da área (evento, objeto alugado,
 * banda/artista). Quem decide quais campos existem é `filtrosDoRelatorioDaArea`,
 * e quem filtra é a mesma função da listagem: o painel só guarda o que foi
 * escolhido.
 *
 * Nada aqui é aplicado à tela da área: o estado vive na Central de Relatórios e
 * vale só para o relatório aberto.
 */
export default function FiltrosRelatorioArea({
  area,
  filtros,
  onChange,
  secretarias = [],
  className = "",
}) {
  const campos = React.useMemo(() => filtrosDoRelatorioDaArea(area), [area]);
  const ativos = totalFiltrosDoRelatorio(area, filtros);

  const limpar = (chaves) =>
    onChange((atual) => {
      const proximo = { ...atual };
      chaves.forEach((chave) => {
        proximo[chave] = "";
      });
      return proximo;
    });

  // Um chip por filtro preenchido, todos removíveis. O do período é montado
  // aqui com `textoPeriodo`, o mesmo utilitário que escreve o período no
  // cabeçalho dos documentos.
  const chips = React.useMemo(() => {
    const lista = [];
    const inicio = String(filtros?.periodoInicio ?? "").trim();
    const fim = String(filtros?.periodoFim ?? "").trim();
    if (inicio !== "" || fim !== "") {
      lista.push({
        chave: "periodo",
        rotulo: `${periodoDaArea(area).rotulo}: ${textoPeriodo(inicio, fim)}`,
        remover: () => limpar(["periodoInicio", "periodoFim"]),
      });
    }
    descricaoDosFiltros(area, filtros, { secretarias }).forEach((item) => {
      lista.push({
        chave: item.chave,
        rotulo: `${item.label}: ${item.valor}`,
        remover: () => limpar(item.chaves),
      });
    });
    return lista;
  }, [area, filtros, secretarias]);

  return (
    <PainelFiltros
      className={className}
      rotulo="Filtros do relatório"
      chips={chips}
      totalAtivos={ativos}
      onLimpar={ativos === 0 ? undefined : () => onChange(filtrosVaziosDoRelatorio(area))}
    >
      <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
        {campos.map((filtro) => (
          <Campo
            key={filtro.chave}
            filtro={filtro}
            filtros={filtros}
            secretarias={secretarias}
            onChange={onChange}
          />
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-[#0F2A44]/45">
        Sem período informado, o relatório traz todos os registros da área — os mesmos que a tela
        mostra. Com período informado, entram apenas os registros que tenham a data considerada
        ({periodoDaArea(area).referencia}). Imprimir, PDF e Excel usam exatamente o que estiver
        filtrado aqui.
      </p>
    </PainelFiltros>
  );
}

function Campo({ filtro, filtros, secretarias, onChange }) {
  const classe = "w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm";
  const definir = (chave, valor) => onChange((atual) => ({ ...atual, [chave]: valor }));

  if (filtro.tipo === "periodo") {
    return (
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">{filtro.rotulo}</label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filtros?.periodoInicio ?? ""}
            onChange={(e) => definir("periodoInicio", e.target.value)}
            aria-label={`${filtro.rotulo} — data inicial`}
            className={classe}
          />
          <input
            type="date"
            value={filtros?.periodoFim ?? ""}
            onChange={(e) => definir("periodoFim", e.target.value)}
            aria-label={`${filtro.rotulo} — data final`}
            className={classe}
          />
        </div>
      </div>
    );
  }

  if (filtro.tipo === "faixaValor") {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">{filtro.rotulo}</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            value={filtros?.[`${filtro.chave}Min`] ?? ""}
            onChange={(e) => definir(`${filtro.chave}Min`, e.target.value)}
            placeholder="De"
            aria-label={`${filtro.rotulo} — valor mínimo`}
            className={classe}
          />
          <input
            type="number"
            step="0.01"
            value={filtros?.[`${filtro.chave}Max`] ?? ""}
            onChange={(e) => definir(`${filtro.chave}Max`, e.target.value)}
            placeholder="Até"
            aria-label={`${filtro.rotulo} — valor máximo`}
            className={classe}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">{filtro.rotulo}</label>
      {filtro.tipo === "secretaria" ? (
        <select
          value={filtros?.[filtro.chave] ?? ""}
          onChange={(e) => definir(filtro.chave, e.target.value)}
          className={classe}
        >
          <option value="">Todas</option>
          {secretarias.map((secretaria) => (
            <option key={secretaria.id} value={secretaria.id}>
              {secretaria.nome}
            </option>
          ))}
        </select>
      ) : filtro.tipo === "situacao" ? (
        <select
          value={filtros?.[filtro.chave] ?? ""}
          onChange={(e) => definir(filtro.chave, e.target.value)}
          className={classe}
        >
          <option value="">Todas</option>
          {SITUACOES_AREA.map((situacao) => (
            <option key={situacao.value} value={situacao.value}>
              {situacao.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={filtros?.[filtro.chave] ?? ""}
          onChange={(e) => definir(filtro.chave, e.target.value)}
          className={classe}
        />
      )}
    </div>
  );
}
