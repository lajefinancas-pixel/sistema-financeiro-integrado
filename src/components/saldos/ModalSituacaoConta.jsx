import React from "react";
import { AlertTriangle, Archive, Info, RotateCcw } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import { MOTIVO_MINIMO, motivoValido } from "../../lib/exclusaoRegistros";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Desativar ou reativar conta bancária.
 *
 * Desativar NÃO é excluir: a conta sai das listas de uso corrente (entre elas a
 * seleção de contas da Programação Diária) e todo o histórico de saldos e as
 * movimentações passadas continuam no banco, disponíveis em Histórico,
 * Relatórios e Auditoria. Não existe exclusão definitiva de conta.
 *
 * @param destino       "desativar" | "reativar"
 * @param programacoes  programações em elaboração que já escolheram a conta —
 *                      o aviso aparece antes da confirmação
 * @param onConfirmar   async (motivo) => void
 */
export default function ModalSituacaoConta({
  conta,
  destino = "desativar",
  detalhes = [],
  programacoes = [],
  verificando = false,
  onCancelar,
  onConfirmar,
}) {
  const desativando = destino === "desativar";
  const [motivo, setMotivo] = React.useState("");
  const [processando, setProcessando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  // Conta bancária é registro sensível: desativar exige motivo, como as demais
  // ações sobre dinheiro em conta. Reativar não exige.
  const motivoPendente = desativando && !motivoValido(motivo);

  async function confirmar() {
    if (processando || motivoPendente || verificando) return;
    setProcessando(true);
    setErro(null);
    try {
      await onConfirmar(String(motivo).trim());
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível concluir esta ação."));
      setProcessando(false);
    }
  }

  return (
    <ModalShell
      titulo={desativando ? "Desativar conta bancária" : "Reativar conta bancária"}
      subtitulo={
        desativando
          ? "A conta sai das telas de uso corrente e o histórico dela fica preservado."
          : "A conta volta a aparecer nas listas de seleção e nos lançamentos do dia."
      }
      largura="max-w-md"
      onFechar={processando ? () => {} : onCancelar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={processando}
            className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={processando || motivoPendente || verificando}
            title={
              motivoPendente
                ? "Informe o motivo da desativação para continuar."
                : verificando
                  ? "Conferindo as programações que usam esta conta..."
                  : undefined
            }
            className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-white text-sm disabled:opacity-40 ${
              desativando ? "bg-[#B45309] hover:bg-[#B45309]/90" : "bg-[#0F2A44] hover:bg-[#0F2A44]/90"
            }`}
          >
            {desativando ? <Archive size={15} /> : <RotateCcw size={15} />}
            {processando ? "Aguarde..." : desativando ? "Desativar conta" : "Reativar conta"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        {desativando && programacoes.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[#C9A227]/40 bg-[#FBF4DE] px-4 py-3 text-[#8A7526]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <p className="font-semibold">
                Esta conta está selecionada em {programacoes.length}{" "}
                {programacoes.length === 1 ? "programação em elaboração" : "programações em elaboração"}.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {programacoes.map((programacao) => (
                  <li key={programacao.id}>
                    • {programacao.nome ?? `Programação ${programacao.id}`}
                    {programacao.data ? ` — ${new Date(`${programacao.data}T00:00:00`).toLocaleDateString("pt-BR")}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5">
                Desativando agora, a conta deixa de aparecer para escolha nessas programações. O que
                já foi programado nelas não é alterado.
              </p>
            </div>
          </div>
        )}

        <p className="text-sm text-[#0F2A44]">
          {desativando ? "Desativar" : "Reativar"} <strong>{conta?.rotulo}</strong>?
        </p>

        {detalhes.length > 0 && (
          <ul className="rounded-xl border border-black/5 divide-y divide-black/5 text-xs">
            {detalhes
              .filter((linha) => linha && linha.valor !== null && linha.valor !== undefined && linha.valor !== "")
              .map((linha) => (
                <li key={linha.rotulo} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-[#0F2A44]/45 shrink-0">{linha.rotulo}</span>
                  <span className="text-[#0F2A44] text-right break-words">{linha.valor}</span>
                </li>
              ))}
          </ul>
        )}

        <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/70 px-4 py-3 text-[#0F2A44]/70">
          <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
          <p className="text-xs leading-relaxed">
            {desativando
              ? "Desativar não apaga nada: todos os saldos lançados e as movimentações desta conta continuam no banco e seguem visíveis em Histórico, Relatórios e Auditoria. A conta pode ser reativada depois."
              : "O histórico da conta nunca foi apagado — ao reativar, ela volta às listas de seleção com todos os lançamentos que já tinha."}
          </p>
        </div>

        {verificando && (
          <p className="text-xs text-[#0F2A44]/45">Conferindo as programações que usam esta conta...</p>
        )}

        {desativando && (
          <Campo
            label="Motivo da desativação"
            obrigatorio
            dica={`Registro sensível: o motivo fica gravado na trilha de auditoria (mínimo ${MOTIVO_MINIMO} caracteres).`}
          >
            <textarea
              rows={3}
              value={motivo}
              autoFocus
              disabled={processando}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="Explique por que esta conta não é mais utilizada."
              className={`${CLASSE_ENTRADA} resize-none`}
            />
          </Campo>
        )}
      </div>
    </ModalShell>
  );
}
