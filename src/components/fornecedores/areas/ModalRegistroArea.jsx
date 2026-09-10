import React from "react";
import { Search, X } from "lucide-react";
import CampoMoeda from "../../CampoMoeda.jsx";
import {
  SITUACOES_AREA,
  registroParaFormulario,
  registroVazio,
  validarRegistro,
} from "../../../lib/areasFornecedores.js";
import {
  complementoDoFornecedor,
  filtrarFornecedoresPorTermo,
  nomeExibicaoDoFornecedor,
} from "../../../lib/nomesFornecedor.js";

/**
 * Formulário de criar/editar um registro de área (patrocínio, aluguel ou
 * contratação de banda).
 *
 * O primeiro passo é SEMPRE escolher um fornecedor que já existe: a busca é a
 * mesma do resto do sistema (razão social, nome, apelido, CPF/CNPJ). Nenhum
 * fornecedor é cadastrado aqui, e nada é gravado no cadastro dele — o registro
 * apenas aponta para o id. Por isso o mesmo fornecedor pode ter dois
 * patrocínios, um aluguel e três bandas sem duplicar o cadastro.
 *
 * Não existe campo de valor pago: Pago e Saldo saem das baixas das NFs
 * vinculadas ao registro, nunca de um número digitado.
 */
export default function ModalRegistroArea({
  area,
  registro = null,
  fornecedores = [],
  secretarias = [],
  salvando = false,
  erro = null,
  onFechar,
  onSalvar,
}) {
  const editando = Boolean(registro?.id);
  const [formulario, setFormulario] = React.useState(() =>
    editando ? registroParaFormulario(area, registro) : registroVazio(area),
  );
  const [buscaFornecedor, setBuscaFornecedor] = React.useState("");
  const [aviso, setAviso] = React.useState(null);

  const escolhido = React.useMemo(
    () => fornecedores.find((f) => String(f.id) === String(formulario.fornecedor_id)) ?? null,
    [fornecedores, formulario.fornecedor_id],
  );

  const encontrados = React.useMemo(() => {
    if (buscaFornecedor.trim() === "") return [];
    return filtrarFornecedoresPorTermo(fornecedores, buscaFornecedor).slice(0, 30);
  }, [fornecedores, buscaFornecedor]);

  function definir(chave, valor) {
    setAviso(null);
    setFormulario((atual) => ({ ...atual, [chave]: valor }));
  }

  function enviar(evento) {
    evento.preventDefault();
    const conferido = validarRegistro(area, formulario);
    if (!conferido.ok) {
      setAviso(conferido.mensagem);
      return;
    }
    onSalvar?.(formulario, escolhido);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <form
        onSubmit={enviar}
        className="w-full max-w-2xl rounded-2xl border border-black/5 bg-white shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#0F2A44]">
              {editando ? `Editar ${area.singular}` : area.rotuloNovo}
            </h2>
            <p className="mt-0.5 text-xs text-[#0F2A44]/50">
              Escolha um fornecedor já cadastrado. Este registro não altera o cadastro dele.
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            className="rounded-lg p-1.5 text-[#0F2A44]/40 hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {(aviso || erro) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {aviso ?? erro}
            </div>
          )}

          {/* Passo 1: o fornecedor. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">Fornecedor</label>
            {escolhido ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#0F2A44]">
                    {nomeExibicaoDoFornecedor(escolhido)}
                  </p>
                  {complementoDoFornecedor(escolhido) && (
                    <p className="truncate text-[11px] text-[#0F2A44]/50">
                      {complementoDoFornecedor(escolhido)}
                    </p>
                  )}
                  {escolhido.cpf_cnpj && (
                    <p className="text-[11px] text-[#0F2A44]/40">{escolhido.cpf_cnpj}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    definir("fornecedor_id", "");
                    setBuscaFornecedor("");
                  }}
                  className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3">
                  <Search size={14} className="shrink-0 text-[#0F2A44]/40" />
                  <input
                    type="text"
                    autoFocus
                    value={buscaFornecedor}
                    onChange={(e) => setBuscaFornecedor(e.target.value)}
                    placeholder="Buscar por razão social, nome, apelido, CPF ou CNPJ..."
                    className="w-full bg-transparent py-2.5 text-sm outline-none"
                  />
                </div>
                {buscaFornecedor.trim() !== "" && (
                  <div className="mt-1.5 max-h-56 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10">
                    {encontrados.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-[#0F2A44]/50">
                        Nenhum fornecedor encontrado. O fornecedor precisa estar cadastrado na aba
                        Todos antes de entrar nesta área.
                      </p>
                    ) : (
                      encontrados.map((fornecedor) => (
                        <button
                          key={fornecedor.id}
                          type="button"
                          onClick={() => {
                            definir("fornecedor_id", String(fornecedor.id));
                            setBuscaFornecedor("");
                          }}
                          className="block w-full px-3 py-2 text-left hover:bg-[#EAF1FF]"
                        >
                          <span className="block truncate text-sm text-[#0F2A44]">
                            {nomeExibicaoDoFornecedor(fornecedor)}
                          </span>
                          <span className="block truncate text-[11px] text-[#0F2A44]/50">
                            {[complementoDoFornecedor(fornecedor), fornecedor.cpf_cnpj]
                              .filter(Boolean)
                              .join(" • ")}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Passo 2: os campos próprios da área. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {area.campos.map((campo) => (
              <CampoDaArea
                key={campo.chave}
                campo={campo}
                valor={formulario[campo.chave]}
                secretarias={secretarias}
                onChange={(valor) => definir(campo.chave, valor)}
              />
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-[#0F2A44]/45">
            Pago e Saldo não são digitados: eles são calculados a partir das baixas das NFs
            vinculadas a este registro. A baixa continua sendo feita por NF/processo, na aba de
            Baixas.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-4">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg border border-black/10 px-4 py-2.5 text-sm text-[#0F2A44]/70 hover:bg-black/5"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="rounded-lg bg-[#0F2A44] px-4 py-2.5 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
          >
            {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Cadastrar"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Um campo do formulário, do tipo que o descritor da área declarou. */
function CampoDaArea({ campo, valor, secretarias, onChange }) {
  const classe = "w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm";
  const largo = campo.tipo === "textoLongo" || campo.chave === "descricao" || campo.chave === "nome";
  const listaId = `sugestoes-${campo.chave}`;

  return (
    <div className={largo ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">
        {campo.rotulo}
        {campo.obrigatorio && <span className="text-red-500"> *</span>}
      </label>

      {campo.tipo === "textoLongo" && (
        <textarea rows={3} value={valor ?? ""} onChange={(e) => onChange(e.target.value)} className={classe} />
      )}

      {campo.tipo === "texto" && (
        <input
          type="text"
          value={valor ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={campo.exemplo ? `Ex.: ${campo.exemplo}` : undefined}
          className={classe}
        />
      )}

      {campo.tipo === "sugestoes" && (
        <>
          <input
            type="text"
            list={listaId}
            value={valor ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={classe}
          />
          <datalist id={listaId}>
            {(campo.sugestoes ?? []).map((opcao) => (
              <option key={opcao} value={opcao} />
            ))}
          </datalist>
        </>
      )}

      {campo.tipo === "data" && (
        <input type="date" value={valor ?? ""} onChange={(e) => onChange(e.target.value)} className={classe} />
      )}

      {campo.tipo === "moeda" && (
        <CampoMoeda valor={valor ?? ""} onValorChange={(numero) => onChange(numero)} className={classe} />
      )}

      {campo.tipo === "secretaria" && (
        <select value={valor ?? ""} onChange={(e) => onChange(e.target.value)} className={classe}>
          <option value="">Não informada</option>
          {secretarias.map((secretaria) => (
            <option key={secretaria.id} value={secretaria.id}>
              {secretaria.nome}
            </option>
          ))}
        </select>
      )}

      {campo.tipo === "situacao" && (
        <select value={valor ?? "vigente"} onChange={(e) => onChange(e.target.value)} className={classe}>
          {SITUACOES_AREA.map((situacao) => (
            <option key={situacao.value} value={situacao.value}>
              {situacao.label}
            </option>
          ))}
        </select>
      )}

      {campo.ajuda && <p className="mt-1 text-[11px] text-[#0F2A44]/45">{campo.ajuda}</p>}
    </div>
  );
}
