import React from "react";
import { Eraser, ShieldCheck } from "lucide-react";
import { ModalShell } from "../equipe/comuns";

/**
 * Confirmação do botão "Limpar campos".
 *
 * Limpar campos é uma ação exclusivamente visual: esvazia os campos de saldo na
 * tela para o lançamento do dia. Nada é gravado, alterado ou apagado em
 * public.saldos_historico — nenhum delete, nenhum update, nenhum insert. Os
 * saldos anteriores continuam íntegros mesmo que a tela seja fechada sem salvar.
 *
 * A confirmação existe só para evitar o clique acidental no meio do
 * preenchimento.
 */
export default function ModalLimparCampos({ quantidade = 0, onCancelar, onConfirmar }) {
  return (
    <ModalShell
      titulo="Limpar campos de saldo"
      subtitulo="Apenas na tela, para começar o lançamento do dia."
      largura="max-w-md"
      onFechar={onCancelar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90"
          >
            <Eraser size={15} /> Limpar campos
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[#0F2A44]">
          Esvaziar {quantidade > 0 ? <strong>{quantidade}</strong> : "os"} campo
          {quantidade === 1 ? "" : "s"} de saldo desta secretaria, deixando-os prontos para
          digitação?
        </p>

        <div className="flex items-start gap-2.5 rounded-xl border border-[#16A34A]/25 bg-[#EAFBF0] px-4 py-3 text-[#15803D]">
          <ShieldCheck size={15} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed">
            Nada é apagado do banco. Os saldos já lançados e o histórico de datas anteriores
            continuam exatamente como estão — os campos ficam vazios só aqui na tela. Se você sair
            sem salvar, nada muda.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
