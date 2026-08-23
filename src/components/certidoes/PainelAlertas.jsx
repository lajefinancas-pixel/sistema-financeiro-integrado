import React from "react";
import { BellRing, Check, ShieldCheck } from "lucide-react";
import { dispensarAlerta } from "../../lib/alertasCertidoes";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Faixa de alertas de vencimento no topo da listagem.
 *
 * Mostra as pendências ativas de quem está logado — as mesmas linhas gravadas
 * na tabela "notificacoes", então o que aparece aqui é o que aparece no sino do
 * sistema. Cada aviso pode ser dispensado; renovar ou regularizar a certidão
 * faz o aviso sumir sozinho na próxima abertura da tela.
 */
export default function PainelAlertas({ alertas, carregando, onDispensado }) {
  const [dispensando, setDispensando] = React.useState(null);
  const [erro, setErro] = React.useState(null);

  async function dispensar(alerta) {
    setDispensando(alerta.id);
    setErro(null);
    try {
      await dispensarAlerta(alerta.id);
      onDispensado(alerta.id);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível dispensar este alerta."));
    } finally {
      setDispensando(null);
    }
  }

  if (carregando) return null;

  if (alertas.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-2xl border border-[#16A34A]/20 bg-[#EAFBF0] px-4 py-3 text-sm text-[#15803D]">
        <ShieldCheck size={16} className="shrink-0" />
        Nenhum vencimento à vista. As certidões cadastradas estão em dia.
      </div>
    );
  }

  const vencidas = alertas.filter((a) => a.certidao_estagio === "vencida").length;

  return (
    <div className="mb-5 rounded-2xl border border-[#C9A227]/30 bg-[#FFFBEF] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#C9A227]/20">
        <BellRing size={16} className="text-[#A16207] shrink-0" />
        <div className="text-sm font-semibold text-[#0F2A44]">
          Alertas de vencimento
          <span className="font-normal text-[#0F2A44]/55">
            {" — "}
            {alertas.length} {alertas.length === 1 ? "pendência" : "pendências"}
            {vencidas > 0 ? `, ${vencidas} já ${vencidas === 1 ? "vencida" : "vencidas"}` : ""}
          </span>
        </div>
      </div>

      <ul className="divide-y divide-[#C9A227]/15">
        {alertas.map((alerta) => {
          const vencida = alerta.certidao_estagio === "vencida";
          return (
            <li key={alerta.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                style={{ backgroundColor: vencida ? "#DC2626" : "#CA8A04" }}
              />
              <p className="text-sm text-[#0F2A44]/85 leading-snug flex-1 break-words">{alerta.mensagem}</p>
              <button
                type="button"
                onClick={() => dispensar(alerta)}
                disabled={dispensando === alerta.id}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/65 hover:bg-black/5 disabled:opacity-40 shrink-0"
              >
                <Check size={13} />
                {dispensando === alerta.id ? "Dispensando..." : "Dispensar"}
              </button>
            </li>
          );
        })}
      </ul>

      {erro && <div className="px-4 py-2.5 text-xs text-red-700 bg-red-50">{erro}</div>}
    </div>
  );
}
