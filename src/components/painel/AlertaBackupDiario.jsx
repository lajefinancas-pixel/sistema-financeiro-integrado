import React from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  formatarDataHora,
  motivoAlertaBackup,
  permissaoVerBackups,
  situacaoBackupDiario,
} from "../../lib/backups";

/**
 * Alerta de falha do backup diário, no Painel Principal.
 *
 * Aparece quando a rotina automática falhou ou simplesmente não rodou, e leva
 * direto para Configurações → Backup. Três decisões deliberadas:
 *
 *  1. NÃO é dispensável. Não existe "x" nem "não mostrar de novo": backup que
 *     não aconteceu continua não tendo acontecido depois de fechado o aviso. O
 *     alerta some sozinho quando existir um backup válido mais recente — o
 *     automático do dia seguinte ou um backup manual gerado ali mesmo.
 *  2. Só para quem tem permissão de ver backups. Quem não tem não recebe do
 *     banco nenhum registro de backup, e ausência de registro por falta de
 *     permissão não é sinal de rotina quebrada.
 *  3. Silencioso quando não consegue apurar. Falha de leitura, tabela ainda não
 *     criada ou sessão sem usuário não viram alerta: o painel não anuncia uma
 *     falha que não conseguiu comprovar.
 */
export default function AlertaBackupDiario() {
  const navigate = useNavigate();
  const [situacao, setSituacao] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) return;

        const { data: usuarios } = await supabase
          .from("usuarios")
          .select("id")
          .eq("auth_id", auth.user.id)
          .limit(1);
        const usuarioId = usuarios?.[0]?.id ?? null;

        const podeVer = await permissaoVerBackups(usuarioId);
        if (!ativo || !podeVer) return;

        const resultado = await situacaoBackupDiario();
        if (ativo) setSituacao(resultado);
      } catch {
        // O painel não pode quebrar por causa deste aviso.
        if (ativo) setSituacao(null);
      }
    })();

    return () => {
      ativo = false;
    };
  }, []);

  if (!situacao?.alerta) return null;

  const ultimoValido = situacao.ultimoValido;

  return (
    <div
      role="alert"
      className="rounded-2xl border border-[#DC2626]/30 bg-[#FEF2F2] shadow-sm px-5 py-4 my-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full bg-white/70 flex items-center justify-center shrink-0">
          <AlertTriangle size={18} className="text-[#DC2626]" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#B91C1C]">⚠️ Backup diário não concluído</div>
          <p className="text-xs text-[#B91C1C]/85 leading-relaxed mt-0.5">
            {motivoAlertaBackup(situacao.motivo)}
          </p>
          <p className="text-[11px] text-[#B91C1C]/70 leading-relaxed mt-0.5">
            {ultimoValido
              ? `Último backup concluído: ${formatarDataHora(ultimoValido.iniciadoEm)}.`
              : "Nenhum backup concluído consta no histórico do sistema."}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate("/configuracoes?categoria=backup")}
        className="self-start sm:self-auto shrink-0 inline-flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#DC2626] text-white hover:bg-[#DC2626]/90"
      >
        Verificar backup
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
