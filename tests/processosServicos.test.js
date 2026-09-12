import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ATESTADOS,
  CAMPOS_COMPARTILHADOS,
  CAMPOS_LIQUIDACAO,
  CAMPOS_REQUISICAO,
  MIGRATION_SERVICOS,
  MODULOS_PROCESSOS_SERVICOS,
  MODULO_SERVICOS,
  MODULO_SERVICOS_SAIDA,
  TIPOS_REQUISICAO,
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  acoesDisponiveis,
  adicionarItem,
  alterarItem,
  aplicarCalculo,
  atestadoSugerido,
  dadosDaNotaParaDocumento,
  dadosDoFornecedorParaDocumento,
  duplicarProcesso,
  filtrarProcessos,
  fornecedorAtendeBusca,
  itemPreenchido,
  itensParaDocumento,
  moverItem,
  numeroDoItem,
  numeroDoProcesso,
  numeroFormatado,
  opcoesDePagamentoDoFornecedor,
  preenchimentoDoProcesso,
  processoVazio,
  removerItem,
  resolverPermissoesServicos,
  sincronizarLiquidacao,
  soltarVinculoDaNota,
  soltarVinculoDeCadastro,
  valorExtensoDoProcesso,
  validarFinalizacao,
  validarRascunho,
} from "../src/lib/processosServicos.js";
import {
  ESCOPOS,
  RODAPE_INSTITUCIONAL,
  dadosDoDocumento,
  folhasDoEscopo,
  htmlDoProcesso,
  montarPdfDoProcesso,
  nomeDoArquivo,
} from "../src/lib/processosServicosDocumento.js";

/**
 * PROCESSOS · Serviços/Materiais — o segundo módulo documental.
 *
 * O que este arquivo defende, e que nenhuma outra parte da suíte defende:
 *
 *   1. um processo é UM registro com DUAS páginas -- a Requisição de
 *      Material/Serviço e a Liquidação/Solicitação de Pagamento não são
 *      cadastros independentes e carregam o mesmo número e os mesmos dados
 *      gerais;
 *   2. ⚠️ A REQUISIÇÃO NÃO TEM VALORES: a página 1 impressa tem três colunas --
 *      ITEM, QUANT. e DISCRIMINAÇÃO -- e nenhum "R$" em lugar algum;
 *   3. a numeração dos itens é a POSIÇÃO na lista, então remover e reordenar
 *      renumera sozinho, sem buraco;
 *   4. ⚠️ SELECIONAR A NF É APENAS CONSULTA: os valores são copiados para o
 *      documento e a nota original não é alterada, não recebe baixa e não muda
 *      de valor em aberto;
 *   5. o papel sai SEM numeração de folha e SEM o número do processo, com o
 *      brasão e o rodapé institucional em todas as folhas;
 *   6. NADA aqui debita conta, dá baixa em NF, altera saldo, cria pagamento ou
 *      mexe na Programação Diária -- nem em código, nem por engano.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** Texto literal dentro de uma expressão regular (o rodapé tem ponto e parêntese). */
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ARQUIVOS_DO_MODULO = [
  "src/lib/processosServicos.js",
  "src/lib/processosServicosDados.js",
  "src/lib/processosServicosDocumento.js",
  "src/components/processos/PaginaServicos.jsx",
  "src/components/processos/ModalProcessoServico.jsx",
  "src/components/processos/PreVisualizacaoProcessoServico.jsx",
];

const SECRETARIAS = [{ id: 3, nome: "Secretaria Municipal de Educação" }];

function processoDeExemplo(extra = {}) {
  return {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    id: 41,
    numero: 7,
    situacao: "rascunho",
    solicitante_id: 3,
    solicitante_nome: "Secretaria Municipal de Educação",
    tipo: "servicos",
    atestado: "servicos",
    objeto: "Manutenção dos aparelhos de ar-condicionado das escolas",
    itens: [
      { quantidade: "12", discriminacao: "Manutenção preventiva de ar-condicionado split" },
      { quantidade: "4", discriminacao: "Recarga de gás refrigerante" },
    ],
    favorecido_nome: "Refrigeração Laje Ltda.",
    favorecido_cpf_cnpj: "12.345.678/0001-90",
    valor_total: 4800,
    ...extra,
  };
}

/* -------------------------------------------------------------------------
 * Teste 1 — criar, marcar um dos quatro tipos e salvar como rascunho
 * ---------------------------------------------------------------------- */

test("as quatro opções da requisição são exatamente as do modelo, e marca-se UMA", () => {
  assert.deepEqual(
    TIPOS_REQUISICAO.map((t) => t.rotulo),
    [
      "AQUISIÇÃO DE MATERIAIS/PRODUTOS/EQUIPAMENTOS",
      "PRESTAÇÃO DE SERVIÇOS",
      "CONTRATAÇÃO",
      "LOCAÇÃO",
    ]
  );

  // Só a escolhida sai marcada; as outras três saem em branco, como no papel.
  const dados = dadosDoDocumento(processoDeExemplo({ tipo: "contratacao" }), { secretarias: SECRETARIAS });
  assert.equal(dados.requisicao.opcoes.filter((o) => o.marcado).length, 1);
  assert.equal(dados.requisicao.opcoes.find((o) => o.marcado).rotulo, "CONTRATAÇÃO");
  assert.equal(dados.requisicao.opcoes.length, 4);
});

test("rascunho salva sem as duas páginas completas; finalizar exige a página 1", () => {
  const novo = processoVazio({ ano: 2026, hoje: "2026-03-10" });

  // A única exigência do rascunho é a secretaria solicitante: é ela que diz de
  // quem é o processo. Nada mais é obrigatório -- é para isso que o rascunho e
  // o salvamento automático existem.
  assert.ok(validarRascunho(novo).solicitante_id);
  assert.deepEqual(validarRascunho({ ...novo, solicitante_id: 3 }), {});

  // Finalizar fecha o documento, então o mínimo do papel precisa estar lá.
  const semTipo = validarFinalizacao({ ...novo, solicitante_id: 3, itens: [] });
  assert.ok(semTipo.tipo);
  assert.ok(semTipo.itens);
  assert.deepEqual(validarFinalizacao(processoDeExemplo()), {});

  // ⚠️ A página 2 NÃO é exigida: o normal é a liquidação ser preenchida quando
  // a nota fiscal chega, e finalizar com ela pendente é situação legítima.
  const somentePagina1 = processoDeExemplo({ favorecido_nome: "", valor_total: 0 });
  assert.deepEqual(validarFinalizacao(somentePagina1), {});
  assert.equal(preenchimentoDoProcesso(somentePagina1).liquidacao, false);
  assert.match(preenchimentoDoProcesso(somentePagina1).texto, /Liquidação pendente/);
});

/* -------------------------------------------------------------------------
 * Teste 2 — vários itens, remover um, conferir a renumeração
 * ---------------------------------------------------------------------- */

test("a numeração do item é a POSIÇÃO na lista: remover e reordenar renumera sozinho", () => {
  let itens = [];
  ["Cimento CP-II", "Areia lavada", "Brita nº 1", "Tijolo cerâmico"].forEach((nome, i) => {
    itens = adicionarItem(itens);
    itens = alterarItem(itens, i, "discriminacao", nome);
    itens = alterarItem(itens, i, "quantidade", String((i + 1) * 10));
  });

  assert.deepEqual(itens.map((_, i) => numeroDoItem(i)), ["01", "02", "03", "04"]);

  // Remover o 02 faz o 03 virar 02 na hora: nenhum número gravado, nenhum buraco.
  itens = removerItem(itens, 1);
  assert.deepEqual(
    itens.map((item, i) => `${numeroDoItem(i)} ${item.discriminacao}`),
    ["01 Cimento CP-II", "02 Brita nº 1", "03 Tijolo cerâmico"]
  );

  // Reordenar também: o número acompanha a ordem, e nada além dela.
  itens = moverItem(itens, 2, "cima");
  assert.deepEqual(itens.map((item) => item.discriminacao), [
    "Cimento CP-II",
    "Tijolo cerâmico",
    "Brita nº 1",
  ]);
  // Subir o primeiro e descer o último não fazem nada (e não perdem item).
  assert.equal(moverItem(itens, 0, "cima").length, 3);
  assert.equal(moverItem(itens, 2, "baixo")[2].discriminacao, "Brita nº 1");

  // Linha em branco do formulário não é item do documento.
  assert.equal(itemPreenchido({ quantidade: "2", discriminacao: "" }), false);
  assert.equal(itensParaDocumento({ itens: [...itens, { quantidade: "", discriminacao: "" }] }).length, 3);
});

test("o quadro descritivo em branco sai com as linhas numeradas para completar à mão", () => {
  const dados = dadosDoDocumento(processoVazio({ ano: 2026, hoje: "" }), { secretarias: SECRETARIAS });
  assert.equal(dados.requisicao.semItens, true);
  assert.deepEqual(dados.requisicao.itens.map((i) => i.numero), ["01", "02", "03"]);
});

/* -------------------------------------------------------------------------
 * Teste 3 — ⚠️ A REQUISIÇÃO IMPRESSA NÃO TEM VALORES
 * ---------------------------------------------------------------------- */

test("a requisição impressa tem TRÊS colunas e nenhum valor", () => {
  const processo = processoDeExemplo({ valor_total: 4800, valor_extenso: "quatro mil e oitocentos reais" });
  const html = htmlDoProcesso(dadosDoDocumento(processo, { secretarias: SECRETARIAS }), {
    escopo: "requisicao",
  });

  // As três colunas do modelo, e só elas. (O texto sai em versalete pelo CSS,
  // então a comparação é sem caixa.)
  assert.match(html, /<th[^>]*>Item<\/th>/i);
  assert.match(html, /<th[^>]*>Quant\.<\/th>/i);
  assert.match(html, /<th[^>]*>Discriminação<\/th>/i);
  assert.equal((html.match(/<th[\s>]/g) ?? []).length, 3);
  assert.doesNotMatch(html, /valor unit|valor total|>valor</i);

  // ⚠️ Nenhum valor: nem "R$", nem o número, nem o extenso.
  assert.doesNotMatch(html, /R\$/);
  assert.doesNotMatch(html, /4\.800/);
  assert.doesNotMatch(html, /quatro mil e oitocentos/);

  // O item do processo também não tem para onde levar valor: o campo não existe.
  const itens = itensParaDocumento(processo);
  itens.forEach((item) => {
    assert.deepEqual(Object.keys(item).sort(), ["discriminacao", "numero", "quantidade"]);
  });
});

test("o valor aparece na página 2, e só nela", () => {
  const processo = processoDeExemplo({ valor_total: 4800 });
  const html = htmlDoProcesso(dadosDoDocumento(processo, { secretarias: SECRETARIAS }), {
    escopo: "liquidacao",
  });
  assert.match(html, /R\$/);
  assert.match(html, /4\.800,00/);
  assert.match(html, /FAVORECIDO/i);
  assert.match(html, /DADOS BANCÁRIOS/i);
});

/* -------------------------------------------------------------------------
 * Testes 4 e 5 — um processo, duas páginas
 * ---------------------------------------------------------------------- */

test("a liquidação herda o requisitante e os dados gerais da página 1", () => {
  // Não é cópia: são as MESMAS colunas do MESMO registro.
  ["data_processo", "solicitante_id", "objeto"].forEach((campo) =>
    assert.ok(CAMPOS_COMPARTILHADOS.includes(campo), `${campo} deveria ser compartilhado`)
  );
  // O tipo é da página 1, o favorecido e o valor são da página 2 -- sem cruzar.
  assert.ok(CAMPOS_REQUISICAO.includes("tipo"));
  assert.ok(CAMPOS_LIQUIDACAO.includes("favorecido_nome"));
  assert.ok(CAMPOS_LIQUIDACAO.includes("valor_total"));
  assert.ok(!CAMPOS_REQUISICAO.includes("valor_total"));

  const dados = dadosDoDocumento(processoDeExemplo(), { secretarias: SECRETARIAS });
  // O REQUISITANTE da página 2 é o mesmo texto da página 1, e o ÓRGÃO
  // REQUISITANTE do quadro resumo também.
  assert.equal(dados.requisitante, "Secretaria Municipal de Educação");
  assert.equal(dados.liquidacao.orgao, "Secretaria Municipal de Educação");

  // E as duas páginas carregam o mesmo número.
  assert.equal(numeroFormatado(2026, 7), "0007/2026");
  assert.equal(numeroDoProcesso(processoDeExemplo()), "0007/2026");
  assert.equal(dados.numero, "0007/2026");
});

test("a atestação da página 2 é sugerida pelo tipo da página 1 e continua trocável", () => {
  assert.equal(ATESTADOS.length, 2);
  assert.match(ATESTADOS[0].rotulo, /prestou serviços/);
  assert.match(ATESTADOS[1].rotulo, /forneceu os materiais/);

  // Serviços e contratação → prestou serviços. Aquisição e locação → forneceu.
  assert.equal(atestadoSugerido("servicos"), "servicos");
  assert.equal(atestadoSugerido("contratacao"), "servicos");
  assert.equal(atestadoSugerido("aquisicao"), "materiais");
  assert.equal(atestadoSugerido("locacao"), "materiais");

  const antes = { tipo: "", atestado: "" };
  const marcado = sincronizarLiquidacao(antes, { ...antes, tipo: "aquisicao" });
  assert.equal(marcado.atestado, "materiais");

  // Trocada à mão, a sugestão NÃO a desfaz -- nem quando o tipo muda depois.
  const trocado = { ...marcado, atestado: "servicos" };
  const depois = sincronizarLiquidacao(trocado, { ...trocado, tipo: "locacao" });
  assert.equal(depois.atestado, "servicos");

  // E o papel marca exatamente uma das duas.
  const dados = dadosDoDocumento(processoDeExemplo({ atestado: "materiais" }), { secretarias: SECRETARIAS });
  assert.equal(dados.liquidacao.opcoes.filter((o) => o.marcado).length, 1);
  assert.match(dados.liquidacao.opcoes.find((o) => o.marcado).rotulo, /forneceu os materiais/);
});

/* -------------------------------------------------------------------------
 * Teste 6 — o fornecedor traz os dados bancários e o PIX
 * ---------------------------------------------------------------------- */

test("a busca do fornecedor acha por razão social, nome, apelido e CPF/CNPJ", () => {
  const fornecedor = {
    id: 9,
    razao_social: "Refrigeração Laje Ltda.",
    nome_fantasia: "Frio Laje",
    apelido: "Seu Zé do ar",
    cpf_cnpj: "12.345.678/0001-90",
  };
  ["refrigeracao", "REFRIGERAÇÃO", "frio", "seu ze", "12345678", "678/0001"].forEach((termo) =>
    assert.equal(fornecedorAtendeBusca(fornecedor, termo), true, `não achou por "${termo}"`)
  );
  assert.equal(fornecedorAtendeBusca(fornecedor, "padaria"), false);
});

test("escolher o fornecedor puxa razão social, CPF/CNPJ, endereço, banco, conta e PIX", () => {
  const dados = dadosDoFornecedorParaDocumento({
    id: 9,
    razao_social: "Refrigeração Laje Ltda.",
    cpf_cnpj: "12.345.678/0001-90",
    endereco: "Rua do Comércio, 100 — Centro",
    banco_codigo: "001",
    banco: "Banco do Brasil",
    agencia: "1234-5",
    conta: "98765-4",
    pix_chave: "12345678000190",
    pix_titular: "Refrigeração Laje Ltda.",
  });
  assert.equal(dados.fornecedor_id, 9);
  assert.equal(dados.favorecido_nome, "Refrigeração Laje Ltda.");
  assert.equal(dados.favorecido_endereco, "Rua do Comércio, 100 — Centro");
  assert.equal(dados.banco, "Banco do Brasil");
  assert.equal(dados.agencia, "1234-5");
  assert.equal(dados.conta, "98765-4");
  assert.equal(dados.pix, "12345678000190");
  assert.equal(dados.titular, "Refrigeração Laje Ltda.");
});

test("mais de uma conta ou PIX vira ESCOLHA, com a principal na frente", () => {
  const opcoes = opcoesDePagamentoDoFornecedor([
    { id: "a", kind: "bank", bankCode: "033", bankName: "Santander", agency: "0101", account: "555", accountDigit: "1" },
    { id: "b", kind: "pix", pixKey: "12345678000190", pixKeyType: "CNPJ", holderName: "Refrigeração Laje", isPrimary: true },
  ]);
  assert.equal(opcoes.length, 2);
  assert.equal(opcoes[0].id, "b"); // a principal primeiro
  assert.match(opcoes[0].rotulo, /Principal/);

  // PIX e conta NÃO se excluem: o papel tem linha para os dois, e escolher um
  // não apaga o outro.
  assert.deepEqual(Object.keys(opcoes[0].dados).sort(), ["pix", "titular"]);
  assert.ok(!("banco" in opcoes[0].dados));
  assert.equal(opcoes[1].dados.conta, "555-1");
});

test("preencher o favorecido à mão NÃO cria fornecedor, e soltar o vínculo preserva o texto", () => {
  const manual = soltarVinculoDeCadastro({
    fornecedor_id: 9,
    favorecido_nome: "João da Silva",
    favorecido_cpf_cnpj: "123.456.789-00",
    pix: "joao@email.com",
  });
  // A única coisa que sai é o vínculo interno.
  assert.equal(manual.fornecedor_id, null);
  assert.equal(manual.favorecido_nome, "João da Silva");
  assert.equal(manual.pix, "joao@email.com");

  // E nenhum arquivo do módulo escreve no cadastro de fornecedores.
  assert.equal(Object.keys(soltarVinculoDeCadastro({ a: 1 })).length, 2);
});

/* -------------------------------------------------------------------------
 * Teste 7 — ⚠️ selecionar a NF é APENAS CONSULTA
 * ---------------------------------------------------------------------- */

test("vincular a NF copia os valores para o documento e não altera a nota", () => {
  const nota = Object.freeze({
    id: 77,
    numero_nota_fiscal: "1234",
    data_nota_fiscal: "2026-03-05",
    valor_bruto: 5000,
    desconto_iss: 150,
    desconto_ir: 50,
  });

  const copia = dadosDaNotaParaDocumento(nota);
  assert.equal(copia.nota_id, 77);
  assert.equal(copia.nota_numero, "1234");
  assert.equal(copia.nota_emissao, "2026-03-05");
  assert.equal(copia.nota_valor_bruto, 5000);
  assert.equal(copia.nota_retencoes, 200);
  assert.equal(copia.nota_valor_liquido, 4800);
  // O valor do pagamento solicitado é o LÍQUIDO, que é o que se paga.
  assert.equal(copia.valor_total, 4800);
  assert.match(copia.fundamentacao, /Nota fiscal nº 1234/);

  // ⚠️ A nota original segue idêntica: a função só LÊ. (Object.freeze provaria
  // qualquer escrita, e a comparação abaixo confirma os valores.)
  assert.deepEqual(nota, {
    id: 77,
    numero_nota_fiscal: "1234",
    data_nota_fiscal: "2026-03-05",
    valor_bruto: 5000,
    desconto_iss: 150,
    desconto_ir: 50,
  });

  // Desfazer o vínculo não reescreve o documento: o valor e a fundamentação ficam.
  const solto = soltarVinculoDaNota({ ...copia });
  assert.equal(solto.nota_id, null);
  assert.equal(solto.nota_numero, "");
  assert.equal(solto.valor_total, 4800);
  assert.match(solto.fundamentacao, /1234/);
});

test("a camada de dados NUNCA escreve na NF nem em nada financeiro", async () => {
  const dados = await read("src/lib/processosServicosDados.js");

  // A leitura das notas é um SELECT, e é a única menção a valores_em_aberto.
  const mencoes = dados.match(/valores_em_aberto/g) ?? [];
  assert.ok(mencoes.length > 0, "a consulta às notas deveria existir");
  assert.doesNotMatch(dados, /from\("valores_em_aberto"\)\s*\.\s*(update|insert|upsert|delete)/);

  // Nenhuma escrita em tabela financeira, em nenhum arquivo do módulo.
  const arquivos = await Promise.all(ARQUIVOS_DO_MODULO.map(read));
  const proibidas = [
    "pagamentos",
    "contas_bancarias",
    "saldos_historico",
    "programacoes_pagamento",
    "fornecedores",
    "valores_em_aberto",
  ];
  arquivos.forEach((conteudo, i) => {
    proibidas.forEach((tabela) => {
      [`\\.insert`, `\\.update`, `\\.upsert`, `\\.delete`].forEach((metodo) => {
        const padrao = new RegExp(`from\\(["'\`]${tabela}["'\`]\\)[\\s\\S]{0,80}?${metodo}\\(`);
        assert.doesNotMatch(
          conteudo,
          padrao,
          `${ARQUIVOS_DO_MODULO[i]} não pode escrever em ${tabela}`
        );
      });
    });
  });
});

/* -------------------------------------------------------------------------
 * Teste 8 — valor por extenso
 * ---------------------------------------------------------------------- */

test("o valor por extenso é gerado em português e pode ser assumido à mão", () => {
  assert.equal(aplicarCalculo({ valor_total: 4800 }).valor_extenso, "quatro mil e oitocentos reais");
  assert.equal(aplicarCalculo({ valor_total: "1.234,56" }).valor_extenso,
    "mil, duzentos e trinta e quatro reais e cinquenta e seis centavos");
  assert.equal(aplicarCalculo({ valor_total: 1 }).valor_extenso, "um real");

  // Assumida a redação, o automático não sobrescreve mais.
  const manual = aplicarCalculo({ valor_total: 4800, valor_extenso: "a combinar", valor_extenso_manual: true });
  assert.equal(manual.valor_extenso, "a combinar");

  // E o documento se vira quando a coluna ainda está vazia.
  assert.equal(valorExtensoDoProcesso({ valor_total: 4800, valor_extenso: "" }), "quatro mil e oitocentos reais");
  const dados = dadosDoDocumento(processoDeExemplo({ valor_extenso: "" }), { secretarias: SECRETARIAS });
  assert.equal(dados.valor.extenso, "quatro mil e oitocentos reais");
  assert.equal(dados.valor.algarismo, "R$ 4.800,00");
});

/* -------------------------------------------------------------------------
 * Testes 9 e 10 — impressão: duas folhas, sem numeração, sem número, com rodapé
 * ---------------------------------------------------------------------- */

test("imprimir o processo completo dá DUAS folhas, cada documento na sua", () => {
  assert.deepEqual(ESCOPOS.map((e) => e.id), ["completo", "requisicao", "liquidacao"]);
  assert.deepEqual(folhasDoEscopo("completo"), ["requisicao", "liquidacao"]);
  assert.deepEqual(folhasDoEscopo("requisicao"), ["requisicao"]);
  assert.deepEqual(folhasDoEscopo("liquidacao"), ["liquidacao"]);

  const dados = dadosDoDocumento(processoDeExemplo(), { secretarias: SECRETARIAS });
  const html = htmlDoProcesso(dados, { escopo: "completo" });
  assert.equal((html.match(/class="folha"/g) ?? []).length, 2);
  assert.match(html, new RegExp(escapar(TITULO_PAGINA_1)));
  assert.match(html, new RegExp(escapar(TITULO_PAGINA_2)));
  // Cada documento começa em folha nova, e o A4 retrato é o do modelo.
  assert.match(html, /page-break-after:\s*always/);
  assert.match(html, /size:\s*A4 portrait/);

  // Um PDF só, com as duas páginas.
  const pdf = montarPdfDoProcesso(dados, { escopo: "completo" });
  assert.equal(pdf.getNumberOfPages(), 2);
  assert.equal(montarPdfDoProcesso(dados, { escopo: "requisicao" }).getNumberOfPages(), 1);
  assert.equal(nomeDoArquivo(dados, "pdf"), "processo-servico-0007-2026.pdf");
});

test("o papel NÃO traz numeração de folha e NÃO traz o número do processo", () => {
  const dados = dadosDoDocumento(processoDeExemplo(), { secretarias: SECRETARIAS });
  const html = htmlDoProcesso(dados, { escopo: "completo" });

  // O número existe no sistema (é interno, para busca e auditoria)...
  assert.equal(dados.numero, "0007/2026");
  // ...e não aparece no papel, em nenhuma das formas de escrevê-lo.
  assert.doesNotMatch(html, /0007\/2026/);
  assert.doesNotMatch(html, /0007/);
  assert.doesNotMatch(html, /Processo n[ºo]/i);
  // Nem numeração de folha.
  assert.doesNotMatch(html, /Folha \d|P[áa]gina \d|\d\s*\/\s*2\b/i);
  assert.doesNotMatch(html, /@page[\s\S]*?counter|content:\s*counter/i);
});

test("o brasão e o rodapé institucional saem em TODAS as folhas", () => {
  const dados = dadosDoDocumento(processoDeExemplo(), { secretarias: SECRETARIAS });
  const html = htmlDoProcesso(dados, { escopo: "completo" });

  // Duas folhas, dois cabeçalhos, dois rodapés.
  assert.equal((html.match(/class="folha"/g) ?? []).length, 2);
  assert.equal((html.match(/class="cabecalho"/g) ?? []).length, 2);
  assert.equal((html.match(/class="rodape"/g) ?? []).length, 2);

  // O rodapé literal do comando, com CEP, telefone, e-mail e CNPJ.
  Object.values(RODAPE_INSTITUCIONAL).forEach((linha) =>
    assert.match(html, new RegExp(escapar(linha)))
  );
  assert.match(html, /CEP: 57\.860-000/);
  assert.match(html, /CNPJ: 12\.330\.916\/0001-99/);
  assert.match(html, /prefeitura@saojosedalaje\.al\.gov\.br/);
});

test("a requisição com muitos itens continua na folha seguinte, sem cortar item", () => {
  const muitos = Array.from({ length: 40 }, (_, i) => ({
    quantidade: String(i + 1),
    discriminacao: `Item de material número ${i + 1} do quadro descritivo`,
  }));
  const dados = dadosDoDocumento(processoDeExemplo({ itens: muitos }), { secretarias: SECRETARIAS });

  // Os 40 itens saem numerados de 01 a 40, sem truncar a lista.
  assert.equal(dados.requisicao.itens.length, 40);
  assert.equal(dados.requisicao.itens[0].numero, "01");
  assert.equal(dados.requisicao.itens[39].numero, "40");

  // E o PDF cresce em folhas em vez de encolher a fonte ou cortar.
  const pdf = montarPdfDoProcesso(dados, { escopo: "requisicao" });
  assert.ok(pdf.getNumberOfPages() > 1, "o quadro deveria continuar na folha seguinte");
});

test("NÃO existe geração de Word em nenhum arquivo do módulo", async () => {
  const arquivos = await Promise.all(ARQUIVOS_DO_MODULO.map(read));
  arquivos.forEach((conteudo, i) => {
    [/\.docx?\b/i, /msword/i, /officedocument/i, /\bdocx\b/i].forEach((padrao) =>
      assert.doesNotMatch(conteudo, padrao, `${ARQUIVOS_DO_MODULO[i]} não pode gerar Word`)
    );
  });
});

/* -------------------------------------------------------------------------
 * Teste 11 — duplicar
 * ---------------------------------------------------------------------- */

test("duplicar cria processo NOVO, sem id e sem número, e não altera o original", () => {
  const original = Object.freeze(processoDeExemplo({ situacao: "finalizada", numero: 7 }));
  const copia = duplicarProcesso(original, { ano: 2026, hoje: "2026-04-01" });

  assert.equal(copia.id, null);
  assert.equal(copia.numero, null); // o número novo é emitido na gravação
  assert.equal(copia.situacao, "rascunho");
  // Os dados vieram: é para isso que serve duplicar.
  assert.equal(copia.tipo, "servicos");
  assert.equal(copia.favorecido_nome, "Refrigeração Laje Ltda.");
  assert.equal(copia.itens.length, 2);
  // ⚠️ A NF consultada NÃO é herdada: cada processo consulta a sua.
  assert.equal(copia.nota_id, null);
  assert.equal(copia.nota_numero, "");

  // O original segue intacto -- inclusive o número e a situação.
  assert.equal(original.id, 41);
  assert.equal(original.numero, 7);
  assert.equal(original.situacao, "finalizada");
});

test("processo finalizado não tem exclusão comum: o caminho é cancelar", () => {
  const todas = {
    visualizar: true, criar: true, editar: true, finalizar: true,
    cancelar: true, imprimir: true, duplicar: true,
  };
  const finalizada = acoesDisponiveis(processoDeExemplo({ situacao: "finalizada" }), todas);
  assert.equal(finalizada.excluir, false);
  assert.equal(finalizada.editar, false);
  assert.equal(finalizada.cancelar, true);
  assert.equal(finalizada.imprimir, true);
  assert.equal(finalizada.duplicar, true);

  // Cancelada: nem editar, nem cancelar de novo, nem excluir. Imprimir, sim.
  const cancelada = acoesDisponiveis(processoDeExemplo({ situacao: "cancelada" }), todas);
  assert.equal(cancelada.editar, false);
  assert.equal(cancelada.cancelar, false);
  assert.equal(cancelada.excluir, false);
});

/* -------------------------------------------------------------------------
 * Teste 12 — nada aqui é financeiro
 * ---------------------------------------------------------------------- */

test("finalizar não é pagar, e nenhum arquivo do módulo dá baixa ou debita conta", async () => {
  const arquivos = await Promise.all(ARQUIVOS_DO_MODULO.map(read));
  arquivos.forEach((conteudo, i) => {
    [
      /registrarBaixa|darBaixa|baixarPagamento/i,
      /debitarConta|debitarSaldo|atualizarSaldo/i,
      /criarPagamento|gerarPagamento/i,
      /marcarComoPago/i,
    ].forEach((padrao) =>
      assert.doesNotMatch(conteudo, padrao, `${ARQUIVOS_DO_MODULO[i]} não pode mexer em dinheiro`)
    );
  });

  // E o módulo diz isso por escrito, onde quem for mexer vai ler.
  const regras = await read("src/lib/processosServicos.js");
  assert.match(regras, /não é pagar|NÃO É PAGAR/);
});

/* -------------------------------------------------------------------------
 * Permissões, migration e aviso ao operador
 * ---------------------------------------------------------------------- */

test("as sete ações moram em dois módulos próprios, separados dos de Diárias", () => {
  assert.deepEqual(MODULOS_PROCESSOS_SERVICOS, ["processos_servicos", "processos_servicos_saida"]);

  // Sem linha no banco, nada é liberado.
  const nenhuma = resolverPermissoesServicos({ linhas: [] });
  assert.deepEqual(Object.values(nenhuma).filter(Boolean), []);

  // Quem pode ver e criar NÃO passa a poder finalizar nem cancelar: são as
  // ações que fecham e anulam o documento, e têm coluna própria.
  const so = resolverPermissoesServicos({
    linhas: [{ modulo: MODULO_SERVICOS, pode_visualizar: true, pode_cadastrar: true }],
  });
  assert.equal(so.visualizar, true);
  assert.equal(so.criar, true);
  assert.equal(so.finalizar, false);
  assert.equal(so.cancelar, false);
  assert.equal(so.editar, false);
  // Imprimir e duplicar, enquanto a linha do módulo de saída não existe no
  // banco, acompanham visualizar e criar -- é o padrão que a migration semeia.
  assert.equal(so.imprimir, true);
  assert.equal(so.duplicar, true);

  // Existindo a linha própria, é ELA que manda: pode imprimir, não pode duplicar.
  const saida = resolverPermissoesServicos({
    linhas: [
      { modulo: MODULO_SERVICOS, pode_visualizar: true, pode_cadastrar: true },
      { modulo: MODULO_SERVICOS_SAIDA, pode_visualizar: true, pode_cadastrar: false },
    ],
  });
  assert.equal(saida.imprimir, true);
  assert.equal(saida.duplicar, false);

  // Permissão de Diárias NÃO libera Serviços/Materiais.
  const diarias = resolverPermissoesServicos({
    linhas: [{ modulo: "processos_diarias", pode_visualizar: true, pode_cadastrar: true }],
  });
  assert.deepEqual(Object.values(diarias).filter(Boolean), []);
});

test("a migration cria as tabelas do módulo e não toca em nada existente", async () => {
  const sql = await read(`supabase/migrations/${MIGRATION_SERVICOS}`);

  assert.doesNotMatch(sql, /\bdrop table\b|\btruncate\b|\bdrop column\b/i);
  [
    /alter table (public\.)?pagamentos\b/i,
    /alter table (public\.)?contas_bancarias\b/i,
    /alter table (public\.)?saldos_historico\b/i,
    /alter table (public\.)?programacoes_pagamento\b/i,
    /alter table (public\.)?fornecedores\b/i,
    /alter table (public\.)?processos_diarias\b/i,
  ].forEach((padrao) => assert.doesNotMatch(sql, padrao));

  // Cada tabela é criada sob o seu próprio guarda de existência (to_regclass),
  // que é o que torna a migration repetível sem efeito colateral.
  ["processos_servicos", "processos_servicos_numeracao", "processos_servicos_historico"].forEach((tabela) => {
    assert.match(sql, new RegExp(`create table public\\.${tabela} \\(`, "i"));
    assert.match(sql, new RegExp(`to_regclass\\('public\\.${tabela}'\\) is null`, "i"));
  });

  // O número é emitido pelo banco, com trava de linha, e nunca reaproveitado.
  assert.match(sql, /create or replace function public\.proximo_numero_processo_servico/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /revoke delete/i);

  // Os itens são jsonb: a numeração é a posição, e não uma coluna para desencontrar.
  assert.match(sql, /itens jsonb/i);
});

test("a tela avisa que a migration precisa ser rodada à mão no SQL Editor do Supabase", async () => {
  const [regras, pagina] = await Promise.all([
    read("src/lib/processosServicos.js"),
    read("src/components/processos/PaginaServicos.jsx"),
  ]);
  assert.ok(regras.includes(MIGRATION_SERVICOS));
  assert.match(regras, /SQL Editor do Supabase/);
  assert.match(pagina, /AVISO_MIGRATION_SERVICOS/);
});

test("a subaba, o menu, a auditoria e o backup conhecem Serviços/Materiais", async () => {
  const [modulo, permissoes, matriz, auditoria, backups] = await Promise.all([
    read("src/pages/ModuloProcessos.jsx"),
    read("src/lib/permissoesProcessos.js"),
    read("src/lib/permissoesUsuario.js"),
    read("src/lib/auditoria.js"),
    read("src/lib/backups.js"),
  ]);

  // A rota /processos/servicos e a subaba no menu.
  assert.match(modulo, /"servicos"/);
  assert.match(modulo, /PaginaServicos/);
  assert.match(permissoes, /Serviços\/Materiais/);
  assert.match(permissoes, /podeVerServicos/);

  // As duas linhas novas na Matriz de Permissões -- e as de Diárias continuam lá.
  assert.match(matriz, /id: "processos_servicos"/);
  assert.match(matriz, /id: "processos_servicos_saida"/);
  assert.match(matriz, /id: "processos_diarias"/);

  // Auditoria e backup.
  assert.match(auditoria, /processos_servicos: "Processos · Serviços\/Materiais"/);
  ["processos_servicos", "processos_servicos_numeracao", "processos_servicos_historico"].forEach((tabela) =>
    assert.match(backups, new RegExp(`tabela: "${tabela}"`))
  );
});

/* -------------------------------------------------------------------------
 * Lista: busca, filtros e indicador de preenchimento
 * ---------------------------------------------------------------------- */

test("a busca rápida acha por número, fornecedor, CPF/CNPJ, secretaria, objeto e situação", () => {
  const processos = [
    processoDeExemplo(),
    processoDeExemplo({
      id: 42, numero: 8, solicitante_nome: "Secretaria Municipal de Saúde",
      favorecido_nome: "Papelaria Central", favorecido_cpf_cnpj: "98.765.432/0001-10",
      objeto: "Material de escritório", situacao: "finalizada", tipo: "aquisicao",
      itens: [{ quantidade: "50", discriminacao: "Resma de papel A4" }],
    }),
  ];
  const achar = (busca) => filtrarProcessos(processos, { busca, secretarias: SECRETARIAS }).map((p) => p.id);

  assert.deepEqual(achar("0007"), [41]);
  assert.deepEqual(achar("papelaria"), [42]);
  assert.deepEqual(achar("98765432"), [42]);
  assert.deepEqual(achar("saúde"), [42]);
  assert.deepEqual(achar("ar-condicionado"), [41]);
  assert.deepEqual(achar("finalizada"), [42]);
  // A discriminação do item também entra: é comum procurar pelo material pedido.
  assert.deepEqual(achar("refrigerante"), [41]);

  // Os filtros recolhíveis.
  const porTipo = filtrarProcessos(processos, { filtros: { tipo: "aquisicao" }, secretarias: SECRETARIAS });
  assert.deepEqual(porTipo.map((p) => p.id), [42]);
  const porSituacao = filtrarProcessos(processos, { filtros: { situacao: "rascunho" }, secretarias: SECRETARIAS });
  assert.deepEqual(porSituacao.map((p) => p.id), [41]);
});
