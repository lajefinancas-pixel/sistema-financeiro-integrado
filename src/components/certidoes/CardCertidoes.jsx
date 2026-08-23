import React from "react";
import { ChevronRight, FileCheck2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { listarCertidoes } from "../../lib/certidoes";
import { prazosDeAlerta, resumoCertidoes, sincronizarAlertasCertidoes } from "../../lib/alertasCertidoes";

/**
 * Card compacto de Certidões no Painel Principal.
 *
 * Mostra só o resumo — "3 vencem em até 30 dias, 1 vencida" ou "Certidões
 * regulares" — e leva para a tela do módulo. A lista dos documentos continua
 * onde ela pertence, em /certidoes.
 *
 * O card também é o momento em que os alertas de vencimento são acertados para
 * quem abre o sistema no painel e não entra no módulo: a varredura é a mesma
 * usada na tela de Certidões e não gera aviso repetido.
 *
 * Quem não tem permissão de visualizar o módulo não vê o card: o RLS devolve
 * zero certidões e o componente não renderiza nada.
 */
export default function CardCertidoes() {
  const navigate = useNavigate();
  const [resumo, setResumo] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;

    (async () => {
      try {
        const [certidoes, prazos] = await Promise.all([listarCertidoes(), prazosDeAlerta()]);
        if (!ativo) return;
        setResumo(resumoCertidoes(certidoes, prazos));

        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) return;
        const { data: usuarios } = await supabase
          .from("usuarios")
          .select("id")
          .eq("auth_id", auth.user.id)
          .limit(1);
        const usuarioId = usuarios?.[0]?.id;
        if (usuarioId) await sincronizarAlertasCertidoes(usuarioId, certidoes);
      } catch {
        // O painel não pode quebrar por causa do resumo de certidões: sem dados,
        // o card simplesmente não aparece.
        if (ativo) setResumo(null);
      }
    })();

    return () => {
      ativo = false;
    };
  }, []);

  if (!resumo || resumo.total === 0) return null;

  const atencao = !resumo.regular;
  const cor = resumo.vencidas > 0 ? "#DC2626" : atencao ? "#CA8A04" : "#16A34A";
  const fundo = resumo.vencidas > 0 ? "#FEF2F2" : atencao ? "#FEF7DF" : "#EAFBF0";

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: fundo }}
        >
          <FileCheck2 size={18} style={{ color: cor }} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#0F2A44]">Certidões</div>
          <div className="text-sm mt-0.5 truncate" style={{ color: cor }}>
            {resumo.regular ? "✓ Certidões regulares" : resumo.texto}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate("/certidoes?filtro=pendencias")}
        className="flex items-center gap-1 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/[0.03] whitespace-nowrap shrink-0"
      >
        Ver certidões
        <ChevronRight size={14} className="text-[#0F2A44]/40" />
      </button>
    </div>
  );
}
