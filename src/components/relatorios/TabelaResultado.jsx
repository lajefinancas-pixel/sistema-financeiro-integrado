import React from "react";
import { colunaNumerica, formatarCelula, valorTotal } from "../../lib/relatoriosCatalogo";
import { formatBRL } from "../../lib/moeda";

// Tabela de um resultado de relatório na tela.
//
// Mesmo formato de resultado usado pelos relatórios prontos, pelos comparativos e
// pelos personalizados (colunas, grupos com subtotal, registros e totais), então
// é a mesma leitura que sai na impressão, no PDF e na planilha.

function textoRegistros(quantidade) {
  return `${quantidade} ${quantidade === 1 ? "registro" : "registros"}`;
}

function alinhar(coluna) {
  return colunaNumerica(coluna) ? "text-right" : "text-left";
}

export default function TabelaResultado({ resultado, vazio = "Nenhum registro encontrado." }) {
  if (!resultado) return null;

  if (resultado.registros === 0) {
    return <div className="px-5 sm:px-6 py-10 text-center text-sm text-[#0F2A44]/50">{vazio}</div>;
  }

  const total = valorTotal(resultado);
  const temSomavel = resultado.colunas.some((c) => c.somavel);
  const colSpanGrupo = Math.max(resultado.colunas.length - 1, 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#F5F3EF] border-y border-black/5">
            {resultado.colunas.map((coluna) => (
              <th
                key={coluna.chave}
                className={`px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#0F2A44]/50 whitespace-nowrap ${alinhar(coluna)}`}
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
                      className={`px-4 py-2.5 whitespace-nowrap ${alinhar(coluna)} ${
                        coluna.tipo === "moeda"
                          ? "font-semibold tabular-nums text-[#0F2A44]"
                          : coluna.tipo === "percentual"
                            ? "tabular-nums text-[#0F2A44]/80"
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
                      className={`px-4 py-2.5 text-xs font-semibold text-[#0F2A44] whitespace-nowrap ${alinhar(coluna)}`}
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
  );
}
