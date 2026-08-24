import React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { nomeFornecedor } from "../../lib/certidoes";
import {
  apelidoFornecedor,
  documentoFornecedor,
  filtrarFornecedores,
  rotuloFornecedor,
} from "../../lib/fornecedoresIdentificacao";

/**
 * Campo "Fornecedor" do cadastro de certidão.
 *
 * É um seletor com busca por digitação porque a lista real tem centenas de
 * cadastros e um <select> simples obriga a rolar tudo. A busca cobre nome/razão
 * social, nome fantasia e CPF/CNPJ, e cada opção mostra nome + CPF/CNPJ — é o
 * documento que separa dois cadastros homônimos.
 *
 * A lista vem da view de identificação (só id, nome, documento, secretaria e
 * situação): nenhum dado bancário, valor ou lançamento chega até aqui.
 *
 * Lista de fato vazia não é erro: vira um aviso amigável, nunca uma mensagem
 * técnica de backend.
 */

/** Quantas opções são desenhadas de uma vez; o resto pede um termo de busca. */
const MAXIMO_VISIVEL = 50;

const MENSAGEM_VAZIA = "Nenhum fornecedor disponível para seleção";

export default function SeletorFornecedor({
  fornecedores = [],
  valor,
  aoEscolher,
  carregando = false,
  desabilitado = false,
  obrigatorio = false,
  id = "certidao-fornecedor",
}) {
  const [aberto, setAberto] = React.useState(false);
  const [termo, setTermo] = React.useState("");
  const [destacado, setDestacado] = React.useState(0);

  const caixa = React.useRef(null);
  const entrada = React.useRef(null);

  const selecionado = React.useMemo(
    () => fornecedores.find((f) => String(f.id) === String(valor ?? "")) ?? null,
    [fornecedores, valor],
  );

  const encontrados = React.useMemo(
    () => filtrarFornecedores(fornecedores, aberto ? termo : ""),
    [fornecedores, termo, aberto],
  );
  const visiveis = encontrados.slice(0, MAXIMO_VISIVEL);
  const ocultos = encontrados.length - visiveis.length;

  // Clique fora fecha a lista e devolve o texto do fornecedor escolhido.
  React.useEffect(() => {
    if (!aberto) return undefined;
    function aoClicar(evento) {
      if (!caixa.current?.contains(evento.target)) fechar();
    }
    document.addEventListener("mousedown", aoClicar);
    return () => document.removeEventListener("mousedown", aoClicar);
  }, [aberto]);

  React.useEffect(() => {
    setDestacado(0);
  }, [termo, aberto]);

  function abrir() {
    if (desabilitado) return;
    setTermo("");
    setAberto(true);
  }

  function fechar() {
    setAberto(false);
    setTermo("");
  }

  function escolher(fornecedor) {
    aoEscolher?.(fornecedor ? String(fornecedor.id) : "");
    fechar();
    entrada.current?.blur();
  }

  function aoTeclar(evento) {
    if (evento.key === "Escape") {
      if (aberto) {
        evento.preventDefault();
        fechar();
      }
      return;
    }
    if (!aberto && ["ArrowDown", "ArrowUp", "Enter"].includes(evento.key)) {
      evento.preventDefault();
      abrir();
      return;
    }
    if (!aberto) return;

    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setDestacado((atual) => Math.min(atual + 1, visiveis.length - 1));
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setDestacado((atual) => Math.max(atual - 1, 0));
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      const alvo = visiveis[destacado];
      if (alvo) escolher(alvo);
    } else if (evento.key === "Tab") {
      fechar();
    }
  }

  const listaVazia = fornecedores.length === 0;
  const textoNaCaixa = aberto ? termo : selecionado ? rotuloFornecedor(selecionado) : "";

  const marcador = carregando
    ? "Carregando fornecedores..."
    : listaVazia
      ? MENSAGEM_VAZIA
      : "Buscar por nome, razão social ou CPF/CNPJ";

  return (
    <div className="block">
      <span className="text-xs font-medium text-[#0F2A44]/70">
        Fornecedor
        {obrigatorio && <span className="text-[#C9A227]"> *</span>}
      </span>

      <div className="relative mt-1" ref={caixa}>
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F2A44]/35 pointer-events-none"
          />
          <input
            id={id}
            ref={entrada}
            type="text"
            role="combobox"
            aria-expanded={aberto}
            aria-autocomplete="list"
            aria-controls={`${id}-lista`}
            autoComplete="off"
            value={textoNaCaixa}
            placeholder={marcador}
            disabled={desabilitado || carregando || (listaVazia && !selecionado)}
            onChange={(e) => {
              if (!aberto) setAberto(true);
              setTermo(e.target.value);
            }}
            onFocus={abrir}
            onKeyDown={aoTeclar}
            className={
              "w-full pl-9 pr-16 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] " +
              "outline-none focus:border-[#0F2A44] disabled:bg-black/[0.03] disabled:text-[#0F2A44]/50 " +
              "placeholder:text-[#0F2A44]/40"
            }
          />

          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {selecionado && !desabilitado && (
              <button
                type="button"
                title="Limpar fornecedor"
                onClick={() => {
                  escolher(null);
                  entrada.current?.focus();
                }}
                className="w-7 h-7 rounded-md flex items-center justify-center text-[#0F2A44]/40 hover:text-[#0F2A44] hover:bg-black/5"
              >
                <X size={14} />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Abrir lista de fornecedores"
              disabled={desabilitado || carregando || listaVazia}
              onClick={() => {
                if (aberto) {
                  fechar();
                  return;
                }
                // O foco já abre a lista (onFocus), e deixa a digitação pronta.
                entrada.current?.focus();
              }}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[#0F2A44]/40 hover:text-[#0F2A44] hover:bg-black/5 disabled:opacity-40"
            >
              <ChevronDown size={15} className={aberto ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
          </div>
        </div>

        {aberto && (
          <ul
            id={`${id}-lista`}
            role="listbox"
            className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-black/10 bg-white shadow-lg py-1"
          >
            {visiveis.length === 0 ? (
              <li className="px-3 py-3 text-sm text-[#0F2A44]/55">
                {listaVazia ? MENSAGEM_VAZIA : `Nenhum fornecedor encontrado para "${termo.trim()}".`}
              </li>
            ) : (
              visiveis.map((fornecedor, indice) => {
                const escolhido = String(fornecedor.id) === String(valor ?? "");
                const apelido = apelidoFornecedor(fornecedor);
                const documento = documentoFornecedor(fornecedor);
                const secretaria = String(fornecedor?.secretarias?.nome ?? "").trim();
                const apoio = [documento, apelido, secretaria].filter(Boolean).join(" · ");

                return (
                  <li key={fornecedor.id} role="option" aria-selected={escolhido}>
                    <button
                      type="button"
                      onMouseEnter={() => setDestacado(indice)}
                      onClick={() => escolher(fornecedor)}
                      className={`w-full text-left px-3 py-2 flex items-start gap-2 ${
                        indice === destacado ? "bg-[#F5F3EF]" : "bg-white"
                      }`}
                    >
                      <Check
                        size={14}
                        className={`mt-0.5 shrink-0 ${escolhido ? "text-[#C9A227]" : "text-transparent"}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm text-[#0F2A44] truncate">
                          {nomeFornecedor(fornecedor)}
                          {fornecedor.ativo === false && (
                            <span className="text-[#0F2A44]/45"> (inativo)</span>
                          )}
                        </span>
                        {apoio && <span className="block text-[11px] text-[#0F2A44]/50 truncate">{apoio}</span>}
                      </span>
                    </button>
                  </li>
                );
              })
            )}

            {ocultos > 0 && (
              <li className="px-3 py-2 text-[11px] text-[#0F2A44]/45 border-t border-black/5">
                Mostrando {visiveis.length} de {encontrados.length}. Continue digitando para achar o fornecedor.
              </li>
            )}
          </ul>
        )}
      </div>

      <span className="block text-[11px] text-[#0F2A44]/45 mt-1">
        {listaVazia && !carregando
          ? MENSAGEM_VAZIA + "."
          : "Digite parte do nome, da razão social ou do CPF/CNPJ para encontrar o cadastro."}
      </span>
    </div>
  );
}
