import React from "react";
import { Archive, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { tipoContaLabel } from "../../lib/contasBancarias";
import { formatBRL } from "../../lib/moeda";

function dataBR(iso) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

/**
 * Contas desativadas, em seção própria e recolhida — assim elas não poluem a
 * listagem principal, mas continuam à mão para consulta e para reativar.
 *
 * O último saldo lançado aparece ao lado de cada conta justamente para deixar
 * visível que desativar não apagou nada: o histórico segue inteiro no banco.
 */
export default function ContasDesativadas({ contas = [], podeReativar = false, onReativar }) {
  const [aberta, setAberta] = React.useState(false);
  if (contas.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-black/5 bg-white overflow-hidden print:hidden">
      <button
        type="button"
        onClick={() => setAberta((valor) => !valor)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[#0F2A44]/70">
          <Archive size={15} className="text-[#0F2A44]/35" />
          Contas desativadas
          <span className="text-xs font-medium text-[#0F2A44]/40">({contas.length})</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-[#0F2A44]/45">
          {aberta ? "Recolher" : "Mostrar"}
          {aberta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {aberta && (
        <div className="border-t border-black/5">
          <p className="px-4 py-3 text-xs text-[#0F2A44]/50 leading-relaxed">
            Estas contas não aparecem nas listas de seleção da Programação Diária nem nos
            lançamentos do dia. Os saldos e as movimentações delas continuam preservados e podem ser
            consultados em Histórico, Relatórios e Auditoria.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Secretaria</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Banco</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Número da Conta</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Nome da Conta</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Tipo</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Último saldo lançado</th>
                  <th className="px-4 py-2 font-medium text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((conta) => (
                  <tr key={conta.id} className="border-t border-black/5">
                    <td className="px-4 py-2.5 whitespace-nowrap text-[#0F2A44]/60">{conta.secretaria ?? "--"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{conta.banco ?? "--"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[#0F2A44]/60">{conta.numero_conta || "--"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{conta.nome_conta}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[#0F2A44]/60">
                      {tipoContaLabel(conta.tipo_conta)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-[#0F2A44]/70">
                      {conta.dataSaldo ? (
                        <>
                          {formatBRL(conta.saldo)}
                          <span className="ml-1.5 text-[11px] text-[#0F2A44]/40">em {dataBR(conta.dataSaldo)}</span>
                        </>
                      ) : (
                        <span className="text-[#0F2A44]/35">Sem lançamento</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {podeReativar && (
                        <button
                          type="button"
                          onClick={() => onReativar?.(conta)}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                          title="Reativar esta conta"
                        >
                          <RotateCcw size={13} /> Reativar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
