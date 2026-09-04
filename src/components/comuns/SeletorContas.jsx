import React from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { formatBRL } from "../../lib/moeda";
import {
  MENSAGEM_SEM_RESULTADO,
  agruparContasPorSecretaria,
  alternarGrupo,
  filtrarContasCadastradas,
  grupoRecolhido,
  linhaDaConta,
  rotuloDoGrupo,
  selecionadasNoGrupo,
} from "../../lib/contasBancariasBusca";

/**
 * Lista de contas bancárias JÁ CADASTRADAS, para escolher conta.
 *
 * O mesmo componente atende toda tela que seleciona conta (Saldos das Contas,
 * Programação, Baixa e Transferência), com três comportamentos combinados:
 *
 *   ORGANIZAÇÃO -> as contas aparecem agrupadas por Secretaria, com a contagem
 *     no cabeçalho ("SAÚDE — 12 contas"). Abrir uma secretaria mostra só as
 *     contas dela. É organização visual: o vínculo de cada conta com a sua
 *     secretaria continua o mesmo e nenhum subtotal por secretaria é criado.
 *   RECOLHER -> clicar no cabeçalho abre/fecha SOMENTE aquele grupo. Recolher
 *     não desmarca nada: a seleção fica inteira, e o cabeçalho mostra quantas
 *     contas daquele grupo estão marcadas.
 *   BUSCA -> "Buscar conta..." procura, enquanto a pessoa digita e sem recarregar
 *     a página, entre TODAS as contas recebidas, de todas as secretarias,
 *     independentemente de qual grupo está aberto. O resultado sempre mostra a
 *     Secretaria da conta.
 *
 * O que este componente NÃO faz, por regra: criar conta. Não existe aqui
 * "cadastrar conta", "nova conta", conta avulsa, temporária ou cadastro rápido.
 * Só se escolhe conta que já está cadastrada; o que não vem em `contas` não
 * aparece e não pode ser escolhido. Escolher conta também não movimenta saldo —
 * é apenas o registro de qual conta foi escolhida.
 *
 * @param contas            contas já cadastradas que esta tela pode oferecer
 * @param modo              "unica" (escolhe uma) | "multipla" (marca várias)
 * @param selecionadas      ids marcados (modo "multipla")
 * @param valor             id escolhido (modo "unica")
 * @param onEscolher        (conta) => void — clique na linha
 * @param ordemSecretarias  ids de secretaria na ordem preferida do usuário
 * @param acoes             conteúdo extra do cabeçalho (ex.: selecionar todas)
 * @param busca             termo da busca, quando a tela controla o campo
 * @param onBuscaChange     (termo) => void; junto de `busca`, deixa a tela usar
 *                          o mesmo termo em ações próprias (ex.: marcar todas
 *                          as contas encontradas)
 * @param altura            classe de altura máxima da área rolável
 */
export default function SeletorContas({
  contas = [],
  modo = "unica",
  selecionadas = [],
  valor = "",
  onEscolher,
  ordemSecretarias = [],
  acoes = null,
  busca: buscaControlada,
  onBuscaChange,
  altura = "max-h-[320px] sm:max-h-[380px]",
  desabilitado = false,
  vazio = "Nenhuma conta cadastrada para esta tela.",
  className = "",
}) {
  const [buscaInterna, setBuscaInterna] = React.useState("");
  const [recolhidos, setRecolhidos] = React.useState(() => new Set());

  const controlado = buscaControlada != null;
  const busca = controlado ? buscaControlada : buscaInterna;
  const mudarBusca = controlado ? (termo) => onBuscaChange?.(termo) : setBuscaInterna;

  const multipla = modo === "multipla";
  const marcadas = React.useMemo(
    () => new Set((multipla ? selecionadas : [valor]).filter((id) => id !== "" && id != null).map(String)),
    [multipla, selecionadas, valor],
  );

  const buscando = busca.trim() !== "";
  // Busca global: percorre todas as contas recebidas, de todas as secretarias.
  const encontradas = React.useMemo(() => filtrarContasCadastradas(contas, busca), [contas, busca]);
  const grupos = React.useMemo(
    () => agruparContasPorSecretaria(contas, { ordem: ordemSecretarias }),
    [contas, ordemSecretarias],
  );

  // Só mexe no conjunto de grupos recolhidos — seleção nenhuma é tocada aqui.
  function alternar(chave) {
    setRecolhidos((atual) => alternarGrupo(atual, chave));
  }

  function escolher(conta) {
    if (desabilitado) return;
    onEscolher?.(conta);
  }

  return (
    <div className={`rounded-xl border border-black/10 bg-white ${className}`}>
      <div className="flex flex-col gap-2 border-b border-black/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
          <input
            type="search"
            value={busca}
            onChange={(evento) => mudarBusca(evento.target.value)}
            placeholder="Buscar conta..."
            aria-label="Buscar conta"
            className="w-full rounded-lg border border-black/10 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-black/25"
          />
        </div>
        {acoes}
      </div>

      {buscando && (
        <p className="px-3 pt-2 text-[11px] text-black/45">
          Busca em todas as secretarias · {encontradas.length}{" "}
          {encontradas.length === 1 ? "conta encontrada" : "contas encontradas"}
        </p>
      )}

      {/* Altura máxima com rolagem interna: a lista rola dentro da caixa e a
          página continua rolando normalmente, no computador e no celular. */}
      <div className={`${altura} overflow-y-auto overscroll-contain px-1.5 py-1.5`}>
        {contas.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-black/45">{vazio}</p>
        ) : buscando ? (
          encontradas.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-black/50">{MENSAGEM_SEM_RESULTADO}</p>
          ) : (
            <ul className="space-y-0.5">
              {encontradas.map((conta) => (
                <LinhaConta
                  key={conta.id}
                  conta={conta}
                  multipla={multipla}
                  marcada={marcadas.has(String(conta.id))}
                  desabilitado={desabilitado}
                  onEscolher={escolher}
                />
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-1">
            {grupos.map((grupo) => {
              const recolhido = grupoRecolhido(recolhidos, grupo.chave);
              const marcadasNoGrupo = selecionadasNoGrupo(grupo, marcadas);
              return (
                <section key={grupo.chave} className="rounded-lg border border-black/5">
                  <button
                    type="button"
                    onClick={() => alternar(grupo.chave)}
                    aria-expanded={!recolhido}
                    className="flex w-full items-center gap-2 rounded-lg bg-black/[0.03] px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-black/70 hover:bg-black/[0.06]"
                  >
                    {recolhido ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span className="flex-1 truncate">{rotuloDoGrupo(grupo)}</span>
                    {marcadasNoGrupo > 0 && (
                      <span className="shrink-0 rounded-full bg-[#0F2A44] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white">
                        {marcadasNoGrupo} selecionada{marcadasNoGrupo === 1 ? "" : "s"}
                      </span>
                    )}
                  </button>

                  {!recolhido && (
                    <ul className="space-y-0.5 p-1">
                      {grupo.contas.map((conta) => (
                        <LinhaConta
                          key={conta.id}
                          conta={conta}
                          multipla={multipla}
                          marcada={marcadas.has(String(conta.id))}
                          desabilitado={desabilitado}
                          onEscolher={escolher}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Uma conta cadastrada: Banco | Nº da Conta | Nome da Conta | Secretaria | Saldo. */
function LinhaConta({ conta, multipla, marcada, desabilitado, onEscolher }) {
  const linha = linhaDaConta(conta);
  return (
    <li>
      <button
        type="button"
        onClick={() => onEscolher(conta)}
        disabled={desabilitado}
        aria-pressed={marcada}
        className={`grid w-full grid-cols-1 items-center gap-x-3 gap-y-0.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-40 sm:grid-cols-[1.1fr_0.9fr_1.3fr_1.1fr_auto] ${
          marcada ? "bg-[#0F2A44]/10 ring-1 ring-inset ring-[#0F2A44]/25" : "hover:bg-black/[0.04]"
        }`}
      >
        <span className="flex items-center gap-1.5 text-black/70">
          {multipla && (
            <span
              aria-hidden="true"
              className={`inline-block h-3.5 w-3.5 shrink-0 rounded border ${
                marcada ? "border-[#0F2A44] bg-[#0F2A44]" : "border-black/25 bg-white"
              }`}
            />
          )}
          <span className="truncate">{linha.banco}</span>
        </span>
        <span className="tabular-nums text-black/70">{linha.numero_conta}</span>
        <span className="truncate font-medium text-[#0F2A44]">{linha.nome_conta}</span>
        <span className="truncate text-[11px] text-black/50">{linha.secretaria}</span>
        <span className="tabular-nums text-right font-semibold text-[#0F2A44] sm:justify-self-end">
          {linha.saldo == null ? "--" : formatBRL(linha.saldo)}
        </span>
      </button>
    </li>
  );
}
