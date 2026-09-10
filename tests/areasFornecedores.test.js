import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  AREAS,
  MODULOS_AREAS,
  SITUACOES_AREA,
  areaPorRota,
  areasVisiveis,
  diferencaParaAuditoria,
  filtrarRegistros,
  filtrosVazios,
  registroParaBanco,
  registroParaFormulario,
  registroVazio,
  resolverPermissoesAreas,
  resumoFinanceiroDoRegistro,
  totaisDaLista,
  totalFiltrosAtivos,
  validarRegistro,
} from "../src/lib/areasFornecedores.js";
import { valorBaixadoDaNota, valorEmAbertoDaNota } from "../src/lib/regrasBaixas.js";

/**
 * As três áreas específicas dentro de Fornecedores: Patrocínios, Aluguéis e
 * Bandas.
 *
 * O que este arquivo defende, e que nenhuma outra parte da suíte defende:
 *
 *   1. as áreas NÃO são categorias nem tipo de fornecedor -- o registro aponta
 *      para um cadastro que já existe, e o mesmo fornecedor aparece nas três
 *      sem nunca ser recadastrado;
 *   2. Pago e Saldo são CALCULADOS a partir das baixas das NFs vinculadas, com
 *      a mesma função que a aba de Baixas usa, e não existe coluna de valor
 *      pago em lugar nenhum destas áreas;
 *   3. "Todos os Fornecedores" (a página de Fornecedores) continua idêntica, sem
 *      navegação própria: quem navega entre as áreas é o submenu do menu
 *      lateral, e a faixa de subabas do topo não existe mais.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const ler = (caminho) => readFileSync(join(RAIZ, caminho), "utf8");

/**
 * O código sem os comentários.
 *
 * Vários comentários deste envio existem justamente para explicar o que NÃO foi
 * feito ("não há coluna de valor pago", "as áreas são Patrocínios, Aluguéis e
 * Bandas"). Uma verificação de ausência tem de olhar o código, não a explicação.
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linha) => linha.replace(/(^|\s)(\/\/|--).*$/, ""))
    .join("\n");
}

const MIGRATION = "supabase/migrations/20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql";

const FORNECEDOR = {
  id: 7,
  razao_social: "Produções Artísticas São José LTDA",
  nome_fantasia: "SJ Produções",
  apelido: "Zé Produções",
  cpf_cnpj: "12.345.678/0001-99",
};

function registro(area, extras = {}) {
  return {
    id: `r-${Math.random()}`,
    fornecedor_id: FORNECEDOR.id,
    fornecedores: FORNECEDOR,
    secretaria_id: 2,
    secretarias: { nome: "Secretaria de Cultura" },
    valor: 10000,
    situacao: "vigente",
    ativo: true,
    notas: [],
    ...extras,
  };
}

/* -------------------------------------------------------------------------
 * As três áreas e a estrutura delas
 * ---------------------------------------------------------------------- */

test("são exatamente três áreas, e nenhuma delas é categoria de fornecedor", () => {
  assert.deepEqual(
    AREAS.map((area) => area.id),
    ["patrocinios", "alugueis", "bandas"],
  );
  assert.deepEqual(MODULOS_AREAS, ["patrocinios", "alugueis", "bandas"]);

  // Nenhuma área declara campo de categoria/tipo: o que existe é a estrutura
  // própria do registro.
  for (const area of AREAS) {
    for (const campo of area.campos) {
      assert.ok(
        !["categoria", "tipo", "tipo_fornecedor", "categoria_fornecedor"].includes(campo.chave),
        `${area.id} não pode ter campo ${campo.chave}`,
      );
    }
  }
});

test("cada área tem o botão, os campos e as colunas que o comando pede", () => {
  const [patrocinios, alugueis, bandas] = AREAS;

  assert.equal(patrocinios.rotuloNovo, "Novo Patrocínio");
  assert.deepEqual(
    patrocinios.campos.map((c) => c.chave),
    ["nome", "evento", "secretaria_id", "valor", "observacoes", "situacao"],
  );
  assert.deepEqual(
    patrocinios.colunas.map((c) => c.chave),
    ["fornecedor", "apelido", "nome", "secretaria", "valor", "pago", "saldo", "situacao", "acoes"],
  );

  assert.equal(alugueis.rotuloNovo, "Novo Aluguel");
  assert.deepEqual(
    alugueis.campos.map((c) => c.chave),
    [
      "descricao",
      "objeto",
      "secretaria_id",
      "valor",
      "valor_mensal",
      "data_inicio",
      "data_fim",
      "observacoes",
      "situacao",
    ],
  );
  assert.deepEqual(
    alugueis.colunas.map((c) => c.chave),
    [
      "fornecedor",
      "apelido",
      "objetoDescricao",
      "secretaria",
      "valor",
      "pago",
      "saldo",
      "situacao",
      "acoes",
    ],
  );
  // "Objeto alugado" é descritivo DESTE aluguel: texto livre com sugestões, e
  // não uma lista fechada que viraria categoria global.
  const objeto = alugueis.campos.find((c) => c.chave === "objeto");
  assert.equal(objeto.tipo, "sugestoes");
  assert.deepEqual(objeto.sugestoes, ["Imóvel", "Veículo", "Equipamento", "Estrutura", "Outro"]);

  assert.equal(bandas.rotuloNovo, "Nova Contratação");
  assert.deepEqual(
    bandas.campos.map((c) => c.chave),
    ["banda", "evento", "data_apresentacao", "secretaria_id", "valor", "observacoes", "situacao"],
  );
  // Banda/Artista é a PRIMEIRA coluna da listagem de Bandas.
  assert.equal(bandas.colunas[0].chave, "banda");
  assert.deepEqual(
    bandas.colunas.map((c) => c.chave),
    [
      "banda",
      "fornecedor",
      "apelido",
      "evento",
      "secretaria",
      "valor",
      "pago",
      "saldo",
      "situacao",
      "acoes",
    ],
  );
});

test("nenhuma área tem campo, coluna ou gravação de valor pago", () => {
  for (const area of AREAS) {
    assert.ok(
      !area.campos.some((campo) => /pago/i.test(campo.chave)),
      `${area.id} não pode ter campo de valor pago`,
    );
    const linha = registroParaBanco(area, {
      ...registroVazio(area),
      fornecedor_id: "7",
      valor: 1000,
    });
    for (const chave of Object.keys(linha)) {
      assert.ok(!/pago|saldo/i.test(chave), `${area.id} gravaria ${chave}, que é calculado`);
    }
  }
});

test("os filtros de cada área são os que o comando pede", () => {
  const chaves = (id) => AREAS.find((a) => a.id === id).filtros.map((f) => f.chave);
  assert.deepEqual(chaves("patrocinios"), ["fornecedor", "apelido", "secretaria", "situacao", "valor"]);
  assert.deepEqual(chaves("alugueis"), ["fornecedor", "secretaria", "objeto", "situacao", "valor"]);
  assert.deepEqual(chaves("bandas"), [
    "banda",
    "fornecedor",
    "apelido",
    "evento",
    "secretaria",
    "situacao",
    "valor",
  ]);
});

test("a rota resolve a área, e a rota vazia é a aba Todos", () => {
  assert.equal(areaPorRota("")?.id, undefined);
  assert.equal(areaPorRota(undefined), null);
  assert.equal(areaPorRota("patrocinios").id, "patrocinios");
  assert.equal(areaPorRota("BANDAS").id, "bandas");
  assert.equal(areaPorRota("inventada"), null);
});

/* -------------------------------------------------------------------------
 * Um fornecedor, vários registros, um único cadastro
 * ---------------------------------------------------------------------- */

test("o mesmo fornecedor tem dois patrocínios, um aluguel e três bandas sem duplicar o cadastro", () => {
  const [patrocinios, alugueis, bandas] = AREAS;

  const registros = [
    registroParaBanco(patrocinios, { fornecedor_id: "7", nome: "Patrocínio Festa de São José", valor: 5000, situacao: "vigente" }),
    registroParaBanco(patrocinios, { fornecedor_id: "7", nome: "Patrocínio Festa do Padroeiro", valor: 3000, situacao: "vigente" }),
    registroParaBanco(alugueis, { fornecedor_id: "7", descricao: "Aluguel de imóvel — Secretaria de Saúde", objeto: "Imóvel", valor: 24000, situacao: "vigente" }),
    registroParaBanco(bandas, { fornecedor_id: "7", banda: "Trio Pé de Serra", valor: 8000, situacao: "vigente" }),
    registroParaBanco(bandas, { fornecedor_id: "7", banda: "Forró da Serra", valor: 12000, situacao: "vigente" }),
    registroParaBanco(bandas, { fornecedor_id: "7", banda: "Zabumba Real", valor: 9000, situacao: "vigente" }),
  ];

  // Seis registros operacionais, UM fornecedor -- sempre o mesmo id.
  assert.equal(new Set(registros.map((r) => r.fornecedor_id)).size, 1);
  assert.equal(registros[0].fornecedor_id, 7);
  // E nenhum deles carrega dado de cadastro do fornecedor: só o vínculo.
  for (const linha of registros) {
    for (const chave of ["razao_social", "cpf_cnpj", "nome_fantasia", "apelido", "categoria", "tipo"]) {
      assert.ok(!(chave in linha), `o registro não pode gravar ${chave}`);
    }
  }
});

test("o nome artístico da banda não precisa ser igual à razão social", () => {
  const bandas = AREAS[2];
  const linha = registroParaBanco(bandas, {
    fornecedor_id: "7",
    banda: "Trio Pé de Serra",
    evento: "Festa de São José",
  });
  assert.equal(linha.banda, "Trio Pé de Serra");
  assert.notEqual(linha.banda, FORNECEDOR.razao_social);
  // O nome artístico é do registro; o cadastro segue com a razão social dele.
  assert.ok(!("razao_social" in linha));
});

/* -------------------------------------------------------------------------
 * Pago e Saldo -- calculados a partir das baixas das NFs
 * ---------------------------------------------------------------------- */

test("sem NF vinculada, Pago é zero e Saldo é o valor total", () => {
  const resumo = resumoFinanceiroDoRegistro(registro(AREAS[0], { valor: 10000, notas: [] }));
  assert.deepEqual(
    { valor: resumo.valor, pago: resumo.pago, saldo: resumo.saldo },
    { valor: 10000, pago: 0, saldo: 10000 },
  );
});

test("Pago é a soma das baixas das NFs vinculadas, com o mesmo número da aba de Baixas", () => {
  const notas = [
    { id: 55, valor: 6000, valor_pago: 2500 },
    { id: 56, valor: 4000, valor_pago: 4000 },
  ];
  const resumo = resumoFinanceiroDoRegistro(registro(AREAS[0], { valor: 10000, notas }));

  // O Pago da área é exatamente o que valorBaixadoDaNota devolve nota por nota
  // -- a MESMA função que a aba de Baixas usa na linha da nota.
  const pagoPelaAbaDeBaixas = notas.reduce((soma, nota) => soma + valorBaixadoDaNota(nota), 0);
  assert.equal(resumo.pago, pagoPelaAbaDeBaixas);
  assert.equal(resumo.pago, 6500);
  assert.equal(resumo.saldo, 3500);

  // E o em aberto de cada nota continua sendo o da aba de Baixas: a área não
  // interfere no cálculo da nota.
  assert.equal(valorEmAbertoDaNota(notas[0]), 3500);
  assert.equal(valorEmAbertoDaNota(notas[1]), 0);
});

test("Saldo negativo aparece como é, quando as baixas passam do valor do registro", () => {
  const resumo = resumoFinanceiroDoRegistro(
    registro(AREAS[0], { valor: 1000, notas: [{ id: 1, valor: 3000, valor_pago: 3000 }] }),
  );
  assert.equal(resumo.pago, 3000);
  assert.equal(resumo.saldo, -2000);
});

test("os totais da listagem somam valor, pago e saldo dos registros visíveis", () => {
  const lista = [
    registro(AREAS[0], { valor: 1000, notas: [{ id: 1, valor: 1000, valor_pago: 250 }] }),
    registro(AREAS[0], { valor: 2000, notas: [] }),
  ];
  assert.deepEqual(totaisDaLista(lista), { registros: 2, valor: 3000, pago: 250, saldo: 2750 });
});

/* -------------------------------------------------------------------------
 * Busca e filtros
 * ---------------------------------------------------------------------- */

test("a busca rápida encontra por fornecedor, apelido, nome do registro e CPF/CNPJ", () => {
  const patrocinios = AREAS[0];
  const lista = [
    registro(patrocinios, { id: "a", nome: "Patrocínio Festa de São José" }),
    registro(patrocinios, {
      id: "b",
      nome: "Patrocínio Corrida da Cidade",
      fornecedores: { id: 9, razao_social: "Esportes Beta ME", cpf_cnpj: "98.765.432/0001-11" },
    }),
  ];
  const ids = (termo) => filtrarRegistros(patrocinios, lista, { busca: termo }).map((r) => r.id);

  assert.deepEqual(ids("sao jose"), ["a"], "acento não pode importar");
  assert.deepEqual(ids("ZÉ PRODUÇÕES"), ["a"], "o apelido também é procurado");
  assert.deepEqual(ids("98765"), ["b"], "trecho do CNPJ encontra");
  assert.deepEqual(ids("corrida"), ["b"]);
  assert.deepEqual(ids("").length, 2);
});

test("os filtros da área combinam entre si e com a busca", () => {
  const bandas = AREAS[2];
  const lista = [
    registro(bandas, { id: "a", banda: "Trio Pé de Serra", evento: "São José", valor: 8000, situacao: "vigente" }),
    registro(bandas, { id: "b", banda: "Forró da Serra", evento: "Aniversário", valor: 20000, situacao: "previsto" }),
    registro(bandas, {
      id: "c",
      banda: "Zabumba Real",
      evento: "São José",
      valor: 15000,
      situacao: "vigente",
      secretaria_id: 3,
      secretarias: { nome: "Secretaria de Esportes" },
    }),
  ];

  const filtrar = (filtros, busca = "") =>
    filtrarRegistros(bandas, lista, { busca, filtros: { ...filtrosVazios(bandas), ...filtros } }).map(
      (r) => r.id,
    );

  assert.deepEqual(filtrar({ situacao: "vigente" }).sort(), ["a", "c"]);
  assert.deepEqual(filtrar({ secretaria: "3" }), ["c"]);
  assert.deepEqual(filtrar({ evento: "sao jose", secretaria: "2" }), ["a"]);
  assert.deepEqual(filtrar({ valorMin: "10000" }).sort(), ["b", "c"]);
  assert.deepEqual(filtrar({ valorMin: "10000", valorMax: "16000" }), ["c"]);
  assert.deepEqual(filtrar({ situacao: "vigente" }, "zabumba"), ["c"]);

  assert.equal(totalFiltrosAtivos(bandas, filtrosVazios(bandas)), 0);
  assert.equal(
    totalFiltrosAtivos(bandas, { ...filtrosVazios(bandas), situacao: "vigente", valorMin: "10" }),
    2,
  );
});

test("a listagem de Bandas ordena pela banda; as outras, pelo fornecedor", () => {
  const bandas = AREAS[2];
  const ordenadas = filtrarRegistros(bandas, [
    registro(bandas, { id: "z", banda: "Zabumba Real" }),
    registro(bandas, { id: "f", banda: "Forró da Serra" }),
    registro(bandas, { id: "t", banda: "Trio Pé de Serra" }),
  ]).map((r) => r.id);
  assert.deepEqual(ordenadas, ["f", "t", "z"]);

  const patrocinios = AREAS[0];
  const porFornecedor = filtrarRegistros(patrocinios, [
    registro(patrocinios, { id: "b", nome: "B", fornecedores: { id: 2, razao_social: "Beta" } }),
    registro(patrocinios, { id: "a", nome: "A", fornecedores: { id: 1, razao_social: "Alfa" } }),
  ]).map((r) => r.id);
  assert.deepEqual(porFornecedor, ["a", "b"]);
});

/* -------------------------------------------------------------------------
 * Formulário, situações e auditoria
 * ---------------------------------------------------------------------- */

test("o fornecedor é obrigatório e sempre vem de um cadastro existente", () => {
  for (const area of AREAS) {
    const vazio = registroVazio(area);
    assert.equal(vazio.fornecedor_id, "");
    assert.equal(vazio.situacao, "vigente");

    const semFornecedor = validarRegistro(area, { ...vazio, [area.campoTitulo]: "Qualquer coisa" });
    assert.equal(semFornecedor.ok, false);
    assert.equal(semFornecedor.campo, "fornecedor_id");

    const semTitulo = validarRegistro(area, { ...vazio, fornecedor_id: "7" });
    assert.equal(semTitulo.ok, false);
    assert.equal(semTitulo.campo, area.campoTitulo);

    const completo = validarRegistro(area, {
      ...vazio,
      fornecedor_id: "7",
      [area.campoTitulo]: "Qualquer coisa",
    });
    assert.equal(completo.ok, true);
  }
});

test("vincular NF nunca é obrigatório para cadastrar", () => {
  for (const area of AREAS) {
    const conferido = validarRegistro(area, {
      ...registroVazio(area),
      fornecedor_id: "7",
      [area.campoTitulo]: "Registro sem NF",
    });
    assert.equal(conferido.ok, true, `${area.id} não pode exigir NF no cadastro`);
    const linha = registroParaBanco(area, {
      ...registroVazio(area),
      fornecedor_id: "7",
      [area.campoTitulo]: "Registro sem NF",
    });
    assert.ok(!("valor_em_aberto_id" in linha), "o registro não guarda NF nenhuma");
  }
});

test("a data de término não pode ser anterior à de início no aluguel", () => {
  const alugueis = AREAS[1];
  const base = { ...registroVazio(alugueis), fornecedor_id: "7", descricao: "Aluguel de veículo" };
  assert.equal(validarRegistro(alugueis, { ...base, data_inicio: "2026-01-10", data_fim: "2026-01-09" }).ok, false);
  assert.equal(validarRegistro(alugueis, { ...base, data_inicio: "2026-01-10", data_fim: "2026-01-10" }).ok, true);
  assert.equal(validarRegistro(alugueis, { ...base, data_inicio: "2026-01-10" }).ok, true, "término é opcional");
});

test("nenhuma situação da área significa pagamento", () => {
  const valores = SITUACOES_AREA.map((s) => s.value);
  assert.deepEqual(valores, ["previsto", "vigente", "concluido", "suspenso", "cancelado"]);
  for (const valor of valores) {
    assert.ok(!/pago|pagamento/i.test(valor), `${valor} não pode significar pago`);
  }
});

test("editar um registro já gravado devolve o formulário com os valores dele", () => {
  const alugueis = AREAS[1];
  const gravado = registro(alugueis, {
    descricao: "Aluguel de imóvel — Secretaria de Saúde",
    objeto: "Imóvel",
    valor_mensal: 2000,
    data_inicio: "2026-01-01T00:00:00",
    data_fim: null,
  });
  const formulario = registroParaFormulario(alugueis, gravado);
  assert.equal(formulario.fornecedor_id, "7");
  assert.equal(formulario.descricao, "Aluguel de imóvel — Secretaria de Saúde");
  assert.equal(formulario.data_inicio, "2026-01-01");
  assert.equal(formulario.data_fim, "");
});

test("a auditoria guarda só o que mudou, com antes e depois", () => {
  const patrocinios = AREAS[0];
  const antes = { fornecedor_id: 7, nome: "Patrocínio Festa", valor: 5000, situacao: "vigente" };

  assert.equal(diferencaParaAuditoria(patrocinios, antes, { ...antes }), null);

  const mudanca = diferencaParaAuditoria(patrocinios, antes, {
    ...antes,
    valor: 7000,
    situacao: "concluido",
  });
  assert.deepEqual(mudanca.antes, { valor: 5000, situacao: "vigente" });
  assert.deepEqual(mudanca.depois, { valor: 7000, situacao: "concluido" });
  assert.ok(!("nome" in mudanca.antes), "o que não mudou fica fora");
});

/* -------------------------------------------------------------------------
 * Permissões
 * ---------------------------------------------------------------------- */

test("quem não tem visualizar na área não vê o item dela no submenu", () => {
  const permissoes = resolverPermissoesAreas({
    linhas: [
      { modulo: "patrocinios", pode_visualizar: true, pode_cadastrar: true, pode_editar: false, pode_excluir: false },
      { modulo: "alugueis", pode_visualizar: false, pode_cadastrar: true, pode_editar: true, pode_excluir: true },
    ],
  });

  assert.deepEqual(permissoes.patrocinios, {
    visualizar: true,
    criar: true,
    editar: false,
    inativar: false,
  });
  assert.equal(permissoes.alugueis.visualizar, false);
  assert.deepEqual(permissoes.bandas, { visualizar: false, criar: false, editar: false, inativar: false });

  assert.deepEqual(
    areasVisiveis(permissoes).map((a) => a.id),
    ["patrocinios"],
  );
});

test("linha existente com tudo em falso é negativa, e não herda de Fornecedores", () => {
  const permissoes = resolverPermissoesAreas({
    linhas: [
      { modulo: "fornecedores", pode_visualizar: true, pode_cadastrar: true, pode_editar: true, pode_excluir: true },
      { modulo: "bandas", pode_visualizar: false, pode_cadastrar: false, pode_editar: false, pode_excluir: false },
    ],
  });
  assert.equal(permissoes.bandas.visualizar, false, "a decisão de quem administra vale");
  // Sem linha própria, a área herda o que a pessoa já tem em Fornecedores.
  assert.equal(permissoes.patrocinios.visualizar, true);
  assert.equal(permissoes.alugueis.inativar, true);
});

test("sem acesso a Fornecedores e sem linha da área, nada é liberado", () => {
  const permissoes = resolverPermissoesAreas({ linhas: [] });
  for (const area of AREAS) {
    assert.deepEqual(permissoes[area.id], {
      visualizar: false,
      criar: false,
      editar: false,
      inativar: false,
    });
  }
});

test("as três áreas entram na Matriz de Permissões com as ações próprias", () => {
  // A camada de permissões fala com o Supabase, então o que se confere aqui é
  // a fonte: os três módulos entraram, e os que já existiam ficaram como eram.
  const fonte = ler("src/lib/permissoesUsuario.js");

  for (const modulo of MODULOS_AREAS) {
    assert.ok(
      new RegExp(`\\{ id: "${modulo}", label: "[^"]+" \\}`).test(fonte),
      `${modulo} precisa aparecer na Matriz de Permissões`,
    );
  }
  assert.match(fonte, /MODULOS_AREAS_FORNECEDORES = \["patrocinios", "alugueis", "bandas"\]/);
  assert.match(fonte, /ACOES_AREAS_FORNECEDORES = \[/);
  assert.match(fonte, /campo: "pode_excluir", label: "Inativar"/);
  assert.match(fonte, /MODULOS_AREAS_FORNECEDORES\.includes\(modulo\)\) return ACOES_AREAS_FORNECEDORES/);

  // Os módulos que já existiam continuam listados e com os rótulos que tinham.
  for (const modulo of [
    "saldos",
    "fornecedores",
    "pagamentos",
    "baixas",
    "tributario",
    "certidoes",
    "relatorios",
    "auditoria",
    "administracao",
    "tarefas",
    "backup",
  ]) {
    assert.ok(fonte.includes(`{ id: "${modulo}", label:`), `o módulo ${modulo} não pode sair da lista`);
  }
  assert.match(fonte, /campo: "pode_cadastrar", label: "Registrar baixa"/);
  assert.match(fonte, /campo: "pode_cadastrar", label: "Gerar backup manual"/);
  assert.match(fonte, /campo: "pode_excluir", label: "Desativar \/ reativar conta bancária"/);
});

test("a trilha de auditoria sabe nomear os módulos e as ações das áreas", () => {
  const fonte = ler("src/lib/auditoria.js");
  for (const modulo of ["patrocinios", "alugueis", "bandas"]) {
    assert.ok(new RegExp(`^  ${modulo}: "`, "m").test(fonte), `a auditoria precisa nomear ${modulo}`);
  }
  for (const acao of [
    "inativou",
    "reativou",
    "alterou_valor_situacao",
    "vinculou_nota",
    "desvinculou_nota",
  ]) {
    assert.ok(new RegExp(`^  ${acao}: "`, "m").test(fonte), `a auditoria precisa nomear ${acao}`);
  }
  // As ações que já existiam continuam nomeadas.
  for (const acao of ["criou", "alterou", "registrou_baixa", "estornou_baixa"]) {
    assert.ok(new RegExp(`^  ${acao}: "`, "m").test(fonte), `${acao} não pode sair da trilha`);
  }
});

test("cada gravação nas áreas registra auditoria com antes e depois", () => {
  const fonte = ler("src/lib/areasFornecedoresDados.js");
  for (const acao of [
    "criou",
    "alterou",
    "alterou_valor_situacao",
    "inativou",
    "reativou",
    "vinculou_nota",
    "desvinculou_nota",
  ]) {
    assert.ok(fonte.includes(`"${acao}"`), `a área precisa auditar ${acao}`);
  }
  assert.ok(fonte.includes("valorAnterior"), "a auditoria precisa guardar o valor anterior");
  assert.ok(fonte.includes("valorNovo"), "a auditoria precisa guardar o valor novo");
  // Uma chamada de registrarEvento por gravação: criar, alterar, inativar (ou
  // reativar), vincular NF e desvincular NF. "alterou" e
  // "alterou_valor_situacao" saem da mesma chamada, como "inativou" e
  // "reativou" -- é a mesma gravação, com a ação escolhida pelo que mudou.
  assert.equal((fonte.match(/registrarEvento\(\{/g) ?? []).length, 5);
});

/* -------------------------------------------------------------------------
 * Não regressão: "Todos os Fornecedores" e o cadastro do fornecedor
 * ---------------------------------------------------------------------- */

test("a página de Fornecedores é a de sempre, sem navegação própria", () => {
  const fonte = ler("src/pages/Fornecedores.jsx");

  // Nenhuma prop de navegação: a página voltou à assinatura original, e a faixa
  // de subabas do topo não existe mais em lugar nenhum.
  assert.match(fonte, /export default function Fornecedores\(\) \{/);
  assert.ok(!fonte.includes("subabas"), "a faixa de subabas do topo foi removida");
  assert.equal(
    existsSync(join(RAIZ, "src/components/fornecedores/areas/SubabasFornecedores.jsx")),
    false,
    "o componente das subabas do topo não deve mais existir",
  );

  // Tudo o que a página tinha continua lá.
  for (const trecho of [
    "Total em aberto",
    "Novo Valor em Aberto",
    "Novo Fornecedor",
    "Filtros avançados",
    "Imprimir",
    "PDF",
    "Excel",
    'usePermissaoModulo("fornecedores")',
    "filtroVigentes",
  ]) {
    assert.ok(fonte.includes(trecho), `a aba Todos precisa continuar com: ${trecho}`);
  }

  // A página de Fornecedores não conhece as áreas: quem navega entre elas é o
  // menu lateral, por fora dela.
  const codigo = semComentarios(fonte).toLowerCase();
  for (const termo of ["patrocin", "alugue", "banda"]) {
    assert.ok(!codigo.includes(termo), `o código da aba Todos não deveria mencionar ${termo}`);
  }
  // E ela não importa nada das áreas.
  assert.ok(!fonte.includes("areasFornecedores"), "a página de Fornecedores não conhece as áreas");
});

test("nenhum campo de categoria ou tipo foi criado no cadastro do fornecedor", () => {
  const fonte = ler("src/pages/Fornecedores.jsx");
  // `tipo` já existia na tela como filtro de pessoa (física/jurídica): o que não
  // pode nascer é campo de categoria/tipo no CADASTRO do fornecedor.
  for (const proibido of [
    "categoria_fornecedor",
    "tipo_fornecedor",
    "categoria_id",
    "area_fornecedor",
    "fornecedor_categoria",
  ]) {
    assert.ok(!fonte.includes(proibido), `o cadastro do fornecedor não pode ganhar ${proibido}`);
  }

  // E as áreas nunca gravam no cadastro do fornecedor: elas só o leem.
  const dados = ler("src/lib/areasFornecedoresDados.js");
  for (const trecho of dados.split('from("fornecedores")').slice(1)) {
    for (const gravacao of [".update(", ".insert(", ".upsert(", ".delete("]) {
      assert.ok(
        !trecho.slice(0, 200).includes(gravacao),
        `as áreas não podem gravar no cadastro do fornecedor (${gravacao})`,
      );
    }
  }

  const migration = semComentarios(ler(MIGRATION));
  assert.ok(
    !/alter table\s+public\.fornecedores\b/i.test(migration),
    "a migration não pode alterar a tabela de fornecedores",
  );
});

test("as áreas ficam no submenu de Fornecedores, nunca como item principal", () => {
  const layout = ler("src/components/Layout.jsx");

  // A lista de itens principais do menu não pode ganhar linha nenhuma: as áreas
  // não ficam no nível de Saldos das Contas, Certidões, Pagamentos Diários,
  // Baixas de Pagamentos, Tarefas, Histórico, Relatórios, Auditoria e
  // Configurações.
  const itensPrincipais = layout.slice(
    layout.indexOf("const navItems = ["),
    layout.indexOf("];", layout.indexOf("const navItems = [")),
  );
  for (const termo of ["patrocinios", "alugueis", "bandas", "Patrocínios", "Aluguéis", "Bandas"]) {
    assert.ok(!itensPrincipais.includes(termo), `os itens principais não podem ganhar ${termo}`);
  }
  const rotas = [...itensPrincipais.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rotas.filter((rota) => rota.startsWith("/fornecedores")), ["/fornecedores"]);

  // O item de Fornecedores é expansível, e o submenu sai das áreas liberadas
  // pela permissão de cada uma -- quem não pode ver não recebe o item.
  assert.match(layout, /expansivel: true/);
  assert.ok(layout.includes("useAreasVisiveisNoMenu"), "o submenu respeita as permissões das áreas");
  assert.ok(layout.includes("Todos os Fornecedores"), "o submenu abre a página de Fornecedores");
  assert.ok(layout.includes("areas.map"), "as três áreas entram como opções do submenu");
  // Expande e recolhe, com o estado guardado para sobreviver à navegação.
  assert.ok(layout.includes("aria-expanded={expandido}"));
  assert.ok(layout.includes("CHAVE_FORNECEDORES_ABERTO"));

  // A navegação continua sendo por rota, as mesmas de antes.
  const app = ler("src/App.jsx");
  assert.match(app, /path="\/fornecedores"/);
  assert.match(app, /path="\/fornecedores\/:area"/);
});

test("as áreas não criam lógica de baixa nem tocam em saldo", () => {
  const fontes = [
    "src/lib/areasFornecedores.js",
    "src/lib/areasFornecedoresDados.js",
    "src/components/fornecedores/areas/PaginaAreaFornecedores.jsx",
    "src/components/fornecedores/areas/ModalRegistroArea.jsx",
    "src/components/fornecedores/areas/ModalNotasDoRegistro.jsx",
  ].map((caminho) => [caminho, ler(caminho)]);

  for (const [caminho, fonte] of fontes) {
    for (const proibido of [
      "registrar_baixa_nota",
      "estornar_baixa_nota",
      "pagamentos_baixas",
      "saldos_historico",
      "contas_bancarias",
      "pagamento_movimentacoes",
      "transferencias_contas",
      "saldo_atual",
    ]) {
      assert.ok(!fonte.includes(proibido), `${caminho} não deveria mencionar ${proibido}`);
    }
  }

  // A gravação da nota nunca acontece por aqui: valores_em_aberto só é lido.
  const dados = fontes.find(([caminho]) => caminho.endsWith("areasFornecedoresDados.js"))[1];
  const trechosDeNota = dados.split("valores_em_aberto");
  assert.ok(trechosDeNota.length > 1, "a leitura da nota precisa existir");
  for (const trecho of trechosDeNota.slice(1)) {
    const proximo = trecho.slice(0, 200);
    for (const gravacao of [".update(", ".insert(", ".upsert(", ".delete("]) {
      assert.ok(
        !proximo.includes(gravacao),
        `a nota não pode receber ${gravacao} nas áreas de Fornecedores`,
      );
    }
  }
});

test("a migration cria as seis tabelas e nenhuma coluna de valor pago", () => {
  const migration = ler(MIGRATION);

  for (const tabela of [
    "fornecedor_patrocinios",
    "fornecedor_alugueis",
    "fornecedor_bandas",
    "fornecedor_patrocinio_notas",
    "fornecedor_aluguel_notas",
    "fornecedor_banda_notas",
  ]) {
    assert.ok(migration.includes(tabela), `a migration precisa criar ${tabela}`);
  }

  // O comentário da migration explica por que não existe coluna de valor pago;
  // é o código dela que não pode criar nenhuma.
  assert.ok(
    !/valor_pago/.test(semComentarios(migration)),
    "nenhuma tabela das áreas pode ter valor_pago",
  );
  assert.ok(!/\bpago\s+numeric/.test(migration), "nenhuma coluna 'pago' pode ser gravada");
  assert.ok(!/\bsaldo\s+numeric/.test(migration), "nenhuma coluna 'saldo' pode ser gravada");

  // A exclusão é lógica: o registro é inativado, nunca apagado.
  assert.ok(migration.includes("ativo boolean not null default true"));
  assert.ok(migration.includes("inativado_em timestamptz"));
  assert.ok(/revoke delete/i.test(migration), "não pode existir delete nos registros das áreas");

  // O vínculo é com NF que já existe, e o fornecedor é sempre um cadastro que
  // já existe (on delete restrict impede apagar fornecedor com registro).
  assert.ok(migration.includes("references public.fornecedores (id) on delete restrict"));
  assert.ok(migration.includes("references public.valores_em_aberto (id) on delete cascade"));

  // E os nomes que o JavaScript espera batem com os da migration.
  for (const area of AREAS) {
    assert.ok(migration.includes(area.tabela), `${area.tabela} precisa existir na migration`);
    assert.ok(migration.includes(area.tabelaNotas), `${area.tabelaNotas} precisa existir na migration`);
    assert.ok(migration.includes(area.colunaRegistro), `${area.colunaRegistro} precisa existir na migration`);
  }
  for (const situacao of SITUACOES_AREA) {
    assert.ok(migration.includes(`'${situacao.value}'`), `a situação ${situacao.value} precisa existir no banco`);
  }
});

test("a migration relaxa a lista de módulos antes de semear as permissões", () => {
  const migration = ler(MIGRATION);
  const relaxa = migration.indexOf("permissoes_excecao_modulo_check");
  const relaxaGenerico = migration.indexOf("or modulo in (''patrocinios''");
  const semeia = migration.indexOf("insert into public.perfis_permissoes");
  assert.ok(relaxaGenerico !== -1 || relaxa !== -1, "a lista fixa de módulos precisa ser relaxada");
  assert.ok(semeia !== -1, "os módulos novos precisam ser semeados");
  assert.ok(
    Math.min(...[relaxa, relaxaGenerico].filter((i) => i !== -1)) < semeia,
    "relaxar a restrição tem de vir ANTES do seed, senão a migration aborta",
  );
});
