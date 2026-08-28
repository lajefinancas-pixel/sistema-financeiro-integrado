import React from "react";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { formatBRL } from "../../lib/moeda";
import { mensagemAmigavel } from "../../lib/erros";
import { estornarTransferencia } from "../../lib/transferenciasContas";

/**
 * Estorno de uma transferência efetivada.
 *
 * Transferência não se exclui: o estorno lança a movimentação inversa (o destino
 * devolve, a origem recebe) e a transferência original continua na razão, no
 * Histórico e na Auditoria. Os dois eventos ficam registrados.
 *
 * O motivo é obrigatório -- sem ele o botão não confirma.
 */
export default function ModalEstornoTransferencia({ transferencia, nomeConta, onFechar, onConcluido }) {
  const [motivo, setMotivo] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const motivoValido = motivo.trim().length > 0;

  async function confirmar(evento) {
    evento.preventDefault();
    if (!motivoValido) return setErro("Informe o motivo do estorno.");
    setSalvando(true);
    setErro(null);
    try {
      await estornarTransferencia(transferencia.id, motivo);
      await onConcluido?.();
      onFechar();
    } catch (falha) {
      console.error("[Pagamentos Fase 2] Erro ao estornar transferência.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível estornar a transferência."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={confirmar} className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/5 px-5 py-4">
          <div>
            <h2 className="inline-flex items-center gap-2 font-semibold text-[#17352F]">
              <RotateCcw size={17} /> Estornar transferência
            </h2>
            <p className="mt-1 text-xs text-[#17352F]/55">
              {formatBRL(transferencia?.valor ?? 0)} · {nomeConta?.(transferencia?.conta_origem_id) || "origem"} →{" "}
              {nomeConta?.(transferencia?.conta_destino_id) || "destino"}
            </p>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg p-2 text-[#17352F]/50 hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block text-xs font-medium text-[#17352F]/70">
            Motivo do estorno
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              placeholder="Ex.: conta de destino informada por engano"
            />
          </label>

          <p className="rounded-lg bg-[#F5F3EC] px-3 py-2.5 text-[11px] leading-relaxed text-[#17352F]/70">
            O estorno lança o movimento contrário: a conta que recebeu devolve o valor e a conta de origem volta ao saldo
            anterior. A transferência original <strong>não é apagada</strong> — ela continua na razão, no Histórico e na
            Auditoria, agora marcada como estornada.
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
            disabled={salvando || !motivoValido}
            className="inline-flex items-center gap-2 rounded-lg bg-[#8A321C] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#8A321C]/90 disabled:opacity-40"
          >
            <RotateCcw size={16} />
            {salvando ? "Estornando..." : "Confirmar estorno"}
          </button>
        </div>
      </form>
    </div>
  );
}
