import React from "react";
import { AlertTriangle, ArrowLeftRight, Check, RotateCcw, Wallet } from "lucide-react";
import { formatBRL } from "../../lib/moeda";
import { contasAtribuiveis, resumoExecucao } from "../../lib/execucaoProgramacao";
import SeletorContas from "../comuns/SeletorContas";

/**
 * Etapa de execução da programação aprovada.
 *
 * A conta é definida POR PAGAMENTO -- não existe conta única obrigatória para a
 * programação inteira. Fornecedor A pode sair da Conta A e o fornecedor B da
 * Conta B, na mesma programação.
 *
 * Só aparecem no seletor as contas da secretaria da programação que estão entre
 * as contas de trabalho selecionadas.
 *
 * ATRIBUIR CONTA NÃO DEBITA CONTA: o vínculo é só o roteiro do pagamento. O
 * débito acontece na baixa. A única operação desta etapa que movimenta saldo é a
 * transferência entre contas confirmada.
 */
export default function PainelExecucaoProgramacao({
  programacao,
  pagamentos = [],
  contas = [],
  contasSelecionadas,
  secretariaId,
  nomePagamento,
  transferencias = [],
  permissoes = {},
  salvando = false,
  onDefinirConta,
  onAplicarATodos,
  onAtribuirAosSelecionados,
  onTransferir,
  onEstornar,
}) {
  const [marcados, setMarcados] = React.useState(() => new Set());
  const [contaEmLote, setContaEmLote] = React.useState("");

  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas, secretariaId });
  const resumo = resumoExecucao(pagamentos, disponiveis);
  const podeDefinir = permissoes.definir_conta_pagamento !== false && permissoes.executar_programacao !== false;
  const nomeDaConta = React.useCallback(
    (contaId) => contas.find((conta) => String(conta.id) === String(contaId))?.nome_conta || `Conta ${contaId ?? "--"}`,
    [contas]
  );

  function alternarMarcado(id) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  return (
    <section className="rounded-2xl border border-black/5 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 px-4 py-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[#17352F]">
            <Wallet size={16} /> Execução da programação
          </h2>
          <p className="mt-1 text-[11px] text-[#17352F]/55">
            Defina a conta de cada pagamento. Definir a conta não debita nada — o débito acontece na baixa.
          </p>
        </div>
        <button
          type="button"
          onClick={onTransferir}
          disabled={permissoes.executar_transferencia === false}
          className="inline-flex items-center gap-2 rounded-lg border border-[#17352F]/15 px-3 py-2 text-xs font-medium text-[#17352F] hover:bg-[#E5EFEA] disabled:opacity-40"
          title={
            permissoes.executar_transferencia === false
              ? "Você não tem permissão para transferir entre contas."
              : "Transferir entre contas"
          }
        >
          <ArrowLeftRight size={14} /> Transferir entre contas
        </button>
      </div>

      {disponiveis.length === 0 && (
        <p className="mx-4 mt-3 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs text-[#8A321C]">
          Nenhuma conta de trabalho desta secretaria está disponível para atribuição. Reabra a programação e selecione as
          contas antes de executar.
        </p>
      )}

      {/* Atribuição em lote: marcar vários e aplicar de uma vez, ou aplicar a
          todos. Depois disso a troca individual continua possível. */}
      <div className="flex flex-wrap items-end gap-2 px-4 py-3">
        <div className="min-w-[220px] flex-1 text-[11px] font-medium text-[#17352F]/60">
          Conta para atribuição
          {/* Contas de trabalho já confirmadas, com busca e agrupadas por
              Secretaria. Atribuir conta ao pagamento é registro de qual conta
              paga: não debita, não reserva e não altera saldo. */}
          <SeletorContas
            className="mt-1"
            contas={disponiveis}
            modo="unica"
            valor={contaEmLote}
            onEscolher={(conta) => setContaEmLote(String(conta.id))}
            desabilitado={!podeDefinir}
            altura="max-h-[200px]"
            vazio="Nenhuma conta de trabalho confirmada para esta programação."
          />
        </div>
        <button
          type="button"
          onClick={() => onAtribuirAosSelecionados?.([...marcados], Number(contaEmLote)).then(() => setMarcados(new Set()))}
          disabled={!podeDefinir || salvando || !contaEmLote || marcados.size === 0}
          className="rounded-lg bg-[#17352F] px-3 py-2 text-xs font-medium text-white hover:bg-[#17352F]/90 disabled:opacity-40"
        >
          Atribuir conta aos selecionados ({marcados.size})
        </button>
        <button
          type="button"
          onClick={() => onAplicarATodos?.(Number(contaEmLote))}
          disabled={!podeDefinir || salvando || !contaEmLote || pagamentos.length === 0}
          className="rounded-lg border border-[#17352F]/15 px-3 py-2 text-xs font-medium text-[#17352F] hover:bg-[#E5EFEA] disabled:opacity-40"
        >
          Aplicar conta a todos
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto border-t border-black/5">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F5F3EC] text-[11px] uppercase tracking-wide text-[#17352F]/60">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Marcar todos os pagamentos"
                  checked={pagamentos.length > 0 && marcados.size === pagamentos.length}
                  onChange={(e) => setMarcados(e.target.checked ? new Set(pagamentos.map((p) => p.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 text-left font-medium">Conta do pagamento</th>
            </tr>
          </thead>
          <tbody>
            {pagamentos.map((pagamento) => (
              <tr key={pagamento.id} className="border-t border-black/5">
                <td className="px-3 py-2 align-middle">
                  <input
                    type="checkbox"
                    aria-label={`Marcar ${nomePagamento?.(pagamento) ?? "pagamento"}`}
                    checked={marcados.has(pagamento.id)}
                    onChange={() => alternarMarcado(pagamento.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="block truncate text-[#17352F]">{nomePagamento?.(pagamento)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-[#17352F]">
                  {formatBRL(pagamento.valor_a_pagar)}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={pagamento.conta_origem_id ?? ""}
                    onChange={(e) => onDefinirConta?.(pagamento, e.target.value ? Number(e.target.value) : null)}
                    disabled={!podeDefinir || salvando || disponiveis.length === 0}
                    className={`w-full rounded-lg border px-2.5 py-1.5 text-xs disabled:bg-black/[0.03] ${
                      pagamento.conta_origem_id ? "border-black/10 bg-white" : "border-[#B98C55]/50 bg-[#F5F3EC]"
                    }`}
                  >
                    <option value="">Definir conta...</option>
                    {disponiveis.map((conta) => (
                      <option key={conta.id} value={conta.id}>
                        {conta.nome_conta} · saldo {formatBRL(conta.saldo ?? 0)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {pagamentos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs text-[#17352F]/50">
                  Nenhum fornecedor nesta programação.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 border-t border-black/5 px-4 py-3 sm:grid-cols-3">
        <Tile rotulo="Com conta definida" valor={`${resumo.comConta} de ${pagamentos.length}`} />
        <Tile rotulo="Sem conta definida" valor={String(resumo.semConta)} />
        <Tile rotulo="Total da execução" valor={formatBRL(resumo.total)} destaque />
      </div>

      {resumo.distribuicao.length > 0 && (
        <ul className="space-y-1 px-4 pb-3 text-xs text-[#17352F]/75">
          {resumo.distribuicao.map((item) => (
            <li
              key={item.contaId}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                item.acimaDoSaldo ? "bg-[#FBE9DF] text-[#8A321C]" : "bg-[#F5F3EC]"
              }`}
            >
              <span className="truncate">
                {item.nome} · {item.quantidade} pagamento{item.quantidade === 1 ? "" : "s"}
              </span>
              <span className="shrink-0">
                {formatBRL(item.total)} de {formatBRL(item.saldo)}
                {item.acimaDoSaldo && " · saldo insuficiente"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {resumo.contasAcimaDoSaldo.length > 0 && (
        <p className="mx-4 mb-3 flex gap-2 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs text-[#8A321C]">
          <AlertTriangle size={15} className="shrink-0" />
          Há conta com pagamentos acima do saldo. Use a transferência entre contas para reforçar o saldo antes da baixa —
          a atribuição por si só não debita nada.
        </p>
      )}

      {/* Razão das transferências desta programação. Estornada continua na
          lista: transferência não se exclui, se estorna. */}
      <div className="border-t border-black/5 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#17352F]/60">Transferências da programação</h3>
        {transferencias.length === 0 ? (
          <p className="mt-2 text-xs text-[#17352F]/50">Nenhuma transferência registrada nesta programação.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {transferencias.map((item) => (
              <li key={item.id} className="rounded-lg border border-black/5 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[#17352F]">
                    <strong>{formatBRL(item.valor)}</strong> · {nomeDaConta(item.conta_origem_id)} →{" "}
                    {nomeDaConta(item.conta_destino_id)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Etiqueta status={item.status} />
                    {item.status === "confirmada" && permissoes.estornar_transferencia !== false && (
                      <button
                        type="button"
                        onClick={() => onEstornar?.(item)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#8A321C] hover:bg-[#FBE9DF]"
                      >
                        <RotateCcw size={12} /> Estornar
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#17352F]/55">
                  {new Date(item.criado_em).toLocaleString("pt-BR")} · {item.usuario_nome} · id {item.id}
                  {item.saldo_origem_antes != null && (
                    <>
                      {" "}
                      · origem {formatBRL(item.saldo_origem_antes)} → {formatBRL(item.saldo_origem_depois)}
                    </>
                  )}
                  {item.saldo_destino_antes != null && (
                    <>
                      {" "}
                      · destino {formatBRL(item.saldo_destino_antes)} → {formatBRL(item.saldo_destino_depois)}
                    </>
                  )}
                </p>
                {item.observacao && <p className="mt-0.5 text-[11px] text-[#17352F]/55">{item.observacao}</p>}
                {item.motivo_estorno && (
                  <p className="mt-0.5 text-[11px] text-[#8A321C]">Motivo do estorno: {item.motivo_estorno}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-[#17352F]/45">
          Transferência entre contas próprias não é despesa e não aparece em relatório de pagamento. Uma transferência
          efetivada não é excluída: ela é estornada, e as duas operações ficam no histórico.
        </p>
      </div>
    </section>
  );
}

function Etiqueta({ status }) {
  if (status === "estornada") {
    return <span className="rounded-full bg-[#FBE9DF] px-2 py-0.5 text-[10px] font-medium text-[#8A321C]">ESTORNADA</span>;
  }
  if (status === "estorno") {
    return <span className="rounded-full bg-[#F5F3EC] px-2 py-0.5 text-[10px] font-medium text-[#B06A3C]">ESTORNO</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E5EFEA] px-2 py-0.5 text-[10px] font-medium text-[#17352F]">
      <Check size={10} /> CONFIRMADA
    </span>
  );
}

function Tile({ rotulo, valor, destaque = false }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${destaque ? "bg-[#17352F] text-white" : "bg-[#F5F3EC] text-[#17352F]"}`}>
      <span className="text-[11px] uppercase tracking-wide opacity-70">{rotulo}</span>
      <strong className="block text-base">{valor}</strong>
    </div>
  );
}
