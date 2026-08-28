import React from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import CampoMoeda from "../CampoMoeda";
import { formatBRL, paraNumeroMoeda } from "../../lib/moeda";
import { mensagemAmigavel } from "../../lib/erros";
import { registrarBaixaDeNota } from "../../lib/baixasPagamentos";
import {
  descricaoDaNota,
  numeroDaNota,
  resumoDaNota,
  situacaoAposBaixa,
  validarBaixaDeNota,
} from "../../lib/regrasBaixas";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registro da baixa de UMA NOTA -- parcial ou integral.
 *
 * A baixa é a confirmação de que o pagamento saiu de fato no banco. Ela abate o
 * valor em aberto da nota e NÃO DEBITA O SALDO DA CONTA: a conta informada aqui
 * é o registro de onde o dinheiro saiu, não um lançamento de saldo. Quem
 * movimenta saldo continua sendo o lançamento do saldo do dia e a transferência
 * entre contas.
 *
 * Confirmação repetida (duplo clique, F5, reenvio) não gera duas baixas: a
 * chave de idempotência é sorteada uma única vez por abertura do formulário,
 * guardada no rascunho da sessão e reenviada em toda tentativa. O banco recusa a
 * segunda gravação com a mesma chave.
 */
export default function ModalRegistrarBaixa({ nota, fornecedor, contas = [], onFechar, onConcluida }) {
  const resumo = resumoDaNota(nota);
  const chaveRascunho = `sfi.baixa.nota.${nota?.id ?? "nova"}`;
  const rascunho = React.useMemo(() => {
    try {
      return JSON.parse(window.sessionStorage.getItem(chaveRascunho) || "null");
    } catch {
      return null;
    }
  }, [chaveRascunho]);

  const chaveIdempotencia = React.useRef(rascunho?.chaveIdempotencia || crypto.randomUUID());
  const [form, setForm] = React.useState(
    rascunho?.form || {
      valor: resumo.valorEmAberto,
      dataPagamento: hojeISO(),
      contaId: "",
      observacao: "",
    },
  );
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(
        chaveRascunho,
        JSON.stringify({ chaveIdempotencia: chaveIdempotencia.current, form }),
      );
    } catch {
      /* armazenamento indisponível */
    }
  }, [chaveRascunho, form]);

  const valor = paraNumeroMoeda(form.valor);
  const restante = Math.max(0, resumo.valorEmAberto - valor);
  const quita = valor > 0 && situacaoAposBaixa(nota, valor) === "pago";
  const conferencia = validarBaixaDeNota({ nota, valor, dataPagamento: form.dataPagamento, contaId: form.contaId });

  function alterar(campo, valorNovo) {
    setErro(null);
    setForm((atual) => ({ ...atual, [campo]: valorNovo }));
  }

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
      const retorno = await registrarBaixaDeNota({
        chaveIdempotencia: chaveIdempotencia.current,
        valorEmAbertoId: nota.id,
        valor,
        dataPagamento: form.dataPagamento,
        contaId: form.contaId,
        observacao: form.observacao,
      });
      try {
        window.sessionStorage.removeItem(chaveRascunho);
      } catch {
        /* armazenamento indisponível */
      }
      await onConcluida?.(retorno);
      onFechar?.();
    } catch (falha) {
      console.error("[Baixas] Não foi possível registrar a baixa da nota.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível registrar a baixa. Tente novamente."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={confirmar} className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/5 px-5 py-4">
          <div>
            <h2 className="font-semibold text-[#0F2A44]">Registrar baixa da nota {numeroDaNota(nota)}</h2>
            <p className="mt-1 text-xs text-[#0F2A44]/55">
              {fornecedor || "Fornecedor"}
              {descricaoDaNota(nota) ? ` · ${descricaoDaNota(nota)}` : ""}
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

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="grid grid-cols-3 gap-3 rounded-xl bg-[#F4F7F9] p-3 text-[11px] text-[#0F2A44]/60 sm:col-span-2">
            <div>
              Valor original
              <strong className="block text-sm text-[#0F2A44]">{formatBRL(resumo.valorTotal)}</strong>
            </div>
            <div>
              Já baixado
              <strong className="block text-sm text-[#0F2A44]">{formatBRL(resumo.valorBaixado)}</strong>
            </div>
            <div>
              Em aberto
              <strong className="block text-sm text-[#0F2A44]">{formatBRL(resumo.valorEmAberto)}</strong>
            </div>
          </div>

          <label className="text-xs font-medium text-[#0F2A44]/70">
            Valor pago nesta baixa
            <CampoMoeda
              valor={form.valor}
              onValorChange={(valorNovo) => alterar("valor", valorNovo)}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            />
            <button
              type="button"
              onClick={() => alterar("valor", resumo.valorEmAberto)}
              className="mt-1 text-[11px] font-medium text-[#0F2A44]/60 underline decoration-dotted hover:text-[#0F2A44]"
            >
              Usar todo o valor em aberto ({formatBRL(resumo.valorEmAberto)})
            </button>
          </label>

          <label className="text-xs font-medium text-[#0F2A44]/70">
            Data do pagamento
            <input
              type="date"
              max={hojeISO()}
              value={form.dataPagamento}
              onChange={(e) => alterar("dataPagamento", e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-[#0F2A44]/70 sm:col-span-2">
            Conta bancária de onde o pagamento saiu
            <select
              value={form.contaId}
              onChange={(e) => alterar("contaId", e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Selecione...</option>
              {contas.map((conta) => (
                <option key={conta.id} value={conta.id}>
                  {conta.nome_conta}
                  {conta.bancos?.nome ? ` · ${conta.bancos.nome}` : ""}
                  {conta.numero_conta ? ` · ${conta.numero_conta}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-[#0F2A44]/70 sm:col-span-2">
            Observação <span className="font-normal text-[#0F2A44]/40">(opcional)</span>
            <input
              value={form.observacao}
              onChange={(e) => alterar("observacao", e.target.value)}
              maxLength={300}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"
              placeholder="Ex.: pagamento confirmado no extrato do dia"
            />
          </label>

          {valor > 0 && conferencia.ok && (
            <div className="flex gap-2 rounded-lg border border-[#C9A227]/30 bg-[#FBF6E6] px-3 py-2 text-xs text-[#0F2A44]/80 sm:col-span-2">
              <CheckCircle2 size={15} className="shrink-0 text-[#C9A227]" />
              {quita ? (
                <span>
                  Esta baixa quita a nota: o valor em aberto vai para {formatBRL(0)} e a nota sai da lista de notas em
                  aberto.
                </span>
              ) : (
                <span>
                  Baixa parcial: continuam em aberto {formatBRL(restante)}, que podem receber novas baixas até a nota ser
                  quitada.
                </span>
              )}
            </div>
          )}

          <p className="rounded-lg bg-[#F4F7F9] px-3 py-2.5 text-[11px] leading-relaxed text-[#0F2A44]/65 sm:col-span-2">
            A baixa registra o pagamento e abate o valor em aberto da nota. Ela <strong>não altera o saldo da conta</strong>
            {" "}— a conta informada acima serve para identificar de onde o dinheiro saiu.
          </p>

          {erro && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-2">
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
            className="rounded-lg bg-[#0F2A44] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            {salvando ? "Registrando..." : "Confirmar baixa"}
          </button>
        </div>
      </form>
    </div>
  );
}
