import React from "react";
import CardMinhasTarefas from "./CardMinhasTarefas";
import CardPrecisaAtencao from "./CardPrecisaAtencao";
import { usePainelPessoal } from "../../lib/painelPessoal";

/**
 * As duas seções pessoais do Painel Principal, lado a lado: "Minhas tarefas" e
 * "Precisa da minha atenção". Uma consulta só alimenta as duas.
 *
 * Nada é renderizado enquanto a leitura acontece, nem para quem não enxerga
 * tarefas nem certidões — o painel continua o resumo geral que já era.
 */
export default function SecoesPessoais() {
  const { carregando, podeVerTarefas, temCertidoes, tarefas, resumoTarefas, atencao } =
    usePainelPessoal();

  if (carregando) return null;

  // "Precisa da minha atenção" só faz sentido para quem enxerga pelo menos uma
  // das duas origens; sem nenhuma delas, o painel segue como estava.
  const mostrarAtencao = podeVerTarefas || temCertidoes;
  if (!mostrarAtencao) return null;

  // Sem "Minhas tarefas" (falta de permissão), a seção de atenção ocupa a
  // linha inteira em vez de deixar duas colunas vazias no painel.
  return (
    <div className={`grid gap-5 mb-5 ${podeVerTarefas ? "grid-cols-3" : "grid-cols-1"}`}>
      <CardMinhasTarefas visivel={podeVerTarefas} tarefas={tarefas} resumo={resumoTarefas} />
      <CardPrecisaAtencao visivel={mostrarAtencao} itens={atencao} />
    </div>
  );
}
