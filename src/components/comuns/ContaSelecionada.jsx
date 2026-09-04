import React from "react";
import { linhaDaConta } from "../../lib/contasBancariasBusca";

/**
 * A conta JÁ ESCOLHIDA, mostrada por extenso: Banco | Conta | Nome da Conta |
 * Secretaria.
 *
 * Serve para a pessoa conferir, sem depender da lista, qual conta ficou
 * registrada — inclusive quando o grupo daquela secretaria está recolhido ou a
 * busca está filtrando outra coisa.
 *
 * Mostrar a conta é conferência, não movimentação: este bloco só lê a conta
 * escolhida. Na Baixa, a conta é o registro de qual conta pagou e NÃO debita o
 * saldo dela.
 *
 * @param conta       conta cadastrada já escolhida (nada é exibido sem ela)
 * @param rotulo      título do bloco ("Conta utilizada", "Conta de destino"...)
 * @param complemento texto extra da tela (ex.: saldo na transferência)
 */
export default function ContaSelecionada({ conta, rotulo = "Conta selecionada", complemento = null, className = "" }) {
  if (!conta) return null;
  const linha = linhaDaConta(conta);

  return (
    <div className={`rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-black/45">{rotulo}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
        <Campo rotulo="Banco" valor={linha.banco} />
        <Campo rotulo="Conta" valor={linha.numero_conta} numerico />
        <Campo rotulo="Nome da Conta" valor={linha.nome_conta} />
        <Campo rotulo="Secretaria" valor={linha.secretaria} />
      </dl>
      {complemento && <p className="mt-1.5 text-[11px] font-normal text-black/55">{complemento}</p>}
    </div>
  );
}

function Campo({ rotulo, valor, numerico = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-medium uppercase tracking-[0.06em] text-black/40">{rotulo}</dt>
      <dd className={`truncate font-semibold text-black/75 ${numerico ? "tabular-nums" : ""}`} title={valor}>
        {valor}
      </dd>
    </div>
  );
}
