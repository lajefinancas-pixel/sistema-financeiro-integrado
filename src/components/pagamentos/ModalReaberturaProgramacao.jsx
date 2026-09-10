import React from "react";
import { AlertTriangle, Unlock, X } from "lucide-react";
import {
  JUSTIFICATIVA_MINIMA_REABERTURA,
  avisosDaReabertura,
  justificativaReaberturaValida,
} from "../../lib/execucaoProgramacao";

/**
 * Confirmação da reabertura de uma programação aprovada.
 *
 * REABRIR É DESFAZER A APROVAÇÃO, NÃO OS DADOS. A programação volta para "em
 * elaboração" e fica editável outra vez; contas, fornecedores, valores, saldos
 * congelados, baixas, transferências e saldos das contas continuam exatamente
 * como estão.
 *
 * A justificativa é obrigatória e fica registrada na Auditoria em nível
 * crítico. Baixa registrada e transferência vinculada geram AVISO -- nunca
 * bloqueio: reabrir não desfaz nenhuma delas, e cada uma tem estorno próprio.
 */
export default function ModalReaberturaProgramacao({
  programacao,
  vinculos = { baixas: 0, transferencias: 0 },
  salvando = false,
  onFechar,
  onConfirmar,
}) {
  const [justificativa, setJustificativa] = React.useState("");
  const [erro, setErro] = React.useState(null);
  const avisos = avisosDaReabertura(vinculos);
  const justificativaOk = justificativaReaberturaValida(justificativa);
  const restam = Math.max(0, JUSTIFICATIVA_MINIMA_REABERTURA - justificativa.trim().length);

  async function confirmar(evento) {
    evento.preventDefault();
    if (!justificativaOk) {
      return setErro(
        `Escreva a justificativa da reabertura, com pelo menos ${JUSTIFICATIVA_MINIMA_REABERTURA} caracteres. Ela fica registrada na Auditoria.`
      );
    }
    setErro(null);
    await onConfirmar?.(justificativa.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={confirmar} className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/5 px-5 py-4">
          <div>
            <h2 className="inline-flex items-center gap-2 font-semibold text-[#17352F]">
              <Unlock size={17} /> Reabrir programação
            </h2>
            <p className="mt-1 text-xs text-[#17352F]/55">{programacao?.nome_programacao || "Programação diária"}</p>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg p-2 text-[#17352F]/50 hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="rounded-lg bg-[#E5EFEA] px-3 py-2.5 text-[12px] leading-relaxed text-[#17352F]">
            A programação <strong>volta para “em elaboração” e fica editável outra vez</strong>: contas, fornecedores e
            valores podem ser alterados, e depois ela precisa ser aprovada de novo para voltar a aguardar execução.
          </p>

          <label className="block text-xs font-medium text-[#17352F]/70">
            Justificativa da reabertura <span className="text-[#8A321C]">(obrigatória)</span>
            <textarea
              value={justificativa}
              onChange={(evento) => setJustificativa(evento.target.value)}
              rows={3}
              autoFocus
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              placeholder="Ex.: o gestor pediu a retirada de um fornecedor e o ajuste do valor de outro"
            />
            <span className="mt-1 block text-[11px] text-[#17352F]/55">
              {restam > 0
                ? `Faltam ${restam} caractere(s) para o mínimo de ${JUSTIFICATIVA_MINIMA_REABERTURA}.`
                : "Fica registrada na Auditoria, em nível crítico, com o seu nome e a data."}
            </span>
          </label>

          {avisos.map((aviso) => (
            <div
              key={aviso}
              className="flex gap-2 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs leading-relaxed text-[#8A321C]"
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {aviso}
            </div>
          ))}

          <p className="rounded-lg bg-[#F5F3EC] px-3 py-2.5 text-[11px] leading-relaxed text-[#17352F]/70">
            <strong>Reabrir não desfaz nada.</strong> Nenhum dado é apagado ou recalculado: contas de trabalho,
            fornecedores, valores, conta de cada pagamento, saldos congelados da programação, baixas registradas,
            transferências e os saldos reais das contas continuam como estão. A aprovação anterior <strong>não é
            apagada do histórico</strong> — ela continua na Auditoria como fato ocorrido, e a reabertura entra como um
            novo evento.
          </p>

          {erro && (
            <div className="flex gap-2 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs text-[#8A321C]">
              <AlertTriangle size={15} className="shrink-0" />
              {erro}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-4">
          <button type="button" onClick={onFechar} className="rounded-lg px-4 py-2.5 text-sm text-[#17352F]/70 hover:bg-black/5">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando || !justificativaOk}
            className="inline-flex items-center gap-2 rounded-lg bg-[#8A321C] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#8A321C]/90 disabled:opacity-40"
          >
            <Unlock size={16} />
            {salvando ? "Reabrindo..." : "Confirmar reabertura"}
          </button>
        </div>
      </form>
    </div>
  );
}
