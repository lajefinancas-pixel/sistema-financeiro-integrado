import React from "react";
import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, ChevronUp, RotateCcw, Wallet } from "lucide-react";
import { formatBRL } from "../../lib/moeda";
import { contasAtribuiveis, motivoAtribuicaoEmLote, motivoContaIndisponivel, resumoExecucao } from "../../lib/execucaoProgramacao";
import { TEXTO_SEM_REGISTRO } from "../../lib/saldoCongeladoProgramacao";
import SeletorContas from "../comuns/SeletorContas";
import ContaSelecionada from "../comuns/ContaSelecionada";

/** Saldo exibido: "--" quando não existe valor gravado para aquele dia. */
const textoSaldo = (valor) => (valor == null ? TEXTO_SEM_REGISTRO : formatBRL(valor));

/**
 * Etapa de execução da programação aprovada.
 *
 * A conta é definida POR PAGAMENTO -- não existe conta única obrigatória para a
 * programação inteira. Fornecedor A pode sair da Conta A e o fornecedor B da
 * Conta B, na mesma programação.
 *
 * Só aparecem no seletor as contas da secretaria da programação que estão entre
 * as contas de trabalho selecionadas.
 *
 * ATRIBUIR CONTA NÃO DEBITA CONTA: o vínculo é só o roteiro do pagamento. O
 * débito acontece na baixa. A única operação desta etapa que movimenta saldo é a
 * transferência entre contas confirmada.
 *
 * O SALDO MOSTRADO AQUI É O MESMO DO RESTO DA PROGRAMAÇÃO. A lista de contas
 * chega já pronta da tela (uma única fonte), então numa programação de data
 * anterior, aprovada ou fechada o saldo do seletor de atribuição, da coluna
 * "Conta do pagamento" e do resumo por conta é o saldo congelado do dia em que
 * a programação foi montada -- nunca o saldo de hoje ao lado do congelado.
 * Conta sem esse registro aparece como "--" e não é acusada de saldo
 * insuficiente, porque não há valor gravado para comparar.
 *
 * NENHUM BOTÃO DESTA SEÇÃO FICA EM SILÊNCIO. Quando a atribuição não pode ser
 * aplicada, o botão fica desabilitado com a RAZÃO escrita ao lado (falta
 * escolher a conta, falta marcar fornecedor, falta permissão), e a resposta de
 * cada gravação aparece aqui dentro, junto do botão que foi clicado.
 *
 * As duas seções abrem RECOLHIDAS: a programação diária começa pela conferência
 * dos fornecedores e dos valores, e estas duas etapas só entram depois. Recolher
 * é só exibição — o conteúdo continua montado (escondido por CSS), então marcar
 * pagamentos, escolher a conta do lote e o que já está atribuído sobrevivem a
 * abrir e fechar quantas vezes for.
 */
export default function PainelExecucaoProgramacao({
  programacao,
  pagamentos = [],
  contas = [],
  contasSelecionadas,
  secretariaId,
  nomePagamento,
  transferencias = [],
  permissoes = {},
  salvando = false,
  saldoCongelado = false,
  dataFormatada = "",
  estruturaAusente = false,
  onDefinirConta,
  onAplicarATodos,
  onAtribuirAosSelecionados,
  onTransferir,
  onEstornar,
}) {
  const [marcados, setMarcados] = React.useState(() => new Set());
  const [contaEmLote, setContaEmLote] = React.useState("");
  const [execucaoAberta, setExecucaoAberta] = React.useState(false);
  const [transferenciasAbertas, setTransferenciasAbertas] = React.useState(false);
  // Resposta da última atribuição, mostrada AQUI DENTRO. O aviso do topo da
  // página fica fora da tela quando se está trabalhando nesta seção: sem
  // resposta ao lado do botão, uma recusa do banco parece "o botão não faz nada".
  const [resposta, setResposta] = React.useState(null);

  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas, secretariaId });
  const resumo = resumoExecucao(pagamentos, disponiveis);
  const podeDefinir = permissoes.definir_conta_pagamento !== false && permissoes.executar_programacao !== false;
  // A conta do lote é conferida contra a lista realmente atribuível: escolha
  // que não está mais na lista não passa por escolha feita.
  const contaEscolhida = disponiveis.find((conta) => String(conta.id) === String(contaEmLote)) ?? null;
  const bloqueio = {
    podeDefinirConta: permissoes.definir_conta_pagamento !== false,
    podeExecutar: permissoes.executar_programacao !== false,
    estruturaAusente,
    contasDisponiveis: disponiveis.length,
    salvando,
  };
  // A razão de cada botão desabilitado, escrita para quem está usando a tela.
  const motivoIndividual = motivoContaIndisponivel(bloqueio);
  const motivoSelecionados = motivoAtribuicaoEmLote({
    ...bloqueio,
    escopo: "selecionados",
    totalPagamentos: pagamentos.length,
    quantidadeMarcada: marcados.size,
    contaEscolhida: contaEscolhida?.id ?? null,
  });
  const motivoTodos = motivoAtribuicaoEmLote({
    ...bloqueio,
    escopo: "todos",
    totalPagamentos: pagamentos.length,
    contaEscolhida: contaEscolhida?.id ?? null,
  });
  const nomeDaConta = React.useCallback(
    (contaId) => contas.find((conta) => String(conta.id) === String(contaId))?.nome_conta || `Conta ${contaId ?? "--"}`,
    [contas]
  );

  function alternarMarcado(id) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  /** Guarda a resposta da gravação e, quando ela deu certo, limpa a marcação. */
  function aoConcluir(resultado, depois) {
    const dado = resultado && typeof resultado === "object" ? resultado : null;
    setResposta(dado);
    if (!dado || dado.ok !== false) depois?.();
  }

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <CabecalhoRecolhivel
          aberta={execucaoAberta}
          onAlternar={() => setExecucaoAberta((valor) => !valor)}
          id="execucao-da-programacao"
          icone={<Wallet size={16} />}
          titulo="Execução da programação"
          descricao="Defina a conta de cada pagamento. Definir a conta não debita nada — o débito acontece na baixa."
        />

        <div id="execucao-da-programacao" className={`border-t border-black/5 ${execucaoAberta ? "" : "hidden"}`}>
          {disponiveis.length === 0 && (
            <p className="mx-4 mt-3 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs text-[#8A321C]">
              Nenhuma conta de trabalho desta secretaria está disponível para atribuição. Reabra a programação e selecione as
              contas antes de executar.
            </p>
          )}

          {/* O saldo desta seção é o MESMO do resto da programação: numa
              programação já registrada, o saldo do dia em que ela foi montada.
              O aviso diz isso em palavras, para ninguém ler os valores do
              seletor como se fossem os saldos de hoje. */}
          {saldoCongelado && (
            <p className="mx-4 mt-3 rounded-lg border border-[#B98C55]/40 bg-[#FBF3EA] px-3 py-2 text-[11px] leading-snug text-[#17352F]">
              Os saldos mostrados nesta seção são os mesmos do restante desta programação
              {dataFormatada ? ` de ${dataFormatada}` : ""}: os que foram considerados quando ela foi montada, não os saldos
              de hoje. Conta sem esse valor gravado aparece como "{TEXTO_SEM_REGISTRO}". Definir a conta continua não
              debitando nada.
            </p>
          )}

          {/* Atribuição em lote: marcar vários e aplicar de uma vez, ou aplicar a
              todos. Depois disso a troca individual continua possível. */}
          <div className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1 text-[11px] font-medium text-[#17352F]/60">
                Conta para atribuição
                {/* Contas de trabalho já confirmadas, com busca e agrupadas por
                    Secretaria. Atribuir conta ao pagamento é registro de qual conta
                    paga: não debita, não reserva e não altera saldo. */}
                <SeletorContas
                  className="mt-1"
                  contas={disponiveis}
                  modo="unica"
                  valor={contaEmLote}
                  onEscolher={(conta) => setContaEmLote(String(conta.id))}
                  desabilitado={!podeDefinir}
                  altura="max-h-[200px]"
                  vazio="Nenhuma conta de trabalho confirmada para esta programação."
                />
              </div>
              <button
                type="button"
                onClick={() => onAtribuirAosSelecionados?.([...marcados], Number(contaEmLote)).then((resultado) => aoConcluir(resultado, () => setMarcados(new Set())))}
                disabled={motivoSelecionados !== ""}
                title={motivoSelecionados || "Atribuir a conta escolhida aos fornecedores marcados. Não debita nada."}
                aria-describedby="motivo-atribuir-selecionados"
                className="rounded-lg bg-[#17352F] px-3 py-2 text-xs font-medium text-white hover:bg-[#17352F]/90 disabled:opacity-40"
              >
                Atribuir conta aos selecionados ({marcados.size})
              </button>
              <button
                type="button"
                onClick={() => Promise.resolve(onAplicarATodos?.(Number(contaEmLote))).then(aoConcluir)}
                disabled={motivoTodos !== ""}
                title={motivoTodos || "Atribuir a conta escolhida a todos os fornecedores desta programação. Não debita nada."}
                aria-describedby="motivo-aplicar-a-todos"
                className="rounded-lg border border-[#17352F]/15 px-3 py-2 text-xs font-medium text-[#17352F] hover:bg-[#E5EFEA] disabled:opacity-40"
              >
                Aplicar conta a todos
              </button>
            </div>

            {/* A conta escolhida, por extenso: sem isto não havia como conferir
                na tela o que a lista acima registrou -- e era isso que fazia o
                botão parecer não fazer nada, quando o que faltava era a escolha. */}
            {contaEscolhida ? (
              <ContaSelecionada
                className="mt-2"
                conta={contaEscolhida}
                rotulo="Conta escolhida para atribuição"
                complemento={`Saldo ${
                  saldoCongelado ? "considerado na programação" : "atual"
                }: ${textoSaldo(contaEscolhida.saldo ?? null)} · atribuir esta conta não debita nada`}
              />
            ) : (
              disponiveis.length > 0 && (
                <p className="mt-2 rounded-lg border border-dashed border-[#B98C55]/50 bg-[#FBF3EA] px-3 py-2 text-[11px] text-[#17352F]/80">
                  Nenhuma conta escolhida ainda. Clique na conta na lista acima: sem essa escolha, os dois botões de
                  atribuição em lote ficam desabilitados.
                </p>
              )
            )}

            {/* A razão de cada botão desabilitado, visível na tela e não só no
                título: botão que não responde e não explica é o defeito, não o
                impedimento em si. */}
            <p id="motivo-atribuir-selecionados" role="status" className="mt-1.5 text-[11px] text-[#8A321C] empty:hidden">
              {motivoSelecionados && `Atribuir aos selecionados: ${motivoSelecionados}`}
            </p>
            <p id="motivo-aplicar-a-todos" role="status" className="text-[11px] text-[#8A321C] empty:hidden">
              {motivoTodos && motivoTodos !== motivoSelecionados && `Aplicar a todos: ${motivoTodos}`}
            </p>

            {/* Resposta da última gravação, ao lado do botão que foi clicado. */}
            {resposta?.mensagem && (
              <p
                role="status"
                className={`mt-1.5 rounded-lg px-3 py-2 text-[11px] ${
                  resposta.ok === false ? "bg-[#FBE9DF] text-[#8A321C]" : "bg-[#E5EFEA] text-[#17352F]"
                }`}
              >
                {resposta.mensagem}
              </p>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto border-t border-black/5">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#F5F3EC] text-[11px] uppercase tracking-wide text-[#17352F]/60">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Marcar todos os pagamentos"
                      checked={pagamentos.length > 0 && marcados.size === pagamentos.length}
                      onChange={(e) => setMarcados(e.target.checked ? new Set(pagamentos.map((p) => p.id)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-left font-medium">Conta do pagamento</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((pagamento) => (
                  <tr key={pagamento.id} className="border-t border-black/5">
                    <td className="px-3 py-2 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Marcar ${nomePagamento?.(pagamento) ?? "pagamento"}`}
                        checked={marcados.has(pagamento.id)}
                        onChange={() => alternarMarcado(pagamento.id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="block truncate text-[#17352F]">{nomePagamento?.(pagamento)}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-[#17352F]">
                      {formatBRL(pagamento.valor_a_pagar)}
                    </td>
                    <td className="px-3 py-2">
                      {/* A escolha individual não depende do seletor de lote:
                          ela grava direto a conta daquele fornecedor. Quando
                          está indisponível, o motivo vai no título do campo. */}
                      <select
                        value={pagamento.conta_origem_id ?? ""}
                        onChange={(e) => Promise.resolve(onDefinirConta?.(pagamento, e.target.value ? Number(e.target.value) : null)).then(aoConcluir)}
                        disabled={motivoIndividual !== ""}
                        title={motivoIndividual || "Definir a conta deste pagamento. Não debita nada."}
                        aria-label={`Conta do pagamento de ${nomePagamento?.(pagamento) ?? "fornecedor"}`}
                        className={`w-full rounded-lg border px-2.5 py-1.5 text-xs disabled:bg-black/[0.03] ${
                          pagamento.conta_origem_id ? "border-black/10 bg-white" : "border-[#B98C55]/50 bg-[#F5F3EC]"
                        }`}
                      >
                        <option value="">Definir conta...</option>
                        {disponiveis.map((conta) => (
                          <option key={conta.id} value={conta.id}>
                            {conta.nome_conta} · saldo {textoSaldo(conta.saldo ?? null)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {pagamentos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-[#17352F]/50">
                      Nenhum fornecedor nesta programação.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {motivoIndividual && (
            <p className="mx-4 mb-3 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-[11px] text-[#8A321C]">
              A conta de cada pagamento não pode ser definida agora: {motivoIndividual}
            </p>
          )}

          <div className="grid gap-3 border-t border-black/5 px-4 py-3 sm:grid-cols-3">
            <Tile rotulo="Com conta definida" valor={`${resumo.comConta} de ${pagamentos.length}`} />
            <Tile rotulo="Sem conta definida" valor={String(resumo.semConta)} />
            <Tile rotulo="Total da execução" valor={formatBRL(resumo.total)} destaque />
          </div>

          {resumo.distribuicao.length > 0 && (
            <ul className="space-y-1 px-4 pb-3 text-xs text-[#17352F]/75">
              {resumo.distribuicao.map((item) => (
                <li
                  key={item.contaId}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                    item.acimaDoSaldo ? "bg-[#FBE9DF] text-[#8A321C]" : "bg-[#F5F3EC]"
                  }`}
                >
                  <span className="truncate">
                    {item.nome} · {item.quantidade} pagamento{item.quantidade === 1 ? "" : "s"}
                  </span>
                  <span className="shrink-0">
                    {formatBRL(item.total)} de {textoSaldo(item.saldo)}
                    {item.acimaDoSaldo && " · saldo insuficiente"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {resumo.contasAcimaDoSaldo.length > 0 && (
            <p className="mx-4 mb-3 flex gap-2 rounded-lg border border-[#B06A3C]/30 bg-[#FBE9DF] px-3 py-2 text-xs text-[#8A321C]">
              <AlertTriangle size={15} className="shrink-0" />
              Há conta com pagamentos acima do saldo. Use a transferência entre contas para reforçar o saldo antes da baixa —
              a atribuição por si só não debita nada.
            </p>
          )}

        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <CabecalhoRecolhivel
          aberta={transferenciasAbertas}
          onAlternar={() => setTransferenciasAbertas((valor) => !valor)}
          id="transferir-entre-contas"
          icone={<ArrowLeftRight size={16} />}
          titulo="Transferir entre contas"
          descricao="Reforça o saldo de uma conta com o de outra. Transferência entre contas próprias não é despesa."
          contador={transferencias.length}
        />

        {/* Razão das transferências desta programação. Estornada continua na
            lista: transferência não se exclui, se estorna. */}
        <div id="transferir-entre-contas" className={`border-t border-black/5 px-4 py-3 ${transferenciasAbertas ? "" : "hidden"}`}>
          <button
            type="button"
            onClick={onTransferir}
            disabled={permissoes.executar_transferencia === false}
            className="inline-flex items-center gap-2 rounded-lg border border-[#17352F]/15 px-3 py-2 text-xs font-medium text-[#17352F] hover:bg-[#E5EFEA] disabled:opacity-40"
            title={
              permissoes.executar_transferencia === false
                ? "Você não tem permissão para transferir entre contas."
                : "Transferir entre contas"
            }
          >
            <ArrowLeftRight size={14} /> Transferir entre contas
          </button>

          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#17352F]/60">
            Transferências da programação
          </h3>
          {transferencias.length === 0 ? (
            <p className="mt-2 text-xs text-[#17352F]/50">Nenhuma transferência registrada nesta programação.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {transferencias.map((item) => (
                <li key={item.id} className="rounded-lg border border-black/5 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[#17352F]">
                      <strong>{formatBRL(item.valor)}</strong> · {nomeDaConta(item.conta_origem_id)} →{" "}
                      {nomeDaConta(item.conta_destino_id)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Etiqueta status={item.status} />
                      {item.status === "confirmada" && permissoes.estornar_transferencia !== false && (
                        <button
                          type="button"
                          onClick={() => onEstornar?.(item)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#8A321C] hover:bg-[#FBE9DF]"
                        >
                          <RotateCcw size={12} /> Estornar
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#17352F]/55">
                    {new Date(item.criado_em).toLocaleString("pt-BR")} · {item.usuario_nome} · id {item.id}
                    {item.saldo_origem_antes != null && (
                      <>
                        {" "}
                        · origem {formatBRL(item.saldo_origem_antes)} → {formatBRL(item.saldo_origem_depois)}
                      </>
                    )}
                    {item.saldo_destino_antes != null && (
                      <>
                        {" "}
                        · destino {formatBRL(item.saldo_destino_antes)} → {formatBRL(item.saldo_destino_depois)}
                      </>
                    )}
                  </p>
                  {item.observacao && <p className="mt-0.5 text-[11px] text-[#17352F]/55">{item.observacao}</p>}
                  {item.motivo_estorno && (
                    <p className="mt-0.5 text-[11px] text-[#8A321C]">Motivo do estorno: {item.motivo_estorno}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-[#17352F]/45">
            Transferência entre contas próprias não é despesa e não aparece em relatório de pagamento. Uma transferência
            efetivada não é excluída: ela é estornada, e as duas operações ficam no histórico.
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * Cabeçalho clicável das seções recolhíveis.
 *
 * O cabeçalho inteiro é o botão — clicar em qualquer parte dele abre e recolhe.
 * O conteúdo correspondente fica escondido por CSS, nunca desmontado: nada do
 * que estiver preenchido dentro dele se perde ao recolher.
 */
function CabecalhoRecolhivel({ aberta, onAlternar, id, icone, titulo, descricao, contador = null }) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={aberta}
      aria-controls={id}
      className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left hover:bg-[#F5F3EC]"
    >
      <span>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#17352F]">
          {icone} {titulo}
          {contador != null && contador > 0 && (
            <span className="rounded-full bg-[#E5EFEA] px-2 py-0.5 text-[10px] font-medium text-[#17352F]">
              {contador}
            </span>
          )}
        </span>
        <span className="mt-1 block text-[11px] text-[#17352F]/55">{descricao}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#17352F]/60">
        {aberta ? (
          <>
            Recolher <ChevronUp size={14} />
          </>
        ) : (
          <>
            Expandir <ChevronDown size={14} />
          </>
        )}
      </span>
    </button>
  );
}

function Etiqueta({ status }) {
  if (status === "estornada") {
    return <span className="rounded-full bg-[#FBE9DF] px-2 py-0.5 text-[10px] font-medium text-[#8A321C]">ESTORNADA</span>;
  }
  if (status === "estorno") {
    return <span className="rounded-full bg-[#F5F3EC] px-2 py-0.5 text-[10px] font-medium text-[#B06A3C]">ESTORNO</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E5EFEA] px-2 py-0.5 text-[10px] font-medium text-[#17352F]">
      <Check size={10} /> CONFIRMADA
    </span>
  );
}

function Tile({ rotulo, valor, destaque = false }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${destaque ? "bg-[#17352F] text-white" : "bg-[#F5F3EC] text-[#17352F]"}`}>
      <span className="text-[11px] uppercase tracking-wide opacity-70">{rotulo}</span>
      <strong className="block text-base">{valor}</strong>
    </div>
  );
}
