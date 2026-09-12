import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ACOES_PREFEITA,
  AVISO_MIGRATION_PREFEITA,
  CARGO_PADRAO_PREFEITA,
  MODULO_PREFEITA,
  congelarPrefeitaNoProcesso,
  dadosDaPrefeitaParaDocumento,
  diferencaDaPrefeita,
  ordenarPrefeitas,
  podeEditarPrefeita,
  podeVerPrefeita,
  prefeitaDoProcesso,
  prefeitaParaBanco,
  prefeitaParaFormulario,
  prefeitaVazia,
  prefeitaVigente,
  primeiroErroDaPrefeita,
  resolverPermissoesPrefeita,
  temPrefeitaCongelada,
  textoDaVigencia,
} from "../src/lib/processosPrefeita.js";
import {
  ACEITE_DO_SELETOR,
  FORMATOS_ACEITOS,
  LIMITE_ARQUIVO_MB,
  LIMITE_LOGO_MB,
  caminhoNoBucket,
  extensaoDoNome,
  formatoDoArquivo,
  motivoDaFalhaDeEnvio,
  motivoDaRecusa,
  precisaReduzir,
  reduzirImagem,
  tamanhoLegivel,
} from "../src/lib/logomarcaImagem.js";
import {
  BRASAO_ARQUIVO,
  congelarIdentidadeNoProcesso,
  identidadeDoProcesso,
  logoDoDocumento,
  normalizarIdentidade,
  usaBrasaoDoRepositorio,
} from "../src/lib/processosIdentidade.js";
import { processoVazio } from "../src/lib/processosDiarias.js";
import {
  dadosDoDocumento,
  htmlDoProcesso,
  montarPdfDoProcesso,
} from "../src/lib/processosDiariasDocumento.js";
import {
  dadosDoDocumento as dadosDoServico,
  htmlDoProcesso as htmlDoServico,
  montarPdfDoProcesso as pdfDoServico,
} from "../src/lib/processosServicosDocumento.js";
import { processoVazio as servicoVazio } from "../src/lib/processosServicos.js";

/**
 * PROCESSOS · Prefeita, rodapé e envio da logomarca.
 *
 * Os treze testes exigidos no comando, na ordem em que foram pedidos:
 *
 *   1. cadastrar a prefeita e ver nome, CPF e cargo PRÉ-PREENCHIDOS no documento;
 *   2. ⚠️ alterar o cadastro depois NÃO altera processo já finalizado;
 *   3. o documento impresso não traz mais "Emitido em ... por ...";
 *   4. o rodapé institucional continua completo, com o CEP;
 *   5. PNG pequeno é aceito e aparece na miniatura, na prévia e no documento;
 *   6. JPG e SVG são aceitos;
 *   7. imagem acima de 2 MB é aceita e REDUZIDA, não recusada;
 *   8. arquivo inválido (PDF) é recusado COM MOTIVO;
 *   9. o envio funciona nas DUAS telas -- a origem é a mesma;
 *  10. a logomarca já cadastrada permanece intacta se nenhuma nova for enviada;
 *  11. a prévia confirma que o logo impresso é exatamente o cadastrado;
 *  12. processos já criados continuam abrindo normalmente;
 *  13. nada aqui altera saldo, baixa ou programação.
 */

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/** O código sem os comentários -- para conferir o que a tela MOSTRA, não o que
 * o arquivo explica. */
const semComentarios = (fonte) =>
  fonte
    .split("\n")
    .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
    .join("\n");

/** Texto literal dentro de expressão regular (o rodapé tem ponto e parêntese). */
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function textoDasFolhas(pdf) {
  const folhas = [];
  for (let n = 1; n < pdf.internal.pages.length; n += 1) {
    const bruto = pdf.internal.pages[n].join("\n");
    folhas.push([...bruto.matchAll(/\((.*?)\) Tj/g)].map((achado) => achado[1]).join(" | "));
  }
  return folhas;
}

const SECRETARIAS = [{ id: 3, nome: "Secretaria Municipal de Educação" }];

/** A prefeita como o cadastro a devolve. */
const PREFEITA = {
  id: "p-1",
  nome: "Ana Maria da Silva",
  cpf: "11122233344",
  cargo: "Prefeita Municipal",
  vigencia_inicio: "2025-01-01",
  vigencia_fim: null,
  situacao: "ativo",
};

/** A gestão seguinte: é ela que NÃO pode reescrever documento antigo. */
const PREFEITA_NOVA = {
  id: "p-2",
  nome: "Joana Pereira Lima",
  cpf: "55566677788",
  cargo: "Prefeita Municipal",
  vigencia_inicio: "2029-01-01",
  vigencia_fim: null,
  situacao: "ativo",
};

function diaria(extra = {}) {
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

function servico(extra = {}) {
  return {
    ...servicoVazio({ ano: 2026, hoje: "2026-03-10" }),
    id: 41,
    numero: 7,
    situacao: "rascunho",
    solicitante_id: 3,
    solicitante_nome: "Secretaria Municipal de Educação",
    tipo: "servicos",
    atestado: "servicos",
    objeto: "Manutenção dos aparelhos de ar-condicionado das escolas",
    itens: [{ quantidade: "12", discriminacao: "Manutenção preventiva" }],
    favorecido_nome: "Refrigeração Laje Ltda.",
    favorecido_cpf_cnpj: "12.345.678/0001-90",
    valor_total: 4800,
    ...extra,
  };
}

/** Um arquivo de mentira, com só o que o envio lê: nome, tipo e tamanho. */
function arquivoFalso(nome, tipo, bytes) {
  return { name: nome, type: tipo, size: bytes };
}

const KB = 1024;
const MB = 1024 * 1024;

/* -------------------------------------------------------------------------
 * 1. Cadastrar a prefeita e ver a identificação PRONTA no documento
 * ---------------------------------------------------------------------- */

test("1. o cadastro da prefeita existe, com nome, CPF, cargo, vigência e situação", () => {
  const vazia = prefeitaVazia();
  assert.equal(vazia.nome, "");
  assert.equal(vazia.cpf, "");
  // O cargo já vem sugerido, porque é o que a prefeitura imprime.
  assert.equal(vazia.cargo, CARGO_PADRAO_PREFEITA);
  assert.equal(vazia.situacao, "ativo");
  assert.equal(vazia.vigencia_inicio, "");
  assert.equal(vazia.vigencia_fim, "");

  // Os três campos obrigatórios recusam o cadastro pela metade, dizendo qual falta.
  assert.match(primeiroErroDaPrefeita({ ...vazia }), /nome/i);
  assert.match(primeiroErroDaPrefeita({ ...vazia, nome: "Ana" }), /CPF/i);
  assert.match(primeiroErroDaPrefeita({ ...vazia, nome: "Ana", cpf: "111" }), /CPF/i);
  assert.match(
    primeiroErroDaPrefeita({ ...vazia, nome: "Ana", cpf: "11122233344", cargo: "" }),
    /cargo/i,
  );
  // Período opcional -- e o fim nunca antes do início.
  assert.equal(primeiroErroDaPrefeita(prefeitaParaFormulario(PREFEITA)), null);
  assert.match(
    primeiroErroDaPrefeita({
      ...prefeitaParaFormulario(PREFEITA),
      vigencia_inicio: "2026-05-01",
      vigencia_fim: "2026-04-01",
    }),
    /fim da vigência/i,
  );

  // A vigência em branco é dita por escrito, não fica em silêncio.
  assert.equal(textoDaVigencia({ vigencia_inicio: null, vigencia_fim: null }), "Sem período definido");
  assert.match(textoDaVigencia(PREFEITA), /A partir de 01\/01\/2025/);

  const banco = prefeitaParaBanco(prefeitaParaFormulario(PREFEITA));
  assert.equal(banco.nome, "Ana Maria da Silva");
  assert.equal(banco.cpf, "111.222.333-44");
  assert.equal(banco.cargo, "Prefeita Municipal");
});

test("1. o documento de diária sai com nome, CPF e cargo da prefeita PREENCHIDOS", () => {
  const dados = dadosDoDocumento(diaria(), { secretarias: SECRETARIAS, prefeita: PREFEITA });
  assert.deepEqual(dados.prefeita, {
    nome: "Ana Maria da Silva",
    cpf: "111.222.333-44",
    cargo: "Prefeita Municipal",
  });

  const html = htmlDoProcesso(dados, { escopo: "completo" });

  // A área de autorização: "Ciente / Autorizo" com quem autoriza identificado.
  assert.match(html, /Autorização da Prefeita/);
  assert.match(html, /Ciente \/ Autorizo/);
  // A identificação abaixo da linha de assinatura, com os três campos.
  assert.match(html, /<div>Nome:<b>Ana Maria da Silva<\/b><\/div>/);
  assert.match(html, /<div>CPF:<b>111\.222\.333-44<\/b><\/div>/);
  assert.match(html, /<div>Cargo:<b>Prefeita Municipal<\/b><\/div>/);
  // E a assinatura da página 1 também deixa de ser redigitada.
  assert.match(html, /<strong>Ana Maria da Silva<\/strong>Assinatura da Prefeita/);

  const folhas = textoDasFolhas(montarPdfDoProcesso(dados, { escopo: "completo" }));
  const impresso = folhas.join(" || ");
  assert.ok(impresso.includes("Ana Maria da Silva"));
  assert.ok(impresso.includes("111.222.333-44"));
  assert.ok(impresso.includes("Prefeita Municipal"));
});

test("1. o documento de serviços/materiais sai com a mesma identificação pronta", () => {
  const dados = dadosDoServico(servico(), { secretarias: SECRETARIAS, prefeita: PREFEITA });
  const html = htmlDoServico(dados, { escopo: "completo" });

  assert.match(html, /<strong>Ana Maria da Silva<\/strong>PREFEITA/);
  assert.match(html, /Prefeita Municipal — CPF: 111\.222\.333-44/);

  const impresso = textoDasFolhas(pdfDoServico(dados, { escopo: "completo" })).join(" || ");
  assert.ok(impresso.includes("Ana Maria da Silva"));
  assert.ok(impresso.includes("111.222.333-44"));
});

test("1. sem cadastro, as linhas da prefeita saem EM BRANCO para preencher à mão", () => {
  const dados = dadosDoDocumento(diaria(), { secretarias: SECRETARIAS });
  assert.deepEqual(dados.prefeita, { nome: "", cpf: "", cargo: "" });

  const html = htmlDoProcesso(dados, { escopo: "completo" });
  // As linhas continuam lá, só sem valor -- é o papel de antes deste cadastro.
  assert.match(html, /<div>Nome:<\/div>/);
  assert.match(html, /<div>CPF:<\/div>/);
  assert.match(html, /Assinatura da Prefeita/);
  assert.doesNotMatch(html, /undefined|null/);
});

test("1. a tela do cadastro está em Configurações → Processos, com permissão própria", async () => {
  const [tela, permissoes] = await Promise.all([
    read("src/components/configuracoes/CategoriaProcessos.jsx"),
    read("src/lib/permissoesUsuario.js"),
  ]);
  assert.match(tela, /function BlocoPrefeita/);
  assert.match(tela, /<BlocoPrefeita/);
  assert.match(tela, /criarPrefeita/);
  assert.match(tela, /salvarPrefeita/);
  assert.match(tela, /alternarSituacaoDaPrefeita/);
  // Duas travas somadas: a da tela de Configurações e a própria do cadastro.
  assert.match(tela, /podeEditar && podeEditarPrefeita\(permissoesPrefeita\)/);

  // O módulo aparece na tela de permissões, com as duas ações.
  assert.match(permissoes, /id: "processos_prefeita"/);
  assert.equal(MODULO_PREFEITA, "processos_prefeita");
  assert.deepEqual(ACOES_PREFEITA.map((a) => a.chave), ["visualizar", "editar"]);

  // EDITAR NÃO SE HERDA: sem a linha do módulo próprio, ninguém edita.
  const semLinha = resolverPermissoesPrefeita({ linhas: [{ modulo: "processos_diarias", pode_editar: true }] });
  assert.equal(podeVerPrefeita(semLinha), false);
  assert.equal(podeEditarPrefeita(semLinha), false);
  const soConsulta = resolverPermissoesPrefeita({
    linhas: [{ modulo: MODULO_PREFEITA, pode_visualizar: true, pode_editar: false }],
  });
  assert.equal(podeVerPrefeita(soConsulta), true);
  assert.equal(podeEditarPrefeita(soConsulta), false);
});

test("1. toda alteração do cadastro vai para a auditoria", async () => {
  const dados = await read("src/lib/processosCadastrosDados.js");
  const trecho = dados.slice(dados.indexOf("export async function criarPrefeita"));
  ["criarPrefeita", "salvarPrefeita", "alternarSituacaoDaPrefeita"].forEach((funcao) => {
    assert.match(trecho, new RegExp(`export async function ${funcao}`));
  });
  // As três gravações passam pela trilha -- nenhuma altera cadastro em silêncio.
  assert.ok((trecho.match(/await auditar\(/g) ?? []).length >= 3);
  assert.match(dados, /async function auditar[\s\S]{0,400}registrarEvento\(/);

  // A diferença registrada nomeia os campos, para a trilha ser legível.
  const mudanca = diferencaDaPrefeita(PREFEITA, { ...PREFEITA, nome: "Joana" });
  assert.equal(mudanca.houveAlteracao, true);
  assert.deepEqual(mudanca.novo, { nome: "Joana" });
});

/* -------------------------------------------------------------------------
 * 2. ⚠️ Alterar o cadastro depois NÃO altera processo já finalizado
 * ---------------------------------------------------------------------- */

test("2. processo finalizado imprime a prefeita CONGELADA, não a do cadastro novo", () => {
  // Finalizar guarda dentro do processo os três campos que o papel imprime.
  const congelado = congelarPrefeitaNoProcesso(PREFEITA);
  assert.deepEqual(congelado.prefeita, {
    nome: "Ana Maria da Silva",
    cpf: "111.222.333-44",
    cargo: "Prefeita Municipal",
  });

  const finalizado = diaria({ situacao: "finalizada", ...congelado });
  assert.equal(temPrefeitaCongelada(finalizado), true);

  // MUDANÇA DE GESTÃO: o cadastro agora traz outra pessoa. O documento antigo
  // continua com quem assinou.
  const dados = dadosDoDocumento(finalizado, { secretarias: SECRETARIAS, prefeita: PREFEITA_NOVA });
  assert.equal(dados.prefeita.nome, "Ana Maria da Silva");
  assert.equal(dados.prefeita.cpf, "111.222.333-44");

  const html = htmlDoProcesso(dados, { escopo: "completo" });
  assert.match(html, /Ana Maria da Silva/);
  assert.doesNotMatch(html, /Joana Pereira Lima/);
  assert.doesNotMatch(html, /555\.666\.777-88/);

  const impresso = textoDasFolhas(montarPdfDoProcesso(dados, { escopo: "completo" })).join(" || ");
  assert.ok(impresso.includes("Ana Maria da Silva"));
  assert.ok(!impresso.includes("Joana Pereira Lima"));

  // O mesmo no módulo de serviços/materiais.
  const servicoFinalizado = servico({ situacao: "finalizada", ...congelado });
  const doServico = dadosDoServico(servicoFinalizado, {
    secretarias: SECRETARIAS,
    prefeita: PREFEITA_NOVA,
  });
  assert.equal(doServico.prefeita.nome, "Ana Maria da Silva");
  assert.doesNotMatch(htmlDoServico(doServico, { escopo: "completo" }), /Joana Pereira Lima/);

  // Rascunho, ao contrário, imprime a vigente: ele ainda não congelou nada.
  const rascunho = dadosDoDocumento(diaria(), { secretarias: SECRETARIAS, prefeita: PREFEITA_NOVA });
  assert.equal(rascunho.prefeita.nome, "Joana Pereira Lima");
  assert.equal(prefeitaDoProcesso(diaria(), PREFEITA_NOVA).nome, "Joana Pereira Lima");
});

test("2. o congelamento acontece JUNTO com a finalização, e o banco recusa reescrevê-lo", async () => {
  const [diarias, servicos, migration] = await Promise.all([
    read("src/lib/processosDiariasDados.js"),
    read("src/lib/processosServicosDados.js"),
    read("supabase/migrations/20260912140000_processos_prefeita.sql"),
  ]);

  // A coluna congelada é escrita na MESMA gravação que fecha o documento.
  [diarias, servicos].forEach((arquivo) => {
    assert.match(arquivo, /congelarPrefeitaNoProcesso/);
    assert.match(arquivo, /CAMPOS_CONGELADOS[\s\S]{0,400}"prefeita"/);
  });

  // E o gatilho do banco não deixa alterar o que já foi congelado.
  assert.match(migration, /não podem ser alterados/);
  assert.ok((migration.match(/old\.prefeita is not null/g) ?? []).length >= 2);
  assert.match(migration, /'identidade_visual', 'prefeita'/);

  // Cadastro sem os três campos não congela nada -- não grava lixo no processo.
  assert.deepEqual(congelarPrefeitaNoProcesso(null), {});
  assert.deepEqual(congelarPrefeitaNoProcesso({ nome: "  " }), {});
});

test("2. a prefeita EM VIGOR é escolhida pelo cadastro, e a gestão anterior é inativada", () => {
  const cadastro = [
    { ...PREFEITA, vigencia_fim: "2028-12-31" },
    { ...PREFEITA_NOVA, situacao: "inativo" },
  ];
  // Dentro da vigência e ativa: é ela que preenche o documento.
  assert.equal(prefeitaVigente(cadastro, { hoje: "2026-03-10" })?.id, "p-1");
  // A inativa nunca é escolhida, mesmo sendo a mais recente.
  assert.equal(prefeitaVigente([{ ...PREFEITA_NOVA, situacao: "inativo" }], { hoje: "2030-01-01" }), null);
  // Ativas primeiro na lista da tela, começo mais recente no topo.
  assert.deepEqual(
    ordenarPrefeitas(cadastro).map((p) => p.id),
    ["p-1", "p-2"],
  );
  // Cadastro vazio não inventa ninguém.
  assert.equal(prefeitaVigente([]), null);
  assert.deepEqual(dadosDaPrefeitaParaDocumento(null), { nome: "", cpf: "", cargo: "" });
  assert.match(AVISO_MIGRATION_PREFEITA, /20260912140000_processos_prefeita\.sql/);
});

/* -------------------------------------------------------------------------
 * 3. O documento não traz mais "Emitido em ... por ..."
 * ---------------------------------------------------------------------- */

test("3. nenhuma folha dos dois módulos imprime 'Emitido em ... por ...'", () => {
  const daDiaria = dadosDoDocumento(diaria({ situacao: "finalizada" }), {
    secretarias: SECRETARIAS,
    emissor: "Carlos Operador",
    emissao: "10/03/2026 08:15",
    prefeita: PREFEITA,
  });
  const doServico = dadosDoServico(servico({ situacao: "finalizada" }), {
    secretarias: SECRETARIAS,
    emissor: "Carlos Operador",
    emissao: "10/03/2026 08:15",
    prefeita: PREFEITA,
  });

  [
    htmlDoProcesso(daDiaria, { escopo: "completo" }),
    htmlDoServico(doServico, { escopo: "completo" }),
  ].forEach((html) => {
    assert.doesNotMatch(html, /Emitido em/i);
    assert.doesNotMatch(html, /Carlos Operador/);
    assert.doesNotMatch(html, /08:15/);
  });

  [
    textoDasFolhas(montarPdfDoProcesso(daDiaria, { escopo: "completo" })),
    textoDasFolhas(pdfDoServico(doServico, { escopo: "completo" })),
  ].forEach((folhas) => {
    assert.ok(folhas.length >= 2);
    folhas.forEach((folha) => {
      assert.ok(!folha.includes("Emitido em"));
      assert.ok(!folha.includes("Carlos Operador"));
    });
  });

  // A informação não foi perdida: ela continua no processo, dentro do sistema.
  assert.equal(daDiaria.emissor, "Carlos Operador");
  assert.equal(daDiaria.emissao, "10/03/2026 08:15");
  assert.equal(doServico.emissor, "Carlos Operador");
});

test("3. o histórico dentro do sistema continua registrando quem imprimiu", async () => {
  const dados = await read("src/lib/processosDiariasDados.js");
  assert.match(dados, /registrarSaidaDoDocumento/);
  assert.match(dados, /imprimiu|gerou_pdf/);
});

/* -------------------------------------------------------------------------
 * 4. O rodapé institucional continua completo, com o CEP
 * ---------------------------------------------------------------------- */

const RODAPE_ENDERECO = "Rua Dr. Oscar Gordilho, 23 – Centro – CEP: 57.860-000 – São José da Laje – Alagoas";
const RODAPE_CONTATO = "Tel.: (82) 99395-5442 – E-mail: prefeitura@saojosedalaje.al.gov.br";
const RODAPE_CNPJ = "CNPJ: 12.330.916/0001-99";

test("4. as três linhas do rodapé saem em TODAS as folhas dos dois módulos", () => {
  const daDiaria = dadosDoDocumento(diaria(), { secretarias: SECRETARIAS, prefeita: PREFEITA });
  const doServico = dadosDoServico(servico(), { secretarias: SECRETARIAS, prefeita: PREFEITA });

  const htmlDiaria = htmlDoProcesso(daDiaria, { escopo: "completo" });
  const htmlServico = htmlDoServico(doServico, { escopo: "completo" });

  [
    [htmlDiaria, 3],
    [htmlServico, 2],
  ].forEach(([html, folhas]) => {
    assert.equal((html.match(/class="rodape"/g) ?? []).length, folhas);
    [RODAPE_ENDERECO, RODAPE_CONTATO, RODAPE_CNPJ].forEach((linha) => {
      assert.equal((html.match(new RegExp(escapar(linha), "g")) ?? []).length, folhas);
    });
  });

  [
    textoDasFolhas(montarPdfDoProcesso(daDiaria, { escopo: "completo" })),
    textoDasFolhas(pdfDoServico(doServico, { escopo: "completo" })),
  ].forEach((folhas) => {
    folhas.forEach((folha) => {
      assert.ok(folha.includes("CEP: 57.860-000"), "o CEP tem de estar no rodapé impresso");
      assert.ok(folha.includes("prefeitura@saojosedalaje.al.gov.br"));
      assert.ok(folha.includes("CNPJ: 12.330.916/0001-99"));
    });
  });
});

/* -------------------------------------------------------------------------
 * 5 a 8. O envio da imagem -- o defeito que dizia sempre a mesma frase
 * ---------------------------------------------------------------------- */

test("5. um PNG pequeno é ACEITO, sem redução e sem recusa", () => {
  const png = arquivoFalso("brasao.png", "image/png", 40 * KB);
  assert.equal(motivoDaRecusa(png), null);
  assert.equal(precisaReduzir(png), false);
  assert.equal(formatoDoArquivo(png).rotulo, "PNG");
  assert.equal(caminhoNoBucket("logomarca", png, { agora: 1, sorteio: "abc123" }), "logomarca/1-abc123.png");

  // PNG de poucos KB era exatamente o caso que a tela recusava.
  assert.equal(motivoDaRecusa(arquivoFalso("iPad.PNG", "", 6 * KB)), null);
  assert.equal(extensaoDoNome("iPad.PNG"), "png");
});

test("5. a imagem aceita aparece na miniatura, na prévia e no documento", () => {
  const enviada = "https://exemplo.supabase.co/storage/v1/object/public/configuracoes/processos-brasao/1-a.png";
  const identidade = normalizarIdentidade({ logo_url: enviada });

  // Miniatura da tela e endereço impresso são a MESMA conta.
  assert.equal(logoDoDocumento(identidade), enviada);
  assert.equal(usaBrasaoDoRepositorio(identidade), false);

  // Prévia e documento: o endereço entra no <img> da folha.
  const dados = dadosDoDocumento(diaria(), { secretarias: SECRETARIAS, identidade });
  assert.equal(dados.logoEndereco, enviada);
  const html = htmlDoProcesso(dados, { escopo: "completo" });
  assert.equal((html.match(new RegExp(`src="${escapar(enviada)}"`, "g")) ?? []).length, 3);
});

test("6. JPG e SVG são aceitos, e o seletor os oferece por nome", () => {
  const jpg = arquivoFalso("brasao.jpg", "image/jpeg", 300 * KB);
  const svg = arquivoFalso("brasao.svg", "image/svg+xml", 12 * KB);

  assert.equal(motivoDaRecusa(jpg), null);
  assert.equal(motivoDaRecusa(svg), null);
  assert.equal(formatoDoArquivo(jpg).rotulo, "JPG");
  assert.equal(formatoDoArquivo(svg).rotulo, "SVG");

  // SVG é vetor: nunca é rasterizado no envio, para não perder qualidade.
  assert.equal(precisaReduzir(arquivoFalso("grande.svg", "image/svg+xml", 9 * MB)), false);

  // Extensão sem tipo declarado (acontece em alguns sistemas) também passa.
  assert.equal(motivoDaRecusa(arquivoFalso("brasao.jpeg", "", 200 * KB)), null);
  assert.equal(motivoDaRecusa(arquivoFalso("brasao.svg", "", 10 * KB)), null);

  assert.deepEqual(FORMATOS_ACEITOS.map((f) => f.rotulo), ["PNG", "JPG", "SVG"]);
  ["image/png", "image/jpeg", "image/svg+xml"].forEach((mime) => {
    assert.ok(ACEITE_DO_SELETOR.includes(mime));
  });
});

test("7. imagem acima de 2 MB é ACEITA e reduzida -- não é mais recusada", () => {
  const grande = arquivoFalso("foto.png", "image/png", 5 * MB);
  assert.equal(LIMITE_LOGO_MB, 2);
  assert.equal(motivoDaRecusa(grande), null, "acima de 2 MB não é motivo de recusa");
  assert.equal(precisaReduzir(grande), true);

  // Outro formato de imagem (WEBP, HEIC...) entra convertido, não recusado.
  const webp = arquivoFalso("captura.webp", "image/webp", 500 * KB);
  assert.equal(motivoDaRecusa(webp), null);
  assert.equal(precisaReduzir(webp), true);
  assert.equal(formatoDoArquivo(webp).mime, "image/png");

  // Só o teto absoluto recusa, e a recusa diz o tamanho.
  const enorme = arquivoFalso("mapa.png", "image/png", 40 * MB);
  const recusa = motivoDaRecusa(enorme);
  assert.equal(recusa.codigo, "tamanho");
  assert.match(recusa.mensagem, new RegExp(`${LIMITE_ARQUIVO_MB} MB`));
  assert.match(recusa.mensagem, /40 MB/);
  assert.equal(tamanhoLegivel(40 * MB), "40 MB");
});

test("7. sem navegador (sem canvas) a redução não derruba nada: devolve null", async () => {
  assert.equal(await reduzirImagem(arquivoFalso("foto.png", "image/png", 5 * MB)), null);
});

test("8. arquivo inválido é recusado COM MOTIVO, dizendo o que o sistema aceita", () => {
  const pdf = arquivoFalso("oficio.pdf", "application/pdf", 80 * KB);
  const recusa = motivoDaRecusa(pdf);
  assert.equal(recusa.codigo, "formato");
  assert.match(recusa.mensagem, /PDF/);
  assert.match(recusa.mensagem, /JPG, PNG ou SVG/);
  assert.equal(formatoDoArquivo(pdf).aceito, false);

  // Nada escolhido também tem frase própria.
  assert.equal(motivoDaRecusa(null, { rotuloDaImagem: "a logomarca" }).codigo, "sem_arquivo");
  assert.match(motivoDaRecusa(null, { rotuloDaImagem: "a logomarca" }).mensagem, /a logomarca/);

  // Planilha, texto, zip: recusa nomeando o que foi escolhido.
  [
    ["planilha.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["arquivo.zip", "application/zip"],
  ].forEach(([nome, tipo]) => {
    const problema = motivoDaRecusa(arquivoFalso(nome, tipo, 10 * KB));
    assert.equal(problema.codigo, "formato");
    assert.match(problema.mensagem, /JPG, PNG ou SVG/);
  });
});

test("8. a recusa do SERVIDOR é traduzida pelo motivo real, com o erro técnico no console", async () => {
  const casos = [
    [{ message: "Bucket not found", statusCode: "404" }, "bucket_ausente", /bucket 'configuracoes'/],
    [
      { message: "new row violates row-level security policy", statusCode: "403" },
      "permissao",
      /permissão/i,
    ],
    [{ message: "mime type application/pdf is not supported", statusCode: "400" }, "formato_servidor", /JPG, PNG ou SVG/],
    [{ message: "The object exceeded the maximum allowed size", statusCode: "413" }, "tamanho_servidor", /tamanho/i],
    [{ message: "Failed to fetch" }, "conexao", /conexão/i],
  ];
  casos.forEach(([erro, codigo, frase]) => {
    const motivo = motivoDaFalhaDeEnvio(erro);
    assert.equal(motivo.codigo, codigo);
    assert.match(motivo.mensagem, frase);
    // A frase genérica antiga não volta em nenhum caso nomeado.
    assert.doesNotMatch(motivo.mensagem, /Tente outra imagem/);
  });

  // Falha que não dá para nomear manda ao console -- em vez de calar o motivo.
  const desconhecida = motivoDaFalhaDeEnvio({ statusCode: 500, message: "boom" });
  assert.equal(desconhecida.codigo, "desconhecida");
  assert.match(desconhecida.mensagem, /console do navegador \(F12\)/);
  assert.match(desconhecida.mensagem, /nada foi alterado/);

  // E o erro técnico completo é escrito no console, não descartado.
  const envio = await read("src/lib/logomarcaImagem.js");
  assert.match(envio, /console\.error\(/);
  assert.match(envio, /registrarFalhaTecnica/);
});

/* -------------------------------------------------------------------------
 * 9. O envio funciona nas DUAS telas -- a origem é a mesma
 * ---------------------------------------------------------------------- */

test("9. Aparência e Processos → Identidade visual passam pela MESMA origem de envio", async () => {
  const [aparencia, processos, envio] = await Promise.all([
    read("src/lib/configuracoesSistema.js"),
    read("src/lib/processosIdentidadeDados.js"),
    read("src/lib/logomarcaEnvio.js"),
  ]);

  // As duas telas chamam a mesma função, cada uma na sua pasta do bucket.
  assert.match(aparencia, /enviarImagemDeIdentidade\(arquivo, \{\s*pasta: "logomarca"/);
  assert.match(processos, /enviarImagemDeIdentidade\(arquivo, \{\s*pasta: PASTA_BRASAO/);

  // A frase genérica que aparecia para QUALQUER imagem não é mais mostrada em
  // lugar nenhum. Ela sobrevive só onde deve: no comentário que explica o
  // defeito corrigido.
  [aparencia, processos, envio].forEach((arquivo) => {
    assert.doesNotMatch(semComentarios(arquivo), /Tente outra imagem/);
  });

  // Nenhuma das duas guarda cópia própria das regras de formato/tamanho.
  [aparencia, processos].forEach((arquivo) => {
    assert.doesNotMatch(arquivo, /\^image\\\//);
    assert.doesNotMatch(arquivo, /storage\.from\(BUCKET_CONFIGURACOES\)\.upload/);
  });

  // E existe a segunda porta, para banco onde a política do Storage não existe.
  const regras = await read("src/lib/logomarcaImagem.js");
  assert.match(regras, /ROTA_ENVIO_SERVIDOR = "\/api\/configuracoes\/logomarca"/);
  assert.match(envio, /subirPelaFuncao/);
  const funcao = await read("netlify/functions/enviar-logomarca.mts");
  assert.match(funcao, /configuracoes/);
  assert.match(funcao, /pode_editar_configuracoes|administracao/);
});

test("9. o seletor das duas telas aceita JPG, PNG e SVG e avisa da redução", async () => {
  const comuns = await read("src/components/configuracoes/comuns.jsx");
  assert.match(comuns, /accept=\{ACEITE_DO_SELETOR\}/);
  assert.match(comuns, /JPG, PNG ou SVG/);
  assert.match(comuns, /reduzida automaticamente/);
});

/* -------------------------------------------------------------------------
 * 10 e 11. A logomarca cadastrada é preservada -- e é ela que imprime
 * ---------------------------------------------------------------------- */

test("10. a logomarca já cadastrada permanece intacta quando nenhuma nova é enviada", async () => {
  const [processos, aparencia] = await Promise.all([
    read("src/components/configuracoes/CategoriaProcessos.jsx"),
    read("src/components/configuracoes/CategoriaAparencia.jsx"),
  ]);
  // Sem arquivo escolhido, o endereço gravado é o que já estava lá.
  assert.match(processos, /arquivo \? await enviarBrasaoProcessos\(arquivo\) : rascunho\?\.logo_url \?\? null/);
  // Em Aparência, a logomarca só é regravada quando foi alterada na tela.
  assert.match(aparencia, /if \(logoAlterada\) \{/);

  // E a conta do endereço impresso preserva o que está cadastrado.
  const identidade = normalizarIdentidade({ logo_url: "https://exemplo/brasao.png" });
  assert.equal(logoDoDocumento(identidade, "https://exemplo/logo-sistema.png"), "https://exemplo/brasao.png");
  assert.equal(logoDoDocumento(normalizarIdentidade({}), "https://exemplo/logo-sistema.png"), "https://exemplo/logo-sistema.png");
  assert.equal(logoDoDocumento(normalizarIdentidade({})), BRASAO_ARQUIVO);
});

test("11. o logo impresso é EXATAMENTE o cadastrado; o do repositório é só a falta dele", () => {
  const doSistema = "https://exemplo/logo-do-sistema.png";

  // Nada cadastrado em Processos, logomarca cadastrada em Aparência: é ela que
  // sai no papel -- era este o defeito, o documento saía com o brasão genérico.
  const identidade = normalizarIdentidade({});
  assert.equal(logoDoDocumento(identidade, doSistema), doSistema);
  assert.equal(usaBrasaoDoRepositorio(identidade, doSistema), false);

  const dados = dadosDoDocumento(diaria(), { secretarias: SECRETARIAS, identidade, logoSistema: doSistema });
  assert.equal(dados.logoEndereco, doSistema);
  const html = htmlDoProcesso(dados, { escopo: "completo" });
  assert.equal((html.match(new RegExp(`src="${escapar(doSistema)}"`, "g")) ?? []).length, 3);
  // A proporção original é preservada: altura fixa e largura só como teto.
  assert.match(html, /style="height:16mm;max-width:[\d.]+mm"/);
  assert.doesNotMatch(html, /width:\s*\d+mm;height:\s*\d+mm/);

  // Sem nada cadastrado em lugar nenhum: só aí entra o brasão do repositório.
  const semNada = dadosDoDocumento(diaria(), { secretarias: SECRETARIAS });
  assert.equal(semNada.logoEndereco, BRASAO_ARQUIVO);
  assert.ok(htmlDoProcesso(semNada, { escopo: "completo" }).includes("<svg"));

  // O logo rasterizado só é usado se veio DAQUELE endereço: assim a prévia e a
  // impressão nunca mostram uma imagem de outra origem.
  const deOutraOrigem = dadosDoDocumento(diaria(), {
    secretarias: SECRETARIAS,
    identidade,
    logoSistema: doSistema,
    logo: { url: "https://exemplo/OUTRA.png", dataUrl: "data:image/png;base64,AAA" },
  });
  assert.equal(deOutraOrigem.logo, null);
  const doMesmo = dadosDoDocumento(diaria(), {
    secretarias: SECRETARIAS,
    identidade,
    logoSistema: doSistema,
    logo: { url: doSistema, dataUrl: "data:image/png;base64,AAA" },
  });
  assert.equal(doMesmo.logo.dataUrl, "data:image/png;base64,AAA");
});

test("11. a miniatura da tela e a prévia usam a mesma conta do endereço impresso", async () => {
  const [tela, previaDiaria, previaServico, pagina] = await Promise.all([
    read("src/components/configuracoes/CategoriaProcessos.jsx"),
    read("src/components/processos/PreVisualizacaoProcesso.jsx"),
    read("src/components/processos/PreVisualizacaoProcessoServico.jsx"),
    read("src/components/processos/PaginaDiarias.jsx"),
  ]);
  assert.match(tela, /urlAtual=\{logoDoDocumento\(pronta, logoSistema\)\}/);
  assert.match(tela, /usaBrasaoDoRepositorio\(pronta, logoSistema\)/);
  [previaDiaria, previaServico].forEach((arquivo) => {
    assert.match(arquivo, /logoSistema/);
    assert.match(arquivo, /prefeita/);
  });
  assert.match(pagina, /prepararLogoParaDocumento\(logoDoDocumento\(daFolha, logoSistema\)\)/);
  assert.match(pagina, /carregarLogomarcaDoSistema/);
});

test("11. o endereço do logo é congelado junto com o processo", () => {
  const congelado = congelarIdentidadeNoProcesso(normalizarIdentidade({}), "https://exemplo/logo.png");
  // O que o documento imprimiu fica guardado: trocar a logomarca do sistema
  // depois não reescreve o papel antigo.
  assert.equal(congelado.identidade_visual.logo_url, "https://exemplo/logo.png");

  const finalizado = diaria({ situacao: "finalizada", ...congelado });
  const daFolha = identidadeDoProcesso(finalizado, normalizarIdentidade({ logo_url: "https://exemplo/NOVA.png" }));
  assert.equal(logoDoDocumento(daFolha, "https://exemplo/OUTRA.png"), "https://exemplo/logo.png");

  // Sem nada cadastrado, o congelamento não finge que havia imagem.
  assert.equal(congelarIdentidadeNoProcesso(normalizarIdentidade({})).identidade_visual.logo_url, null);
});

/* -------------------------------------------------------------------------
 * 12. Processos já criados continuam abrindo normalmente
 * ---------------------------------------------------------------------- */

test("12. processo antigo, sem a coluna nova, abre e imprime sem erro", () => {
  // Um processo gravado antes desta entrega: nem prefeita, nem identidade.
  const antigo = diaria({ situacao: "finalizada" });
  delete antigo.prefeita;
  delete antigo.identidade_visual;

  assert.equal(temPrefeitaCongelada(antigo), false);
  const dados = dadosDoDocumento(antigo, { secretarias: SECRETARIAS, prefeita: PREFEITA });
  // Ele imprime a vigente, porque não congelou nada -- e não quebra.
  assert.equal(dados.prefeita.nome, "Ana Maria da Silva");
  const html = htmlDoProcesso(dados, { escopo: "completo" });
  assert.equal((html.match(/class="folha"/g) ?? []).length, 3);
  assert.equal(montarPdfDoProcesso(dados, { escopo: "completo" }).getNumberOfPages(), 3);

  const antigoServico = servico({ situacao: "finalizada" });
  delete antigoServico.prefeita;
  const doServico = dadosDoServico(antigoServico, { secretarias: SECRETARIAS, prefeita: PREFEITA });
  assert.equal((htmlDoServico(doServico, { escopo: "completo" }).match(/class="folha"/g) ?? []).length, 2);
});

test("12. banco sem a migration nova continua listando e finalizando processos", async () => {
  const [diarias, servicos] = await Promise.all([
    read("src/lib/processosDiariasDados.js"),
    read("src/lib/processosServicosDados.js"),
  ]);
  [diarias, servicos].forEach((arquivo) => {
    // A leitura tem seleção de reserva, sem a coluna nova.
    assert.match(arquivo, /SELECAO_SEM_PREFEITA/);
    assert.match(arquivo, /colunaDaPrefeitaAusente/);
    // E os códigos de "coluna não existe" são tratados, não propagados.
    assert.match(arquivo, /42703|PGRST204/);
  });
});

/* -------------------------------------------------------------------------
 * 13. Nada aqui altera saldo, baixa ou programação
 * ---------------------------------------------------------------------- */

const ARQUIVOS_TOCADOS = [
  "src/lib/processosPrefeita.js",
  "src/lib/logomarcaEnvio.js",
  "src/lib/processosCadastrosDados.js",
  "src/lib/processosIdentidade.js",
  "src/lib/processosIdentidadeDados.js",
  "src/lib/processosDiariasDados.js",
  "src/lib/processosServicosDados.js",
  "src/lib/processosDiariasDocumento.js",
  "src/lib/processosServicosDocumento.js",
  "src/components/configuracoes/CategoriaProcessos.jsx",
  "src/components/processos/PaginaDiarias.jsx",
  "src/components/processos/PaginaServicos.jsx",
];

test("13. nenhum arquivo desta entrega escreve em conta, nota, baixa ou programação", async () => {
  const proibidas = [
    "contas_bancarias",
    "saldos_contas",
    "notas_fiscais",
    "baixas",
    "pagamentos",
    "programacao_diaria",
    "programacao_itens",
    "transferencias",
  ];
  await Promise.all(
    ARQUIVOS_TOCADOS.map(async (caminho) => {
      const conteudo = await read(caminho);
      proibidas.forEach((tabela) => {
        assert.doesNotMatch(
          conteudo,
          new RegExp(`from\\(["']${tabela}["']\\)`),
          `${caminho} não pode tocar em ${tabela}`,
        );
      });
      // Nem por RPC de execução financeira.
      assert.doesNotMatch(conteudo, /\.rpc\(\s*["'](registrar_baixa|dar_baixa|pagar)/);
    }),
  );
});

test("13. a migration nova não toca em tabela financeira nem apaga nada", async () => {
  const migration = await read("supabase/migrations/20260912140000_processos_prefeita.sql");
  ["contas_bancarias", "saldos", "notas_fiscais", "baixas", "pagamentos", "programacao"].forEach((palavra) => {
    assert.doesNotMatch(migration, new RegExp(`(alter|drop|update|delete|insert into)\\s+(table\\s+)?public\\.${palavra}`, "i"));
  });
  // Ela CRIA: a tabela do cadastro e a coluna congelada dos dois módulos.
  assert.match(migration, /create table public\.processos_prefeita/);
  assert.match(migration, /to_regclass\('public\.processos_prefeita'\) is null/);
  assert.match(migration, /add column if not exists prefeita jsonb/);
  // E não apaga cadastro: o cadastro antigo é INATIVADO, nunca removido.
  assert.doesNotMatch(migration, /drop table/i);
  assert.doesNotMatch(migration, /delete from public\.processos/i);

  // O envio da imagem também não é financeiro: um arquivo em um bucket.
  const storage = await read("supabase/migrations/20260912130000_storage_logomarca.sql");
  assert.match(storage, /storage\.buckets/);
  assert.doesNotMatch(storage, /public\.(saldos|notas_fiscais|pagamentos|baixas)/);
});

test("13. finalizar continua não pagando nada, e a tela continua dizendo isso", async () => {
  const pagina = await read("src/components/processos/PaginaDiarias.jsx");
  assert.match(pagina, /Finalizar não é pagar/);
  assert.match(pagina, /nenhum saldo, baixa, NF ou programação foi alterado|nenhum saldo, /);
});
