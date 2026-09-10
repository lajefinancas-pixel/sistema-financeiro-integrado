import React from "react";
import { Link2, Link2Off, Search, X } from "lucide-react";
import { formatBRL } from "../../../lib/moeda.js";
import {
  descricaoDaNota,
  numeroDaNota,
  valorBaixadoDaNota,
  valorDaNota,
  valorEmAbertoDaNota,
} from "../../../lib/regrasBaixas.js";
import {
  resumoFinanceiroDoRegistro,
  situacaoAreaInfo,
} from "../../../lib/areasFornecedores.js";
import {
  complementoDoFornecedor,
  nomeExibicaoDoFornecedor,
} from "../../../lib/nomesFornecedor.js";

/**
 * Detalhe de um registro de área: os dados dele, o Pago e o Saldo abertos nota
 * por nota, e o vínculo com NFs/processos.
 *
 * O Pago mostrado aqui é a SOMA DAS BAIXAS das NFs vinculadas — o mesmo número,
 * lido da mesma coluna, que a aba de Baixas mostra em cada nota. Não há valor
 * pago gravado no registro para poder divergir.
 *
 * Vincular exige uma NF/processo que já exista para aquele fornecedor: nenhuma
 * nota é criada aqui, e nenhuma baixa é registrada, alterada ou estornada.
 * Desvincular apaga só a linha do vínculo — a nota, o valor em aberto e as
 * baixas dela continuam intactos.
 */
export default function ModalNotasDoRegistro({
  area,
  registro,
  notasDoFornecedor = [],
  carregandoNotas = false,
  podeEditar = false,
  erro = null,
  ocupado = false,
  onFechar,
  onVincular,
  onDesvincular,
}) {
  const [busca, setBusca] = React.useState("");
  const resumo = resumoFinanceiroDoRegistro(registro);
  const vinculadas = Array.isArray(registro?.notas) ? registro.notas : [];
  const idsVinculados = new Set(vinculadas.map((nota) => String(nota.id)));
  const situacao = situacaoAreaInfo(registro?.situacao);
  const fornecedor = registro?.fornecedores ?? null;

  const disponiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return notasDoFornecedor
      .filter((nota) => !idsVinculados.has(String(nota.id)))
      .filter((nota) => termo === "" || descricaoDaNota(nota).toLowerCase().includes(termo));
    // idsVinculados vem de registro.notas, que já está na lista de dependências.
  }, [notasDoFornecedor, busca, registro?.notas]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="w-full max-w-3xl rounded-2xl border border-black/5 bg-white shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[#0F2A44]">
              {registro?.[area.campoTitulo] || `(${area.singular} sem nome)`}
            </h2>
            <p className="truncate text-xs text-[#0F2A44]/50">
              {nomeExibicaoDoFornecedor(fornecedor)}
              {complementoDoFornecedor(fornecedor) && ` — ${complementoDoFornecedor(fornecedor)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            className="rounded-lg p-1.5 text-[#0F2A44]/40 hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-4">
          {erro && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {erro}
            </div>
          )}

          {/* Valor, Pago e Saldo. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Caixa rotulo="Valor do registro" valor={formatBRL(resumo.valor)} />
            <Caixa
              rotulo="Pago (baixas das NFs)"
              valor={formatBRL(resumo.pago)}
              nota={
                vinculadas.length === 0
                  ? "Nenhuma NF vinculada"
                  : `${vinculadas.length} ${vinculadas.length === 1 ? "NF vinculada" : "NFs vinculadas"}`
              }
            />
            <Caixa
              rotulo="Saldo"
              valor={formatBRL(resumo.saldo)}
              destaque={resumo.saldo < 0 ? "#DC2626" : undefined}
              nota={resumo.saldo < 0 ? "As baixas passaram do valor do registro" : undefined}
            />
          </div>

          {/* Os dados do registro. */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-black/5 bg-[#F8FAFC] px-4 py-3 sm:grid-cols-2">
            <Dado rotulo="Secretaria" valor={registro?.secretarias?.nome} />
            <Dado
              rotulo="Situação"
              valor={
                <span
                  className="inline-flex rounded-full px-2 py-0.5 text-[11px]"
                  style={{ backgroundColor: situacao.bg, color: situacao.cor }}
                >
                  {situacao.label}
                </span>
              }
            />
            {area.campos
              .filter((campo) => !["situacao", "observacoes"].includes(campo.chave))
              .filter((campo) => campo.chave !== area.campoTitulo && campo.tipo !== "secretaria")
              .map((campo) => (
                <Dado
                  key={campo.chave}
                  rotulo={campo.rotulo}
                  valor={valorLegivel(campo, registro?.[campo.chave])}
                />
              ))}
            {registro?.observacoes && (
              <div className="sm:col-span-2">
                <Dado rotulo="Observações" valor={registro.observacoes} />
              </div>
            )}
          </div>

          {/* As NFs vinculadas. */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#0F2A44]">
              NFs/processos vinculados
            </h3>
            {vinculadas.length === 0 ? (
              <p className="rounded-lg border border-dashed border-black/10 px-4 py-4 text-xs text-[#0F2A44]/50">
                Nenhuma NF vinculada. Sem vínculo, Pago fica em R$ 0,00 e o Saldo é o valor total do
                registro. Vincular NF é opcional.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-black/5">
                <table className="w-full text-sm">
                  <thead className="bg-[#F8FAFC] text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/50">
                    <tr>
                      <th className="px-3 py-2">NF / Processo</th>
                      <th className="px-3 py-2 text-right">Valor da NF</th>
                      <th className="px-3 py-2 text-right">Baixado</th>
                      <th className="px-3 py-2 text-right">Em aberto</th>
                      {podeEditar && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {vinculadas.map((nota) => (
                      <tr key={nota.id}>
                        <td className="px-3 py-2 text-[#0F2A44]">{numeroDaNota(nota)}</td>
                        <td className="px-3 py-2 text-right">{formatBRL(valorDaNota(nota))}</td>
                        <td className="px-3 py-2 text-right">{formatBRL(valorBaixadoDaNota(nota))}</td>
                        <td className="px-3 py-2 text-right">{formatBRL(valorEmAbertoDaNota(nota))}</td>
                        {podeEditar && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() => onDesvincular?.(nota)}
                              title="Desvincular esta NF (a nota e as baixas dela não são alteradas)"
                              className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-50"
                            >
                              <Link2Off size={13} /> Desvincular
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#0F2A44]/45">
              A baixa continua sendo feita na aba de Baixas, por NF/processo. Aqui a NF é apenas
              vinculada, e o Pago acima é a soma das baixas dessas notas.
            </p>
          </section>

          {/* Vincular uma NF que já existe. */}
          {podeEditar && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-[#0F2A44]">Vincular NF já existente</h3>
              <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3">
                <Search size={14} className="shrink-0 text-[#0F2A44]/40" />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar NF, processo, empenho ou vencimento..."
                  className="w-full bg-transparent py-2.5 text-sm outline-none"
                />
              </div>
              <div className="mt-1.5 max-h-56 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10">
                {carregandoNotas ? (
                  <p className="px-3 py-3 text-xs text-[#0F2A44]/50">Carregando NFs do fornecedor...</p>
                ) : disponiveis.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-[#0F2A44]/50">
                    Nenhuma NF/processo disponível deste fornecedor. As notas são cadastradas na aba
                    Todos; nenhuma é criada por aqui.
                  </p>
                ) : (
                  disponiveis.map((nota) => (
                    <button
                      key={nota.id}
                      type="button"
                      disabled={ocupado}
                      onClick={() => onVincular?.(nota)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#EAF1FF] disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate text-sm text-[#0F2A44]">
                        {descricaoDaNota(nota)}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[#0F2A44]/60">
                        <Link2 size={13} /> Vincular
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-black/5 px-5 py-4">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg border border-black/10 px-4 py-2.5 text-sm text-[#0F2A44]/70 hover:bg-black/5"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function Caixa({ rotulo, valor, nota, destaque }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-[#0F2A44]/45">{rotulo}</p>
      <p className="mt-0.5 text-lg font-semibold" style={{ color: destaque ?? "#0F2A44" }}>
        {valor}
      </p>
      {nota && <p className="mt-0.5 text-[11px] text-[#0F2A44]/45">{nota}</p>}
    </div>
  );
}

function Dado({ rotulo, valor }) {
  return (
    <p className="text-sm text-[#0F2A44]">
      <span className="text-[11px] uppercase tracking-wide text-[#0F2A44]/45">{rotulo}: </span>
      {valor === null || valor === undefined || valor === "" ? (
        <span className="text-[#0F2A44]/40">--</span>
      ) : (
        valor
      )}
    </p>
  );
}

/** O valor do campo como se lê na tela (data em dd/mm/aaaa, moeda em R$). */
function valorLegivel(campo, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  if (campo.tipo === "moeda") return formatBRL(valor);
  if (campo.tipo === "data") {
    const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
    return dia ? `${dia}/${mes}/${ano}` : String(valor);
  }
  return String(valor);
}
