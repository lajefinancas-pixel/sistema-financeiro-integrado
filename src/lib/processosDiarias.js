// Processos de Diária: as regras do documento, sem banco e sem tela.
//
// PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO. Nada neste arquivo -- e nada no
// módulo -- debita conta, dá baixa em NF, altera saldo, marca fornecedor como
// pago, cria pagamento ou toca na Programação Diária. "Solicitação de
// liquidação" é o NOME DO DOCUMENTO da página 2: é papel, não é baixa.
//
// UM PROCESSO = TRÊS DOCUMENTOS, como no modelo oficial da prefeitura: a
// Requisição de Diárias (página 1), a Liquidação/Solicitação de Pagamento
// (página 2) e a Prestação de Contas de Diárias (página 3). As três páginas são
// do MESMO processo, e por isso vivem no MESMO registro: mesmo número, mesmos
// dados gerais. Não existem "requisições", "liquidações" e "prestações de
// contas" como registros independentes, nem subabas separadas para elas.
//
// A PRESTAÇÃO DE CONTAS É PREENCHIDA DEPOIS, quando o servidor volta da
// viagem. Ela nunca impede a geração da Requisição + Liquidação: não entra na
// validação de finalização e a impressão do processo completo sai com a página
// 3 em branco (impressa com linhas) enquanto ela estiver pendente.
//
// Este arquivo é carregado direto pelos testes, sem o resolvedor de módulos do
// Vite: só funções puras, nada de React e nada de supabase.

import { formatBRL, paraNumeroMoeda } from "./moeda.js";
import { valorPorExtenso } from "./valorPorExtenso.js";
import { CAMPOS_SIGNATARIOS, camposDoSignatario } from "./processosServidores.js";
import { CAMPOS_SOLICITANTE_NO_PROCESSO } from "./processosSecretariasSolicitantes.js";

/* -------------------------------------------------------------------------
 * Identificação do módulo
 * ---------------------------------------------------------------------- */

export const TABELA_PROCESSOS = "processos_diarias";
export const TABELA_HISTORICO = "processos_diarias_historico";
export const TABELA_NUMERACAO = "processos_diarias_numeracao";

export const MIGRATION_PROCESSOS = "20260911160000_processos_modulo_diarias.sql";

/**
 * A migration dos campos do MODELO OFICIAL da prefeitura.
 *
 * Só acrescenta colunas em `public.processos_diarias` (endereço do servidor,
 * tipo de diária, data das diárias, custeio, valor por extenso e a prestação de
 * contas). Nenhuma coluna é removida, nenhum dado é reescrito e nenhuma outra
 * tabela é tocada. Precisa ser rodada à mão no SQL Editor do Supabase.
 */
export const MIGRATION_MODELO_OFICIAL = "20260911190000_processos_diarias_modelo_oficial.sql";

/**
 * A migration da TABELA DE DIÁRIAS e da IDENTIDADE VISUAL.
 *
 * Cria o cadastro versionado da tabela (faixa × categoria, pernoite e memória
 * do cálculo), o módulo de permissão próprio para editá-la e as colunas do
 * congelamento dentro do processo. Também precisa ser rodada à mão no SQL
 * Editor do Supabase.
 */
export const MIGRATION_TABELA_DIARIAS = "20260911210000_processos_diarias_tabela_e_identidade.sql";

export const AVISO_MIGRATION_PROCESSOS =
  `O módulo Processos ainda não tem as suas tabelas -- ou os campos do modelo oficial -- neste banco. Rode as migrations ${MIGRATION_PROCESSOS} `
  + `e ${MIGRATION_MODELO_OFICIAL} no SQL Editor do Supabase para liberar a área de Diárias. `
  + "Nenhum outro módulo é afetado por elas.";

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

// O campo TRANSPORTE foi REMOVIDO: ele não existe no modelo oficial da
// prefeitura e havia entrado por engano. Não sai no formulário, não sai no
// documento impresso e não é mais gravado. As colunas `transporte` e
// `transporte_outro` continuam no banco, com o que já tiverem, para que nenhum
// registro existente seja quebrado -- elas apenas não são mais escritas nem
// lidas por nada. A restrição de valores delas foi retirada pela migration
// 20260911230000_processos_servidores_e_ajustes_documento.sql.

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

/** "PROCESSO DE DIÁRIA Nº 0001/2026" -- o título das três páginas e da tela. */
export function tituloDoProcesso(processo) {
  const numero = numeroDoProcesso(processo);
  return numero ? `PROCESSO DE DIÁRIA Nº ${numero}` : "PROCESSO DE DIÁRIA (novo)";
}

/**
 * Os títulos das três folhas, como estão impressos no modelo oficial.
 *
 * São os nomes do papel, não apelidos internos: quem confere o processo procura
 * exatamente estas linhas no alto de cada página.
 */
export const TITULO_PAGINA_1 = "REQUISIÇÃO DE DIÁRIAS";
export const TITULO_PAGINA_2 = "LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO";
export const TITULO_PAGINA_3 = "PRESTAÇÃO DE CONTAS DE DIÁRIAS";

/** A lei municipal citada na abertura da Requisição. */
export const LEI_DAS_DIARIAS = "Lei Municipal nº 003/2005 de 23 de fevereiro de 2005";

/* -------------------------------------------------------------------------
 * Campos
 * ---------------------------------------------------------------------- */

/**
 * DADOS GERAIS: digitados UMA VEZ e reutilizados nas três páginas.
 *
 * Eles são compartilhados por CONSTRUÇÃO -- não há cópia a manter em dia, nem
 * linhas a sincronizar: as três páginas leem as mesmas colunas do mesmo
 * registro. Alterar um dado compartilhado na Requisição aparece na Liquidação e
 * na Prestação de Contas no mesmo instante porque é o mesmo dado.
 */
export const CAMPOS_COMPARTILHADOS = [
  "data_processo",
  // ⚠️ A SECRETARIA SOLICITANTE é o cadastro PRÓPRIO do módulo Processos, e não
  // o cadastro de secretarias do módulo financeiro: quem REQUISITA a diária
  // quase nunca é quem PAGA. `secretaria_id` continua aqui só para o processo
  // ANTIGO, gravado antes deste cadastro existir, continuar abrindo e imprimindo
  // exatamente como sempre imprimiu.
  "solicitante_id",
  "secretaria_id",
  "beneficiario_nome",
  "beneficiario_cpf",
  "objeto",
  "valor_total",
  // Nome e endereço identificam o servidor na página 1 e o FAVORECIDO na 2.
  "beneficiario_endereco",
  // O valor por extenso sai ao lado do número nas páginas 1 e 2.
  "valor_extenso",
  // Também vão prontos para a página 2 (item 7: sem digitação repetida).
  "destino",
  "finalidade",
  // O NÚMERO do banco vem do cadastro de Bancos; o nome vem junto. É o par que
  // faz o documento sair "001 — Banco do Brasil", como no modelo oficial.
  "banco_codigo",
  "banco",
  "agencia",
  "conta",
  "pix",
  "titular",
];

/** Campos PRÓPRIOS da página 1 (a Requisição de Diárias). */
export const CAMPOS_REQUISICAO = [
  // ⚠️ `beneficiario_matricula` NÃO está aqui. A matrícula saiu do formulário,
  // do cadastro de servidores e do documento impresso. A coluna continua no
  // banco com o que já foi gravado; o sistema parou de lê-la e de escrevê-la.
  "beneficiario_cargo",
  "beneficiario_lotacao",
  // Do modelo oficial: o tipo de diária e o custeio a que ela se destina, mais
  // a data das diárias escrita como o papel pede ("10 e 11/03/2026").
  "tipo_diaria",
  "custeio_despesas",
  "data_diarias",
  // A escolha que a Tabela de Diárias lê: faixa de distância, categoria do
  // cargo e pernoite. Delas saem o valor unitário sugerido e o "Tipo de Diária"
  // do documento impresso.
  "diaria_faixa",
  "diaria_categoria",
  "diaria_pernoite",
  "data_saida",
  "hora_saida",
  "data_retorno",
  "hora_retorno",
  "quantidade_diarias",
  "valor_unitario",
  "observacoes",
  // Quem ASSINA como responsável pela secretaria. É conteúdo do DOCUMENTO: o
  // nome, o CPF e o cargo ficam gravados no processo, e não são lidos do
  // cadastro na hora de imprimir -- é assim que documento antigo continua
  // mostrando quem assinou naquele momento.
  ...CAMPOS_SIGNATARIOS.filter((campo) => !campo.endsWith("_servidor_id")),
];

/** Campos PRÓPRIOS da página 2 (a Liquidação/Solicitação de Pagamento). */
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
 * Campos PRÓPRIOS da página 3 (a Prestação de Contas de Diárias).
 *
 * Ela é preenchida DEPOIS da viagem, e ficar pendente é o normal: nada aqui
 * entra na validação de finalização nem impede a impressão das páginas 1 e 2.
 */
export const CAMPOS_PRESTACAO = [
  "prestacao_relatorio",
  "prestacao_data",
];

/**
 * Os campos da Liquidação que NASCEM espelhando a Requisição.
 *
 * A viagem realizada normalmente é a viagem requisitada, então estes quatro
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
 * Aplica o cálculo automático ao formulário: o total e o valor por extenso.
 *
 * O total é recalculado sempre, EXCETO quando quem preenche assumiu o valor à
 * mão (`valor_total_manual`). A edição manual é permitida porque existe caso
 * real de valor concedido diferente do produto (diária proporcional, teto da
 * secretaria) -- e ela vai para a auditoria, com o antes e o depois.
 *
 * O extenso acompanha o total nos DOIS casos: o papel traz a coluna "VALOR POR
 * EXTENSO" ao lado do número, e ela sairia errada se o valor digitado à mão não
 * atualizasse o texto. Quem quiser outra redação assume o campo
 * (`valor_extenso_manual`) e o automático para de sobrescrever.
 */
export function aplicarCalculo(formulario) {
  const base = { ...(formulario ?? {}) };

  if (base.valor_total_manual !== true) {
    base.valor_total = calcularValorTotal(base.quantidade_diarias, base.valor_unitario);
  }
  if (base.valor_extenso_manual !== true) {
    base.valor_extenso = extensoAutomatico(base.valor_total);
  }

  return base;
}

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
 * O valor por extenso que o documento IMPRIME: o texto do processo, quando
 * existe; o gerado a partir do total, para os processos gravados antes de o
 * campo existir.
 */
export function valorExtensoDoProcesso(processo) {
  const proprio = texto(processo?.valor_extenso);
  return proprio !== "" ? proprio : extensoAutomatico(processo?.valor_total);
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
 * três páginas. O que precisa é o punhado de campos que a Liquidação tem em
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

/**
 * O RELATÓRIO DE ATIVIDADES que a página 3 imprime.
 *
 * O relatório passou a ter campo próprio na Prestação de Contas, mas os
 * processos gravados antes disso escreveram o texto no relatório da liquidação.
 * A leitura cai nele quando o campo novo está vazio, para que nenhum relatório
 * já digitado desapareça do papel.
 */
export function relatorioDaPrestacao(processo) {
  const proprio = texto(processo?.prestacao_relatorio);
  return proprio !== "" ? proprio : texto(processo?.liquidacao_relatorio);
}

/* -------------------------------------------------------------------------
 * Formulário
 * ---------------------------------------------------------------------- */

/** Processo em branco, pronto para "+ Nova Diária". */
export function processoVazio({ ano = new Date().getFullYear(), hoje = dataDeHoje() } = {}) {
  const branco = {
    ano,
    numero: null,
    // ⚠️ A data de hoje é SUGESTÃO INICIAL, não é trava. O campo é editável no
    // formulário e o documento imprime a data escolhida -- o processo pode ser
    // emitido com data anterior ou posterior.
    data_processo: hoje,
    solicitante_id: "",
    secretaria_id: "",
    fornecedor_id: null,
    // O vínculo interno com o cadastro de SERVIDORES: só um ponteiro. O
    // documento guarda o próprio texto, e editá-lo não altera o cadastro.
    beneficiario_servidor_id: null,
    assinante_secretaria_servidor_id: null,
    beneficiario_nome: "",
    beneficiario_cpf: "",
    objeto: "",
    valor_total: 0,
    valor_total_manual: false,
    valor_extenso: "",
    valor_extenso_manual: false,
    situacao: "rascunho",
  };
  // Os compartilhados entram junto: destino, finalidade e os dados bancários
  // são das TRÊS páginas, e sem eles aqui o formulário perderia esses campos ao
  // reabrir um rascunho (processoParaFormulario copia o que existe no branco).
  // Os dados CONGELADOS da secretaria solicitante entram no formulário para que
  // reabrir e salvar de novo um processo antigo não apague o que ele gravou.
  [
    ...CAMPOS_COMPARTILHADOS, ...CAMPOS_REQUISICAO, ...CAMPOS_LIQUIDACAO, ...CAMPOS_PRESTACAO,
    ...CAMPOS_SOLICITANTE_NO_PROCESSO,
  ].forEach((campo) => {
    if (!(campo in branco)) branco[campo] = "";
  });
  branco.quantidade_diarias = "";
  branco.valor_unitario = 0;
  branco.diaria_pernoite = false;
  branco.valor_unitario_manual = false;
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
  formulario.valor_extenso_manual = processo?.valor_extenso_manual === true;
  formulario.valor_unitario_manual = processo?.valor_unitario_manual === true;
  formulario.diaria_pernoite = processo?.diaria_pernoite === true;
  formulario.fornecedor_id = processo?.fornecedor_id ?? null;
  formulario.beneficiario_servidor_id = processo?.beneficiario_servidor_id ?? null;
  formulario.assinante_secretaria_servidor_id = processo?.assinante_secretaria_servidor_id ?? null;
  formulario.solicitante_id = processo?.solicitante_id ?? "";
  formulario.secretaria_id = processo?.secretaria_id ?? "";
  return formulario;
}

const CAMPOS_DATA = new Set([
  "data_processo", "data_saida", "data_retorno",
  "liquidacao_data", "liquidacao_data_saida", "liquidacao_data_retorno",
  "prestacao_data",
]);
const CAMPOS_MOEDA = new Set(["valor_total", "valor_unitario", "liquidacao_valor"]);
/** Campos que vão para o banco como booleano, nunca como texto vazio. */
const CAMPOS_BOOLEANOS = new Set(["diaria_pernoite"]);
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
    solicitante_id: vazio(base.solicitante_id) ? null : base.solicitante_id,
    secretaria_id: vazio(base.secretaria_id) ? null : base.secretaria_id,
    fornecedor_id: base.fornecedor_id ?? null,
    beneficiario_servidor_id: base.beneficiario_servidor_id ?? null,
    assinante_secretaria_servidor_id: base.assinante_secretaria_servidor_id ?? null,
    valor_total_manual: base.valor_total_manual === true,
    valor_extenso_manual: base.valor_extenso_manual === true,
    valor_unitario_manual: base.valor_unitario_manual === true,
  };

  ["data_processo", "beneficiario_nome", "beneficiario_cpf", "beneficiario_endereco", "objeto", "valor_total", "valor_extenso"]
    .concat(
      CAMPOS_REQUISICAO, CAMPOS_LIQUIDACAO, CAMPOS_PRESTACAO,
      ["destino", "finalidade", "banco_codigo", "banco", "agencia", "conta", "pix", "titular"],
      // Os dados da secretaria solicitante vão GRAVADOS no processo. É o
      // congelamento: trocar o secretário no cadastro amanhã não reescreve o
      // documento emitido hoje.
      CAMPOS_SOLICITANTE_NO_PROCESSO,
    )
    .forEach((campo) => {
      const valor = base[campo];
      if (CAMPOS_BOOLEANOS.has(campo)) {
        linha[campo] = valor === true;
        return;
      }
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
 * Preenchimento das três páginas
 * ---------------------------------------------------------------------- */

/**
 * Se cada página já tem o essencial. É o que a lista mostra como
 * "Requisição ✓ | Liquidação ✓ | Prestação de contas pendente".
 *
 * O essencial é curto de propósito: rascunho existe justamente para o processo
 * ser salvo incompleto, e o indicador é INFORMATIVO, não é trava. A prestação
 * de contas pendente aparece aqui e em nenhum outro lugar: ela não impede
 * salvar, finalizar nem imprimir a Requisição e a Liquidação.
 */
export function preenchimentoDoProcesso(processo) {
  const p = processo ?? {};
  const requisicao = !vazio(p.beneficiario_nome) && !vazio(p.destino) && paraNumeroMoeda(p.valor_total) > 0;
  const liquidacao = !vazio(p.objeto) && !vazio(p.banco) && !vazio(p.conta);
  const prestacao = relatorioDaPrestacao(p) !== "";

  const marca = (pronta) => (pronta ? "✓" : "pendente");
  return {
    requisicao,
    liquidacao,
    prestacao,
    texto: `Requisição ${marca(requisicao)} | Liquidação ${marca(liquidacao)} | Prestação de contas ${marca(prestacao)}`,
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

/**
 * "Data da(s) Diária(s)" da Requisição.
 *
 * O modelo oficial tem uma linha escrita à mão ali ("10 e 11/03/2026"), e é ela
 * que manda. Enquanto ninguém escreveu nada, o papel sai com o período da
 * viagem já informado, em vez de um campo vazio.
 */
export function dataDasDiarias(processo) {
  const escrita = texto(processo?.data_diarias);
  return escrita !== "" ? escrita : periodoDoProcesso(processo);
}

/**
 * O nome da secretaria SOLICITANTE do processo.
 *
 * A ordem é a do congelamento: primeiro o nome GRAVADO no processo, que é o que
 * garante que o documento antigo continue igual mesmo depois de o cadastro
 * mudar; depois o join da solicitante; depois o join da secretaria financeira e
 * a busca por id na lista da tela, os dois só para o processo ANTIGO continuar
 * mostrando a secretaria dele.
 */
export function nomeDaSecretaria(processo, secretarias = []) {
  const congelado = texto(processo?.solicitante_nome);
  if (congelado !== "") return congelado;

  const doSolicitante = texto(processo?.solicitante?.nome);
  if (doSolicitante !== "") return doSolicitante;

  const doJoin = texto(processo?.secretaria?.nome);
  if (doJoin !== "") return doJoin;

  const lista = secretarias ?? [];
  const idSolicitante = processo?.solicitante_id;
  if (!vazio(idSolicitante)) {
    const achada = texto(lista.find((s) => String(s.id) === String(idSolicitante))?.nome);
    if (achada !== "") return achada;
  }

  const id = processo?.secretaria_id;
  if (vazio(id)) return "";
  return texto(lista.find((s) => String(s.id) === String(id))?.nome);
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
  // O filtro de secretaria aceita as DUAS origens: a solicitante do processo
  // novo e a secretaria financeira gravada no processo antigo.
  if (texto(f.secretaria) !== "") {
    const escolhida = texto(f.secretaria);
    const daSolicitante = String(processo?.solicitante_id ?? "");
    const daFinanceira = String(processo?.secretaria_id ?? "");
    if (escolhida !== daSolicitante && escolhida !== daFinanceira) return false;
  }

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
 * O andamento da liquidação e a PRESTAÇÃO DE CONTAS não vêm na cópia:
 * relatório de atividades, documentos comprobatórios, datas e responsável pela
 * conferência são fatos do processo original. Copiá-los seria levar para o novo
 * documento uma prestação de contas que não aconteceu.
 */
export function duplicarProcesso(processo, { ano = new Date().getFullYear(), hoje = dataDeHoje() } = {}) {
  const copia = processoParaFormulario(processo);
  const vazioNovo = processoVazio({ ano, hoje });

  [...CAMPOS_LIQUIDACAO, ...CAMPOS_PRESTACAO].forEach((campo) => {
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
 * Rascunho pode ser salvo a qualquer momento, sem as três páginas completas --
 * é para isso que ele existe. A única exigência é a secretaria, porque é ela
 * que diz de quem é o processo.
 */
export function validarRascunho(formulario) {
  const erros = {};
  // A SOLICITANTE é a exigida agora. Rascunho antigo, que só tem a secretaria
  // financeira gravada, continua válido e continua salvando.
  if (vazio(formulario?.solicitante_id) && vazio(formulario?.secretaria_id)) {
    erros.solicitante_id = "Escolha a secretaria solicitante do processo.";
  }
  return erros;
}

/**
 * O que FINALIZAR exige: a página 1 completa.
 *
 * Finalizar fecha o documento para alteração, então o mínimo do papel precisa
 * estar lá. As páginas 2 e 3 NÃO são exigidas: o normal é a liquidação e a
 * prestação de contas serem preenchidas depois da viagem, e o processo
 * finalizado com elas pendentes é situação legítima. A prestação de contas
 * nunca impede a geração da Requisição e da Liquidação.
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
  "data_processo", "solicitante_id", "secretaria_id", "fornecedor_id", "beneficiario_nome", "beneficiario_cpf",
  "beneficiario_endereco", "objeto", "valor_total", "valor_total_manual",
  "valor_extenso", "valor_extenso_manual", "valor_unitario_manual", "destino", "finalidade",
  "banco_codigo", "banco", "agencia", "conta", "pix", "titular",
  ...CAMPOS_REQUISICAO, ...CAMPOS_LIQUIDACAO, ...CAMPOS_PRESTACAO,
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

/**
 * A alteração manual do VALOR UNITÁRIO, quando houve.
 *
 * O item 5 pede que o valor unitário continue editável à mão mesmo com a Tabela
 * de Diárias preenchendo-o, e que a alteração fique na auditoria. Ela ganha
 * evento próprio, com o que a tabela daria e o que foi digitado -- é a
 * informação que alguém vai querer conferir depois.
 */
export function alteracaoManualDeValorUnitario(anterior = {}, novo = {}) {
  const assumiu = novo?.valor_unitario_manual === true;
  const mudou =
    anterior?.valor_unitario_manual !== true
    || paraNumeroMoeda(anterior?.valor_unitario) !== paraNumeroMoeda(novo?.valor_unitario);
  if (!assumiu || !mudou) return null;

  return {
    valor_unitario: paraNumeroMoeda(novo?.valor_unitario),
    valor_unitario_anterior: paraNumeroMoeda(anterior?.valor_unitario),
    diaria_faixa: texto(novo?.diaria_faixa) || null,
    diaria_categoria: texto(novo?.diaria_categoria) || null,
    diaria_pernoite: novo?.diaria_pernoite === true,
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
  alterou_valor_unitario_manual: "Valor unitário alterado manualmente",
  alterou_tabela_diarias: "Tabela de Diárias atualizada",
  alterou_identidade_processos: "Identidade visual dos documentos alterada",
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

/**
 * A TABELA DE DIÁRIAS tem módulo PRÓPRIO, e é de propósito.
 *
 * Ela é um PARÂMETRO que afeta valores de pagamento: quem edita um processo não
 * passa a poder mexer na tabela que define quanto vale cada diária. Visualizar
 * a tabela, sim, acompanha quem vê o módulo Processos -- é a informação que
 * explica o valor do documento.
 */
export const MODULO_DIARIAS_TABELA = "processos_diarias_tabela";

export const MODULOS_PROCESSOS = [MODULO_DIARIAS, MODULO_DIARIAS_SAIDA, MODULO_DIARIAS_TABELA];

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
  // Editar a Tabela de Diárias: permissão restrita, no módulo próprio dela.
  { chave: "editar_tabela", modulo: MODULO_DIARIAS_TABELA, coluna: "pode_editar", rotulo: "Editar a Tabela de Diárias" },
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
  const tabela = porModulo.get(MODULO_DIARIAS_TABELA) ?? null;
  if (!principal && !saida) return { ...PERMISSOES_DIARIAS_NENHUMA };

  const resultado = {};
  ACOES_DIARIAS.forEach((acao) => {
    // Editar a tabela NÃO tem herança: sem a linha do módulo próprio, ninguém
    // edita. Permissão restrita não se deduz de outra permissão.
    if (acao.modulo === MODULO_DIARIAS_TABELA) {
      resultado[acao.chave] = tabela?.[acao.coluna] === true;
      return;
    }
    const linha = acao.modulo === MODULO_DIARIAS_SAIDA ? (saida ?? principal) : principal;
    resultado[acao.chave] = linha?.[acao.coluna] === true;
  });
  return resultado;
}

/** Ver a Tabela de Diárias acompanha quem vê o módulo Processos. */
export function podeVerTabelaDeDiarias(permissoes) {
  return permissoes?.visualizar === true;
}

/** Editar a Tabela de Diárias exige a permissão restrita do módulo próprio. */
export function podeEditarTabelaDeDiarias(permissoes) {
  return permissoes?.editar_tabela === true;
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
