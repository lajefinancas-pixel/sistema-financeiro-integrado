import React from "react";
import OpcoesRelacaoValores from "./OpcoesRelacaoValores.jsx";
import {
  MODOS_IMPRESSAO,
  MODO_IMPRESSAO_PADRAO,
  modoImpressao,
  textoOrientacao,
} from "../../lib/relatoriosCabecalho";
import { relacaoDisponivel } from "../../lib/relacaoDeValores";

// Escolha do formato de impressão do relatório, usada tanto nos relatórios
// prontos quanto nos personalizados e nos comparativos.
//
// Nos dois primeiros formatos a orientação da folha não é escolhida aqui: ela é
// definida automaticamente pela quantidade de colunas do relatório (paisagem
// quando são muitas), e o texto ao lado só informa o que vai sair.
//
// A "Relação de valores" tem layout próprio -- duas colunas, sempre em retrato
// --, então em vez da orientação ela mostra as suas próprias opções: a ordem das
// linhas e o recorte "somente com saldo em aberto". Ela só aparece quando o
// relatório tem as duas colunas de que a relação precisa (um nome e um valor);
// nos demais, as opções continuam sendo as duas de antes.

export default function OpcoesImpressao({
  modo,
  onModo,
  colunas,
  resultado,
  opcoesRelacao,
  onOpcoesRelacao,
}) {
  const temRelacao = relacaoDisponivel(resultado ?? { colunas });
  const disponiveis = MODOS_IMPRESSAO.filter((item) => temRelacao || !item.duasColunas);
  // Sem as duas colunas, a relação não é oferecida -- e, se ela tinha sido
  // escolhida em outro relatório, a tela mostra o formato que vai realmente
  // sair, o padrão, em vez de deixar nenhum botão marcado.
  const pedido = modoImpressao(modo);
  const atual = pedido.duasColunas && !temRelacao ? modoImpressao(MODO_IMPRESSAO_PADRAO) : pedido;
  const naRelacao = atual.duasColunas === true;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        className="flex items-center gap-1 rounded-lg border border-black/10 bg-white p-1"
        role="group"
        aria-label="Formato de impressão"
      >
        {disponiveis.map((item) => (
          <button
            key={item.id}
            onClick={() => onModo(item.id)}
            title={item.descricao}
            aria-pressed={atual.id === item.id}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              atual.id === item.id
                ? "bg-[#0F2A44] text-white font-medium"
                : "text-[#0F2A44]/60 hover:bg-black/5"
            }`}
          >
            {item.rotulo}
          </button>
        ))}
      </div>
      {naRelacao && onOpcoesRelacao ? (
        <OpcoesRelacaoValores opcoes={opcoesRelacao} onOpcoes={onOpcoesRelacao} />
      ) : (
        <span className="text-[11px] text-[#0F2A44]/45">
          {naRelacao ? "A4 retrato · 2 colunas" : textoOrientacao(colunas)}
        </span>
      )}
    </div>
  );
}
