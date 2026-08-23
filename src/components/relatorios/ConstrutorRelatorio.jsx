import React from "react";
import { BarChart2, Eraser, Save, Star, X } from "lucide-react";
import {
  FONTES,
  fontePorId,
  configuracaoPadrao,
  linhasDaFonte,
  opcoesDeFiltro,
  ordenacoesDaFonte,
} from "../../lib/relatoriosPersonalizados";
import PainelFiltros from "../comuns/PainelFiltros";

const ROTULO_CAMPO = "block text-xs font-medium text-[#0F2A44]/70 mb-1";
const CAMPO =
  "w-full px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] bg-white " +
  "focus:outline-none focus:border-[#C9A227]";
const BOTAO_SECUNDARIO =
  "flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 " +
  "text-[#0F2A44]/70 hover:bg-black/5";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function primeiroDiaDoAno() {
  return `${new Date().getFullYear()}-01-01`;
}

/** Data ISO no formato de leitura da tela; vazio vira reticências no chip. */
function dataBR(valor) {
  if (!valor) return "...";
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Atalhos dos relatórios salvos: clicar recarrega a configuração inteira e gera
 * o relatório; o "x" apaga o atalho.
 */
export function RelatoriosSalvos({ favoritos, carregando, erro, onAplicar, onExcluir }) {
  if (carregando) {
    return <p className="text-[11px] text-[#0F2A44]/40">Carregando relatórios salvos...</p>;
  }
  if (erro) return <p className="text-[11px] text-red-600">{erro}</p>;
  if (!favoritos || favoritos.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-[#0F2A44]/70 mr-1">
        <Star size={13} /> Relatórios salvos
      </span>
      {favoritos.map((favorito) => (
        <span
          key={favorito.id}
          className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white text-xs text-[#0F2A44]"
        >
          <button
            type="button"
            onClick={() => onAplicar(favorito)}
            title={`Abrir relatório salvo: ${favorito.nome}`}
            className="pl-3 pr-1 py-1 rounded-l-full hover:bg-black/5"
          >
            {favorito.nome}
          </button>
          <button
            type="button"
            onClick={() => onExcluir(favorito)}
            title={`Excluir relatório salvo: ${favorito.nome}`}
            className="pr-2.5 py-1 rounded-r-full text-[#0F2A44]/40 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Construtor do relatório personalizado: fonte de dados, período, filtros,
 * colunas, agrupamento e ordenação. A configuração é do componente de fora, para
 * que um relatório salvo possa ser recarregado inteiro aqui dentro.
 */
export default function ConstrutorRelatorio({
  configuracao,
  onAlterar,
  bases,
  onGerar,
  onSalvar,
  salvando,
  erro,
  onFechar,
}) {
  const [nomeParaSalvar, setNomeParaSalvar] = React.useState(null);
  const fonte = fontePorId(configuracao?.fonte) ?? FONTES[0];

  // Base da fonte antes dos filtros: é dela que saem as opções dos selects.
  const linhas = React.useMemo(() => linhasDaFonte(fonte, bases), [fonte, bases]);
  const opcoes = React.useMemo(() => {
    const mapa = {};
    fonte.filtros.forEach((filtro) => {
      mapa[filtro.id] = opcoesDeFiltro(linhas, filtro.campo);
    });
    return mapa;
  }, [fonte, linhas]);

  const ordenacoes = ordenacoesDaFonte(fonte);
  const colunasEscolhidas = configuracao?.colunas ?? [];

  function alterar(mudanca) {
    onAlterar({ ...configuracao, ...mudanca });
  }

  function trocarFonte(id) {
    // Colunas, filtros e agrupamento pertencem à fonte: trocar de fonte recomeça
    // com as sugestões da nova, em vez de manter critérios que não existem lá.
    onAlterar(configuracaoPadrao(id));
  }

  /**
   * Chips do período e dos filtros da fonte que estão escolhidos agora. Remover
   * um chip devolve aquele critério ao "Todos"/"Sem período" que os próprios
   * campos já oferecem -- nenhum critério novo entra aqui.
   */
  const chipsDosCriterios = [];
  if (fonte.temPeriodo && (configuracao?.periodo?.inicio || configuracao?.periodo?.fim)) {
    chipsDosCriterios.push({
      chave: "periodo",
      rotulo: `${fonte.rotuloPeriodo}: ${dataBR(configuracao.periodo.inicio)} a ${dataBR(configuracao.periodo.fim)}`,
      remover: () => alterar({ periodo: { inicio: "", fim: "" } }),
    });
  }
  fonte.filtros.forEach((filtro) => {
    const valor = configuracao?.filtros?.[filtro.id] ?? "";
    if (!valor) return;
    chipsDosCriterios.push({
      chave: `filtro-${filtro.id}`,
      rotulo: `${filtro.label}: ${valor}`,
      remover: () => alterar({ filtros: { ...configuracao.filtros, [filtro.id]: "" } }),
    });
  });

  /** "Limpar filtros" da barra: o mesmo que remover todos os chips de uma vez. */
  function limparPeriodoEFiltros() {
    const filtrosVazios = {};
    fonte.filtros.forEach((filtro) => {
      filtrosVazios[filtro.id] = "";
    });
    const mudanca = { filtros: { ...configuracao.filtros, ...filtrosVazios } };
    if (fonte.temPeriodo) mudanca.periodo = { inicio: "", fim: "" };
    alterar(mudanca);
  }

  function alternarColuna(chave) {
    const atuais = new Set(colunasEscolhidas);
    if (atuais.has(chave)) atuais.delete(chave);
    else atuais.add(chave);
    alterar({ colunas: fonte.colunas.filter((c) => atuais.has(c.chave)).map((c) => c.chave) });
  }

  function confirmarSalvar(evento) {
    evento.preventDefault();
    onSalvar(nomeParaSalvar, () => setNomeParaSalvar(null));
  }

  return (
    <div className="border-t border-black/5 pt-5 mt-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className={ROTULO_CAMPO} htmlFor="fonte-personalizado">
            Fonte de dados
          </label>
          <select
            id="fonte-personalizado"
            value={fonte.id}
            onChange={(e) => trocarFonte(e.target.value)}
            className={CAMPO}
          >
            {FONTES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-[#0F2A44]/45 mt-1 leading-relaxed">{fonte.descricao}</p>
        </div>

        <div>
          <label className={ROTULO_CAMPO} htmlFor="agrupamento-personalizado">
            Agrupar por (opcional)
          </label>
          <select
            id="agrupamento-personalizado"
            value={configuracao?.agrupamento ?? ""}
            onChange={(e) => alterar({ agrupamento: e.target.value })}
            className={CAMPO}
          >
            <option value="">Sem agrupamento</option>
            {fonte.agrupamentos.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-[#0F2A44]/45 mt-1 leading-relaxed">
            Agrupado, o relatório mostra o subtotal de cada grupo e o total geral no fim.
          </p>
        </div>

        <div>
          <label className={ROTULO_CAMPO} htmlFor="ordenacao-personalizado">
            Ordenação
          </label>
          <select
            id="ordenacao-personalizado"
            value={configuracao?.ordenacao ?? ordenacoes[0]?.id}
            onChange={(e) => alterar({ ordenacao: e.target.value })}
            className={CAMPO}
          >
            {ordenacoes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Período e filtros da fonte, no painel recolhível compartilhado: os
          critérios escolhidos continuam à vista nos chips quando fechado. */}
      {fonte.temPeriodo || fonte.filtros.length > 0 ? (
        <PainelFiltros
          className="mt-4"
          rotulo="Período e filtros"
          chips={chipsDosCriterios}
          onLimpar={chipsDosCriterios.length > 0 ? limparPeriodoEFiltros : undefined}
        >
          <div className="space-y-4 pt-3">
            {/* Período: só nas fontes em que existe uma data a delimitar. */}
            {fonte.temPeriodo ? (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={ROTULO_CAMPO} htmlFor="inicio-personalizado">
                    Data inicial — {fonte.rotuloPeriodo}
                  </label>
                  <input
                    id="inicio-personalizado"
                    type="date"
                    value={configuracao?.periodo?.inicio ?? ""}
                    onChange={(e) =>
                      alterar({ periodo: { ...configuracao.periodo, inicio: e.target.value } })
                    }
                    className={CAMPO}
                  />
                </div>
                <div>
                  <label className={ROTULO_CAMPO} htmlFor="fim-personalizado">
                    Data final
                  </label>
                  <input
                    id="fim-personalizado"
                    type="date"
                    value={configuracao?.periodo?.fim ?? ""}
                    onChange={(e) => alterar({ periodo: { ...configuracao.periodo, fim: e.target.value } })}
                    className={CAMPO}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => alterar({ periodo: { inicio: primeiroDiaDoAno(), fim: hojeISO() } })}
                  className={BOTAO_SECUNDARIO}
                >
                  Ano corrente
                </button>
                <button
                  type="button"
                  onClick={() => alterar({ periodo: { inicio: "", fim: "" } })}
                  className={BOTAO_SECUNDARIO}
                >
                  Sem período
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-[#0F2A44]/45">{fonte.aviso}</p>
            )}

            {/* Filtros da fonte escolhida. */}
            {fonte.filtros.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {fonte.filtros.map((filtro) => (
                  <div key={filtro.id}>
                    <label className={ROTULO_CAMPO} htmlFor={`filtro-${filtro.id}`}>
                      {filtro.label}
                    </label>
                    <select
                      id={`filtro-${filtro.id}`}
                      value={configuracao?.filtros?.[filtro.id] ?? ""}
                      onChange={(e) =>
                        alterar({ filtros: { ...configuracao.filtros, [filtro.id]: e.target.value } })
                      }
                      className={CAMPO}
                    >
                      <option value="">Todos</option>
                      {(opcoes[filtro.id] ?? []).map((valor) => (
                        <option key={valor} value={valor}>
                          {valor}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PainelFiltros>
      ) : (
        <p className="text-[11px] text-[#0F2A44]/45 mt-4">{fonte.aviso}</p>
      )}

      {/* Colunas do relatório: valem para a tela e para impressão, PDF e Excel. */}
      <div className="mt-5 pt-4 border-t border-black/5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-xs font-medium text-[#0F2A44]/70">
            Colunas do relatório ({colunasEscolhidas.length} de {fonte.colunas.length})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => alterar({ colunas: fonte.colunas.map((c) => c.chave) })}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
            >
              Marcar todas
            </button>
            <button
              type="button"
              onClick={() => alterar({ colunas: [...fonte.padrao] })}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
            >
              Colunas sugeridas
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
          {fonte.colunas.map((coluna) => (
            <label
              key={coluna.chave}
              className="flex items-center gap-2 text-sm text-[#0F2A44]/80 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={colunasEscolhidas.includes(coluna.chave)}
                onChange={() => alternarColuna(coluna.chave)}
                className="rounded border-black/20 text-[#0F2A44] focus:ring-[#C9A227]"
              />
              <span>{coluna.label}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-[#0F2A44]/45 mt-2 leading-relaxed">
          Colunas de valor entram na totalização automática: o relatório mostra a quantidade de
          registros e o valor total.
        </p>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-4 py-2.5 mt-4">
          {erro}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-5">
        <button
          type="button"
          onClick={onGerar}
          disabled={colunasEscolhidas.length === 0}
          className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white font-medium hover:bg-[#0F2A44]/90 disabled:opacity-40"
        >
          <BarChart2 size={15} /> Gerar relatório
        </button>

        {nomeParaSalvar === null ? (
          <button
            type="button"
            onClick={() => setNomeParaSalvar("")}
            disabled={colunasEscolhidas.length === 0}
            className={`${BOTAO_SECUNDARIO} disabled:opacity-40`}
          >
            <Save size={14} /> Salvar relatório
          </button>
        ) : (
          <form onSubmit={confirmarSalvar} className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={nomeParaSalvar}
              onChange={(e) => setNomeParaSalvar(e.target.value)}
              placeholder="Nome do relatório"
              className="px-3 py-2 rounded-lg border border-black/10 text-sm w-52"
            />
            <button
              type="submit"
              disabled={salvando || nomeParaSalvar.trim() === ""}
              className="text-xs px-3 py-2 rounded-lg bg-[#C9A227] text-[#0F2A44] font-medium hover:bg-[#C9A227]/90 disabled:opacity-40"
            >
              {salvando ? "Salvando..." : "Confirmar"}
            </button>
            <button
              type="button"
              onClick={() => setNomeParaSalvar(null)}
              className="text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
            >
              Cancelar
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => onAlterar(configuracaoPadrao(fonte.id))}
          className={BOTAO_SECUNDARIO}
        >
          <Eraser size={14} /> Limpar critérios
        </button>
        <button type="button" onClick={onFechar} className={`${BOTAO_SECUNDARIO} ml-auto`}>
          <X size={14} /> Fechar construtor
        </button>
      </div>
    </div>
  );
}
