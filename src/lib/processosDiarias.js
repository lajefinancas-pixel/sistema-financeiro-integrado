// Processos de Diária: as regras do documento, sem banco e sem tela.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nada neste arquivo -- e nada no
// módulo -- debita conta, dá baixa em NF, altera saldo, marca fornecedor como
// pago, cria pagamento ou toca na Programação Diária. "Solicitação de
// liquidação" é o NOME DO DOCUMENTO da página 2: é papel, não é baixa.
//
// UM PROCESSO = DOIS DOCUMENTOS. A Solicitação de Diária (página 1) e a
// Solicitação de Liquidação da Diária (página 2) são as duas páginas do MESMO
// processo, e por isso vivem no MESMO registro: mesmo número, mesmos dados
// gerais. Não existem "solicitações" e "liquidações" como registros
// independentes, e não existe subaba separada de Liquidação.
//
// Este arquivo é carregado direto pelos testes, sem o resolvedor de módulos do
// Vite: só funções puras, nada de React e nada de supabase.

import { formatBRL, paraNumeroMoeda } from "./moeda.js";

/* -------------------------------------------------------------------------
 * Identificação do módulo
 * ---------------------------------------------------------------------- */

export const TABELA_PROCESSOS = "processos_diarias";
export const TABELA_HISTORICO = "processos_diarias_historico";
export const TABELA_NUMERACAO = "processos_diarias_numeracao";

export const MIGRATION_PROCESSOS = "20260911160000_processos_modulo_diarias.sql";

export const AVISO_MIGRATION_PROCESSOS =
  `O módulo Processos ainda não tem as suas tabelas neste banco. Rode a migration ${MIGRATION_PROCESSOS} `
  + "no SQL Editor do Supabase para liberar a área de Diárias. Nenhum outro módulo é afetado por ela.";

/* -------------------------------------------------------------------------
 * Situações
 * ---------------------------------------------------------------------- */

/**
 * As três situações do ANDAMENTO DO DOCUMENTO.
 *
 * FINALIZAR NÃO É PAGAR: finalizada quer dizer que o papel está pronto e
 * fechado para alteração, não que alguém recebeu dinheiro. Não gera pagamento,
 * não debita conta e não altera saldo nenhum.
 */
export const SITUACOES = [
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

export function situacaoInfo(valor) {
  return SITUACOES.find((s) => s.id === valor) ?? SITUACOES[0];
}

/** Meio de transporte da viagem (página 1). */
export const TRANSPORTES = [
  { id: "veiculo_oficial", rotulo: "Veículo oficial" },
  { id: "veiculo_proprio", rotulo: "Veículo próprio" },
  { id: "onibus", rotulo: "Ônibus" },
  { id: "aviao", rotulo: "Avião" },
  { id: "outro", rotulo: "Outro" },
];

export function transporteRotulo(processo) {
  const id = String(processo?.transporte ?? "");
  if (id === "outro") {
    const complemento = texto(processo?.transporte_outro);
    return complemento ? `Outro — ${complemento}` : "Outro";
  }
  return TRANSPORTES.find((t) => t.id === id)?.rotulo ?? "";
}

/* -------------------------------------------------------------------------
 * Numeração
 * ---------------------------------------------------------------------- */

/**
 * "0001/2026" -- número único do processo, sequencial e separado por ano.
 *
 * As DUAS páginas exibem este mesmo número, porque são o mesmo registro. Quem
 * emite o número é o banco (public.proximo_numero_processo_diaria), que o marca
 * como consumido na mesma transação: número emitido nunca é reutilizado, nem
 * quando o processo é cancelado.
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

/** "PROCESSO DE DIÁRIA Nº 0001/2026" -- o título das duas páginas e da tela. */
export function tituloDoProcesso(processo) {
  const numero = numeroDoProcesso(processo);
  return numero ? `PROCESSO DE DIÁRIA Nº ${numero}` : "PROCESSO DE DIÁRIA (novo)";
}

export const TITULO_PAGINA_1 = "SOLICITAÇÃO DE DIÁRIA";
export const TITULO_PAGINA_2 = "SOLICITAÇÃO DE LIQUIDAÇÃO DA DIÁRIA";

/* -------------------------------------------------------------------------
 * Campos
 * ---------------------------------------------------------------------- */

/**
 * DADOS GERAIS: digitados UMA VEZ e reutilizados nas duas páginas.
 *
 * Eles são compartilhados por CONSTRUÇÃO -- não há cópia a manter em dia, nem
 * duas linhas a sincronizar: as duas páginas leem as mesmas colunas do mesmo
 * registro. Alterar um dado compartilhado na Solicitação aparece na Liquidação
 * no mesmo instante porque é o mesmo dado.
 */
export const CAMPOS_COMPARTILHADOS = [
  "data_processo",
  "secretaria_id",
  "beneficiario_nome",
  "beneficiario_cpf",
  "objeto",
  "valor_total",
  // Também vão prontos para a página 2 (item 7: sem digitação repetida).
  "destino",
  "finalidade",
  "banco",
  "agencia",
  "conta",
  "pix",
  "titular",
];

/** Campos PRÓPRIOS da página 1 (a Solicitação de Diária). */
export const CAMPOS_SOLICITACAO = [
  "beneficiario_matricula",
  "beneficiario_cargo",
  "beneficiario_lotacao",
  "data_saida",
  "hora_saida",
  "data_retorno",
  "hora_retorno",
  "quantidade_diarias",
  "valor_unitario",
  "transporte",
  "transporte_outro",
  "observacoes",
];

/** Campos PRÓPRIOS da página 2 (a Solicitação de Liquidação da Diária). */
export const CAMPOS_LIQUIDACAO = [
  "liquidacao_data",
  "liquidacao_data_saida",
  "liquidacao_data_retorno",
  "liquidacao_quantidade",
  "liquidacao_valor",
  "liquidacao_relatorio",
  "liquidacao_documentos",
  "liquidacao_responsavel",
  "liquidacao_observacoes",
];

/**
 * Os campos da Liquidação que NASCEM espelhando a Solicitação.
 *
 * A viagem realizada normalmente é a viagem solicitada, então estes quatro
 * chegam preenchidos com o que está na página 1 -- é o que dispensa a digitação
 * repetida. Mas eles existem separados de propósito: quem volta um dia antes
 * informa ali a data real e a quantidade real, e é esse número que a página 2
 * passa a mostrar.
 */
export const ESPELHOS_DA_LIQUIDACAO = [
  { liquidacao: "liquidacao_data_saida", origem: "data_saida" },
  { liquidacao: "liquidacao_data_retorno", origem: "data_retorno" },
  { liquidacao: "liquidacao_quantidade", origem: "quantidade_diarias" },
  { liquidacao: "liquidacao_valor", origem: "valor_total" },
];

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

/** Quantidade de diárias: aceita meia diária ("1,5"), como o formulário em papel. */
export function quantidadeDeDiarias(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (vazio(valor)) return 0;
  const limpo = String(valor).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const convertido = Number(limpo);
  return Number.isFinite(convertido) ? convertido : 0;
}

/**
 * Valor total = quantidade × valor unitário.
 *
 * Arredondado ao centavo: 1,5 × 333,33 é R$ 500,00 no papel, não
 * R$ 499,995. O mesmo utilitário de moeda do resto do sistema faz a leitura do
 * que foi digitado (aceita "1.234,56", "R$ 20" e o número cru do banco).
 */
export function calcularValorTotal(quantidade, valorUnitario) {
  const total = quantidadeDeDiarias(quantidade) * paraNumeroMoeda(valorUnitario);
  return Math.round(total * 100) / 100;
}

/**
 * Aplica o cálculo automático ao formulário.
 *
 * O total é recalculado sempre, EXCETO quando quem preenche assumiu o valor à
 * mão (`valor_total_manual`). A edição manual é permitida porque existe caso
 * real de valor concedido diferente do produto (diária proporcional, teto da
 * secretaria) -- e ela vai para a auditoria, com o antes e o depois.
 */
export function aplicarCalculo(formulario) {
  const base = formulario ?? {};
  if (base.valor_total_manual === true) return { ...base };
  return { ...base, valor_total: calcularValorTotal(base.quantidade_diarias, base.valor_unitario) };
}

/** O total que o cálculo automático daria para o formulário atual. */
export function valorTotalCalculado(formulario) {
  return calcularValorTotal(formulario?.quantidade_diarias, formulario?.valor_unitario);
}

/** true quando o total digitado à mão discorda do cálculo (o papel avisa). */
export function totalDivergeDoCalculo(formulario) {
  if (formulario?.valor_total_manual !== true) return false;
  return paraNumeroMoeda(formulario?.valor_total) !== valorTotalCalculado(formulario);
}

/* -------------------------------------------------------------------------
 * Sincronização: só o compartilhado, nunca o específico
 * ---------------------------------------------------------------------- */

/**
 * Propaga para a página 2 a alteração de um dado COMPARTILHADO da página 1.
 *
 * Os dados gerais não precisam de propagação nenhuma: são as mesmas colunas nas
 * duas páginas. O que precisa é o punhado de campos que a Liquidação tem em
 * separado porque ela pode divergir (datas, quantidade e valor efetivamente
 * realizados). Regra, campo por campo:
 *
 *   * estava vazio, ou estava exatamente igual ao valor antigo da Solicitação
 *     -- ou seja, estava ESPELHANDO a página 1 -- então acompanha a alteração;
 *   * já tinha um valor PRÓPRIO, diferente do da Solicitação, então FICA COMO
 *     ESTÁ. A sincronização nunca apaga informação específica já preenchida na
 *     Liquidação.
 *
 * @param anterior formulário antes da alteração
 * @param novo     formulário depois da alteração
 */
export function sincronizarLiquidacao(anterior, novo) {
  const antes = anterior ?? {};
  const depois = { ...(novo ?? {}) };

  ESPELHOS_DA_LIQUIDACAO.forEach(({ liquidacao, origem }) => {
    if (mesmoValor(antes[origem], depois[origem])) return; // o compartilhado não mudou

    const especifico = depois[liquidacao];
    const acompanhava = vazio(especifico) || mesmoValor(especifico, antes[origem]);
    if (acompanhava) depois[liquidacao] = depois[origem];
  });

  return depois;
}

function mesmoValor(a, b) {
  if (vazio(a) && vazio(b)) return true;
  if (typeof a === "number" || typeof b === "number") return numero(a) === numero(b);
  return String(a ?? "") === String(b ?? "");
}

/**
 * O valor que a página 2 EXIBE para um campo espelhado: o próprio, quando
 * existe; o da página 1, enquanto a liquidação não informou nada diferente.
 */
export function valorNaLiquidacao(processo, campoLiquidacao) {
  const espelho = ESPELHOS_DA_LIQUIDACAO.find((e) => e.liquidacao === campoLiquidacao);
  const proprio = processo?.[campoLiquidacao];
  if (!vazio(proprio)) return proprio;
  return espelho ? processo?.[espelho.origem] : proprio;
}

/* -------------------------------------------------------------------------
 * Formulário
 * ---------------------------------------------------------------------- */

/** Processo em branco, pronto para "+ Nova Diária". */
export function processoVazio({ ano = new Date().getFullYear(), hoje = dataDeHoje() } = {}) {
  const branco = {
    ano,
    numero: null,
    data_processo: hoje,
    secretaria_id: "",
    fornecedor_id: null,
    beneficiario_nome: "",
    beneficiario_cpf: "",
    objeto: "",
    valor_total: 0,
    valor_total_manual: false,
    situacao: "rascunho",
  };
  // Os compartilhados entram junto: destino, finalidade e os dados bancários
  // são das DUAS páginas, e sem eles aqui o formulário perderia esses campos ao
  // reabrir um rascunho (processoParaFormulario copia o que existe no branco).
  [...CAMPOS_COMPARTILHADOS, ...CAMPOS_SOLICITACAO, ...CAMPOS_LIQUIDACAO].forEach((campo) => {
    if (!(campo in branco)) branco[campo] = "";
  });
  branco.quantidade_diarias = "";
  branco.valor_unitario = 0;
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

  formulario.id = processo?.id ?? null;
  formulario.numero = processo?.numero ?? null;
  formulario.ano = processo?.ano ?? base.ano;
  formulario.situacao = processo?.situacao ?? "rascunho";
  formulario.valor_total_manual = processo?.valor_total_manual === true;
  formulario.fornecedor_id = processo?.fornecedor_id ?? null;
  formulario.secretaria_id = processo?.secretaria_id ?? "";
  return formulario;
}

const CAMPOS_DATA = new Set([
  "data_processo", "data_saida", "data_retorno",
  "liquidacao_data", "liquidacao_data_saida", "liquidacao_data_retorno",
]);
const CAMPOS_MOEDA = new Set(["valor_total", "valor_unitario", "liquidacao_valor"]);
const CAMPOS_QUANTIDADE = new Set(["quantidade_diarias", "liquidacao_quantidade"]);

/**
 * Formulário -> linha do banco.
 *
 * Texto em branco vai como null (para o papel mostrar "--" e não uma string
 * vazia), data em branco vai como null (coluna date não aceita ""), e dinheiro
 * vai como número decimal pelo mesmo utilitário de moeda das outras telas.
 *
 * `numero` e `ano` NÃO saem daqui: quem emite o número é o banco, e ele não
 * muda depois -- nem em edição, nem em finalização, nem em cancelamento.
 */
export function formularioParaBanco(formulario) {
  const base = aplicarCalculo(formulario ?? {});
  const linha = {
    secretaria_id: vazio(base.secretaria_id) ? null : base.secretaria_id,
    fornecedor_id: base.fornecedor_id ?? null,
    valor_total_manual: base.valor_total_manual === true,
  };

  ["data_processo", "beneficiario_nome", "beneficiario_cpf", "objeto", "valor_total"]
    .concat(CAMPOS_SOLICITACAO, CAMPOS_LIQUIDACAO, ["destino", "finalidade", "banco", "agencia", "conta", "pix", "titular"])
    .forEach((campo) => {
      const valor = base[campo];
      if (CAMPOS_MOEDA.has(campo)) {
        linha[campo] = vazio(valor) ? (campo === "valor_total" ? 0 : null) : paraNumeroMoeda(valor);
        return;
      }
      if (CAMPOS_QUANTIDADE.has(campo)) {
        linha[campo] = vazio(valor) ? (campo === "quantidade_diarias" ? 0 : null) : quantidadeDeDiarias(valor);
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
 * Beneficiário: do cadastro ou à mão
 * ---------------------------------------------------------------------- */

/**
 * Os dados que um fornecedor/servidor JÁ CADASTRADO leva para o documento.
 *
 * Isto copia informação PARA O DOCUMENTO. Nada aqui escreve no cadastro: o
 * fornecedor não é criado, não é alterado e não é marcado como nada. O que fica
 * guardado é o id dele (`fornecedor_id`), o vínculo interno, mais o texto que o
 * documento passa a ter por conta própria -- e que pode ser ajustado ali sem
 * mexer em razão social, CPF/CNPJ, dados bancários ou PIX de ninguém.
 */
export function dadosDoFornecedorParaDocumento(fornecedor) {
  if (!fornecedor) return { fornecedor_id: null };
  return {
    fornecedor_id: fornecedor.id ?? null,
    beneficiario_nome: texto(fornecedor.razao_social) || texto(fornecedor.nome_fantasia) || texto(fornecedor.apelido),
    beneficiario_cpf: texto(fornecedor.cpf_cnpj),
    banco: texto(fornecedor.banco),
    agencia: texto(fornecedor.agencia),
    conta: texto(fornecedor.conta),
    pix: texto(fornecedor.pix_chave) || texto(fornecedor.pix),
    titular: texto(fornecedor.pix_titular) || texto(fornecedor.razao_social),
  };
}

/**
 * Preenchimento MANUAL: a pessoa não está cadastrada e não passa a estar.
 *
 * Soltar o vínculo é só apagar `fornecedor_id`. O texto já digitado continua no
 * documento -- quem preencheu a mão não perde o que escreveu ao desfazer a
 * busca -- e NENHUM fornecedor é criado no cadastro principal por causa disto.
 */
export function soltarVinculoDeCadastro(formulario) {
  return { ...(formulario ?? {}), fornecedor_id: null };
}

/* -------------------------------------------------------------------------
 * Preenchimento das duas páginas
 * ---------------------------------------------------------------------- */

/**
 * Se cada página já tem o essencial. É o que a lista mostra como
 * "Solicitação ✓ | Liquidação ✓" ou "Liquidação pendente".
 *
 * O essencial é curto de propósito: rascunho existe justamente para o processo
 * ser salvo incompleto, e o indicador é informativo, não é trava.
 */
export function preenchimentoDoProcesso(processo) {
  const p = processo ?? {};
  const solicitacao = !vazio(p.beneficiario_nome) && !vazio(p.destino) && paraNumeroMoeda(p.valor_total) > 0;
  const liquidacao =
    !vazio(p.liquidacao_data)
    || !vazio(p.liquidacao_relatorio)
    || !vazio(p.liquidacao_responsavel)
    || !vazio(p.liquidacao_documentos);

  return {
    solicitacao,
    liquidacao,
    texto: `Solicitação ${solicitacao ? "✓" : "pendente"} | Liquidação ${liquidacao ? "✓" : "pendente"}`,
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

/** "10/03/2026 08:00" -- data com a hora, quando a hora existe. */
export function dataHoraBR(data, hora) {
  const dia = dataBR(data);
  const horario = texto(hora);
  if (dia === "") return horario;
  return horario === "" ? dia : `${dia} ${horario}`;
}

/** "10/03/2026 a 12/03/2026" -- a coluna Período da lista. */
export function periodoDoProcesso(processo) {
  const saida = dataBR(processo?.data_saida);
  const retorno = dataBR(processo?.data_retorno);
  if (saida === "" && retorno === "") return "";
  if (saida !== "" && retorno !== "") return saida === retorno ? saida : `${saida} a ${retorno}`;
  return saida !== "" ? `A partir de ${saida}` : `Até ${retorno}`;
}

/** Nome da secretaria, venha do join da consulta ou da lista da tela. */
export function nomeDaSecretaria(processo, secretarias = []) {
  const doJoin = texto(processo?.secretaria?.nome);
  if (doJoin !== "") return doJoin;
  const id = processo?.secretaria_id;
  if (vazio(id)) return "";
  return texto((secretarias ?? []).find((s) => String(s.id) === String(id))?.nome);
}

/** O valor do processo no padrão brasileiro, pelo utilitário compartilhado. */
export function valorDoProcesso(processo) {
  return formatBRL(paraNumeroMoeda(processo?.valor_total));
}

/* -------------------------------------------------------------------------
 * Busca e filtros
 * ---------------------------------------------------------------------- */

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Só os dígitos -- é assim que a busca por CPF encontra "123.456.789-00". */
function digitos(valor) {
  return texto(valor).replace(/\D/g, "");
}

/**
 * Busca rápida: número, nome, CPF, secretaria, destino, objeto e situação.
 *
 * Filtra enquanto se digita, sem ida ao banco: a lista da tela já está em
 * memória. O CPF é comparado por dígitos, então "12345678900" acha
 * "123.456.789-00" e vice-versa.
 */
export function processoAtendeBusca(processo, termo, secretarias = []) {
  const procurado = semAcento(termo);
  if (procurado === "") return true;

  const numeros = digitos(termo);
  if (numeros !== "" && digitos(processo?.beneficiario_cpf).includes(numeros)) return true;

  const campos = [
    numeroDoProcesso(processo),
    String(processo?.numero ?? ""),
    processo?.beneficiario_nome,
    processo?.beneficiario_cpf,
    nomeDaSecretaria(processo, secretarias),
    processo?.destino,
    processo?.objeto,
    processo?.finalidade,
    situacaoInfo(processo?.situacao).rotulo,
  ];

  return campos.some((campo) => semAcento(campo).includes(procurado));
}

export function filtrosVazios() {
  return { ano: "", periodoInicio: "", periodoFim: "", secretaria: "", beneficiario: "", situacao: "" };
}

export function totalFiltrosAtivos(filtros = {}) {
  return Object.entries(filtrosVazios()).filter(([chave]) => texto(filtros?.[chave]) !== "").length;
}

/**
 * Filtros recolhíveis: ano, período, secretaria, beneficiário e situação.
 *
 * O período confere a viagem (data de saída), que é o que quem procura tem em
 * mente ao dizer "as diárias de março".
 */
export function processoAtendeFiltros(processo, filtros = {}) {
  const f = filtros ?? {};

  if (texto(f.ano) !== "" && String(processo?.ano ?? "") !== texto(f.ano)) return false;
  if (texto(f.situacao) !== "" && texto(processo?.situacao) !== texto(f.situacao)) return false;
  if (texto(f.secretaria) !== "" && String(processo?.secretaria_id ?? "") !== texto(f.secretaria)) return false;

  if (texto(f.beneficiario) !== "") {
    const procurado = semAcento(f.beneficiario);
    const numeros = digitos(f.beneficiario);
    const porNome = semAcento(processo?.beneficiario_nome).includes(procurado);
    const porCpf = numeros !== "" && digitos(processo?.beneficiario_cpf).includes(numeros);
    if (!porNome && !porCpf) return false;
  }

  const dataViagem = texto(processo?.data_saida) || texto(processo?.data_processo);
  if (texto(f.periodoInicio) !== "" && (dataViagem === "" || dataViagem < texto(f.periodoInicio))) return false;
  if (texto(f.periodoFim) !== "" && (dataViagem === "" || dataViagem > texto(f.periodoFim))) return false;

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
 * O andamento da liquidação NÃO vem na cópia: relatório de viagem, documentos
 * comprobatórios, datas e responsável pela conferência são fatos do processo
 * original. Copiá-los seria levar para o novo documento uma prestação de contas
 * que não aconteceu.
 */
export function duplicarProcesso(processo, { ano = new Date().getFullYear(), hoje = dataDeHoje() } = {}) {
  const copia = processoParaFormulario(processo);
  const vazioNovo = processoVazio({ ano, hoje });

  CAMPOS_LIQUIDACAO.forEach((campo) => {
    copia[campo] = vazioNovo[campo];
  });

  return {
    ...copia,
    id: null,
    numero: null,
    ano,
    situacao: "rascunho",
    data_processo: hoje,
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
 * é para isso que ele existe. A única exigência é a secretaria, porque é ela
 * que diz de quem é o processo.
 */
export function validarRascunho(formulario) {
  const erros = {};
  if (vazio(formulario?.secretaria_id)) erros.secretaria_id = "Escolha a secretaria do processo.";
  return erros;
}

/**
 * O que FINALIZAR exige: a página 1 completa.
 *
 * Finalizar fecha o documento para alteração, então o mínimo do papel precisa
 * estar lá. A página 2 NÃO é exigida: o normal é a liquidação ser preenchida
 * depois da viagem, e o processo finalizado com a liquidação pendente é
 * situação legítima.
 *
 * E vale de novo: finalizar não é pagar.
 */
export function validarFinalizacao(formulario) {
  const erros = validarRascunho(formulario);
  if (vazio(formulario?.data_processo)) erros.data_processo = "Informe a data do processo.";
  if (vazio(formulario?.beneficiario_nome)) erros.beneficiario_nome = "Informe o nome do beneficiário.";
  if (vazio(formulario?.destino)) erros.destino = "Informe o destino da viagem.";
  if (vazio(formulario?.finalidade)) erros.finalidade = "Descreva a finalidade da viagem.";
  if (paraNumeroMoeda(formulario?.valor_total) <= 0) erros.valor_total = "Informe o valor da diária.";

  const saida = texto(formulario?.data_saida);
  const retorno = texto(formulario?.data_retorno);
  if (saida !== "" && retorno !== "" && retorno < saida) {
    erros.data_retorno = "O retorno não pode ser antes da saída.";
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

/** "Processo de diária nº 0001/2026 — Maria Souza" (o registro afetado). */
export function identificacaoDoProcesso(processo) {
  const partes = [`Processo de diária nº ${numeroDoProcesso(processo) || "(sem número)"}`];
  const nome = texto(processo?.beneficiario_nome);
  if (nome !== "") partes.push(nome);
  return partes.join(" — ");
}

const CAMPOS_AUDITADOS = [
  "data_processo", "secretaria_id", "fornecedor_id", "beneficiario_nome", "beneficiario_cpf",
  "objeto", "valor_total", "valor_total_manual", "destino", "finalidade",
  "banco", "agencia", "conta", "pix", "titular",
  ...CAMPOS_SOLICITACAO, ...CAMPOS_LIQUIDACAO,
];

/**
 * O que mudou, campo por campo, para a auditoria gravar o ANTES e o DEPOIS.
 *
 * Devolve `{ anterior, novo }` apenas com os campos diferentes -- é o formato
 * que a comparação Antes/Depois da tela de Auditoria já sabe ler.
 */
export function diferencaParaAuditoria(anterior = {}, novo = {}) {
  const antes = {};
  const depois = {};

  CAMPOS_AUDITADOS.forEach((campo) => {
    const de = anterior?.[campo] ?? null;
    const para = novo?.[campo] ?? null;
    if (mesmoValor(de, para)) return;
    antes[campo] = de;
    depois[campo] = para;
  });

  return { anterior: antes, novo: depois, houveAlteracao: Object.keys(depois).length > 0 };
}

/**
 * A alteração manual do valor total, quando houve.
 *
 * Item 6 pede que a edição manual do total seja registrada na auditoria. Ela
 * ganha evento PRÓPRIO, com o que o cálculo daria e o que foi digitado, porque
 * é a informação que alguém vai querer conferir depois.
 */
export function alteracaoManualDeValor(anterior = {}, novo = {}) {
  const assumiu = novo?.valor_total_manual === true;
  const mudou =
    anterior?.valor_total_manual !== true
    || paraNumeroMoeda(anterior?.valor_total) !== paraNumeroMoeda(novo?.valor_total);
  if (!assumiu || !mudou) return null;

  return {
    valor_calculado: valorTotalCalculado(novo),
    valor_total: paraNumeroMoeda(novo?.valor_total),
    quantidade_diarias: quantidadeDeDiarias(novo?.quantidade_diarias),
    valor_unitario: paraNumeroMoeda(novo?.valor_unitario),
  };
}

/* -------------------------------------------------------------------------
 * Histórico do processo
 * ---------------------------------------------------------------------- */

export const ACOES_HISTORICO = {
  criou: "Processo criado",
  duplicou: "Processo criado por duplicação",
  alterou: "Dados alterados",
  salvou_rascunho: "Rascunho salvo",
  finalizou: "Processo finalizado",
  reabriu: "Processo reaberto para edição",
  cancelou: "Processo cancelado",
  excluiu: "Rascunho excluído",
  alterou_valor_manual: "Valor total alterado manualmente",
  imprimiu: "Processo impresso",
  gerou_pdf: "PDF gerado",
};

/** Uma linha do histórico em frase, como na linha do tempo das Tarefas. */
export function textoHistorico(registro) {
  const acao = ACOES_HISTORICO[registro?.acao] ?? texto(registro?.acao) ?? "Ação";
  const detalhes = registro?.detalhes ?? {};
  const complemento = texto(detalhes.descricao) || texto(detalhes.motivo);
  return complemento === "" ? acao : `${acao} — ${complemento}`;
}

/* -------------------------------------------------------------------------
 * Permissões do módulo
 * ---------------------------------------------------------------------- */

/**
 * As sete ações da área, distribuídas em DOIS módulos da Matriz de Permissões.
 *
 * A matriz tem cinco colunas por módulo, e este envio não cria nem altera
 * coluna de permissão. Então as cinco de `processos_diarias` levam visualizar,
 * criar, editar, finalizar e cancelar, e imprimir/duplicar ficam em
 * `processos_diarias_saida`. É o mesmo recurso já usado em Baixas e em Backup,
 * onde as cinco colunas também recebem os rótulos das ações reais da tela.
 *
 * O mesmo mapa está escrito na migration 20260911160000 e na função do banco
 * `public.pode_em_processos`.
 */
export const MODULO_DIARIAS = "processos_diarias";
export const MODULO_DIARIAS_SAIDA = "processos_diarias_saida";
export const MODULOS_PROCESSOS = [MODULO_DIARIAS, MODULO_DIARIAS_SAIDA];

export const ACOES_DIARIAS = [
  { chave: "visualizar", modulo: MODULO_DIARIAS, coluna: "pode_visualizar", rotulo: "Visualizar" },
  { chave: "criar", modulo: MODULO_DIARIAS, coluna: "pode_cadastrar", rotulo: "Criar" },
  { chave: "editar", modulo: MODULO_DIARIAS, coluna: "pode_editar", rotulo: "Editar" },
  // Finalizar fecha o DOCUMENTO. Não é aprovação de pagamento e não paga nada.
  { chave: "finalizar", modulo: MODULO_DIARIAS, coluna: "pode_aprovar", rotulo: "Finalizar" },
  // Cancelar é a anulação do processo, preservando registro, número e histórico.
  { chave: "cancelar", modulo: MODULO_DIARIAS, coluna: "pode_excluir", rotulo: "Cancelar" },
  { chave: "imprimir", modulo: MODULO_DIARIAS_SAIDA, coluna: "pode_visualizar", rotulo: "Imprimir e gerar PDF" },
  { chave: "duplicar", modulo: MODULO_DIARIAS_SAIDA, coluna: "pode_cadastrar", rotulo: "Duplicar" },
];

export const PERMISSOES_DIARIAS_NENHUMA = Object.freeze(
  Object.fromEntries(ACOES_DIARIAS.map((acao) => [acao.chave, false])),
);

/**
 * As permissões da área a partir das linhas de `permissoes_efetivas`.
 *
 * Sem NENHUMA linha dos dois módulos -- banco em que a migration deste envio
 * não foi rodada -- ninguém entra: a área é nova, e permissão nova não se
 * herda de módulo existente. Quem administra libera na Matriz de Permissões, e
 * a migration já deixa o Administrador liberado.
 *
 * Imprimir e duplicar, quando o módulo de saída não tem linha, acompanham
 * visualizar e criar: são ações da mesma área, e é o padrão que a migration
 * semeia.
 */
export function resolverPermissoesDiarias({ linhas = [] } = {}) {
  const porModulo = new Map((linhas ?? []).filter(Boolean).map((linha) => [String(linha.modulo), linha]));
  const principal = porModulo.get(MODULO_DIARIAS) ?? null;
  const saida = porModulo.get(MODULO_DIARIAS_SAIDA) ?? null;
  if (!principal && !saida) return { ...PERMISSOES_DIARIAS_NENHUMA };

  const resultado = {};
  ACOES_DIARIAS.forEach((acao) => {
    const linha = acao.modulo === MODULO_DIARIAS_SAIDA ? (saida ?? principal) : principal;
    resultado[acao.chave] = linha?.[acao.coluna] === true;
  });
  return resultado;
}

/** Quem não pode visualizar não vê a subaba Diárias no menu e não abre a rota. */
export function podeVerDiarias(permissoes) {
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
