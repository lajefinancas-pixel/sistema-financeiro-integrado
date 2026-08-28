import React from "react";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { formatBRL } from "../../lib/moeda";
import { mensagemAmigavel } from "../../lib/erros";
import { estornarBaixaDeNota } from "../../lib/baixasPagamentos";
import { validarEstorno } from "../../lib/regrasBaixas";
import { formatarData } from "../../lib/notasFornecedor";

/**
 * Estorno de uma baixa registrada.
 *
 * Baixa não se apaga: o estorno marca o registro original como estornado, com o
 * motivo e o autor, e devolve o valor para "em aberto" na nota. A baixa continua
 * no histórico da nota, na Vida do Fornecedor e na Auditoria.
 *
 * O motivo é obrigatório -- sem ele o botão não confirma.
 */
export default function ModalEstornarBaixa({ baixa, nota, nomeConta, onFechar, onConcluido }) {
  const [motivo, setMotivo] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const conferencia = validarEstorno(motivo);

  async function confirmar(evento) {
    evento.preventDefault();
    if (salvando) return;
    if (!conferencia.ok) {
      setErro(conferencia.mensagem);
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const retorno = await estornarBaixaDeNota(baixa.id, motivo);
      await onConcluido?.(retorno);
      onFechar?.();
    } catch (falha) {
      console.error("[Baixas] Não foi possível estornar a baixa.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível estornar a baixa. Tente novamente."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={confirmar} className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/5 px-5 py-4">
          <div>
            <h2 className="inline-flex items-center gap-2 font-semibold text-[#0F2A44]">
              <RotateCcw size={17} /> Estornar baixa
            </h2>
            <p className="mt-1 text-xs text-[#0F2A44]/55">
              {formatBRL(baixa?.valor_pago ?? 0)} · pago em {formatarData(baixa?.data_pagamento)}
              {nomeConta ? ` · ${nomeConta}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg p-2 text-[#0F2A44]/50 hover:bg-black/5"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block text-xs font-medium text-[#0F2A44]/70">
            Motivo do estorno
            <textarea
              value={motivo}
              onChange={(e) => {
                setErro(null);
                setMotivo(e.target.value);
              }}
              rows={3}
              maxLength={300}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              placeholder="Ex.: pagamento não confirmado pelo banco"
            />
          </label>

          <p className="rounded-lg bg-[#F4F7F9] px-3 py-2.5 text-[11px] leading-relaxed text-[#0F2A44]/70">
            O valor de {formatBRL(baixa?.valor_pago ?? 0)} volta para o em aberto
            {nota ? ` da nota ${nota}` : " da nota"}. A baixa original <strong>não é apagada</strong> — ela continua no
            histórico, agora marcada como estornada, com este motivo e o seu nome. O saldo da conta{" "}
            <strong>não é alterado</strong>.
          </p>

          {erro && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={15} className="shrink-0" />
              {erro}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-4">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg px-4 py-2.5 text-sm text-[#0F2A44]/70 hover:bg-black/5"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando || !conferencia.ok}
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
