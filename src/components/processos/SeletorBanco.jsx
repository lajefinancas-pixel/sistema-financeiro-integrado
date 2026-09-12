import React from "react";
import { Search, X } from "lucide-react";
import {
  bancoAtendeBusca,
  bancosParaEscolha,
  encontrarBanco,
  numeroDoBancoFormatado,
  rotuloDoBanco,
} from "../../lib/processosBancos.js";

/**
 * A escolha do BANCO: lista rolável com busca por número ou por nome.
 *
 * Antes o banco era texto livre e cada pessoa escrevia de um jeito. Aqui a
 * pessoa digita "001", "bb" ou "brasil" e escolhe na lista; o que fica gravado é
 * o par NÚMERO + NOME, e é ele que o documento imprime — "001 — Banco do
 * Brasil", como no modelo oficial.
 *
 * ⚠️ O par é gravado COMO TEXTO no processo e no cadastro do servidor. Não há
 * chave estrangeira para o cadastro de bancos: corrigir ou inativar um banco lá
 * nunca reescreve documento já emitido.
 *
 * Sem o cadastro no banco de dados (a migration é rodada à mão), o componente
 * cai no campo de texto de sempre: o banco continua podendo ser digitado.
 *
 * ⚠️ O CAMPO OCUPA UMA LINHA, como os vizinhos. A lista NÃO fica aberta embaixo
 * dele: ela aparece só quando se digita, FLUTUA sobre o conteúdo e desaparece ao
 * escolher ou ao sair do campo. Aberta embaixo, ela empurrava Agência, Conta,
 * PIX e Titular para baixo e tomava meia tela. A altura é limitada e a rolagem é
 * DENTRO da lista, com alvos grandes para o toque no iPad.
 */
export default function SeletorBanco({
  bancos = [],
  codigo = "",
  nome = "",
  onEscolher,
  onLimpar,
  somenteLeitura = false,
  rotulo = "Banco",
  ajuda = "",
  erro = "",
  aoDigitarNome,
}) {
  const [busca, setBusca] = React.useState("");
  const [aberto, setAberto] = React.useState(false);
  // A lista existe enquanto se digita, e só: campo em branco é campo de uma
  // linha, sem lista nenhuma embaixo empurrando os outros campos.
  const procurando = String(busca).trim() !== "";

  const disponiveis = React.useMemo(
    () => bancosParaEscolha(bancos, { manterCodigo: codigo }),
    [bancos, codigo],
  );
  const encontrados = React.useMemo(
    () => disponiveis.filter((banco) => bancoAtendeBusca(banco, busca)),
    [disponiveis, busca],
  );

  const escolhido = React.useMemo(
    () => encontrarBanco(bancos, { codigo }),
    [bancos, codigo],
  );
  const temEscolha = numeroDoBancoFormatado(codigo) !== "" || String(nome ?? "").trim() !== "";
  const semCadastro = disponiveis.length === 0;

  // Quantos itens a lista DESENHA. A rolagem é dentro dela, e quem procura um
  // banco específico digita o número ou mais letras -- não rola duzentas linhas.
  const LIMITE_DA_LISTA = 30;
  const mostrados = encontrados.slice(0, LIMITE_DA_LISTA);

  const escolher = (banco) => {
    onEscolher?.(banco);
    // Escolhido, o campo volta a ocupar uma linha: a lista fecha porque a busca
    // se esvazia.
    setBusca("");
    setAberto(false);
  };

  /** Sair do campo fecha a lista. O que foi digitado e não escolhido some. */
  const sairDoCampo = (evento) => {
    // No toque e no clique, o alvo seguinte pode ser um item da própria lista:
    // aí o campo não "saiu", e fechar aqui cancelaria a escolha.
    if (evento?.currentTarget?.contains?.(evento.relatedTarget)) return;
    setBusca("");
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-[#0F2A44]/60">{rotulo}</span>
        {ajuda !== "" && <span className="text-[11px] text-[#0F2A44]/40">{ajuda}</span>}
      </div>

      {/* Sem cadastro de bancos no banco de dados, o campo de texto de sempre:
          nenhuma tela fica travada esperando a migration. */}
      {semCadastro ? (
        <input
          type="text"
          value={nome ?? ""}
          onChange={(e) => aoDigitarNome?.(e.target.value)}
          disabled={somenteLeitura}
          placeholder="Nome do banco"
          className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44]/30 disabled:bg-black/[0.03]"
        />
      ) : temEscolha && !aberto ? (
        <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-[#0F2A44]">
              {rotuloDoBanco({ numero: codigo, nome }) || rotuloDoBanco(escolhido) || "--"}
            </p>
            {numeroDoBancoFormatado(codigo) === "" && (
              <p className="text-[11px] text-[#0F2A44]/40">
                Gravado sem número, antes do cadastro de bancos. Escolha na lista para o documento
                sair com o número.
              </p>
            )}
          </div>
          {!somenteLeitura && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setAberto(true)}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
              >
                Trocar
              </button>
              <button
                type="button"
                onClick={() => onLimpar?.()}
                title="Limpa o banco deste registro."
                className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/50 hover:bg-black/5"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        // `relative` é o que faz a lista flutuar ANCORADA neste campo: ela sai do
        // fluxo da página e não desloca Agência, Conta, PIX e Titular.
        <div className="relative" onBlur={sairDoCampo}>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-black/10 px-3">
            <Search size={14} className="shrink-0 text-[#0F2A44]/40" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setBusca("");
              }}
              disabled={somenteLeitura}
              placeholder="Digite o número ou o nome (001, bb, brasil...)"
              className="w-full bg-transparent py-2 text-sm text-[#0F2A44] outline-none"
            />
            {temEscolha && (
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="shrink-0 text-[11px] text-[#0F2A44]/50 hover:underline"
              >
                Cancelar
              </button>
            )}
          </div>

          {/* A LISTA FLUTUANTE: só existe enquanto se digita. `absolute` e
              `z-20` a põem SOBRE o conteúdo; `max-h-56` com `overflow-y-auto`
              limitam a altura e rolam por dentro; `overscroll-contain` evita que
              a rolagem do dedo arraste o formulário atrás dela. */}
          {procurando && (
            <ul
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 divide-y divide-black/5
                overflow-y-auto overscroll-contain rounded-lg border border-black/10 bg-white shadow-lg"
            >
              {mostrados.length === 0 ? (
                <li className="px-3 py-2.5 text-[11px] text-[#0F2A44]/45">
                  Nenhum banco com esse número ou nome. Cadastre-o em Configurações → Processos.
                </li>
              ) : (
                mostrados.map((banco) => (
                  <li key={banco.id ?? banco.numero}>
                    <button
                      type="button"
                      // No toque, `onClick` chega depois do `blur`: o
                      // `onPointerDown` garante a escolha que o dedo fez.
                      onPointerDown={(e) => {
                        e.preventDefault();
                        escolher(banco);
                      }}
                      onClick={() => escolher(banco)}
                      className="block w-full px-3 py-2.5 text-left hover:bg-black/[0.03] active:bg-black/[0.06]"
                    >
                      <span className="block truncate text-sm text-[#0F2A44]">{rotuloDoBanco(banco)}</span>
                    </button>
                  </li>
                ))
              )}
              {encontrados.length > mostrados.length && (
                <li className="px-3 py-2 text-[11px] text-[#0F2A44]/45">
                  Mostrando {mostrados.length} de {encontrados.length}. Digite mais para afinar a busca.
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {erro !== "" && <p className="mt-1 text-[11px] text-[#B3261E]">{erro}</p>}
    </div>
  );
}
