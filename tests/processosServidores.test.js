import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ACOES_AUDITORIA_SERVIDORES,
  ACOES_SERVIDORES,
  CAMPOS_SERVIDOR,
  CAMPOS_SIGNATARIOS,
  CATEGORIAS_DIARIA,
  MIGRATION_SERVIDORES,
  MODULO_SERVIDORES,
  SIGNATARIOS_DO_DOCUMENTO,
  acoesNoServidor,
  camposDoSignatario,
  categoriaSugerida,
  cpfEmUso,
  dadosDoServidorParaDocumento,
  dadosDoSignatarioParaDocumento,
  diferencaDoServidor,
  filtrarServidores,
  mensagemDeCpfDuplicado,
  nomeDoSignatario,
  ordenarServidores,
  podeEscolherServidor,
  podeVerServidores,
  primeiroErroDoServidor,
  resolverPermissoesServidores,
  servidorParaBanco,
  servidorParaFormulario,
  servidorVazio,
  servidoresAtivos,
  soltarVinculoDoServidor,
  soltarVinculoDoSignatario,
  somenteDigitos,
  validarServidor,
} from "../src/lib/processosServidores.js";
import {
  CAMPOS_REQUISICAO,
  aplicarCalculo,
  processoParaFormulario,
  processoVazio,
  formularioParaBanco,
} from "../src/lib/processosDiarias.js";
import {
  TABELA_PADRAO,
  aplicarTabelaDeDiarias,
  valorUnitarioDaTabela,
} from "../src/lib/processosDiariasTabela.js";
import {
  dadosDoDocumento,
  htmlDoProcesso,
  montarPdfDoProcesso,
  nomeDoArquivo,
} from "../src/lib/processosDiariasDocumento.js";

/**
 * PROCESSOS · SERVIDORES — o cadastro das pessoas que trabalham no município, e
 * os ajustes que ele trouxe ao documento da diária.
 *
 * Este arquivo é a lista de conferência do envio, na ordem em que ela foi
 * pedida:
 *
 *   1. cadastrar um servidor com todos os campos e reabrir devolve tudo;
 *   2. CPF repetido é recusado, com mensagem dizendo DE QUEM é o CPF;
 *   3. a busca acha por nome e por CPF;
 *   4. criar a diária escolhendo o beneficiário já traz os dados preenchidos;
 *   5. a categoria sugerida calcula o valor certo pela Tabela de Diárias;
 *   6. preencher à mão continua funcionando e NÃO cria servidor;
 *   7. editar um campo do documento NÃO altera o cadastro;
 *   8. o documento impresso não traz número de processo nem numeração de folha;
 *   9. as três assinaturas saem uma embaixo da outra, em UMA folha;
 *  10. o cadastro de FORNECEDORES continua intacto e separado;
 *  11. nada aqui altera saldo, dá baixa ou mexe na programação.
 *
 * ⚠️ SERVIDOR NÃO É FORNECEDOR. Fornecedor vende para o município; servidor
 * trabalha nele. São dois cadastros distintos, e nenhum dos dois escreve no
 * outro -- nem por engano, nem por atalho de código.
 */

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/**
 * O que o cadastro de servidores NÃO pode fazer com o de fornecedores.
 *
 * A palavra aparece de propósito nos comentários e nos avisos da tela -- é a
 * tela dizendo a quem usa que este cadastro não é o de fornecedores. O que não
 * pode existir é a LIGAÇÃO: import, consulta, coluna, chamada ou vínculo.
 */
const LIGACOES_COM_FORNECEDORES = [
  /from\("fornecedores"\)/,
  /fornecedor_id/,
  /import[^;]*[Ff]ornecedor/,
  /carregarFornecedor|salvarFornecedor|criarFornecedor/i,
  /fornecedores\.(map|filter|find|length)/,
];

/** Os arquivos que este envio criou ou mexeu. */
const ARQUIVOS_DO_ENVIO = [
  "src/lib/processosServidores.js",
  "src/lib/processosServidoresDados.js",
  "src/components/processos/PaginaServidores.jsx",
  "src/components/processos/ModalServidor.jsx",
  "src/components/processos/ModalProcessoDiaria.jsx",
  "src/lib/processosDiarias.js",
  "src/lib/processosDiariasDados.js",
  "src/lib/processosDiariasDocumento.js",
  "src/lib/permissoesProcessos.js",
  "src/pages/ModuloProcessos.jsx",
];

const SECRETARIAS = [
  { id: 3, nome: "Secretaria Municipal de Assistência Social" },
  { id: 5, nome: "Secretaria Municipal de Administração" },
];

/** Um servidor cadastrado, com TODOS os campos preenchidos. */
function servidorCompleto(extra = {}) {
  return {
    id: "s-1",
    nome: "Maria Souza da Silva",
    cpf: "123.456.789-00",
    endereco: "Rua das Acácias, 120, Centro, São José da Laje - AL",
    cargo: "Secretária Municipal de Assistência Social",
    solicitante_id: "sol-3",
    secretaria_id: 3,
    lotacao: "Gabinete da Secretaria",
    categoria_diaria: "secretarios",
    telefone: "(82) 9 9999-1234",
    email: "maria.souza@saojosedalaje.al.gov.br",
    banco_codigo: "001",
    banco: "Banco do Brasil",
    agencia: "1234-5",
    conta: "98765-4",
    pix: "123.456.789-00",
    pix_titular: "Maria Souza da Silva",
    situacao: "ativo",
    ...extra,
  };
}

function processoDeExemplo(extra = {}) {
  return {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    id: 41,
    numero: 1,
    ano: 2026,
    situacao: "rascunho",
    secretaria_id: 3,
    beneficiario_nome: "Maria Souza da Silva",
    beneficiario_cpf: "123.456.789-00",
    beneficiario_endereco: "Rua das Acácias, 120, Centro, São José da Laje - AL",
    beneficiario_cargo: "Secretária Municipal de Assistência Social",
    destino: "Brasília/DF",
    finalidade: "Reunião no Ministério da Fazenda.",
    data_saida: "2026-03-12",
    data_retorno: "2026-03-14",
    quantidade_diarias: "2,5",
    valor_unitario: "320,00",
    valor_total: 800,
    valor_extenso: "oitocentos reais",
    ...extra,
  };
}

/** O texto que o PDF realmente imprime, folha por folha. */
function textoDasFolhas(pdf) {
  const folhas = [];
  for (let n = 1; n < pdf.internal.pages.length; n += 1) {
    const bruto = pdf.internal.pages[n].join("\n");
    folhas.push([...bruto.matchAll(/\((.*?)\) Tj/g)].map((achado) => achado[1]).join(" | "));
  }
  return folhas;
}

/* -------------------------------------------------------------------------
 * 1. Cadastrar com todos os campos e reabrir
 * ---------------------------------------------------------------------- */

test("1. cadastrar um servidor com todos os campos e reabrir devolve tudo", () => {
  const formulario = servidorParaFormulario(servidorCompleto());

  // Reabrir traz cada campo de volta, sem perder nenhum.
  CAMPOS_SERVIDOR.forEach((campo) => {
    assert.equal(formulario[campo], servidorCompleto()[campo], campo);
  });
  assert.equal(formulario.secretaria_id, 3);
  assert.equal(formulario.situacao, "ativo");
  assert.deepEqual(validarServidor(formulario, { servidores: [] }), {});

  // Gravação: em branco vai como null, e a SITUAÇÃO não sai por edição --
  // inativar tem permissão e caminho próprios.
  const linha = servidorParaBanco(formulario);
  assert.equal(linha.nome, "Maria Souza da Silva");
  assert.equal(linha.pix_titular, "Maria Souza da Silva");
  assert.equal(linha.secretaria_id, 3);
  assert.equal(linha.solicitante_id, "sol-3");
  assert.equal(linha.banco_codigo, "001");
  assert.ok(!("situacao" in linha));
  assert.ok(!("matricula" in linha));
  assert.equal(servidorParaBanco({ ...formulario, lotacao: "  " }).lotacao, null);

  // Telefone e e-mail são OPCIONAIS, como pedido.
  const enxuto = servidorVazio();
  Object.assign(enxuto, {
    nome: "João Batista",
    cpf: "98765432100",
    cargo: "Motorista",
    solicitante_id: "sol-5",
    categoria_diaria: "outros_agentes",
  });
  assert.deepEqual(validarServidor(enxuto, { servidores: [] }), {});

  // Nome, CPF, cargo, secretaria e categoria são o mínimo de um documento.
  const vazio = validarServidor(servidorVazio(), { servidores: [] });
  ["nome", "cpf", "cargo", "solicitante_id", "categoria_diaria"].forEach((campo) =>
    assert.ok(vazio[campo], campo),
  );
  assert.ok(primeiroErroDoServidor(vazio));

  // As cinco categorias de diária pedidas, e nenhuma lista nova de secretarias.
  assert.deepEqual(CATEGORIAS_DIARIA.map((c) => c.id), [
    "prefeito_vice",
    "secretarios",
    "auditor_procurador",
    "comissionados",
    "outros_agentes",
  ]);
});

test("a inativação é lógica: a linha nunca é apagada do banco", async () => {
  const [dados, sql] = await Promise.all([
    read("src/lib/processosServidoresDados.js"),
    read(`supabase/migrations/${MIGRATION_SERVIDORES}`),
  ]);

  // Nada de delete: inativar é gravar situação, data, autor e motivo.
  assert.doesNotMatch(dados, /\.delete\(\)/);
  assert.match(dados, /situacao: "inativo"/);
  assert.match(dados, /inativado_em/);
  assert.match(dados, /motivo_inativacao/);
  // Sem política de DELETE, o banco não apaga nem por chamada direta.
  assert.doesNotMatch(sql, /create policy[^;]*for delete/i);
  assert.match(sql, /revoke delete on public\.processos_servidores/i);

  // A auditoria registra criar, editar, inativar e reativar.
  assert.deepEqual(Object.keys(ACOES_AUDITORIA_SERVIDORES).sort(), [
    "criar",
    "editar",
    "inativar",
    "reativar",
  ]);
  assert.deepEqual(Object.values(ACOES_AUDITORIA_SERVIDORES), [
    "criar_servidor",
    "editar_servidor",
    "inativar_servidor",
    "reativar_servidor",
  ]);
  // E o acesso ao banco registra as quatro, cada uma na sua gravação.
  Object.keys(ACOES_AUDITORIA_SERVIDORES).forEach((acao) =>
    assert.match(dados, new RegExp(`ACOES_AUDITORIA_SERVIDORES\\.${acao}`)),
  );
  // O "antes e depois" só traz o que mudou de verdade.
  const antes = servidorCompleto();
  assert.deepEqual(diferencaDoServidor(antes, antes), {});
  assert.deepEqual(diferencaDoServidor(antes, { ...antes, cargo: "Assessora" }), {
    cargo: { de: "Secretária Municipal de Assistência Social", para: "Assessora" },
  });

  // Inativado, o servidor sai da escolha do documento mas continua no cadastro.
  const inativo = servidorCompleto({ id: "s-2", situacao: "inativo" });
  assert.deepEqual(servidoresAtivos([antes, inativo]).map((s) => s.id), ["s-1"]);
  assert.deepEqual(ordenarServidores([inativo, antes]).map((s) => s.id), ["s-1", "s-2"]);
  assert.deepEqual(acoesNoServidor(inativo, { visualizar: true, editar: true, inativar: true }), {
    abrir: true,
    editar: true,
    inativar: false,
    reativar: true,
  });
});

/* -------------------------------------------------------------------------
 * 2. CPF repetido
 * ---------------------------------------------------------------------- */

test("2. CPF repetido é recusado, e a mensagem diz de quem é o CPF", () => {
  const existente = servidorCompleto();

  // A comparação é SÓ POR DÍGITOS: pontuação diferente é o mesmo CPF.
  assert.equal(somenteDigitos("123.456.789-00"), "12345678900");
  assert.equal(cpfEmUso([existente], "12345678900")?.id, "s-1");
  assert.equal(cpfEmUso([existente], "123.456.789-00")?.id, "s-1");
  assert.equal(cpfEmUso([existente], "  123 456 789 00 ")?.id, "s-1");
  assert.equal(cpfEmUso([existente], "98765432100"), null);

  // Editando a própria pessoa, o CPF dela não conta como repetido.
  assert.equal(cpfEmUso([existente], "12345678900", { ignorarId: "s-1" }), null);

  // A mensagem NOMEIA quem já usa o CPF -- e o cargo, para reconhecer na hora.
  const erros = validarServidor(
    { ...servidorVazio(), nome: "Outra Pessoa", cpf: "12345678900", cargo: "Motorista", secretaria_id: 5, categoria_diaria: "outros_agentes" },
    { servidores: [existente] },
  );
  assert.match(erros.cpf, /123\.456\.789-00/);
  assert.match(erros.cpf, /Maria Souza da Silva/);
  assert.match(erros.cpf, /Secretária Municipal de Assistência Social/);

  // Servidor INATIVO também trava: o caminho é reativar, não duplicar.
  const mensagem = mensagemDeCpfDuplicado(servidorCompleto({ situacao: "inativo" }));
  assert.match(mensagem, /INATIVO/);
  assert.match(mensagem, /reative o cadastro existente/);
  assert.equal(cpfEmUso([servidorCompleto({ situacao: "inativo" })], "12345678900")?.id, "s-1");

  // Onze dígitos, sempre.
  assert.match(
    validarServidor({ ...servidorVazio(), cpf: "1234567" }, { servidores: [] }).cpf,
    /11 dígitos/,
  );
});

test("a trava final do CPF é do banco, por um índice de dígitos", async () => {
  const [sql, dados] = await Promise.all([
    read(`supabase/migrations/${MIGRATION_SERVIDORES}`),
    read("src/lib/processosServidoresDados.js"),
  ]);
  // Índice ÚNICO sobre os dígitos do CPF: duas telas ao mesmo tempo não passam.
  assert.match(sql, /create unique index if not exists processos_servidores_cpf_digitos_unico/i);
  assert.match(sql, /regexp_replace\(cpf, '\[\^0-9\]', '', 'g'\)/);
  // E a recusa do banco volta para a tela como a mesma mensagem clara.
  assert.match(dados, /cpfDuplicadoNoBanco/);
  assert.match(dados, /CPF_DUPLICADO/);
});

/* -------------------------------------------------------------------------
 * 3. Busca
 * ---------------------------------------------------------------------- */

test("3. a busca acha por nome e por CPF, e os filtros combinam", () => {
  const lista = [
    servidorCompleto(),
    servidorCompleto({
      id: "s-2",
      nome: "João Batista de Oliveira",
      cpf: "987.654.321-00",
      cargo: "Motorista",
      secretaria_id: 5,
      categoria_diaria: "outros_agentes",
    }),
    servidorCompleto({ id: "s-3", nome: "Ana Lima", cpf: "111.222.333-44", cargo: "Procuradora", secretaria_id: 5, categoria_diaria: "auditor_procurador", situacao: "inativo" }),
  ];
  const achar = (busca, filtros = {}) =>
    filtrarServidores(lista, { busca, filtros, secretarias: SECRETARIAS }).map((s) => s.id);

  // Por nome, por pedaço do nome e sem depender de acento.
  assert.deepEqual(achar("maria"), ["s-1"]);
  assert.deepEqual(achar("Joao"), ["s-2"]);
  assert.deepEqual(achar("oliveira"), ["s-2"]);
  // Por CPF, com ou sem pontuação.
  assert.deepEqual(achar("98765432100"), ["s-2"]);
  assert.deepEqual(achar("987.654"), ["s-2"]);
  // Por cargo e por secretaria.
  assert.deepEqual(achar("motorista"), ["s-2"]);
  assert.deepEqual(achar("assistência"), ["s-1"]);
  // Busca vazia devolve a lista inteira.
  assert.equal(achar("").length, 3);

  // Os filtros da gaveta: secretaria, categoria e situação.
  assert.deepEqual(achar("", { secretaria: "5" }), ["s-2", "s-3"]);
  assert.deepEqual(achar("", { categoria: "secretarios" }), ["s-1"]);
  assert.deepEqual(achar("", { situacao: "inativo" }), ["s-3"]);
  assert.deepEqual(achar("", { situacao: "ativo", secretaria: "5" }), ["s-2"]);
});

/* -------------------------------------------------------------------------
 * 4 e 5. O servidor escolhido no documento, e o valor da tabela
 * ---------------------------------------------------------------------- */

test("4. escolher o beneficiário no cadastro já traz os dados preenchidos", () => {
  const servidor = servidorCompleto();
  const dados = dadosDoServidorParaDocumento(servidor);

  // Nome, CPF, endereço, cargo, secretaria, lotação, banco e PIX. A MATRÍCULA
  // não entra mais: saiu do cadastro, do formulário e do documento.
  assert.equal(dados.beneficiario_nome, "Maria Souza da Silva");
  assert.equal(dados.beneficiario_cpf, "123.456.789-00");
  assert.equal(dados.beneficiario_endereco, servidor.endereco);
  assert.ok(!("beneficiario_matricula" in dados));
  assert.equal(dados.beneficiario_cargo, servidor.cargo);
  assert.equal(dados.beneficiario_lotacao, "Gabinete da Secretaria");
  assert.equal(dados.secretaria_id, 3);
  assert.equal(dados.solicitante_id, "sol-3");
  assert.equal(dados.banco_codigo, "001");
  assert.equal(dados.banco, "Banco do Brasil");
  assert.equal(dados.agencia, "1234-5");
  assert.equal(dados.conta, "98765-4");
  assert.equal(dados.pix, "123.456.789-00");
  assert.equal(dados.titular, "Maria Souza da Silva");
  // E o VÍNCULO INTERNO com o cadastro.
  assert.equal(dados.beneficiario_servidor_id, "s-1");
  // Mais a categoria, que é o que SUGERE o valor.
  assert.equal(dados.diaria_categoria, "secretarios");
  assert.equal(categoriaSugerida(servidor), "secretarios");

  // O formulário da diária recebe tudo isso e continua sendo um formulário.
  const formulario = { ...processoVazio({ ano: 2026, hoje: "2026-03-10" }), ...dados };
  assert.equal(formulario.beneficiario_nome, "Maria Souza da Silva");
  assert.equal(formulario.beneficiario_servidor_id, "s-1");
  // O vínculo chega ao banco, e é só um ponteiro.
  assert.equal(formularioParaBanco(formulario).beneficiario_servidor_id, "s-1");
  // Reabrir o processo devolve o vínculo.
  assert.equal(
    processoParaFormulario({ ...processoDeExemplo(), beneficiario_servidor_id: "s-1" })
      .beneficiario_servidor_id,
    "s-1",
  );
});

test("5. a categoria sugerida calcula o valor certo pela Tabela de Diárias", () => {
  const servidor = servidorCompleto(); // categoria: secretarios
  const escolhido = {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    ...dadosDoServidorParaDocumento(servidor),
    diaria_faixa: "al_ate_100",
    quantidade_diarias: "2",
  };

  const comTabela = aplicarCalculo(aplicarTabelaDeDiarias(escolhido, TABELA_PADRAO));
  assert.equal(comTabela.diaria_categoria, "secretarios");
  assert.equal(comTabela.valor_unitario, 271.67);
  assert.equal(comTabela.valor_total, 543.34);

  // A categoria do cadastro é que manda no valor: outra categoria, outro valor.
  const motorista = {
    ...escolhido,
    ...dadosDoServidorParaDocumento(servidorCompleto({ id: "s-2", categoria_diaria: "outros_agentes" })),
  };
  assert.equal(aplicarTabelaDeDiarias(motorista, TABELA_PADRAO).valor_unitario, 97.78);
  assert.equal(
    valorUnitarioDaTabela(TABELA_PADRAO, { faixa: "al_ate_100", categoria: "outros_agentes" }),
    97.78,
  );

  // Com pernoite, o acréscimo da própria tabela.
  assert.equal(
    aplicarTabelaDeDiarias({ ...escolhido, diaria_pernoite: true }, TABELA_PADRAO).valor_unitario,
    Number((271.67 * 1.3).toFixed(2)),
  );

  // E o valor unitário continua editável à mão: a tabela não sobrescreve.
  const aMao = aplicarTabelaDeDiarias(
    { ...comTabela, valor_unitario: 300, valor_unitario_manual: true },
    TABELA_PADRAO,
  );
  assert.equal(aMao.valor_unitario, 300);
});

/* -------------------------------------------------------------------------
 * 6 e 7. Preencher à mão, e editar o documento
 * ---------------------------------------------------------------------- */

test("6. preencher à mão continua funcionando e NÃO cria servidor", async () => {
  // Sem escolher ninguém no cadastro: o documento é preenchido no teclado.
  const aMao = {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    beneficiario_nome: "Pessoa Não Cadastrada",
    beneficiario_cpf: "555.666.777-88",
    beneficiario_cargo: "Conselheira Tutelar",
    secretaria_id: 3,
  };
  assert.equal(aMao.beneficiario_servidor_id, null);
  assert.equal(formularioParaBanco(aMao).beneficiario_servidor_id, null);
  assert.equal(formularioParaBanco(aMao).beneficiario_nome, "Pessoa Não Cadastrada");

  // Soltar o vínculo preserva o que já está escrito no documento.
  const solto = soltarVinculoDoServidor({
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    ...dadosDoServidorParaDocumento(servidorCompleto()),
  });
  assert.equal(solto.beneficiario_servidor_id, null);
  assert.equal(solto.beneficiario_nome, "Maria Souza da Silva");
  assert.equal(solto.beneficiario_cpf, "123.456.789-00");

  // O mesmo para quem assina.
  const signatario = soltarVinculoDoSignatario(
    dadosDoSignatarioParaDocumento(servidorCompleto()),
  );
  assert.equal(signatario.assinante_secretaria_servidor_id, null);
  assert.equal(signatario.assinante_secretaria_nome, "Maria Souza da Silva");

  // E o formulário da diária NÃO grava no cadastro de servidores: nenhuma
  // inserção, nenhuma alteração, em nenhum caminho da tela do processo.
  const [diariasDados, modal] = await Promise.all([
    read("src/lib/processosDiariasDados.js"),
    read("src/components/processos/ModalProcessoDiaria.jsx"),
  ]);
  [diariasDados, modal].forEach((arquivo) => {
    assert.doesNotMatch(arquivo, /from\("processos_servidores"\)/);
    assert.doesNotMatch(arquivo, /criarServidor|salvarServidor|inativarServidor|reativarServidor/);
  });
  assert.match(modal, /NÃO cria servidor/);
});

test("7. editar um campo do documento NÃO altera o cadastro do servidor", () => {
  const servidor = servidorCompleto();
  const antes = JSON.stringify(servidor);

  // O documento recebe os dados e é editado ali: endereço novo, cargo do dia.
  let formulario = {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    ...dadosDoServidorParaDocumento(servidor),
  };
  formulario = { ...formulario, beneficiario_endereco: "Endereço corrigido no documento" };
  formulario = { ...formulario, beneficiario_cargo: "Secretária (em exercício)" };

  // O cadastro não mudou uma letra.
  assert.equal(JSON.stringify(servidor), antes);
  // O documento mudou, e o VÍNCULO INTERNO continua lá.
  assert.equal(formulario.beneficiario_endereco, "Endereço corrigido no documento");
  assert.equal(formulario.beneficiario_servidor_id, "s-1");
  assert.equal(formularioParaBanco(formulario).beneficiario_servidor_id, "s-1");

  // O caminho inverso também: quem assinou fica GRAVADO no processo, então uma
  // mudança posterior no cadastro não reescreve documento antigo.
  const assinatura = dadosDoSignatarioParaDocumento(servidor);
  assert.equal(assinatura.assinante_secretaria_nome, "Maria Souza da Silva");
  assert.equal(assinatura.assinante_secretaria_cpf, "123.456.789-00");
  assert.equal(assinatura.assinante_secretaria_cargo, servidor.cargo);
  assert.equal(assinatura.assinante_secretaria_servidor_id, "s-1");

  const processo = { ...processoDeExemplo(), ...assinatura };
  assert.equal(nomeDoSignatario(processo), "Maria Souza da Silva");
  // O cadastro muda de cargo depois; o documento guardado não muda.
  const documento = dadosDoDocumento(processo, { secretarias: SECRETARIAS });
  assert.equal(documento.assinaturas.secretaria.cargo, servidor.cargo);

  // As colunas do signatário são conteúdo do documento: entram na requisição, e
  // o congelamento delas é o do processo (finalizado não muda mais).
  const campos = camposDoSignatario("assinante_secretaria");
  [campos.nome, campos.cpf, campos.cargo].forEach((coluna) =>
    assert.ok(CAMPOS_REQUISICAO.includes(coluna), coluna),
  );
  assert.deepEqual(SIGNATARIOS_DO_DOCUMENTO.map((s) => s.prefixo), ["assinante_secretaria"]);
  assert.equal(CAMPOS_SIGNATARIOS.length, 4);
});

/* -------------------------------------------------------------------------
 * 8, 9 e 13. O papel
 * ---------------------------------------------------------------------- */

test("8. o documento impresso não traz número de processo nem numeração de folha", () => {
  const processo = processoDeExemplo();
  const dados = dadosDoDocumento(processo, { secretarias: SECRETARIAS, emissor: "Ana Lima" });

  // O número CONTINUA existindo no sistema: controle, busca, listagem e o nome
  // do arquivo do PDF. O que ele não faz é sair no papel.
  assert.equal(dados.numero, "0001/2026");
  assert.equal(nomeDoArquivo(dados, "pdf", "completo"), "processo-diaria-0001-2026.pdf");

  const html = htmlDoProcesso(dados, { escopo: "completo" });
  assert.doesNotMatch(html, /0001\/2026/);
  assert.doesNotMatch(html, /Processo de diária nº/i);
  assert.doesNotMatch(html, /Processo nº/i);
  assert.doesNotMatch(html, /Página \d|Página \$\{|Folha \d/);
  assert.doesNotMatch(html, /de 3</);
  // O que o rodapé mantém: endereço, contato e a linha de emissão.
  assert.match(html, /Emitido em /);

  const folhas = textoDasFolhas(montarPdfDoProcesso(dados, { escopo: "completo" }));
  assert.equal(folhas.length, 3);
  folhas.forEach((folha) => {
    // "0001" solto aparece no CNPJ do rodapé; o que não pode sair é o NÚMERO
    // do processo, que é impresso como "0001/2026".
    assert.doesNotMatch(folha, /0001\/2026/);
    assert.doesNotMatch(folha, /PROCESSO DE DIÁRIA Nº/i);
    assert.doesNotMatch(folha, /P.gina \d/);
    assert.ok(folha.includes("Emitido em"));
  });
  // Cada documento continua começando em folha própria: a regra não mudou.
  assert.equal(montarPdfDoProcesso(dados, { escopo: "completo" }).getNumberOfPages(), 3);
  assert.equal((html.match(/class="folha"/g) ?? []).length, 3);
  assert.match(html, /page-break-after: always/);
});

test("9. as três assinaturas saem uma embaixo da outra, e a folha continua sendo uma", () => {
  const processo = processoDeExemplo({
    ...dadosDoSignatarioParaDocumento(servidorCompleto({
      id: "s-2",
      nome: "João Batista de Oliveira Filho",
      cargo: "Secretário Municipal de Administração",
      cpf: "987.654.321-00",
    })),
    custeio_despesas: "de alimentação, hospedagem e locomoção urbana durante todo o deslocamento",
    objeto: "Reunião técnica no Ministério da Fazenda",
    beneficiario_endereco: "Rua das Acácias, 120, Centro, São José da Laje - AL, CEP 57860-000",
  });
  const dados = dadosDoDocumento(processo, { secretarias: SECRETARIAS, emissor: "Ana Lima" });

  // Os três rótulos, na ordem do formulário oficial.
  const html = htmlDoProcesso(dados, { escopo: "requisicao" });
  const bloco = html.match(/<div class="assinaturas">[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  assert.ok(bloco.indexOf("Assinatura do Servidor") < bloco.indexOf("Responsável pela Secretaria"));
  assert.ok(bloco.indexOf("Responsável pela Secretaria") < bloco.indexOf("Assinatura da Prefeita"));
  // Empilhadas, não lado a lado: cada uma na sua linha, centralizada e com o
  // vão acima do traço para assinar à mão.
  assert.doesNotMatch(html, /\.assinaturas \{ display: flex/);
  assert.match(html, /\.assinaturas div \{ width: 95mm; margin: 9mm auto 0/);
  // Quem assina pela secretaria sai identificado, com o cargo gravado.
  assert.ok(bloco.includes("João Batista de Oliveira Filho"));
  assert.ok(bloco.includes("Secretário Municipal de Administração"));
  // A assinatura única das outras folhas NÃO foi mexida.
  assert.match(html, /\.assinatura-unica \{ margin: 12mm auto 0/);

  // E o documento continua caindo em UMA folha.
  const pdf = montarPdfDoProcesso(dados, { escopo: "requisicao" });
  assert.equal(pdf.getNumberOfPages(), 1);
  const folha = textoDasFolhas(pdf)[0];
  assert.ok(folha.indexOf("Assinatura do Servidor") < folha.indexOf("Responsável pela Secretaria"));
  assert.ok(folha.indexOf("Responsável pela Secretaria") < folha.indexOf("Assinatura da Prefeita"));
  assert.ok(folha.includes("João Batista de Oliveira Filho"));

  // Em branco, a linha sai só com o traço, para assinar à mão.
  const semSignatario = dadosDoDocumento(processoDeExemplo(), { secretarias: SECRETARIAS });
  assert.equal(semSignatario.assinaturas.secretaria.nome, "");
  assert.match(
    htmlDoProcesso(semSignatario, { escopo: "requisicao" }),
    /<strong>&nbsp;<\/strong>Responsável pela Secretaria/,
  );

  // As outras duas folhas seguem em uma página cada.
  assert.equal(montarPdfDoProcesso(dados, { escopo: "liquidacao" }).getNumberOfPages(), 1);
  assert.equal(montarPdfDoProcesso(dados, { escopo: "prestacao" }).getNumberOfPages(), 1);
});

test("o campo TRANSPORTE saiu do formulário, do documento e da gravação", async () => {
  const arquivos = await Promise.all([
    read("src/lib/processosDiarias.js"),
    read("src/lib/processosDiariasDados.js"),
    read("src/lib/processosDiariasDocumento.js"),
    read("src/components/processos/ModalProcessoDiaria.jsx"),
  ]);

  // Nada mais lê, escreve ou imprime transporte.
  assert.ok(!CAMPOS_REQUISICAO.includes("transporte"));
  assert.ok(!CAMPOS_REQUISICAO.includes("transporte_outro"));
  arquivos.forEach((arquivo) => {
    assert.doesNotMatch(arquivo, /TRANSPORTES|transporteRotulo/);
    assert.doesNotMatch(arquivo, /"transporte"|"transporte_outro"/);
    assert.doesNotMatch(arquivo, /veiculo_oficial|veiculo_proprio/);
  });
  const banco = formularioParaBanco({
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    transporte: "onibus",
    transporte_outro: "carona",
  });
  assert.ok(!("transporte" in banco));
  assert.ok(!("transporte_outro" in banco));

  // A restrição do banco sai; as COLUNAS ficam, com o histórico já gravado.
  const sql = await read(`supabase/migrations/${MIGRATION_SERVIDORES}`);
  assert.match(sql, /drop constraint if exists processos_diarias_transporte_check/i);
  assert.doesNotMatch(sql, /drop column[^;]*transporte/i);
});

/* -------------------------------------------------------------------------
 * 10 e 11. As travas
 * ---------------------------------------------------------------------- */

test("10. o cadastro de FORNECEDORES continua intacto e separado do de servidores", async () => {
  const [servidores, servidoresDados, pagina, modal, sql] = await Promise.all([
    read("src/lib/processosServidores.js"),
    read("src/lib/processosServidoresDados.js"),
    read("src/components/processos/PaginaServidores.jsx"),
    read("src/components/processos/ModalServidor.jsx"),
    read(`supabase/migrations/${MIGRATION_SERVIDORES}`),
  ]);

  // O cadastro de servidores NÃO lê, NÃO escreve e NÃO se liga ao de
  // fornecedores. A palavra só aparece em comentário e no aviso da tela, que
  // existe justamente para dizer que os dois cadastros são distintos.
  [servidores, servidoresDados, pagina, modal].forEach((arquivo) => {
    LIGACOES_COM_FORNECEDORES.forEach((padrao) => assert.doesNotMatch(arquivo, padrao));
  });
  assert.match(pagina, /não é o cadastro de fornecedores/);
  assert.match(modal, /não é o cadastro de fornecedores/);
  // E a migration não encosta na tabela de fornecedores.
  assert.doesNotMatch(sql, /alter table (public\.)?fornecedores\b/i);
  assert.doesNotMatch(sql, /insert into public\.fornecedores/i);
  assert.doesNotMatch(sql, /drop table|truncate/i);
  // A tabela do cadastro é própria, e as secretarias são as JÁ cadastradas.
  assert.match(sql, /create table public\.processos_servidores\b/i);
  assert.match(sql, /references public\.secretarias/i);

  // O documento da diária guarda o vínculo do servidor SEM perder o vínculo
  // antigo de fornecedor: registro que já existia não fica órfão.
  const processo = processoParaFormulario({
    ...processoDeExemplo(),
    fornecedor_id: 77,
    beneficiario_servidor_id: "s-1",
  });
  assert.equal(processo.fornecedor_id, 77);
  assert.equal(processo.beneficiario_servidor_id, "s-1");
  assert.equal(formularioParaBanco(processo).fornecedor_id, 77);
});

test("11. nada no cadastro de servidores altera saldo, dá baixa ou mexe na programação", async () => {
  const proibido = [
    /from\("pagamentos"\)/,
    /from\("pagamento_movimentacoes"\)/,
    /from\("programacoes_pagamento"\)/,
    /from\("contas_bancarias"\)/,
    /from\("saldos_historico"\)/,
    /registrar_baixa|estornar_baixa|registrarBaixa/,
    /atualizarSaldo|lancarSaldo|debitar/i,
    /valor_pago|valor_em_aberto/,
  ];
  const arquivos = await Promise.all(ARQUIVOS_DO_ENVIO.map(read));
  arquivos.forEach((conteudo, i) => {
    proibido.forEach((padrao) =>
      assert.doesNotMatch(conteudo, padrao, `${ARQUIVOS_DO_ENVIO[i]} não pode referenciar ${padrao}`),
    );
  });

  // A migration é ADITIVA: cria o cadastro, acrescenta colunas e não toca em
  // nenhuma tabela financeira.
  const sql = await read(`supabase/migrations/${MIGRATION_SERVIDORES}`);
  [
    /alter table (public\.)?pagamentos\b/i,
    /alter table (public\.)?contas_bancarias\b/i,
    /alter table (public\.)?saldos_historico\b/i,
    /alter table (public\.)?programacoes_pagamento\b/i,
  ].forEach((padrao) => assert.doesNotMatch(sql, padrao));
  assert.match(sql, /add column if not exists beneficiario_servidor_id/i);
  assert.match(sql, /add column if not exists assinante_secretaria_nome/i);
  // A migration é rodada à MÃO no SQL Editor, e o arquivo diz isso.
  assert.match(sql, /SQL Editor/i);
  assert.match(MIGRATION_SERVIDORES, /^20260911230000_/);
});

/* -------------------------------------------------------------------------
 * A subaba: menu e permissões próprias
 * ---------------------------------------------------------------------- */

test("SERVIDORES é subaba do submenu PROCESSOS e tem permissão própria", async () => {
  const [menu, pagina, matriz, sql] = await Promise.all([
    read("src/lib/permissoesProcessos.js"),
    read("src/pages/ModuloProcessos.jsx"),
    read("src/lib/permissoesUsuario.js"),
    read(`supabase/migrations/${MIGRATION_SERVIDORES}`),
  ]);

  // O submenu tem Diárias e Servidores, nesta ordem.
  assert.match(menu, /id: "diarias"[\s\S]*id: "servidores"/);
  assert.match(menu, /\/processos\/servidores/);
  // A rota existe e a área desconhecida volta para Diárias.
  assert.match(pagina, /const AREAS = \["diarias", "servicos", "servidores"\]/);
  assert.match(pagina, /Navigate to="\/processos\/diarias"/);

  // Permissão PRÓPRIA: quem vê Diárias não passa a ver Servidores.
  assert.equal(MODULO_SERVIDORES, "processos_servidores");
  assert.deepEqual(ACOES_SERVIDORES.map((a) => a.chave), ["visualizar", "criar", "editar", "inativar"]);
  const nenhuma = resolverPermissoesServidores({ linhas: [{ modulo: "processos_diarias", pode_visualizar: true }] });
  assert.deepEqual(nenhuma, { visualizar: false, criar: false, editar: false, inativar: false });
  assert.equal(podeVerServidores(nenhuma), false);

  const so_ver = resolverPermissoesServidores({
    linhas: [{ modulo: MODULO_SERVIDORES, pode_visualizar: true, pode_cadastrar: false, pode_editar: false, pode_excluir: false }],
  });
  assert.equal(podeVerServidores(so_ver), true);
  assert.equal(so_ver.criar, false);
  // Escolher servidor no documento exige só VER o cadastro.
  assert.equal(podeEscolherServidor(so_ver), true);

  // A Matriz de Permissões mostra o módulo, para quem administra conceder.
  assert.match(matriz, /id: "processos_servidores"/);
  assert.match(matriz, /Processos · Servidores/);
  // O banco é quem recusa de verdade: RLS pelo mesmo `pode_em_processos`.
  assert.match(sql, /pode_em_processos\('processos_servidores'/);
  assert.match(sql, /enable row level security/i);
});

test("o cadastro nasce reutilizável para os próximos processos, sem implementá-los", async () => {
  const servidores = await read("src/lib/processosServidores.js");
  // A lista de signatários é a porta de entrada dos próximos documentos.
  assert.match(servidores, /SIGNATARIOS_DO_DOCUMENTO/);
  assert.match(servidores, /camposDoSignatario/);
  // Serviços/Materiais chegou depois, em envio próprio: os arquivos DESTE envio
  // continuam sem conhecer as tabelas dele -- o único ponto de contato é o
  // menu/rota do módulo, que é aditivo.
  const arquivos = await Promise.all(ARQUIVOS_DO_ENVIO.map(read));
  arquivos.forEach((arquivo, i) => {
    assert.doesNotMatch(arquivo, /processos_solicitacoes|\/processos\/materiais/i);
    const soNoMenu = ["src/lib/permissoesProcessos.js", "src/pages/ModuloProcessos.jsx"];
    if (!soNoMenu.includes(ARQUIVOS_DO_ENVIO[i])) {
      assert.doesNotMatch(arquivo, /processos_servicos|\/processos\/servicos/i);
    }
  });
});
