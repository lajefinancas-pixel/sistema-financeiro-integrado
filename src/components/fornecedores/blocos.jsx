import React from "react";

/**
 * Peças de apresentação compartilhadas pelos blocos da "Vida do Fornecedor".
 *
 * São as mesmas caixas, campos e indicadores que a seção já usava -- ficam aqui
 * para que a lista de notas use exatamente a mesma moldura dos demais blocos.
 */

export function Bloco({ icone: Icone, titulo, acao, children }) {
  return (
    <section className="rounded-xl border border-black/5 bg-white print:break-inside-avoid">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-black/5">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#0F2A44]/50">
          <Icone size={13} /> {titulo}
        </h4>
        {acao}
      </div>
      <div className="px-3 py-3">{children}</div>
    </section>
  );
}

export function textoOuTraco(valor) {
  const texto = String(valor ?? "").trim();
  return texto === "" ? "--" : texto;
}

export function Campo({ rotulo, valor }) {
  return (
    <div>
      <div className="text-[11px] text-[#0F2A44]/45">{rotulo}</div>
      <div className="text-sm text-[#0F2A44] break-words">{textoOuTraco(valor)}</div>
    </div>
  );
}

export function Indicador({ rotulo, valor, destaque }) {
  return (
    <div className="rounded-lg border border-black/5 bg-black/[0.015] px-3 py-2">
      <div className="text-[11px] text-[#0F2A44]/45">{rotulo}</div>
      <div className={`text-sm tabular-nums text-[#0F2A44] ${destaque ? "font-semibold" : ""}`}>{valor}</div>
    </div>
  );
}

export function Vazio({ children }) {
  return <div className="text-xs text-[#0F2A44]/40">{children}</div>;
}
