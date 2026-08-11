import React from "react";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { formatarCelula, valorTotal } from "../../lib/relatoriosCatalogo";
import { formatBRL } from "../../lib/moeda";

// Resultado do relatório personalizado na tela. O `resultado` recebido tem o mesmo
// formato dos relatórios prontos (colunas, grupos com subtotal, registros e
// totais), por isso os botões Imprimir / PDF / Excel usam as mesmas funções.

function textoRegistros(quantidade) {
  return `${quantidade} ${quantidade === 1 ? "registro" : "registros"}`;
}

function alinharCelula(coluna) {
  return coluna.tipo === "moeda" || coluna.tipo === "numero" ? "text-right" : "text-left";
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

export default function ResultadoPersonalizado({
  resultado,
  geradoEm,
  autor,
  carregando,
  onImprimir,
  onPdf,
  onExcel,
}) {
  if (!resultado) return null;

  const total = valorTotal(resultado);
  const temSomavel = resultado.colunas.some((c) => c.somavel);
  const colSpanGrupo = Math.max(resultado.colunas.length - 1, 1);

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 sm:px-6 py-5 border-b border-black/5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">
              Relatório personalizado
            </div>
            <h2 className="text-lg font-semibold text-[#0F2A44] mt-0.5">{resultado.nome}</h2>
            <p className="text-xs text-[#0F2A44]/55 mt-1">
              Gerado em {geradoEm}
              {autor ? ` por ${autor}` : ""}
            </p>
            {resultado.descricao && (
              <p className="text-xs text-[#0F2A44]/45 mt-1">{resultado.descricao}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={onImprimir}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
            >
              <Printer size={14} /> Imprimir
            </button>
            <button
              onClick={onPdf}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
            >
              <FileText size={14} /> PDF
            </button>
            <button
              onClick={onExcel}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-5">
          <Chip label="Registros" valor={textoRegistros(resultado.registros)} />
          {total !== null && <Chip label={resultado.rotuloTotal} valor={formatBRL(total)} destaque />}
          {resultado.resumo.map((item) => (
            <Chip key={item.label} label={item.label} valor={item.valor} />
          ))}
        </div>
      </header>

      {carregando && (
        <div className="px-5 sm:px-6 py-8 text-sm text-[#0F2A44]/50">Carregando dados...</div>
      )}

      {!carregando && resultado.registros === 0 && (
        <div className="px-5 sm:px-6 py-10 text-center text-sm text-[#0F2A44]/50">
          Nenhum registro encontrado para os critérios escolhidos.
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
                        colSpan={colSpanGrupo}
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

                  {temSomavel && (
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
            {resultado.grupos.length > 1 && (
              <tfoot>
                <tr className="bg-[#0F2A44] text-white">
                  <td
                    colSpan={total === null ? resultado.colunas.length : colSpanGrupo}
                    className="px-4 py-3 text-xs uppercase tracking-[0.12em] font-semibold"
                  >
                    Total geral — {textoRegistros(resultado.registros)}
                  </td>
                  {total !== null && (
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                      {formatBRL(total)}
                    </td>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
