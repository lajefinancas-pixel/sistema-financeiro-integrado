import React from "react";
import { Info, Save } from "lucide-react";
import { Alerta, Campo, CLASSE_ENTRADA, ModalShell } from "../equipe/comuns";
import CampoMoeda from "../CampoMoeda";
import {
  TIPOS_CONTA,
  TIPOS_CHAVE_PIX,
  contaTemPix,
  documentoDoTitularObrigatorio,
  tipoChavePixLabel,
  tipoContaLabel,
  validarCadastroConta,
} from "../../lib/contasBancarias";
import { mensagemAmigavel } from "../../lib/erros";

const OPCAO_NOVA = "__nova__";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cadastro da conta bancária — o mesmo formulário para criar e para editar.
 *
 * Criar: banco, número, nome de uso interno (FPM, TRIBUTOS, FEP...), tipo,
 * secretaria, fonte de recurso quando aplicável e, se a pessoa quiser, o saldo
 * que a conta já tem hoje.
 *
 * Editar: exatamente os mesmos campos de cadastro, SEM nenhum campo de saldo —
 * editar o cadastro não mexe em saldo lançado nem no histórico da conta.
 *
 * @param modo      "novo" | "editar"
 * @param conta     conta sendo editada (modo "editar")
 * @param fontes    catálogo de fontes de recurso; `null` esconde o campo (a
 *                  migration da fonte de recurso ainda não rodou neste banco)
 * @param comPix    `false` esconde agência e PIX (a migration de agência/PIX
 *                  ainda não rodou neste banco); o resto do cadastro salva igual
 * @param onSalvar  async (dados) => void; erros lançados aparecem no modal
 *
 * Os dados de PIX ficam NESTE MESMO formulário, abaixo dos dados da conta: não
 * há aba, botão nem página separada de PIX, e o PIX é gravado no mesmo envio.
 */
export default function ModalContaBancaria({
  modo = "novo",
  conta = null,
  secretarias = [],
  bancos = [],
  fontes = null,
  comPix = true,
  onCancelar,
  onSalvar,
}) {
  const edicao = modo === "editar";
  const [form, setForm] = React.useState(() => ({
    secretaria_id: conta?.secretaria_id != null ? String(conta.secretaria_id) : "",
    secretaria_novo_nome: "",
    nova_secretaria: false,
    banco_id: conta?.banco_id != null ? String(conta.banco_id) : "",
    banco_novo_nome: "",
    novo_banco: false,
    nome_conta: conta?.nome_conta ?? "",
    numero_conta: conta?.numero_conta ?? "",
    agencia: conta?.agencia ?? "",
    possui_pix: contaTemPix(conta?.possui_pix),
    pix_tipo_chave: conta?.pix_tipo_chave ?? "",
    pix_chave: conta?.pix_chave ?? "",
    pix_titular: conta?.pix_titular ?? "",
    pix_documento_titular: conta?.pix_documento_titular ?? "",
    tipo_conta: conta?.tipo_conta ?? "",
    fonte_recurso_id: conta?.fonte_recurso_id != null ? String(conta.fonte_recurso_id) : "",
    fonte_novo_nome: "",
    nova_fonte: false,
    saldo_inicial: "",
    data_saldo: hojeISO(),
  }));
  const [erros, setErros] = React.useState({});
  const [erro, setErro] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);

  function alterar(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
    setErros((atual) => (atual[campo] ? { ...atual, [campo]: undefined } : atual));
  }

  // Tipos antigos foram digitados à mão (o campo era livre): o valor gravado
  // continua na lista para não ser trocado sem a pessoa querer.
  const tipos = React.useMemo(() => {
    const atual = String(conta?.tipo_conta ?? "").trim();
    if (!atual || TIPOS_CONTA.some((tipo) => tipo.id === atual)) return TIPOS_CONTA;
    return [...TIPOS_CONTA, { id: atual, label: tipoContaLabel(atual) }];
  }, [conta?.tipo_conta]);

  // Chave gravada antes com outro tipo continua na lista, para não ser trocada
  // sem a pessoa querer.
  const tiposDeChave = React.useMemo(() => {
    const atual = String(conta?.pix_tipo_chave ?? "").trim();
    if (!atual || TIPOS_CHAVE_PIX.some((tipo) => tipo.id === atual)) return TIPOS_CHAVE_PIX;
    return [...TIPOS_CHAVE_PIX, { id: atual, label: tipoChavePixLabel(atual) }];
  }, [conta?.pix_tipo_chave]);

  const temPix = contaTemPix(form.possui_pix);
  const pedeDocumento = documentoDoTitularObrigatorio(form.pix_tipo_chave);

  // "Não" volta os campos de PIX ao branco: nada de chave órfã guardada.
  function alterarPossuiPix(valor) {
    setForm((atual) =>
      valor
        ? { ...atual, possui_pix: true }
        : {
            ...atual,
            possui_pix: false,
            pix_tipo_chave: "",
            pix_chave: "",
            pix_titular: "",
            pix_documento_titular: "",
          },
    );
    setErros((atual) => ({
      ...atual,
      pix_tipo_chave: undefined,
      pix_chave: undefined,
      pix_titular: undefined,
      pix_documento_titular: undefined,
    }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (salvando) return;

    const validacao = validarCadastroConta(comPix ? form : { ...form, possui_pix: false });
    setErros(validacao.erros);
    if (!validacao.valido) {
      setErro(validacao.mensagem);
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(form);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar o cadastro da conta."));
      setSalvando(false);
    }
  }

  return (
    <ModalShell
      titulo={edicao ? "Editar conta bancária" : "Nova conta bancária"}
      subtitulo={
        edicao
          ? "A edição altera apenas o cadastro: nenhum saldo lançado e nenhum histórico é alterado."
          : "Banco, número, nome de uso interno, tipo e secretaria são obrigatórios."
      }
      largura="max-w-2xl"
      onFechar={salvando ? () => {} : onCancelar}
      rodape={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={salvando}
            className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-conta-bancaria"
            disabled={salvando}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40"
          >
            <Save size={15} />
            {salvando ? "Salvando..." : edicao ? "Salvar alterações" : "Cadastrar conta"}
          </button>
        </div>
      }
    >
      <form id="form-conta-bancaria" onSubmit={enviar} className="space-y-4">
        {erro && <Alerta>{erro}</Alerta>}

        <div className="grid sm:grid-cols-2 gap-4">
          <Campo label="Secretaria" obrigatorio>
            {!form.nova_secretaria ? (
              <select
                value={form.secretaria_id}
                disabled={salvando}
                onChange={(evento) => {
                  if (evento.target.value === OPCAO_NOVA) {
                    setForm((atual) => ({ ...atual, nova_secretaria: true, secretaria_id: "" }));
                    return;
                  }
                  alterar("secretaria_id", evento.target.value);
                  setErros((atual) => ({ ...atual, secretaria: undefined }));
                }}
                className={CLASSE_ENTRADA}
              >
                <option value="">Selecione...</option>
                {secretarias.map((secretaria) => (
                  <option key={secretaria.id} value={secretaria.id}>
                    {secretaria.nome}
                  </option>
                ))}
                <option value={OPCAO_NOVA}>+ Cadastrar nova secretaria</option>
              </select>
            ) : (
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="Nome da nova secretaria"
                  value={form.secretaria_novo_nome}
                  disabled={salvando}
                  onChange={(evento) => {
                    alterar("secretaria_novo_nome", evento.target.value);
                    setErros((atual) => ({ ...atual, secretaria: undefined }));
                  }}
                  className={`${CLASSE_ENTRADA} mt-0`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setForm((atual) => ({ ...atual, nova_secretaria: false, secretaria_novo_nome: "" }))
                  }
                  className="px-3 rounded-lg border border-black/10 text-xs text-[#0F2A44]/60 hover:bg-black/5 whitespace-nowrap"
                >
                  Usar existente
                </button>
              </div>
            )}
            {erros.secretaria && <span className="block text-[11px] text-red-600 mt-1">{erros.secretaria}</span>}
          </Campo>

          <Campo label="Banco" obrigatorio>
            {!form.novo_banco ? (
              <select
                value={form.banco_id}
                disabled={salvando}
                onChange={(evento) => {
                  if (evento.target.value === OPCAO_NOVA) {
                    setForm((atual) => ({ ...atual, novo_banco: true, banco_id: "" }));
                    return;
                  }
                  alterar("banco_id", evento.target.value);
                  setErros((atual) => ({ ...atual, banco: undefined }));
                }}
                className={CLASSE_ENTRADA}
              >
                <option value="">Selecione...</option>
                {bancos.map((banco) => (
                  <option key={banco.id} value={banco.id}>
                    {banco.nome}
                  </option>
                ))}
                <option value={OPCAO_NOVA}>+ Cadastrar novo banco</option>
              </select>
            ) : (
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="Nome do novo banco"
                  value={form.banco_novo_nome}
                  disabled={salvando}
                  onChange={(evento) => {
                    alterar("banco_novo_nome", evento.target.value);
                    setErros((atual) => ({ ...atual, banco: undefined }));
                  }}
                  className={`${CLASSE_ENTRADA} mt-0`}
                />
                <button
                  type="button"
                  onClick={() => setForm((atual) => ({ ...atual, novo_banco: false, banco_novo_nome: "" }))}
                  className="px-3 rounded-lg border border-black/10 text-xs text-[#0F2A44]/60 hover:bg-black/5 whitespace-nowrap"
                >
                  Usar existente
                </button>
              </div>
            )}
            {erros.banco && <span className="block text-[11px] text-red-600 mt-1">{erros.banco}</span>}
          </Campo>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {comPix && (
            <Campo label="Agência" dica="Opcional.">
              <input
                type="text"
                placeholder="Ex: 1234-5"
                value={form.agencia}
                disabled={salvando}
                onChange={(evento) => alterar("agencia", evento.target.value)}
                className={CLASSE_ENTRADA}
              />
              {erros.agencia && <span className="block text-[11px] text-red-600 mt-1">{erros.agencia}</span>}
            </Campo>
          )}

          <Campo label="Número da conta" obrigatorio>
            <input
              type="text"
              placeholder="Ex: 2.042-7"
              value={form.numero_conta}
              disabled={salvando}
              onChange={(evento) => alterar("numero_conta", evento.target.value)}
              className={CLASSE_ENTRADA}
            />
            {erros.numero_conta && (
              <span className="block text-[11px] text-red-600 mt-1">{erros.numero_conta}</span>
            )}
          </Campo>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Campo label="Nome da conta" obrigatorio dica="Nome de uso interno — FPM, TRIBUTOS, FEP.">
            <input
              type="text"
              placeholder="Ex: FPM"
              value={form.nome_conta}
              disabled={salvando}
              onChange={(evento) => alterar("nome_conta", evento.target.value)}
              className={CLASSE_ENTRADA}
            />
            {erros.nome_conta && <span className="block text-[11px] text-red-600 mt-1">{erros.nome_conta}</span>}
          </Campo>

          <Campo label="Tipo de conta" obrigatorio>
            <select
              value={form.tipo_conta}
              disabled={salvando}
              onChange={(evento) => alterar("tipo_conta", evento.target.value)}
              className={CLASSE_ENTRADA}
            >
              <option value="">Selecione...</option>
              {tipos.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.label}
                </option>
              ))}
            </select>
            {erros.tipo_conta && <span className="block text-[11px] text-red-600 mt-1">{erros.tipo_conta}</span>}
          </Campo>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {fontes !== null && (
            <Campo label="Fonte de recurso" dica="Quando aplicável.">
              {!form.nova_fonte ? (
                <select
                  value={form.fonte_recurso_id}
                  disabled={salvando}
                  onChange={(evento) => {
                    if (evento.target.value === OPCAO_NOVA) {
                      setForm((atual) => ({ ...atual, nova_fonte: true, fonte_recurso_id: "" }));
                      return;
                    }
                    alterar("fonte_recurso_id", evento.target.value);
                  }}
                  className={CLASSE_ENTRADA}
                >
                  <option value="">Não se aplica</option>
                  {fontes.map((fonte) => (
                    <option key={fonte.id} value={fonte.id}>
                      {fonte.nome}
                    </option>
                  ))}
                  <option value={OPCAO_NOVA}>+ Cadastrar nova fonte</option>
                </select>
              ) : (
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Nome da fonte de recurso"
                    value={form.fonte_novo_nome}
                    disabled={salvando}
                    onChange={(evento) => alterar("fonte_novo_nome", evento.target.value)}
                    className={`${CLASSE_ENTRADA} mt-0`}
                  />
                  <button
                    type="button"
                    onClick={() => setForm((atual) => ({ ...atual, nova_fonte: false, fonte_novo_nome: "" }))}
                    className="px-3 rounded-lg border border-black/10 text-xs text-[#0F2A44]/60 hover:bg-black/5 whitespace-nowrap"
                  >
                    Usar existente
                  </button>
                </div>
              )}
            </Campo>
          )}
        </div>

        {comPix && (
          <div className="rounded-xl border border-black/5 bg-[#F5F3EF]/70 p-4 space-y-3">
            <Campo label="Possui PIX?" dica="Opcional — conta sem PIX é cadastrada normalmente.">
              <div className="flex gap-2 mt-1">
                {[
                  { valor: true, label: "Sim" },
                  { valor: false, label: "Não" },
                ].map((opcao) => (
                  <button
                    key={opcao.label}
                    type="button"
                    disabled={salvando}
                    onClick={() => alterarPossuiPix(opcao.valor)}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors disabled:opacity-40 ${
                      temPix === opcao.valor
                        ? "border-[#0F2A44] bg-[#0F2A44] text-white"
                        : "border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5"
                    }`}
                  >
                    {opcao.label}
                  </button>
                ))}
              </div>
            </Campo>

            {temPix && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Campo label="Tipo da chave" obrigatorio>
                    <select
                      value={form.pix_tipo_chave}
                      disabled={salvando}
                      onChange={(evento) => {
                        alterar("pix_tipo_chave", evento.target.value);
                        setErros((atual) => ({ ...atual, pix_documento_titular: undefined }));
                      }}
                      className={CLASSE_ENTRADA}
                    >
                      <option value="">Selecione...</option>
                      {tiposDeChave.map((tipo) => (
                        <option key={tipo.id} value={tipo.id}>
                          {tipo.label}
                        </option>
                      ))}
                    </select>
                    {erros.pix_tipo_chave && (
                      <span className="block text-[11px] text-red-600 mt-1">{erros.pix_tipo_chave}</span>
                    )}
                  </Campo>

                  <Campo label="Chave PIX" obrigatorio>
                    <input
                      type="text"
                      value={form.pix_chave}
                      disabled={salvando}
                      onChange={(evento) => alterar("pix_chave", evento.target.value)}
                      className={CLASSE_ENTRADA}
                    />
                    {erros.pix_chave && (
                      <span className="block text-[11px] text-red-600 mt-1">{erros.pix_chave}</span>
                    )}
                  </Campo>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Campo label="Titular" obrigatorio>
                    <input
                      type="text"
                      value={form.pix_titular}
                      disabled={salvando}
                      onChange={(evento) => alterar("pix_titular", evento.target.value)}
                      className={CLASSE_ENTRADA}
                    />
                    {erros.pix_titular && (
                      <span className="block text-[11px] text-red-600 mt-1">{erros.pix_titular}</span>
                    )}
                  </Campo>

                  {pedeDocumento && (
                    <Campo label="CPF/CNPJ do titular" obrigatorio>
                      <input
                        type="text"
                        value={form.pix_documento_titular}
                        disabled={salvando}
                        onChange={(evento) => alterar("pix_documento_titular", evento.target.value)}
                        className={CLASSE_ENTRADA}
                      />
                      {erros.pix_documento_titular && (
                        <span className="block text-[11px] text-red-600 mt-1">
                          {erros.pix_documento_titular}
                        </span>
                      )}
                    </Campo>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {edicao ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-black/5 bg-[#F5F3EF]/70 px-4 py-3 text-[#0F2A44]/70">
            <Info size={15} className="mt-0.5 shrink-0 text-[#0F2A44]/40" />
            <p className="text-xs leading-relaxed">
              O saldo desta conta não é editado aqui. Ele continua vindo dos lançamentos de
              saldos_historico, que permanecem exatamente como estão.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-black/5 bg-[#F5F3EF]/70 p-4 space-y-3">
            <p className="text-xs text-[#0F2A44]/60 leading-relaxed">
              Saldo inicial é opcional. Se informado, ele é lançado em saldos_historico na data
              abaixo, pela mesma rotina do lançamento diário de saldos. Deixando em branco, a conta
              é criada sem saldo e recebe o primeiro lançamento normalmente.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Campo label="Saldo inicial">
                <CampoMoeda
                  placeholder="Deixe em branco se não houver"
                  valor={form.saldo_inicial}
                  disabled={salvando}
                  onValorChange={(numero, texto) => alterar("saldo_inicial", texto === "" ? "" : numero)}
                  className={CLASSE_ENTRADA}
                />
                {erros.saldo_inicial && (
                  <span className="block text-[11px] text-red-600 mt-1">{erros.saldo_inicial}</span>
                )}
              </Campo>
              <Campo label="Data do cadastro">
                <input
                  type="date"
                  value={form.data_saldo}
                  disabled={salvando}
                  onChange={(evento) => alterar("data_saldo", evento.target.value)}
                  className={CLASSE_ENTRADA}
                />
              </Campo>
            </div>
          </div>
        )}
      </form>
    </ModalShell>
  );
}
