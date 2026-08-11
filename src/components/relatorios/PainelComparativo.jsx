import React from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, FileSpreadsheet, FileText, Printer } from "lucide-react";
import {
  MODOS_COMPARATIVO,
  compararLadoALado,
  compararMeses,
  dimensaoPorId,
  linhasDoComparativo,
  linhasDoPeriodo,
  mesesDeComparacao,
  resumoDoComparativo,
  rotuloModoDimensao,
  valoresDaDimensao,
} from "../../lib/relatoriosComparativo";
import { carregarSaldosNaData } from "../../lib/relatoriosDados";
import { formatarPercentual, formatBRL } from "../../lib/moeda";
import { dadosDoGrafico } from "../../lib/relatoriosGrafico";
import GraficoRelatorio from "./GraficoRelatorio";
import OpcoesImpressao from "./OpcoesImpressao";
import TabelaResultado from "./TabelaResultado";

// Comparativo do relatório selecionado, em dois recortes:
//
//   Mês atual x mês anterior -- nos relatórios de saldo o lado anterior é a
//   posição das contas no fechamento do mês passado, lida do histórico pela mesma
//   fonte única das outras telas; nos tributários é o recorte pela data da nota.
//
//   Lado a lado -- duas secretarias (ou dois bancos) comparadas item a item.
//
// O resultado sai no mesmo formato dos outros relatórios, então a tabela, o
// gráfico e os documentos (impressão, PDF, planilha) são exatamente os mesmos.

function Seletor({ label, valor, onChange, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-[#0F2A44]/45 mb-1">{label}</span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm rounded-lg border border-black/10 bg-white px-3 py-2 text-[#0F2A44] focus:outline-none focus:ring-2 focus:ring-[#C9A227]/40"
      >
        {children}
      </select>
    </label>
  );
}

function Lado({ rotulo, valor, destaque }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        destaque ? "bg-[#0F2A44] border-[#0F2A44] text-white" : "bg-white border-black/10 text-[#0F2A44]"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-[0.14em] ${destaque ? "text-[#C9A227]" : "text-[#0F2A44]/45"}`}
      >
        {rotulo}
      </div>
      <div className="text-base font-semibold tabular-nums mt-1">{formatBRL(valor)}</div>
    </div>
  );
}

/** Diferença e variação, com a seta indicando crescimento, redução ou empate. */
function Variacao({ diferenca, percentual }) {
  const subiu = diferenca > 0;
  const caiu = diferenca < 0;
  const Icone = subiu ? ArrowUpRight : caiu ? ArrowDownRight : ArrowRight;
  const cor = subiu ? "text-[#008300]" : caiu ? "text-[#e34948]" : "text-[#0F2A44]/60";

  return (
    <div className="rounded-xl border border-black/10 bg-[#F5F3EF] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#0F2A44]/45">Diferença</div>
      <div className={`flex items-center gap-1.5 mt-1 ${cor}`}>
        <Icone size={16} aria-hidden="true" />
        <span className="text-base font-semibold tabular-nums">{formatBRL(diferenca)}</span>
        <span className="text-sm font-medium tabular-nums ml-1">({formatarPercentual(percentual)})</span>
      </div>
      <div className="text-[11px] text-[#0F2A44]/45 mt-0.5">
        {subiu ? "Crescimento" : caiu ? "Redução" : "Sem variação"} em relação ao primeiro lado
      </div>
    </div>
  );
}

export default function PainelComparativo({
  relatorio,
  config,
  bases,
  modoImpressao,
  onModoImpressao,
  onDocumento,
}) {
  const meses = React.useMemo(() => mesesDeComparacao(), []);
  const posicao = config?.temporal?.tipo === "posicao";

  const [modo, setModo] = React.useState("temporal");
  const [dimensaoId, setDimensaoId] = React.useState(config?.dimensoes?.[0]?.id ?? "");
  const [ladoA, setLadoA] = React.useState("");
  const [ladoB, setLadoB] = React.useState("");
  const [mostrarGrafico, setMostrarGrafico] = React.useState(false);
  const [tipoGrafico, setTipoGrafico] = React.useState("barras");
  const [anterior, setAnterior] = React.useState(null);
  const [carregandoAnterior, setCarregandoAnterior] = React.useState(false);
  const [erroAnterior, setErroAnterior] = React.useState("");

  const dimensao = dimensaoPorId(config, dimensaoId);
  const linhas = React.useMemo(() => linhasDoComparativo(config, bases), [config, bases]);
  const opcoes = React.useMemo(() => valoresDaDimensao(linhas, dimensao), [linhas, dimensao]);

  // Os dois lados começam preenchidos com os dois primeiros valores disponíveis.
  React.useEffect(() => {
    if (opcoes.length === 0) return;
    setLadoA((atual) => (opcoes.includes(atual) ? atual : opcoes[0]));
    setLadoB((atual) => (opcoes.includes(atual) ? atual : opcoes[1] ?? opcoes[0]));
  }, [opcoes]);

  // Posição das contas no fechamento do mês anterior: uma consulta só, feita na
  // primeira vez que o comparativo mensal é aberto.
  const contasAtuais = bases?.financeira?.contas;
  React.useEffect(() => {
    if (!posicao || modo !== "temporal") return;
    if (anterior !== null || carregandoAnterior) return;
    if (!contasAtuais || contasAtuais.length === 0) return;

    let ativo = true;
    setCarregandoAnterior(true);
    setErroAnterior("");
    carregarSaldosNaData({ contas: contasAtuais, ate: meses.anterior.fim })
      .then((contas) => {
        if (ativo) setAnterior(contas);
      })
      .catch(() => {
        if (ativo) setErroAnterior("Não foi possível ler a posição do mês anterior.");
      })
      .finally(() => {
        if (ativo) setCarregandoAnterior(false);
      });

    return () => {
      ativo = false;
    };
  }, [posicao, modo, anterior, carregandoAnterior, contasAtuais, meses]);

  const resultado = React.useMemo(() => {
    if (!config || !dimensao) return null;

    if (modo === "temporal") {
      const linhasAnterior = posicao
        ? config.filtro
          ? (anterior ?? []).filter(config.filtro)
          : (anterior ?? [])
        : linhasDoPeriodo(config, linhas, meses.anterior);
      const linhasAtual = posicao ? linhas : linhasDoPeriodo(config, linhas, meses.atual);
      if (posicao && anterior === null) return null;
      return compararMeses({
        config,
        dimensao,
        linhasAnterior,
        linhasAtual,
        meses,
        nomeRelatorio: relatorio?.nome ?? "Relatório",
      });
    }

    return compararLadoALado({
      config,
      dimensao,
      linhas,
      ladoA,
      ladoB,
      nomeRelatorio: relatorio?.nome ?? "Relatório",
    });
  }, [config, dimensao, modo, posicao, anterior, linhas, meses, ladoA, ladoB, relatorio]);

  const grafico = React.useMemo(() => dadosDoGrafico(resultado), [resultado]);
  const filtros = resumoDoComparativo(resultado);
  const comparativo = resultado?.comparativo;

  const documento = (acao) => {
    if (resultado) onDocumento(acao, resultado, filtros);
  };

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 sm:px-6 py-5 border-b border-black/5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">
              Comparativo
            </div>
            <h3 className="text-base font-semibold text-[#0F2A44] mt-0.5">
              {resultado?.nome ?? `${relatorio?.nome ?? "Relatório"} — comparativo`}
            </h3>
            {resultado?.descricao && (
              <p className="text-xs text-[#0F2A44]/50 mt-1">{resultado.descricao}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {grafico && (
              <button
                onClick={() => setMostrarGrafico((v) => !v)}
                aria-pressed={mostrarGrafico}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border ${
                  mostrarGrafico
                    ? "bg-[#0F2A44] border-[#0F2A44] text-white"
                    : "border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                }`}
              >
                <BarChart3 size={14} /> {mostrarGrafico ? "Ocultar gráfico" : "Ver gráfico"}
              </button>
            )}
            <button
              onClick={() => documento("imprimir")}
              disabled={!resultado}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
            >
              <Printer size={14} /> Imprimir
            </button>
            <button
              onClick={() => documento("pdf")}
              disabled={!resultado}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
            >
              <FileText size={14} /> PDF
            </button>
            <button
              onClick={() => documento("excel")}
              disabled={!resultado}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <Seletor label="Comparação" valor={modo} onChange={setModo}>
            {MODOS_COMPARATIVO.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id === "dimensao" ? rotuloModoDimensao(dimensao) : item.rotulo}
              </option>
            ))}
          </Seletor>

          {config?.dimensoes?.length > 1 && (
            <Seletor label="Dimensão" valor={dimensaoId} onChange={setDimensaoId}>
              {config.dimensoes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Seletor>
          )}

          {modo === "dimensao" && (
            <>
              <Seletor label={`${dimensao?.label ?? "Lado"} A`} valor={ladoA} onChange={setLadoA}>
                {opcoes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Seletor>
              <Seletor label={`${dimensao?.label ?? "Lado"} B`} valor={ladoB} onChange={setLadoB}>
                {opcoes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Seletor>
            </>
          )}
        </div>

        {comparativo && (
          <div className="grid sm:grid-cols-3 gap-3 mt-4">
            <Lado rotulo={comparativo.rotuloA} valor={comparativo.totalA} />
            <Lado rotulo={comparativo.rotuloB} valor={comparativo.totalB} destaque />
            <Variacao diferenca={comparativo.diferenca} percentual={comparativo.percentual} />
          </div>
        )}

        <div className="mt-4">
          <OpcoesImpressao
            modo={modoImpressao}
            onModo={onModoImpressao}
            colunas={resultado?.colunas ?? []}
          />
        </div>

        {filtros && <p className="text-[11px] text-[#0F2A44]/45 mt-3">{filtros}</p>}
      </header>

      {erroAnterior && (
        <div className="px-5 sm:px-6 py-4 text-sm text-[#e34948] bg-[#e34948]/[0.06] border-b border-black/5">
          {erroAnterior}
        </div>
      )}

      {carregandoAnterior && !resultado && (
        <div className="px-5 sm:px-6 py-8 text-sm text-[#0F2A44]/50">
          Lendo a posição de {meses.anterior.rotulo}...
        </div>
      )}

      {mostrarGrafico && grafico && (
        <GraficoRelatorio dados={grafico} tipo={tipoGrafico} onTipo={setTipoGrafico} />
      )}

      {resultado && (
        <TabelaResultado
          resultado={resultado}
          vazio="Nenhum valor encontrado para os dois lados escolhidos."
        />
      )}

      {!resultado && !carregandoAnterior && !erroAnterior && (
        <div className="px-5 sm:px-6 py-10 text-center text-sm text-[#0F2A44]/50">
          Escolha os dois lados da comparação.
        </div>
      )}
    </section>
  );
}
