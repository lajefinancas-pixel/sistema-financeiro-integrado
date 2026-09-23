import React from "react";
import { AlertTriangle, Copy, X } from "lucide-react";

export default function ModalDuplicarProgramacao({ programacao, salvando = false, conflito = 0, onFechar, onMudarData, onVerificar, onConfirmar }) {
  const [dataDestino, setDataDestino] = React.useState("");
  function enviar(evento) {
    evento.preventDefault();
    if (conflito > 0) onConfirmar(dataDestino);
    else onVerificar(dataDestino);
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102A26]/55 p-4 backdrop-blur-sm print:hidden" role="dialog" aria-modal="true" aria-labelledby="titulo-duplicar-programacao">
    <form onSubmit={enviar} className="w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-[#FFFDF8] shadow-2xl">
      <div className="flex items-start justify-between gap-4 bg-[var(--color-brand-navy)] px-5 py-4 text-white">
        <div><h2 id="titulo-duplicar-programacao" className="flex items-center gap-2 font-semibold"><Copy size={17}/> Duplicar programação</h2><p className="mt-1 text-xs text-white/60">{programacao?.nome_programacao || "Programação diária"}</p></div>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg p-1 text-white/65 hover:bg-white/10 hover:text-white"><X size={18}/></button>
      </div>
      <div className="space-y-4 p-5">
        <p className="text-sm leading-relaxed text-[var(--color-brand-navy)]/70">A nova programação recebe somente a secretaria e a lista editável de fornecedores e valores. Contas, saldos e marcações de pagamento não são copiados.</p>
        <label className="block text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)]/65">Data de destino<input type="date" required autoFocus value={dataDestino} onChange={(evento) => { setDataDestino(evento.target.value); onMudarData?.(); }} className="mt-1.5 block w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-base font-normal normal-case tracking-normal text-[var(--color-brand-navy)] outline-none focus:border-[#B06A3C] focus:ring-2 focus:ring-[#B06A3C]/15" /></label>
        {conflito > 0 && <div className="rounded-xl border border-[#B06A3C]/30 bg-[#FBF3EA] p-3 text-sm text-[#7B4326]"><p className="font-semibold"><AlertTriangle size={15} className="mr-1.5 inline"/> Já {conflito === 1 ? "existe uma programação" : `existem ${conflito} programações`} nessa data.</p><p className="mt-1 text-xs">Você pode criar outra mesmo assim ou trocar a data acima.</p></div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-black/5 bg-white px-5 py-3">
        <button type="button" onClick={onFechar} disabled={salvando} className="rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold text-[var(--color-brand-navy)] disabled:opacity-50">Cancelar</button>
        <button type="submit" disabled={salvando || !dataDestino} className="inline-flex items-center gap-1.5 rounded-lg bg-[#B06A3C] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Copy size={14}/>{salvando ? "Duplicando..." : conflito > 0 ? "Criar outra programação" : "Continuar"}</button>
      </div>
    </form>
  </div>;
}
