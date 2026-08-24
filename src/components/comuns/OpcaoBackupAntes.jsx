import React from "react";
import { DatabaseBackup } from "lucide-react";
import { formatarTamanho } from "../../lib/backups";

/**
 * A caixa "Criar backup antes de continuar", exibida dentro da confirmação de
 * uma operação crítica.
 *
 * Não aparece para quem não pode gerar backup manual — e a ausência dela não
 * impede nada: a operação segue disponível do mesmo jeito, sem a cópia.
 *
 * @param opcao        o retorno de useBackupAntesDeContinuar()
 * @param desabilitado true enquanto a operação principal está em andamento
 */
export default function OpcaoBackupAntes({ opcao, desabilitado = false }) {
  if (!opcao?.disponivel) return null;

  const travado = desabilitado || opcao.gerando;

  return (
    <div className="rounded-xl border border-black/10 bg-[#F5F3EF]/70 px-4 py-3">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={opcao.marcado}
          disabled={travado}
          onChange={(evento) => opcao.definir(evento.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[#0F2A44] disabled:opacity-40"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-medium text-[#0F2A44]">
            <DatabaseBackup size={13} className="text-[#0F2A44]/50" />
            Criar backup antes de continuar
          </span>
          <span className="block text-[11px] text-[#0F2A44]/55 leading-relaxed mt-0.5">
            Opcional. Gera um backup manual do sistema — o mesmo de Configurações → Backup — e só
            executa a operação depois que ele terminar.
          </span>
        </span>
      </label>

      {opcao.gerando && (
        <p className="text-[11px] text-[#8A7526] leading-relaxed mt-2">
          Gerando o backup... a operação começa assim que ele for concluído.
        </p>
      )}

      {!opcao.gerando && opcao.concluido && (
        <p className="text-[11px] text-[#15803D] leading-relaxed mt-2">
          Backup concluído e registrado no histórico ({formatarTamanho(opcao.concluido.tamanhoBytes)}).
        </p>
      )}
    </div>
  );
}
