import React from "react";
import { ArrowDown, ArrowUp, Check, Eye, FileCheck2, Plus, Printer, Search, Trash2, X } from "lucide-react";
import CampoMoeda from "../CampoMoeda.jsx";
import {
  ATESTADOS,
  CAMPOS_COMPARTILHADOS,
  SIGNATARIO_LIQUIDACAO,
  SIGNATARIO_REQUISITANTE,
  TIPOS_REQUISICAO,
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  adicionarItem,
  alterarItem,
  aplicarCalculo,
  dadosDaNotaParaDocumento,
  dadosDoFornecedorParaDocumento,
  fornecedorAtendeBusca,
  itensDoProcesso,
  moverItem,
  nomeDaSecretaria,
  numeroDoItem,
  numeroDoProcesso,
  opcoesDePagamentoDoFornecedor,
  primeiroErro,
  processoParaFormulario,
  removerItem,
  rotuloDaNota,
  sincronizarLiquidacao,
  situacaoServicoInfo,
  soltarVinculoDaNota,
  soltarVinculoDeCadastro,
  temNotaVinculada,
  tituloDoProcesso,
  totalDeItens,
  validarFinalizacao,
  validarRascunho,
} from "../../lib/processosServicos.js";
import {
  carregarFornecedorCompleto,
  carregarNotasDoFornecedor,
} from "../../lib/processosServicosDados.js";
import { listarFormasPagamento } from "../../lib/dadosPagamentoFornecedor.js";
import { formatBRL } from "../../lib/moeda.js";
import {
  complementoDoFornecedor,
  nomeExibicaoDoFornecedor,
} from "../../lib/nomesFornecedor.js";
import { dadosDoBancoParaDocumento } from "../../lib/processosBancos.js";
import {
  chaveDaSecretaria,
  dadosDoEncaminhamentoDaRequisicao,
  dadosDoEncaminhamentoParaDocumento,
  encaminhamentoPeloNome,
  nucleoDaSecretaria,
  secretariasParaEncaminhamento,
  sugerirEncaminhamento,
} from "../../lib/processosEncaminhamento.js";
import {
  CAMPOS_SOLICITANTE_NO_PROCESSO,
  dadosDoSolicitanteParaDocumento,
  rotuloDoSolicitante,
  solicitantesAtivos,
} from "../../lib/processosSecretariasSolicitantes.js";
import SeletorBanco from "./SeletorBanco.jsx";
import {
  camposDoSignatario,
  dadosDoSignatarioParaDocumento,
  filtrarServidores,
  nomeDaSecretariaDoServidor,
  servidoresAtivos,
  soltarVinculoDoSignatario,
} from "../../lib/processosServidores.js";

/**
 * O PROCESSO DE SERVIÇOS/MATERIAIS: um documento administrativo com DUAS
 * páginas, em uma tela só.
 *
 * A Requisição de Material/Serviço e a Liquidação/Solicitação de Pagamento NÃO
 * são registros independentes e não têm aba separada na lista: são as DUAS
 * páginas do MESMO processo, com o MESMO número e os MESMOS dados gerais. Aqui
 * elas aparecem como duas seções, e os Dados Gerais -- que valem para as duas --
 * são digitados UMA VEZ.
 *
 * A SINCRONIZAÇÃO É ESTRUTURAL: os dados compartilhados são as mesmas colunas do
 * mesmo registro, então o REQUISITANTE da página 2 é o da página 1 porque é o
 * MESMO DADO, e não porque alguém o copia. O que a página 2 tem de próprio -- a
 * atestação e a referência -- é SUGERIDO a partir do tipo marcado na página 1 e
 * segue trocável à mão: `sincronizarLiquidacao` nunca apaga escolha feita.
 *
 * ⚠️ A REQUISIÇÃO NÃO TEM VALORES. A página 1 tem ITEM, QUANT. e DISCRIMINAÇÃO,
 * e nada mais: nenhum valor unitário, nenhum valor total, nenhuma coluna de
 * valor. O valor é UM, é do pagamento solicitado, e vive na página 2.
 *
 * ⚠️ VINCULAR A NF É APENAS CONSULTA. Escolher uma nota já registrada COPIA
 * número, emissão, bruto, retenções e líquido para dentro deste documento. A
 * nota original não é alterada, não recebe baixa, não muda de situação e o valor
 * em aberto dela continua exatamente o mesmo.
 *
 * O FORNECEDOR vem do cadastro de fornecedores e o requisitante e os signatários
 * do cadastro de SERVIDORES. Escolher ali COPIA os dados para cá, num só
 * sentido: editar um campo deste documento não altera cadastro de ninguém, e
 * preencher à mão continua valendo para quem não está cadastrado -- e NÃO cria
 * cadastro nenhum.
 *
 * ESTE DOCUMENTO NÃO É FINANCEIRO. Preencher, salvar ou finalizar não debita
 * conta, não dá baixa em NF, não altera saldo, não marca fornecedor como pago,
 * não cria pagamento e não mexe na Programação Diária. "Liquidação/Solicitação
 * de Pagamento" é o NOME DO DOCUMENTO: ele pede autorização em papel, e nada
 * mais. FINALIZAR NÃO É PAGAR.
 */

const SECOES = [
  { id: "gerais", rotulo: "Dados Gerais" },
  { id: "requisicao", rotulo: `1. ${tituloDeSecao(TITULO_PAGINA_1)}` },
  { id: "liquidacao", rotulo: `2. ${tituloDeSecao(TITULO_PAGINA_2)}` },
];

function tituloDeSecao(titulo) {
  return titulo.charAt(0) + titulo.slice(1).toLowerCase();
}

/** Intervalo do salvamento automático: grava logo depois de a pessoa parar. */
const ESPERA_AUTOSSALVAMENTO = 2500;

/** Quem assina cada página, na ordem em que as folhas saem. */
const SIGNATARIOS = {
  requisicao: {
    prefixo: SIGNATARIO_REQUISITANTE,
    rotulo: "Requisitante",
    ajuda: "Assina a requisição: nome e identificação funcional.",
  },
  liquidacao: {
    prefixo: SIGNATARIO_LIQUIDACAO,
    rotulo: "Quem assina a liquidação",
    ajuda: "A linha “Assinatura”, ao pé da página 2.",
  },
};

export default function ModalProcessoServico({
  processo = null,
  // O cadastro de FORNECEDORES, para achar o favorecido. Só leitura: escolher
  // aqui copia os dados para o documento e nada é gravado no cadastro.
  fornecedores = [],
  // ⚠️ AS SOLICITANTES SÃO O CADASTRO PRÓPRIO DO MÓDULO. Quem REQUISITA vem
  // daqui (`processos_secretarias_solicitantes`); o cadastro de secretarias do
  // MÓDULO FINANCEIRO segue intocado e entra só em `secretarias`, por leitura,
  // para o processo antigo continuar mostrando o que gravou.
  solicitantes = [],
  secretarias = [],
  // ⚠️ O CADASTRO DE SECRETARIAS DO MÓDULO FINANCEIRO, POR LEITURA. É daqui que
  // saem as secretarias oferecidas em "Encaminhar à Secretaria de" -- as que têm
  // financeiro, as mesmas que Saldos das Contas e Pagamentos Diários usam, então
  // uma secretaria com financeiro criada amanhã aparece aqui sozinha. Este módulo
  // NÃO cria, NÃO altera e NÃO apaga nada nesse cadastro.
  secretariasFinanceiras = [],
  // O cadastro de BANCOS, para o dado bancário sair "001 — Banco do Brasil".
  // Vazio (banco sem a migration): o campo volta a ser texto livre.
  bancos = [],
  // O cadastro de SERVIDORES, para escolher o requisitante e os signatários.
  // Vazio (banco sem a migration, ou sem permissão de ver o cadastro): a tela
  // segue funcionando com o preenchimento à mão.
  servidores = [],
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
  onFinalizarEImprimir,
  onPreVisualizar,
}) {
  const [formulario, setFormulario] = React.useState(() =>
    processo ? processoParaFormulario(processo) : (inicial ?? processoParaFormulario(null)),
  );
  const [secao, setSecao] = React.useState("gerais");
  const [buscaFornecedor, setBuscaFornecedor] = React.useState("");
  const [buscaSignatario, setBuscaSignatario] = React.useState("");
  const [aviso, setAviso] = React.useState(null);
  const [sujo, setSujo] = React.useState(false);

  // As formas de pagamento e as NFs do fornecedor escolhido. As duas são
  // LEITURA: a tela as oferece para escolher o que vai no papel, e não grava
  // nada em nenhuma das duas origens.
  const [formasPagamento, setFormasPagamento] = React.useState([]);
  const [notas, setNotas] = React.useState([]);
  const [carregandoNotas, setCarregandoNotas] = React.useState(false);

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
   * As formas de pagamento e as NFs do fornecedor JÁ VINCULADO ao processo.
   *
   * Reabrir um documento antigo volta a oferecer as contas, o PIX e as notas
   * daquele fornecedor -- sem alterar nenhuma das três coisas.
   */
  const fornecedorId = formulario.fornecedor_id;
  React.useEffect(() => {
    if (!fornecedorId) {
      setFormasPagamento([]);
      setNotas([]);
      return undefined;
    }
    let vivo = true;
    setCarregandoNotas(true);
    (async () => {
      // Formas de pagamento: leitura, para a pessoa escolher qual conta ou qual
      // chave PIX vai impressa no documento.
      try {
        const formas = await listarFormasPagamento(fornecedorId);
        if (vivo) setFormasPagamento(Array.isArray(formas) ? formas : []);
      } catch {
        if (vivo) setFormasPagamento([]);
      }
      // ⚠️ As NFs: SELECT e nada mais. Nenhuma nota é alterada por aparecer aqui.
      try {
        const lista = await carregarNotasDoFornecedor(fornecedorId);
        if (vivo) setNotas(lista);
      } catch {
        if (vivo) setNotas([]);
      }
      if (vivo) setCarregandoNotas(false);
    })();
    return () => {
      vivo = false;
    };
  }, [fornecedorId]);

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

  /**
   * A SUGESTÃO DO ENCAMINHAMENTO, uma única vez, no PROCESSO NOVO.
   *
   * O "À SECRETARIA DE ______" não pode sair em branco no papel, então o
   * processo já nasce com um destino sugerido EM CADA FOLHA, e as duas
   * sugestões são diferentes de propósito:
   *
   *   REQUISIÇÃO (pág. 1) -> a própria SOLICITANTE quando ela tem financeiro;
   *                          Finanças quando não tem;
   *   LIQUIDAÇÃO (pág. 2) -> sempre FINANÇAS, que é quem paga.
   *
   * ⚠️ Só no processo AINDA NÃO CRIADO e só uma vez: processo já gravado abre
   * como estava, e limpar ou trocar a escolha à mão continua valendo em cada
   * folha separadamente (a sugestão não volta a se impor).
   */
  const encaminhamentoSugerido = React.useRef(false);
  React.useEffect(() => {
    if (criado || encaminhamentoSugerido.current) return;
    if (String(formulario.encaminhar_secretaria_nome ?? "").trim() !== "") return;
    if (String(formulario.despacho_secretaria ?? "").trim() !== "") return;
    const sugestao = sugerirEncaminhamento({
      secretariasFinanceiras,
      nomeDaSolicitante: formulario.solicitante_nome ?? "",
    });
    if (String(sugestao.encaminhar_secretaria_nome ?? "").trim() === "") return;
    encaminhamentoSugerido.current = true;
    setFormulario((atual) => ({ ...atual, ...sugestao }));
  }, [
    criado,
    secretariasFinanceiras,
    formulario.encaminhar_secretaria_nome,
    formulario.despacho_secretaria,
    formulario.solicitante_nome,
  ]);

  function definir(chave, valor) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => {
      const alterado = aplicarCalculo({ ...atual, [chave]: valor });
      // Marcar o TIPO na página 1 sugere a atestação e a referência da página
      // 2; o que já foi escolhido à mão não é desfeito.
      return chave === "tipo" || CAMPOS_COMPARTILHADOS.includes(chave)
        ? sincronizarLiquidacao(atual, alterado)
        : alterado;
    });
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

  /* ---------------------------------------------------------------------
   * Os itens do QUADRO DESCRITIVO
   * ------------------------------------------------------------------ */

  /**
   * Acrescenta, altera, remove e reordena item.
   *
   * A NUMERAÇÃO É AUTOMÁTICA porque o número é a POSIÇÃO na lista: remover o 02
   * de três itens faz o 03 virar 02 na hora, sem buraco na sequência e sem
   * número gravado para desencontrar. ⚠️ O item tem QUANTIDADE e DISCRIMINAÇÃO,
   * e nenhum valor.
   */
  function mexerNosItens(transformar) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => ({ ...atual, itens: transformar(itensDoProcesso(atual)) }));
  }

  /* ---------------------------------------------------------------------
   * Secretaria, fornecedor, NF e signatários
   * ------------------------------------------------------------------ */

  /**
   * Escolhe a SECRETARIA SOLICITANTE -- quem REQUISITA.
   *
   * ⚠️ Vem do cadastro PRÓPRIO do módulo Processos, não do cadastro de
   * secretarias do módulo financeiro: quem requisita quase nunca é quem paga.
   * Escolher aqui PUXA o nome oficial, o secretário responsável, o CPF dele e o
   * cargo, e GRAVA tudo dentro do processo -- é o congelamento: trocar o
   * secretário no cadastro amanhã não reescreve o documento emitido hoje. Nada é
   * escrito no cadastro da solicitante, e nada no cadastro financeiro.
   */
  function escolherSolicitante(id) {
    setAviso(null);
    setSujo(true);
    const solicitante = (solicitantes ?? []).find((s) => String(s.id) === String(id)) ?? null;
    const dados = dadosDoSolicitanteParaDocumento(solicitante);
    setFormulario((atual) => {
      const proximo = { ...atual, solicitante_id: dados.solicitante_id ?? "" };
      CAMPOS_SOLICITANTE_NO_PROCESSO.forEach((campo) => {
        proximo[campo] = dados[campo] ?? "";
      });
      // O requisitante que assina a página 1 é SUGERIDO a partir do secretário
      // do cadastro, e só quando ainda está em branco: escolha feita à mão --
      // ou um servidor puxado do cadastro -- nunca é sobrescrita.
      const assinatura = camposDoSignatario(SIGNATARIO_REQUISITANTE);
      if (String(atual[assinatura.servidorId] ?? "") === "") {
        [
          [assinatura.nome, dados.solicitante_secretario],
          [assinatura.cpf, dados.solicitante_secretario_cpf],
          [assinatura.cargo, dados.solicitante_secretario_cargo],
        ].forEach(([campo, valor]) => {
          if (String(atual[campo] ?? "").trim() === "" && String(valor ?? "").trim() !== "") {
            proximo[campo] = valor;
          }
        });
      }
      // O ENCAMINHAMENTO DA PREFEITA é SUGERIDO aqui, e só quando as DUAS
      // folhas ainda estão em branco: na REQUISIÇÃO, solicitante que TEM
      // financeiro recebe o próprio processo de volta, e solicitante sem
      // financeiro -- Turismo, Obras, Gabinete -- manda para Finanças; a
      // LIQUIDAÇÃO vai para Finanças de qualquer jeito. Escolha já feita à mão
      // nunca é sobrescrita, e o despacho escrito no processo antigo também não.
      if (
        String(atual.encaminhar_secretaria_nome ?? "").trim() === "" &&
        String(atual.despacho_secretaria ?? "").trim() === ""
      ) {
        Object.assign(
          proximo,
          sugerirEncaminhamento({
            secretariasFinanceiras,
            nomeDaSolicitante: dados.solicitante_nome ?? "",
          }),
        );
      }
      return proximo;
    });
  }

  /**
   * Escolhe A SECRETARIA DO DESPACHO DA REQUISIÇÃO (página 1).
   *
   * ⚠️ FOLHA PRÓPRIA, CAMPO PRÓPRIO: esta escolha vai para `despacho_secretaria`
   * e NÃO arrasta a da liquidação, que tem Finanças por padrão. A requisição
   * volta para a casa que pediu; a liquidação vai para quem paga.
   *
   * Grava o NOME da secretaria, e é ele que o documento imprime: renomear ou
   * inativar a secretaria no cadastro financeiro amanhã não reescreve o
   * documento de hoje. Escolher aqui não escreve UMA LINHA no cadastro do
   * financeiro -- ele é só lido.
   */
  function escolherEncaminhamentoDaRequisicao(nome) {
    setAviso(null);
    setSujo(true);
    encaminhamentoSugerido.current = true;
    const escolhida = encaminhamentoPeloNome(
      secretariasParaEncaminhamento(secretariasFinanceiras),
      nome,
    );
    setFormulario((atual) => ({
      ...atual,
      ...dadosDoEncaminhamentoDaRequisicao(escolhida ?? { nome: String(nome ?? "").trim() }),
    }));
  }

  /**
   * Escolhe A SECRETARIA DO ENCAMINHAMENTO DA LIQUIDAÇÃO (página 2) -- o "À
   * SECRETARIA DE ______" do despacho, que antes saía em branco no papel.
   *
   * ⚠️ NÃO É A SECRETARIA SOLICITANTE. Quem requisita pode ser qualquer
   * secretaria do município e vem do cadastro próprio do módulo; quem recebe o
   * processo para as providências é uma das que TÊM FINANCEIRO, e essas são
   * LIDAS do cadastro de secretarias do módulo financeiro.
   *
   * A escolha é guardada por NOME e por id, e é o NOME que o documento imprime:
   * renomear ou inativar a secretaria no cadastro financeiro amanhã não reescreve
   * o documento de hoje. ⚠️ Escolher aqui não escreve UMA LINHA no cadastro do
   * financeiro -- ele é só lido.
   */
  function escolherEncaminhamento(nome) {
    setAviso(null);
    setSujo(true);
    encaminhamentoSugerido.current = true;
    const escolhida = encaminhamentoPeloNome(
      secretariasParaEncaminhamento(secretariasFinanceiras),
      nome,
    );
    setFormulario((atual) => ({
      ...atual,
      ...(escolhida
        ? dadosDoEncaminhamentoParaDocumento(escolhida)
        : // Em branco de novo: o documento volta a completar sozinho, como
          // sempre fez no processo antigo.
          { encaminhar_secretaria_id: null, encaminhar_secretaria_nome: String(nome ?? "").trim() }),
    }));
  }

  /**
   * Escolhe o FORNECEDOR no cadastro e PUXA os dados dele para o documento.
   *
   * Traz razão social, CPF/CNPJ, endereço, banco, agência, conta, PIX e
   * titular. COPIA num só sentido: nada é gravado no cadastro do fornecedor --
   * ele não é criado, não é alterado e não é marcado como pago. O vínculo
   * interno (`fornecedor_id`) fica guardado para a busca e para a auditoria.
   */
  async function puxarFornecedor(fornecedor) {
    setAviso(null);
    setSujo(true);
    setBuscaFornecedor("");

    // O cadastro completo tem o endereço, que a lista da busca não traz. Falha
    // na leitura não impede nada: o que a lista tem já entra no documento.
    let completo = fornecedor;
    try {
      completo = (await carregarFornecedorCompleto(fornecedor?.id)) ?? fornecedor;
    } catch {
      completo = fornecedor;
    }

    const dados = dadosDoFornecedorParaDocumento({ ...fornecedor, ...completo });
    setFormulario((atual) => {
      const mesclado = { ...atual, fornecedor_id: dados.fornecedor_id ?? null };
      Object.entries(dados).forEach(([chave, valor]) => {
        if (chave === "fornecedor_id") return;
        // Campo vazio do cadastro não apaga o que o documento já tem escrito.
        if (String(valor ?? "").trim() !== "") mesclado[chave] = valor;
      });
      return mesclado;
    });
  }

  /**
   * Solta o vínculo com o cadastro, PRESERVANDO o que o documento já diz.
   *
   * Preencher à mão é caminho legítimo: favorecido que não está cadastrado
   * continua entrando no documento pelos campos abaixo, e isso NÃO CRIA
   * FORNECEDOR no cadastro.
   */
  function soltarFornecedor() {
    setAviso(null);
    setSujo(true);
    setBuscaFornecedor("");
    setFormulario((atual) => soltarVinculoDeCadastro(atual));
  }

  /**
   * Escolhe QUAL conta ou QUAL chave PIX vai impressa.
   *
   * Fornecedor com mais de uma conta ou mais de um PIX não decide sozinho o que
   * sai no papel: a escolha é de quem monta o documento. PIX e conta não se
   * excluem -- o modelo oficial tem linha para os dois, e escolher um não apaga
   * o outro.
   */
  function escolherFormaDePagamento(opcao) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => ({ ...atual, ...opcao.dados }));
  }

  /**
   * Vincula uma NF/processo financeiro JÁ REGISTRADO.
   *
   * ⚠️ É APENAS CONSULTA. Copia número, emissão, valor bruto, retenções e valor
   * líquido para dentro DESTE documento e preenche a FUNDAMENTAÇÃO com o número
   * da nota. A nota original não é alterada, NÃO recebe baixa, não muda de
   * situação e o VALOR EM ABERTO DELA CONTINUA O MESMO. Nenhum pagamento é
   * criado, nenhuma conta é debitada.
   */
  function vincularNota(nota) {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => aplicarCalculo({ ...atual, ...dadosDaNotaParaDocumento(nota) }));
  }

  /** Desfaz o vínculo. A nota, de novo, não é tocada por isto. */
  function soltarNota() {
    setAviso(null);
    setSujo(true);
    setFormulario((atual) => soltarVinculoDaNota(atual));
  }

  /**
   * Escolhe um SIGNATÁRIO no cadastro de servidores.
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

  /**
   * FINALIZAR, e opcionalmente JÁ ABRIR A IMPRESSÃO -- numa única ação.
   *
   * A conferência vem PRIMEIRO, sempre: processo que não pode ser finalizado
   * avisa o que falta e NÃO abre impressão nenhuma. Só depois de finalizar é
   * que o papel sai -- e finalizar continua não sendo pagar, nem imprimir
   * altera o processo.
   */
  async function finalizar({ comImpressao = false } = {}) {
    const erros = validarFinalizacao(formulario);
    const impedimento = primeiroErro(erros);
    if (impedimento) {
      setAviso(impedimento);
      setSecao(erros.solicitante_id || erros.data_processo ? "gerais" : "requisicao");
      return;
    }
    if (!criado) {
      setAviso("Salve o rascunho primeiro: é nele que o número do processo é emitido.");
      return;
    }
    const ok = comImpressao
      ? await onFinalizarEImprimir?.(formulario)
      : await onFinalizar?.(formulario);
    if (ok !== false) setSujo(false);
  }

  const escolhido = React.useMemo(
    () => fornecedores.find((f) => String(f.id) === String(formulario.fornecedor_id)) ?? null,
    [fornecedores, formulario.fornecedor_id],
  );

  const fornecedoresEncontrados = React.useMemo(() => {
    if (buscaFornecedor.trim() === "") return [];
    return (fornecedores ?? [])
      .filter((fornecedor) => fornecedorAtendeBusca(fornecedor, buscaFornecedor))
      .slice(0, 20);
  }, [fornecedores, buscaFornecedor]);

  // Só os ATIVOS são oferecidos para um documento novo: servidor inativo
  // continua no cadastro (e nos processos antigos), mas não entra em processo
  // novo.
  const signatariosEncontrados = React.useMemo(() => {
    if (buscaSignatario.trim() === "") return [];
    return filtrarServidores(servidoresAtivos(servidores), {
      busca: buscaSignatario,
      secretarias,
    }).slice(0, 20);
  }, [servidores, buscaSignatario, secretarias]);

  const opcoesDePagamento = React.useMemo(
    () => opcoesDePagamentoDoFornecedor(formasPagamento),
    [formasPagamento],
  );

  const situacao = situacaoServicoInfo(formulario.situacao);
  const numero = numeroDoProcesso(formulario);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-6 sm:px-4 sm:py-8">
      <div className="w-full max-w-4xl rounded-2xl border border-black/5 bg-white shadow-lg">
        {/* Cabeçalho: o número do processo é o mesmo nas duas páginas. */}
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#C9A227]">
              Processos · Serviços/Materiais
            </div>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-[#0F2A44]">
              {tituloDoProcesso(formulario)}
            </h2>
            <p className="mt-0.5 text-xs text-[#0F2A44]/50">
              {numero === ""
                ? "O número é emitido no primeiro salvamento e vale para as duas páginas."
                : "Um processo, duas páginas — as duas com este número, que não é impresso no papel."}
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

        {/* As três seções da tela: os dados gerais e as duas páginas. */}
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
              solicitantes={solicitantes}
              somenteLeitura={somenteLeitura}
              definir={definir}
              onEscolherSolicitante={escolherSolicitante}
            />
          )}

          {secao === "requisicao" && (
            <SecaoRequisicao
              formulario={formulario}
              secretarias={secretarias}
              secretariasFinanceiras={secretariasFinanceiras}
              somenteLeitura={somenteLeitura}
              definir={definir}
              onEscolherEncaminhamentoDaRequisicao={escolherEncaminhamentoDaRequisicao}
              mexerNosItens={mexerNosItens}
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
              secretariasFinanceiras={secretariasFinanceiras}
              bancos={bancos}
              somenteLeitura={somenteLeitura}
              definir={definir}
              onEscolherEncaminhamento={escolherEncaminhamento}
              definirExtensoManual={definirExtensoManual}
              voltarAoExtensoAutomatico={voltarAoExtensoAutomatico}
              fornecedorEscolhido={escolhido}
              fornecedoresEncontrados={fornecedoresEncontrados}
              buscaFornecedor={buscaFornecedor}
              onBuscaFornecedor={setBuscaFornecedor}
              onPuxarFornecedor={puxarFornecedor}
              onSoltarFornecedor={soltarFornecedor}
              opcoesDePagamento={opcoesDePagamento}
              onEscolherFormaDePagamento={escolherFormaDePagamento}
              notas={notas}
              carregandoNotas={carregandoNotas}
              onVincularNota={vincularNota}
              onSoltarNota={soltarNota}
              servidores={servidores}
              signatariosEncontrados={signatariosEncontrados}
              buscaSignatario={buscaSignatario}
              onBuscaSignatario={setBuscaSignatario}
              onPuxarSignatario={puxarSignatario}
              onSoltarSignatario={soltarSignatario}
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
                  : "Rascunho pode ser salvo a qualquer momento, sem as duas páginas completas."}
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
              onClick={() => finalizar()}
              disabled={salvando || !criado}
              title="Fecha o documento para alteração. Finalizar não é pagar."
              className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-[#0F2A44]/20 px-4 py-2 text-sm text-[#0F2A44] hover:bg-black/5 disabled:opacity-60"
            >
              <FileCheck2 size={15} /> Finalizar
            </button>
          )}

          {/* FINALIZAR E IMPRIMIR: uma única ação. Fecha o documento e abre a
              impressão do processo completo (2 páginas) na sequência, sem passo intermediário. As duas
              ações separadas continuam existindo: "Finalizar" sozinha, aqui ao
              lado, e "Imprimir" pela lista de processos. Se faltar campo
              obrigatório, avisa e NÃO imprime. Finalizar não é pagar, e imprimir
              não altera o processo. */}
          {permissoes.finalizar && permissoes.imprimir && rascunho && (
            <button
              type="button"
              onClick={() => finalizar({ comImpressao: true })}
              disabled={salvando || !criado}
              title="Finaliza e abre a impressão do processo completo (2 páginas) numa única ação. Finalizar não é pagar."
              className="flex min-h-[2.5rem] items-center gap-1.5 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white hover:bg-[#0F2A44]/90 disabled:opacity-60"
            >
              <Printer size={15} /> Finalizar e imprimir
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

function Bloco({ titulo, apoio = null, children }) {
  return (
    <section className="rounded-xl border border-black/5 bg-white p-4 shadow-sm">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0F2A44]/60">{titulo}</h3>
      {apoio && <p className="mt-1 text-[11px] leading-relaxed text-[#0F2A44]/40">{apoio}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A SECRETARIA A QUEM A PREFEITA ENCAMINHA O PROCESSO.
 *
 * É o "À SECRETARIA DE ______" do despacho -- que antes saía EM BRANCO
 * no papel, para completar à mão. Agora é escolhido aqui e sai impresso já
 * preenchido, nas duas páginas.
 *
 * ⚠️ NÃO CONFUNDIR COM A SECRETARIA SOLICITANTE. A solicitante é o REQUISITANTE,
 * vem do cadastro próprio do módulo Processos e pode ser qualquer secretaria do
 * município. Esta é a que RECEBE o processo para as providências, e por isso é
 * sempre uma das que TÊM FINANCEIRO.
 *
 * ⚠️ A LISTA É LIDA DO CADASTRO DE SECRETARIAS DO MÓDULO FINANCEIRO -- o mesmo de
 * Saldos das Contas e dos Pagamentos Diários -- e APENAS LIDA: o módulo Processos
 * não cria, não altera e não exclui nada lá. Uma secretaria com financeiro criada
 * amanhã aparece aqui sozinha, sem mexer em nada aqui dentro.
 */
function CampoEncaminhamento({
  nomeGravado = "",
  idGravado = null,
  secretariasFinanceiras = [],
  somenteLeitura,
  onEscolher,
  rotulo = "Encaminhar à Secretaria de",
  apoio = null,
}) {
  // ⚠️ A ESCOLHA GRAVADA VEM POR PROPRIEDADE, e não lida de uma coluna fixa:
  // cada folha guarda o destino DELA (a requisição em `despacho_secretaria`, a
  // liquidação em `encaminhar_secretaria_nome`), e o mesmo campo de tela serve
  // às duas sem arrastar uma na outra.
  const gravado = String(nomeGravado ?? "").trim();

  const oferecidas = React.useMemo(() => {
    const lista = secretariasParaEncaminhamento(secretariasFinanceiras);
    if (gravado === "") return lista;
    const chave = chaveDaSecretaria(gravado);
    if (lista.some((s) => chaveDaSecretaria(s.nome) === chave)) return lista;
    // O que ESTA FOLHA gravou continua oferecido mesmo que a secretaria tenha
    // sido inativada ou renomeada no cadastro financeiro: documento emitido não
    // troca de destino sozinho.
    return [
      { id: idGravado ?? null, nome: gravado, nucleo: nucleoDaSecretaria(gravado) },
      ...lista,
    ];
  }, [secretariasFinanceiras, gravado, idGravado]);

  const escolhida =
    gravado === ""
      ? null
      : oferecidas.find((s) => chaveDaSecretaria(s.nome) === chaveDaSecretaria(gravado)) ?? null;

  return (
    <Campo rotulo={rotulo} apoio={apoio}>
      <select
        value={escolhida ? escolhida.nome : ""}
        onChange={(e) => onEscolher?.(e.target.value)}
        disabled={somenteLeitura}
        className={CLASSE_CAMPO}
      >
        <option value="">
          {oferecidas.length === 0
            ? "Cadastro do financeiro ainda não lido — o documento sai com Finanças"
            : "Escolha a secretaria de destino..."}
        </option>
        {oferecidas.map((secretaria) => (
          <option key={secretaria.id ?? secretaria.nome} value={secretaria.nome}>
            {secretaria.nucleo || secretaria.nome}
          </option>
        ))}
      </select>
    </Campo>
  );
}

/**
 * As OPÇÕES DO FORMULÁRIO -- as quatro da página 1 e as duas da página 2.
 *
 * Marca-se UMA: é um grupo de escolha única, como no papel, onde a escolhida sai
 * com o "X" e as outras saem em branco.
 */
function EscolhaUnica({ nome, opcoes, valor, onEscolher, somenteLeitura }) {
  return (
    <div className="space-y-2">
      {opcoes.map((opcao) => (
        <label
          key={opcao.id}
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
            valor === opcao.id
              ? "border-[#0F2A44]/30 bg-[#F8FAFC] text-[#0F2A44]"
              : "border-black/10 text-[#0F2A44]/75 hover:bg-black/[0.02]"
          }`}
        >
          <input
            type="radio"
            name={nome}
            checked={valor === opcao.id}
            onChange={() => onEscolher(opcao.id)}
            disabled={somenteLeitura}
            className="mt-0.5 h-4 w-4 shrink-0 border-black/20"
          />
          <span className={valor === opcao.id ? "font-medium" : undefined}>{opcao.rotulo}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Quem ASSINA uma linha do documento — escolhido no cadastro ou digitado.
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
          rotulo="Cargo / identificação funcional"
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

/**
 * Os dados bancários do documento — não são o cadastro de ninguém.
 *
 * O BANCO É ESCOLHIDO NO CADASTRO DE BANCOS, com busca por número ou por nome,
 * e o documento imprime o par "001 — Banco do Brasil", como no modelo oficial.
 * O número e o nome ficam GRAVADOS no processo: renomear um banco no cadastro
 * amanhã não reescreve o documento emitido hoje.
 */
function DadosBancarios({ formulario, bancos = [], somenteLeitura, definir }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SeletorBanco
        bancos={bancos}
        codigo={formulario.banco_codigo}
        nome={formulario.banco}
        somenteLeitura={somenteLeitura}
        onEscolher={(banco) => {
          const dados = dadosDoBancoParaDocumento(banco);
          definir("banco_codigo", dados.banco_codigo);
          definir("banco", dados.banco);
        }}
        onLimpar={() => {
          definir("banco_codigo", "");
          definir("banco", "");
        }}
        aoDigitarNome={(valor) => definir("banco", valor)}
      />
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
 * Dados Gerais: digitados uma vez, valem para as duas páginas
 * ---------------------------------------------------------------------- */

function SecaoDadosGerais({
  formulario,
  solicitantes = [],
  somenteLeitura,
  definir,
  onEscolherSolicitante,
}) {
  // Só as ATIVAS são oferecidas -- mais a que este processo já tem gravada,
  // para que inativar uma secretaria depois não tire o documento do ar.
  const solicitantesOferecidas = React.useMemo(() => {
    const vinculada = String(formulario.solicitante_id ?? "");
    const ativas = solicitantesAtivos(solicitantes);
    if (vinculada === "" || ativas.some((s) => String(s.id) === vinculada)) return ativas;
    const atual = (solicitantes ?? []).find((s) => String(s.id) === vinculada);
    return atual ? [atual, ...ativas] : ativas;
  }, [solicitantes, formulario.solicitante_id]);

  const solicitanteEscolhido = React.useMemo(
    () => (solicitantes ?? []).find((s) => String(s.id) === String(formulario.solicitante_id)) ?? null,
    [solicitantes, formulario.solicitante_id],
  );

  return (
    <>
      <p className="rounded-lg border border-[#C9A227]/25 bg-[#FFFBEF] px-4 py-3 text-xs leading-relaxed text-[#0F2A44]/70">
        Estes dados valem para as DUAS páginas do processo: digite uma vez e eles aparecem na
        Requisição e na Liquidação. Este é um documento — preencher, salvar ou finalizar não debita
        conta, não dá baixa em NF e não altera saldo nenhum.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CampoTexto
          rotulo="Data do processo (abertura)"
          tipo="date"
          valor={formulario.data_processo}
          onChange={(v) => definir("data_processo", v)}
          desabilitado={somenteLeitura}
          apoio="Só a referência de ABERTURA, usada na lista e na ordenação. Cada documento tem a data DELE: a da requisição na página 1 e a da liquidação na página 2."
        />
        <Campo
          rotulo="Secretaria solicitante (o REQUISITANTE das duas páginas)"
          apoio="O cadastro próprio do módulo, em Configurações → Processos. Escolher aqui traz o nome oficial, o secretário, o CPF e o cargo."
        >
          <select
            value={formulario.solicitante_id ?? ""}
            onChange={(e) => onEscolherSolicitante?.(e.target.value)}
            disabled={somenteLeitura}
            className={CLASSE_CAMPO}
          >
            <option value="">Escolha a secretaria solicitante...</option>
            {solicitantesOferecidas.map((solicitante) => (
              <option key={solicitante.id} value={solicitante.id}>
                {rotuloDoSolicitante(solicitante)}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {/* ⚠️ Este NÃO é o cadastro de secretarias do módulo financeiro. Quem
          requisita quase nunca é quem paga, então o módulo tem o seu próprio
          cadastro -- e o financeiro segue existindo, separado e intocado,
          servindo Saldos, Pagamentos e contas bancárias. */}
      {solicitanteEscolhido ? (
        <div className="rounded-lg border border-black/10 bg-[#F8FAFC] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
            Dados que vão gravados no documento
          </p>
          <p className="mt-1 text-sm font-medium text-[#0F2A44]">
            {formulario.solicitante_nome || solicitanteEscolhido.nome || "--"}
          </p>
          <p className="text-[11px] text-[#0F2A44]/55">
            {[
              formulario.solicitante_secretario || "Secretário(a) não informado no cadastro",
              formulario.solicitante_secretario_cpf,
              formulario.solicitante_secretario_cargo,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 text-[11px] text-[#0F2A44]/40">
            Congelado no processo: trocar o secretário no cadastro depois não altera este documento.
          </p>
        </div>
      ) : solicitantes.length === 0 ? (
        <p className="rounded-lg border border-[#C9A227]/25 bg-[#FFFBEF] px-4 py-3 text-[11px] leading-relaxed text-[#0F2A44]/70">
          Nenhuma secretaria solicitante cadastrada ainda. Cadastre em Configurações → Processos →
          Secretarias solicitantes. Enquanto isso, o processo antigo continua abrindo e imprimindo com
          a secretaria que já gravou.
        </p>
      ) : null}

      <CampoArea
        rotulo="Objeto do processo"
        valor={formulario.objeto}
        onChange={(v) => definir("objeto", v)}
        desabilitado={somenteLeitura}
        linhas={2}
        apoio="Resumo do que se requisita. É o que a lista mostra na coluna Objeto; em branco, ela usa o primeiro item do quadro descritivo."
      />

      <CampoArea
        rotulo="Observações"
        valor={formulario.observacoes}
        onChange={(v) => definir("observacoes", v)}
        desabilitado={somenteLeitura}
        linhas={3}
        apoio="Controle interno — não é impresso no modelo oficial."
      />
    </>
  );
}

/* -------------------------------------------------------------------------
 * Página 1: Requisição de Material/Serviço
 *
 * ⚠️ SEM VALORES. Só ITEM, QUANT. e DISCRIMINAÇÃO.
 * ---------------------------------------------------------------------- */

function SecaoRequisicao({
  formulario,
  secretarias,
  secretariasFinanceiras = [],
  somenteLeitura,
  definir,
  onEscolherEncaminhamentoDaRequisicao,
  mexerNosItens,
  servidores = [],
  signatariosEncontrados = [],
  buscaSignatario = "",
  onBuscaSignatario,
  onPuxarSignatario,
  onSoltarSignatario,
}) {
  // ⚠️ A SOLICITANTE primeiro: o nome oficial gravado no processo, depois o
  // cadastro do módulo e, só no processo antigo, a secretaria do financeiro.
  const secretaria = nomeDaSecretaria(formulario, secretarias) || "--";
  const requisitante = secretaria === "--"
    ? "--"
    : /^secretaria/i.test(secretaria) ? secretaria : `Secretaria Municipal de ${secretaria}`;
  const itens = itensDoProcesso(formulario);
  const preenchidos = totalDeItens(formulario);

  return (
    <>
      <p className="rounded-lg border border-[#0F2A44]/10 bg-[#F8FAFC] px-4 py-3 text-xs leading-relaxed text-[#0F2A44]/70">
        A página 1 do modelo oficial: <strong>Requisição de Material/Serviço</strong>. O requisitante
        pede à Senhora Prefeita a AUTORIZAÇÃO para uma das quatro opções, e descreve o que quer no
        quadro descritivo. <strong>Esta página não tem valores</strong> — eles ficam só na página 2.
      </p>

      {/* ⚠️ A DATA É DESTA PÁGINA. A requisição é feita num dia, a liquidação
          dias ou semanas depois: cada documento do processo carrega a data
          DELE, e a data de abertura dos Dados Gerais não manda em nenhuma. */}
      <Bloco
        titulo="Requisitante e data da requisição"
        apoio="A data desta folha é editável e independente da página 2 — a de hoje é só a sugestão inicial, e datas anteriores são aceitas."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CampoTexto
            rotulo="Data da Requisição de Material/Serviço"
            tipo="date"
            valor={formulario.requisicao_data}
            onChange={(v) => definir("requisicao_data", v)}
            desabilitado={somenteLeitura}
            apoio="Sai no “São José da Laje/AL, ___ de ___ de ____” e no “Em, ___/___/____” da autorização da prefeita DESTA folha. Em branco, o documento usa a data de abertura."
          />
          <Campo rotulo="REQUISITANTE (como sai impresso)" apoio="Vem dos Dados Gerais — é o mesmo nas duas páginas.">
            <input type="text" value={requisitante} disabled className={CLASSE_CAMPO} />
          </Campo>
        </div>
      </Bloco>

      {/* AS QUATRO OPÇÕES: marca-se UMA, e as outras três saem em branco. */}
      <Bloco
        titulo="Pelo presente, venho solicitar AUTORIZAÇÃO para:"
        apoio="Marque UMA das quatro. A escolhida sai com o X no papel; as outras saem em branco."
      >
        <EscolhaUnica
          nome="tipo-requisicao"
          opcoes={TIPOS_REQUISICAO}
          valor={formulario.tipo ?? ""}
          onEscolher={(valor) => definir("tipo", valor)}
          somenteLeitura={somenteLeitura}
        />
        <p className="mt-2 text-[11px] text-[#0F2A44]/40">
          A escolha aqui SUGERE a atestação e a referência da página 2 — e as duas continuam
          trocáveis à mão lá.
        </p>
      </Bloco>

      {/* O QUADRO DESCRITIVO: três colunas, e nenhuma de valor. */}
      <Bloco
        titulo="Quadro descritivo"
        apoio="ITEM, QUANT. e DISCRIMINAÇÃO — como no modelo oficial. Sem valor unitário e sem valor total: a requisição não tem valores."
      >
        <div className="space-y-2">
          {itens.map((item, indice) => (
            <div
              key={indice}
              className="grid grid-cols-[2.5rem_1fr] gap-2 rounded-lg border border-black/10 p-2 sm:grid-cols-[2.5rem_6rem_1fr_auto]"
            >
              {/* O número é a POSIÇÃO: remover ou reordenar renumera sozinho. */}
              <div className="flex items-center justify-center rounded-lg bg-[#F8FAFC] text-sm font-semibold text-[#0F2A44]">
                {numeroDoItem(indice)}
              </div>
              <input
                type="text"
                value={item.quantidade ?? ""}
                onChange={(e) =>
                  mexerNosItens((lista) => alterarItem(lista, indice, "quantidade", e.target.value))}
                disabled={somenteLeitura}
                placeholder="Quant."
                aria-label={`Quantidade do item ${numeroDoItem(indice)}`}
                className={CLASSE_CAMPO}
              />
              <textarea
                rows={2}
                value={item.discriminacao ?? ""}
                onChange={(e) =>
                  mexerNosItens((lista) => alterarItem(lista, indice, "discriminacao", e.target.value))}
                disabled={somenteLeitura}
                placeholder="Discriminação"
                aria-label={`Discriminação do item ${numeroDoItem(indice)}`}
                className={`${CLASSE_CAMPO} resize-y`}
              />
              {!somenteLeitura && (
                <div className="col-span-2 flex items-start gap-1.5 sm:col-span-1">
                  <button
                    type="button"
                    onClick={() => mexerNosItens((lista) => moverItem(lista, indice, "cima"))}
                    disabled={indice === 0}
                    title="Subir (a numeração acompanha)"
                    aria-label={`Subir o item ${numeroDoItem(indice)}`}
                    className="rounded-lg border border-black/10 p-2 text-[#0F2A44]/60 hover:bg-black/5 disabled:opacity-40"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mexerNosItens((lista) => moverItem(lista, indice, "baixo"))}
                    disabled={indice === itens.length - 1}
                    title="Descer (a numeração acompanha)"
                    aria-label={`Descer o item ${numeroDoItem(indice)}`}
                    className="rounded-lg border border-black/10 p-2 text-[#0F2A44]/60 hover:bg-black/5 disabled:opacity-40"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mexerNosItens((lista) => removerItem(lista, indice))}
                    title="Remover o item (os seguintes são renumerados)"
                    aria-label={`Remover o item ${numeroDoItem(indice)}`}
                    className="rounded-lg border border-black/10 p-2 text-[#0F2A44]/60 hover:bg-black/5"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!somenteLeitura && (
          <button
            type="button"
            onClick={() => mexerNosItens((lista) => adicionarItem(lista))}
            className="mt-3 flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-[#0F2A44]/20 px-3 py-2 text-sm text-[#0F2A44] hover:bg-black/5"
          >
            <Plus size={15} /> Adicionar item
          </button>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-[#0F2A44]/45">
          {preenchidos === 0
            ? "Nenhum item preenchido ainda: o quadro sai no papel com as linhas em branco e o número já impresso, para completar à mão."
            : `${preenchidos} ${preenchidos === 1 ? "item preenchido" : "itens preenchidos"} — a numeração (01, 02, 03...) é automática e acompanha a ordem da lista. Com muitos itens o quadro continua na folha seguinte, sem cortar item e sem reduzir a fonte.`}
        </p>
      </Bloco>

      {/* O DESPACHO DA PREFEITA, impresso AO LADO da assinatura do
          requisitante -- na mesma faixa, e não um embaixo do outro, para o
          documento caber em UMA folha. */}
      <Bloco
        titulo="Autorização da prefeita"
        apoio="O despacho impresso na página 1, ao lado da assinatura do requisitante. O “À SECRETARIA DE ___” sai JÁ PREENCHIDO com a secretaria escolhida aqui."
      >
        {/* ⚠️ O DESTINO DESTA FOLHA, gravado no campo DELA
            (`despacho_secretaria`). A página 2 tem o campo dela, com padrão
            Finanças: trocar aqui NÃO troca lá. É a diferença entre quem
            SOLICITA e quem PAGA. */}
        <CampoEncaminhamento
          nomeGravado={formulario.despacho_secretaria}
          secretariasFinanceiras={secretariasFinanceiras}
          somenteLeitura={somenteLeitura}
          onEscolher={onEscolherEncaminhamentoDaRequisicao}
          apoio="A secretaria a quem a prefeita ENCAMINHA esta requisição — uma das que têm financeiro, lidas do cadastro do módulo financeiro (o mesmo de Saldos e Pagamentos), que este módulo apenas LÊ. Não é a secretaria solicitante. A página 2 tem o destino dela, com Finanças por padrão, e é independente desta."
        />
      </Bloco>

      {/* A assinatura do requisitante: "(assinatura, nome e identificação
          funcional do requisitante)", ao pé da página 1. */}
      <Bloco
        titulo="Assinatura da requisição"
        apoio="A linha ao pé da página 1. Nome, CPF e cargo ficam gravados no processo: o documento guarda quem assinou naquele momento."
      >
        <CampoSignatario
          signatario={SIGNATARIOS.requisicao}
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
      </Bloco>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Página 2: Liquidação/Solicitação de Pagamento
 * ---------------------------------------------------------------------- */

function SecaoLiquidacao({
  formulario,
  secretarias,
  secretariasFinanceiras = [],
  bancos = [],
  somenteLeitura,
  definir,
  onEscolherEncaminhamento,
  definirExtensoManual,
  voltarAoExtensoAutomatico,
  fornecedorEscolhido = null,
  fornecedoresEncontrados = [],
  buscaFornecedor = "",
  onBuscaFornecedor,
  onPuxarFornecedor,
  onSoltarFornecedor,
  opcoesDePagamento = [],
  onEscolherFormaDePagamento,
  notas = [],
  carregandoNotas = false,
  onVincularNota,
  onSoltarNota,
  servidores = [],
  signatariosEncontrados = [],
  buscaSignatario = "",
  onBuscaSignatario,
  onPuxarSignatario,
  onSoltarSignatario,
}) {
  const secretaria = nomeDaSecretaria(formulario, secretarias) || "--";
  const requisitante = secretaria === "--"
    ? "--"
    : /^secretaria/i.test(secretaria) ? secretaria : `Secretaria Municipal de ${secretaria}`;
  const comNota = temNotaVinculada(formulario);

  return (
    <>
      <p className="rounded-lg border border-[#0F2A44]/10 bg-[#F8FAFC] px-4 py-3 text-xs leading-relaxed text-[#0F2A44]/70">
        A página 2 do modelo oficial: o requisitante solicita à Senhora Prefeita a AUTORIZAÇÃO de
        pagamento em favor do beneficiário. O requisitante e os dados gerais já estão aqui — vêm da
        página 1, sem digitação repetida. <strong>É um documento</strong>: não é baixa de pagamento,
        não debita conta e não paga nada.
      </p>

      <Bloco titulo="Requisitante (dados do processo)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo rotulo="REQUISITANTE" apoio="O mesmo da página 1 — é o mesmo dado, não uma cópia.">
            <input type="text" value={requisitante} disabled className={CLASSE_CAMPO} />
          </Campo>
          <Campo rotulo="ÓRGÃO REQUISITANTE (quadro resumo)">
            <input type="text" value={requisitante} disabled className={CLASSE_CAMPO} />
          </Campo>
        </div>
        <p className="mt-2 text-[11px] text-[#0F2A44]/40">
          Para corrigir, volte aos Dados Gerais: a alteração aparece aqui na hora, porque é a mesma
          secretaria do mesmo registro.
        </p>
      </Bloco>

      {/* AS DUAS ATESTAÇÕES: marca-se UMA, sugerida pelo tipo da página 1. */}
      <Bloco
        titulo="... o(a) qual:"
        apoio="Sugerida pelo tipo marcado na página 1 (serviços e contratação → prestou serviços; aquisição e locação → forneceu materiais). Pode ser trocada aqui."
      >
        <EscolhaUnica
          nome="atestado-liquidacao"
          opcoes={ATESTADOS}
          valor={formulario.atestado ?? ""}
          onEscolher={(valor) => definir("atestado", valor)}
          somenteLeitura={somenteLeitura}
        />
      </Bloco>

      <Bloco titulo="Quadro resumo">
        <CampoTexto
          rotulo="Referência"
          valor={formulario.referencia}
          onChange={(v) => definir("referencia", v)}
          desabilitado={somenteLeitura}
          apoio="A frase do modelo (“Referente ao pagamento de serviço prestado/da aquisição de ...”), completada com o objeto."
        />
        <CampoTexto
          rotulo="Fundamentação"
          valor={formulario.fundamentacao}
          onChange={(v) => definir("fundamentacao", v)}
          desabilitado={somenteLeitura}
          className="mt-3"
          apoio="A nota fiscal. Vinculando uma NF registrada abaixo, o número dela entra aqui."
        />
      </Bloco>

      {/* O FAVORECIDO: do cadastro de fornecedores ou à mão. */}
      <Bloco
        titulo="Favorecido(a)"
        apoio="Buscar no cadastro traz razão social, CPF/CNPJ, endereço, banco, agência, conta e PIX. Editar aqui vale só para este documento — o cadastro do fornecedor não muda."
      >
        {fornecedorEscolhido ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#0F2A44]">
                {nomeExibicaoDoFornecedor(fornecedorEscolhido)}
              </p>
              {complementoDoFornecedor(fornecedorEscolhido) && (
                <p className="truncate text-[11px] text-[#0F2A44]/50">
                  {complementoDoFornecedor(fornecedorEscolhido)}
                </p>
              )}
              <p className="text-[11px] text-[#0F2A44]/40">
                Vínculo interno preservado. O que você editar abaixo vale só neste documento.
              </p>
            </div>
            {!somenteLeitura && (
              <button
                type="button"
                onClick={onSoltarFornecedor}
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
                value={buscaFornecedor}
                onChange={(e) => onBuscaFornecedor?.(e.target.value)}
                disabled={somenteLeitura}
                placeholder="Buscar por razão social, nome, apelido ou CPF/CNPJ..."
                className="w-full bg-transparent py-2.5 text-sm text-[#0F2A44] outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-[#0F2A44]/40">
              Opcional: se o favorecido não estiver cadastrado, preencha os campos abaixo à mão.
              Preencher à mão NÃO cria fornecedor no cadastro.
            </p>
            {fornecedoresEncontrados.length > 0 && (
              <ul className="mt-2 max-h-52 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10">
                {fornecedoresEncontrados.map((fornecedor) => (
                  <li key={fornecedor.id}>
                    <button
                      type="button"
                      onClick={() => onPuxarFornecedor?.(fornecedor)}
                      className="block w-full px-3 py-2.5 text-left hover:bg-black/[0.03]"
                    >
                      <span className="block truncate text-sm text-[#0F2A44]">
                        {nomeExibicaoDoFornecedor(fornecedor)}
                      </span>
                      <span className="block truncate text-[11px] text-[#0F2A44]/45">
                        {complementoDoFornecedor(fornecedor) || fornecedor.cpf_cnpj || ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CampoTexto
            rotulo="Nome/Razão social"
            valor={formulario.favorecido_nome}
            onChange={(v) => definir("favorecido_nome", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="CPF/CNPJ"
            valor={formulario.favorecido_cpf_cnpj}
            onChange={(v) => definir("favorecido_cpf_cnpj", v)}
            desabilitado={somenteLeitura}
          />
          <CampoTexto
            rotulo="Endereço"
            valor={formulario.favorecido_endereco}
            onChange={(v) => definir("favorecido_endereco", v)}
            desabilitado={somenteLeitura}
            className="sm:col-span-2"
          />
        </div>
      </Bloco>

      {/* Mais de uma conta ou mais de um PIX: a escolha é de quem monta o
          documento, e não do cadastro. */}
      {opcoesDePagamento.length > 1 && !somenteLeitura && (
        <Bloco
          titulo="Qual conta ou chave PIX vai no documento"
          apoio="O fornecedor tem mais de uma forma cadastrada. Escolha a que sai impressa — PIX e conta não se excluem: o papel tem linha para os dois."
        >
          <ul className="space-y-1.5">
            {opcoesDePagamento.map((opcao) => (
              <li key={opcao.id}>
                <button
                  type="button"
                  onClick={() => onEscolherFormaDePagamento?.(opcao)}
                  className="block w-full rounded-lg border border-black/10 px-3 py-2 text-left text-sm text-[#0F2A44] hover:bg-black/[0.03]"
                >
                  {opcao.rotulo}
                </button>
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      <Bloco
        titulo="Dados bancários"
        apoio="Do documento. Editar aqui não altera o cadastro do fornecedor nem o PIX dele."
      >
        <DadosBancarios formulario={formulario} bancos={bancos} somenteLeitura={somenteLeitura} definir={definir} />
      </Bloco>

      {/* ⚠️ A NF É CONSULTA. Vincular copia os valores para este documento e não
          altera a nota: não dá baixa, não muda a situação e não mexe no valor em
          aberto dela. */}
      <Bloco
        titulo="Nota fiscal / processo financeiro (consulta)"
        apoio="⚠️ Apenas consulta: selecionar uma NF preenche os valores deste documento e NÃO altera a nota, NÃO dá baixa e NÃO muda o valor em aberto dela."
      >
        {comNota ? (
          <div className="rounded-lg border border-black/10 bg-[#F8FAFC] px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-[#0F2A44]">
                  NF {formulario.nota_numero || "sem número"}
                  {formulario.nota_emissao ? ` — emitida em ${formulario.nota_emissao}` : ""}
                </p>
                <p className="text-[11px] text-[#0F2A44]/55">
                  {[
                    `Bruto ${formatBRL(formulario.nota_valor_bruto)}`,
                    `Retenções ${formatBRL(formulario.nota_retencoes)}`,
                    `Líquido ${formatBRL(formulario.nota_valor_liquido)}`,
                  ].join(" · ")}
                </p>
                <p className="mt-1 text-[11px] text-[#0F2A44]/40">
                  Cópia guardada neste documento. A nota original segue como estava: sem baixa, sem
                  alteração de situação e com o mesmo valor em aberto.
                </p>
              </div>
              {!somenteLeitura && (
                <button
                  type="button"
                  onClick={onSoltarNota}
                  title="Desfaz o vínculo. A nota também não é alterada por isto."
                  className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs text-[#0F2A44]/70 hover:bg-black/5"
                >
                  Soltar vínculo
                </button>
              )}
            </div>
          </div>
        ) : !formulario.fornecedor_id ? (
          <p className="text-[11px] text-[#0F2A44]/45">
            Escolha o favorecido no cadastro acima para consultar as notas fiscais dele. Sem NF
            registrada, a fundamentação continua sendo digitada à mão.
          </p>
        ) : carregandoNotas ? (
          <p className="text-[11px] text-[#0F2A44]/45">Carregando as notas do fornecedor...</p>
        ) : notas.length === 0 ? (
          <p className="text-[11px] text-[#0F2A44]/45">
            Nenhuma nota registrada para este fornecedor. A fundamentação e o valor seguem digitáveis
            à mão.
          </p>
        ) : (
          <ul className="max-h-52 space-y-1.5 overflow-y-auto">
            {notas.map((nota) => (
              <li key={nota.id}>
                <button
                  type="button"
                  onClick={() => onVincularNota?.(nota)}
                  disabled={somenteLeitura}
                  className="block w-full rounded-lg border border-black/10 px-3 py-2 text-left text-sm text-[#0F2A44] hover:bg-black/[0.03] disabled:opacity-60"
                >
                  {rotuloDaNota(nota)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      {/* O ÚNICO valor do processo. Ele só existe nesta página. */}
      <Bloco
        titulo="Valor"
        apoio="O valor do pagamento solicitado, impresso em algarismo e por extenso. É valor de documento: nenhum pagamento é criado e nenhuma conta é debitada por ele."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo rotulo="Valor (R$)">
            <CampoMoeda
              valor={formulario.valor_total}
              onValorChange={(numero) => definir("valor_total", numero)}
              disabled={somenteLeitura}
              className={CLASSE_CAMPO}
            />
          </Campo>
          <div>
            <CampoTexto
              rotulo="Valor por extenso"
              valor={formulario.valor_extenso}
              onChange={definirExtensoManual}
              desabilitado={somenteLeitura}
              apoio={
                formulario.valor_extenso_manual
                  ? "Redação assumida à mão — o automático não sobrescreve mais."
                  : "Gerado do valor. Digite aqui para assumir a redação."
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
        </div>
      </Bloco>

      {/* O DESPACHO DA PÁGINA 2: "À SECRETARIA DE ______, para as
          providências de pagamento". ⚠️ ESTA FOLHA TEM O DESTINO DELA, com
          FINANÇAS por padrão -- é quem paga, e é o que o modelo oficial já traz
          impresso. Trocar aqui não troca o da página 1. */}
      <Bloco
        titulo="Encaminhamento da liquidação"
        apoio="O destino DESTA folha, independente do da página 1. O modelo oficial traz Finanças, que é a sugestão, e a troca vale até finalizar."
      >
        <CampoEncaminhamento
          nomeGravado={formulario.encaminhar_secretaria_nome}
          idGravado={formulario.encaminhar_secretaria_id}
          secretariasFinanceiras={secretariasFinanceiras}
          somenteLeitura={somenteLeitura}
          onEscolher={onEscolherEncaminhamento}
          apoio="Sai impresso como “À SECRETARIA DE ______” no quadro de autorização da prefeita DESTA folha. Lida do cadastro de secretarias do módulo financeiro, que este módulo apenas LÊ. Quem solicita não é quem paga: por isso o padrão aqui é Finanças."
        />
      </Bloco>

      <Bloco
        titulo="Assinatura e data da liquidação"
        apoio="⚠️ A data desta folha é a DELA: a liquidação costuma ser dias ou semanas depois da requisição, e cada documento sai com a sua."
      >
        <CampoTexto
          rotulo="Data da Liquidação/Solicitação de Pagamento"
          tipo="date"
          valor={formulario.liquidacao_data}
          onChange={(v) => definir("liquidacao_data", v)}
          desabilitado={somenteLeitura}
          className="mb-3"
          apoio="Sai no “São José da Laje/AL, ___ de ___ de ____” e no “Em, ___/___/____” da autorização da prefeita DESTA folha. Datas anteriores são aceitas; em branco, o documento usa a data de abertura."
        />
        <CampoSignatario
          signatario={SIGNATARIOS.liquidacao}
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
