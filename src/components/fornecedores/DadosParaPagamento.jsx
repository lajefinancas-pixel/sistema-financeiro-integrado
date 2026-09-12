import React from "react";
import { CreditCard, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import {
  excluirFormaPagamento,
  listarFormasPagamento,
  salvarDadosBancarios,
} from "../../lib/dadosPagamentoFornecedor";
import {
  TIPOS_DE_CHAVE_PIX,
  TIPOS_DE_CONTA,
  dadosBancariosDaForma,
  dadosBancariosVazios,
  partesPermitidas,
  podeAbrirDadosBancarios,
  resumoDoQueSeraGravado,
  validarDadosBancarios,
} from "../../lib/dadosBancariosUnificados";
import SeletorBanco from "../processos/SeletorBanco";
import { dadosDoBancoParaDocumento } from "../../lib/processosBancos";
import { carregarBancos } from "../../lib/processosCadastrosDados";

const CLASSE_CAMPO = "w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44]/30";

/** Rótulo curto acima de cada campo, para o formulário único ficar legível. */
function Campo({ rotulo, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-[#0F2A44]/60">{rotulo}</span>
      {children}
    </label>
  );
}

/**
 * Dados para pagamento do fornecedor: conta bancária e PIX, num só lugar.
 *
 * ⚠️ UM BOTÃO, UM FORMULÁRIO. Antes eram dois -- "+ Adicionar PIX" e
 * "+ Adicionar Conta Bancária" --, e cadastrar os dados de pagamento de uma
 * mesma pessoa obrigava a abrir dois formulários e digitar o titular duas vezes.
 * Agora "+ Adicionar dados bancários" abre as duas partes juntas, e pode-se
 * preencher só a conta, só o PIX ou os dois.
 *
 * ⚠️ NADA JÁ CADASTRADO É CONVERTIDO, MOVIDO OU APAGADO. Por baixo, a gravação é
 * a de sempre: a parte da conta é o registro bancário, a parte do PIX é o
 * registro de PIX -- o que mantém as permissões separadas, a auditoria por
 * registro e cada conta e cada PIX que já existiam, que continuam na lista
 * abaixo e continuam abrindo para edição.
 *
 * O BANCO não é texto livre: ele vem do cadastro de Bancos (Configurações →
 * Geral) pelo MESMO componente de escolha usado nos documentos, e a escolha na
 * lista preenche NOME e CÓDIGO juntos. Conta gravada antes, com o nome do banco
 * digitado à mão, continua exatamente como está: o campo mostra o que ela
 * gravou, e trocar para um banco da lista só acontece se a pessoa escolher.
 * Sem o cadastro de bancos no banco de dados (a migration é rodada à mão), o
 * componente cai no campo de texto de sempre.
 *
 * Cadastro: nada aqui debita conta, dá baixa em nota, altera saldo ou cria
 * pagamento.
 */
export default function DadosParaPagamento({ fornecedorId, permissoes = {}, onChange }) {
  const [formas, setFormas] = React.useState([]);
  const [form, setForm] = React.useState(null);
  const [bancos, setBancos] = React.useState([]);
  const [erro, setErro] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // A lista de bancos é REFERÊNCIA: só leitura, e a falha dela não impede o
  // cadastro -- o campo volta a ser digitado, como era antes.
  React.useEffect(() => {
    let vivo = true;
    carregarBancos({ apenasAtivos: true })
      .then(({ registros }) => { if (vivo) setBancos(registros); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  const carregar = React.useCallback(async () => {
    try {
      const lista = await listarFormasPagamento(fornecedorId);
      setFormas(lista ?? []);
      onChangeRef.current?.(lista ?? []);
    } catch (e) { setErro(e.message); }
  }, [fornecedorId]);
  React.useEffect(() => { carregar(); }, [carregar]);

  const partes = form ? partesPermitidas(form, permissoes) : { conta: false, pix: false };

  function abrir(forma) {
    setErro(null);
    setForm(forma ? dadosBancariosDaForma(forma) : dadosBancariosVazios());
  }

  function definir(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar(e) {
    e.preventDefault();
    // A conferência é toda aqui, e não em `required` de input: o formulário é um
    // só, e cada parte só é exigida quando está preenchida.
    const problema = validarDadosBancarios(form);
    if (problema) {
      setErro(problema);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await salvarDadosBancarios(fornecedorId, form);
      setForm(null);
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(forma) {
    if (!confirm("Excluir estes dados para pagamento? A alteração ficará registrada na Auditoria.")) return;
    try { await excluirFormaPagamento(fornecedorId, forma); await carregar(); } catch (e) { setErro(e.message); }
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#0F2A44]">Dados para Pagamento</h3>
          <p className="text-xs text-[#0F2A44]/50">
            Conta bancária e PIX ficam protegidos dentro da Vida do Fornecedor, e são cadastrados
            juntos, num formulário só.
          </p>
        </div>
        {/* O BOTÃO ÚNICO. Aparece para quem pode cadastrar pelo menos uma das
            partes; o formulário mostra só as partes permitidas. */}
        {podeAbrirDadosBancarios(permissoes) && (
          <button
            type="button"
            onClick={() => abrir(null)}
            className="flex items-center gap-1 rounded-lg border border-black/10 px-3 py-2 text-xs text-[#0F2A44]/80 hover:bg-black/5"
          >
            <Plus size={13} /> Adicionar dados bancários
          </button>
        )}
      </div>

      {erro && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</div>}

      {/* Os registros JÁ CADASTRADOS -- conta e PIX, cada um como está. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {formas.map((forma) => (
          <div key={forma.id} className="rounded-lg border border-black/10 p-3 text-xs text-[#0F2A44]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold">
                <CreditCard size={14} />
                {forma.kind === "pix" ? `PIX — ${forma.pixKeyType || "chave"}` : forma.bankName}
              </div>
              {forma.isPrimary && (
                <span className="flex items-center gap-1 text-amber-700">
                  <Star size={12} fill="currentColor" /> Principal
                </span>
              )}
            </div>
            <div className="mt-2 space-y-1 text-[#0F2A44]/65">
              {forma.kind === "pix" ? (
                <div className="break-all">{forma.pixKey}</div>
              ) : (
                <>
                  <div>
                    Agência {forma.agency || "--"} · Conta {forma.account || "--"}
                    {forma.accountDigit ? `-${forma.accountDigit}` : ""}
                  </div>
                  <div>{forma.accountType || "Conta"}</div>
                </>
              )}
              <div>Titular: {forma.holderName}</div>
              <div>CPF/CNPJ: {forma.holderDocument || "--"}</div>
            </div>
            <div className="mt-3 flex gap-2">
              {permissoes[forma.kind === "pix" ? "editar_pix" : "editar_dados_bancarios"] && (
                <button type="button" onClick={() => abrir(forma)} className="flex items-center gap-1 text-[#0F2A44]/70">
                  <Pencil size={12} /> Editar
                </button>
              )}
              {permissoes.excluir_dados_bancarios && (
                <button type="button" onClick={() => excluir(forma)} className="flex items-center gap-1 text-red-600">
                  <Trash2 size={12} /> Excluir
                </button>
              )}
            </div>
          </div>
        ))}
        {!formas.length && <div className="text-xs text-[#0F2A44]/45">Dados para pagamento pendentes.</div>}
      </div>

      {/* O FORMULÁRIO ÚNICO: conta e PIX juntos, preenchíveis em qualquer
          combinação. */}
      {form && (
        <form onSubmit={salvar} noValidate className="mt-4 rounded-xl bg-[#F5F7F8] p-4">
          <div className="mb-1 flex items-center justify-between">
            <strong className="text-sm text-[#0F2A44]">
              {form.contaId || form.pixId ? "Editar dados bancários" : "Adicionar dados bancários"}
            </strong>
            <button type="button" onClick={() => setForm(null)} title="Fechar sem salvar">
              <X size={16} />
            </button>
          </div>
          <p className="mb-3 text-[11px] text-[#0F2A44]/50">
            Preencha a conta, o PIX, ou os dois — uma das duas partes já basta para salvar.
          </p>

          {partes.conta && (
            <fieldset className="rounded-lg border border-black/10 bg-white p-3">
              <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-[#0F2A44]/50">
                Conta bancária
              </legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  {/* A escolha na lista preenche NOME e CÓDIGO juntos. */}
                  <SeletorBanco
                    bancos={bancos}
                    codigo={form.bankCode}
                    nome={form.bankName}
                    rotulo="Banco"
                    ajuda="Do cadastro de Bancos"
                    onEscolher={(banco) => {
                      const dados = dadosDoBancoParaDocumento(banco);
                      setErro(null);
                      setForm((atual) => ({ ...atual, bankName: dados.banco, bankCode: dados.banco_codigo }));
                    }}
                    onLimpar={() => setForm((atual) => ({ ...atual, bankName: "", bankCode: "" }))}
                    aoDigitarNome={(valor) => definir("bankName", valor)}
                  />
                </div>
                <Campo rotulo="Agência">
                  <input value={form.agency} onChange={(e) => definir("agency", e.target.value)} className={CLASSE_CAMPO} />
                </Campo>
                <Campo rotulo="Conta">
                  <input value={form.account} onChange={(e) => definir("account", e.target.value)} className={CLASSE_CAMPO} />
                </Campo>
                <Campo rotulo="Dígito">
                  <input value={form.accountDigit} onChange={(e) => definir("accountDigit", e.target.value)} className={CLASSE_CAMPO} />
                </Campo>
                <Campo rotulo="Tipo de conta">
                  <select value={form.accountType} onChange={(e) => definir("accountType", e.target.value)} className={CLASSE_CAMPO}>
                    {TIPOS_DE_CONTA.map((tipo) => (
                      <option key={tipo.id} value={tipo.id}>{tipo.rotulo}</option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="Nome do titular">
                  <input value={form.holderName} onChange={(e) => definir("holderName", e.target.value)} className={CLASSE_CAMPO} />
                </Campo>
                <Campo rotulo="CPF/CNPJ do titular">
                  <input value={form.holderDocument} onChange={(e) => definir("holderDocument", e.target.value)} className={CLASSE_CAMPO} />
                </Campo>
              </div>
            </fieldset>
          )}

          {partes.pix && (
            <fieldset className={`rounded-lg border border-black/10 bg-white p-3 ${partes.conta ? "mt-3" : ""}`}>
              <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-[#0F2A44]/50">
                PIX
              </legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Campo rotulo="Tipo de chave">
                  <select value={form.pixKeyType} onChange={(e) => definir("pixKeyType", e.target.value)} className={CLASSE_CAMPO}>
                    {TIPOS_DE_CHAVE_PIX.map((tipo) => (
                      <option key={tipo.id} value={tipo.id}>{tipo.rotulo}</option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="Chave PIX">
                  <input value={form.pixKey} onChange={(e) => definir("pixKey", e.target.value)} className={CLASSE_CAMPO} />
                </Campo>
                <Campo rotulo="Titular do PIX">
                  <input
                    value={form.pixHolderName}
                    onChange={(e) => definir("pixHolderName", e.target.value)}
                    placeholder={partes.conta ? "O mesmo titular da conta" : ""}
                    className={CLASSE_CAMPO}
                  />
                </Campo>
                {/* O CPF/CNPJ do titular é UM campo, e vale para as duas partes.
                    Ele mora na conta; sem a parte da conta à vista -- quem só
                    pode cadastrar PIX --, aparece aqui, para o documento de quem
                    recebe não ficar de fora. */}
                {!partes.conta && (
                  <Campo rotulo="CPF/CNPJ do titular">
                    <input value={form.holderDocument} onChange={(e) => definir("holderDocument", e.target.value)} className={CLASSE_CAMPO} />
                  </Campo>
                )}
              </div>
            </fieldset>
          )}

          {!partes.conta && !partes.pix && (
            <p className="text-xs text-[#0F2A44]/55">
              Você não tem permissão para cadastrar dados bancários nem PIX neste cadastro.
            </p>
          )}

          <label className="mt-3 flex items-center gap-2 text-sm text-[#0F2A44]">
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => definir("isPrimary", e.target.checked)} />
            Marcar como principal
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              disabled={salvando || (!partes.conta && !partes.pix)}
              className="rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Salvar dados"}
            </button>
            <span className="text-[11px] text-[#0F2A44]/45">{resumoDoQueSeraGravado(form)}</span>
          </div>
        </form>
      )}
    </section>
  );
}
