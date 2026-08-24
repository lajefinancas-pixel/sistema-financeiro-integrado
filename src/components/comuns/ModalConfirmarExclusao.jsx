import React from "react";
import { AlertTriangle, Ban } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import { MOTIVO_MINIMO, motivoValido } from "../../lib/exclusaoRegistros";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Confirmação padrão de exclusão — a mesma em todas as telas do sistema.
 *
 * Nenhuma exclusão acontece direto no clique da lista: a pessoa lê qual registro
 * será excluído, confere a informação principal e confirma aqui.
 *
 * @param registro      descrição do registro ("o fornecedor XYZ LTDA")
 * @param detalhes      [{ rotulo, valor }] mostrados na ficha do registro
 * @param aviso         texto do quadro vermelho (consequência da exclusão)
 * @param exigirMotivo  true nos registros sensíveis: saldo/conta bancária,
 *                      pagamento, fornecedor e certidão
 * @param bloqueio      { texto, acao: { rotulo, descricao, onAcionar } } — impede
 *                      a exclusão e oferece a alternativa (ex.: inativar)
 * @param complemento   conteúdo extra no fim do corpo, para as telas que
 *                      precisam oferecer algo junto da confirmação (a Lixeira
 *                      usa isto para "Criar backup antes de continuar"). Sem
 *                      ele, o modal é exatamente o de sempre.
 * @param onConfirmar   async (motivo) => void; a exclusão em si
 */
export default function ModalConfirmarExclusao({
  titulo = "Confirmar exclusão",
  subtitulo = "Esta confirmação é obrigatória em todas as exclusões do sistema.",
  registro,
  detalhes = [],
  aviso = null,
  exigirMotivo = false,
  bloqueio = null,
  complemento = null,
  verificando = false,
  textoConfirmar = "Confirmar exclusão",
  onCancelar,
  onConfirmar,
}) {
  const [motivo, setMotivo] = React.useState("");
  const [processando, setProcessando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  const motivoPendente = exigirMotivo && !motivoValido(motivo);
  const bloqueado = Boolean(bloqueio);

  async function confirmar() {
    if (processando || bloqueado || motivoPendente || verificando) return;
    setProcessando(true);
    setErro(null);
    try {
      await onConfirmar(String(motivo).trim());
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível excluir este registro."));
      setProcessando(false);
    }
  }

  async function acionarAlternativa() {
    if (processando) return;
    setProcessando(true);
    setErro(null);
    try {
      await bloqueio.acao.onAcionar(String(motivo).trim());
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível concluir esta ação."));
      setProcessando(false);
    }
  }

  return (
    <ModalShell
      titulo={titulo}
      subtitulo={subtitulo}
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

          {bloqueado && bloqueio.acao && (
            <button
              type="button"
              onClick={acionarAlternativa}
              disabled={processando}
              className="px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
            >
              {processando ? "Aguarde..." : bloqueio.acao.rotulo}
            </button>
          )}

          {!bloqueado && (
            <button
              type="button"
              onClick={confirmar}
              disabled={processando || motivoPendente || verificando}
              title={
                motivoPendente
                  ? "Informe o motivo da exclusão para continuar."
                  : verificando
                    ? "Conferindo os vínculos deste registro..."
                    : undefined
              }
              className="px-4 py-2.5 rounded-lg bg-[#DC2626] text-white text-sm hover:bg-[#DC2626]/90 disabled:opacity-40 disabled:hover:bg-[#DC2626]"
            >
              {processando ? "Excluindo..." : textoConfirmar}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        {bloqueado ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-[#C9A227]/40 bg-[#FBF4DE] px-4 py-3 text-[#8A7526]">
            <Ban size={15} className="mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">{bloqueio.texto}</p>
          </div>
        ) : (
          aviso && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 text-[#B91C1C]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">{aviso}</p>
            </div>
          )
        )}

        <p className="text-sm text-[#0F2A44]">
          Você realmente deseja excluir <strong>{registro}</strong>?
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

        {verificando && (
          <p className="text-xs text-[#0F2A44]/45">Conferindo os registros ligados a este cadastro...</p>
        )}

        {exigirMotivo && (
          <Campo
            label="Motivo da exclusão"
            obrigatorio
            dica={`Registro sensível: o motivo fica gravado na trilha de auditoria (mínimo ${MOTIVO_MINIMO} caracteres).`}
          >
            <textarea
              rows={3}
              value={motivo}
              autoFocus
              disabled={processando}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="Explique por que este registro está sendo excluído."
              className={`${CLASSE_ENTRADA} resize-none`}
            />
          </Campo>
        )}

        {bloqueado && bloqueio.acao?.descricao && (
          <p className="text-xs text-[#0F2A44]/55 leading-relaxed">{bloqueio.acao.descricao}</p>
        )}

        {!bloqueado && complemento}
      </div>
    </ModalShell>
  );
}
