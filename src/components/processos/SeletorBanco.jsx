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

  const escolher = (banco) => {
    onEscolher?.(banco);
    setBusca("");
    setAberto(false);
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
        <>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-black/10 px-3">
            <Search size={14} className="shrink-0 text-[#0F2A44]/40" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              disabled={somenteLeitura}
              placeholder="Buscar por número ou nome (001, bb, brasil...)"
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

          <ul className="mt-2 max-h-44 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10">
            {encontrados.length === 0 ? (
              <li className="px-3 py-2 text-[11px] text-[#0F2A44]/45">
                Nenhum banco com esse número ou nome. Cadastre-o em Configurações → Processos.
              </li>
            ) : (
              encontrados.map((banco) => (
                <li key={banco.id ?? banco.numero}>
                  <button
                    type="button"
                    onClick={() => escolher(banco)}
                    className="block w-full px-3 py-2 text-left hover:bg-black/[0.03]"
                  >
                    <span className="block truncate text-sm text-[#0F2A44]">{rotuloDoBanco(banco)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {erro !== "" && <p className="mt-1 text-[11px] text-[#B3261E]">{erro}</p>}
    </div>
  );
}
