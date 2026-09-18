import React from "react";
import { FileDown, Printer, X } from "lucide-react";
import { formatarData, listarCertidoesDoFornecedor, situacaoEfetiva, situacaoInfo, urlDeDownload } from "../../lib/certidoes.js";
import {
  ESCOPOS,
  dadosDoDocumento,
  folhasDoEscopo,
  htmlDoProcesso,
} from "../../lib/processosServicosDocumento.js";
import {
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  tituloDoProcesso,
} from "../../lib/processosServicos.js";

/**
 * A pré-visualização das duas páginas antes de imprimir ou gerar o PDF.
 *
 * O que aparece aqui é O DOCUMENTO, não uma imitação dele: o HTML desenhado é
 * exatamente o que vai para a impressora, renderizado em um quadro isolado e
 * reduzido para caber na tela. Assim a folha vista é a folha impressa.
 *
 * Imprimir e gerar PDF não alteram o processo, não pagam nada e não debitam
 * conta nenhuma: só registram na trilha quem levou o papel para fora.
 *
 * A liquidação pode estar em branco quando a requisição é impressa -- ela é
 * preenchida depois, quando o serviço é prestado ou o material entregue --, e
 * isso não impede nada: quem quer só a primeira folha escolhe o escopo dela.
 */
export default function PreVisualizacaoProcessoServico({
  processo,
  secretarias = [],
  emissor = "",
  identidade = null,
  logoSistema = null,
  prefeita = null,
  ocupado = false,
  podeVisualizarCertidoes = false,
  onFechar,
  onImprimir,
  onGerarPdf,
}) {
  const [escopo, setEscopo] = React.useState("completo");
  const [certidoes, setCertidoes] = React.useState([]);
  const [selecionadas, setSelecionadas] = React.useState(new Set());
  const [carregandoCertidoes, setCarregandoCertidoes] = React.useState(false);
  const [erroCertidoes, setErroCertidoes] = React.useState("");

  React.useEffect(() => {
    let ativo = true;
    if (!podeVisualizarCertidoes || !processo?.fornecedor_id) return undefined;
    setCarregandoCertidoes(true);
    setErroCertidoes("");
    listarCertidoesDoFornecedor(processo.fornecedor_id)
      .then((lista) => {
        if (!ativo) return;
        const comArquivo = lista.filter((item) => item.arquivo_url);
        setCertidoes(comArquivo);
        setSelecionadas(new Set(comArquivo.filter((item) => ["valida", "sem_vencimento"].includes(situacaoEfetiva(item))).map((item) => String(item.id))));
      })
      .catch(() => ativo && setErroCertidoes("Não foi possível consultar as certidões agora."))
      .finally(() => ativo && setCarregandoCertidoes(false));
    return () => { ativo = false; };
  }, [podeVisualizarCertidoes, processo?.fornecedor_id]);

  const certidoesEscolhidas = certidoes.filter((item) => selecionadas.has(String(item.id))).map((item) => ({
    id: item.id,
    nome: item.tipos_certidao?.nome || "Certidão",
    vencida: situacaoEfetiva(item) === "vencida",
  }));

  // A emissão é fixada na abertura: a mesma data e hora na tela, na impressão e
  // no PDF daquela sessão de pré-visualização. A identidade visual entra aqui
  // como entra na impressão -- processo finalizado mostra a que ele congelou,
  // rascunho mostra a vigente --, então a folha vista é a folha impressa.
  const dados = React.useMemo(
    () => dadosDoDocumento(processo, { secretarias, emissor, identidade, logoSistema, prefeita }),
    [processo, secretarias, emissor, identidade, logoSistema, prefeita],
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

        {/* O que sai: o processo completo ou um documento só. */}
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
          {podeVisualizarCertidoes && processo?.fornecedor_id && (
            <section className="mx-auto mt-4 max-w-[794px] rounded-xl border border-[#0F2A44]/10 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F2A44]">Certidões anexadas ao PDF</h3>
                  <p className="mt-1 text-xs text-[#0F2A44]/55">Válidas vêm marcadas. “A vencer” e vencidas entram somente por escolha.</p>
                </div>
                {certidoes.length > 0 && (
                  <details className="relative shrink-0 text-xs">
                    <summary className="cursor-pointer rounded-lg border border-black/10 px-2.5 py-1.5 text-[#0F2A44]/70">Downloads individuais</summary>
                    <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-black/10 bg-white p-2 shadow-lg">
                      {certidoes.map((item) => <a key={item.id} className="block truncate rounded px-2 py-1.5 text-[#0F2A44] hover:bg-black/5" href={urlDeDownload(item.arquivo_url)}>{item.tipos_certidao?.nome || "Certidão"}</a>)}
                    </div>
                  </details>
                )}
              </div>
              {carregandoCertidoes ? <p className="mt-3 text-xs text-[#0F2A44]/50">Consultando certidões...</p> : erroCertidoes ? <p className="mt-3 text-xs text-red-700">{erroCertidoes}</p> : certidoes.length === 0 ? <p className="mt-3 text-xs text-[#0F2A44]/50">Nenhuma certidão com arquivo disponível.</p> : (
                <div className="mt-3 space-y-2">
                  {certidoes.map((item) => {
                    const situacao = situacaoEfetiva(item);
                    const info = situacaoInfo(situacao);
                    return <label key={item.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${situacao === "vencida" ? "border-red-200 bg-red-50" : "border-black/10"}`}>
                      <input type="checkbox" checked={selecionadas.has(String(item.id))} onChange={(evento) => setSelecionadas((atual) => { const proximo = new Set(atual); evento.target.checked ? proximo.add(String(item.id)) : proximo.delete(String(item.id)); return proximo; })} />
                      <span className="min-w-0 flex-1 truncate text-sm text-[#0F2A44]">{item.tipos_certidao?.nome || "Certidão"}</span>
                      <span className="text-xs font-medium" style={{ color: info.cor }}>{info.label}</span>
                      <span className="text-xs text-[#0F2A44]/45">{formatarData(item.data_vencimento)}</span>
                    </label>;
                  })}
                </div>
              )}
            </section>
          )}
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
            onClick={() => onGerarPdf?.(escopo, certidoesEscolhidas)}
            disabled={ocupado || carregandoCertidoes}
            className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-[#0F2A44]/20 px-4 py-2 text-sm text-[#0F2A44] hover:bg-black/5 disabled:opacity-60"
          >
            <FileDown size={15} /> Gerar PDF
          </button>
          <button
            type="button"
            onClick={() => onImprimir?.(escopo, certidoesEscolhidas)}
            disabled={ocupado || carregandoCertidoes}
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
 *
 * A altura é uma ESTIMATIVA de uma folha por documento. Requisição com muitos
 * itens continua na folha seguinte e a rolagem do quadro mostra o resto -- a
 * folha extra aparece na impressão e no PDF de qualquer maneira.
 */
function Folhas({ html, paginas }) {
  const caixaRef = React.useRef(null);
  const quadroRef = React.useRef(null);
  const [escala, setEscala] = React.useState(1);
  const [folhasVistas, setFolhasVistas] = React.useState(paginas);
  // 210mm x 297mm em pixels de CSS (96dpi), a medida do quadro desenhado.
  const largura = (210 / 25.4) * 96;
  const alturaDaFolha = (297 / 25.4) * 96;
  const altura = alturaDaFolha * Math.max(paginas, folhasVistas);

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
    setFolhasVistas(paginas);
    const quadro = quadroRef.current;
    if (!quadro) return;
    const doc = quadro.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    // Quantas folhas o conteúdo realmente ocupou: com muitos itens a requisição
    // passa de uma, e o quadro cresce para mostrar tudo.
    const medido = doc.body?.scrollHeight ?? 0;
    if (medido > 0) setFolhasVistas(Math.max(paginas, Math.ceil(medido / alturaDaFolha - 0.02)));
  }, [html, paginas, alturaDaFolha]);

  return (
    <div ref={caixaRef} className="mx-auto w-full">
      <div style={{ height: altura * escala, overflow: "hidden" }}>
        <iframe
          ref={quadroRef}
          title="Pré-visualização do processo"
          aria-label="Pré-visualização do processo de serviços e materiais"
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
};

/**
 * A legenda do cabeçalho: quais folhas vão sair e em que ordem.
 *
 * A contagem é só desta tela, para quem confere antes de imprimir: o PAPEL NÃO
 * TRAZ NUMERAÇÃO DE FOLHA e também não traz o número do processo. A ordem é a
 * que sai na impressora, porque cada documento começa em folha nova.
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
