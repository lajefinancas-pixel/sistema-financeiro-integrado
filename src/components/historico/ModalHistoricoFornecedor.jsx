import React from "react";
import { History, SearchX } from "lucide-react";
import { ModalShell } from "../equipe/comuns";
import LinhaDoTempoHistorico from "./LinhaDoTempoHistorico";
import { mensagemAmigavel } from "../../lib/erros";
import { LIMITE_POR_REGISTRO, listarMovimentacoesDoFornecedor } from "../../lib/historicoMovimentacoes";

/**
 * Histórico de um fornecedor, aberto de dentro do próprio cadastro.
 *
 * É o mesmo conteúdo da linha do tempo da tela de Histórico — mesma fonte de
 * dados, mesma apresentação e a mesma comparação "Antes e depois" ao expandir um
 * item —, recortado para os eventos deste fornecedor. Quem pode ver o quê
 * continua sendo decidido pelo banco: sem a leitura liberada, o modal mostra o
 * aviso em vez de uma lista vazia.
 */
export default function ModalHistoricoFornecedor({ fornecedor, onFechar }) {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [movimentacoes, setMovimentacoes] = React.useState([]);
  const [temMais, setTemMais] = React.useState(false);

  const razaoSocial = fornecedor?.razao_social ?? "";
  const cpfCnpj = fornecedor?.cpf_cnpj ?? "";

  React.useEffect(() => {
    let ativo = true;

    async function carregar() {
      setCarregando(true);
      setErro(null);
      try {
        const resultado = await listarMovimentacoesDoFornecedor({ razaoSocial, cpfCnpj });
        if (!ativo) return;
        setMovimentacoes(resultado.movimentacoes);
        setTemMais(resultado.temMais);
      } catch (e) {
        if (!ativo) return;
        setMovimentacoes([]);
        setTemMais(false);
        setErro(mensagemAmigavel(e, "Não foi possível carregar o histórico deste fornecedor."));
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [razaoSocial, cpfCnpj]);

  return (
    <ModalShell
      titulo="Histórico do fornecedor"
      subtitulo={[razaoSocial, cpfCnpj].filter(Boolean).join(" · ")}
      onFechar={onFechar}
      rodape={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44] hover:bg-black/5"
          >
            Fechar
          </button>
        </div>
      }
    >
      {carregando ? (
        <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
      ) : erro ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {erro}
        </div>
      ) : movimentacoes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 p-10 text-center">
          <SearchX size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
          <div className="text-sm text-[#0F2A44]/40">
            Nenhuma movimentação registrada para este fornecedor ainda.
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-[#0F2A44]/50 flex items-center gap-1.5 mb-4">
            <History size={13} />
            {movimentacoes.length}
            {temMais ? "+" : ""}{" "}
            {movimentacoes.length === 1 ? "movimentação" : "movimentações"}, da mais recente para a
            mais antiga
          </p>
          <LinhaDoTempoHistorico movimentacoes={movimentacoes} />
          {temMais && (
            <p className="text-[11px] text-[#0F2A44]/40 mt-4 text-center">
              Mostrando as {LIMITE_POR_REGISTRO} movimentações mais recentes. As anteriores estão na
              tela de Histórico.
            </p>
          )}
        </>
      )}
    </ModalShell>
  );
}
