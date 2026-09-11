import React from "react";
import { Check, Eye, FileCheck2, Search, X } from "lucide-react";
import CampoMoeda from "../CampoMoeda.jsx";
import {
  CAMPOS_COMPARTILHADOS,
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  TITULO_PAGINA_3,
  TRANSPORTES,
  aplicarCalculo,
  dadosDoFornecedorParaDocumento,
  numeroDoProcesso,
  primeiroErro,
  processoParaFormulario,
  sincronizarLiquidacao,
  situacaoInfo,
  soltarVinculoDeCadastro,
  tituloDoProcesso,
  totalDivergeDoCalculo,
  valorNaLiquidacao,
  valorTotalCalculado,
  validarFinalizacao,
  validarRascunho,
} from "../../lib/processosDiarias.js";
import { formatBRL } from "../../lib/moeda.js";
import {
  complementoDoFornecedor,
  filtrarFornecedoresPorTermo,
  nomeExibicaoDoFornecedor,
} from "../../lib/nomesFornecedor.js";

/**
 * O PROCESSO DE DIÁRIA: um documento administrativo com TRÊS páginas, em uma
 * tela só.
 *
 * Requisição, Liquidação/Pagamento e Prestação de Contas NÃO são registros
 * independentes e não têm aba separada na lista: são as três páginas do MESMO
 * processo, com o MESMO número. Aqui elas aparecem como três seções, e os Dados
 * Gerais -- que valem para as três -- são digitados UMA VEZ.
 *
 * A PRESTAÇÃO DE CONTAS PODE FICAR PARA DEPOIS. Ela é preenchida quando o
 * servidor volta da viagem, e estar pendente não impede salvar, finalizar nem
 * imprimir a Requisição e a Liquidação.
 *
 * A sincronização é estrutural: os dados compartilhados são as mesmas colunas
 * do mesmo registro, então alterar um deles na Requisição já altera o que a
 * Liquidação mostra. Os quatro campos que a Liquidação tem em separado (datas,
 * quantidade e valor realizados) acompanham a página 1 enquanto estiverem
 * espelhando-a, e param de acompanhar no instante em que recebem um valor
 * próprio -- `sincronizarLiquidacao` nunca apaga o que a Liquidação já tem.
 *
 * ESTE DOCUMENTO NÃO É FINANCEIRO. Preencher, salvar ou finalizar não debita
 * conta, não dá baixa em NF, não altera saldo, não marca fornecedor como pago,
 * não cria pagamento e não mexe na Programação Diária. Finalizar fecha o papel,
 * e nada mais: FINALIZAR NÃO É PAGAR.
 */

const SECOES = [
  { id: "gerais", rotulo: "Dados Gerais" },
  { id: "requisicao", rotulo: `1. ${tituloDeSecao(TITULO_PAGINA_1)}` },
  { id: "liquidacao", rotulo: `2. ${tituloDeSecao(TITULO_PAGINA_2)}` },
  { id: "prestacao", rotulo: `3. ${tituloDeSecao(TITULO_PAGINA_3)}` },
];

function tituloDeSecao(titulo) {
  return titulo.charAt(0) + titulo.slice(1).toLowerCase();
}

/** Intervalo do salvamento automático: grava logo depois de a pessoa parar. */
const ESPERA_AUTOSSALVAMENTO = 2500;

export default function ModalProcessoDiaria({
  processo = null,
  fornecedores = [],
  secretarias = [],
  permissoes = {},
  salvando = false,
  erro = null,
  ultimoSalvamento = null,
  // O formulário inicial de uma duplicação (já vem com os dados copiados).
  inicial = null,
  onFechar,
  onCriar,
  onSalvar,
  onFinalizar,
  onPreVisualizar,
}) {
  const [formulario, setFormulario] = React.useState(() =>
    processo ? processoParaFormulario(processo) : (inicial ?? processoParaFormulario(null)),
  );
  const [secao, setSecao] = React.useState("gerais");
  const [buscaFornecedor, setBuscaFornecedor] = React.useState("");
  const [aviso, setAviso] = React.useState(null);
  const [sujo, setSujo] = React.useState(false);

  const criado = Boolean(processo?.id);
  const rascunho = (formulario.situacao ?? "rascunho") === "rascunho";
  const somenteLeitura = !rascunho || (criado && permissoes.editar !== true);
  const podeGravar = rascunho && (criado ? permissoes.editar === true : permissoes.criar === true);

  const sujoRef = React.useRef(false);
  React.useEffect(() => {
    sujoRef.current = sujo;
  }, [sujo]);

  // O registro recarregado do banco reaparece no formulário -- mas nunca em
  // cima do que está sendo digitado, para o salvamento automático não puxar o
  // cursor de volta.
  React.useEffect(() => {
    if (!processo?.id) return;
    setFormulario((atual) =>
      atual.id === processo.id && sujoRef.current ? atual : processoParaFormulario(processo),
    );
  }, [processo]);

  /**
   * SALVAMENTO AUTOMÁTICO. Grava sozinho pouco depois de a pessoa parar de
   * digitar, para que fechar a tela, perder a sessão ou oscilar a internet não
   * perca o trabalho. Só entra depois do primeiro salvamento, porque é ele que
   * emite o número do processo -- e número emitido nunca volta para a fila.
   */
  React.useEffect(() => {
    if (!sujo || !criado || !podeGravar || salvando) return undefined;
    const relogio = setTimeout(() => {
      Promise.resolve(onSalvar?.(formulario, { silencioso: true })).then((ok) => {
        if (ok !== false) setSujo(false);
      });
    }, ESPERA_AUTOSSALVAMENTO);
    return () => clearTimeout(relogio);
  }, [sujo, criado, podeGravar, salvando, formulario, onSalvar]);

  function definir(chave, valor) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => {
      const alterado = aplicarCalculo({ ...atual, [chave]: valor });
      // Só os campos compartilhados propagam; os específicos da Liquidação
      // ficam intactos.
      return CAMPOS_COMPARTILHADOS.includes(chave) || chave === "quantidade_diarias"
        ? sincronizarLiquidacao(atual, alterado)
        : alterado;
    });
  }

  /**
   * Assumir o valor total à mão: fica registrado, e vai para a auditoria.
   *
   * Passa por `aplicarCalculo` para o VALOR POR EXTENSO acompanhar o número
   * digitado -- o quadro do documento sairia contraditório se não acompanhasse.
   */
  function definirTotalManual(valor) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) =>
      sincronizarLiquidacao(atual, aplicarCalculo({ ...atual, valor_total: valor, valor_total_manual: true })),
    );
  }

  /** Assumir a redação do extenso à mão: o automático para de sobrescrever. */
  function definirExtensoManual(valor) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => ({ ...atual, valor_extenso: valor, valor_extenso_manual: true }));
  }

  function voltarAoExtensoAutomatico() {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => aplicarCalculo({ ...atual, valor_extenso_manual: false }));
  }

  function voltarAoCalculo() {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => sincronizarLiquidacao(atual, aplicarCalculo({ ...atual, valor_total_manual: false })));
  }

  /**
   * Puxa os dados de um fornecedor/servidor JÁ CADASTRADO para o documento.
   * Copia informação PARA CÁ: nada é gravado no cadastro dele.
   */
  function puxarDoCadastro(fornecedor) {
    setAviso(null);
    setSujo(true);
    setBuscaFornecedor("");
    setFormulario((atual) => {
      const dados = dadosDoFornecedorParaDocumento(fornecedor);
      // O que o documento já tem preenchido à mão não é sobrescrito por um
      // campo vazio do cadastro.
      const mesclado = { ...atual };
      Object.entries(dados).forEach(([chave, valor]) => {
        if (chave === "fornecedor_id" || String(valor ?? "").trim() !== "") mesclado[chave] = valor;
      });
      return sincronizarLiquidacao(atual, mesclado);
    });
  }

  function preencherAMao() {
    setAviso(null);
    setSujo(true);
    setBuscaFornecedor("");
    // Soltar o vínculo NÃO cria fornecedor nenhum e não apaga o que já foi
    // digitado no documento.
    setFormulario((atual) => soltarVinculoDeCadastro(atual));
  }

  async function salvar() {
    const erros = validarRascunho(formulario);
    const impedimento = primeiroErro(erros);
    if (impedimento) {
      setAviso(impedimento);
      setSecao("gerais");
      return;
    }
    const ok = criado ? await onSalvar?.(formulario, { silencioso: false }) : await onCriar?.(formulario);
    if (ok !== false) setSujo(false);
  }

  async function finalizar() {
    const erros = validarFinalizacao(formulario);
    const impedimento = primeiroErro(erros);
    if (impedimento) {
      setAviso(impedimento);
      setSecao(erros.secretaria_id || erros.data_processo ? "gerais" : "requisicao");
      return;
    }
    if (!criado) {
      setAviso("Salve o rascunho primeiro: é nele que o número do processo é emitido.");
      return;
    }
    const ok = await onFinalizar?.(formulario);
    if (ok !== false) setSujo(false);
  }

  const escolhido = React.useMemo(
    () => fornecedores.find((f) => String(f.id) === String(formulario.fornecedor_id)) ?? null,
    [fornecedores, formulario.fornecedor_id],
  );
  const encontrados = React.useMemo(() => {
    if (buscaFornecedor.trim() === "") return [];
    return filtrarFornecedoresPorTermo(fornecedores, buscaFornecedor).slice(0, 20);
  }, [fornecedores, buscaFornecedor]);

  const situacao = situacaoInfo(formulario.situacao);
  const numero = numeroDoProcesso(formulario);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-6 sm:px-4 sm:py-8">
      <div className="w-full max-w-4xl rounded-2xl border border-black/5 bg-white shadow-lg">
        {/* Cabeçalho: o número do processo é o mesmo nas três páginas. */}
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">
              Processos · Diárias
            </div>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-[#0F2A44]">
              {tituloDoProcesso(formulario)}
            </h2>
            <p className="mt-0.5 text-xs text-[#0F2A44]/50">
              {numero === ""
                ? "O número é emitido no primeiro salvamento e vale para as três páginas."
                : "Um processo, três páginas — as três com este número."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] ${situacao.classe}`}>{situacao.rotulo}</span>
            <button
              type="button"
              onClick={onFechar}
              title="Fechar (o rascunho continua salvo)"
              className="rounded-lg p-1.5 text-[#0F2A44]/40 hover:bg-black/5"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* As quatro seções da tela: os dados gerais e as três páginas. */}
        <div className="flex flex-wrap gap-1.5 border-b border-black/5 px-5 py-3">
          {SECOES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSecao(item.id)}
              aria-current={secao === item.id}
              className={`min-h-[2.25rem] rounded-lg px-3 py-2 text-[13px] transition-colors ${
                secao === item.id
                  ? "bg-[#0F2A44] text-white"
                  : "border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
              }`}
            >
              {item.rotulo}
            </button>
          ))}
        </div>

        <div className="max-h-[62vh] space-y-5 overflow-y-auto px-5 py-4">
          {(aviso || erro) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {aviso ?? erro}
            </div>
          )}

          {!rascunho && (
            <div className="rounded-lg border border-[#0F2A44]/10 bg-[#F8FAFC] px-4 py-3 text-sm text-[#0F2A44]/70">
              {formulario.situacao === "cancelada"
                ? "Processo cancelado: o registro, o número e o histórico foram preservados, e o documento não é mais alterado."
                : "Processo finalizado: o documento está fechado para alteração. Para corrigir, reabra na lista."}
            </div>
          )}

          {secao === "gerais" && (
            <SecaoDadosGerais
              formulario={formulario}
              secretarias={secretarias}
              somenteLeitura={somenteLeitura}
              definir={definir}
              escolhido={escolhido}
              encontrados={encontrados}
              busca={buscaFornecedor}
              onBusca={setBuscaFornecedor}
              onPuxar={puxarDoCadastro}
              onAMao={preencherAMao}
            />
          )}

          {secao === "requisicao" && (
            <SecaoRequisicao
              formulario={formulario}
              secretarias={secretarias}
              somenteLeitura={somenteLeitura}
              definir={definir}
              definirTotalManual={definirTotalManual}
              voltarAoCalculo={voltarAoCalculo}
              definirExtensoManual={definirExtensoManual}
              voltarAoExtensoAutomatico={voltarAoExtensoAutomatico}
            />
          )}

          {secao === "liquidacao" && (
            <SecaoLiquidacao
              formulario={formulario}
              secretarias={secretarias}
              somenteLeitura={somenteLeitura}
              definir={definir}
            />
          )}

          {secao === "prestacao" && (
            <SecaoPrestacao
              formulario={formulario}
              somenteLeitura={somenteLeitura}
              definir={definir}
            />
          )}
        </div>

        {/* Rodapé: salvar, finalizar e pré-visualizar. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-black/5 px-5 py-4">
          <div className="mr-auto text-[11px] text-[#0F2A44]/45">
            {salvando
              ? "Salvando..."
              : sujo && criado
                ? "Alterações ainda não salvas — o salvamento automático grava em instantes."
                : ultimoSalvamento
                  ? `Alterações salvas — último salvamento ${ultimoSalvamento}`
                  : "Rascunho pode ser salvo a qualquer momento, sem as três páginas completas."}
          </div>

          {permissoes.imprimir && criado && (
            <button
              type="button"
              onClick={() => onPreVisualizar?.(formulario)}
              className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-black/10 px-4 py-2 text-sm text-[#0F2A44]/70 hover:bg-black/5"
            >
              <Eye size={15} /> Pré-visualizar
            </button>
          )}

          {podeGravar && (
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-[#0F2A44]/20 px-4 py-2 text-sm text-[#0F2A44] hover:bg-black/5 disabled:opacity-60"
            >
              <Check size={15} /> {criado ? "Salvar" : "Salvar rascunho"}
            </button>
          )}

          {permissoes.finalizar && rascunho && (
            <button
              type="button"
              onClick={finalizar}
              disabled={salvando || !criado}
              title="Fecha o documento para alteração. Finalizar não é pagar."
              className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-60"
            >
              <FileCheck2 size={15} /> Finalizar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Campos
 * ---------------------------------------------------------------------- */

const CLASSE_CAMPO =
  "w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm text-[#0F2A44] disabled:bg-black/[0.03] disabled:text-[#0F2A44]/60";

function Campo({ rotulo, apoio = null, children, className = "" }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">{rotulo}</label>
      {children}
      {apoio && <p className="mt-1 text-[11px] text-[#0F2A44]/40">{apoio}</p>}
    </div>
  );
}

function CampoTexto({ rotulo, valor, onChange, desabilitado, apoio, tipo = "text", className = "", ...resto }) {
  return (
    <Campo rotulo={rotulo} apoio={apoio} className={className}>
      <input
        type={tipo}
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={desabilitado}
        className={CLASSE_CAMPO}
        {...resto}
      />
    </Campo>
  );
}

function CampoArea({ rotulo, valor, onChange, desabilitado, apoio, linhas = 4, className = "" }) {
  return (
    <Campo rotulo={rotulo} apoio={apoio} className={className}>
      <textarea
        rows={linhas}
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={desabilitado}
        className={`${CLASSE_CAMPO} resize-y`}
      />
    </Campo>
  );
}

/** Os dados bancários do documento — não são o cadastro de ninguém. */
function DadosBancarios({ formulario, somenteLeitura, definir }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <CampoTexto rotulo="Banco" valor={formulario.banco} onChange={(v) => definir("banco", v)} desabilitado={somenteLeitura} />
      <CampoTexto rotulo="Agência" valor={formulario.agencia} onChange={(v) => definir("agencia", v)} desabilitado={somenteLeitura} />
      <CampoTexto rotulo="Conta" valor={formulario.conta} onChange={(v) => definir("conta", v)} desabilitado={somenteLeitura} />
      <CampoTexto rotulo="Chave PIX" valor={formulario.pix} onChange={(v) => definir("pix", v)} desabilitado={somenteLeitura} />
      <CampoTexto
        rotulo="Titular"
        valor={formulario.titular}
        onChange={(v) => definir("titular", v)}
        desabilitado={somenteLeitura}
        className="sm:col-span-2"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Dados Gerais: digitados uma vez, valem para as três páginas
 * ---------------------------------------------------------------------- */

function SecaoDadosGerais({
  formulario,
  secretarias,
  somenteLeitura,
  definir,
  escolhido,
  encontrados,
  busca,
  onBusca,
  onPuxar,
  onAMao,
}) {
  return (
    <>
      <p className="rounded-lg border border-[#C9A227]/25 bg-[#FFFBEF] px-4 py-3 text-xs leading-relaxed text-[#0F2A44]/70">
        Estes dados valem para as TRÊS páginas do processo: digite uma vez e eles aparecem na
        Requisição, na Liquidação e na Prestação de Contas. Este é um documento — preencher, salvar ou
        finalizar não debita conta, não dá baixa em NF e não altera saldo nenhum.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CampoTexto
          rotulo="Data do processo"
          tipo="date"
          valor={formulario.data_processo}
          onChange={(v) => definir("data_processo", v)}
          desabilitado={somenteLeitura}
        />
        <Campo rotulo="Secretaria" apoio="As secretarias já cadastradas no sistema.">
          <select
            value={formulario.secretaria_id ?? ""}
            onChange={(e) => definir("secretaria_id", e.target.value)}
            disabled={somenteLeitura}
            className={CLASSE_CAMPO}
          >
            <option value="">Escolha a secretaria...</option>
            {secretarias.map((secretaria) => (
              <option key={secretaria.id} value={secretaria.id}>
                {secretaria.nome}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {/* O beneficiário: do cadastro ou à mão. */}
      <div>
        <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">
          Beneficiário no cadastro (opcional)
        </label>
        {escolhido ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#0F2A44]">{nomeExibicaoDoFornecedor(escolhido)}</p>
              {complementoDoFornecedor(escolhido) && (
                <p className="truncate text-[11px] text-[#0F2A44]/50">{complementoDoFornecedor(escolhido)}</p>
              )}
              <p className="text-[11px] text-[#0F2A44]/40">
                Vínculo interno preservado. O que você editar abaixo vale só neste documento.
              </p>
            </div>
            {!somenteLeitura && (
              <button
                type="button"
                onClick={onAMao}
                title="Solta o vínculo com o cadastro. O texto já digitado continua no documento."
                className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
              >
                Soltar vínculo
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3">
              <Search size={14} className="shrink-0 text-[#0F2A44]/40" />
              <input
                type="text"
                value={busca}
                onChange={(e) => onBusca(e.target.value)}
                disabled={somenteLeitura}
                placeholder="Buscar por razão social, nome, apelido ou CPF/CNPJ..."
                className="w-full bg-transparent py-2.5 text-sm text-[#0F2A44] outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-[#0F2A44]/40">
              Opcional: se a pessoa não estiver cadastrada, preencha os campos abaixo à mão. Preencher
              à mão NÃO cria fornecedor no cadastro principal.
            </p>
            {encontrados.length > 0 && (
              <ul className="mt-2 max-h-52 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10">
                {encontrados.map((fornecedor) => (
                  <li key={fornecedor.id}>
                    <button
                      type="button"
                      onClick={() => onPuxar(fornecedor)}
                      className="block w-full px-3 py-2.5 text-left hover:bg-black/[0.03]"
                    >
                      <span className="block truncate text-sm text-[#0F2A44]">
                        {nomeExibicaoDoFornecedor(fornecedor)}
                      </span>
                      <span className="block truncate text-[11px] text-[#0F2A44]/45">
                        {[complementoDoFornecedor(fornecedor), fornecedor.cpf_cnpj].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CampoTexto
          rotulo="Nome do beneficiário"
          valor={formulario.beneficiario_nome}
          onChange={(v) => definir("beneficiario_nome", v)}
          desabilitado={somenteLeitura}
          apoio="Editar aqui muda só este documento — nunca o cadastro."
        />
        <CampoTexto
          rotulo="CPF"
          valor={formulario.beneficiario_cpf}
          onChange={(v) => definir("beneficiario_cpf", v)}
          desabilitado={somenteLeitura}
        />
        <CampoTexto
          rotulo="Endereço do servidor"
          valor={formulario.beneficiario_endereco}
          onChange={(v) => definir("beneficiario_endereco", v)}
          desabilitado={somenteLeitura}
          className="sm:col-span-2"
          apoio="Sai na identificação do servidor (página 1) e no favorecido (página 2)."
        />
      </div>

      <CampoArea
        rotulo="Objetivando (objeto do processo)"
        valor={formulario.objeto}
        onChange={(v) => definir("objeto", v)}
        desabilitado={somenteLeitura}
        linhas={2}
        apoio="É o campo Objetivando das páginas 1 e 2. A justificativa detalhada fica na Requisição."
      />

      <div className="rounded-lg border border-black/10 bg-[#F8FAFC] px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-[#0F2A44]/50">
            Valor total do processo
          </span>
          <strong className="text-xl text-[#0F2A44]">{formatBRL(formulario.valor_total)}</strong>
        </div>
        <p className="mt-1 text-[11px] text-[#0F2A44]/45">
          Calculado na Requisição (quantidade × valor unitário). É o valor do documento: nenhum
          pagamento é criado e nenhuma conta é debitada por ele.
        </p>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Página 1: Requisição de Diárias
 * ---------------------------------------------------------------------- */

function SecaoRequisicao({
  formulario,
  secretarias,
  somenteLeitura,
  definir,
  definirTotalManual,
  voltarAoCalculo,
  definirExtensoManual,
  voltarAoExtensoAutomatico,
}) {
  const calculado = valorTotalCalculado(formulario);
  const diverge = totalDivergeDoCalculo(formulario);
  const secretaria = secretarias.find((s) => String(s.id) === String(formulario.secretaria_id))?.nome ?? "--";

  return (
    <>
      <p className="rounded-lg border border-[#0F2A44]/10 bg-[#F8FAFC] px-4 py-3 text-xs leading-relaxed text-[#0F2A44]/70">
        A página 1 do modelo oficial: <strong>Requisição de Diárias</strong>, na conformidade da Lei
        Municipal nº 003/2005. Ela é assinada pelo servidor, pelo responsável pela secretaria e pela
        prefeita.
      </p>

      <Bloco titulo="O que se requisita">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CampoTexto
            rotulo="Custeio de despesas"
            valor={formulario.custeio_despesas}
            onChange={(v) => definir("custeio_despesas", v)}
            desabilitado={somenteLeitura}
            placeholder="Ex.: alimentação e hospedagem"
            apoio="Completa a frase “destinada(s) ao custeio de despesas ...”."
          />
          <CampoTexto
            rotulo="Data da(s) diária(s)"
            valor={formulario.data_diarias}
            onChange={(v) => definir("data_diarias", v)}
            desabilitado={somenteLeitura}
            placeholder="Ex.: 10 e 11/03/2026"
            apoio="Como no papel. Em branco, o documento imprime o período da viagem."
          />
        </div>
      </Bloco>

      <Bloco titulo="Beneficiário">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CampoTexto
            rotulo="Nome"
            valor={formulario.beneficiario_nome}
            onChange={(v) => definir("beneficiario_nome", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="CPF"
            valor={formulario.beneficiario_cpf}
            onChange={(v) => definir("beneficiario_cpf", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Matrícula (quando aplicável)"
            valor={formulario.beneficiario_matricula}
            onChange={(v) => definir("beneficiario_matricula", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Cargo / função"
            valor={formulario.beneficiario_cargo}
            onChange={(v) => definir("beneficiario_cargo", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Endereço"
            valor={formulario.beneficiario_endereco}
            onChange={(v) => definir("beneficiario_endereco", v)}
            desabilitado={somenteLeitura}
            className="sm:col-span-2"
            apoio="O mesmo dos Dados Gerais — é o endereço que sai nas páginas 1 e 2."
          />
          <CampoTexto
            rotulo="Tipo de diária"
            valor={formulario.tipo_diaria}
            onChange={(v) => definir("tipo_diaria", v)}
            desabilitado={somenteLeitura}
            apoio="Como está escrito no formulário oficial."
          />
          <Campo rotulo="Secretaria" apoio="Vem dos Dados Gerais — é a mesma nas três páginas.">
            <input type="text" value={secretaria} disabled className={CLASSE_CAMPO} />
          </Campo>
          <CampoTexto
            rotulo="Lotação"
            valor={formulario.beneficiario_lotacao}
            onChange={(v) => definir("beneficiario_lotacao", v)}
            desabilitado={somenteLeitura}
          />
        </div>
      </Bloco>

      <Bloco titulo="Viagem">
        <CampoTexto
          rotulo="Destino"
          valor={formulario.destino}
          onChange={(v) => definir("destino", v)}
          desabilitado={somenteLeitura}
        />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CampoTexto
            rotulo="Data de saída"
            tipo="date"
            valor={formulario.data_saida}
            onChange={(v) => definir("data_saida", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Hora de saída"
            tipo="time"
            valor={formulario.hora_saida}
            onChange={(v) => definir("hora_saida", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Data de retorno"
            tipo="date"
            valor={formulario.data_retorno}
            onChange={(v) => definir("data_retorno", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Hora de retorno"
            tipo="time"
            valor={formulario.hora_retorno}
            onChange={(v) => definir("hora_retorno", v)}
            desabilitado={somenteLeitura}
          />
        </div>

        {/* Quantidade × valor unitário = total, calculado automaticamente. */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CampoTexto
            rotulo="Quantidade de diárias"
            valor={formulario.quantidade_diarias}
            onChange={(v) => definir("quantidade_diarias", v)}
            desabilitado={somenteLeitura}
            inputMode="decimal"
            placeholder="Ex.: 2 ou 1,5"
          />
          <Campo rotulo="Valor unitário">
            <CampoMoeda
              valor={formulario.valor_unitario}
              onValorChange={(numero) => definir("valor_unitario", numero)}
              disabled={somenteLeitura}
              className={CLASSE_CAMPO}
            />
          </Campo>
          <Campo
            rotulo="Valor total"
            apoio={
              formulario.valor_total_manual
                ? `Assumido à mão. O cálculo daria ${formatBRL(calculado)}.`
                : "Calculado: quantidade × valor unitário."
            }
          >
            <CampoMoeda
              valor={formulario.valor_total}
              onValorChange={(numero) => definirTotalManual(numero)}
              disabled={somenteLeitura}
              className={`${CLASSE_CAMPO} ${formulario.valor_total_manual ? "border-[#C9A227] bg-[#FFFBEF]" : ""}`}
            />
          </Campo>
        </div>

        {/* A coluna VALOR POR EXTENSO do quadro do documento. */}
        <div className="mt-3">
          <CampoTexto
            rotulo="Valor por extenso"
            valor={formulario.valor_extenso}
            onChange={definirExtensoManual}
            desabilitado={somenteLeitura}
            apoio={
              formulario.valor_extenso_manual
                ? "Redação assumida à mão — o automático não sobrescreve mais."
                : "Gerado do valor total. Digite aqui para assumir a redação."
            }
          />
          {formulario.valor_extenso_manual && !somenteLeitura && (
            <button
              type="button"
              onClick={voltarAoExtensoAutomatico}
              className="mt-2 rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[11px] text-[#0F2A44]/70 hover:bg-black/5"
            >
              Voltar ao extenso automático
            </button>
          )}
        </div>

        {formulario.valor_total_manual && !somenteLeitura && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#C9A227]/30 bg-[#FFFBEF] px-3 py-2 text-[11px] text-[#0F2A44]/70">
            <span>
              Valor total alterado manualmente{diverge ? ` (o cálculo daria ${formatBRL(calculado)})` : ""}. A
              alteração vai para a auditoria, com o antes e o depois.
            </span>
            <button
              type="button"
              onClick={voltarAoCalculo}
              className="ml-auto rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[11px] text-[#0F2A44]/70 hover:bg-black/5"
            >
              Voltar ao cálculo automático
            </button>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Finalidade">
        <CampoArea
          rotulo="Justificativa da viagem"
          valor={formulario.finalidade}
          onChange={(v) => definir("finalidade", v)}
          desabilitado={somenteLeitura}
          linhas={5}
        />
      </Bloco>

      <Bloco titulo="Transporte">
        <div className="flex flex-wrap gap-2">
          {TRANSPORTES.map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              onClick={() => definir("transporte", formulario.transporte === opcao.id ? "" : opcao.id)}
              disabled={somenteLeitura}
              aria-pressed={formulario.transporte === opcao.id}
              className={`min-h-[2.5rem] rounded-lg border px-3 py-2 text-[13px] transition-colors disabled:opacity-60 ${
                formulario.transporte === opcao.id
                  ? "border-[#0F2A44] bg-[#0F2A44] text-white"
                  : "border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
              }`}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>
        {formulario.transporte === "outro" && (
          <CampoTexto
            rotulo="Qual"
            valor={formulario.transporte_outro}
            onChange={(v) => definir("transporte_outro", v)}
            desabilitado={somenteLeitura}
            className="mt-3"
          />
        )}
      </Bloco>

      <Bloco titulo="Dados bancários" apoio="Do documento. Editar aqui não altera o cadastro do fornecedor nem o PIX dele.">
        <DadosBancarios formulario={formulario} somenteLeitura={somenteLeitura} definir={definir} />
      </Bloco>

      <Bloco titulo="Observações">
        <CampoArea
          rotulo="Campo livre"
          valor={formulario.observacoes}
          onChange={(v) => definir("observacoes", v)}
          desabilitado={somenteLeitura}
          linhas={3}
        />
      </Bloco>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Página 2: Liquidação/Solicitação de Pagamento
 * ---------------------------------------------------------------------- */

function SecaoLiquidacao({ formulario, secretarias, somenteLeitura, definir }) {
  const secretaria = secretarias.find((s) => String(s.id) === String(formulario.secretaria_id))?.nome ?? "--";
  const requisitante = secretaria === "--"
    ? "--"
    : /^secretaria/i.test(secretaria) ? secretaria : `Secretaria Municipal de ${secretaria}`;

  return (
    <>
      <p className="rounded-lg border border-[#0F2A44]/10 bg-[#F8FAFC] px-4 py-3 text-xs leading-relaxed text-[#0F2A44]/70">
        A página 2 do modelo oficial: o requisitante solicita à Senhora Prefeita a AUTORIZAÇÃO de
        pagamento em favor do beneficiário. Os dados compartilhados já estão aqui — favorecido, CPF,
        endereço, objetivando, valor e dados bancários vêm da página 1, sem digitação repetida.{" "}
        <strong>É um documento</strong>: não é baixa de pagamento e não debita conta.
      </p>

      <Bloco titulo="Requisitante e favorecido (dados do processo)">
        <Campo rotulo="Requisitante" className="mb-3" apoio="Como sai impresso na página 2.">
          <input type="text" value={requisitante} disabled className={CLASSE_CAMPO} />
        </Campo>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo rotulo="Beneficiário">
            <input type="text" value={formulario.beneficiario_nome ?? ""} disabled className={CLASSE_CAMPO} />
          </Campo>
          <Campo rotulo="CPF">
            <input type="text" value={formulario.beneficiario_cpf ?? ""} disabled className={CLASSE_CAMPO} />
          </Campo>
          <Campo rotulo="Secretaria">
            <input type="text" value={secretaria} disabled className={CLASSE_CAMPO} />
          </Campo>
          <Campo rotulo="Endereço do favorecido">
            <input type="text" value={formulario.beneficiario_endereco ?? ""} disabled className={CLASSE_CAMPO} />
          </Campo>
          <Campo rotulo="Valor (R$)">
            <input type="text" value={formatBRL(formulario.valor_total)} disabled className={CLASSE_CAMPO} />
          </Campo>
          <Campo rotulo="Valor por extenso">
            <input type="text" value={formulario.valor_extenso ?? ""} disabled className={CLASSE_CAMPO} />
          </Campo>
        </div>
        <p className="mt-2 text-[11px] text-[#0F2A44]/40">
          Para corrigir qualquer um destes, volte aos Dados Gerais ou à Requisição: a alteração
          aparece aqui na hora, porque é o mesmo dado.
        </p>
      </Bloco>

      <Bloco
        titulo="Viagem realizada"
        apoio="Chegam espelhando a Solicitação. Informar um valor próprio aqui faz este campo parar de acompanhar a página 1 — e nada do que você preencher é apagado depois."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CampoTexto
            rotulo="Data da liquidação"
            tipo="date"
            valor={formulario.liquidacao_data}
            onChange={(v) => definir("liquidacao_data", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Saída realizada"
            tipo="date"
            valor={valorNaLiquidacao(formulario, "liquidacao_data_saida") ?? ""}
            onChange={(v) => definir("liquidacao_data_saida", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Retorno realizado"
            tipo="date"
            valor={valorNaLiquidacao(formulario, "liquidacao_data_retorno") ?? ""}
            onChange={(v) => definir("liquidacao_data_retorno", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Diárias realizadas"
            valor={valorNaLiquidacao(formulario, "liquidacao_quantidade") ?? ""}
            onChange={(v) => definir("liquidacao_quantidade", v)}
            desabilitado={somenteLeitura}
            inputMode="decimal"
          />
          <Campo rotulo="Valor a liquidar" className="sm:col-span-2">
            <CampoMoeda
              valor={valorNaLiquidacao(formulario, "liquidacao_valor") ?? ""}
              onValorChange={(numero) => definir("liquidacao_valor", numero)}
              disabled={somenteLeitura}
              className={CLASSE_CAMPO}
            />
          </Campo>
        </div>
      </Bloco>

      <Bloco
        titulo="Conferência interna"
        apoio="Controle da secretaria. Não é impresso no modelo oficial: o relatório da viagem fica na Prestação de Contas (página 3)."
      >
        <CampoArea
          rotulo="Documentos comprobatórios apresentados"
          valor={formulario.liquidacao_documentos}
          onChange={(v) => definir("liquidacao_documentos", v)}
          desabilitado={somenteLeitura}
          linhas={3}
        />
        <CampoTexto
          rotulo="Responsável pela conferência"
          valor={formulario.liquidacao_responsavel}
          onChange={(v) => definir("liquidacao_responsavel", v)}
          desabilitado={somenteLeitura}
          className="mt-3"
        />
      </Bloco>

      <Bloco titulo="Dados bancários para crédito" apoio="Os mesmos da página 1. Editar aqui vale só para o documento.">
        <DadosBancarios formulario={formulario} somenteLeitura={somenteLeitura} definir={definir} />
      </Bloco>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Página 3: Prestação de Contas de Diárias
 * ---------------------------------------------------------------------- */

/**
 * A prestação de contas, preenchida DEPOIS da viagem.
 *
 * Estar pendente é o normal: nada aqui é exigido para salvar, para finalizar ou
 * para imprimir a Requisição e a Liquidação. Em branco, a página 3 sai do jeito
 * que o papel sai -- com as linhas impressas, para ser escrita à mão.
 */
function SecaoPrestacao({ formulario, somenteLeitura, definir }) {
  const relatorio = String(formulario.prestacao_relatorio ?? "").trim();
  const legado = String(formulario.liquidacao_relatorio ?? "").trim();

  return (
    <>
      <p className="rounded-lg border border-[#C9A227]/25 bg-[#FFFBEF] px-4 py-3 text-xs leading-relaxed text-[#0F2A44]/70">
        A página 3 do modelo oficial, preenchida <strong>depois da viagem</strong>. Deixar pendente não
        impede nada: a Requisição e a Liquidação são geradas do mesmo jeito, e a página 3 sai com as
        linhas em branco para ser completada à mão.
      </p>

      <Bloco titulo="Relatório de atividades">
        <CampoArea
          rotulo="Relatório"
          valor={formulario.prestacao_relatorio}
          onChange={(v) => definir("prestacao_relatorio", v)}
          desabilitado={somenteLeitura}
          linhas={10}
          apoio="Sai impresso sobre as linhas da página 3."
        />
        {relatorio === "" && legado !== "" && (
          <p className="mt-2 rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2 text-[11px] leading-relaxed text-[#0F2A44]/60">
            Este processo tem um relatório escrito no campo antigo da liquidação, e é ele que está
            sendo impresso na página 3: “{legado.slice(0, 180)}{legado.length > 180 ? "…" : ""}”
          </p>
        )}
        <CampoTexto
          rotulo="Data da prestação de contas"
          tipo="date"
          valor={formulario.prestacao_data}
          onChange={(v) => definir("prestacao_data", v)}
          desabilitado={somenteLeitura}
          className="mt-3"
          apoio="Vai na linha “São José da Laje - AL, __ de __ de ____”. Em branco, a linha sai para completar à mão."
        />
      </Bloco>

      <Bloco titulo="Observações da liquidação" apoio="Controle interno — não é impresso no modelo oficial.">
        <CampoArea
          rotulo="Campo livre"
          valor={formulario.liquidacao_observacoes}
          onChange={(v) => definir("liquidacao_observacoes", v)}
          desabilitado={somenteLeitura}
          linhas={3}
        />
      </Bloco>
    </>
  );
}

function Bloco({ titulo, apoio = null, children }) {
  return (
    <section className="rounded-xl border border-black/5 bg-white p-4 shadow-sm">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0F2A44]/60">{titulo}</h3>
      {apoio && <p className="mt-1 text-[11px] leading-relaxed text-[#0F2A44]/40">{apoio}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
