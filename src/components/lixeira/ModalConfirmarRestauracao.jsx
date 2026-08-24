import React from "react";
import { RotateCcw } from "lucide-react";
import { Alerta, ModalShell } from "../equipe/comuns";
import OpcaoBackupAntes from "../comuns/OpcaoBackupAntes";
import { mensagemAmigavel } from "../../lib/erros";
import { tipoInfo } from "../../lib/lixeira";

/**
 * Confirmação da restauração de um registro da Lixeira.
 *
 * Restaurar é reversível — dá para excluir de novo —, então o modal é sóbrio:
 * diz o que vai voltar a aparecer nas listagens e pede a confirmação. O que ele
 * acrescenta é a opção "Criar backup antes de continuar", disponível para quem
 * pode gerar backup manual.
 *
 * @param opcaoBackup retorno de useBackupAntesDeContinuar(), compartilhado com a
 *                    confirmação de exclusão definitiva da mesma tela
 * @param onConfirmar async () => void; gera o backup pedido (se houver) e
 *                    restaura o registro
 */
export default function ModalConfirmarRestauracao({ item, opcaoBackup, onCancelar, onConfirmar }) {
  const [processando, setProcessando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  const info = tipoInfo(item.tipo);
  const detalhes = (item.detalhes ?? []).filter(
    (linha) => linha && linha.valor && linha.valor !== "--"
  );

  async function confirmar() {
    if (processando) return;
    setProcessando(true);
    setErro(null);
    try {
      await onConfirmar();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível restaurar este registro."));
      setProcessando(false);
    }
  }

  const emAndamento = processando || opcaoBackup?.gerando;

  return (
    <ModalShell
      titulo="Restaurar registro"
      subtitulo="O registro volta a aparecer nas listagens do sistema."
      largura="max-w-md"
      onFechar={emAndamento ? () => {} : onCancelar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={emAndamento}
            className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={emAndamento}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            <RotateCcw size={14} />
            {opcaoBackup?.gerando ? "Gerando backup..." : processando ? "Restaurando..." : "Restaurar"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        <p className="text-sm text-[#0F2A44]">
          Restaurar {info.label.toLowerCase()} <strong>"{item.titulo}"</strong>? Ele deixa a Lixeira e
          volta a ser exibido normalmente no sistema.
        </p>

        {detalhes.length > 0 && (
          <ul className="rounded-xl border border-black/5 divide-y divide-black/5 text-xs">
            {detalhes.map((linha) => (
              <li key={linha.rotulo} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="text-[#0F2A44]/45 shrink-0">{linha.rotulo}</span>
                <span className="text-[#0F2A44] text-right break-words">{linha.valor}</span>
              </li>
            ))}
          </ul>
        )}

        <OpcaoBackupAntes opcao={opcaoBackup} desabilitado={processando} />
      </div>
    </ModalShell>
  );
}
