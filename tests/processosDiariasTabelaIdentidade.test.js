import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AVISO_MIGRATION_TABELA,
  CATEGORIAS_CARGO,
  FAIXAS_DISTANCIA,
  MEMORIA_CALCULO_PADRAO,
  MIGRATION_TABELA_DIARIAS,
  PERNOITE_PADRAO,
  TABELA_PADRAO,
  aplicarTabelaDeDiarias,
  congelarTabelaNoProcesso,
  diferencaDaTabela,
  identificacaoDaVersao,
  linhasDaTabela,
  normalizarTabela,
  percentualDePernoite,
  primeiroErroDaTabela,
  temTabelaCongelada,
  textoDaOrigemDoValor,
  tipoDiariaComposto,
  tituloDaTabela,
  unitarioDivergeDaTabela,
  validarTabela,
  valorDaCelula,
  valorUnitarioDaTabela,
} from "../src/lib/processosDiariasTabela.js";
import {
  BRASAO_ARQUIVO,
  BRASAO_SVG,
  IDENTIDADE_PADRAO,
  congelarIdentidadeNoProcesso,
  diferencaDaIdentidade,
  identidadeDoProcesso,
  logoDoDocumento,
  normalizarIdentidade,
  primeiroErroDaIdentidade,
  temIdentidadeCongelada,
  usaBrasaoDoRepositorio,
  validarIdentidade,
} from "../src/lib/processosIdentidade.js";
import {
  alteracaoManualDeValorUnitario,
  aplicarCalculo,
  podeEditarTabelaDeDiarias,
  podeVerTabelaDeDiarias,
  processoVazio,
  resolverPermissoesDiarias,
  MODULO_DIARIAS,
  MODULO_DIARIAS_TABELA,
} from "../src/lib/processosDiarias.js";
import {
  dadosDoDocumento,
  htmlDoProcesso,
  montarPdfDoProcesso,
} from "../src/lib/processosDiariasDocumento.js";
import { formatBRL } from "../src/lib/moeda.js";

/**
 * PROCESSOS · Tabela de Diárias e identidade visual.
 *
 * Este arquivo é a conferência dos dez testes pedidos no comando, na ordem em
 * que foram pedidos:
 *
 *   1. a tabela com os 20 valores está cadastrada e é exibida;
 *   2. faixa + categoria preenchem o valor unitário sozinhas;
 *   3. o pernoite sobe o valor em exatamente 30% -- percentual da TABELA;
 *   4. quantidade × valor unitário dá o total certo;
 *   5. o valor digitado à mão prevalece e vai para a auditoria;
 *   6. ⚠️ atualizar a tabela depois NÃO altera processo já finalizado;
 *   7. o "Tipo de Diária" sai preenchido no documento impresso;
 *   8. o brasão aparece nas três páginas, sem deformação;
 *   9. cada documento continua cabendo em UMA página;
 *  10. nada aqui altera saldo, baixa ou programação.
 */

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/** Os 20 valores do documento oficial, como a prefeitura os informou. */
const VALORES_OFICIAIS = {
  "Estado de AL até 100 km": [597.7, 271.67, 271.67, 115.91, 97.78],
  "Estado de AL acima de 100 km": [670.14, 289.77, 289.77, 159.37, 119.54],
  "Outros Estados do NE": [796.84, 398.48, 398.48, 191.98, 137.64],
  "Estados do N, S, SUD e C. Oeste": [869.37, 507.12, 507.12, 326.03, 217.33],
};

function processoDeExemplo(extra = {}) {
  return {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    id: 77,
    numero: 12,
    situacao: "rascunho",
    secretaria_id: 3,
    beneficiario_nome: "Maria Souza",
    beneficiario_cpf: "123.456.789-00",
    destino: "Maceió/AL",
    finalidade: "Reunião na Secretaria de Estado.",
    data_saida: "2026-03-12",
    data_retorno: "2026-03-13",
    ...extra,
  };
}

const SECRETARIAS = [{ id: 3, nome: "Secretaria de Finanças" }];

/* -------------------------------------------------------------------------
 * Teste 1 -- a tabela com os 20 valores
 * ---------------------------------------------------------------------- */

test("teste 1: a tabela tem as 4 faixas × 5 categorias e os 20 valores informados", () => {
  assert.equal(FAIXAS_DISTANCIA.length, 4);
  assert.equal(CATEGORIAS_CARGO.length, 5);

  const linhas = linhasDaTabela(TABELA_PADRAO);
  assert.equal(linhas.length, 4);
  linhas.forEach((linha) => {
    assert.equal(linha.celulas.length, 5);
    const esperados = VALORES_OFICIAIS[linha.rotulo];
    assert.ok(esperados, `faixa inesperada: ${linha.rotulo}`);
    linha.celulas.forEach((celula, i) => {
      assert.equal(celula.valor, esperados[i], `${linha.rotulo} · ${celula.rotulo}`);
      // Exibição em real brasileiro, pela utilidade compartilhada.
      assert.equal(celula.texto, formatBRL(esperados[i]));
    });
  });

  // 20 células, nem uma a mais.
  assert.equal(linhas.reduce((soma, linha) => soma + linha.celulas.length, 0), 20);
});

test("teste 1: o título carrega a data de atualização, e a memória do cálculo fica junto", () => {
  assert.equal(tituloDaTabela(TABELA_PADRAO), "Tabela de Diárias — atualizada em 23/03/2026");
  assert.match(MEMORIA_CALCULO_PADRAO, /IGP-M/);
  assert.match(MEMORIA_CALCULO_PADRAO, /5,716740%/);
  assert.match(MEMORIA_CALCULO_PADRAO, /1,05716740/);
  // Ela viaja com a tabela e não entra em conta nenhuma.
  assert.equal(normalizarTabela(TABELA_PADRAO).memoria_calculo, MEMORIA_CALCULO_PADRAO);
});

test("teste 1: a tela de cadastro existe em Configurações → Processos", async () => {
  const [categorias, pagina, tela] = await Promise.all([
    read("src/lib/configuracoesSistema.js"),
    read("src/pages/Configuracoes.jsx"),
    read("src/components/configuracoes/CategoriaProcessos.jsx"),
  ]);
  assert.match(categorias, /id: "processos"/);
  assert.match(pagina, /categoriaAtual === "processos"/);
  assert.match(pagina, /<CategoriaProcessos/);
  // O cadastro é editável: título, data, os 20 valores, o percentual e a memória.
  assert.match(tela, /definir\("titulo"/);
  assert.match(tela, /definir\("atualizada_em"/);
  assert.match(tela, /definir\("pernoite_percentual"/);
  assert.match(tela, /definir\("memoria_calculo"/);
  assert.match(tela, /definirCelula\(faixa\.id, categoria\.id/);
  assert.match(tela, /salvarNovaVersaoDaTabela/);
});

/* -------------------------------------------------------------------------
 * Teste 2 -- faixa + categoria preenchem o valor unitário
 * ---------------------------------------------------------------------- */

test("teste 2: escolher faixa e categoria preenche o valor unitário sozinho", () => {
  const escolhido = aplicarTabelaDeDiarias(
    { diaria_faixa: "nordeste", diaria_categoria: "secretarios" },
    TABELA_PADRAO,
  );
  assert.equal(escolhido.valor_unitario, 398.48);
  assert.equal(escolhido.valor_unitario_manual, false);

  // Faixa sem categoria (ou o contrário) não inventa valor: o campo fica como está.
  const incompleto = aplicarTabelaDeDiarias({ diaria_faixa: "nordeste", valor_unitario: 10 }, TABELA_PADRAO);
  assert.equal(incompleto.valor_unitario, 10);
  assert.equal(valorUnitarioDaTabela(TABELA_PADRAO, { faixa: "nordeste", categoria: "" }), null);
});

/* -------------------------------------------------------------------------
 * Teste 3 -- o pernoite sobe exatamente 30%
 * ---------------------------------------------------------------------- */

test("teste 3: marcar pernoite aumenta o valor em exatamente 30%", () => {
  assert.equal(percentualDePernoite(TABELA_PADRAO), 30);

  FAIXAS_DISTANCIA.forEach((faixa) => {
    CATEGORIAS_CARGO.forEach((categoria) => {
      const sem = valorUnitarioDaTabela(TABELA_PADRAO, { faixa: faixa.id, categoria: categoria.id });
      const com = valorUnitarioDaTabela(TABELA_PADRAO, {
        faixa: faixa.id,
        categoria: categoria.id,
        pernoite: true,
      });
      assert.equal(com, Math.round(sem * 1.3 * 100) / 100, `${faixa.rotulo} · ${categoria.rotulo}`);
    });
  });

  // O caso do comando, conferido no braço: 97,78 → 127,11.
  assert.equal(valorDaCelula(TABELA_PADRAO, "al_ate_100", "outros_agentes"), 97.78);
  assert.equal(
    valorUnitarioDaTabela(TABELA_PADRAO, {
      faixa: "al_ate_100",
      categoria: "outros_agentes",
      pernoite: true,
    }),
    127.11,
  );
});

test("teste 3: o percentual do pernoite é CONFIGURÁVEL, não está escrito no código", async () => {
  // Uma tabela com outro percentual muda o resultado sem tocar em uma linha de código.
  const outra = { ...TABELA_PADRAO, pernoite_percentual: 50 };
  assert.equal(
    valorUnitarioDaTabela(outra, { faixa: "al_ate_100", categoria: "outros_agentes", pernoite: true }),
    146.67,
  );
  assert.equal(percentualDePernoite(outra), 50);

  // O 30 vive na TABELA (padrão), e o cálculo lê dela.
  assert.equal(PERNOITE_PADRAO, 30);
  assert.equal(TABELA_PADRAO.pernoite_percentual, PERNOITE_PADRAO);
  const fonte = await read("src/lib/processosDiariasTabela.js");
  assert.doesNotMatch(fonte, /\*\s*1\.3\b/);
  assert.match(fonte, /percentualDePernoite\(tabela\)/);
});

/* -------------------------------------------------------------------------
 * Teste 4 -- quantidade × valor unitário
 * ---------------------------------------------------------------------- */

test("teste 4: quantidade × valor unitário dá o total certo", () => {
  const escolhido = aplicarTabelaDeDiarias(
    { diaria_faixa: "demais_regioes", diaria_categoria: "prefeito_vice", diaria_pernoite: true },
    TABELA_PADRAO,
  );
  assert.equal(escolhido.valor_unitario, 1130.18); // 869,37 + 30%

  const calculado = aplicarCalculo({ ...escolhido, quantidade_diarias: "2,5" });
  assert.equal(calculado.valor_total, 2825.45);

  // Meia diária e uma diária inteira, na mesma conta.
  assert.equal(aplicarCalculo({ quantidade_diarias: "0,5", valor_unitario: 97.78 }).valor_total, 48.89);
  assert.equal(aplicarCalculo({ quantidade_diarias: "3", valor_unitario: 271.67 }).valor_total, 815.01);
});

/* -------------------------------------------------------------------------
 * Teste 5 -- o valor digitado à mão
 * ---------------------------------------------------------------------- */

test("teste 5: o valor unitário continua editável à mão e a tabela não o sobrescreve", () => {
  const daTabela = aplicarTabelaDeDiarias(
    { diaria_faixa: "al_ate_100", diaria_categoria: "secretarios" },
    TABELA_PADRAO,
  );
  assert.equal(daTabela.valor_unitario, 271.67);

  const naMao = { ...daTabela, valor_unitario: 300, valor_unitario_manual: true };
  // Recalcular não devolve o valor da tabela por cima do que foi digitado.
  const depois = aplicarTabelaDeDiarias(naMao, TABELA_PADRAO);
  assert.equal(depois.valor_unitario, 300);
  assert.equal(unitarioDivergeDaTabela(depois, TABELA_PADRAO), true);

  // Voltar ao valor da tabela é uma decisão explícita da tela.
  const voltou = aplicarTabelaDeDiarias(
    { ...naMao, valor_unitario_manual: false },
    TABELA_PADRAO,
    { forcarValor: true },
  );
  assert.equal(voltou.valor_unitario, 271.67);
  assert.equal(unitarioDivergeDaTabela(voltou, TABELA_PADRAO), false);
});

test("teste 5: a alteração manual do valor unitário é registrada na auditoria", async () => {
  const anterior = { valor_unitario: 271.67, valor_unitario_manual: false };
  const novo = {
    valor_unitario: 300,
    valor_unitario_manual: true,
    diaria_faixa: "al_ate_100",
    diaria_categoria: "secretarios",
    diaria_pernoite: false,
  };
  const registro = alteracaoManualDeValorUnitario(anterior, novo);
  assert.equal(registro.valor_unitario, 300);
  assert.equal(registro.valor_unitario_anterior, 271.67);
  assert.equal(registro.diaria_faixa, "al_ate_100");

  // Sem alteração manual, nada é registrado.
  assert.equal(alteracaoManualDeValorUnitario(anterior, { ...anterior }), null);

  // E a gravação chama isso de fato, com nível de atenção.
  const dados = await read("src/lib/processosDiariasDados.js");
  assert.match(dados, /alteracaoManualDeValorUnitario/);
  assert.match(dados, /acao: "alterou_valor_unitario_manual"/);
  assert.match(dados, /acaoAuditoria: "alterou_valor_unitario_manual"/);
});

/* -------------------------------------------------------------------------
 * ⚠️ Teste 6 -- atualizar a tabela não altera processo já finalizado
 * ---------------------------------------------------------------------- */

test("teste 6: finalizar CONGELA valor, faixa, categoria, pernoite e versão da tabela", () => {
  const tabela = { ...TABELA_PADRAO, id: "8b1f2c40-0000-4000-8000-000000000001" };
  const formulario = aplicarTabelaDeDiarias(
    { diaria_faixa: "nordeste", diaria_categoria: "comissionados", diaria_pernoite: true },
    tabela,
  );
  const congelado = congelarTabelaNoProcesso(formulario, tabela);

  assert.equal(congelado.diaria_valor_unitario, 249.57); // 191,98 + 30%
  assert.equal(congelado.diaria_faixa, "nordeste");
  assert.equal(congelado.diaria_categoria, "comissionados");
  assert.equal(congelado.diaria_pernoite, true);
  assert.equal(congelado.diaria_pernoite_percentual, 30);
  assert.equal(congelado.diaria_tabela_id, tabela.id);
  assert.match(congelado.diaria_tabela_versao, /atualizada em 23\/03\/2026/);
  assert.equal(temTabelaCongelada(congelado), true);
});

test("teste 6: ⚠️ mudar a tabela depois NÃO muda o processo finalizado", () => {
  const tabelaDeOntem = { ...TABELA_PADRAO, id: "versao-1" };
  const finalizado = {
    ...processoDeExemplo({ situacao: "finalizada" }),
    ...congelarTabelaNoProcesso(
      aplicarTabelaDeDiarias(
        { diaria_faixa: "al_ate_100", diaria_categoria: "outros_agentes", diaria_pernoite: false },
        tabelaDeOntem,
      ),
      tabelaDeOntem,
    ),
  };
  assert.equal(finalizado.diaria_valor_unitario, 97.78);

  // A prefeitura publica uma tabela nova, com outro valor e outro percentual.
  const tabelaDeHoje = normalizarTabela({
    ...TABELA_PADRAO,
    id: "versao-2",
    atualizada_em: "2027-01-05",
    pernoite_percentual: 40,
    valores: {
      ...TABELA_PADRAO.valores,
      al_ate_100: { ...TABELA_PADRAO.valores.al_ate_100, outros_agentes: 150 },
    },
  });
  assert.equal(valorDaCelula(tabelaDeHoje, "al_ate_100", "outros_agentes"), 150);

  // O processo continua exatamente como estava: ele não consulta mais a tabela.
  assert.equal(finalizado.diaria_valor_unitario, 97.78);
  assert.equal(finalizado.diaria_pernoite_percentual, 30);
  assert.match(finalizado.diaria_tabela_versao, /23\/03\/2026/);
  assert.ok(textoDaOrigemDoValor(finalizado).startsWith(`Valor unitário ${formatBRL(97.78)}`));
  assert.match(textoDaOrigemDoValor(finalizado), /23\/03\/2026/);
});

test("teste 6: a versão anterior não é apagada -- publicar é INSERIR uma versão nova", async () => {
  const dados = await read("src/lib/processosDiariasTabelaDados.js");
  assert.match(dados, /\.insert\(\{/);
  // Nada de reescrever conteúdo nem de apagar a tabela antiga.
  assert.doesNotMatch(dados, /\.delete\(\)/);
  assert.doesNotMatch(dados, /update\(\{\s*titulo/);
  // O único update é a bandeira de vigência.
  const updates = dados.match(/\.update\(\{[^}]*\}\)/g) ?? [];
  assert.ok(updates.length > 0);
  updates.forEach((trecho) => assert.match(trecho, /vigente/));
  // E a alteração vai para a auditoria com o antes e o depois.
  assert.match(dados, /acao: "alterou_tabela_diarias"/);
  assert.match(dados, /valorAnterior: diferenca\.anterior/);
  assert.match(dados, /valorNovo: diferenca\.novo/);
});

test("teste 6: o banco também recusa reescrever o que o processo congelou", async () => {
  const sql = await read(`supabase/migrations/${MIGRATION_TABELA_DIARIAS}`);
  ["diaria_valor_unitario", "diaria_pernoite_percentual", "diaria_tabela_versao", "identidade_visual"]
    .forEach((coluna) => assert.match(sql, new RegExp(coluna)));
  // Congelado uma vez, congelado para sempre.
  assert.match(sql, /old\.diaria_tabela_versao is not null/i);
  assert.match(sql, /old\.diaria_valor_unitario is not null/i);
  assert.match(sql, /old\.identidade_visual is not null/i);
  assert.equal((sql.match(/raise exception/gi) ?? []).length >= 3, true);
});

test("teste 6: a diferença entre duas versões vai para a auditoria célula a célula", () => {
  const depois = {
    ...TABELA_PADRAO,
    atualizada_em: "2027-01-05",
    valores: {
      ...TABELA_PADRAO.valores,
      al_ate_100: { ...TABELA_PADRAO.valores.al_ate_100, outros_agentes: 150 },
    },
  };
  const diferenca = diferencaDaTabela(TABELA_PADRAO, depois);
  assert.equal(diferenca.houveAlteracao, true);
  const chave = "Estado de AL até 100 km · Outros Agentes";
  assert.equal(diferenca.anterior[chave], formatBRL(97.78));
  assert.equal(diferenca.novo[chave], formatBRL(150));
  assert.equal(diferenca.anterior.atualizada_em, "2026-03-23");

  // Tabela igual não gera evento de auditoria.
  assert.equal(diferencaDaTabela(TABELA_PADRAO, TABELA_PADRAO).houveAlteracao, false);
});

/* -------------------------------------------------------------------------
 * Teste 7 -- o "Tipo de Diária" no documento
 * ---------------------------------------------------------------------- */

test("teste 7: o Tipo de Diária é composto pelas escolhas e sai preenchido no documento", () => {
  assert.equal(
    tipoDiariaComposto({ faixa: "al_ate_100", categoria: "outros_agentes", pernoite: true }),
    "Estado de AL até 100 km — Outros Agentes — com pernoite",
  );
  assert.equal(
    tipoDiariaComposto({ faixa: "nordeste", categoria: "secretarios" }),
    "Outros Estados do NE — Secretários — sem pernoite",
  );

  const processo = processoDeExemplo({
    diaria_faixa: "al_ate_100",
    diaria_categoria: "outros_agentes",
    diaria_pernoite: true,
    tipo_diaria: "",
  });
  const dados = dadosDoDocumento(processo, { secretarias: SECRETARIAS });
  assert.equal(dados.servidor.tipoDiaria, "Estado de AL até 100 km — Outros Agentes — com pernoite");

  const html = htmlDoProcesso(dados, { escopo: "requisicao" });
  assert.match(html, /Estado de AL até 100 km — Outros Agentes — com pernoite/);

  // Quem escreveu o tipo à mão continua mandando no que sai impresso.
  const escrito = dadosDoDocumento(processoDeExemplo({ tipo_diaria: "Diária especial" }), {
    secretarias: SECRETARIAS,
  });
  assert.equal(escrito.servidor.tipoDiaria, "Diária especial");
});

/* -------------------------------------------------------------------------
 * Teste 8 -- o brasão nas três páginas
 * ---------------------------------------------------------------------- */

test("teste 8: o brasão sai nas TRÊS páginas, junto do rodapé institucional", () => {
  const dados = dadosDoDocumento(processoDeExemplo(), { secretarias: SECRETARIAS });
  const html = htmlDoProcesso(dados, { escopo: "completo" });

  assert.equal((html.match(/class="folha"/g) ?? []).length, 3);
  // Sem imagem preparada, o brasão vai embutido -- a folha nunca sai sem ele.
  assert.equal((html.match(/<svg /g) ?? []).length, 3);
  assert.equal((html.match(/class="rodape"/g) ?? []).length, 3);
  assert.match(html, /PREFEITURA MUNICIPAL DE SÃO JOSÉ DA LAJE/);
  assert.match(html, /Rua Dr\. Oscar Gordilho/);
});

test("teste 8: o brasão mora no repositório e não depende de link externo", async () => {
  const arquivo = (await read("public/brasao-sao-jose-da-laje.svg")).trim();
  assert.equal(arquivo, BRASAO_SVG, "o SVG embutido tem de ser o mesmo do arquivo do repositório");
  assert.equal(BRASAO_ARQUIVO, "/brasao-sao-jose-da-laje.svg");
  assert.equal(logoDoDocumento(IDENTIDADE_PADRAO), BRASAO_ARQUIVO);
  assert.equal(usaBrasaoDoRepositorio(IDENTIDADE_PADRAO), true);

  // Nenhum endereço de fora: nem CDN, nem link de imagem hospedada em terceiro.
  const documento = await read("src/lib/processosDiariasDocumento.js");
  assert.doesNotMatch(documento, /https?:\/\/(?!www\.w3\.org)/);
});

test("teste 8: a imagem enviada é impressa na proporção original, sem deformar", () => {
  const dados = dadosDoDocumento(processoDeExemplo(), {
    secretarias: SECRETARIAS,
    identidade: { ...IDENTIDADE_PADRAO, logo_url: "/brasao-enviado.png" },
    logo: {
      url: "/brasao-enviado.png",
      dataUrl: "data:image/png;base64,xxx",
      largura: 512,
      altura: 256,
      proporcao: 2,
    },
  });
  // A proporção viaja junto para que o desenho do PDF caiba na caixa sem esticar.
  assert.equal(dados.logo.proporcao, 2);
  assert.equal(dados.logo.largura / dados.logo.altura, 2);

  // No HTML, a altura manda e a largura é automática: nada de width+height fixos.
  const html = htmlDoProcesso(dados, { escopo: "requisicao" });
  assert.match(html, /<img class="brasao"/);
  assert.match(html, /width:\s*auto/);
  assert.match(html, /object-fit:\s*contain/);
});

test("teste 8: o brasão do PDF respeita a proporção e cabe na caixa", async () => {
  // O desenho do brasão no PDF mora no COMPONENTE COMPARTILHADO dos documentos:
  // é o mesmo cabeçalho para as cinco folhas do módulo, não uma cópia por
  // documento.
  const documento = await read("src/lib/processosDocumentoComum.js");
  assert.match(documento, /const largura = proporcao >= 1 \? lado : lado \* proporcao;/);
  assert.match(documento, /const altura = proporcao >= 1 \? lado \/ proporcao : lado;/);
  // Resolução de impressão: o raster é gerado grande e reduzido na folha.
  const preparo = await read("src/lib/processosIdentidadeDados.js");
  assert.match(preparo, /LADO_RASTER = 512/);
  assert.match(preparo, /imageSmoothingQuality = "high"/);
});

test("teste 8: ⚠️ trocar o brasão não altera documento já finalizado", () => {
  const identidadeDeOntem = normalizarIdentidade({
    orgao: "PREFEITURA MUNICIPAL DE SÃO JOSÉ DA LAJE",
    estado: "ESTADO DE ALAGOAS",
    rodape_endereco: "Endereço de 2026",
    rodape_contato: "Contato de 2026",
    logo_url: "/brasao-2026.png",
  });
  const finalizado = {
    ...processoDeExemplo({ situacao: "finalizada" }),
    ...congelarIdentidadeNoProcesso(identidadeDeOntem),
  };
  assert.equal(temIdentidadeCongelada(finalizado), true);

  const identidadeDeHoje = normalizarIdentidade({
    ...IDENTIDADE_PADRAO,
    rodape_endereco: "Endereço novo de 2027",
    logo_url: "/brasao-2027.png",
  });

  // O documento imprime a identidade CONGELADA, não a de hoje.
  const daFolha = identidadeDoProcesso(finalizado, identidadeDeHoje);
  assert.equal(daFolha.logo_url, "/brasao-2026.png");
  assert.equal(daFolha.rodape_endereco, "Endereço de 2026");

  const html = htmlDoProcesso(
    dadosDoDocumento(finalizado, { secretarias: SECRETARIAS, identidade: identidadeDeHoje }),
    { escopo: "completo" },
  );
  assert.match(html, /Endereço de 2026/);
  assert.doesNotMatch(html, /Endereço novo de 2027/);
  assert.doesNotMatch(html, /brasao-2027/);

  // E um brasão já rasterizado de OUTRA identidade é recusado na porta.
  const comLogoErrado = dadosDoDocumento(finalizado, {
    secretarias: SECRETARIAS,
    identidade: identidadeDeHoje,
    logo: { url: "/brasao-2027.png", dataUrl: "data:image/png;base64,xxx", proporcao: 1 },
  });
  assert.equal(comLogoErrado.logo, null);

  // O da própria identidade congelada, esse passa.
  const comLogoCerto = dadosDoDocumento(finalizado, {
    secretarias: SECRETARIAS,
    identidade: identidadeDeHoje,
    logo: { url: "/brasao-2026.png", dataUrl: "data:image/png;base64,xxx", proporcao: 1 },
  });
  assert.equal(comLogoCerto.logo.url, "/brasao-2026.png");
});

/* -------------------------------------------------------------------------
 * Teste 9 -- cada documento em uma página
 * ---------------------------------------------------------------------- */

test("teste 9: cada documento continua cabendo em UMA página", () => {
  const processo = processoDeExemplo({
    diaria_faixa: "demais_regioes",
    diaria_categoria: "prefeito_vice",
    diaria_pernoite: true,
    quantidade_diarias: "2,5",
    valor_unitario: 1130.18,
    valor_total: 2825.45,
    relatorio_prestacao: "Participação integral na reunião, com retorno no mesmo trajeto.",
  });
  const dados = dadosDoDocumento(processo, { secretarias: SECRETARIAS });

  assert.equal(montarPdfDoProcesso(dados, { escopo: "requisicao" }).getNumberOfPages(), 1);
  assert.equal(montarPdfDoProcesso(dados, { escopo: "liquidacao" }).getNumberOfPages(), 1);
  assert.equal(montarPdfDoProcesso(dados, { escopo: "prestacao" }).getNumberOfPages(), 1);
  // As três juntas: uma folha cada, nem uma a mais por causa do brasão.
  assert.equal(montarPdfDoProcesso(dados, { escopo: "completo" }).getNumberOfPages(), 3);
});

test("teste 9: texto institucional comprido encolhe para caber, e não empurra a folha", async () => {
  const identidade = {
    orgao: "PREFEITURA MUNICIPAL DE SÃO JOSÉ DA LAJE — SECRETARIA MUNICIPAL DE ADMINISTRAÇÃO E FINANÇAS",
    estado: "ESTADO DE ALAGOAS",
    rodape_endereco:
      "Rua Dr. Oscar Gordilho, 23 - Centro - São José da Laje - Alagoas - CEP 57860-000 - Brasil",
    rodape_contato:
      "Tel.: (82) 9.9395-5442 | E-mail: prefeitura@saojosedalaje.al.gov.br | CNPJ: 12.330.916/0001-99",
    logo_url: null,
  };
  const dados = dadosDoDocumento(processoDeExemplo(), { secretarias: SECRETARIAS, identidade });
  assert.equal(montarPdfDoProcesso(dados, { escopo: "completo" }).getNumberOfPages(), 3);

  // O encolhimento do texto institucional também é do componente comum.
  const documento = await read("src/lib/processosDocumentoComum.js");
  assert.match(documento, /textoQueCabe/);
  // O limite do cadastro existe para o texto nunca chegar absurdo na folha.
  assert.equal(primeiroErroDaIdentidade(validarIdentidade({ ...identidade, orgao: "A".repeat(300) })) !== null, true);
  assert.equal(primeiroErroDaIdentidade(validarIdentidade(identidade)), null);
});

/* -------------------------------------------------------------------------
 * Teste 10 -- nada disso mexe em dinheiro
 * ---------------------------------------------------------------------- */

test("teste 10: nada aqui debita conta, dá baixa, altera saldo ou cria pagamento", async () => {
  const arquivos = [
    "src/lib/processosDiariasTabela.js",
    "src/lib/processosDiariasTabelaDados.js",
    "src/lib/processosIdentidade.js",
    "src/lib/processosIdentidadeDados.js",
    "src/components/configuracoes/CategoriaProcessos.jsx",
  ];
  const proibido = [
    /from\("pagamentos"\)/,
    /from\("pagamento_movimentacoes"\)/,
    /from\("programacoes_pagamento"\)/,
    /from\("contas_bancarias"\)/,
    /from\("saldos_historico"\)/,
    /from\("notas_fiscais"\)/,
    /from\("fornecedores"\)/,
    /registrar_baixa|estornar_baixa|registrarBaixa/,
    /atualizarSaldo|lancarSaldo|debitarConta/i,
    /valor_pago|valor_em_aberto|saldo_atual/,
  ];
  const conteudos = await Promise.all(arquivos.map(read));
  conteudos.forEach((conteudo, i) => {
    proibido.forEach((padrao) =>
      assert.doesNotMatch(conteudo, padrao, `${arquivos[i]} não pode referenciar ${padrao}`),
    );
  });
});

test("teste 10: a migration é aditiva e não encosta em tabela financeira", async () => {
  const sql = await read(`supabase/migrations/${MIGRATION_TABELA_DIARIAS}`);
  assert.doesNotMatch(sql, /\bdrop table\b|\btruncate\b/i);
  [
    /alter table (public\.)?pagamentos\b/i,
    /alter table (public\.)?contas_bancarias\b/i,
    /alter table (public\.)?saldos_historico\b/i,
    /alter table (public\.)?programacoes_pagamento\b/i,
    /alter table (public\.)?notas_fiscais\b/i,
    /alter table (public\.)?fornecedores\b/i,
    /insert into public\.pagamentos/i,
  ].forEach((padrao) => assert.doesNotMatch(sql, padrao));

  // Ela só ACRESCENTA: a tabela nova, colunas novas e as políticas delas.
  assert.match(sql, /create table if not exists public\.processos_diarias_tabela/i);
  assert.match(sql, /alter table public\.processos_diarias\s+add column if not exists/i);
});

/* -------------------------------------------------------------------------
 * A permissão restrita (item 8 do comando)
 * ---------------------------------------------------------------------- */

test("editar a tabela exige permissão PRÓPRIA; ver a tabela acompanha ver Processos", () => {
  const soProcessos = resolverPermissoesDiarias({
    linhas: [{ modulo: MODULO_DIARIAS, pode_visualizar: true, pode_editar: true, pode_cadastrar: true }],
  });
  assert.equal(podeVerTabelaDeDiarias(soProcessos), true);
  // Editar processo NÃO libera editar a tabela.
  assert.equal(podeEditarTabelaDeDiarias(soProcessos), false);

  const comTabela = resolverPermissoesDiarias({
    linhas: [
      { modulo: MODULO_DIARIAS, pode_visualizar: true },
      { modulo: MODULO_DIARIAS_TABELA, pode_editar: true },
    ],
  });
  assert.equal(podeEditarTabelaDeDiarias(comTabela), true);

  const ninguem = resolverPermissoesDiarias({ linhas: [] });
  assert.equal(podeVerTabelaDeDiarias(ninguem), false);
  assert.equal(podeEditarTabelaDeDiarias(ninguem), false);
});

test("a tela soma a trava de Configurações à permissão própria da tabela", async () => {
  const tela = await read("src/components/configuracoes/CategoriaProcessos.jsx");
  assert.match(tela, /podeEditar && podeEditarTabelaDeDiarias\(permissoes\)/);
  assert.match(tela, /podeVerTabelaDeDiarias\(permissoes\)/);
});

/* -------------------------------------------------------------------------
 * A validação do cadastro e o aviso da migration
 * ---------------------------------------------------------------------- */

test("o cadastro recusa data ausente, percentual absurdo e valor impossível", () => {
  assert.equal(primeiroErroDaTabela(validarTabela(TABELA_PADRAO)), null);

  assert.match(
    primeiroErroDaTabela(validarTabela({ ...TABELA_PADRAO, atualizada_em: "" })),
    /data desta atualização/i,
  );
  assert.match(
    primeiroErroDaTabela(validarTabela({ ...TABELA_PADRAO, pernoite_percentual: 900 })),
    /acréscimo do pernoite/i,
  );
  const valores = {
    ...TABELA_PADRAO.valores,
    nordeste: { ...TABELA_PADRAO.valores.nordeste, secretarios: -5 },
  };
  assert.match(primeiroErroDaTabela(validarTabela({ ...TABELA_PADRAO, valores })), /fora do razoável/i);
});

test("banco sem a migration avisa que ela é rodada à mão no SQL Editor", () => {
  assert.match(AVISO_MIGRATION_TABELA, /SQL Editor do Supabase/);
  assert.match(AVISO_MIGRATION_TABELA, new RegExp(MIGRATION_TABELA_DIARIAS.replace(/\./g, "\\.")));
  assert.match(AVISO_MIGRATION_TABELA, /digitado à mão/);
});

test("a identidade visual guarda o antes e o depois para a auditoria", () => {
  const diferenca = diferencaDaIdentidade(IDENTIDADE_PADRAO, {
    ...IDENTIDADE_PADRAO,
    logo_url: "/brasao-novo.png",
  });
  assert.equal(diferenca.houveAlteracao, true);
  assert.equal(diferenca.anterior.logo_url, null);
  assert.equal(diferenca.novo.logo_url, "/brasao-novo.png");
  assert.equal(diferencaDaIdentidade(IDENTIDADE_PADRAO, IDENTIDADE_PADRAO).houveAlteracao, false);
});

test("a versão da tabela é identificável anos depois", () => {
  assert.equal(identificacaoDaVersao({ atualizada_em: "" , id: null}), "");
  assert.equal(
    identificacaoDaVersao({ ...TABELA_PADRAO, id: "8b1f2c40-aaaa-4000-8000-000000000001" }),
    "Tabela de Diárias — atualizada em 23/03/2026 (versão 8b1f2c40)",
  );
});
