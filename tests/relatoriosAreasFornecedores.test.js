import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// src/lib importa vizinhos sem o ".js" (o Vite resolve; o Node, não). O hook
// abaixo só completa a extensão quando a resolução falha, para que este teste
// possa exercitar o catálogo e a exportação de verdade, e não só o texto deles.
register("./fixtures/resolveSemExtensao.mjs", import.meta.url);

import XLSX from "xlsx";
import {
  AREAS,
  areaPorId,
  resumoFinanceiroDoRegistro,
  totaisDaLista,
} from "../src/lib/areasFornecedores.js";
import {
  colunasDoRelatorioDaArea,
  descricaoDosFiltros,
  filtrosDoRelatorioDaArea,
  filtrosVaziosDoRelatorio,
  linhasDoRelatorioDaArea,
  periodoDaArea,
  totalFiltrosDoRelatorio,
} from "../src/lib/relatoriosAreasFornecedores.js";
import { formatBRL } from "../src/lib/moeda.js";

const { CATEGORIAS, RELATORIOS, gerarRelatorio, relatorioPermitido, relatorioPorId, valorTotal } =
  await import("../src/lib/relatoriosCatalogo.js");
const { exportarExcelRelatorio } = await import("../src/lib/relatoriosDocumento.js");

/**
 * Os relatórios de Patrocínios, Aluguéis e Bandas na Central de Relatórios.
 *
 * O que este arquivo defende, e que nenhuma outra parte da suíte defende:
 *
 *   1. os três relatórios existem, listam os registros da área e trazem as
 *      colunas da listagem dela;
 *   2. os filtros (período, secretaria, fornecedor, situação, faixa de valores e
 *      os próprios da área) recortam o relatório, e é o recorte filtrado que vai
 *      para o papel, para o PDF e para a planilha;
 *   3. total contratado, pago e saldo BATEM com os da tela da área, porque Pago e
 *      Saldo saem das baixas das NFs vinculadas -- a mesma conta da tela e da aba
 *      de Baixas --, e não de coluna gravada em paralelo;
 *   4. a planilha leva valor como NÚMERO com formato de moeda brasileiro, então
 *      a coluna soma no Excel;
 *   5. cada relatório respeita o "visualizar" da SUA área;
 *   6. os relatórios que já existiam continuam idênticos.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const ler = (caminho) => readFileSync(join(RAIZ, caminho), "utf8");

/* -------------------------------------------------------------------------
 * Cenário: os mesmos registros que a tela da área receberia
 * ---------------------------------------------------------------------- */

const ZETA = {
  id: 1,
  razao_social: "Zeta Produções Artísticas LTDA",
  nome_fantasia: "Zeta Produções",
  apelido: "Zé Produções",
  cpf_cnpj: "12.345.678/0001-99",
};
const ALFA = {
  id: 2,
  razao_social: "Alfa Estruturas e Eventos ME",
  nome_fantasia: "",
  apelido: "",
  cpf_cnpj: "98.765.432/0001-11",
};

/** NF vinculada com uma baixa: é daqui que o Pago do registro sai. */
function nota(valor, pago) {
  return { id: `nf-${valor}-${pago}`, valor_total: valor, valor_pago: pago };
}

function registro(extras = {}) {
  return {
    fornecedores: ZETA,
    secretaria_id: 3,
    secretarias: { nome: "Secretaria de Cultura" },
    valor: 1000,
    situacao: "vigente",
    ativo: true,
    notas: [],
    criado_em: "2026-03-10T09:00:00Z",
    ...extras,
  };
}

const PATROCINIOS = [
  registro({
    id: "p1",
    nome: "Patrocínio da Festa do Padroeiro",
    evento: "Festa do Padroeiro",
    valor: 5000,
    notas: [nota(3000, 1200)],
  }),
  registro({
    id: "p2",
    fornecedores: ALFA,
    nome: "Patrocínio do Aniversário da Cidade",
    evento: "Aniversário da Cidade",
    valor: 2500,
    secretaria_id: 4,
    secretarias: { nome: "Secretaria de Esportes" },
    criado_em: "2026-07-02T09:00:00Z",
  }),
  registro({
    id: "p3",
    nome: "Patrocínio do Festival de Inverno",
    evento: "Festival de Inverno",
    valor: 8000,
    situacao: "cancelado",
    criado_em: "2026-07-20T09:00:00Z",
  }),
];

const ALUGUEIS = [
  registro({
    id: "a1",
    objeto: "Imóvel",
    descricao: "Sala da Secretaria de Cultura",
    valor: 24000,
    data_inicio: "2026-01-01",
    notas: [nota(24000, 6000)],
  }),
  registro({
    id: "a2",
    fornecedores: ALFA,
    objeto: "Equipamento",
    descricao: "Palco e sonorização",
    valor: 12000,
    data_inicio: "2026-06-15",
  }),
];

const BANDAS = [
  registro({
    id: "b1",
    banda: "Trio Pé de Serra",
    evento: "São João",
    valor: 15000,
    data_apresentacao: "2026-06-24",
    notas: [nota(15000, 15000)],
  }),
  registro({
    id: "b2",
    fornecedores: ALFA,
    banda: "Banda Aurora",
    evento: "Réveillon",
    valor: 30000,
    data_apresentacao: "2026-12-31",
    notas: [nota(30000, 10000)],
  }),
];

const REGISTROS = { patrocinios: PATROCINIOS, alugueis: ALUGUEIS, bandas: BANDAS };
const SECRETARIAS = [
  { id: 3, nome: "Secretaria de Cultura" },
  { id: 4, nome: "Secretaria de Esportes" },
];

/** A base como a Central a monta, com as três áreas liberadas. */
function bases(permitidas = { patrocinios: true, alugueis: true, bandas: true }) {
  return {
    areas: {
      permitidas,
      registros: Object.fromEntries(
        Object.entries(REGISTROS).filter(([id]) => permitidas[id] === true),
      ),
      secretarias: SECRETARIAS,
    },
  };
}

function relatorioDaArea(areaId) {
  return relatorioPorId(`area-${areaId}`);
}

function gerar(areaId, filtros = {}) {
  const area = areaPorId(areaId);
  return gerarRelatorio(relatorioDaArea(areaId), bases(), {
    filtrosArea: { ...filtrosVaziosDoRelatorio(area), ...filtros },
  });
}

function linhas(resultado) {
  return resultado.grupos.flatMap((g) => g.linhas);
}

/* -------------------------------------------------------------------------
 * 1. Os três relatórios abrem e listam os registros certos
 * ---------------------------------------------------------------------- */

test("a Central ganha os três relatórios, um por área, em categoria própria", () => {
  const daCategoria = RELATORIOS.filter((r) => r.categoria === "areas");
  assert.deepEqual(
    daCategoria.map((r) => r.id),
    ["area-patrocinios", "area-alugueis", "area-bandas"],
  );
  assert.deepEqual(
    daCategoria.map((r) => r.nome),
    ["Relatório de Patrocínios", "Relatório de Aluguéis", "Relatório de Bandas"],
  );
  // Cada um responde pela sua área e pela mesma base.
  assert.deepEqual(
    daCategoria.map((r) => [r.area, r.base]),
    [
      ["patrocinios", "areas"],
      ["alugueis", "areas"],
      ["bandas", "areas"],
    ],
  );
  assert.ok(CATEGORIAS.some((c) => c.id === "areas"));
});

test("cada relatório lista os registros da sua área", () => {
  assert.deepEqual(
    linhas(gerar("patrocinios")).map((l) => l.nome),
    [
      "Patrocínio do Aniversário da Cidade",
      "Patrocínio da Festa do Padroeiro",
      "Patrocínio do Festival de Inverno",
    ],
  );
  assert.deepEqual(linhas(gerar("alugueis")).map((l) => l.id), ["a2", "a1"]);
  assert.deepEqual(linhas(gerar("bandas")).map((l) => l.banda), [
    "Banda Aurora",
    "Trio Pé de Serra",
  ]);

  // Nenhum registro de outra área entra no relatório.
  for (const area of AREAS) {
    const ids = linhas(gerar(area.id)).map((l) => l.id);
    assert.equal(ids.length, REGISTROS[area.id].length);
    assert.deepEqual(
      [...ids].sort(),
      REGISTROS[area.id].map((r) => r.id).sort(),
    );
  }
});

test("as colunas são as da listagem da área, sem a de ações", () => {
  for (const area of AREAS) {
    const doRelatorio = relatorioDaArea(area.id).colunas;
    assert.deepEqual(
      doRelatorio.map((c) => c.chave),
      area.colunas.filter((c) => c.chave !== "acoes").map((c) => c.chave),
    );
    assert.deepEqual(
      doRelatorio.map((c) => c.label),
      area.colunas.filter((c) => c.chave !== "acoes").map((c) => c.rotulo),
    );
    // Valor, Pago e Saldo entram como moeda somável -- é o que faz o rodapé
    // totalizar e a planilha sair numérica.
    assert.deepEqual(
      doRelatorio.filter((c) => c.tipo === "moeda").map((c) => c.chave),
      ["valor", "pago", "saldo"],
    );
    assert.ok(doRelatorio.filter((c) => c.tipo === "moeda").every((c) => c.somavel === true));
    assert.ok(!doRelatorio.some((c) => c.chave === "acoes"));
  }
});

test("a ordem é alfabética: fornecedor exibido, e banda/artista em Bandas", () => {
  // O apelido é o nome exibido do fornecedor -- a ordem segue o que a pessoa lê.
  const patrocinios = linhas(gerar("patrocinios"));
  assert.deepEqual(patrocinios.map((l) => l.fornecedor), [
    "Alfa Estruturas e Eventos ME",
    "Zé Produções",
    "Zé Produções",
  ]);
  assert.deepEqual(
    linhas(gerar("alugueis")).map((l) => l.fornecedor),
    ["Alfa Estruturas e Eventos ME", "Zé Produções"],
  );
  assert.deepEqual(linhas(gerar("bandas")).map((l) => l.banda), [
    "Banda Aurora",
    "Trio Pé de Serra",
  ]);
});

/* -------------------------------------------------------------------------
 * 2. Os filtros funcionam, e a exportação respeita o que foi filtrado
 * ---------------------------------------------------------------------- */

test("cada relatório tem os filtros pedidos, e os da própria área", () => {
  const comuns = ["periodo", "secretaria", "fornecedor", "situacao", "valor"];
  for (const area of AREAS) {
    const chaves = filtrosDoRelatorioDaArea(area).map((f) => f.chave);
    assert.deepEqual(chaves.slice(0, comuns.length), comuns);
  }
  assert.deepEqual(filtrosDoRelatorioDaArea(areaPorId("patrocinios")).map((f) => f.chave).slice(5), [
    "evento",
  ]);
  assert.deepEqual(filtrosDoRelatorioDaArea(areaPorId("alugueis")).map((f) => f.chave).slice(5), [
    "objeto",
  ]);
  assert.deepEqual(filtrosDoRelatorioDaArea(areaPorId("bandas")).map((f) => f.chave).slice(5), [
    "banda",
    "evento",
  ]);
});

test("sem filtro nenhum, o relatório abre com a área inteira", () => {
  for (const area of AREAS) {
    assert.equal(totalFiltrosDoRelatorio(area, filtrosVaziosDoRelatorio(area)), 0);
    assert.equal(gerar(area.id).registros, REGISTROS[area.id].length);
  }
});

test("período, secretaria, fornecedor, situação, faixa e filtros da área recortam", () => {
  // Período: pela data de cadastro em Patrocínios.
  assert.deepEqual(
    linhas(gerar("patrocinios", { periodoInicio: "2026-07-01", periodoFim: "2026-07-31" })).map(
      (l) => l.id,
    ),
    ["p2", "p3"],
  );
  // Período: pela data de início em Aluguéis, e pela apresentação em Bandas.
  assert.deepEqual(
    linhas(gerar("alugueis", { periodoInicio: "2026-06-01" })).map((l) => l.id),
    ["a2"],
  );
  assert.deepEqual(
    linhas(gerar("bandas", { periodoFim: "2026-06-30" })).map((l) => l.id),
    ["b1"],
  );
  assert.deepEqual(
    Object.entries(periodoDaArea(areaPorId("bandas"))).find(([chave]) => chave === "campo")?.[1],
    "data_apresentacao",
  );

  // Secretaria (id, como no filtro da tela).
  assert.deepEqual(linhas(gerar("patrocinios", { secretaria: "4" })).map((l) => l.id), ["p2"]);
  // Fornecedor: acha pela razão social, pelo nome fantasia e pelo apelido.
  assert.deepEqual(linhas(gerar("patrocinios", { fornecedor: "alfa" })).map((l) => l.id), ["p2"]);
  assert.deepEqual(
    linhas(gerar("patrocinios", { fornecedor: "zé produções" })).map((l) => l.id),
    ["p1", "p3"],
  );
  // Situação do registro.
  assert.deepEqual(linhas(gerar("patrocinios", { situacao: "cancelado" })).map((l) => l.id), ["p3"]);
  // Faixa de valores.
  assert.deepEqual(
    linhas(gerar("patrocinios", { valorMin: "3000", valorMax: "6000" })).map((l) => l.id),
    ["p1"],
  );
  // Evento/finalidade, objeto alugado e banda/artista.
  assert.deepEqual(linhas(gerar("patrocinios", { evento: "festival" })).map((l) => l.id), ["p3"]);
  assert.deepEqual(linhas(gerar("alugueis", { objeto: "palco" })).map((l) => l.id), ["a2"]);
  assert.deepEqual(linhas(gerar("alugueis", { objeto: "imóvel" })).map((l) => l.id), ["a1"]);
  assert.deepEqual(linhas(gerar("bandas", { banda: "aurora" })).map((l) => l.id), ["b2"]);
  assert.deepEqual(linhas(gerar("bandas", { evento: "são joão" })).map((l) => l.id), ["b1"]);
});

test("filtro de período informado deixa de fora quem não tem a data considerada", () => {
  const semData = [registro({ id: "b3", banda: "Sem Data", valor: 1000 })];
  const area = areaPorId("bandas");
  assert.equal(linhasDoRelatorioDaArea(area, semData, filtrosVaziosDoRelatorio(area)).length, 1);
  assert.equal(
    linhasDoRelatorioDaArea(area, semData, { periodoInicio: "2026-01-01" }).length,
    0,
  );
});

test("os filtros aplicados vão para o cabeçalho dos documentos, em texto", () => {
  const area = areaPorId("bandas");
  const descricao = descricaoDosFiltros(
    area,
    { ...filtrosVaziosDoRelatorio(area), secretaria: "3", situacao: "vigente", valorMin: "1000", banda: "aurora" },
    { secretarias: SECRETARIAS },
  );
  assert.deepEqual(
    descricao.map((item) => `${item.label}: ${item.valor}`),
    [
      "Secretaria: Secretaria de Cultura",
      "Situação: Vigente",
      `Faixa de valores: de ${formatBRL(1000)}`,
      "Banda / Artista: aurora",
    ],
  );
  // O período não vem daqui: quem escreve o período é a tela, com o mesmo
  // `textoPeriodo` que os outros relatórios usam no cabeçalho.
  assert.ok(!descricao.some((item) => item.chave === "periodo"));
});

test("a exportação usa exatamente o que está filtrado", () => {
  const resultado = gerar("bandas", { banda: "aurora" });
  const planilha = planilhaDe(resultado);
  const bandasNaPlanilha = celulasDaColuna(planilha, "Banda/Artista");
  assert.deepEqual(bandasNaPlanilha, ["Banda Aurora"]);
  assert.equal(resultado.registros, 1);
});

/* -------------------------------------------------------------------------
 * 3. Contratado, pago e saldo batem com a tela da área
 * ---------------------------------------------------------------------- */

test("os totais do relatório são os mesmos da tela da área", () => {
  for (const area of AREAS) {
    const daTela = totaisDaLista(REGISTROS[area.id]);
    const resultado = gerar(area.id);

    assert.equal(resultado.registros, daTela.registros);
    assert.equal(valorTotal(resultado), daTela.valor);
    assert.equal(resultado.totais.valor, daTela.valor);
    assert.equal(resultado.totais.pago, daTela.pago);
    assert.equal(resultado.totais.saldo, daTela.saldo);
    assert.equal(resultado.rotuloTotal, "Total contratado");

    // Os chips do relatório mostram os mesmos pago e saldo.
    const resumo = Object.fromEntries(resultado.resumo.map((i) => [i.label, i.valor]));
    assert.equal(resumo["Total pago"], formatBRL(daTela.pago));
    assert.equal(resumo["Saldo"], formatBRL(daTela.saldo));
  }
});

test("os totais filtrados também batem com a mesma conta da tela", () => {
  const filtrados = PATROCINIOS.filter((r) => r.id !== "p3");
  const daTela = totaisDaLista(filtrados);
  const resultado = gerar("patrocinios", { periodoInicio: "2026-01-01", periodoFim: "2026-07-10" });
  assert.equal(resultado.totais.valor, daTela.valor);
  assert.equal(resultado.totais.pago, daTela.pago);
  assert.equal(resultado.totais.saldo, daTela.saldo);
});

test("Pago e Saldo saem das baixas das NFs vinculadas, registro por registro", () => {
  const porId = new Map(linhas(gerar("bandas")).map((l) => [l.id, l]));
  for (const bruto of BANDAS) {
    const esperado = resumoFinanceiroDoRegistro(bruto);
    const linha = porId.get(bruto.id);
    assert.equal(linha.valor, esperado.valor);
    assert.equal(linha.pago, esperado.pago);
    assert.equal(linha.saldo, esperado.saldo);
  }
  // Baixa parcial de 10.000 em 30.000 contratados.
  assert.equal(porId.get("b2").pago, 10000);
  assert.equal(porId.get("b2").saldo, 20000);
  assert.equal(porId.get("b2").situacaoPagamento, "Parcialmente pago");
  // Registro sem NF vinculada: pago zero e saldo igual ao valor.
  const semNota = linhas(gerar("alugueis")).find((l) => l.id === "a2");
  assert.equal(semNota.pago, 0);
  assert.equal(semNota.saldo, 12000);
});

test("nenhuma coluna de valor pago é gravada em paralelo pelos relatórios", () => {
  const fonte = semComentarios(ler("src/lib/relatoriosAreasFornecedores.js"));
  // O pago só pode vir do resumo financeiro do registro (as baixas das NFs).
  assert.ok(fonte.includes("resumoFinanceiroDoRegistro"));
  assert.ok(!/registro\??\.\s*pago/.test(fonte));
  assert.ok(!/valor_pago/.test(fonte));
  assert.ok(!/from\(|insert\(|update\(|supabase/.test(fonte));
});

/* -------------------------------------------------------------------------
 * 4. A planilha soma
 * ---------------------------------------------------------------------- */

/**
 * Exporta o relatório de verdade e devolve a aba do arquivo gerado.
 *
 * A planilha é escrita num arquivo temporário e lida de volta: o que os testes
 * conferem é o que o Excel receberia, célula por célula, e não uma imitação da
 * exportação.
 */
function planilhaDe(resultado) {
  const caminho = join(mkdtempSync(join(tmpdir(), "relatorio-area-")), "planilha.xlsx");
  try {
    exportarExcelRelatorio({ titulo: resultado.nome, resultado, arquivo: caminho });
    assert.ok(existsSync(caminho), "a exportação não gerou planilha");
    return XLSX.readFile(caminho, { cellNF: true }).Sheets.Relatorio;
  } finally {
    rmSync(dirname(caminho), { recursive: true, force: true });
  }
}

function colunaDoRotulo(planilha, rotulo) {
  const referencia = XLSX.utils.decode_range(planilha["!ref"]);
  for (let coluna = referencia.s.c; coluna <= referencia.e.c; coluna += 1) {
    const celula = planilha[XLSX.utils.encode_cell({ r: 0, c: coluna })];
    if (celula?.v === rotulo) return coluna;
  }
  throw new Error(`Coluna "${rotulo}" não encontrada na planilha`);
}

function celulasDaColuna(planilha, rotulo) {
  const coluna = colunaDoRotulo(planilha, rotulo);
  const referencia = XLSX.utils.decode_range(planilha["!ref"]);
  const valores = [];
  for (let linha = 1; linha <= referencia.e.r; linha += 1) {
    const celula = planilha[XLSX.utils.encode_cell({ r: linha, c: coluna })];
    valores.push(celula?.v);
  }
  return valores;
}

function celulasBrutasDaColuna(planilha, rotulo) {
  const coluna = colunaDoRotulo(planilha, rotulo);
  const referencia = XLSX.utils.decode_range(planilha["!ref"]);
  const celulas = [];
  for (let linha = 1; linha <= referencia.e.r; linha += 1) {
    celulas.push(planilha[XLSX.utils.encode_cell({ r: linha, c: coluna })]);
  }
  return celulas;
}

test("na planilha, valor, pago e saldo são números com formato de moeda", () => {
  for (const area of AREAS) {
    const resultado = gerar(area.id);
    const planilha = planilhaDe(resultado);

    for (const chave of ["valor", "pago", "saldo"]) {
      const rotulo = relatorioDaArea(area.id).colunas.find((c) => c.chave === chave).label;
      const celulas = celulasBrutasDaColuna(planilha, rotulo);
      assert.equal(celulas.length, REGISTROS[area.id].length);
      celulas.forEach((celula) => {
        assert.equal(celula.t, "n", `${area.id}.${chave} tem de ser número na planilha`);
        assert.equal(typeof celula.v, "number");
        assert.equal(celula.z, "R$ #,##0.00");
      });
    }

    // A coluna soma: o que está nas células é o total do relatório.
    const rotuloValor = relatorioDaArea(area.id).colunas.find((c) => c.chave === "valor").label;
    const soma = celulasBrutasDaColuna(planilha, rotuloValor).reduce((t, c) => t + c.v, 0);
    assert.equal(soma, gerar(area.id).totais.valor);
  }
});

/* -------------------------------------------------------------------------
 * 5. Permissão por área
 * ---------------------------------------------------------------------- */

test("cada relatório exige o visualizar da SUA área", () => {
  const soBandas = bases({ bandas: true });
  assert.equal(relatorioPermitido(relatorioDaArea("bandas"), soBandas), true);
  assert.equal(relatorioPermitido(relatorioDaArea("patrocinios"), soBandas), false);
  assert.equal(relatorioPermitido(relatorioDaArea("alugueis"), soBandas), false);

  // Sem base (ninguém liberado, ou base indisponível): nenhum dos três aparece.
  for (const area of AREAS) {
    assert.equal(relatorioPermitido(relatorioDaArea(area.id), {}), false);
    assert.equal(relatorioPermitido(relatorioDaArea(area.id), bases({})), false);
  }

  // Nenhum outro relatório passou a depender de permissão de área.
  RELATORIOS.filter((r) => !r.area).forEach((r) => {
    assert.equal(relatorioPermitido(r, {}), true);
  });
});

test("a base só consulta e só devolve as áreas que a pessoa pode visualizar", () => {
  const fonte = semComentarios(ler("src/lib/relatoriosDados.js"));
  const trecho = fonte.slice(fonte.indexOf("export async function carregarBaseAreasFornecedores"));
  assert.ok(trecho.includes("carregarPermissoesDasAreas"));
  assert.ok(trecho.includes('permissoes?.[area.id]?.visualizar === true'));
  // A leitura é a mesma consulta da tela da área -- nada de select próprio aqui.
  assert.ok(trecho.includes("carregarRegistrosDaArea"));
  assert.ok(!/\.from\(/.test(trecho.slice(0, trecho.indexOf("\n}\n"))));
});

test("a tela esconde o relatório de quem não pode ver a área", () => {
  const pagina = semComentarios(ler("src/pages/Relatorios.jsx"));
  assert.ok(pagina.includes("relatorioPermitido"));
  assert.ok(pagina.includes("relatoriosVisiveis(categoria.id)"));
  // A permissão também vale na hora de gerar, não só na lista.
  assert.ok(pagina.includes("podeVerRelatorio"));
});

/* -------------------------------------------------------------------------
 * 6. Cabeçalho, e os relatórios de antes intactos
 * ---------------------------------------------------------------------- */

test("os documentos saem com o cabeçalho padrão, os filtros e a data de emissão", () => {
  const pagina = semComentarios(ler("src/pages/Relatorios.jsx"));
  // O mesmo montarCabecalho dos outros relatórios, agora recebendo os filtros
  // da área e o período escolhido.
  assert.ok(pagina.includes("montarCabecalho"));
  assert.ok(pagina.includes("descricaoDosFiltros(areaDoRelatorio, filtrosArea"));
  assert.ok(pagina.includes("periodoDaArea(areaDoRelatorio).referencia"));
  assert.ok(pagina.includes("cabecalho: cabecalhoDoRelatorio"));
  // Imprimir, PDF e Excel continuam os três do padrão.
  assert.ok(pagina.includes("imprimirRelatorio"));
  assert.ok(pagina.includes("gerarPdfRelatorio"));
  assert.ok(pagina.includes("exportarExcelRelatorio"));
});

test("os filtros da área usam o painel recolhível já existente", () => {
  const componente = semComentarios(ler("src/components/relatorios/FiltrosRelatorioArea.jsx"));
  assert.ok(componente.includes('from "../comuns/PainelFiltros"'));
  assert.ok(componente.includes("<PainelFiltros"));
  const pagina = semComentarios(ler("src/pages/Relatorios.jsx"));
  assert.ok(pagina.includes("<FiltrosRelatorioArea"));
  // O painel de período dos relatórios que já tinham data continua onde estava.
  assert.ok(pagina.includes("relatorio.temPeriodo && ("));
});

test("os relatórios que já existiam continuam iguais", () => {
  const anteriores = RELATORIOS.filter((r) => r.categoria !== "areas");
  assert.deepEqual(
    anteriores.map((r) => r.id),
    [
      "saldos-bancarios",
      "saldos-por-secretaria",
      "saldos-por-banco",
      "consolidado-financeiro",
      "relacao-fornecedores",
      "fornecedores-por-secretaria",
      "fornecedores-por-periodo",
      "fornecedores-ativos-inativos",
      "iss-retido",
      "irpj-retido",
      "retencoes-tributarias",
      "pendencias-tributarias",
      "atividades-por-usuario",
      "tarefas-por-funcionario",
      "tarefas-concluidas",
      "tarefas-pendentes",
      "alteracoes-realizadas",
      "aprovacoes",
      "certidoes-por-fornecedor",
      "certidoes-vencidas",
      "certidoes-a-vencer",
      "documentacao-fornecedores",
      "certidoes-por-secretaria",
    ],
  );
  // Nenhum deles ganhou área, filtro de área ou dependência da nova base.
  anteriores.forEach((r) => {
    assert.equal(r.area, undefined);
    assert.notEqual(r.base, "areas");
  });
  // As categorias de antes seguem na mesma ordem, e a nova entrou no fim.
  assert.deepEqual(
    CATEGORIAS.map((c) => c.id),
    ["financeiro", "fornecedores", "tributario", "usuarios", "auditoria", "certidoes", "areas"],
  );
});

test("os relatórios de antes não mudam de resultado por causa dos filtros de área", () => {
  const fornecedores = {
    fornecedores: [
      {
        id: 1,
        razao_social: "Alfa Estruturas e Eventos ME",
        cpf_cnpj: "98.765.432/0001-11",
        secretaria: "Secretaria de Cultura",
        situacao: "Ativo",
        cadastro: "2026-02-01",
      },
    ],
  };
  const relatorio = relatorioPorId("fornecedores-por-secretaria");
  const sem = gerarRelatorio(relatorio, fornecedores, {});
  const com = gerarRelatorio(relatorio, { ...fornecedores, ...bases() }, {
    filtrosArea: { fornecedor: "alfa", periodoInicio: "2026-01-01" },
  });
  assert.deepEqual(com, sem);
});

/**
 * O código sem os comentários: as verificações de ausência têm de olhar o
 * código, não a explicação (vários comentários deste envio falam justamente do
 * que NÃO é feito).
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linha) => linha.replace(/(^|\s)(\/\/|--).*$/, ""))
    .join("\n");
}

/* -------------------------------------------------------------------------
 * Os relatórios não escrevem nada
 * ---------------------------------------------------------------------- */

test("nada nos novos relatórios grava, apaga ou altera dados", () => {
  const arquivos = [
    "src/lib/relatoriosAreasFornecedores.js",
    "src/components/relatorios/FiltrosRelatorioArea.jsx",
  ];
  for (const caminho of arquivos) {
    const fonte = semComentarios(ler(caminho));
    assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(fonte), caminho);
  }
  // A base de relatório também é só leitura.
  const dados = semComentarios(ler("src/lib/relatoriosDados.js"));
  const trecho = dados.slice(dados.indexOf("export async function carregarBaseAreasFornecedores"));
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(trecho));
});
