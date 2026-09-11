import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// src/lib importa vizinhos sem o ".js" (o Vite resolve; o Node, não). O hook
// abaixo só completa a extensão quando a resolução falha, para que este teste
// exercite a relação de verdade, e não só o texto dela.
register("./fixtures/resolveSemExtensao.mjs", import.meta.url);

import XLSX from "xlsx";
import {
  AREAS,
  areaPorId,
  filtrarRegistros,
  filtrosVazios,
  totaisDaLista,
} from "../src/lib/areasFornecedores.js";
import {
  itensDaRelacaoDaArea,
  relacaoDaArea,
  linhasDoRelatorioDaArea,
  filtrosVaziosDoRelatorio,
} from "../src/lib/relatoriosAreasFornecedores.js";
import {
  ORDENS_DA_RELACAO,
  OPCOES_PADRAO_DA_RELACAO,
  definicaoDaRelacao,
  montarRelacaoDeValores,
  relacaoDisponivel,
  relacaoDoResultado,
} from "../src/lib/relacaoDeValores.js";
import { formatBRL } from "../src/lib/moeda.js";

// relatoriosCabecalho.js e o catálogo importam vizinhos sem extensão, então
// dependem do hook acima -- e por isso entram por importação dinâmica, depois
// dele (as estáticas são resolvidas antes do corpo do módulo).
const { MODOS_IMPRESSAO, MODO_IMPRESSAO_PADRAO, modoImpressao } = await import(
  "../src/lib/relatoriosCabecalho.js"
);
const { RELATORIOS, gerarRelatorio, relatorioPorId } = await import(
  "../src/lib/relatoriosCatalogo.js"
);
const {
  conteudoDoPdfDaRelacao,
  exportarExcelRelacaoDeValores,
  montarHtmlRelacaoDeValores,
} = await import("../src/lib/relacaoValoresDocumento.js");
const { montarHtmlRelatorio } = await import("../src/lib/relatoriosDocumento.js");

/**
 * A RELAÇÃO DE VALORES: o terceiro modo de impressão.
 *
 * O que este arquivo defende:
 *
 *   1. a relação sai nas quatro áreas (Todos os Fornecedores, Patrocínios,
 *      Aluguéis e Bandas);
 *   2. só DUAS colunas vão para o papel, para o PDF e para a planilha -- nada de
 *      CNPJ, secretaria, situação, certidão, dados bancários, NF, processo,
 *      evento, data ou observação;
 *   3. o total impresso bate exatamente com o que a tela da área mostra, porque
 *      o valor de cada item é o saldo calculado das baixas das NFs vinculadas;
 *   4. os filtros aplicados na tela são respeitados;
 *   5. as duas ordens (nome A-Z e maior valor primeiro) funcionam, e o recorte
 *      "somente com saldo em aberto" também;
 *   6. o PDF sai no mesmo formato da impressão;
 *   7. as opções de impressão que já existiam continuam funcionando.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const ler = (caminho) => readFileSync(join(RAIZ, caminho), "utf8");

/* -------------------------------------------------------------------------
 * Cenário: os mesmos registros que a tela de cada área receberia
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
    evento: "Evento nº 41 do calendário",
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
  }),
  registro({
    id: "p3",
    nome: "Patrocínio do Festival de Inverno",
    evento: "Festival de Inverno",
    valor: 8000,
    notas: [nota(8000, 8000)],
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

/** A relação como a TELA da área a monta: registros visíveis, na ordem pedida. */
function relacaoDaTela(areaId, { busca = "", filtros = {}, opcoes = {} } = {}) {
  const area = areaPorId(areaId);
  const visiveis = filtrarRegistros(area, REGISTROS[areaId], {
    busca,
    filtros: { ...filtrosVazios(area), ...filtros },
  });
  const definicao = relacaoDaArea(area);
  return {
    visiveis,
    totais: totaisDaLista(visiveis),
    relacao: montarRelacaoDeValores({
      titulo: `Relação de valores · ${area.rotulo}`,
      rotuloNome: definicao.rotuloNome,
      rotuloValor: definicao.rotuloValor,
      itens: itensDaRelacaoDaArea(area, visiveis),
      opcoes,
    }),
  };
}

/** A base da Central, com as três áreas liberadas. */
function bases() {
  return {
    areas: { permitidas: { patrocinios: true, alugueis: true, bandas: true }, registros: REGISTROS, secretarias: SECRETARIAS },
  };
}

function resultadoDaArea(areaId, filtros = {}) {
  const area = areaPorId(areaId);
  return gerarRelatorio(relatorioPorId(`area-${areaId}`), bases(), {
    filtrosArea: { ...filtrosVaziosDoRelatorio(area), ...filtros },
  });
}

/** As linhas <tr> do corpo do documento impresso. */
function linhasDoHtml(html) {
  const corpo = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  return [...corpo.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((achado) =>
    [...achado[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((celula) => celula[1]),
  );
}

/* -------------------------------------------------------------------------
 * 1. A relação sai nas quatro áreas
 * ---------------------------------------------------------------------- */

test("as três áreas de fornecedores têm a relação de duas colunas, cada uma com o seu nome", () => {
  assert.deepEqual(
    AREAS.map((area) => {
      const { nome, valor, rotuloNome, rotuloValor } = relacaoDaArea(area);
      return [area.id, nome, rotuloNome, valor, rotuloValor];
    }),
    [
      ["patrocinios", "nome", "Patrocínio", "saldo", "Saldo"],
      ["alugueis", "objetoDescricao", "Descrição do aluguel", "saldo", "Saldo"],
      ["bandas", "banda", "Banda / Artista", "saldo", "Saldo"],
    ],
  );

  // E os itens são só nome e valor: nenhuma outra chave viaja para o documento.
  for (const area of AREAS) {
    for (const item of itensDaRelacaoDaArea(area, REGISTROS[area.id])) {
      assert.deepEqual(Object.keys(item).sort(), ["nome", "valor"]);
    }
  }
});

test("Todos os Fornecedores oferece a relação com Fornecedor e Valor em Aberto", () => {
  const tela = ler("src/pages/Fornecedores.jsx");
  assert.match(tela, /<RelacaoDeValores/);
  assert.match(tela, /rotuloNome="Fornecedor"/);
  assert.match(tela, /rotuloValor="Valor em Aberto"/);
  // Os itens saem dos fornecedores VISÍVEIS, na ordem da tela.
  assert.match(tela, /itens=\{itensDaRelacaoDeValores\}/);
  assert.match(tela, /fornecedoresVisiveis\.map/);

  // A tela de cada área também recebe o bloco, com os itens dos visíveis.
  const daArea = ler("src/components/fornecedores/areas/PaginaAreaFornecedores.jsx");
  assert.match(daArea, /<RelacaoDeValores/);
  assert.match(daArea, /itensDaRelacaoDaArea\(area, visiveis\)/);
});

test("a Central de Relatórios oferece a relação como terceira opção de impressão", () => {
  assert.deepEqual(
    MODOS_IMPRESSAO.map((m) => m.rotulo),
    ["Relatório detalhado", "Relação compacta", "Relação de valores"],
  );
  // Os três relatórios de área declaram as duas colunas da relação.
  for (const relatorio of RELATORIOS.filter((r) => r.categoria === "areas")) {
    assert.equal(relatorio.relacao.valor, "saldo");
    assert.ok(relacaoDisponivel(resultadoDaArea(relatorio.area)));
  }
  // E o resultado gerado leva essa declaração para os documentos.
  assert.deepEqual(resultadoDaArea("bandas").relacao, { nome: "banda", rotuloNome: "Banda / Artista", valor: "saldo", rotuloValor: "Saldo" });
});

/* -------------------------------------------------------------------------
 * 2. Só duas colunas no papel
 * ---------------------------------------------------------------------- */

test("o documento impresso leva só as duas colunas, e nada do resto da ficha", () => {
  const { relacao } = relacaoDaTela("patrocinios");
  const html = montarHtmlRelacaoDeValores({ relacao, geradoEm: "11/09/2026 10:30" });

  // Duas colunas declaradas, dois cabeçalhos, duas células por linha.
  assert.equal([...html.matchAll(/<col /g)].length, 2);
  assert.deepEqual(
    [...html.matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/g)].map((a) => a[1]),
    ["Patrocínio", "Saldo"],
  );
  for (const linha of linhasDoHtml(html)) assert.equal(linha.length, 2);

  // Nada mais da ficha aparece: nem coluna, nem dado, nem botão.
  for (const proibido of [
    "12.345.678/0001-99",
    "98.765.432/0001-11",
    "Secretaria de Cultura",
    "Zeta Produções",
    "Evento nº 41 do calendário",
    "Vigente",
    "<button",
    "<svg",
    "CNPJ",
    "Situação",
    "Certidão",
    "PIX",
    "Processo",
    "Observação",
  ]) {
    assert.ok(!html.includes(proibido), proibido);
  }

  // Cabeçalho curto: o nome da relação e a data de emissão, mais nada.
  assert.match(html, /<h1>Relação de valores · Patrocínios<\/h1>/);
  assert.match(html, /Emitido em 11\/09\/2026 10:30/);
  assert.ok(!html.includes("Filtros:"));
  assert.ok(!html.includes("Período:"));

  // Layout próprio: A4 retrato, margens reduzidas e contagem de páginas.
  assert.match(html, /@page \{\s*size: A4 portrait;\s*margin: 10mm 12mm;/);
  assert.match(html, /counter\(page\)/);

  // E o total destacado no fim, uma vez só.
  assert.equal([...html.matchAll(/<tfoot>/g)].length, 1);
  assert.match(html, new RegExp(`Total</td><td class="valor">${formatBRL(relacao.total).replace(/[.$  ]/g, ".")}`));
});

test("o PDF e a planilha levam as mesmas duas colunas", (t) => {
  const { relacao } = relacaoDaTela("alugueis");

  const conteudo = conteudoDoPdfDaRelacao(relacao);
  assert.deepEqual(conteudo.head, [["Descrição do aluguel", "Saldo"]]);
  assert.equal(conteudo.foot.length, 1);
  assert.equal(conteudo.foot[0][0], "TOTAL");
  for (const linha of [...conteudo.head, ...conteudo.body, ...conteudo.foot]) {
    assert.equal(linha.length, 2);
  }

  const pasta = mkdtempSync(join(tmpdir(), "relacao-"));
  t.after(() => rmSync(pasta, { recursive: true, force: true }));
  const arquivo = join(pasta, "relacao.xlsx");
  exportarExcelRelacaoDeValores({ relacao, arquivo });

  const planilha = XLSX.readFile(arquivo, { cellNF: true }).Sheets.Relacao;
  const linhas = XLSX.utils.sheet_to_json(planilha, { header: 1 });
  assert.deepEqual(linhas[0], ["Descrição do aluguel", "Saldo"]);
  for (const linha of linhas) assert.equal(linha.length, 2);
  assert.deepEqual(linhas[linhas.length - 1], ["TOTAL", relacao.total]);

  // Valor como NÚMERO com formato de moeda: a coluna soma no Excel.
  assert.equal(planilha.B2.t, "n");
  assert.equal(planilha.B2.z, "R$ #,##0.00");
  assert.equal(planilha[`B${linhas.length}`].t, "n");
});

/* -------------------------------------------------------------------------
 * 3. O total impresso é o total da tela
 * ---------------------------------------------------------------------- */

test("o total da relação é o saldo que a tela da área mostra", () => {
  for (const area of AREAS) {
    const { relacao, totais, visiveis } = relacaoDaTela(area.id);
    assert.equal(relacao.total, totais.saldo);
    assert.equal(relacao.registros, visiveis.length);
    // O saldo vem das baixas das NFs vinculadas, então não é o valor contratado.
    assert.notEqual(totais.saldo, totais.valor);
  }

  // Conferência em números fechados, para o caso de a soma mudar de caminho:
  // 3.800 (5.000 - 1.200) + 2.500 + 0 (8.000 quitado).
  assert.equal(relacaoDaTela("patrocinios").relacao.total, 6300);
  assert.equal(relacaoDaTela("alugueis").relacao.total, 30000);
  assert.equal(relacaoDaTela("bandas").relacao.total, 20000);
});

test("o total da relação do relatório é o mesmo do relatório na tela", () => {
  for (const area of AREAS) {
    const resultado = resultadoDaArea(area.id);
    const relacao = relacaoDoResultado(resultado, OPCOES_PADRAO_DA_RELACAO);
    assert.equal(relacao.total, resultado.totais.saldo);
    assert.equal(relacao.registros, resultado.registros);
  }
});

/* -------------------------------------------------------------------------
 * 4. Os filtros da tela são respeitados
 * ---------------------------------------------------------------------- */

test("a relação sai só com os registros que a tela está mostrando", () => {
  // Filtro de secretaria na tela da área.
  const porSecretaria = relacaoDaTela("patrocinios", { filtros: { secretaria: "4" } });
  assert.deepEqual(
    porSecretaria.relacao.itens.map((i) => i.nome),
    ["Patrocínio do Aniversário da Cidade"],
  );
  assert.equal(porSecretaria.relacao.total, porSecretaria.totais.saldo);
  assert.equal(porSecretaria.relacao.total, 2500);

  // Busca livre na tela.
  const porBusca = relacaoDaTela("bandas", { busca: "aurora" });
  assert.deepEqual(porBusca.relacao.itens.map((i) => i.nome), ["Banda Aurora"]);
  assert.equal(porBusca.relacao.total, porBusca.totais.saldo);

  // E, na Central, os filtros do relatório valem igual.
  const resultado = resultadoDaArea("patrocinios", { fornecedor: "alfa" });
  const relacao = relacaoDoResultado(resultado, OPCOES_PADRAO_DA_RELACAO);
  assert.deepEqual(relacao.itens.map((i) => i.nome), ["Patrocínio do Aniversário da Cidade"]);
  assert.equal(relacao.total, resultado.totais.saldo);
  assert.deepEqual(
    linhasDoRelatorioDaArea(areaPorId("patrocinios"), PATROCINIOS, { fornecedor: "alfa" }).map((l) => l.nome),
    relacao.itens.map((i) => i.nome),
  );
});

/* -------------------------------------------------------------------------
 * 5. Ordem e recorte de saldo em aberto
 * ---------------------------------------------------------------------- */

test("as duas ordens funcionam: nome A-Z e maior valor primeiro", () => {
  assert.deepEqual(ORDENS_DA_RELACAO.map((o) => o.id), ["nome", "valor"]);
  assert.equal(OPCOES_PADRAO_DA_RELACAO.ordem, "nome");

  const porNome = relacaoDaTela("patrocinios", { opcoes: { ordem: "nome" } }).relacao;
  assert.deepEqual(porNome.itens.map((i) => i.nome), [
    "Patrocínio da Festa do Padroeiro",
    "Patrocínio do Aniversário da Cidade",
    "Patrocínio do Festival de Inverno",
  ]);

  const porValor = relacaoDaTela("patrocinios", { opcoes: { ordem: "valor" } }).relacao;
  assert.deepEqual(porValor.itens.map((i) => i.valor), [3800, 2500, 0]);
  // Trocar a ordem não muda o total nem a quantidade de linhas.
  assert.equal(porValor.total, porNome.total);
  assert.equal(porValor.registros, porNome.registros);
});

test("a opção 'somente com saldo em aberto' tira o que já está quitado", () => {
  const completa = relacaoDaTela("patrocinios").relacao;
  const emAberto = relacaoDaTela("patrocinios", { opcoes: { somenteEmAberto: true } }).relacao;

  assert.equal(completa.registros, 3);
  assert.deepEqual(emAberto.itens.map((i) => i.nome), [
    "Patrocínio da Festa do Padroeiro",
    "Patrocínio do Aniversário da Cidade",
  ]);
  // Quem some é só o de saldo zero, então o total não muda.
  assert.equal(emAberto.total, completa.total);
  assert.equal(emAberto.somenteEmAberto, true);
  assert.equal(completa.somenteEmAberto, false);
});

/* -------------------------------------------------------------------------
 * 6. O PDF sai igual à impressão
 * ---------------------------------------------------------------------- */

test("PDF e impressão levam as mesmas linhas, na mesma ordem, com o mesmo total", () => {
  for (const area of AREAS) {
    for (const ordem of ["nome", "valor"]) {
      const { relacao } = relacaoDaTela(area.id, { opcoes: { ordem } });
      const html = montarHtmlRelacaoDeValores({ relacao });
      const conteudo = conteudoDoPdfDaRelacao(relacao);

      const doHtml = linhasDoHtml(html);
      assert.equal(doHtml.length, conteudo.body.length);
      doHtml.forEach((linha, indice) => {
        assert.equal(linha[0], conteudo.body[indice][0]);
        // O PDF usa a versão ASCII do "R$" (a fonte do PDF não tem o espaço fino).
        assert.equal(linha[1].replace(/[  ]/g, " "), conteudo.body[indice][1]);
      });
      assert.equal(
        html.slice(html.indexOf("<tfoot>")).includes(formatBRL(relacao.total)),
        true,
      );
      assert.equal(conteudo.foot[0][1].replace(/\s/g, ""), formatBRL(relacao.total).replace(/\s/g, ""));
    }
  }
});

/* -------------------------------------------------------------------------
 * 7. As opções de impressão que já existiam continuam iguais
 * ---------------------------------------------------------------------- */

test("os dois formatos antigos seguem com a mesma densidade e o mesmo padrão", () => {
  assert.deepEqual(
    MODOS_IMPRESSAO.map((m) => [m.id, m.maxPaginas, m.quebrarTexto]),
    [
      ["detalhada", 14, true],
      ["compacta", 3, false],
      ["valores", 14, false],
    ],
  );

  // O padrão continua sendo a compacta -- e quem imprime sem dizer o modo
  // (auditoria, baixas, certidões, histórico) continua caindo nela.
  assert.equal(MODO_IMPRESSAO_PADRAO, "compacta");
  assert.equal(modoImpressao(undefined).id, "compacta");
  assert.equal(modoImpressao("inexistente").id, "compacta");
  assert.equal(modoImpressao("detalhada").id, "detalhada");
  assert.equal(modoImpressao("valores").duasColunas, true);
});

test("os documentos detalhado e compacto continuam levando todas as colunas", () => {
  const resultado = resultadoDaArea("bandas");
  const cabecalho = {
    instituicao: "Secretaria de Finanças",
    relatorio: resultado.nome,
    periodo: "",
    filtros: "",
    geradoEm: "11/09/2026 10:30",
    usuario: "",
  };

  for (const modo of ["compacta", "detalhada"]) {
    const html = montarHtmlRelatorio({ titulo: resultado.nome, resultado, cabecalho, modo });
    for (const coluna of resultado.colunas) assert.ok(html.includes(coluna.label), `${modo}/${coluna.label}`);
    assert.ok(html.includes("Total geral"));
  }

  // Com o modo da relação, o mesmo relatório sai com duas colunas -- e só.
  const daRelacao = montarHtmlRelatorio({
    titulo: resultado.nome,
    resultado,
    cabecalho,
    modo: "valores",
    relacao: { ordem: "valor" },
  });
  assert.equal([...daRelacao.matchAll(/<col /g)].length, 2);
  assert.ok(!daRelacao.includes("Secretaria"));
  assert.ok(daRelacao.includes("Banda / Artista"));
});

test("um relatório sem as duas colunas não oferece a relação e imprime como sempre", () => {
  // Sem coluna de texto ou sem coluna de dinheiro, a relação não existe.
  assert.equal(definicaoDaRelacao({ colunas: [] }), null);
  assert.equal(
    definicaoDaRelacao({ colunas: [{ chave: "nome", label: "Nome" }] }),
    null,
  );
  assert.equal(relacaoDisponivel({ colunas: [{ chave: "valor", label: "Valor", tipo: "moeda", somavel: true }] }), false);

  // Quando existe sem estar declarada, sai a primeira coluna de texto com a
  // coluna do total do relatório.
  assert.deepEqual(
    definicaoDaRelacao({
      colunas: [
        { chave: "banco", label: "Banco" },
        { chave: "saldo", label: "Saldo", tipo: "moeda", somavel: true },
      ],
      campoTotal: "saldo",
    }),
    { nome: "banco", valor: "saldo", rotuloNome: "Banco", rotuloValor: "Saldo" },
  );

  // E pedir a relação para um relatório que não a tem devolve o documento no
  // formato padrão, com todas as colunas.
  const semRelacao = {
    nome: "Só números",
    colunas: [{ chave: "quantidade", label: "Quantidade", tipo: "numero", somavel: true }],
    campoTotal: null,
    grupos: [{ nome: "", linhas: [{ quantidade: 3 }], totais: { quantidade: 3 } }],
    registros: 1,
    totais: { quantidade: 3 },
  };
  assert.equal(relacaoDoResultado(semRelacao, {}), null);
  const html = montarHtmlRelatorio({
    titulo: semRelacao.nome,
    resultado: semRelacao,
    cabecalho: { relatorio: semRelacao.nome, geradoEm: "11/09/2026 10:30" },
    modo: "valores",
  });
  assert.ok(html.includes("Quantidade"));
});

/* -------------------------------------------------------------------------
 * A relação não mexe em nada: nem em dado, nem em saldo
 * ---------------------------------------------------------------------- */

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

test("nada da relação de valores grava, apaga ou altera dados", () => {
  const arquivos = [
    "src/lib/relacaoDeValores.js",
    "src/lib/relacaoValoresDocumento.js",
    "src/lib/impressaoNavegador.js",
    "src/components/relatorios/RelacaoDeValores.jsx",
    "src/components/relatorios/OpcoesRelacaoValores.jsx",
  ];
  for (const caminho of arquivos) {
    const fonte = semComentarios(ler(caminho));
    assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(fonte), caminho);
    assert.ok(!/supabase/.test(fonte), caminho);
  }

  // O cálculo da relação é puro: nem banco, nem documento, nem valor gravado em
  // paralelo -- o saldo vem sempre das baixas das NFs vinculadas.
  const puro = semComentarios(ler("src/lib/relacaoDeValores.js"));
  assert.ok(!/valor_pago|registro\.pago/.test(puro));
  assert.ok(!/jspdf|xlsx|document\./.test(puro));
});
