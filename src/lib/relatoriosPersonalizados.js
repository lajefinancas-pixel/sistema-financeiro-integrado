// Relatórios personalizados da Central de Relatórios.
//
// O usuário monta o relatório escolhendo a fonte de dados, o período, os filtros,
// as colunas, o agrupamento e a ordenação. Este arquivo declara o que cada fonte
// oferece e monta o resultado -- nada mais.
//
// Duas regras importantes:
//
//  1. Nenhum dado novo é calculado aqui. As linhas saem das mesmas bases que os
//     relatórios prontos usam (carregarBaseFinanceira, carregarBaseFornecedores,
//     carregarBasePagamentos, carregarBaseTarefas), então um relatório
//     personalizado nunca mostra número diferente do que a tela mostra.
//
//  2. O resultado tem exatamente o formato que `gerarRelatorio` devolve (colunas,
//     grupos com subtotal, registros e totais). Assim a tela, a impressão, o PDF
//     e o Excel do relatório personalizado são os mesmos dos relatórios prontos.

import { somar } from "./rateioPagamentos";
import { formatBRL, paraNumeroMoeda } from "./moeda";
import { rotuloDoMes, soData } from "./relatoriosCatalogo";

function compararTexto(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { sensitivity: "base" });
}

/* -------------------------------------------------------------------------
 * Fontes de dados
 * ---------------------------------------------------------------------- */

const AGRUPAMENTO_MES = { id: "mes", label: "Mês", campo: "mes" };

/** Soma dos lançamentos de cada fornecedor (valor e ISS já retidos no cadastro). */
function totaisPorFornecedor(bases) {
  const totais = new Map();
  (bases?.tributaria?.lancamentos ?? []).forEach((lancamento) => {
    const chave = String(lancamento.fornecedor_id ?? "");
    if (chave === "") return;
    const atual = totais.get(chave) ?? { valor_lancado: 0, valor_iss: 0, lancamentos: 0 };
    atual.valor_lancado = somar([atual.valor_lancado, lancamento.valor_bruto]);
    atual.valor_iss = somar([atual.valor_iss, lancamento.valor_iss]);
    atual.lancamentos += 1;
    totais.set(chave, atual);
  });
  return totais;
}

export const FONTES = [
  {
    id: "saldos",
    nome: "Saldos",
    descricao: "Contas bancárias com saldo, valor reservado e saldo disponível.",
    // Os saldos são a posição atual das contas, não um movimento com data de
    // início e fim -- por isso esta fonte não pede período.
    temPeriodo: false,
    aviso: "Os saldos são a posição atual das contas, por isso esta fonte não usa período.",
    colunas: [
      { chave: "secretaria", label: "Secretaria", peso: 20 },
      { chave: "banco", label: "Banco", peso: 18 },
      { chave: "nome_conta", label: "Nome da conta", peso: 20 },
      { chave: "numero_conta", label: "Número da conta", peso: 14 },
      { chave: "tipo_conta", label: "Tipo de conta", peso: 12 },
      { chave: "dataSaldo", label: "Atualizado em", tipo: "data", peso: 12 },
      { chave: "saldo", label: "Saldo", tipo: "moeda", somavel: true, peso: 16 },
      { chave: "valorReservado", label: "Valor reservado", tipo: "moeda", somavel: true, peso: 16 },
      { chave: "saldoDisponivel", label: "Saldo disponível", tipo: "moeda", somavel: true, peso: 16 },
    ],
    padrao: ["secretaria", "banco", "nome_conta", "numero_conta", "dataSaldo", "saldo"],
    filtros: [
      { id: "secretaria", label: "Secretaria", campo: "secretaria" },
      { id: "banco", label: "Banco", campo: "banco" },
    ],
    agrupamentos: [
      { id: "secretaria", label: "Secretaria", campo: "secretaria" },
      { id: "banco", label: "Banco", campo: "banco" },
    ],
    campoNome: "nome_conta",
    campoValor: "saldo",
    campoData: "dataSaldo",
    linhas: (bases) =>
      (bases?.financeira?.contas ?? []).map((conta) => ({
        ...conta,
        secretaria: conta.secretaria ?? "Sem secretaria",
        banco: conta.banco ?? "--",
        tipo_conta: conta.tipo_conta ?? "",
        dataSaldo: soData(conta.dataSaldo),
      })),
  },
  {
    id: "fornecedores",
    nome: "Fornecedores",
    descricao: "Cadastro de fornecedores, com o valor lançado e o ISS retido de cada um.",
    temPeriodo: true,
    rotuloPeriodo: "Data do cadastro",
    colunas: [
      { chave: "razao_social", label: "Nome / Razão social", peso: 26 },
      { chave: "nome_fantasia", label: "Nome fantasia", peso: 20 },
      { chave: "cpf_cnpj", label: "CPF / CNPJ", peso: 15 },
      { chave: "secretaria", label: "Secretaria", peso: 20 },
      { chave: "telefone", label: "Telefone", peso: 12 },
      { chave: "email", label: "E-mail", peso: 18 },
      { chave: "situacao", label: "Situação", peso: 10 },
      { chave: "lancamentos", label: "Lançamentos", tipo: "numero", somavel: true, peso: 11 },
      { chave: "valor_lancado", label: "Valor", tipo: "moeda", somavel: true, peso: 16 },
      { chave: "valor_iss", label: "ISS", tipo: "moeda", somavel: true, peso: 15 },
      { chave: "cadastro", label: "Data", tipo: "data", peso: 12 },
    ],
    padrao: ["razao_social", "cpf_cnpj", "secretaria", "valor_lancado", "valor_iss", "cadastro"],
    filtros: [
      { id: "secretaria", label: "Secretaria", campo: "secretaria" },
      { id: "situacao", label: "Situação", campo: "situacao" },
    ],
    agrupamentos: [
      { id: "secretaria", label: "Secretaria", campo: "secretaria" },
      { id: "situacao", label: "Situação", campo: "situacao" },
      AGRUPAMENTO_MES,
    ],
    campoNome: "razao_social",
    campoValor: "valor_lancado",
    campoData: "cadastro",
    // Valor e ISS vêm dos lançamentos já registrados no cadastro do fornecedor
    // (os mesmos que a categoria Tributário usa); aqui eles são apenas somados
    // por fornecedor. Quando essa base não estiver disponível, as duas colunas
    // ficam zeradas e o restante do relatório continua completo.
    linhas: (bases) => {
      const totais = totaisPorFornecedor(bases);
      return (bases?.fornecedores?.fornecedores ?? []).map((f) => {
        const soma = totais.get(String(f.id)) ?? { valor_lancado: 0, valor_iss: 0, lancamentos: 0 };
        return {
          id: f.id,
          razao_social: f.razao_social ?? "",
          nome_fantasia: f.nome_fantasia ?? "",
          cpf_cnpj: f.cpf_cnpj ?? "",
          secretaria: f.secretaria ?? "Sem secretaria",
          telefone: f.telefone ?? "",
          email: f.email ?? "",
          situacao: f.ativo === false ? "Inativo" : "Ativo",
          lancamentos: soma.lancamentos,
          valor_lancado: soma.valor_lancado,
          valor_iss: soma.valor_iss,
          cadastro: soData(f.created_at),
        };
      });
    },
  },
  {
    id: "pagamentos",
    nome: "Pagamentos",
    descricao: "Pagamentos lançados nas programações, por secretaria, fornecedor e situação.",
    temPeriodo: true,
    rotuloPeriodo: "Data da programação",
    colunas: [
      { chave: "fornecedor", label: "Fornecedor", peso: 26 },
      { chave: "secretaria", label: "Secretaria", peso: 20 },
      { chave: "programacao", label: "Programação", peso: 20 },
      { chave: "nota", label: "Nota fiscal", peso: 12 },
      { chave: "descricao", label: "Descrição", peso: 24 },
      { chave: "status", label: "Status", peso: 11 },
      { chave: "movimento", label: "Movimento do dia", peso: 13 },
      { chave: "data", label: "Data", tipo: "data", peso: 12 },
      { chave: "valor", label: "Valor", tipo: "moeda", somavel: true, peso: 16 },
    ],
    padrao: ["fornecedor", "secretaria", "nota", "status", "data", "valor"],
    filtros: [
      { id: "status", label: "Status", campo: "status" },
      { id: "fornecedor", label: "Fornecedor", campo: "fornecedor" },
      { id: "secretaria", label: "Secretaria", campo: "secretaria" },
    ],
    agrupamentos: [
      { id: "secretaria", label: "Secretaria", campo: "secretaria" },
      { id: "fornecedor", label: "Fornecedor", campo: "fornecedor" },
      { id: "status", label: "Status", campo: "status" },
      AGRUPAMENTO_MES,
    ],
    campoNome: "fornecedor",
    campoValor: "valor",
    campoData: "data",
    linhas: (bases) => bases?.pagamentos?.pagamentos ?? [],
  },
  {
    id: "tarefas",
    nome: "Tarefas",
    descricao: "Tarefas da equipe, por responsável, status, categoria e prazo.",
    temPeriodo: true,
    rotuloPeriodo: "Prazo",
    colunas: [
      { chave: "titulo", label: "Tarefa", peso: 30 },
      { chave: "responsavel", label: "Responsável", peso: 18 },
      { chave: "autor", label: "Criada por", peso: 18 },
      { chave: "status", label: "Status", peso: 13 },
      { chave: "prioridade", label: "Prioridade", peso: 11 },
      { chave: "categoria", label: "Categoria", peso: 13 },
      { chave: "secretaria", label: "Secretaria", peso: 16 },
      { chave: "prazo", label: "Prazo", tipo: "data", peso: 11 },
      { chave: "prazo_situacao", label: "Situação do prazo", peso: 13 },
      { chave: "concluida_em_texto", label: "Concluída em", peso: 15 },
      { chave: "concluida_por", label: "Concluída por", peso: 17 },
    ],
    padrao: ["titulo", "responsavel", "status", "prioridade", "prazo", "prazo_situacao"],
    filtros: [
      { id: "responsavel", label: "Responsável", campo: "responsavel" },
      { id: "status", label: "Status", campo: "status" },
    ],
    agrupamentos: [
      { id: "responsavel", label: "Responsável", campo: "responsavel" },
      { id: "status", label: "Status", campo: "status" },
      { id: "categoria", label: "Categoria", campo: "categoria" },
      { id: "secretaria", label: "Secretaria", campo: "secretaria" },
      AGRUPAMENTO_MES,
    ],
    campoNome: "titulo",
    campoValor: null,
    campoData: "prazo",
    linhas: (bases) => bases?.tarefas?.tarefas ?? [],
  },
];

export function fontePorId(id) {
  return FONTES.find((f) => f.id === id) ?? null;
}

/* -------------------------------------------------------------------------
 * Ordenação
 * ---------------------------------------------------------------------- */

export const ORDENACOES = [
  { id: "nome-az", label: "Nome A-Z", criterio: "nome", direcao: 1 },
  { id: "nome-za", label: "Nome Z-A", criterio: "nome", direcao: -1 },
  { id: "valor-desc", label: "Maior valor", criterio: "valor", direcao: -1 },
  { id: "valor-asc", label: "Menor valor", criterio: "valor", direcao: 1 },
  { id: "data-desc", label: "Mais recente", criterio: "data", direcao: -1 },
  { id: "data-asc", label: "Mais antigo", criterio: "data", direcao: 1 },
];

/** Só as ordenações que fazem sentido na fonte (sem valor, sem "maior valor"). */
export function ordenacoesDaFonte(fonte) {
  return ORDENACOES.filter((o) => {
    if (o.criterio === "valor") return Boolean(fonte?.campoValor);
    if (o.criterio === "data") return Boolean(fonte?.campoData);
    return true;
  });
}

function comparadorDeLinhas(fonte, ordenacaoId) {
  const ordenacao =
    ordenacoesDaFonte(fonte).find((o) => o.id === ordenacaoId) ?? ordenacoesDaFonte(fonte)[0];
  if (!ordenacao) return () => 0;

  const porNome = (a, b) => compararTexto(a?.[fonte.campoNome], b?.[fonte.campoNome]);

  if (ordenacao.criterio === "valor") {
    return (a, b) => {
      const diferenca = paraNumeroMoeda(a?.[fonte.campoValor]) - paraNumeroMoeda(b?.[fonte.campoValor]);
      return diferenca === 0 ? porNome(a, b) : diferenca * ordenacao.direcao;
    };
  }
  if (ordenacao.criterio === "data") {
    // Registro sem data fica sempre no fim, nas duas direções.
    return (a, b) => {
      const umA = soData(a?.[fonte.campoData]);
      const umB = soData(b?.[fonte.campoData]);
      if (umA === "" && umB === "") return porNome(a, b);
      if (umA === "") return 1;
      if (umB === "") return -1;
      const diferenca = umA.localeCompare(umB);
      return diferenca === 0 ? porNome(a, b) : diferenca * ordenacao.direcao;
    };
  }
  return (a, b) => porNome(a, b) * ordenacao.direcao;
}

/* -------------------------------------------------------------------------
 * Configuração do construtor
 * ---------------------------------------------------------------------- */

/** Configuração inicial de uma fonte: colunas sugeridas, sem filtro nem período. */
export function configuracaoPadrao(fonteId) {
  const fonte = fontePorId(fonteId) ?? FONTES[0];
  return {
    fonte: fonte.id,
    periodo: { inicio: "", fim: "" },
    filtros: {},
    colunas: [...fonte.padrao],
    agrupamento: "",
    ordenacao: ordenacoesDaFonte(fonte)[0]?.id ?? "nome-az",
  };
}

/**
 * Deixa uma configuração pronta para uso, descartando o que não existe mais:
 * coluna removida, filtro desconhecido, agrupamento ou ordenação inválidos. É o
 * que protege os relatórios salvos de quebrarem quando uma fonte muda.
 */
export function normalizarConfiguracao(bruta) {
  const fonte = fontePorId(bruta?.fonte);
  if (!fonte) return configuracaoPadrao(FONTES[0].id);

  const chavesValidas = new Set(fonte.colunas.map((c) => c.chave));
  const colunas = (Array.isArray(bruta?.colunas) ? bruta.colunas : []).filter((c) =>
    chavesValidas.has(c)
  );

  const filtros = {};
  fonte.filtros.forEach((filtro) => {
    const valor = bruta?.filtros?.[filtro.id];
    if (valor !== undefined && valor !== null && String(valor) !== "") {
      filtros[filtro.id] = String(valor);
    }
  });

  const agrupamento = fonte.agrupamentos.some((a) => a.id === bruta?.agrupamento)
    ? bruta.agrupamento
    : "";
  const ordenacao = ordenacoesDaFonte(fonte).some((o) => o.id === bruta?.ordenacao)
    ? bruta.ordenacao
    : ordenacoesDaFonte(fonte)[0]?.id ?? "nome-az";

  return {
    fonte: fonte.id,
    periodo: fonte.temPeriodo
      ? { inicio: soData(bruta?.periodo?.inicio), fim: soData(bruta?.periodo?.fim) }
      : { inicio: "", fim: "" },
    filtros,
    colunas: colunas.length > 0 ? colunas : [...fonte.padrao],
    agrupamento,
    ordenacao,
  };
}

/* -------------------------------------------------------------------------
 * Montagem do relatório
 * ---------------------------------------------------------------------- */

/** Linhas da fonte com o mês já calculado (usado pelo agrupamento por mês). */
export function linhasDaFonte(fonte, bases) {
  const linhas = fonte?.linhas(bases ?? {}) ?? [];
  if (!fonte?.campoData) return linhas;
  return linhas.map((linha) => {
    const data = soData(linha[fonte.campoData]);
    return { ...linha, mes: data === "" ? "Sem data" : rotuloDoMes(data), chaveMes: data.slice(0, 7) };
  });
}

/** Valores existentes de um campo, para preencher o select do filtro. */
export function opcoesDeFiltro(linhas, campo) {
  const valores = new Set();
  (linhas ?? []).forEach((linha) => {
    const texto = String(linha?.[campo] ?? "").trim();
    if (texto !== "") valores.add(texto);
  });
  return [...valores].sort(compararTexto);
}

function dentroDoPeriodo(linha, fonte, periodo) {
  if (!fonte.temPeriodo || !fonte.campoData) return true;
  const inicio = soData(periodo?.inicio);
  const fim = soData(periodo?.fim);
  if (inicio === "" && fim === "") return true;

  const data = soData(linha?.[fonte.campoData]);
  if (data === "") return false; // sem data não há como afirmar que está no período
  if (inicio !== "" && data < inicio) return false;
  if (fim !== "" && data > fim) return false;
  return true;
}

function passaNosFiltros(linha, fonte, filtros) {
  return fonte.filtros.every((filtro) => {
    const escolhido = filtros?.[filtro.id];
    if (!escolhido) return true;
    return String(linha?.[filtro.campo] ?? "") === String(escolhido);
  });
}

function totalizar(linhas, colunas) {
  const totais = {};
  colunas
    .filter((c) => c.somavel)
    .forEach((c) => {
      totais[c.chave] = somar(linhas.map((l) => l[c.chave]));
    });
  return totais;
}

function agrupar(linhas, agrupamento, comparador) {
  if (!agrupamento) return [{ nome: null, linhas: [...linhas].sort(comparador) }];

  const grupos = new Map();
  linhas.forEach((linha) => {
    const nome = String(linha[agrupamento.campo] ?? "").trim() || "--";
    if (!grupos.has(nome)) grupos.set(nome, []);
    grupos.get(nome).push(linha);
  });

  const blocos = [...grupos.entries()].map(([nome, doGrupo]) => ({
    nome,
    linhas: [...doGrupo].sort(comparador),
  }));

  // Meses saem em ordem de calendário; os outros grupos, em ordem alfabética.
  if (agrupamento.id === "mes") {
    return blocos.sort((a, b) =>
      String(a.linhas[0]?.chaveMes ?? "").localeCompare(String(b.linhas[0]?.chaveMes ?? ""))
    );
  }
  return blocos.sort((a, b) => compararTexto(a.nome, b.nome));
}

/** Texto curto com os critérios aplicados, mostrado na tela e nos documentos. */
export function resumoDosCriterios(configuracao) {
  const fonte = fontePorId(configuracao?.fonte);
  if (!fonte) return "";

  const partes = [`Fonte: ${fonte.nome}`];
  fonte.filtros.forEach((filtro) => {
    const valor = configuracao?.filtros?.[filtro.id];
    if (valor) partes.push(`${filtro.label}: ${valor}`);
  });
  const agrupamento = fonte.agrupamentos.find((a) => a.id === configuracao?.agrupamento);
  if (agrupamento) partes.push(`Agrupado por ${agrupamento.label.toLowerCase()}`);
  const ordenacao = ORDENACOES.find((o) => o.id === configuracao?.ordenacao);
  if (ordenacao) partes.push(`Ordem: ${ordenacao.label}`);
  return partes.join(" • ");
}

/**
 * Resultado completo do relatório personalizado, no mesmo formato dos relatórios
 * prontos: colunas escolhidas, grupos com subtotal, quantidade de registros e os
 * totais gerais das colunas de valor.
 */
export function gerarRelatorioPersonalizado(configuracao, bases, { nome } = {}) {
  const config = normalizarConfiguracao(configuracao);
  const fonte = fontePorId(config.fonte);
  if (!fonte) return null;

  // A ordem das colunas segue a declarada na fonte, não a ordem dos cliques.
  const colunas = fonte.colunas.filter((c) => config.colunas.includes(c.chave));
  if (colunas.length === 0) return null;

  const selecionadas = linhasDaFonte(fonte, bases).filter(
    (linha) => dentroDoPeriodo(linha, fonte, config.periodo) && passaNosFiltros(linha, fonte, config.filtros)
  );

  const agrupamento = fonte.agrupamentos.find((a) => a.id === config.agrupamento) ?? null;
  const grupos = agrupar(selecionadas, agrupamento, comparadorDeLinhas(fonte, config.ordenacao)).map(
    (grupo) => ({ ...grupo, totais: totalizar(grupo.linhas, colunas) })
  );

  const colunasDeValor = colunas.filter((c) => c.somavel && c.tipo === "moeda");
  const totais = totalizar(selecionadas, colunas);

  return {
    id: "personalizado",
    nome: String(nome ?? "").trim() || `Relatório personalizado — ${fonte.nome}`,
    descricao: resumoDosCriterios(config),
    colunas,
    rotuloGrupo: agrupamento?.label ?? null,
    campoTotal: colunasDeValor[0]?.chave ?? null,
    rotuloTotal: colunasDeValor[0]?.label ?? "Valor total",
    grupos,
    registros: selecionadas.length,
    totais,
    // O primeiro valor já aparece como total do relatório; os demais viram chips.
    resumo: colunasDeValor.slice(1).map((coluna) => ({
      label: coluna.label,
      valor: formatBRL(totais[coluna.chave]),
    })),
  };
}
