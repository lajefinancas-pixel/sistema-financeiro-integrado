import React from "react";
import { Check, Eye, FileCheck2, Search, X } from "lucide-react";
import CampoMoeda from "../CampoMoeda.jsx";
import {
  CAMPOS_COMPARTILHADOS,
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  TITULO_PAGINA_3,
  aplicarCalculo,
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
  CATEGORIAS_CARGO,
  FAIXAS_DISTANCIA,
  aplicarTabelaDeDiarias,
  identificacaoDaVersao,
  textoPercentual,
  unitarioDivergeDaTabela,
  valorDaTabelaParaFormulario,
} from "../../lib/processosDiariasTabela.js";
import {
  complementoDoFornecedor,
  nomeExibicaoDoFornecedor,
} from "../../lib/nomesFornecedor.js";
import {
  SIGNATARIOS_DO_DOCUMENTO,
  camposDoSignatario,
  dadosDoServidorParaDocumento,
  dadosDoSignatarioParaDocumento,
  filtrarServidores,
  nomeDaSecretariaDoServidor,
  rotuloDaCategoria,
  servidoresAtivos,
  soltarVinculoDoServidor,
  soltarVinculoDoSignatario,
} from "../../lib/processosServidores.js";

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
 * O BENEFICIÁRIO E OS SIGNATÁRIOS vêm do cadastro de SERVIDORES, que é o
 * cadastro das pessoas que trabalham no município -- NÃO é o de fornecedores, e
 * os dois não se misturam. Escolher alguém ali COPIA os dados para cá, num só
 * sentido: editar um campo deste documento não altera o cadastro de ninguém, e
 * preencher à mão continua valendo para quem não está cadastrado (e não cria
 * cadastro nenhum).
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
  // O cadastro de SERVIDORES, para escolher o beneficiário e os signatários.
  // Vazio (banco sem a migration, ou sem permissão de ver o cadastro): a tela
  // segue funcionando com o preenchimento à mão, como sempre funcionou.
  servidores = [],
  permissoes = {},
  // A Tabela de Diárias VIGENTE. Ela PREENCHE o valor unitário; não o tranca.
  tabela = null,
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
  const [buscaServidor, setBuscaServidor] = React.useState("");
  const [buscaSignatario, setBuscaSignatario] = React.useState("");
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
   * Faixa, categoria e pernoite: a escolha que a TABELA DE DIÁRIAS traduz em
   * valor unitário.
   *
   * Escolher aqui preenche o valor unitário a partir da tabela vigente e compõe
   * o "Tipo de Diária" do documento ("Estado de AL até 100 km — Outros Agentes —
   * com pernoite"). Valor já assumido à mão NÃO é sobrescrito: quem digitou
   * continua no comando até apertar "voltar ao valor da tabela".
   */
  function definirDaTabela(chave, valor) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => {
      const escolhido = { ...atual, [chave]: valor };
      const comTabela = aplicarTabelaDeDiarias(escolhido, tabela);
      return sincronizarLiquidacao(atual, aplicarCalculo(comTabela));
    });
  }

  /** Assumir o valor unitário à mão. Fica registrado, e vai para a auditoria. */
  function definirUnitarioManual(valor) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) =>
      sincronizarLiquidacao(
        atual,
        aplicarCalculo({ ...atual, valor_unitario: valor, valor_unitario_manual: true }),
      ),
    );
  }

  /** Devolve o valor unitário ao que a Tabela de Diárias diz. */
  function voltarAoValorDaTabela() {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => {
      const solto = { ...atual, valor_unitario_manual: false };
      return sincronizarLiquidacao(atual, aplicarCalculo(aplicarTabelaDeDiarias(solto, tabela, { forcarValor: true })));
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
   * Solta o vínculo ANTIGO com o cadastro de fornecedores.
   *
   * O beneficiário agora vem do cadastro de SERVIDORES, mas os processos que já
   * nasceram vinculados a um fornecedor continuam mostrando esse vínculo e
   * podendo soltá-lo -- nenhum documento existente perde a referência dele.
   * Soltar NÃO apaga o que está digitado e NÃO cria cadastro nenhum.
   */
  function preencherAMao() {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => soltarVinculoDeCadastro(atual));
  }

  /**
   * Escolhe o BENEFICIÁRIO no cadastro de SERVIDORES.
   *
   * COPIA os dados para o documento -- nome, CPF, endereço, matrícula, cargo,
   * secretaria, lotação, dados bancários e PIX -- e guarda o vínculo interno
   * (`beneficiario_servidor_id`). Nada é gravado no cadastro do servidor: ele
   * não é criado, não é alterado e não é marcado como nada.
   *
   * A CATEGORIA é SUGERIDA, não imposta: ela só entra quando o documento ainda
   * não tem uma, para não desfazer uma escolha feita à mão. Entrando, a Tabela
   * de Diárias recalcula o valor unitário -- é o cálculo automático do valor.
   */
  function puxarDoServidor(servidor) {
    setAviso(null);
    setSujo(true);
    setBuscaServidor("");
    setFormulario((atual) => {
      const dados = dadosDoServidorParaDocumento(servidor);
      const mesclado = { ...atual };

      Object.entries(dados).forEach(([chave, valor]) => {
        if (chave === "beneficiario_servidor_id") {
          mesclado[chave] = valor;
          return;
        }
        // A categoria do cadastro é sugestão: não sobrescreve a que já está
        // escolhida no documento.
        if (chave === "diaria_categoria") {
          if (String(valor ?? "").trim() !== "" && String(atual.diaria_categoria ?? "").trim() === "") {
            mesclado[chave] = valor;
          }
          return;
        }
        // O que o documento já tem preenchido à mão não é sobrescrito por um
        // campo vazio do cadastro.
        if (String(valor ?? "").trim() !== "") mesclado[chave] = valor;
      });

      // Com a categoria sugerida, a tabela preenche o valor unitário -- e
      // respeita o valor digitado à mão, que ela não sobrescreve.
      const comTabela = aplicarTabelaDeDiarias(mesclado, tabela);
      return sincronizarLiquidacao(atual, aplicarCalculo(comTabela));
    });
  }

  /**
   * Solta o vínculo com o servidor, PRESERVANDO o que o documento já diz.
   *
   * Preencher à mão é caminho legítimo: quem não está cadastrado continua
   * entrando no documento pelos campos abaixo, e isso NÃO cria servidor no
   * cadastro.
   */
  function soltarServidor() {
    setAviso(null);
    setSujo(true);
    setBuscaServidor("");
    setFormulario((atual) => soltarVinculoDoServidor(atual));
  }

  /**
   * Escolhe o SIGNATÁRIO (o responsável pela secretaria) no cadastro.
   *
   * Copia nome, CPF e cargo para o PROCESSO, e é isso que congela a assinatura:
   * o documento guarda quem assinou naquele momento. Processo finalizado não
   * tem mais o conteúdo alterado, então mudança posterior no cadastro -- outro
   * cargo, outra secretaria, inativação -- NÃO altera documento antigo.
   */
  function puxarSignatario(servidor, prefixo) {
    setAviso(null);
    setSujo(true);
    setBuscaSignatario("");
    setFormulario((atual) => ({ ...atual, ...dadosDoSignatarioParaDocumento(servidor, { prefixo }) }));
  }

  function soltarSignatario(prefixo) {
    setAviso(null);
    setSujo(true);
    setBuscaSignatario("");
    setFormulario((atual) => soltarVinculoDoSignatario(atual, { prefixo }));
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

  // Só os ATIVOS são oferecidos para um documento novo: servidor inativo
  // continua no cadastro (e nos processos antigos), mas não entra em processo
  // novo. Quem já está vinculado continua aparecendo, mesmo se inativado
  // depois -- o documento não perde a referência dele.
  const servidorEscolhido = React.useMemo(
    () => servidores.find((s) => String(s.id) === String(formulario.beneficiario_servidor_id)) ?? null,
    [servidores, formulario.beneficiario_servidor_id],
  );
  const servidoresEncontrados = React.useMemo(() => {
    if (buscaServidor.trim() === "") return [];
    return filtrarServidores(servidoresAtivos(servidores), {
      busca: buscaServidor,
      secretarias,
    }).slice(0, 20);
  }, [servidores, buscaServidor, secretarias]);

  const signatariosEncontrados = React.useMemo(() => {
    if (buscaSignatario.trim() === "") return [];
    return filtrarServidores(servidoresAtivos(servidores), {
      busca: buscaSignatario,
      secretarias,
    }).slice(0, 20);
  }, [servidores, buscaSignatario, secretarias]);

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
              onAMao={preencherAMao}
              servidores={servidores}
              servidorEscolhido={servidorEscolhido}
              servidoresEncontrados={servidoresEncontrados}
              buscaServidor={buscaServidor}
              onBuscaServidor={setBuscaServidor}
              onPuxarServidor={puxarDoServidor}
              onSoltarServidor={soltarServidor}
            />
          )}

          {secao === "requisicao" && (
            <SecaoRequisicao
              formulario={formulario}
              secretarias={secretarias}
              somenteLeitura={somenteLeitura}
              tabela={tabela}
              definir={definir}
              definirDaTabela={definirDaTabela}
              definirUnitarioManual={definirUnitarioManual}
              voltarAoValorDaTabela={voltarAoValorDaTabela}
              definirTotalManual={definirTotalManual}
              voltarAoCalculo={voltarAoCalculo}
              definirExtensoManual={definirExtensoManual}
              voltarAoExtensoAutomatico={voltarAoExtensoAutomatico}
              servidores={servidores}
              signatariosEncontrados={signatariosEncontrados}
              buscaSignatario={buscaSignatario}
              onBuscaSignatario={setBuscaSignatario}
              onPuxarSignatario={puxarSignatario}
              onSoltarSignatario={soltarSignatario}
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

/**
 * A ESCOLHA NA TABELA DE DIÁRIAS: faixa de distância × categoria do cargo, mais
 * o pernoite.
 *
 * É daqui que sai o valor unitário e o "Tipo de Diária" impresso no documento.
 * O pernoite acrescenta o percentual GRAVADO NA TABELA (hoje 30%), não um número
 * fixo no código -- quem atualizar a tabela atualiza o acréscimo com ela.
 *
 * Nada aqui é financeiro: isto preenche um campo de papel.
 */
function EscolhaDaTabela({ formulario, tabela, somenteLeitura, definir, definirDaTabela }) {
  const percentual = textoPercentual(tabela?.pernoite_percentual ?? 30);
  const versao = identificacaoDaVersao(tabela);
  const daTabela = valorDaTabelaParaFormulario(formulario, tabela);
  const diverge = unitarioDivergeDaTabela(formulario, tabela);

  return (
    <div className="mt-3 rounded-lg border border-[#0F2A44]/10 bg-[#F8FAFC] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-[#0F2A44]/70">Tabela de Diárias</div>
        {versao && <div className="text-[11px] text-[#0F2A44]/45">{versao}</div>}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo rotulo="Faixa de distância">
          <select
            value={formulario.diaria_faixa ?? ""}
            onChange={(e) => definirDaTabela("diaria_faixa", e.target.value)}
            disabled={somenteLeitura}
            className={CLASSE_CAMPO}
          >
            <option value="">Selecione...</option>
            {FAIXAS_DISTANCIA.map((faixa) => (
              <option key={faixa.id} value={faixa.id}>
                {faixa.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Categoria do cargo">
          <select
            value={formulario.diaria_categoria ?? ""}
            onChange={(e) => definirDaTabela("diaria_categoria", e.target.value)}
            disabled={somenteLeitura}
            className={CLASSE_CAMPO}
          >
            <option value="">Selecione...</option>
            {CATEGORIAS_CARGO.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.rotulo}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-[#0F2A44]">
        <input
          type="checkbox"
          checked={formulario.diaria_pernoite === true}
          onChange={(e) => definirDaTabela("diaria_pernoite", e.target.checked)}
          disabled={somenteLeitura}
          className="mt-0.5 h-4 w-4 rounded border-black/20"
        />
        <span>
          Com pernoite
          <span className="ml-1 text-[11px] text-[#0F2A44]/50">
            (acrescenta {percentual} ao valor da tabela)
          </span>
        </span>
      </label>

      <div className="mt-3">
        <CampoTexto
          rotulo="Tipo de diária (impresso no documento)"
          valor={formulario.tipo_diaria}
          onChange={(v) => definir("tipo_diaria", v)}
          desabilitado={somenteLeitura}
          apoio="Composto da faixa, da categoria e do pernoite. Editável, para casos fora do padrão."
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#0F2A44]/50">
        {daTabela === null
          ? "Escolha a faixa e a categoria: o valor unitário é preenchido pela tabela, e continua editável."
          : diverge
            ? `A tabela daria ${formatBRL(daTabela)} para esta escolha — o valor unitário foi assumido à mão, e a alteração fica na auditoria.`
            : `Valor da tabela para esta escolha: ${formatBRL(daTabela)}.`}
      </p>
    </div>
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

/**
 * Quem ASSINA uma linha do documento — escolhido no cadastro ou digitado.
 *
 * Genérico pelo prefixo, para servir aos signatários que os próximos processos
 * vão pedir (a Solicitação de Serviços/Materiais tem os dela) sem reescrever
 * nada aqui.
 *
 * O CONGELAMENTO é o ponto: nome, CPF e cargo ficam GRAVADOS NO PROCESSO, e não
 * são lidos do cadastro na hora de imprimir. O documento guarda quem assinou
 * naquele momento; mudar o cadastro depois — outro cargo, outra secretaria,
 * inativação — não altera documento antigo.
 */
function CampoSignatario({
  signatario,
  formulario,
  servidores = [],
  secretarias = [],
  somenteLeitura,
  definir,
  encontrados = [],
  busca = "",
  onBusca,
  onPuxar,
  onSoltar,
}) {
  const campos = camposDoSignatario(signatario.prefixo);
  const vinculado = servidores.find((s) => String(s.id) === String(formulario[campos.servidorId])) ?? null;
  const temVinculo = String(formulario[campos.servidorId] ?? "") !== "";

  return (
    <div className="rounded-lg border border-black/10 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[#0F2A44]">{signatario.rotulo}</span>
        <span className="text-[11px] text-[#0F2A44]/45">{signatario.ajuda}</span>
      </div>

      {temVinculo ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-[#0F2A44]">
              {formulario[campos.nome] || vinculado?.nome || "--"}
            </p>
            <p className="truncate text-[11px] text-[#0F2A44]/50">
              {[formulario[campos.cargo], nomeDaSecretariaDoServidor(vinculado, secretarias)]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="text-[11px] text-[#0F2A44]/40">
              Gravado neste processo. Alteração posterior no cadastro não muda este documento.
            </p>
          </div>
          {!somenteLeitura && (
            <button
              type="button"
              onClick={() => onSoltar?.(signatario.prefixo)}
              title="Solta o vínculo com o cadastro. O nome, o CPF e o cargo já gravados continuam no documento."
              className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
            >
              Soltar vínculo
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-black/10 px-3">
            <Search size={14} className="shrink-0 text-[#0F2A44]/40" />
            <input
              type="text"
              value={busca}
              onChange={(e) => onBusca?.(e.target.value)}
              disabled={somenteLeitura}
              placeholder="Buscar no cadastro de servidores..."
              className="w-full bg-transparent py-2 text-sm text-[#0F2A44] outline-none"
            />
          </div>
          {encontrados.length > 0 && (
            <ul className="mt-2 max-h-44 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10">
              {encontrados.map((servidor) => (
                <li key={servidor.id}>
                  <button
                    type="button"
                    onClick={() => onPuxar?.(servidor, signatario.prefixo)}
                    className="block w-full px-3 py-2 text-left hover:bg-black/[0.03]"
                  >
                    <span className="block truncate text-sm text-[#0F2A44]">{servidor.nome}</span>
                    <span className="block truncate text-[11px] text-[#0F2A44]/45">
                      {[servidor.cargo, nomeDaSecretariaDoServidor(servidor, secretarias)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Digitar à mão continua valendo: quem assina pode não estar cadastrado,
          e preencher aqui NÃO cria servidor no cadastro. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CampoTexto
          rotulo="Nome"
          valor={formulario[campos.nome]}
          onChange={(v) => definir(campos.nome, v)}
          desabilitado={somenteLeitura}
        />
        <CampoTexto
          rotulo="CPF"
          valor={formulario[campos.cpf]}
          onChange={(v) => definir(campos.cpf, v)}
          desabilitado={somenteLeitura}
        />
        <CampoTexto
          rotulo="Cargo"
          valor={formulario[campos.cargo]}
          onChange={(v) => definir(campos.cargo, v)}
          desabilitado={somenteLeitura}
        />
      </div>
      <p className="mt-1 text-[11px] text-[#0F2A44]/40">
        Em branco, a linha sai só com o traço para assinar à mão. Preencher aqui não cria servidor no
        cadastro.
      </p>
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
  onAMao,
  servidores = [],
  servidorEscolhido = null,
  servidoresEncontrados = [],
  buscaServidor = "",
  onBuscaServidor,
  onPuxarServidor,
  onSoltarServidor,
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

      {/* O BENEFICIÁRIO: do cadastro de SERVIDORES ou à mão.

          ⚠️ Este é o cadastro dos SERVIDORES do município, não o de
          fornecedores. Escolher aqui copia os dados para o documento; nada é
          gravado no cadastro do servidor. */}
      <div>
        <label className="mb-1 block text-xs font-medium text-[#0F2A44]/70">
          Beneficiário no cadastro de servidores (opcional)
        </label>
        {servidorEscolhido ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#0F2A44]">{servidorEscolhido.nome}</p>
              <p className="truncate text-[11px] text-[#0F2A44]/50">
                {[
                  servidorEscolhido.cargo,
                  nomeDaSecretariaDoServidor(servidorEscolhido, secretarias),
                  rotuloDaCategoria(servidorEscolhido.categoria_diaria),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-[11px] text-[#0F2A44]/40">
                Vínculo interno preservado. O que você editar abaixo vale só neste documento — o
                cadastro do servidor não muda.
              </p>
            </div>
            {!somenteLeitura && (
              <button
                type="button"
                onClick={onSoltarServidor}
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
                value={buscaServidor}
                onChange={(e) => onBuscaServidor?.(e.target.value)}
                disabled={somenteLeitura}
                placeholder="Buscar servidor por nome, CPF, cargo ou secretaria..."
                className="w-full bg-transparent py-2.5 text-sm text-[#0F2A44] outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-[#0F2A44]/40">
              Opcional: se a pessoa não estiver cadastrada, preencha os campos abaixo à mão.
              Preencher à mão NÃO cria servidor no cadastro — e nem fornecedor.
            </p>
            {servidores.length === 0 && (
              <p className="mt-1 text-[11px] text-[#0F2A44]/40">
                Nenhum servidor cadastrado (ou sem permissão para ver o cadastro): siga preenchendo
                à mão, como sempre.
              </p>
            )}
            {servidoresEncontrados.length > 0 && (
              <ul className="mt-2 max-h-52 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10">
                {servidoresEncontrados.map((servidor) => (
                  <li key={servidor.id}>
                    <button
                      type="button"
                      onClick={() => onPuxarServidor?.(servidor)}
                      className="block w-full px-3 py-2.5 text-left hover:bg-black/[0.03]"
                    >
                      <span className="block truncate text-sm text-[#0F2A44]">{servidor.nome}</span>
                      <span className="block truncate text-[11px] text-[#0F2A44]/45">
                        {[servidor.cpf, servidor.cargo, nomeDaSecretariaDoServidor(servidor, secretarias)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* Vínculo ANTIGO com o cadastro de fornecedores: aparece só nos
            processos que já o têm, para nenhum documento existente perder a
            referência dele. Documento novo usa o cadastro de servidores. */}
        {escolhido && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-white px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                Vínculo anterior, no cadastro de fornecedores
              </p>
              <p className="truncate text-sm text-[#0F2A44]">{nomeExibicaoDoFornecedor(escolhido)}</p>
              {complementoDoFornecedor(escolhido) && (
                <p className="truncate text-[11px] text-[#0F2A44]/50">{complementoDoFornecedor(escolhido)}</p>
              )}
            </div>
            {!somenteLeitura && (
              <button
                type="button"
                onClick={onAMao}
                title="Solta o vínculo antigo. O texto já digitado continua no documento."
                className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
              >
                Soltar vínculo
              </button>
            )}
          </div>
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
  tabela,
  definir,
  definirDaTabela,
  definirUnitarioManual,
  voltarAoValorDaTabela,
  definirTotalManual,
  voltarAoCalculo,
  definirExtensoManual,
  voltarAoExtensoAutomatico,
  servidores = [],
  signatariosEncontrados = [],
  buscaSignatario = "",
  onBuscaSignatario,
  onPuxarSignatario,
  onSoltarSignatario,
}) {
  const calculado = valorTotalCalculado(formulario);
  const diverge = totalDivergeDoCalculo(formulario);
  const secretaria = secretarias.find((s) => String(s.id) === String(formulario.secretaria_id))?.nome ?? "--";
  // O que a Tabela de Diárias daria para a escolha atual. null = ainda não há
  // faixa e categoria escolhidas, e o valor unitário segue sendo digitado.
  const daTabela = valorDaTabelaParaFormulario(formulario, tabela);

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

        {/* A TABELA DE DIÁRIAS: faixa × categoria, mais o pernoite. */}
        <EscolhaDaTabela
          formulario={formulario}
          tabela={tabela}
          somenteLeitura={somenteLeitura}
          definir={definir}
          definirDaTabela={definirDaTabela}
        />

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
          <Campo
            rotulo="Valor unitário"
            apoio={
              formulario.valor_unitario_manual
                ? daTabela === null
                  ? "Digitado à mão."
                  : `Digitado à mão. A tabela daria ${formatBRL(daTabela)}.`
                : daTabela === null
                  ? "Escolha a faixa e a categoria acima para a tabela preenchê-lo."
                  : "Preenchido pela Tabela de Diárias."
            }
          >
            <CampoMoeda
              valor={formulario.valor_unitario}
              onValorChange={(numero) => definirUnitarioManual(numero)}
              disabled={somenteLeitura}
              className={`${CLASSE_CAMPO} ${formulario.valor_unitario_manual ? "border-[#C9A227] bg-[#FFFBEF]" : ""}`}
            />
            {formulario.valor_unitario_manual && !somenteLeitura && daTabela !== null && (
              <button
                type="button"
                onClick={voltarAoValorDaTabela}
                className="mt-2 rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[11px] text-[#0F2A44]/70 hover:bg-black/5"
              >
                Voltar ao valor da tabela ({formatBRL(daTabela)})
              </button>
            )}
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

      {/* As ASSINATURAS do documento.

          O servidor assina a primeira linha e a prefeita a terceira; a do meio
          é o responsável pela secretaria, e é ela que pode ser identificada a
          partir do cadastro. Nome, CPF e cargo ficam GRAVADOS NO PROCESSO: o
          documento guarda quem assinou naquele momento, e mudança posterior no
          cadastro não altera documento antigo. */}
      <Bloco
        titulo="Assinaturas"
        apoio="As três assinaturas saem uma embaixo da outra na página impressa: o servidor, o responsável pela secretaria e a prefeita."
      >
        {SIGNATARIOS_DO_DOCUMENTO.map((signatario) => (
          <CampoSignatario
            key={signatario.prefixo}
            signatario={signatario}
            formulario={formulario}
            servidores={servidores}
            secretarias={secretarias}
            somenteLeitura={somenteLeitura}
            definir={definir}
            encontrados={signatariosEncontrados}
            busca={buscaSignatario}
            onBusca={onBuscaSignatario}
            onPuxar={onPuxarSignatario}
            onSoltar={onSoltarSignatario}
          />
        ))}
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
