import React from "react";
import { Users } from "lucide-react";
import { estaAtrasada, hojeISO, statusInfo } from "../../lib/tarefas";

const CARTOES = [
  { id: "hoje", label: "Tarefas hoje", chaveCor: "em_andamento" },
  { id: "em_andamento", label: "Em andamento", chaveCor: "em_andamento" },
  { id: "atrasadas", label: "Atrasadas", chaveCor: "atrasada" },
  { id: "aguardando_aprovacao", label: "Aguardando aprovação", chaveCor: "em_analise" },
];

const ENCERRADAS = ["concluida", "cancelada"];

/**
 * Painel "Equipe e tarefas" da gestora.
 *
 * Mostra o andamento do time: quantas tarefas vencem hoje, quantas estão em
 * andamento, quantas atrasaram e quantas esperam aprovação — e, abaixo, quanto
 * cada pessoa tem em mãos. É informação de organização do trabalho: não há
 * ranking nem comparação de desempenho entre as pessoas.
 *
 * A tela decide quem vê este painel; aqui só entra o cálculo.
 */
export default function PainelEquipe({ tarefas, usuarios }) {
  const hoje = hojeISO();

  const numeros = React.useMemo(() => {
    const contagem = { hoje: 0, em_andamento: 0, atrasadas: 0, aguardando_aprovacao: 0 };
    (tarefas ?? []).forEach((t) => {
      if (ENCERRADAS.includes(t.status)) return;
      if (t.prazo === hoje) contagem.hoje += 1;
      if (t.status === "em_andamento") contagem.em_andamento += 1;
      if (estaAtrasada(t)) contagem.atrasadas += 1;
      if (t.status === "em_analise") contagem.aguardando_aprovacao += 1;
    });
    return contagem;
  }, [tarefas, hoje]);

  // Uma linha por pessoa que tem tarefa aberta, em ordem alfabética.
  const porUsuario = React.useMemo(() => {
    const mapa = new Map();
    (usuarios ?? []).forEach((u) => {
      mapa.set(u.id, { id: u.id, nome: u.nome_completo, cargo: u.cargo, andamento: 0, atrasadas: 0, abertas: 0 });
    });

    (tarefas ?? []).forEach((t) => {
      if (!t.responsavel_id || ENCERRADAS.includes(t.status)) return;
      if (!mapa.has(t.responsavel_id)) {
        mapa.set(t.responsavel_id, {
          id: t.responsavel_id,
          nome: t.responsavel?.nome_completo ?? "Usuário removido",
          cargo: null,
          andamento: 0,
          atrasadas: 0,
          abertas: 0,
        });
      }
      const linha = mapa.get(t.responsavel_id);
      linha.abertas += 1;
      if (t.status === "em_andamento") linha.andamento += 1;
      if (estaAtrasada(t)) linha.atrasadas += 1;
    });

    return [...mapa.values()]
      .filter((linha) => linha.abertas > 0)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  }, [tarefas, usuarios]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {CARTOES.map((cartao) => {
          const info = statusInfo(cartao.chaveCor);
          return (
            <div key={cartao.id} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: info.ponto }} />
                <span className="text-[11px] uppercase tracking-wide font-medium text-[#0F2A44]/50 truncate">
                  {cartao.label}
                </span>
              </div>
              <div className="text-2xl font-semibold mt-2" style={{ color: info.cor }}>
                {numeros[cartao.id]}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-black/5">
          <Users size={16} className="text-[#0F2A44]/40" />
          <div>
            <h2 className="text-sm font-semibold text-[#0F2A44]">Tarefas por pessoa</h2>
            <p className="text-[11px] text-[#0F2A44]/45">
              Somente tarefas em aberto, para acompanhar a distribuição do trabalho.
            </p>
          </div>
        </div>

        {porUsuario.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[#0F2A44]/40">
            Nenhuma tarefa em aberto na equipe neste momento.
          </div>
        ) : (
          <ul className="divide-y divide-black/5">
            {porUsuario.map((linha) => (
              <li key={linha.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#0F2A44] truncate">{linha.nome}</div>
                  {linha.cargo && <div className="text-[11px] text-[#0F2A44]/45 truncate">{linha.cargo}</div>}
                </div>
                <span className="text-xs text-[#0F2A44]/65 whitespace-nowrap">
                  <strong className="font-semibold text-[#8A6100]">{linha.andamento}</strong> em andamento
                </span>
                <span className="text-xs text-[#0F2A44]/65 whitespace-nowrap">
                  <strong className={`font-semibold ${linha.atrasadas > 0 ? "text-[#DC2626]" : "text-[#0F2A44]/45"}`}>
                    {linha.atrasadas}
                  </strong>{" "}
                  {linha.atrasadas === 1 ? "atrasada" : "atrasadas"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
