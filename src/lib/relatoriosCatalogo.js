// Catálogo da Central de Relatórios.
//
// Cada relatório declara suas colunas e uma função `montar` que devolve as linhas
// já agrupadas. Só isso: quem desenha a tela, quem imprime, quem gera PDF e quem
// exporta a planilha usam o mesmo resultado, então os quatro nunca divergem.
//
// Tudo aqui é cálculo puro (sem banco) -- as consultas ficam em relatoriosDados.js.
//
// As contas que chegam de carregarSaldosDasContas já vêm com uma linha por conta,
// então os subtotais podem somar a coluna diretamente, sem risco de contar a
// mesma conta duas vezes.

import { somar } from "./rateioPagamentos";
import { formatBRL } from "./moeda";

/** Só a parte "AAAA-MM-DD" de uma data/hora do banco. */
export function soData(valor) {
  return String(valor ?? "").slice(0, 10);
}

/** "AAAA-MM-DD" -> "DD/MM/AAAA" (sem passar por Date, que muda o dia por fuso). */
export function formatarDataBR(valor) {
  const iso = soData(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "--";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function rotuloDoMes(valor) {
  const iso = soData(valor);
  if (!/^\d{4}-\d{2}/.test(iso)) return "Sem data de cadastro";
  const [ano, mes] = iso.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} de ${ano}`;
}

/** Texto de uma célula, do jeito que ela aparece na tela e nos documentos. */
export function formatarCelula(valor, tipo) {
  if (tipo === "moeda") return formatBRL(valor);
  if (tipo === "data") return formatarDataBR(valor);
  if (tipo === "numero") return String(valor ?? 0);
  const texto = String(valor ?? "").trim();
  return texto === "" ? "--" : texto;
}

function compararTexto(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { sensitivity: "base" });
}

/**
 * Agrupa as linhas por um campo, na ordem alfabética dos grupos.
 * `ordem` permite fixar uma sequência própria (ex.: Ativos antes de Inativos).
 */
function agrupar(linhas, campo, { ordem, ordenarLinhas } = {}) {
  const grupos = new Map();
  linhas.forEach((linha) => {
    const nome = String(linha[campo] ?? "--");
    if (!grupos.has(nome)) grupos.set(nome, []);
    grupos.get(nome).push(linha);
  });

  const nomes = [...grupos.keys()].sort((a, b) => {
    if (ordem) {
      const posicao = (nome) => {
        const indice = ordem.indexOf(nome);
        return indice < 0 ? ordem.length : indice;
      };
      const diferenca = posicao(a) - posicao(b);
      if (diferenca !== 0) return diferenca;
    }
    return compararTexto(a, b);
  });

  return nomes.map((nome) => ({
    nome,
    linhas: ordenarLinhas ? [...grupos.get(nome)].sort(ordenarLinhas) : grupos.get(nome),
  }));
}

/** Um único bloco, sem cabeçalho de grupo (relatórios de lista corrida). */
function blocoUnico(linhas) {
  return [{ nome: null, linhas }];
}

// --- Colunas reaproveitadas ---
const COL_SECRETARIA = { chave: "secretaria", label: "Secretaria", peso: 22 };
const COL_BANCO = { chave: "banco", label: "Banco", peso: 20 };
const COL_NUMERO = { chave: "numero_conta", label: "Número da Conta", peso: 15 };
const COL_NOME_CONTA = { chave: "nome_conta", label: "Nome da Conta", peso: 22 };
const COL_SALDO = { chave: "saldo", label: "Saldo", tipo: "moeda", somavel: true, peso: 16 };
const COL_ATUALIZADO = { chave: "dataSaldo", label: "Atualizado em", tipo: "data", peso: 12 };

const COL_FORNECEDOR = { chave: "razao_social", label: "Razão Social", peso: 26 };
const COL_DOCUMENTO = { chave: "cpf_cnpj", label: "CPF / CNPJ", peso: 15 };
const COL_SITUACAO = { chave: "situacao", label: "Situação", peso: 10 };
const COL_CADASTRO = { chave: "cadastro", label: "Cadastro", tipo: "data", peso: 12 };

function contasOrdenadas(contas) {
  return [...contas].sort(
    (a, b) =>
      compararTexto(a.secretaria, b.secretaria) ||
      compararTexto(a.banco, b.banco) ||
      compararTexto(a.nome_conta, b.nome_conta)
  );
}

function porRazaoSocial(a, b) {
  return compararTexto(a.razao_social, b.razao_social);
}

function linhasDeFornecedores(fornecedores) {
  return fornecedores.map((f) => ({
    ...f,
    situacao: f.ativo === false ? "Inativo" : "Ativo",
    cadastro: soData(f.created_at),
    telefone: f.telefone ?? "",
    email: f.email ?? "",
  }));
}

// --- Relatórios ---
export const CATEGORIAS = [
  {
    id: "financeiro",
    nome: "Financeiro",
    descricao: "Saldos das contas bancárias, por secretaria, por banco e o consolidado geral.",
  },
  {
    id: "fornecedores",
    nome: "Fornecedores",
    descricao: "Cadastro de fornecedores por secretaria, por período de cadastro e por situação.",
  },
];

export const RELATORIOS = [
  {
    id: "saldos-bancarios",
    categoria: "financeiro",
    base: "financeira",
    nome: "Saldos bancários",
    descricao: "Todas as contas do sistema com o saldo atual.",
    colunas: [COL_SECRETARIA, COL_BANCO, COL_NUMERO, COL_NOME_CONTA, COL_ATUALIZADO, COL_SALDO],
    campoTotal: "saldo",
    montar: ({ financeira }) => blocoUnico(contasOrdenadas(financeira?.contas ?? [])),
  },
  {
    id: "saldos-por-secretaria",
    categoria: "financeiro",
    base: "financeira",
    nome: "Saldos por secretaria",
    descricao: "Contas agrupadas por secretaria, com subtotal de cada uma.",
    colunas: [COL_BANCO, COL_NUMERO, COL_NOME_CONTA, COL_ATUALIZADO, COL_SALDO],
    campoTotal: "saldo",
    rotuloGrupo: "Secretaria",
    montar: ({ financeira }) =>
      agrupar(financeira?.contas ?? [], "secretaria", {
        ordenarLinhas: (a, b) => compararTexto(a.banco, b.banco) || compararTexto(a.nome_conta, b.nome_conta),
      }),
  },
  {
    id: "saldos-por-banco",
    categoria: "financeiro",
    base: "financeira",
    nome: "Saldos por banco",
    descricao: "Contas agrupadas por instituição bancária, com subtotal de cada banco.",
    colunas: [COL_SECRETARIA, COL_NUMERO, COL_NOME_CONTA, COL_ATUALIZADO, COL_SALDO],
    campoTotal: "saldo",
    rotuloGrupo: "Banco",
    montar: ({ financeira }) =>
      agrupar(financeira?.contas ?? [], "banco", {
        ordenarLinhas: (a, b) =>
          compararTexto(a.secretaria, b.secretaria) || compararTexto(a.nome_conta, b.nome_conta),
      }),
  },
  {
    id: "consolidado-financeiro",
    categoria: "financeiro",
    base: "financeira",
    nome: "Consolidado financeiro",
    descricao: "Visão geral: saldo total, valor reservado e saldo disponível por secretaria.",
    colunas: [
      { ...COL_SECRETARIA, peso: 28 },
      { chave: "contas", label: "Contas", tipo: "numero", somavel: true, peso: 8 },
      { chave: "saldo", label: "Saldo total", tipo: "moeda", somavel: true, peso: 21 },
      { chave: "valorReservado", label: "Valor reservado", tipo: "moeda", somavel: true, peso: 21 },
      { chave: "saldoDisponivel", label: "Saldo disponível", tipo: "moeda", somavel: true, peso: 22 },
    ],
    campoTotal: "saldo",
    rotuloTotal: "Saldo total",
    // O saldo disponível é sempre Saldo Real - Valor Reservado, a mesma conta das
    // outras telas; aqui ela é apenas somada por secretaria.
    montar: ({ financeira }) => {
      const porSecretaria = new Map();
      (financeira?.contas ?? []).forEach((conta) => {
        const nome = conta.secretaria ?? "Sem secretaria";
        if (!porSecretaria.has(nome)) porSecretaria.set(nome, []);
        porSecretaria.get(nome).push(conta);
      });

      const linhas = [...porSecretaria.entries()]
        .map(([secretaria, contas]) => ({
          secretaria,
          contas: contas.length,
          saldo: somar(contas.map((c) => c.saldo)),
          valorReservado: somar(contas.map((c) => c.valorReservado)),
          saldoDisponivel: somar(contas.map((c) => c.saldoDisponivel)),
        }))
        .sort((a, b) => compararTexto(a.secretaria, b.secretaria));

      return blocoUnico(linhas);
    },
    resumo: (resultado) => [
      { label: "Valor reservado", valor: formatBRL(resultado.totais.valorReservado) },
      { label: "Saldo disponível", valor: formatBRL(resultado.totais.saldoDisponivel), destaque: true },
    ],
  },
  {
    id: "relacao-fornecedores",
    categoria: "fornecedores",
    base: "fornecedores",
    nome: "Relação de fornecedores",
    descricao: "Lista completa do cadastro, com documento, secretaria e contato.",
    colunas: [
      COL_FORNECEDOR,
      COL_DOCUMENTO,
      COL_SECRETARIA,
      { chave: "telefone", label: "Telefone", peso: 12 },
      { chave: "email", label: "E-mail", peso: 17 },
      COL_SITUACAO,
      COL_CADASTRO,
    ],
    montar: ({ fornecedores }) =>
      blocoUnico(linhasDeFornecedores(fornecedores?.fornecedores ?? []).sort(porRazaoSocial)),
  },
  {
    id: "fornecedores-por-secretaria",
    categoria: "fornecedores",
    base: "fornecedores",
    nome: "Fornecedores por secretaria",
    descricao: "Cadastro agrupado por secretaria, com a quantidade de cada uma.",
    colunas: [COL_FORNECEDOR, COL_DOCUMENTO, { chave: "telefone", label: "Telefone", peso: 14 }, COL_SITUACAO, COL_CADASTRO],
    rotuloGrupo: "Secretaria",
    montar: ({ fornecedores }) =>
      agrupar(linhasDeFornecedores(fornecedores?.fornecedores ?? []), "secretaria", {
        ordenarLinhas: porRazaoSocial,
      }),
  },
  {
    id: "fornecedores-por-periodo",
    categoria: "fornecedores",
    base: "fornecedores",
    nome: "Fornecedores por período",
    descricao: "Cadastros feitos no período escolhido, agrupados por mês.",
    temPeriodo: true,
    colunas: [COL_FORNECEDOR, COL_DOCUMENTO, COL_SECRETARIA, COL_SITUACAO, COL_CADASTRO],
    rotuloGrupo: "Mês do cadastro",
    montar: ({ fornecedores }, { periodo } = {}) => {
      const inicio = soData(periodo?.inicio);
      const fim = soData(periodo?.fim);
      const noPeriodo = linhasDeFornecedores(fornecedores?.fornecedores ?? []).filter((f) => {
        if (!f.cadastro) return false;
        if (inicio && f.cadastro < inicio) return false;
        if (fim && f.cadastro > fim) return false;
        return true;
      });

      return agrupar(
        noPeriodo.map((f) => ({ ...f, mes: rotuloDoMes(f.cadastro), chaveMes: f.cadastro.slice(0, 7) })),
        "mes",
        { ordenarLinhas: (a, b) => String(a.cadastro).localeCompare(String(b.cadastro)) || porRazaoSocial(a, b) }
      ).sort((a, b) =>
        String(a.linhas[0]?.chaveMes ?? "").localeCompare(String(b.linhas[0]?.chaveMes ?? ""))
      );
    },
  },
  {
    id: "fornecedores-ativos-inativos",
    categoria: "fornecedores",
    base: "fornecedores",
    nome: "Fornecedores ativos / inativos",
    descricao: "Cadastro separado por situação, com a quantidade de cada situação.",
    colunas: [COL_FORNECEDOR, COL_DOCUMENTO, COL_SECRETARIA, { chave: "telefone", label: "Telefone", peso: 14 }, COL_CADASTRO],
    rotuloGrupo: "Situação",
    montar: ({ fornecedores }) =>
      agrupar(linhasDeFornecedores(fornecedores?.fornecedores ?? []), "situacao", {
        ordem: ["Ativo", "Inativo"],
        ordenarLinhas: porRazaoSocial,
      }),
    resumo: (resultado) => {
      const quantidade = (nome) => resultado.grupos.find((g) => g.nome === nome)?.linhas.length ?? 0;
      return [
        { label: "Ativos", valor: String(quantidade("Ativo")) },
        { label: "Inativos", valor: String(quantidade("Inativo")) },
      ];
    },
  },
];

export function relatorioPorId(id) {
  return RELATORIOS.find((r) => r.id === id) ?? null;
}

export function relatoriosDaCategoria(categoria) {
  return RELATORIOS.filter((r) => r.categoria === categoria);
}

/** Soma das colunas marcadas como somáveis. */
function totalizar(linhas, colunas) {
  const totais = {};
  colunas
    .filter((c) => c.somavel)
    .forEach((c) => {
      totais[c.chave] = somar(linhas.map((l) => l[c.chave]));
    });
  return totais;
}

/**
 * Resultado completo de um relatório: colunas, grupos com subtotal, quantidade de
 * registros e os totais gerais. É o que a tela mostra e o que os documentos usam.
 */
export function gerarRelatorio(relatorio, bases, opcoes = {}) {
  if (!relatorio) return null;

  const grupos = (relatorio.montar(bases ?? {}, opcoes) ?? [])
    .filter((g) => g && Array.isArray(g.linhas))
    .map((g) => ({ ...g, totais: totalizar(g.linhas, relatorio.colunas) }));

  const todasAsLinhas = grupos.flatMap((g) => g.linhas);
  const resultado = {
    id: relatorio.id,
    nome: relatorio.nome,
    descricao: relatorio.descricao,
    colunas: relatorio.colunas,
    rotuloGrupo: relatorio.rotuloGrupo ?? null,
    campoTotal: relatorio.campoTotal ?? null,
    rotuloTotal: relatorio.rotuloTotal ?? "Valor total",
    grupos,
    registros: todasAsLinhas.length,
    totais: totalizar(todasAsLinhas, relatorio.colunas),
  };

  resultado.resumo = relatorio.resumo ? relatorio.resumo(resultado) : [];
  return resultado;
}

/** Valor total do relatório (quando ele tem uma coluna de valor). */
export function valorTotal(resultado) {
  if (!resultado?.campoTotal) return null;
  return resultado.totais?.[resultado.campoTotal] ?? 0;
}
