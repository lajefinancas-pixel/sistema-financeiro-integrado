import React from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { formatBRL } from "../../lib/moeda";

/**
 * Conferência antes de aprovar a programação diária.
 *
 * O aviso do rodapé não é enfeite: é a regra da fase. APROVADO NÃO É PAGO. A
 * aprovação troca o status e registra a conferência; ela não debita conta, não
 * dá baixa em nota, não altera saldo de fornecedor e não marca nota como paga.
 * Nenhum saldo se move aqui.
 */
export default function ModalAprovacaoProgramacao({ resumo, programacao, salvando = false, onFechar, onConfirmar }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/5 px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#17352F]">Aprovar programação</h2>
            <p className="mt-1 text-xs text-[#17352F]/55">{programacao?.nome_programacao || "Programação diária"}</p>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg p-2 text-[#17352F]/50 hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Tile rotulo="Contas selecionadas" valor={String(resumo.quantidadeContas)} />
            <Tile rotulo="Saldo disponível" valor={formatBRL(resumo.saldoDisponivel)} />
            <Tile rotulo="Fornecedores" valor={String(resumo.quantidadeFornecedores)} />
            <Tile rotulo="Total aprovado" valor={formatBRL(resumo.totalAprovado)} destaque />
          </div>

          <div
            className={`rounded-xl px-4 py-3 ${
              resumo.restante < 0 ? "bg-[#FBE9DF] text-[#8A321C]" : "bg-[#E5EFEA] text-[#17352F]"
            }`}
          >
            <span className="text-[11px] uppercase tracking-wide opacity-70">Restante</span>
            <strong className="block text-lg">{formatBRL(resumo.restante)}</strong>
          </div>

          {resumo.contas?.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-black/5 p-2 text-xs text-[#17352F]/75">
              {resumo.contas.map((conta) => (
                <li key={conta.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {conta.nome_conta} · {conta.banco} · {conta.numero_conta || "sem número"}
                  </span>
                  <strong className="shrink-0">{formatBRL(conta.saldo ?? conta.saldoDisponivel ?? 0)}</strong>
                </li>
              ))}
            </ul>
          )}

          {resumo.acimaDoSaldo && (
            <div className="flex gap-2 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs text-[#8A321C]">
              <AlertTriangle size={15} className="shrink-0" />
              O total programado está acima do saldo disponível das contas selecionadas. A aprovação continua
              permitida — mas será preciso transferir entre contas antes de pagar.
            </div>
          )}

          <p className="rounded-lg bg-[#F5F3EC] px-3 py-2.5 text-[11px] leading-relaxed text-[#17352F]/70">
            <strong>Aprovar não é pagar.</strong> A aprovação não debita conta, não dá baixa em nota fiscal, não altera
            saldo de fornecedor e não marca nota como paga. Nenhum saldo se move nesta etapa: a programação passa para
            <em> aprovada / aguardando execução</em>.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-4">
          <button type="button" onClick={onFechar} className="rounded-lg px-4 py-2.5 text-sm text-[#17352F]/70 hover:bg-black/5">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={salvando}
            className="inline-flex items-center gap-2 rounded-lg bg-[#17352F] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#17352F]/90 disabled:opacity-40"
          >
            <Check size={16} />
            {salvando ? "Aprovando..." : "Confirmar aprovação"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({ rotulo, valor, destaque = false }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${destaque ? "bg-[#17352F] text-white" : "bg-[#F5F3EC] text-[#17352F]"}`}>
      <span className="text-[11px] uppercase tracking-wide opacity-70">{rotulo}</span>
      <strong className="block text-lg">{valor}</strong>
    </div>
  );
}
