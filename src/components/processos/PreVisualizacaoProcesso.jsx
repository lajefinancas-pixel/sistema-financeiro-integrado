import React from "react";
import { FileDown, Printer, X } from "lucide-react";
import {
  ESCOPOS,
  dadosDoDocumento,
  folhasDoEscopo,
  htmlDoProcesso,
} from "../../lib/processosDiariasDocumento.js";
import {
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  TITULO_PAGINA_3,
  tituloDoProcesso,
} from "../../lib/processosDiarias.js";

/**
 * A pré-visualização das três páginas antes de imprimir ou gerar o PDF.
 *
 * O que aparece aqui é O DOCUMENTO, não uma imitação dele: o HTML desenhado é
 * exatamente o que vai para a impressora, renderizado em um quadro isolado e
 * reduzido para caber na tela. Assim a folha vista é a folha impressa.
 *
 * Imprimir e gerar PDF não alteram o processo, não pagam nada e não debitam
 * conta nenhuma: só registram na trilha quem levou o papel para fora.
 *
 * A prestação de contas costuma estar em branco quando o processo é impresso —
 * ela é preenchida depois da viagem —, e isso não impede nada: a folha sai com
 * as linhas pautadas para ser preenchida à mão.
 */
export default function PreVisualizacaoProcesso({
  processo,
  secretarias = [],
  emissor = "",
  identidade = null,
  ocupado = false,
  onFechar,
  onImprimir,
  onGerarPdf,
}) {
  const [escopo, setEscopo] = React.useState("completo");

  // A emissão é fixada na abertura: a mesma data e hora na tela, na impressão e
  // no PDF daquela sessão de pré-visualização. A identidade visual entra aqui
  // como entra na impressão -- processo finalizado mostra a que ele congelou,
  // rascunho mostra a vigente --, então a folha vista é a folha impressa.
  const dados = React.useMemo(
    () => dadosDoDocumento(processo, { secretarias, emissor, identidade }),
    [processo, secretarias, emissor, identidade],
  );
  const html = React.useMemo(() => htmlDoProcesso(dados, { escopo }), [dados, escopo]);
  const folhas = folhasDoEscopo(escopo);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-3 py-6 sm:px-4 sm:py-8">
      <div className="w-full max-w-4xl rounded-2xl border border-black/5 bg-white shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">
              Pré-visualização
            </div>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-[#0F2A44]">
              {tituloDoProcesso(processo)}
            </h2>
            <p className="mt-0.5 text-xs text-[#0F2A44]/50">{legendaDasFolhas(folhas)}</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Cancelar"
            className="shrink-0 rounded-lg p-1.5 text-[#0F2A44]/40 hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* O que sai: o processo completo ou uma página só. */}
        <div className="flex flex-wrap gap-1.5 border-b border-black/5 px-5 py-3">
          {ESCOPOS.map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              onClick={() => setEscopo(opcao.id)}
              aria-pressed={escopo === opcao.id}
              className={`min-h-[2.25rem] rounded-lg px-3 py-2 text-[13px] transition-colors ${
                escopo === opcao.id
                  ? "bg-[#0F2A44] text-white"
                  : "border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
              }`}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>

        <div className="max-h-[62vh] overflow-y-auto bg-[#F5F3EF] px-3 py-4 sm:px-5">
          <Folhas html={html} paginas={folhas.length} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-black/5 px-5 py-4">
          <p className="mr-auto text-[11px] text-[#0F2A44]/45">
            Imprimir ou gerar o PDF não altera o processo e não paga nada — é papel.
          </p>
          <button
            type="button"
            onClick={onFechar}
            className="min-h-[2.5rem] rounded-lg border border-black/10 px-4 py-2 text-sm text-[#0F2A44]/70 hover:bg-black/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onGerarPdf?.(escopo)}
            disabled={ocupado}
            className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-[#0F2A44]/20 px-4 py-2 text-sm text-[#0F2A44] hover:bg-black/5 disabled:opacity-60"
          >
            <FileDown size={15} /> Gerar PDF
          </button>
          <button
            type="button"
            onClick={() => onImprimir?.(escopo)}
            disabled={ocupado}
            className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-60"
          >
            <Printer size={15} /> {escopo === "completo" ? "Imprimir processo completo" : "Imprimir"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * As folhas em um quadro isolado, reduzidas para caber na largura da tela.
 *
 * O documento tem 210mm de largura; o quadro é desenhado nesse tamanho e
 * encolhido por `transform: scale`, então o que se vê é a folha inteira, com a
 * proporção do papel, e não um recorte dela.
 */
function Folhas({ html, paginas }) {
  const caixaRef = React.useRef(null);
  const quadroRef = React.useRef(null);
  const [escala, setEscala] = React.useState(1);
  // 210mm x 297mm em pixels de CSS (96dpi), a medida do quadro desenhado.
  const largura = (210 / 25.4) * 96;
  const altura = (297 / 25.4) * 96 * paginas;

  React.useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return undefined;

    const medir = () => setEscala(Math.min(1, caixa.clientWidth / largura));
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caixa);
    return () => observador.disconnect();
  }, [largura]);

  React.useEffect(() => {
    const quadro = quadroRef.current;
    if (!quadro) return;
    const doc = quadro.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  return (
    <div ref={caixaRef} className="mx-auto w-full">
      <div style={{ height: altura * escala, overflow: "hidden" }}>
        <iframe
          ref={quadroRef}
          title="Pré-visualização do processo"
          aria-label="Pré-visualização do processo de diária"
          style={{
            width: largura,
            height: altura,
            border: 0,
            background: "#fff",
            transform: `scale(${escala})`,
            transformOrigin: "top left",
            boxShadow: "0 1px 3px rgba(15,42,68,.18)",
          }}
        />
      </div>
    </div>
  );
}

const TITULO_DA_FOLHA = {
  requisicao: TITULO_PAGINA_1,
  liquidacao: TITULO_PAGINA_2,
  prestacao: TITULO_PAGINA_3,
};

/**
 * A legenda do cabeçalho: quais folhas vão sair e em que ordem.
 *
 * A contagem é só desta tela, para quem confere antes de imprimir: o PAPEL NÃO
 * TRAZ NUMERAÇÃO DE FOLHA. A ordem é a que sai na impressora, porque cada
 * documento começa em folha nova.
 */
function legendaDasFolhas(folhas) {
  const partes = folhas.map(
    (folha, indice) => `Página ${indice + 1}: ${tituloCurto(TITULO_DA_FOLHA[folha] ?? "")}`,
  );
  if (partes.length <= 1) return `Uma página: ${tituloCurto(TITULO_DA_FOLHA[folhas[0]] ?? "")}.`;
  return `${partes.join(" · ")} — cada documento começa em folha nova.`;
}

function tituloCurto(titulo) {
  return titulo.charAt(0) + titulo.slice(1).toLowerCase();
}
