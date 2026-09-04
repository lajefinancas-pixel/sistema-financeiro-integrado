import React from "react";
import { AlertTriangle, ArrowLeftRight, Plus, Trash2, X } from "lucide-react";
import CampoMoeda from "../CampoMoeda";
import SeletorContas from "../comuns/SeletorContas";
import ContaSelecionada from "../comuns/ContaSelecionada";
import { formatBRL } from "../../lib/moeda";
import { mensagemAmigavel } from "../../lib/erros";
import { conferirTransferenciaMultipla, pernasParaEnvio } from "../../lib/regrasTransferencia";
import { confirmarTransferenciaEntreContas } from "../../lib/transferenciasContas";
import { novaChaveIdempotencia } from "../../lib/execucaoProgramacaoDados";

/**
 * Transferência entre contas próprias.
 *
 * Aceita VÁRIAS origens para UM destino na mesma operação, com valor por origem,
 * e mostra ao vivo o total a transferir, o saldo atual do destino e o saldo do
 * destino depois das transferências.
 *
 * Duas coisas que a tela deixa explícitas porque são regra:
 *
 *   NÃO É DESPESA -> a origem debita, o destino credita e o patrimônio somado
 *                    das contas envolvidas é o MESMO antes e depois. O painel
 *                    mostra as duas somas para conferência.
 *   NÃO ACONTECE DUAS VEZES -> o identificador único é criado uma única vez, ao
 *                    abrir o painel, e viaja em toda tentativa. Duplo clique,
 *                    F5 e reenvio caem na mesma chave e nada se move de novo.
 */
export default function ModalTransferenciaEntreContas({
  programacao,
  contas = [],
  contaDestinoSugerida = "",
  onFechar,
  onConcluida,
}) {
  // Criada uma vez por painel aberto: é a trava de idempotência da operação.
  const chave = React.useRef(novaChaveIdempotencia());
  const [destinoId, setDestinoId] = React.useState(contaDestinoSugerida ? String(contaDestinoSugerida) : "");
  const [linhas, setLinhas] = React.useState([{ contaId: "", valor: "" }]);
  const [observacao, setObservacao] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  const destino = contas.find((conta) => String(conta.id) === String(destinoId)) ?? null;
  const origens = linhas.map((linha) => ({
    ...linha,
    conta: contas.find((conta) => String(conta.id) === String(linha.contaId)) ?? null,
    valor: linha.valor,
  }));
  const conferencia = conferirTransferenciaMultipla({ destino, origens });
  // A conta de destino não pode ser também origem.
  const origensPossiveis = contas.filter((conta) => String(conta.id) !== String(destinoId));

  function alterarLinha(indice, campo, valor) {
    setLinhas((atual) => atual.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)));
  }

  async function confirmar(evento) {
    evento.preventDefault();
    if (!conferencia.podeConfirmar) {
      setErro(conferencia.erros[0] || "Revise as contas e os valores da transferência.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const resultado = await confirmarTransferenciaEntreContas({
        programacaoId: programacao?.id,
        contaDestinoId: Number(destinoId),
        pernas: pernasParaEnvio(origens),
        chaveIdempotencia: chave.current,
        observacao,
      });
      await onConcluida?.(resultado);
      onFechar();
    } catch (falha) {
      console.error("[Pagamentos Fase 2] Erro ao confirmar transferência entre contas.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível confirmar a transferência."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={confirmar} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between border-b border-black/5 bg-white px-5 py-4">
          <div>
            <h2 className="inline-flex items-center gap-2 font-semibold text-[#17352F]">
              <ArrowLeftRight size={17} /> Transferir entre contas
            </h2>
            <p className="mt-1 text-xs text-[#17352F]/55">
              Transferência entre contas próprias não é despesa: a origem debita, o destino credita e o patrimônio total
              permanece igual.
            </p>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg p-2 text-[#17352F]/50 hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="block text-xs font-medium text-[#17352F]/70">
            Conta de destino
            {/* Contas já cadastradas, agrupadas por Secretaria e com busca por
                número, nome, banco, agência ou secretaria. Aqui não se cadastra
                conta: só se escolhe conta que já existe. */}
            <SeletorContas
              className="mt-1"
              contas={contas}
              modo="unica"
              valor={destinoId}
              onEscolher={(conta) => setDestinoId(String(conta.id))}
              altura="max-h-[220px]"
              vazio="Nenhuma conta disponível para transferência."
            />
            {/* Escolhida, a conta aparece por extenso: Banco | Conta | Nome da
                Conta | Secretaria, com o saldo atual ao lado. */}
            <ContaSelecionada
              className="mt-1.5"
              conta={destino}
              rotulo="Conta de destino"
              complemento={destino ? `Saldo atual: ${formatBRL(destino.saldo ?? 0)}` : null}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#17352F]/70">Contas de origem</span>
              <button
                type="button"
                onClick={() => setLinhas((atual) => [...atual, { contaId: "", valor: "" }])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#17352F]/15 px-2.5 py-1.5 text-[11px] font-medium text-[#17352F] hover:bg-[#E5EFEA]"
              >
                <Plus size={13} /> Acrescentar origem
              </button>
            </div>

            {conferencia.linhas.map((linha, indice) => (
              <div key={indice} className="rounded-xl border border-black/5 bg-[#F5F3EC]/60 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_170px_auto] sm:items-end">
                  <div className="text-[11px] font-medium text-[#17352F]/60">
                    Conta de origem
                    <SeletorContas
                      className="mt-1"
                      contas={origensPossiveis}
                      modo="unica"
                      valor={linhas[indice].contaId}
                      onEscolher={(conta) => alterarLinha(indice, "contaId", String(conta.id))}
                      altura="max-h-[200px]"
                      vazio="Nenhuma outra conta disponível como origem."
                    />
                  </div>
                  <label className="text-[11px] font-medium text-[#17352F]/60">
                    Valor
                    <CampoMoeda
                      valor={linhas[indice].valor}
                      onValorChange={(valor) => alterarLinha(indice, "valor", valor)}
                      className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setLinhas((atual) => atual.filter((_, i) => i !== indice))}
                    disabled={linhas.length === 1}
                    className="rounded-lg p-2 text-[#A5542F] hover:bg-[#FBE9DF] disabled:opacity-30"
                    title="Retirar esta origem"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {linha.conta && (
                  <ContaSelecionada
                    className="mt-2 bg-white"
                    conta={linha.conta}
                    rotulo="Conta de origem"
                    complemento={`Saldo atual ${formatBRL(linha.saldoAtual)} · saldo após a transferência ${formatBRL(linha.saldoDepois)}`}
                  />
                )}
                {linha.erro && <p className="mt-1.5 text-[11px] text-[#8A321C]">{linha.erro}</p>}
              </div>
            ))}
          </div>

          <label className="block text-xs font-medium text-[#17352F]/70">
            Observação (opcional)
            <input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              placeholder="Ex.: concentração de saldo para a folha do dia"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <Tile rotulo="Total a transferir" valor={formatBRL(conferencia.totalTransferir)} destaque />
            <Tile rotulo="Saldo atual do destino" valor={formatBRL(conferencia.saldoDestinoAtual)} />
            <Tile rotulo="Saldo do destino depois" valor={formatBRL(conferencia.saldoDestinoDepois)} />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-[#E5EFEA] px-4 py-2.5 text-[11px] text-[#17352F]/75">
            <span>Soma das contas envolvidas antes: {formatBRL(conferencia.patrimonioAntes)}</span>
            <span>Depois: {formatBRL(conferencia.patrimonioDepois)}</span>
          </div>

          {erro && (
            <div className="flex gap-2 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs text-[#8A321C]">
              <AlertTriangle size={15} className="shrink-0" />
              {erro}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-black/5 bg-white px-5 py-4">
          <span className="text-[11px] text-[#17352F]/45">
            Esta transferência tem identificador único: confirmar duas vezes não a executa duas vezes.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onFechar} className="rounded-lg px-4 py-2.5 text-sm text-[#17352F]/70 hover:bg-black/5">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || !conferencia.podeConfirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-[#17352F] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#17352F]/90 disabled:opacity-40"
            >
              <ArrowLeftRight size={16} />
              {salvando ? "Confirmando..." : "Confirmar transferência"}
            </button>
          </div>
        </div>
      </form>
    </div>
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
