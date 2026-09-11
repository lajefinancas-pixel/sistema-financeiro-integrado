import React from "react";
import { X } from "lucide-react";
import {
  CATEGORIAS_DIARIA,
  CAMPOS_SERVIDOR,
  cpfEmUso,
  mensagemDeCpfDuplicado,
  primeiroErroDoServidor,
  servidorParaFormulario,
  validarServidor,
} from "../../lib/processosServidores.js";
import { dadosDoBancoParaDocumento } from "../../lib/processosBancos.js";
import { nomeOficialDoSolicitante } from "../../lib/processosSecretariasSolicitantes.js";
import SeletorBanco from "./SeletorBanco.jsx";

/**
 * O formulário do cadastro de um SERVIDOR do município.
 *
 * ⚠️ ISTO NÃO É O CADASTRO DE FORNECEDORES. Servidor é quem trabalha no
 * município; fornecedor é quem vende para ele. Gravar aqui NÃO cria, NÃO altera
 * e NÃO duplica nenhum fornecedor -- e o contrário também não acontece.
 *
 * A pessoa é cadastrada UMA VEZ e serve aos dois papéis que os processos pedem:
 * BENEFICIÁRIO da diária (quem viaja) e SIGNATÁRIO dos documentos (quem
 * assina). O papel é escolhido no processo, não aqui.
 *
 * DOCUMENTAL: nada nesta tela debita conta, dá baixa em NF, altera saldo, marca
 * fornecedor como pago ou cria pagamento. A categoria para fins de diária é
 * parâmetro de PREENCHIMENTO do papel -- ela sugere o valor que o documento
 * mostra, e não paga nada a ninguém.
 */
export default function ModalServidor({
  servidor = null,
  servidores = [],
  solicitantes = [],
  bancos = [],
  permissoes = {},
  salvando = false,
  erro = null,
  onFechar,
  onCriar,
  onSalvar,
}) {
  const novo = !servidor?.id;
  const podeEditar = novo ? permissoes.criar === true : permissoes.editar === true;
  const somenteLeitura = !podeEditar;

  const [formulario, setFormulario] = React.useState(() => servidorParaFormulario(servidor));
  const [aviso, setAviso] = React.useState(null);
  const [tentouGravar, setTentouGravar] = React.useState(false);

  React.useEffect(() => {
    setFormulario(servidorParaFormulario(servidor));
    setAviso(null);
    setTentouGravar(false);
  }, [servidor]);

  function definir(chave, valor) {
    setAviso(null);
    setFormulario((atual) => ({ ...atual, [chave]: valor }));
  }

  const erros = React.useMemo(
    () => validarServidor(formulario, { servidores }),
    [formulario, servidores],
  );

  // Só as ATIVAS podem ser escolhidas -- mais a que este cadastro já tem
  // gravada, para que inativar uma secretaria não pareça apagar o dado de quem
  // já estava vinculado a ela.
  const solicitantesDisponiveis = React.useMemo(() => {
    const vinculada = String(formulario.solicitante_id ?? "");
    return (solicitantes ?? []).filter(
      (s) => (s?.situacao ?? "ativo") === "ativo" || String(s?.id) === vinculada,
    );
  }, [solicitantes, formulario.solicitante_id]);

  // O CPF repetido é avisado ENQUANTO SE DIGITA, com o nome de quem já o usa:
  // quem preenche descobre o conflito antes de perder o resto do formulário.
  const conflitoDeCpf = React.useMemo(
    () => cpfEmUso(servidores, formulario.cpf, { ignorarId: formulario.id }),
    [servidores, formulario.cpf, formulario.id],
  );

  async function gravar() {
    setTentouGravar(true);
    const impedimento = primeiroErroDoServidor(erros);
    if (impedimento) {
      setAviso(impedimento);
      return;
    }
    if (novo) await onCriar?.(formulario);
    else await onSalvar?.(formulario.id, formulario);
  }

  const mostrarErro = (campo) => (tentouGravar ? erros[campo] : null);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">
              Processos · Servidores
            </div>
            <h2 className="mt-0.5 text-lg font-semibold text-[#0F2A44]">
              {novo ? "Novo servidor" : formulario.nome || "Servidor"}
            </h2>
            <p className="mt-0.5 text-xs text-[#0F2A44]/55">
              Cadastro dos servidores do município — não é o cadastro de fornecedores.
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            aria-label="Fechar"
            className="rounded-lg border border-black/10 p-1.5 text-[#0F2A44]/60 hover:bg-black/5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
          {erro && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>
          )}
          {aviso && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {aviso}
            </div>
          )}
          {formulario.situacao === "inativo" && (
            <div className="rounded-lg border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-[#0F2A44]/70">
              Este cadastro está <strong>inativo</strong>: ele não é oferecido em processos novos. Os
              processos antigos continuam intactos, com o nome, o CPF e o cargo já gravados neles.
            </div>
          )}

          <Bloco titulo="Identificação">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo rotulo="Nome completo" erro={mostrarErro("nome")} className="sm:col-span-2">
                <input
                  type="text"
                  value={formulario.nome}
                  onChange={(e) => definir("nome", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
              <Campo rotulo="CPF" erro={mostrarErro("cpf")}>
                <input
                  type="text"
                  value={formulario.cpf}
                  onChange={(e) => definir("cpf", e.target.value)}
                  disabled={somenteLeitura}
                  placeholder="000.000.000-00"
                  className={CLASSE_CAMPO}
                />
              </Campo>
              <Campo rotulo="Endereço completo" className="sm:col-span-2">
                <input
                  type="text"
                  value={formulario.endereco}
                  onChange={(e) => definir("endereco", e.target.value)}
                  disabled={somenteLeitura}
                  placeholder="Rua, número, bairro, cidade/UF"
                  className={CLASSE_CAMPO}
                />
              </Campo>
            </div>

            {/* O aviso do CPF repetido, com o nome de quem já o usa. */}
            {conflitoDeCpf && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {mensagemDeCpfDuplicado(conflitoDeCpf)}
              </p>
            )}
          </Bloco>

          <Bloco titulo="Cargo e lotação">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo rotulo="Cargo/Função" erro={mostrarErro("cargo")}>
                <input
                  type="text"
                  value={formulario.cargo}
                  onChange={(e) => definir("cargo", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
              {/* ⚠️ A lista é a das SECRETARIAS SOLICITANTES, o cadastro
                  PRÓPRIO do módulo Processos (Configurações → Processos). Não é
                  o cadastro de secretarias do módulo financeiro, que continua
                  existindo separado, para contas, fornecedores e pagamentos. */}
              <Campo
                rotulo="Secretaria solicitante"
                erro={mostrarErro("solicitante_id")}
                ajuda={
                  solicitantesDisponiveis.length === 0
                    ? "Nenhuma cadastrada ainda. Cadastre em Configurações → Processos."
                    : undefined
                }
              >
                <select
                  value={formulario.solicitante_id}
                  onChange={(e) => definir("solicitante_id", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                >
                  <option value="">Selecione...</option>
                  {solicitantesDisponiveis.map((solicitante) => (
                    <option key={solicitante.id} value={solicitante.id}>
                      {nomeOficialDoSolicitante(solicitante)}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Lotação">
                <input
                  type="text"
                  value={formulario.lotacao}
                  onChange={(e) => definir("lotacao", e.target.value)}
                  disabled={somenteLeitura}
                  placeholder="Setor, departamento ou unidade"
                  className={CLASSE_CAMPO}
                />
              </Campo>
              <Campo
                rotulo="Categoria para fins de diária"
                erro={mostrarErro("categoria_diaria")}
                ajuda="Alimenta o cálculo automático do valor na Requisição de Diárias."
              >
                <select
                  value={formulario.categoria_diaria}
                  onChange={(e) => definir("categoria_diaria", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                >
                  <option value="">Selecione...</option>
                  {CATEGORIAS_DIARIA.map((categoria) => (
                    <option key={categoria.id} value={categoria.id}>
                      {categoria.rotulo}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
          </Bloco>

          <Bloco titulo="Contato (opcional)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo rotulo="Telefone">
                <input
                  type="text"
                  value={formulario.telefone}
                  onChange={(e) => definir("telefone", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
              <Campo rotulo="E-mail" erro={mostrarErro("email")}>
                <input
                  type="text"
                  value={formulario.email}
                  onChange={(e) => definir("email", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
            </div>
          </Bloco>

          <Bloco
            titulo="Dados bancários"
            nota="Vão para o documento da diária quando este servidor for o beneficiário. Informação de papel — nada aqui paga, debita conta ou dá baixa."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* O banco vem do CADASTRO DE BANCOS: lista rolável com busca por
                  número ou nome. O documento imprime "001 — Banco do Brasil". */}
              <SeletorBanco
                bancos={bancos}
                codigo={formulario.banco_codigo}
                nome={formulario.banco}
                somenteLeitura={somenteLeitura}
                ajuda="Do cadastro de Bancos"
                onEscolher={(banco) => {
                  const dados = dadosDoBancoParaDocumento(banco);
                  setAviso(null);
                  setFormulario((atual) => ({ ...atual, banco_codigo: dados.banco_codigo, banco: dados.banco }));
                }}
                onLimpar={() => {
                  setAviso(null);
                  setFormulario((atual) => ({ ...atual, banco_codigo: "", banco: "" }));
                }}
                aoDigitarNome={(valor) => definir("banco", valor)}
              />
              <Campo rotulo="Agência">
                <input
                  type="text"
                  value={formulario.agencia}
                  onChange={(e) => definir("agencia", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
              <Campo rotulo="Conta">
                <input
                  type="text"
                  value={formulario.conta}
                  onChange={(e) => definir("conta", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
              <Campo rotulo="PIX" className="sm:col-span-2">
                <input
                  type="text"
                  value={formulario.pix}
                  onChange={(e) => definir("pix", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
              <Campo rotulo="Titular do PIX">
                <input
                  type="text"
                  value={formulario.pix_titular}
                  onChange={(e) => definir("pix_titular", e.target.value)}
                  disabled={somenteLeitura}
                  className={CLASSE_CAMPO}
                />
              </Campo>
            </div>
          </Bloco>
        </div>

        <div className="flex flex-col gap-3 border-t border-black/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-[#0F2A44]/45">
            Cadastro documental. A exclusão é a inativação — o cadastro nunca é apagado, porque
            processos antigos apontam para ele.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="min-h-[2.75rem] rounded-lg border border-black/10 px-4 py-2.5 text-sm text-[#0F2A44]/70 hover:bg-black/5"
            >
              Fechar
            </button>
            {podeEditar && (
              <button
                type="button"
                onClick={gravar}
                disabled={salvando}
                className="min-h-[2.75rem] rounded-lg bg-[#0F2A44] px-4 py-2.5 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-60"
              >
                {salvando ? "Gravando..." : novo ? "Cadastrar servidor" : "Salvar alterações"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const CLASSE_CAMPO =
  "w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm text-[#0F2A44] disabled:bg-black/[0.03] disabled:text-[#0F2A44]/60";

function Campo({ rotulo, erro = null, ajuda = null, className = "", children }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">{rotulo}</label>
      {children}
      {ajuda && !erro && <p className="mt-1 text-[11px] text-[#0F2A44]/40">{ajuda}</p>}
      {erro && <p className="mt-1 text-[11px] text-red-600">{erro}</p>}
    </div>
  );
}

function Bloco({ titulo, nota = null, children }) {
  return (
    <section className="rounded-xl border border-black/5 bg-white p-4">
      <h3 className="text-sm font-semibold text-[#0F2A44]">{titulo}</h3>
      {nota && <p className="mt-0.5 text-[11px] text-[#0F2A44]/45">{nota}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Os campos que o formulário grava, para os testes conferirem a cobertura. */
export const CAMPOS_DO_FORMULARIO = CAMPOS_SERVIDOR;
