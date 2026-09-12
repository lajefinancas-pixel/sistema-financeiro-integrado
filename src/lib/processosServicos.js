// Processos de Serviços/Materiais: as regras do documento, sem banco e sem tela.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nada neste arquivo -- e nada na
// subaba -- debita conta, dá baixa em NF, altera saldo, marca fornecedor como
// pago, cria pagamento ou toca na Programação Diária.
// "LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO" é o NOME DO DOCUMENTO da página 2: é
// papel, não é baixa de pagamento.
//
// UM PROCESSO = DOIS DOCUMENTOS, como no modelo oficial da prefeitura: a
// Requisição de Material/Serviço (página 1) e a Liquidação/Solicitação de
// Pagamento (página 2). As duas páginas são do MESMO processo, e por isso vivem
// no MESMO registro: mesmo número, mesmos dados gerais. Não existem
// "requisições" e "liquidações" como registros independentes, nem subaba
// separada de liquidação.
//
// ⚠️ A REQUISIÇÃO NÃO TEM VALORES. O quadro descritivo da página 1 tem TRÊS
// colunas -- ITEM, QUANT. e DISCRIMINAÇÃO -- e nenhuma delas é de valor. Valor
// aparece somente na página 2, e é um só: o do pagamento solicitado.
//
// Este arquivo é carregado direto pelos testes, sem o resolvedor de módulos do
// Vite: só funções puras, nada de React e nada de supabase.

import { formatBRL, paraNumeroMoeda } from "./moeda.js";
import { valorPorExtenso } from "./valorPorExtenso.js";
import { camposDoSignatario } from "./processosServidores.js";
import { CAMPOS_SOLICITANTE_NO_PROCESSO } from "./processosSecretariasSolicitantes.js";
import { CAMPOS_ENCAMINHAMENTO } from "./processosEncaminhamento.js";

/* -------------------------------------------------------------------------
 * Identificação do módulo
 * ---------------------------------------------------------------------- */

export const TABELA_SERVICOS = "processos_servicos";
export const TABELA_SERVICOS_HISTORICO = "processos_servicos_historico";
export const TABELA_SERVICOS_NUMERACAO = "processos_servicos_numeracao";

/** A migration que cria as tabelas. Rodada À MÃO no SQL Editor do Supabase. */
export const MIGRATION_SERVICOS = "20260911260000_processos_modulo_servicos.sql";

export const AVISO_MIGRATION_SERVICOS =
  `A subaba Serviços/Materiais ainda não tem as tabelas dela neste banco. Rode a migration ${MIGRATION_SERVICOS} `
  + "no SQL Editor do Supabase e recarregue a página. Nenhum outro módulo é afetado por ela — Diárias, "
  + "Servidores, Saldos, Fornecedores e Pagamentos continuam exatamente como estão.";

/* -------------------------------------------------------------------------
 * Situações
 * ---------------------------------------------------------------------- */

/**
 * As três situações do ANDAMENTO DO DOCUMENTO.
 *
 * FINALIZAR NÃO É PAGAR: finalizada quer dizer que o papel está pronto e
 * fechado para alteração, não que alguém recebeu dinheiro. Não gera pagamento,
 * não debita conta, não dá baixa em nota e não altera saldo nenhum.
 */
export const SITUACOES_SERVICO = [
  {
    id: "rascunho",
    rotulo: "Rascunho",
    classe: "bg-[#EAF1FF] text-[#0F2A44]",
    descricao: "Em preenchimento. Pode ser editado e salvo quantas vezes for preciso.",
  },
  {
    id: "finalizada",
    rotulo: "Finalizada",
    classe: "bg-emerald-50 text-emerald-700",
    descricao: "Documento fechado. Finalizar não é pagar: nenhum valor é pago por esta situação.",
  },
  {
    id: "cancelada",
    rotulo: "Cancelada",
    classe: "bg-red-50 text-red-600",
    descricao: "Processo anulado. O registro, o número e o histórico são preservados.",
  },
];

export function situacaoServicoInfo(valor) {
  return SITUACOES_SERVICO.find((s) => s.id === valor) ?? SITUACOES_SERVICO[0];
}

/* -------------------------------------------------------------------------
 * Os quatro tipos da Requisição e as duas atestações da Liquidação
 * ---------------------------------------------------------------------- */

/**
 * As QUATRO opções da página 1, na ordem e com o texto do modelo oficial.
 *
 * Marca-se UMA. O documento impresso traz a escolhida com o "X" e as outras
 * três em branco -- é assim que o papel da prefeitura é, e é assim que ele sai.
 */
export const TIPOS_REQUISICAO = [
  { id: "aquisicao", rotulo: "AQUISIÇÃO DE MATERIAIS/PRODUTOS/EQUIPAMENTOS", curto: "Aquisição" },
  { id: "servicos", rotulo: "PRESTAÇÃO DE SERVIÇOS", curto: "Prestação de serviços" },
  { id: "contratacao", rotulo: "CONTRATAÇÃO", curto: "Contratação" },
  { id: "locacao", rotulo: "LOCAÇÃO", curto: "Locação" },
];

export function tipoInfo(valor) {
  return TIPOS_REQUISICAO.find((t) => t.id === valor) ?? null;
}

/** "Prestação de serviços" -- o que a coluna Tipo da lista mostra. */
export function rotuloDoTipo(processo) {
  return tipoInfo(texto(processo?.tipo))?.curto ?? "";
}

/**
 * As DUAS atestações da página 2, com o texto integral do modelo oficial.
 *
 * Marca-se UMA, e ela é o atestado de quem assina: ou os serviços foram
 * concluídos, ou os materiais foram recebidos.
 */
export const ATESTADOS = [
  {
    id: "servicos",
    rotulo:
      "prestou serviços, conforme descrito abaixo e que ATESTO sua conclusão de forma satisfatória.",
    curto: "Prestou serviços",
  },
  {
    id: "materiais",
    rotulo:
      "forneceu os materiais/produtos/equipamentos constantes na(s) nota(s) fiscal(is) em anexo e que "
      + "ATESTO o recebimento dos mesmos.",
    curto: "Forneceu materiais",
  },
];

export function atestadoInfo(valor) {
  return ATESTADOS.find((a) => a.id === valor) ?? null;
}

/**
 * A atestação que o tipo da página 1 SUGERE.
 *
 * Serviços e contratação atestam conclusão de serviço; aquisição e locação
 * atestam recebimento dos bens. É sugestão: quem preenche pode trocar, e a
 * troca não volta atrás sozinha.
 */
export function atestadoSugerido(tipo) {
  const escolhido = texto(tipo);
  if (escolhido === "servicos" || escolhido === "contratacao") return "servicos";
  if (escolhido === "aquisicao" || escolhido === "locacao") return "materiais";
  return "";
}

/**
 * A REFERÊNCIA que o quadro resumo sugere, na redação do modelo oficial
 * ("REFERENTE AO PAGAMENTO DE SERVIÇO PRESTADO/DA AQUISIÇÃO DE ...").
 *
 * O texto fica editável: a referência é uma frase do documento, e quem preenche
 * termina a frase com o objeto do processo.
 */
export function referenciaSugerida(tipo) {
  const escolhido = texto(tipo);
  if (escolhido === "servicos") return "Referente ao pagamento de serviço prestado";
  if (escolhido === "contratacao") return "Referente ao pagamento de serviço prestado";
  if (escolhido === "locacao") return "Referente ao pagamento da locação de";
  if (escolhido === "aquisicao") return "Referente ao pagamento da aquisição de";
  return "";
}

/* -------------------------------------------------------------------------
 * Numeração
 * ---------------------------------------------------------------------- */

/**
 * "0001/2026" -- número único do processo, sequencial e separado por ano.
 *
 * ⚠️ ELE É INTERNO. Serve para localizar, filtrar e auditar o processo na tela;
 * o PAPEL NÃO O IMPRIME, exatamente como nas diárias. Quem emite o número é o
 * banco (public.proximo_numero_processo_servico), que o marca como consumido na
 * mesma transação: número emitido nunca é reutilizado, nem quando o processo é
 * cancelado.
 */
export function numeroFormatado(ano, numero) {
  const seq = Number(numero);
  const exercicio = Number(ano);
  if (!Number.isFinite(seq) || seq <= 0 || !Number.isFinite(exercicio)) return "";
  return `${String(Math.trunc(seq)).padStart(4, "0")}/${Math.trunc(exercicio)}`;
}

export function numeroDoProcesso(processo) {
  return numeroFormatado(processo?.ano, processo?.numero);
}

/** "PROCESSO DE SERVIÇOS/MATERIAIS Nº 0001/2026" -- o título da tela. */
export function tituloDoProcesso(processo) {
  const numero = numeroDoProcesso(processo);
  return numero
    ? `PROCESSO DE SERVIÇOS/MATERIAIS Nº ${numero}`
    : "PROCESSO DE SERVIÇOS/MATERIAIS (novo)";
}

/**
 * Os títulos das duas folhas, como estão impressos no modelo oficial.
 *
 * São os nomes do papel, não apelidos internos: quem confere o processo procura
 * exatamente estas linhas no alto de cada página.
 */
export const TITULO_PAGINA_1 = "REQUISIÇÃO DE MATERIAL/SERVIÇO";
export const TITULO_PAGINA_2 = "LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO";

/* -------------------------------------------------------------------------
 * Leitura de valores
 * ---------------------------------------------------------------------- */

function texto(valor) {
  return String(valor ?? "").trim();
}

function vazio(valor) {
  return valor === null || valor === undefined || String(valor).trim() === "";
}

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Só os dígitos -- é assim que a busca por CPF/CNPJ encontra o formatado. */
function digitos(valor) {
  return texto(valor).replace(/\D/g, "");
}

/* -------------------------------------------------------------------------
 * Os itens do QUADRO DESCRITIVO
 * ---------------------------------------------------------------------- */

/**
 * Um item do quadro descritivo: quantidade e discriminação, e MAIS NADA.
 *
 * ⚠️ SEM VALOR. Não há valor unitário, não há valor total do item e não há
 * nenhuma outra coluna de dinheiro aqui -- a requisição não tem valores.
 *
 * O número do item (01, 02, 03...) NÃO é gravado: ele é a POSIÇÃO na lista.
 * É isso que faz a renumeração ser automática -- remover o item 02 faz o antigo
 * 03 virar 02 sem nenhuma renumeração a manter em dia.
 */
export function itemVazio() {
  return { quantidade: "", discriminacao: "" };
}

/** "01", "02", ... "10" -- o número do item, pela posição dele na lista. */
export function numeroDoItem(indice) {
  const posicao = Math.trunc(Number(indice));
  const ordem = Number.isFinite(posicao) ? posicao + 1 : 1;
  return String(ordem).padStart(2, "0");
}

/**
 * A lista de itens de um processo, sempre como array de `{quantidade,
 * discriminacao}`.
 *
 * Aceita o jsonb do banco, o array do formulário e o texto que um jsonb possa
 * ter chegado como -- processo antigo, importação, banco que devolva string --
 * e devolve sempre algo que a tela e o documento podem percorrer sem conferir
 * tipo.
 */
export function itensDoProcesso(processo) {
  const bruto = processo?.itens;
  const lista = Array.isArray(bruto) ? bruto : lerJson(bruto);
  return (Array.isArray(lista) ? lista : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      quantidade: texto(item.quantidade ?? item.quant ?? ""),
      discriminacao: texto(item.discriminacao ?? item.descricao ?? ""),
    }));
}

function lerJson(valor) {
  if (typeof valor !== "string" || valor.trim() === "") return [];
  try {
    const lido = JSON.parse(valor);
    return Array.isArray(lido) ? lido : [];
  } catch {
    return [];
  }
}

/** Um item tem conteúdo quando tem discriminação -- é ela que o papel exige. */
export function itemPreenchido(item) {
  return !vazio(item?.discriminacao);
}

/** Os itens que vão IMPRESSOS: os que têm discriminação, na ordem da lista. */
export function itensParaDocumento(processo) {
  return itensDoProcesso(processo)
    .filter(itemPreenchido)
    .map((item, indice) => ({ ...item, numero: numeroDoItem(indice) }));
}

/** "+ Adicionar item": um item em branco no fim da lista. */
export function adicionarItem(itens = []) {
  return [...itensDeLista(itens), itemVazio()];
}

/**
 * Remove o item da posição. A RENUMERAÇÃO É AUTOMÁTICA porque o número é a
 * posição: quem sai não deixa buraco na sequência.
 */
export function removerItem(itens = [], indice) {
  return itensDeLista(itens).filter((_, posicao) => posicao !== indice);
}

/** Reordena: o item sobe ou desce, e a numeração acompanha a nova ordem. */
export function moverItem(itens = [], indice, direcao) {
  const lista = itensDeLista(itens);
  const destino = indice + (direcao === "cima" ? -1 : 1);
  if (indice < 0 || indice >= lista.length) return lista;
  if (destino < 0 || destino >= lista.length) return lista;
  const copia = [...lista];
  [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
  return copia;
}

/** Altera um campo de um item, sem tocar nos demais. */
export function alterarItem(itens = [], indice, campo, valor) {
  return itensDeLista(itens).map((item, posicao) =>
    (posicao === indice ? { ...item, [campo]: valor } : item));
}

function itensDeLista(itens) {
  return Array.isArray(itens) ? itens.map((item) => ({ ...itemVazio(), ...(item ?? {}) })) : [];
}

/** Quantos itens o documento vai imprimir (os preenchidos). */
export function totalDeItens(processo) {
  return itensParaDocumento(processo).length;
}

/**
 * O OBJETO do processo para a lista e para a busca.
 *
 * O campo próprio manda; sem ele, a primeira discriminação -- que é o que
 * alguém reconhece ao procurar "as resmas de papel" na lista.
 */
export function objetoDoProcesso(processo) {
  const proprio = texto(processo?.objeto);
  if (proprio !== "") return proprio;
  const itens = itensParaDocumento(processo);
  if (itens.length === 0) return "";
  const primeiro = texto(itens[0].discriminacao);
  return itens.length > 1 ? `${primeiro} (+${itens.length - 1})` : primeiro;
}

/* -------------------------------------------------------------------------
 * Campos
 * ---------------------------------------------------------------------- */

/** O signatário da página 1: quem requisita e assina a requisição. */
export const SIGNATARIO_REQUISITANTE = "requisitante";
/** O signatário da página 2: quem assina a liquidação/solicitação. */
export const SIGNATARIO_LIQUIDACAO = "liquidacao_assinante";

export const CAMPOS_REQUISITANTE = Object.values(camposDoSignatario(SIGNATARIO_REQUISITANTE));
export const CAMPOS_ASSINANTE_LIQUIDACAO = Object.values(camposDoSignatario(SIGNATARIO_LIQUIDACAO));

/**
 * DADOS GERAIS: digitados UMA VEZ e reutilizados nas duas páginas.
 *
 * Eles são compartilhados por CONSTRUÇÃO -- não há cópia a manter em dia, nem
 * linhas a sincronizar: as duas páginas leem as mesmas colunas do mesmo
 * registro. O REQUISITANTE da página 2 é o mesmo da página 1 porque é o mesmo
 * dado, e não porque alguém o copia.
 */
export const CAMPOS_COMPARTILHADOS = [
  // ⚠️ `data_processo` É A DATA DE ABERTURA do processo, e só isso: ela serve à
  // listagem e à ordenação. ELA NÃO MANDA NA DATA DOS DOCUMENTOS -- cada
  // documento tem a data DELE (`requisicao_data` na página 1,
  // `liquidacao_data` na página 2), porque a requisição é feita num dia e a
  // liquidação, dias ou semanas depois.
  "data_processo",
  // A SECRETARIA SOLICITANTE vem do cadastro PRÓPRIO do módulo Processos, e não
  // do cadastro de secretarias do módulo financeiro: quem REQUISITA quase nunca
  // é quem paga. Ela é o REQUISITANTE da página 1 e o ÓRGÃO REQUISITANTE da 2.
  "solicitante_id",
  "objeto",
  "observacoes",
];

/** Campos PRÓPRIOS da página 1 (a Requisição de Material/Serviço). */
export const CAMPOS_REQUISICAO = [
  // A DATA DESTA PÁGINA: a data da Requisição de Material/Serviço. É ela que
  // sai no "São José da Laje/AL, ___ de ___ de ___" e no "Em, __/__/__" da
  // autorização da prefeita desta folha -- e não a data da liquidação.
  "requisicao_data",
  // Um dos quatro tipos, marcado com "X"; os outros três saem em branco.
  "tipo",
  // "À SECRETARIA DE ____", no despacho da prefeita DESTA folha. ⚠️ CAMPO DESTA
  // PÁGINA, e não compartilhado: a requisição volta para a casa que pediu e a
  // liquidação segue para quem paga, então cada folha guarda o destino dela
  // (a página 2 usa `encaminhar_secretaria_id`/`_nome`). Trocar aqui não mexe
  // na outra folha. A lista de opções vem do cadastro de secretarias do MÓDULO
  // FINANCEIRO, que este módulo só LÊ.
  "despacho_secretaria",
  // Quem assina como requisitante. É conteúdo do DOCUMENTO: nome, CPF e cargo
  // ficam gravados no processo e não são lidos do cadastro na hora de imprimir
  // -- é assim que documento antigo continua mostrando quem assinou.
  ...CAMPOS_REQUISITANTE,
];

/** Campos PRÓPRIOS da página 2 (a Liquidação/Solicitação de Pagamento). */
export const CAMPOS_LIQUIDACAO = [
  // A SECRETARIA DO ENCAMINHAMENTO DA PREFEITA NESTA FOLHA -- a que recebe o
  // processo para as providências de pagamento, e por isso sugerida como
  // FINANÇAS. ⚠️ É o destino DESTA página; o da requisição é
  // `despacho_secretaria`, ali em cima. A lista vem do cadastro de secretarias
  // do MÓDULO FINANCEIRO, que este módulo só LÊ.
  ...CAMPOS_ENCAMINHAMENTO,
  "atestado",
  "referencia",
  "fundamentacao",
  "favorecido_nome",
  "favorecido_cpf_cnpj",
  "favorecido_endereco",
  "banco_codigo",
  "banco",
  "agencia",
  "conta",
  "pix",
  "titular",
  "valor_total",
  "valor_extenso",
  // A DATA DESTA PÁGINA: a data da Liquidação/Solicitação de Pagamento.
  "liquidacao_data",
  "liquidacao_observacoes",
  // ⚠️ A NF é CONSULTA: estes campos são a CÓPIA do que a nota diz, guardada no
  // processo. Selecionar a nota não a altera, não dá baixa e não muda o valor
  // em aberto dela.
  "nota_numero",
  "nota_emissao",
  "nota_valor_bruto",
  "nota_retencoes",
  "nota_valor_liquido",
  ...CAMPOS_ASSINANTE_LIQUIDACAO,
];

/* -------------------------------------------------------------------------
 * Valor por extenso
 * ---------------------------------------------------------------------- */

/**
 * O extenso que o automático escreve para um valor.
 *
 * Processo em branco não recebe "zero real": enquanto não há valor, a coluna
 * fica vazia e o documento imprime o traço de campo não preenchido.
 */
function extensoAutomatico(valor) {
  const total = paraNumeroMoeda(valor);
  return total > 0 ? valorPorExtenso(total) : "";
}

/**
 * Aplica o automático ao formulário: o valor por extenso.
 *
 * É a MESMA função de extenso das diárias (lib/valorPorExtenso.js), e por isso
 * a redação é idêntica nos dois documentos. Quem quiser outra redação assume o
 * campo (`valor_extenso_manual`) e o automático para de sobrescrever.
 *
 * ⚠️ Aqui não há cálculo de valor: a requisição não tem valores e a liquidação
 * tem UM valor, o do pagamento solicitado, digitado ou trazido da NF.
 */
export function aplicarCalculo(formulario) {
  const base = { ...(formulario ?? {}) };
  if (base.valor_extenso_manual !== true) {
    base.valor_extenso = extensoAutomatico(base.valor_total);
  }
  return base;
}

/**
 * O valor por extenso que o documento IMPRIME: o texto do processo, quando
 * existe; o gerado a partir do valor, quando não.
 */
export function valorExtensoDoProcesso(processo) {
  const proprio = texto(processo?.valor_extenso);
  return proprio !== "" ? proprio : extensoAutomatico(processo?.valor_total);
}

/** O valor do processo no padrão brasileiro, pelo utilitário compartilhado. */
export function valorDoProcesso(processo) {
  return formatBRL(paraNumeroMoeda(processo?.valor_total));
}

/* -------------------------------------------------------------------------
 * Sugestões da página 2 a partir da página 1
 * ---------------------------------------------------------------------- */

/**
 * Propaga para a página 2 o que a página 1 SUGERE.
 *
 * Os dados gerais não precisam de propagação nenhuma: são as mesmas colunas nas
 * duas páginas. O que precisa é a atestação e a referência, que nascem do tipo
 * escolhido na requisição. Regra, campo por campo:
 *
 *   * estava vazio, ou estava exatamente igual à sugestão do tipo ANTIGO -- ou
 *     seja, estava ACOMPANHANDO a página 1 -- então acompanha a mudança;
 *   * já tinha um valor PRÓPRIO, diferente da sugestão, então FICA COMO ESTÁ.
 *     A sugestão nunca apaga escolha que alguém fez de propósito.
 */
export function sincronizarLiquidacao(anterior, novo) {
  const antes = anterior ?? {};
  const depois = { ...(novo ?? {}) };
  if (texto(antes.tipo) === texto(depois.tipo)) return depois;

  const atestadoAntigo = atestadoSugerido(antes.tipo);
  if (vazio(depois.atestado) || texto(depois.atestado) === atestadoAntigo) {
    depois.atestado = atestadoSugerido(depois.tipo);
  }

  const referenciaAntiga = referenciaSugerida(antes.tipo);
  if (vazio(depois.referencia) || texto(depois.referencia) === referenciaAntiga) {
    depois.referencia = referenciaSugerida(depois.tipo);
  }

  return depois;
}

/* -------------------------------------------------------------------------
 * Formulário
 * ---------------------------------------------------------------------- */

/** Processo em branco, pronto para "+ Nova Solicitação". */
export function processoVazio({ ano = new Date().getFullYear(), hoje = dataDeHoje() } = {}) {
  const branco = {
    ano,
    numero: null,
    // ⚠️ A data de hoje é SUGESTÃO INICIAL, não é trava. Os campos são
    // editáveis, inclusive para trás, e cada documento imprime a data
    // escolhida NELE.
    data_processo: hoje,
    // A data da página 1 nasce sugerida porque a requisição é o documento que
    // se faz no ato. A da página 2 nasce em branco: a liquidação é preenchida
    // quando a nota chega, e até lá a folha sai com a data de abertura.
    requisicao_data: hoje,
    solicitante_id: "",
    fornecedor_id: null,
    nota_id: null,
    tipo: "",
    atestado: "",
    // Um item em branco: o quadro descritivo do modelo oficial já vem com a
    // linha "01" desenhada, e é ela que aparece para ser preenchida.
    itens: [itemVazio()],
    valor_total: 0,
    valor_extenso: "",
    valor_extenso_manual: false,
    situacao: "rascunho",
  };
  [
    ...CAMPOS_COMPARTILHADOS, ...CAMPOS_REQUISICAO, ...CAMPOS_LIQUIDACAO,
    // Os dados CONGELADOS da secretaria solicitante entram no formulário para
    // que reabrir e salvar de novo um processo não apague o que ele gravou.
    ...CAMPOS_SOLICITANTE_NO_PROCESSO,
  ].forEach((campo) => {
    if (!(campo in branco)) branco[campo] = "";
  });
  return branco;
}

function dataDeHoje() {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** Registro do banco -> formulário da tela (nunca com null em campo de texto). */
export function processoParaFormulario(processo) {
  const base = processoVazio({ ano: processo?.ano ?? new Date().getFullYear() });
  const formulario = { ...base };

  Object.keys(base).forEach((campo) => {
    const valor = processo?.[campo];
    if (valor === null || valor === undefined) return;
    formulario[campo] = valor;
  });

  // ⚠️ A DATA DA REQUISIÇÃO DO PROCESSO JÁ GRAVADO É A DELE, ou nenhuma.
  // `processoVazio` sugere a data de hoje, e essa sugestão é só do processo
  // NOVO: processo antigo, gravado antes desta coluna existir, tem a coluna
  // vazia e precisa continuar imprimindo pela data de abertura -- e não ganhar
  // a data de hoje só por ter sido reaberto e salvo.
  if (processo?.id !== null && processo?.id !== undefined) {
    formulario.requisicao_data = processo?.requisicao_data ?? "";
  }

  formulario.id = processo?.id ?? null;
  formulario.numero = processo?.numero ?? null;
  formulario.ano = processo?.ano ?? base.ano;
  formulario.situacao = processo?.situacao ?? "rascunho";
  formulario.valor_extenso_manual = processo?.valor_extenso_manual === true;
  formulario.fornecedor_id = processo?.fornecedor_id ?? null;
  formulario.nota_id = processo?.nota_id ?? null;
  formulario.solicitante_id = processo?.solicitante_id ?? "";
  // A lista de itens vem normalizada, e nunca vazia na tela: uma linha em
  // branco é o quadro descritivo à espera do primeiro item.
  const itens = itensDoProcesso(processo);
  formulario.itens = itens.length > 0 ? itens : [itemVazio()];
  return formulario;
}

const CAMPOS_DATA = new Set(["data_processo", "requisicao_data", "liquidacao_data", "nota_emissao"]);
const CAMPOS_MOEDA = new Set(["valor_total", "nota_valor_bruto", "nota_retencoes", "nota_valor_liquido"]);

/**
 * Formulário -> linha do banco.
 *
 * Texto em branco vai como null (para o papel mostrar "--" e não uma string
 * vazia), data em branco vai como null (coluna date não aceita "") e dinheiro
 * vai como número decimal pelo mesmo utilitário de moeda das outras telas.
 *
 * `numero` e `ano` NÃO saem daqui: quem emite o número é o banco, e ele não
 * muda depois -- nem em edição, nem em finalização, nem em cancelamento.
 */
export function formularioParaBanco(formulario) {
  const base = aplicarCalculo(formulario ?? {});
  const linha = {
    solicitante_id: vazio(base.solicitante_id) ? null : base.solicitante_id,
    fornecedor_id: base.fornecedor_id ?? null,
    nota_id: vazio(base.nota_id) ? null : base.nota_id,
    valor_extenso_manual: base.valor_extenso_manual === true,
    // Só os itens com discriminação são gravados: linha em branco do formulário
    // não é item do documento. A ordem é a da lista, e é dela que sai a
    // numeração 01, 02, 03 na impressão.
    itens: itensDoProcesso(base).filter(itemPreenchido).map((item) => ({
      quantidade: texto(item.quantidade),
      discriminacao: texto(item.discriminacao),
    })),
  };

  ["data_processo", "objeto", "observacoes"]
    .concat(
      // O encaminhamento da prefeita: o id só para a tela remarcar a opção, e o
      // NOME congelado, que é o que o documento imprime.
      CAMPOS_ENCAMINHAMENTO,
      CAMPOS_REQUISICAO, CAMPOS_LIQUIDACAO, ["valor_extenso"],
      // Os dados da secretaria solicitante vão GRAVADOS no processo. É o
      // congelamento: trocar o secretário no cadastro amanhã não reescreve o
      // documento emitido hoje.
      CAMPOS_SOLICITANTE_NO_PROCESSO,
    )
    .forEach((campo) => {
      if (campo.endsWith("_servidor_id")) {
        linha[campo] = vazio(base[campo]) ? null : base[campo];
        return;
      }
      const valor = base[campo];
      if (CAMPOS_MOEDA.has(campo)) {
        linha[campo] = vazio(valor) ? (campo === "valor_total" ? 0 : null) : paraNumeroMoeda(valor);
        return;
      }
      if (CAMPOS_DATA.has(campo)) {
        linha[campo] = vazio(valor) ? null : String(valor);
        return;
      }
      linha[campo] = texto(valor) === "" ? null : texto(valor);
    });

  return linha;
}

/* -------------------------------------------------------------------------
 * Favorecido: do cadastro de fornecedores ou à mão
 * ---------------------------------------------------------------------- */

/**
 * Os dados que um FORNECEDOR JÁ CADASTRADO leva para o documento.
 *
 * Isto copia informação PARA O DOCUMENTO, num só sentido. Nada aqui escreve no
 * cadastro: o fornecedor não é criado, não é alterado e não é marcado como
 * nada. O que fica guardado é o id dele (`fornecedor_id`), o vínculo interno,
 * mais o texto que o documento passa a ter por conta própria -- e que pode ser
 * ajustado ali sem mexer em razão social, CPF/CNPJ, dados bancários ou PIX de
 * ninguém.
 *
 * O ENDEREÇO vem quando o cadastro tem o campo; quando não tem, ele é digitado
 * no documento, como todo o resto do preenchimento manual. O cadastro de
 * fornecedores NÃO é alterado para ganhar o campo: não foi pedido.
 */
export function dadosDoFornecedorParaDocumento(fornecedor) {
  if (!fornecedor) return { fornecedor_id: null };
  return {
    fornecedor_id: fornecedor.id ?? null,
    favorecido_nome:
      texto(fornecedor.razao_social) || texto(fornecedor.nome_fantasia) || texto(fornecedor.apelido),
    favorecido_cpf_cnpj: texto(fornecedor.cpf_cnpj),
    favorecido_endereco: texto(fornecedor.endereco) || texto(fornecedor.logradouro),
    banco_codigo: texto(fornecedor.banco_codigo),
    banco: texto(fornecedor.banco),
    agencia: texto(fornecedor.agencia),
    conta: texto(fornecedor.conta),
    pix: texto(fornecedor.pix_chave) || texto(fornecedor.pix),
    titular: texto(fornecedor.pix_titular) || texto(fornecedor.razao_social),
  };
}

/**
 * Busca do fornecedor por razão social, nome fantasia, APELIDO e CPF/CNPJ --
 * as quatro entradas que o comando pede, na mesma caixa.
 */
export function fornecedorAtendeBusca(fornecedor, termo) {
  const procurado = semAcento(termo);
  if (procurado === "") return true;

  const numeros = digitos(termo);
  if (numeros !== "" && digitos(fornecedor?.cpf_cnpj).includes(numeros)) return true;

  return [fornecedor?.razao_social, fornecedor?.nome_fantasia, fornecedor?.apelido, fornecedor?.cpf_cnpj]
    .some((campo) => semAcento(campo).includes(procurado));
}

/**
 * As FORMAS DE PAGAMENTO do fornecedor como opções para o documento.
 *
 * Quando o fornecedor tem mais de uma conta ou mais de uma chave PIX, é a
 * pessoa que escolhe qual vai no papel -- e é esta lista que a tela oferece. A
 * principal vem primeiro, porque é a escolha mais provável.
 *
 * Somente leitura: nada aqui cria, altera ou apaga forma de pagamento de
 * fornecedor nenhum.
 */
export function opcoesDePagamentoDoFornecedor(formas = []) {
  return (formas ?? [])
    .filter(Boolean)
    .map((forma) => {
      const conta = [texto(forma.account), texto(forma.accountDigit)].filter((p) => p !== "").join("-");
      const banco = texto(forma.bankName);
      const pix = texto(forma.pixKey);
      const principal = forma.isPrimary === true;
      const rotulo = forma.kind === "pix"
        ? `PIX${texto(forma.pixKeyType) === "" ? "" : ` (${forma.pixKeyType})`} — ${pix}`
        : `${banco === "" ? "Conta" : banco}${texto(forma.agency) === "" ? "" : ` — Ag. ${forma.agency}`}`
          + `${conta === "" ? "" : ` — C/C ${conta}`}`;
      return {
        id: texto(forma.id) || `${forma.kind}-${pix}${conta}`,
        tipo: forma.kind === "pix" ? "pix" : "bancaria",
        principal,
        rotulo: principal ? `${rotulo} — Principal` : rotulo,
        // O que a escolha leva para o documento. PIX e conta não se excluem: o
        // papel tem linha para os dois, e escolher um não apaga o outro.
        dados: forma.kind === "pix"
          ? { pix, titular: texto(forma.holderName) }
          : {
            banco_codigo: texto(forma.bankCode),
            banco,
            agencia: texto(forma.agency),
            conta,
            titular: texto(forma.holderName),
          },
      };
    })
    .sort((a, b) => (a.principal === b.principal ? 0 : a.principal ? -1 : 1));
}

/**
 * Preenchimento MANUAL: o favorecido não está cadastrado e NÃO passa a estar.
 *
 * Soltar o vínculo é só apagar `fornecedor_id`. O texto já digitado continua no
 * documento -- quem preencheu à mão não perde o que escreveu ao desfazer a
 * busca -- e NENHUM fornecedor é criado no cadastro por causa disto.
 */
export function soltarVinculoDeCadastro(formulario) {
  return { ...(formulario ?? {}), fornecedor_id: null };
}

/* -------------------------------------------------------------------------
 * NF vinculada — ⚠️ CONSULTA
 * ---------------------------------------------------------------------- */

/** Retenções da nota como ela as gravou (ISS e IR). Leitura, nada mais. */
export function retencoesDaNota(nota) {
  const iss = paraNumeroMoeda(nota?.desconto_iss);
  const ir = paraNumeroMoeda(nota?.desconto_ir);
  return Math.round((iss + ir) * 100) / 100;
}

/** Valor bruto da nota como ela o gravou. */
export function valorBrutoDaNota(nota) {
  const bruto = paraNumeroMoeda(nota?.valor_bruto);
  return bruto > 0 ? bruto : paraNumeroMoeda(nota?.valor);
}

/** Valor líquido: o bruto menos as retenções que a própria nota registra. */
export function valorLiquidoDaNota(nota) {
  const liquido = valorBrutoDaNota(nota) - retencoesDaNota(nota);
  return Math.round(liquido * 100) / 100;
}

/** "NF 1234 — 10/03/2026 — R$ 1.000,00" (o rótulo da lista de notas). */
export function rotuloDaNota(nota) {
  const partes = [];
  const numeroNota = texto(nota?.numero_nota_fiscal);
  partes.push(numeroNota === "" ? "Nota fiscal sem número" : `NF ${numeroNota}`);
  const emissao = dataBR(nota?.data_nota_fiscal);
  if (emissao !== "") partes.push(emissao);
  partes.push(formatBRL(valorBrutoDaNota(nota)));
  return partes.join(" — ");
}

/**
 * Os dados que uma NF JÁ REGISTRADA leva para o documento.
 *
 * ⚠️ SELECIONAR A NF É APENAS CONSULTA. Esta função só COPIA número, emissão,
 * bruto, retenções e líquido para dentro do processo. Ela NÃO altera a nota
 * original, NÃO dá baixa nela, NÃO muda o valor em aberto dela e NÃO cria
 * pagamento -- nem aqui, nem na camada de dados, que jamais escreve em
 * `valores_em_aberto`.
 *
 * O valor do pagamento solicitado passa a ser o LÍQUIDO da nota, que é o que se
 * paga; e a FUNDAMENTAÇÃO do quadro resumo ganha a identificação da nota, que é
 * o que o modelo oficial escreve ali ("NOTA FISCAL ...").
 */
export function dadosDaNotaParaDocumento(nota) {
  if (!nota) return soltarVinculoDaNota({});
  const numeroNota = texto(nota.numero_nota_fiscal);
  const bruto = valorBrutoDaNota(nota);
  const retencoes = retencoesDaNota(nota);
  const liquido = valorLiquidoDaNota(nota);
  return {
    nota_id: nota.id ?? null,
    nota_numero: numeroNota,
    nota_emissao: texto(nota.data_nota_fiscal).slice(0, 10),
    nota_valor_bruto: bruto,
    nota_retencoes: retencoes,
    nota_valor_liquido: liquido,
    valor_total: liquido > 0 ? liquido : bruto,
    fundamentacao: numeroNota === "" ? "Nota fiscal" : `Nota fiscal nº ${numeroNota}`,
  };
}

/**
 * Solta o vínculo com a NF, PRESERVANDO o valor que o documento já diz.
 *
 * Desfazer a consulta não pode reescrever o documento: o valor do pagamento e a
 * fundamentação ficam como estão, e só a cópia dos dados da nota sai.
 */
export function soltarVinculoDaNota(formulario) {
  return {
    ...(formulario ?? {}),
    nota_id: null,
    nota_numero: "",
    nota_emissao: "",
    nota_valor_bruto: "",
    nota_retencoes: "",
    nota_valor_liquido: "",
  };
}

/** true quando o processo guarda a cópia de uma NF consultada. */
export function temNotaVinculada(processo) {
  return !vazio(processo?.nota_id) || texto(processo?.nota_numero) !== "";
}

/* -------------------------------------------------------------------------
 * Preenchimento das duas páginas
 * ---------------------------------------------------------------------- */

/**
 * Se cada página já tem o essencial. É o que a lista mostra como
 * "Requisição ✓ | Liquidação ✓" ou "Liquidação pendente".
 *
 * O essencial é curto de propósito: rascunho existe justamente para o processo
 * ser salvo incompleto, e o indicador é INFORMATIVO, não é trava. A liquidação
 * pendente é o normal -- ela é preenchida quando a nota fiscal chega.
 */
export function preenchimentoDoProcesso(processo) {
  const p = processo ?? {};
  const requisicao = !vazio(p.tipo) && totalDeItens(p) > 0;
  const liquidacao =
    !vazio(p.favorecido_nome) && paraNumeroMoeda(p.valor_total) > 0 && !vazio(p.atestado);

  return {
    requisicao,
    liquidacao,
    texto: liquidacao
      ? `Requisição ${requisicao ? "✓" : "pendente"} | Liquidação ✓`
      : `Requisição ${requisicao ? "✓" : "pendente"} | Liquidação pendente`,
  };
}

/* -------------------------------------------------------------------------
 * Leitura para a lista
 * ---------------------------------------------------------------------- */

/** "10/03/2026" a partir de "2026-03-10"; texto vazio quando não há data. */
export function dataBR(valor) {
  const bruto = texto(valor);
  if (bruto === "") return "";
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
  if (partes) return `${partes[3]}/${partes[2]}/${partes[1]}`;
  return bruto;
}

/* -------------------------------------------------------------------------
 * A data de cada documento
 * ---------------------------------------------------------------------- */

/**
 * A DATA DA REQUISIÇÃO -- a data da página 1.
 *
 * Cada documento do processo tem a data DELE: a requisição é feita num dia e a
 * liquidação, dias ou semanas depois. Sem data própria gravada -- o caso do
 * processo criado antes de o campo existir -- vale a data de abertura, que é
 * exatamente o que essas folhas já imprimiam.
 */
export function dataDaRequisicao(processo) {
  return texto(processo?.requisicao_data) || texto(processo?.data_processo);
}

/**
 * A DATA DA LIQUIDAÇÃO -- a data da página 2.
 *
 * Mesma regra: a data própria da liquidação quando existe, a de abertura
 * quando ainda não foi preenchida.
 */
export function dataDaLiquidacao(processo) {
  return texto(processo?.liquidacao_data) || texto(processo?.data_processo);
}

/**
 * O nome da secretaria SOLICITANTE do processo.
 *
 * A ordem é a do congelamento: primeiro o nome GRAVADO no processo, que é o que
 * garante que o documento antigo continue igual mesmo depois de o cadastro
 * mudar; depois o join da solicitante; depois a busca por id na lista da tela.
 */
export function nomeDaSecretaria(processo, secretarias = []) {
  const congelado = texto(processo?.solicitante_nome);
  if (congelado !== "") return congelado;

  const doSolicitante = texto(processo?.solicitante?.nome);
  if (doSolicitante !== "") return doSolicitante;

  const id = processo?.solicitante_id;
  if (vazio(id)) return "";
  return texto((secretarias ?? []).find((s) => String(s.id) === String(id))?.nome);
}

/** O favorecido que a lista mostra na coluna Fornecedor. */
export function nomeDoFavorecido(processo) {
  return texto(processo?.favorecido_nome);
}

/* -------------------------------------------------------------------------
 * Busca e filtros
 * ---------------------------------------------------------------------- */

/**
 * Busca rápida: número, fornecedor, CPF/CNPJ, secretaria, objeto e situação.
 *
 * Filtra enquanto se digita, sem ida ao banco: a lista da tela já está em
 * memória. O documento é comparado por dígitos, então "12345678900" acha
 * "123.456.789-00" e vice-versa. As DISCRIMINAÇÕES dos itens também entram: é
 * comum procurar o processo pelo material que ele pediu.
 */
export function processoAtendeBusca(processo, termo, secretarias = []) {
  const procurado = semAcento(termo);
  if (procurado === "") return true;

  const numeros = digitos(termo);
  if (numeros !== "" && digitos(processo?.favorecido_cpf_cnpj).includes(numeros)) return true;

  const campos = [
    numeroDoProcesso(processo),
    String(processo?.numero ?? ""),
    processo?.favorecido_nome,
    processo?.favorecido_cpf_cnpj,
    nomeDaSecretaria(processo, secretarias),
    objetoDoProcesso(processo),
    processo?.objeto,
    processo?.referencia,
    processo?.nota_numero,
    rotuloDoTipo(processo),
    situacaoServicoInfo(processo?.situacao).rotulo,
    ...itensDoProcesso(processo).map((item) => item.discriminacao),
  ];

  return campos.some((campo) => semAcento(campo).includes(procurado));
}

export function filtrosVazios() {
  return {
    ano: "",
    periodoInicio: "",
    periodoFim: "",
    secretaria: "",
    tipo: "",
    fornecedor: "",
    situacao: "",
  };
}

export function totalFiltrosAtivos(filtros = {}) {
  return Object.entries(filtrosVazios()).filter(([chave]) => texto(filtros?.[chave]) !== "").length;
}

/** Filtros recolhíveis: ano, período, secretaria, tipo, fornecedor e situação. */
export function processoAtendeFiltros(processo, filtros = {}) {
  const f = filtros ?? {};

  if (texto(f.ano) !== "" && String(processo?.ano ?? "") !== texto(f.ano)) return false;
  if (texto(f.situacao) !== "" && texto(processo?.situacao) !== texto(f.situacao)) return false;
  if (texto(f.tipo) !== "" && texto(processo?.tipo) !== texto(f.tipo)) return false;
  if (texto(f.secretaria) !== "" && String(processo?.solicitante_id ?? "") !== texto(f.secretaria)) {
    return false;
  }

  if (texto(f.fornecedor) !== "") {
    const procurado = semAcento(f.fornecedor);
    const numeros = digitos(f.fornecedor);
    const porNome = semAcento(processo?.favorecido_nome).includes(procurado);
    const porDocumento = numeros !== "" && digitos(processo?.favorecido_cpf_cnpj).includes(numeros);
    const porVinculo = String(processo?.fornecedor_id ?? "") === texto(f.fornecedor);
    if (!porNome && !porDocumento && !porVinculo) return false;
  }

  const data = texto(processo?.data_processo);
  if (texto(f.periodoInicio) !== "" && (data === "" || data < texto(f.periodoInicio))) return false;
  if (texto(f.periodoFim) !== "" && (data === "" || data > texto(f.periodoFim))) return false;

  return true;
}

/** Busca + filtros, na ordem em que a tela os aplica. */
export function filtrarProcessos(processos = [], { busca = "", filtros = {}, secretarias = [] } = {}) {
  return (processos ?? [])
    .filter((processo) => processoAtendeBusca(processo, busca, secretarias))
    .filter((processo) => processoAtendeFiltros(processo, filtros));
}

/** Mais recente primeiro: ano e depois número, que é a ordem do protocolo. */
export function ordenarProcessos(processos = []) {
  return [...(processos ?? [])].sort((a, b) => {
    const anos = numero(b?.ano) - numero(a?.ano);
    if (anos !== 0) return anos;
    return numero(b?.numero) - numero(a?.numero);
  });
}

/** Os anos presentes na lista, para o filtro de ano (sem lista fixa de anos). */
export function anosDosProcessos(processos = []) {
  const anos = new Set((processos ?? []).map((p) => numero(p?.ano)).filter((a) => a > 0));
  return [...anos].sort((a, b) => b - a);
}

/* -------------------------------------------------------------------------
 * Duplicar
 * ---------------------------------------------------------------------- */

/**
 * DUPLICAR: os dados de um processo em um processo NOVO.
 *
 * O novo nasce sem id, sem número e como rascunho -- o número dele é emitido na
 * gravação, pelo banco. O ORIGINAL NÃO É TOCADO por esta função: ela só devolve
 * um formulário. E, como toda a área, duplicar não gera pagamento nenhum.
 *
 * É o caminho do serviço e do material que se repetem todo mês: os itens, o
 * favorecido e os dados bancários vêm na cópia. O VÍNCULO COM A NF não vem: a
 * nota do mês passado não é a deste mês, e levá-la adiante seria copiar a
 * fundamentação errada. O valor vem, porque costuma ser o mesmo, e é editável.
 */
export function duplicarProcesso(processo, { ano = new Date().getFullYear(), hoje = dataDeHoje() } = {}) {
  const copia = processoParaFormulario(processo);
  const semNota = soltarVinculoDaNota(copia);

  return {
    ...semNota,
    id: null,
    numero: null,
    ano,
    situacao: "rascunho",
    data_processo: hoje,
    // As datas dos documentos voltam ao ponto de partida: a cópia é um processo
    // NOVO, e as datas do mês passado não são as dele.
    requisicao_data: hoje,
    liquidacao_data: "",
    duplicado_de: processo?.id ?? null,
    duplicado_de_numero: numeroDoProcesso(processo),
  };
}

/* -------------------------------------------------------------------------
 * Validação
 * ---------------------------------------------------------------------- */

/**
 * O que o RASCUNHO exige: praticamente nada.
 *
 * Rascunho pode ser salvo a qualquer momento, sem as duas páginas completas --
 * é para isso que ele existe, e é o que o salvamento automático grava. A única
 * exigência é a secretaria solicitante, porque é ela que diz de quem é o
 * processo.
 */
export function validarRascunho(formulario) {
  const erros = {};
  if (vazio(formulario?.solicitante_id)) {
    erros.solicitante_id = "Escolha a secretaria solicitante do processo.";
  }
  return erros;
}

/**
 * O que FINALIZAR exige: a página 1 completa.
 *
 * Finalizar fecha o documento para alteração, então o mínimo do papel precisa
 * estar lá: o tipo marcado e ao menos um item discriminado. A PÁGINA 2 NÃO É
 * EXIGIDA -- o normal é a liquidação ser preenchida quando a nota fiscal
 * chega, e o processo finalizado com ela pendente é situação legítima.
 *
 * E vale de novo: finalizar não é pagar.
 */
export function validarFinalizacao(formulario) {
  const erros = validarRascunho(formulario);
  if (vazio(formulario?.data_processo)) erros.data_processo = "Informe a data do processo.";
  if (vazio(formulario?.tipo)) erros.tipo = "Marque uma das quatro opções da requisição.";
  if (totalDeItens(formulario) === 0) {
    erros.itens = "Descreva ao menos um item no quadro descritivo.";
  }
  return erros;
}

export function primeiroErro(erros) {
  const valores = Object.values(erros ?? {});
  return valores.length > 0 ? valores[0] : null;
}

/* -------------------------------------------------------------------------
 * Auditoria
 * ---------------------------------------------------------------------- */

/** "Processo de serviços/materiais nº 0001/2026 — Papelaria Laje" */
export function identificacaoDoProcesso(processo) {
  const partes = [
    `Processo de serviços/materiais nº ${numeroDoProcesso(processo) || "(sem número)"}`,
  ];
  const nome = texto(processo?.favorecido_nome) || objetoDoProcesso(processo);
  if (nome !== "") partes.push(nome);
  return partes.join(" — ");
}

const CAMPOS_AUDITADOS = [
  "data_processo", "solicitante_id", "objeto", "observacoes", "itens",
  "fornecedor_id", "nota_id", "valor_extenso_manual", ...CAMPOS_ENCAMINHAMENTO,
  ...CAMPOS_REQUISICAO, ...CAMPOS_LIQUIDACAO, ...CAMPOS_SOLICITANTE_NO_PROCESSO,
];

function mesmoValor(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  if (vazio(a) && vazio(b)) return true;
  if (typeof a === "number" || typeof b === "number") return numero(a) === numero(b);
  return String(a ?? "") === String(b ?? "");
}

/**
 * O que mudou, campo por campo, para a auditoria gravar o ANTES e o DEPOIS.
 *
 * Devolve `{ anterior, novo }` apenas com os campos diferentes -- é o formato
 * que a comparação Antes/Depois da tela de Auditoria já sabe ler. A lista de
 * itens entra inteira quando muda: é ela o conteúdo da requisição.
 */
export function diferencaParaAuditoria(anterior = {}, novo = {}) {
  const antes = {};
  const depois = {};

  CAMPOS_AUDITADOS.forEach((campo) => {
    const de = campo === "itens" ? itensDoProcesso(anterior) : anterior?.[campo] ?? null;
    const para = campo === "itens" ? itensDoProcesso(novo) : novo?.[campo] ?? null;
    if (mesmoValor(de, para)) return;
    antes[campo] = de;
    depois[campo] = para;
  });

  return { anterior: antes, novo: depois, houveAlteracao: Object.keys(depois).length > 0 };
}

/**
 * O vínculo de NF que acabou de ser feito, para a trilha.
 *
 * Ele ganha evento próprio porque é a informação que alguém vai querer conferir
 * depois -- de qual nota saíram aqueles valores. ⚠️ Registrar o vínculo é
 * registrar uma CONSULTA: a nota não foi alterada e não recebeu baixa.
 */
export function vinculoDeNotaRegistrado(anterior = {}, novo = {}) {
  const antes = texto(anterior?.nota_id);
  const depois = texto(novo?.nota_id);
  if (depois === "" || antes === depois) return null;
  return {
    nota_id: novo?.nota_id ?? null,
    nota_numero: texto(novo?.nota_numero) || null,
    nota_emissao: texto(novo?.nota_emissao) || null,
    nota_valor_bruto: paraNumeroMoeda(novo?.nota_valor_bruto),
    nota_retencoes: paraNumeroMoeda(novo?.nota_retencoes),
    nota_valor_liquido: paraNumeroMoeda(novo?.nota_valor_liquido),
  };
}

/* -------------------------------------------------------------------------
 * Histórico do processo
 * ---------------------------------------------------------------------- */

export const ACOES_HISTORICO_SERVICOS = {
  criou: "Processo criado",
  duplicou: "Processo criado por duplicação",
  alterou: "Dados alterados",
  salvou_rascunho: "Rascunho salvo",
  finalizou: "Processo finalizado",
  reabriu: "Processo reaberto para edição",
  cancelou: "Processo cancelado",
  excluiu: "Rascunho excluído",
  vinculou_nota: "Nota fiscal consultada e vinculada",
  imprimiu: "Processo impresso",
  gerou_pdf: "PDF gerado",
};

/** Uma linha do histórico em frase, como na linha do tempo das Tarefas. */
export function textoHistorico(registro) {
  const acao = ACOES_HISTORICO_SERVICOS[registro?.acao] ?? texto(registro?.acao) ?? "Ação";
  const detalhes = registro?.detalhes ?? {};
  const complemento = texto(detalhes.descricao) || texto(detalhes.motivo);
  return complemento === "" ? acao : `${acao} — ${complemento}`;
}

/* -------------------------------------------------------------------------
 * Permissões da subaba
 * ---------------------------------------------------------------------- */

/**
 * As sete ações da subaba, distribuídas em DOIS módulos da Matriz de
 * Permissões.
 *
 * A matriz tem cinco colunas por módulo, e este envio não cria nem altera
 * coluna de permissão. Então as cinco de `processos_servicos` levam visualizar,
 * criar, editar, finalizar e cancelar, e imprimir/duplicar ficam em
 * `processos_servicos_saida`. É o mesmo recurso já usado em Diárias, em Baixas
 * e em Backup.
 *
 * ⚠️ SÃO PERMISSÕES PRÓPRIAS: quem vê Diárias não passa a ver Serviços/
 * Materiais, e nenhuma permissão existente é alterada por elas. O mesmo mapa
 * está escrito na migration 20260911260000 e conferido no banco por
 * `public.pode_em_processos`.
 */
export const MODULO_SERVICOS = "processos_servicos";
export const MODULO_SERVICOS_SAIDA = "processos_servicos_saida";

export const MODULOS_PROCESSOS_SERVICOS = [MODULO_SERVICOS, MODULO_SERVICOS_SAIDA];

export const ACOES_SERVICOS = [
  { chave: "visualizar", modulo: MODULO_SERVICOS, coluna: "pode_visualizar", rotulo: "Visualizar" },
  { chave: "criar", modulo: MODULO_SERVICOS, coluna: "pode_cadastrar", rotulo: "Criar" },
  { chave: "editar", modulo: MODULO_SERVICOS, coluna: "pode_editar", rotulo: "Editar" },
  // Finalizar fecha o DOCUMENTO. Não é aprovação de pagamento e não paga nada.
  { chave: "finalizar", modulo: MODULO_SERVICOS, coluna: "pode_aprovar", rotulo: "Finalizar" },
  // Cancelar é a anulação do processo, preservando registro, número e histórico.
  { chave: "cancelar", modulo: MODULO_SERVICOS, coluna: "pode_excluir", rotulo: "Cancelar" },
  { chave: "imprimir", modulo: MODULO_SERVICOS_SAIDA, coluna: "pode_visualizar", rotulo: "Imprimir e gerar PDF" },
  { chave: "duplicar", modulo: MODULO_SERVICOS_SAIDA, coluna: "pode_cadastrar", rotulo: "Duplicar" },
];

export const PERMISSOES_SERVICOS_NENHUMA = Object.freeze(
  Object.fromEntries(ACOES_SERVICOS.map((acao) => [acao.chave, false])),
);

/**
 * As permissões da subaba a partir das linhas de `permissoes_efetivas`.
 *
 * Sem NENHUMA linha dos dois módulos -- banco em que a migration deste envio
 * não foi rodada -- ninguém entra: a subaba é nova, e permissão nova não se
 * herda de módulo existente. Quem administra libera na Matriz de Permissões, e
 * a migration já deixa o Administrador liberado.
 *
 * Imprimir e duplicar, quando o módulo de saída não tem linha, acompanham
 * visualizar e criar: são ações da mesma subaba, e é o padrão que a migration
 * semeia.
 */
export function resolverPermissoesServicos({ linhas = [] } = {}) {
  const porModulo = new Map((linhas ?? []).filter(Boolean).map((linha) => [String(linha.modulo), linha]));
  const principal = porModulo.get(MODULO_SERVICOS) ?? null;
  const saida = porModulo.get(MODULO_SERVICOS_SAIDA) ?? null;
  if (!principal && !saida) return { ...PERMISSOES_SERVICOS_NENHUMA };

  const resultado = {};
  ACOES_SERVICOS.forEach((acao) => {
    const linha = acao.modulo === MODULO_SERVICOS_SAIDA ? (saida ?? principal) : principal;
    resultado[acao.chave] = linha?.[acao.coluna] === true;
  });
  return resultado;
}

/** Quem não pode visualizar não vê a subaba no menu e não abre a rota. */
export function podeVerServicos(permissoes) {
  return permissoes?.visualizar === true;
}

/* -------------------------------------------------------------------------
 * O que cada ação exige, conferido antes de oferecer o botão
 * ---------------------------------------------------------------------- */

/**
 * As ações disponíveis para um processo, dada a permissão e a situação dele.
 *
 * Processo FINALIZADO não tem exclusão comum: a saída é cancelar, que preserva
 * o registro e o histórico. Processo CANCELADO não volta a ser editado.
 */
export function acoesDisponiveis(processo, permissoes = {}) {
  const situacao = texto(processo?.situacao) || "rascunho";
  const rascunho = situacao === "rascunho";
  return {
    abrir: permissoes.visualizar === true,
    editar: permissoes.editar === true && rascunho,
    finalizar: permissoes.finalizar === true && rascunho,
    reabrir: permissoes.editar === true && situacao === "finalizada",
    cancelar: permissoes.cancelar === true && situacao !== "cancelada",
    excluir: permissoes.cancelar === true && rascunho,
    duplicar: permissoes.duplicar === true,
    imprimir: permissoes.imprimir === true,
    historico: permissoes.visualizar === true,
  };
}
