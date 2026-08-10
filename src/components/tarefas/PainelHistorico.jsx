import React from "react";
import { History } from "lucide-react";
import { Alerta } from "../equipe/comuns";
import { formatarDataHora, listarHistorico, textoHistorico } from "../../lib/tarefas";
import { mensagemAmigavel } from "../../lib/erros";

/**
 * Linha do tempo da tarefa (tabela "tarefas_historico"), em ordem cronológica.
 * O contador "recarga" faz a lista buscar de novo depois de uma mudança de
 * status ou da conclusão da tarefa.
 */
export default function PainelHistorico({ tarefaId, recarga = 0 }) {
  const [registros, setRegistros] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;
    setCarregando(true);
    listarHistorico(tarefaId)
      .then((lista) => ativo && setRegistros(lista))
      .catch((e) => ativo && setErro(mensagemAmigavel(e, "Não foi possível carregar o histórico.")))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [tarefaId, recarga]);

  if (carregando) return <div className="text-sm text-[#0F2A44]/45">Carregando histórico...</div>;
  if (erro) return <Alerta>{erro}</Alerta>;

  if (registros.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-black/10 py-7 text-center">
        <History size={22} className="text-[#0F2A44]/20 mx-auto mb-2" />
        <p className="text-xs text-[#0F2A44]/40">Nenhum registro no histórico desta tarefa.</p>
      </div>
    );
  }

  return (
    <ol className="relative pl-5">
      <span className="absolute left-[5px] top-2 bottom-2 w-px bg-black/[0.08]" aria-hidden="true" />
      {registros.map((registro) => (
        <li key={registro.id} className="relative pb-4 last:pb-0">
          <span className="absolute -left-5 top-1.5 w-[11px] h-[11px] rounded-full bg-white border-2 border-[#C9A227]" />
          <div className="text-[11px] text-[#0F2A44]/40">{formatarDataHora(registro.criado_em)}</div>
          <div className="text-sm text-[#0F2A44]/85 mt-0.5 break-words">
            <strong className="font-medium text-[#0F2A44]">
              {registro.usuario?.nome_completo ?? "Sistema"}
            </strong>{" "}
            {textoHistorico(registro)}
          </div>
        </li>
      ))}
    </ol>
  );
}
