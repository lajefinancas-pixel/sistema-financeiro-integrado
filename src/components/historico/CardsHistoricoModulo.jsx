import React from "react";
import { Banknote, Building2, ChevronDown, ChevronUp, ClipboardList, Users } from "lucide-react";
import LinhaDoTempoHistorico from "./LinhaDoTempoHistorico";
import { mensagemAmigavel } from "../../lib/erros";
import {
  HISTORICOS_POR_MODULO,
  LIMITE_POR_MODULO,
  contarMovimentacoesDoModulo,
  listarMovimentacoesDoModulo,
} from "../../lib/historicoMovimentacoes";

const ICONES = {
  fornecedores: Building2,
  pagamentos: Banknote,
  tarefas: ClipboardList,
  usuarios: Users,
};

const FALHA_AO_CARREGAR = "Não foi possível carregar as movimentações no momento.";

/**
 * Cards compactos dos demais históricos (Fornecedores, Pagamentos, Tarefas e
 * Usuários).
 *
 * Cada card mostra só o resumo — quantos eventos o módulo tem — e nada de lista
 * é consultado enquanto ninguém abre um card. Ao clicar, as movimentações
 * daquele módulo aparecem abaixo dos cards, no mesmo formato da linha do tempo
 * geral; abrir outro card recolhe o anterior.
 *
 * Os dados vêm das mesmas trilhas da linha do tempo, recortadas por módulo,
 * então quem pode ver o quê continua sendo o banco que decide.
 */
export default function CardsHistoricoModulo() {
  const [contagens, setContagens] = React.useState({});
  const [aberto, setAberto] = React.useState(null);
  const [limite, setLimite] = React.useState(LIMITE_POR_MODULO);
  const [conteudo, setConteudo] = React.useState(null);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  React.useEffect(() => {
    let ativo = true;

    // O número é um resumo: se um módulo não estiver liberado para leitura, ele
    // aparece sem número e os outros continuam mostrando o deles.
    async function carregarContagens() {
      const totais = await Promise.all(
        HISTORICOS_POR_MODULO.map((item) =>
          contarMovimentacoesDoModulo(item.chave).catch(() => null),
        ),
      );
      if (!ativo) return;
      setContagens(Object.fromEntries(HISTORICOS_POR_MODULO.map((item, i) => [item.chave, totais[i]])));
    }

    carregarContagens();
    return () => {
      ativo = false;
    };
  }, []);

  React.useEffect(() => {
    if (!aberto) return undefined;
    let ativo = true;

    setCarregando(true);
    setErro(null);
    listarMovimentacoesDoModulo(aberto, { limite })
      .then((resultado) => {
        if (!ativo) return;
        setConteudo(resultado);
      })
      .catch((e) => {
        if (!ativo) return;
        setConteudo(null);
        setErro(mensagemAmigavel(e, FALHA_AO_CARREGAR));
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [aberto, limite]);

  function alternar(chave) {
    if (aberto === chave) {
      setAberto(null);
      return;
    }
    setAberto(chave);
    setLimite(LIMITE_POR_MODULO);
    setConteudo(null);
    setErro(null);
    // Já entra carregando: evita o piscar de "nenhum registro" antes da consulta.
    setCarregando(true);
  }

  const itemAberto = HISTORICOS_POR_MODULO.find((item) => item.chave === aberto) ?? null;
  const movimentacoes = conteudo?.movimentacoes ?? [];

  return (
    <div className="mb-6 print:hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {HISTORICOS_POR_MODULO.map((item) => {
          const Icone = ICONES[item.chave] ?? ClipboardList;
          const estaAberto = aberto === item.chave;
          const total = contagens[item.chave];

          return (
            <button
              key={item.chave}
              type="button"
              onClick={() => alternar(item.chave)}
              aria-expanded={estaAberto}
              className={`text-left rounded-2xl border p-4 transition-colors ${
                estaAberto
                  ? "bg-[#0F2A44] border-[#0F2A44] text-white"
                  : "bg-white border-black/5 shadow-sm hover:bg-black/[0.02]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <Icone size={18} className={estaAberto ? "text-[#C9A227]" : "text-[#0F2A44]/40"} />
                <span
                  className={`text-lg font-semibold tabular-nums ${estaAberto ? "text-white" : "text-[#0F2A44]"}`}
                >
                  {total === undefined ? "--" : total === null ? "" : total}
                </span>
              </div>
              <div className={`text-sm font-medium mt-2 ${estaAberto ? "text-white" : "text-[#0F2A44]"}`}>
                {item.titulo}
              </div>
              <div className={`text-[11px] mt-0.5 ${estaAberto ? "text-white/70" : "text-[#0F2A44]/50"}`}>
                {item.descricao}
              </div>
              <div
                className={`inline-flex items-center gap-1 text-[11px] mt-2 ${
                  estaAberto ? "text-white/80" : "text-[#0F2A44]/45"
                }`}
              >
                {estaAberto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {estaAberto ? "Ocultar" : "Ver detalhes"}
              </div>
            </button>
          );
        })}
      </div>

      {itemAberto && (
        <div className="mt-4 bg-white rounded-2xl border border-black/5 shadow-sm p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-[#0F2A44]">{itemAberto.titulo}</h3>
            <span className="text-xs text-[#0F2A44]/50">
              {carregando
                ? "Consultando..."
                : `${movimentacoes.length}${conteudo?.temMais ? "+" : ""} ${
                    movimentacoes.length === 1 ? "movimentação" : "movimentações"
                  }`}
            </span>
          </div>

          {(conteudo?.avisos ?? []).map((aviso) => (
            <div
              key={aviso}
              className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-3"
            >
              {aviso}
            </div>
          ))}

          {erro ? (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
          ) : carregando && !conteudo ? (
            <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
          ) : movimentacoes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/10 p-8 text-center text-sm text-[#0F2A44]/40">
              Nenhum registro disponível ainda.
            </div>
          ) : (
            <>
              <LinhaDoTempoHistorico movimentacoes={movimentacoes} />
              {conteudo?.temMais && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => setLimite((atual) => atual + LIMITE_POR_MODULO)}
                    disabled={carregando}
                    className="text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
                  >
                    {carregando ? "Carregando..." : "Carregar mais"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
