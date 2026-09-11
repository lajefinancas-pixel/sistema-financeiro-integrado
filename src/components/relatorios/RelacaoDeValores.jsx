import React from "react";
import { FileSpreadsheet, FileText, ListOrdered, Printer } from "lucide-react";
import OpcoesRelacaoValores from "./OpcoesRelacaoValores.jsx";
import { formatBRL } from "../../lib/moeda.js";
import { OPCOES_PADRAO_DA_RELACAO, montarRelacaoDeValores } from "../../lib/relacaoDeValores.js";
import {
  exportarExcelRelacaoDeValores,
  gerarPdfRelacaoDeValores,
  imprimirRelacaoDeValores,
} from "../../lib/relacaoValoresDocumento.js";

// A RELAÇÃO DE VALORES na tela de uma área: a terceira forma de imprimir, ao
// lado das que já existem.
//
// Leva ao papel só duas colunas -- o nome do registro e o valor -- com o total
// no fim. Os itens chegam prontos da tela, já recortados pela busca e pelos
// filtros aplicados, então a relação sai com exatamente os mesmos registros que
// estão à vista e o total impresso bate com o do topo da página.
//
// A linha de conferência abaixo dos botões mostra, antes de imprimir, quantos
// registros e qual total vão sair -- útil quando "somente com saldo em aberto"
// está marcado, porque aí a relação é menor do que a lista da tela.

export default function RelacaoDeValores({
  titulo,
  rotuloNome,
  rotuloValor,
  itens = [],
  arquivo,
  className = "",
}) {
  const [opcoes, setOpcoes] = React.useState(OPCOES_PADRAO_DA_RELACAO);

  // Uma única relação alimenta a impressão, o PDF e a planilha: os três saem
  // com as mesmas linhas, na mesma ordem, com o mesmo total.
  const relacao = React.useMemo(
    () => montarRelacaoDeValores({ titulo, rotuloNome, rotuloValor, itens, opcoes }),
    [titulo, rotuloNome, rotuloValor, itens, opcoes],
  );

  const vazia = relacao.registros === 0;
  const classeBotao =
    "flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs text-[#0F2A44] hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-white";

  return (
    <div className={`rounded-2xl border border-black/5 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListOrdered size={16} className="text-[#C9A227]" />
          <div>
            <div className="text-sm font-medium text-[#0F2A44]">Relação de valores</div>
            <div className="text-[11px] text-[#0F2A44]/50">
              Só {String(rotuloNome ?? "nome").toLowerCase()} e {String(rotuloValor ?? "valor").toLowerCase()}, com o
              total no fim -- respeita a busca e os filtros da tela.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => imprimirRelacaoDeValores({ relacao })}
            disabled={vazia}
            className={classeBotao}
          >
            <Printer size={14} /> Imprimir
          </button>
          <button
            type="button"
            onClick={() => gerarPdfRelacaoDeValores({ relacao, arquivo: arquivo ? `${arquivo}.pdf` : undefined })}
            disabled={vazia}
            className={classeBotao}
          >
            <FileText size={14} /> PDF
          </button>
          <button
            type="button"
            onClick={() =>
              exportarExcelRelacaoDeValores({ relacao, arquivo: arquivo ? `${arquivo}.xlsx` : undefined })
            }
            disabled={vazia}
            className={classeBotao}
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3">
        <OpcoesRelacaoValores opcoes={opcoes} onOpcoes={setOpcoes} />
        <span className="text-[11px] text-[#0F2A44]/60">
          {vazia
            ? "Nenhum registro para relacionar."
            : `${relacao.registros} ${relacao.registros === 1 ? "registro" : "registros"} · TOTAL ${formatBRL(
                relacao.total,
              )}`}
        </span>
      </div>
    </div>
  );
}
