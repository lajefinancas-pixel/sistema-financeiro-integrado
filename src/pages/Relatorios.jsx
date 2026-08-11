import React from "react";
import {
  Printer, FileText, FileSpreadsheet, Landmark, Users, BarChart2, ChevronRight, RefreshCw,
} from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import { usePermissaoRelatorios, MODULO_EQUIVALENTE } from "../lib/permissoesRelatorios";
import { carregarBaseFinanceira, carregarBaseFornecedores } from "../lib/relatoriosDados";
import {
  CATEGORIAS, relatoriosDaCategoria, relatorioPorId, gerarRelatorio, valorTotal, formatarCelula,
} from "../lib/relatoriosCatalogo";
import { imprimirRelatorio, gerarPdfRelatorio, exportarExcelRelatorio } from "../lib/relatoriosDocumento";
import { agoraBR } from "../lib/saldosDocumento";
import { formatBRL } from "../lib/moeda";
import { mensagemAmigavel } from "../lib/erros";

const ICONES_CATEGORIA = { financeiro: Landmark, fornecedores: Users };

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function primeiroDiaDoAno() {
  return `${new Date().getFullYear()}-01-01`;
}
function nomeDoArquivo(relatorio) {
  return `${relatorio.id}-${hojeISO()}`;
}

/** "3 registros" / "1 registro" */
function textoRegistros(quantidade) {
  return `${quantidade} ${quantidade === 1 ? "registro" : "registros"}`;
}

function alinharCelula(coluna) {
  return coluna.tipo === "moeda" || coluna.tipo === "numero" ? "text-right" : "text-left";
}

function CartaoRelatorio({ relatorio, ativo, onSelecionar }) {
  return (
    <button
      type="button"
      onClick={() => onSelecionar(relatorio.id)}
      aria-pressed={ativo}
      className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${
        ativo
          ? "bg-[#0F2A44] border-[#0F2A44] text-white shadow-sm"
          : "bg-white border-black/5 hover:border-[#C9A227]/60 hover:bg-[#C9A227]/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-medium ${ativo ? "text-white" : "text-[#0F2A44]"}`}>
            {relatorio.nome}
          </div>
          <div className={`text-xs mt-1 leading-relaxed ${ativo ? "text-white/70" : "text-[#0F2A44]/55"}`}>
            {relatorio.descricao}
          </div>
        </div>
        <ChevronRight size={16} className={ativo ? "text-[#C9A227] shrink-0" : "text-[#0F2A44]/25 shrink-0"} />
      </div>
    </button>
  );
}

function Chip({ label, valor, destaque }) {
  return (
    <div
      className={`rounded-xl border px-4 py-2.5 ${
        destaque ? "bg-[#0F2A44] border-[#0F2A44] text-white" : "bg-[#F5F3EF] border-black/5 text-[#0F2A44]"
      }`}
    >
      <div className={`text-[10px] uppercase tracking-[0.16em] ${destaque ? "text-[#C9A227]" : "text-[#0F2A44]/45"}`}>
        {label}
      </div>
      <div className="text-sm font-semibold mt-0.5 tabular-nums">{valor}</div>
    </div>
  );
}

export default function Relatorios() {
  const {
    carregando: verificando,
    usuario,
    permissao,
    modulo,
    erro: erroPermissao,
  } = usePermissaoRelatorios();
  const podeVisualizar = permissao?.pode_visualizar === true;

  const [bases, setBases] = React.useState({ financeira: null, fornecedores: null });
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [avisoReserva, setAvisoReserva] = React.useState(false);

  const [selecionado, setSelecionado] = React.useState(null);
  const [geradoEm, setGeradoEm] = React.useState(null);
  const [periodo, setPeriodo] = React.useState({ inicio: primeiroDiaDoAno(), fim: hojeISO() });

  const carregarBases = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [financeira, fornecedores] = await Promise.all([
        carregarBaseFinanceira(),
        carregarBaseFornecedores(),
      ]);
      setBases({ financeira, fornecedores });
      setAvisoReserva(financeira.rateioIndisponivel === true);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar os dados dos relatórios."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    if (podeVisualizar) carregarBases();
  }, [podeVisualizar, carregarBases]);

  const relatorio = relatorioPorId(selecionado);
  const resultado = React.useMemo(
    () => (relatorio ? gerarRelatorio(relatorio, bases, { periodo }) : null),
    [relatorio, bases, periodo]
  );
  const total = resultado ? valorTotal(resultado) : null;

  function selecionar(id) {
    setSelecionado(id);
    setGeradoEm(agoraBR());
  }

  async function atualizar() {
    await carregarBases();
    setGeradoEm(agoraBR());
  }

  const subtituloDocumento = React.useMemo(() => {
    const emitido = `Emitido em ${geradoEm ?? agoraBR()}`;
    const porQuem = usuario?.nome_completo ? ` por ${usuario.nome_completo}` : "";
    const trecho =
      relatorio?.temPeriodo && (periodo.inicio || periodo.fim)
        ? `Período de ${formatarCelula(periodo.inicio, "data")} a ${formatarCelula(periodo.fim, "data")} — `
        : "";
    return `${trecho}${emitido}${porQuem}`;
  }, [geradoEm, usuario, relatorio, periodo]);

  function imprimir() {
    if (!resultado || resultado.registros === 0) {
      setErro("Não há registros para imprimir neste relatório.");
      return;
    }
    imprimirRelatorio({ titulo: resultado.nome, subtitulo: subtituloDocumento, resultado });
  }

  function baixarPdf() {
    if (!resultado || resultado.registros === 0) {
      setErro("Não há registros para gerar o PDF deste relatório.");
      return;
    }
    gerarPdfRelatorio({
      titulo: resultado.nome,
      subtitulo: subtituloDocumento,
      resultado,
      arquivo: `${nomeDoArquivo(relatorio)}.pdf`,
    });
  }

  function baixarExcel() {
    if (!resultado || resultado.registros === 0) {
      setErro("Não há registros para exportar neste relatório.");
      return;
    }
    exportarExcelRelatorio({
      titulo: resultado.nome,
      resultado,
      arquivo: `${nomeDoArquivo(relatorio)}.xlsx`,
    });
  }

  const infoLayout = usuario ? { nome: usuario.nome_completo } : undefined;

  if (verificando) {
    return (
      <Layout usuario={infoLayout}>
        <div className="px-6 sm:px-8 py-7 text-sm text-[#0F2A44]/50">Verificando permissões...</div>
      </Layout>
    );
  }

  if (erroPermissao) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado
          modulo="Relatórios"
          detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`}
        />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Relatórios" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">
              Central de Relatórios
            </div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Relatórios</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              {carregando
                ? "Carregando dados dos relatórios..."
                : "Escolha um relatório para ver os dados, imprimir ou exportar."}
            </p>
          </div>
          <button
            type="button"
            onClick={atualizar}
            disabled={carregando}
            className="self-start flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            <RefreshCw size={14} className={carregando ? "animate-spin" : undefined} />
            Atualizar dados
          </button>
        </div>

        {modulo === MODULO_EQUIVALENTE && (
          <div className="bg-[#C9A227]/10 border border-[#C9A227]/30 text-[#0F2A44] text-xs rounded-lg px-4 py-2.5 mb-5">
            O módulo "Relatórios" ainda não está configurado nos perfis de acesso: sua permissão de
            Auditoria está valendo como equivalente temporário.
          </div>
        )}

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {erro}
          </div>
        )}

        {avisoReserva && relatorio?.id === "consolidado-financeiro" && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-2.5 mb-5">
            O consolidado está mostrando o saldo real das contas: o valor reservado das programações
            ainda não está disponível neste ambiente.
          </div>
        )}

        {/* Painel da central: um bloco por categoria, cada relatório um item clicável. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          {CATEGORIAS.map((categoria) => {
            const Icone = ICONES_CATEGORIA[categoria.id] ?? BarChart2;
            return (
              <section
                key={categoria.id}
                className="bg-white rounded-2xl border border-black/5 shadow-sm p-5"
              >
                <div className="flex items-start gap-3 pb-4 mb-4 border-b border-black/5">
                  <div className="w-10 h-10 rounded-xl bg-[#0F2A44] flex items-center justify-center shrink-0">
                    <Icone size={18} className="text-[#C9A227]" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[#0F2A44] uppercase tracking-[0.1em]">
                      {categoria.nome}
                    </h2>
                    <p className="text-xs text-[#0F2A44]/55 mt-0.5 leading-relaxed">
                      {categoria.descricao}
                    </p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {relatoriosDaCategoria(categoria.id).map((item) => (
                    <CartaoRelatorio
                      key={item.id}
                      relatorio={item}
                      ativo={item.id === selecionado}
                      onSelecionar={selecionar}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* Resultado do relatório selecionado, na mesma tela. */}
        {!relatorio && (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
            <BarChart2 size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
            <p className="text-sm text-[#0F2A44]/50">
              Nenhum relatório selecionado. Escolha um dos itens acima para ver os dados aqui.
            </p>
          </div>
        )}

        {relatorio && resultado && (
          <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <header className="px-5 sm:px-6 py-5 border-b border-black/5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">
                    {CATEGORIAS.find((c) => c.id === relatorio.categoria)?.nome}
                  </div>
                  <h2 className="text-lg font-semibold text-[#0F2A44] mt-0.5">{resultado.nome}</h2>
                  <p className="text-xs text-[#0F2A44]/55 mt-1">
                    Gerado em {geradoEm ?? agoraBR()}
                    {usuario?.nome_completo ? ` por ${usuario.nome_completo}` : ""}
                    {usuario?.cargo ? ` — ${usuario.cargo}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={imprimir}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                  >
                    <Printer size={14} /> Imprimir
                  </button>
                  <button
                    onClick={baixarPdf}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                  >
                    <FileText size={14} /> PDF
                  </button>
                  <button
                    onClick={baixarExcel}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                  >
                    <FileSpreadsheet size={14} /> Excel
                  </button>
                </div>
              </div>

              {relatorio.temPeriodo && (
                <div className="flex flex-wrap items-end gap-3 mt-5">
                  <label className="text-xs text-[#0F2A44]/60">
                    <span className="block mb-1">Data inicial</span>
                    <input
                      type="date"
                      value={periodo.inicio}
                      onChange={(e) => setPeriodo({ ...periodo, inicio: e.target.value })}
                      className="text-sm px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44] bg-white"
                    />
                  </label>
                  <label className="text-xs text-[#0F2A44]/60">
                    <span className="block mb-1">Data final</span>
                    <input
                      type="date"
                      value={periodo.fim}
                      onChange={(e) => setPeriodo({ ...periodo, fim: e.target.value })}
                      className="text-sm px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44] bg-white"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setPeriodo({ inicio: primeiroDiaDoAno(), fim: hojeISO() })}
                    className="text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
                  >
                    Ano corrente
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-3 mt-5">
                <Chip label="Registros" valor={textoRegistros(resultado.registros)} />
                {total !== null && <Chip label={resultado.rotuloTotal} valor={formatBRL(total)} destaque />}
                {resultado.resumo.map((item) => (
                  <Chip key={item.label} label={item.label} valor={item.valor} destaque={item.destaque} />
                ))}
              </div>
            </header>

            {carregando && (
              <div className="px-5 sm:px-6 py-8 text-sm text-[#0F2A44]/50">Carregando dados...</div>
            )}

            {!carregando && resultado.registros === 0 && (
              <div className="px-5 sm:px-6 py-10 text-center text-sm text-[#0F2A44]/50">
                Nenhum registro encontrado para este relatório.
              </div>
            )}

            {!carregando && resultado.registros > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F3EF] border-y border-black/5">
                      {resultado.colunas.map((coluna) => (
                        <th
                          key={coluna.chave}
                          className={`px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#0F2A44]/50 whitespace-nowrap ${alinharCelula(coluna)}`}
                        >
                          {coluna.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.grupos.map((grupo) => (
                      <React.Fragment key={grupo.nome ?? "unico"}>
                        {grupo.nome && (
                          <tr className="bg-[#0F2A44]/[0.04] border-y border-black/5">
                            <th
                              colSpan={Math.max(resultado.colunas.length - 1, 1)}
                              className="px-4 py-2 text-left text-xs font-semibold text-[#0F2A44] uppercase tracking-[0.08em] border-l-2 border-[#C9A227]"
                            >
                              {resultado.rotuloGrupo ? `${resultado.rotuloGrupo}: ${grupo.nome}` : grupo.nome}
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-[#0F2A44] whitespace-nowrap">
                              {resultado.campoTotal
                                ? formatBRL(grupo.totais?.[resultado.campoTotal])
                                : textoRegistros(grupo.linhas.length)}
                            </th>
                          </tr>
                        )}

                        {grupo.linhas.map((linha, indice) => (
                          <tr
                            key={`${grupo.nome ?? "unico"}-${linha.id ?? indice}`}
                            className="border-b border-black/5 hover:bg-[#C9A227]/[0.05]"
                          >
                            {resultado.colunas.map((coluna) => (
                              <td
                                key={coluna.chave}
                                className={`px-4 py-2.5 whitespace-nowrap ${alinharCelula(coluna)} ${
                                  coluna.tipo === "moeda"
                                    ? "font-semibold tabular-nums text-[#0F2A44]"
                                    : "text-[#0F2A44]/80"
                                }`}
                              >
                                {formatarCelula(linha[coluna.chave], coluna.tipo)}
                              </td>
                            ))}
                          </tr>
                        ))}

                        {resultado.colunas.some((c) => c.somavel) && (
                          <tr className="border-b-2 border-[#0F2A44]/15 bg-white">
                            {resultado.colunas.map((coluna, indice) => (
                              <td
                                key={coluna.chave}
                                className={`px-4 py-2.5 text-xs font-semibold text-[#0F2A44] whitespace-nowrap ${alinharCelula(coluna)}`}
                              >
                                {indice === 0
                                  ? `${grupo.nome ? "Subtotal" : "Total geral"} (${textoRegistros(grupo.linhas.length)})`
                                  : coluna.somavel
                                    ? formatarCelula(grupo.totais?.[coluna.chave], coluna.tipo)
                                    : ""}
                              </td>
                            ))}
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                  {resultado.grupos.length > 1 && total !== null && (
                    <tfoot>
                      <tr className="bg-[#0F2A44] text-white">
                        <td
                          colSpan={Math.max(resultado.colunas.length - 1, 1)}
                          className="px-4 py-3 text-xs uppercase tracking-[0.12em] font-semibold"
                        >
                          Total geral — {textoRegistros(resultado.registros)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                          {formatBRL(total)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
