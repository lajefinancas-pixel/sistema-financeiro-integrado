import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AVISO_MIGRATION_SOLICITANTES,
  CAMPOS_SOLICITANTE,
  CAMPOS_SOLICITANTE_NO_PROCESSO,
  MIGRATION_SOLICITANTES,
  ROTULOS_SOLICITANTE,
  TABELA_SOLICITANTES,
  dadosDoSolicitanteParaDocumento,
  diferencaDoSolicitante,
  filtrarSolicitantes,
  listaDeSecretariasDoProcesso,
  nomeEmUso,
  nomeOficialDoSolicitante,
  ordenarSolicitantes,
  rotuloDoSolicitante,
  solicitanteAtendeBusca,
  solicitanteParaBanco,
  solicitanteVazio,
  solicitantesAtivos,
  validarSolicitante,
} from "../src/lib/processosSecretariasSolicitantes.js";
import {
  BANCOS_INICIAIS,
  MIGRATION_BANCOS,
  SEPARADOR_BANCO,
  TABELA_BANCOS,
  bancoAtendeBusca,
  bancoDoDocumento,
  bancoParaBanco,
  bancoVazio,
  bancosAtivos,
  bancosParaEscolha,
  dadosDoBancoParaDocumento,
  filtrarBancos,
  numeroDoBancoFormatado,
  numeroEmUso,
  rotuloDoBanco,
  validarBanco,
} from "../src/lib/processosBancos.js";
import {
  CAMPOS_COMPARTILHADOS,
  CAMPOS_REQUISICAO,
  formularioParaBanco,
  nomeDaSecretaria,
  processoParaFormulario,
  processoVazio,
  validarRascunho,
} from "../src/lib/processosDiarias.js";
import {
  CAMPOS_SERVIDOR,
  dadosDoServidorParaDocumento,
  servidorParaBanco,
  servidorVazio,
  validarServidor,
} from "../src/lib/processosServidores.js";
import {
  CAMPOS_RODAPE,
  IDENTIDADE_PADRAO,
  RODAPE_LEGADO,
  atualizarRodapeLegado,
  normalizarIdentidade,
  validarIdentidade,
} from "../src/lib/processosIdentidade.js";
import {
  dadosDoDocumento,
  htmlDoProcesso,
  montarPdfDoProcesso,
} from "../src/lib/processosDiariasDocumento.js";

/**
 * PROCESSOS — as cinco correções deste envio, e a lista de conferência que foi
 * pedida junto com elas:
 *
 *   1. a matrícula não aparece em lugar nenhum;
 *   2. a data do processo pode ser alterada e o documento imprime a escolhida;
 *   3. cadastrar uma secretaria solicitante e escolhê-la no processo preenche
 *      secretário, CPF e cargo;
 *   4. o cadastro de secretarias de Saldos/Pagamentos continua intacto e
 *      separado;
 *   5. escolher o banco na lista funciona, com busca, e imprime número + nome;
 *   6. cadastrar um banco novo funciona;
 *   7. processo já criado continua abrindo normalmente;
 *   8. nada aqui altera saldo, dá baixa ou mexe na programação.
 *
 * ⚠️ A SECRETARIA SOLICITANTE NÃO É A SECRETARIA DO FINANCEIRO. Quem REQUISITA
 * quase nunca é quem PAGA: são dois cadastros, cada um com a sua finalidade, e
 * este envio não altera, não mescla e não toca no cadastro financeiro.
 */

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/** O que o arquivo FAZ, sem os comentários que explicam o que ele deixou de fazer. */
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const semComentariosSql = (fonte) =>
  fonte
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");

const ARQUIVOS_DO_ENVIO = [
  "src/lib/processosSecretariasSolicitantes.js",
  "src/lib/processosBancos.js",
  "src/lib/processosCadastrosDados.js",
  "src/lib/processosDiarias.js",
  "src/lib/processosDiariasDados.js",
  "src/lib/processosDiariasDocumento.js",
  // O COMPONENTE COMPARTILHADO dos cinco documentos: cabeçalho, rodapé,
  // assinaturas e regras de data moram aqui, e não copiados documento a documento.
  "src/lib/processosDocumentoComum.js",
  "src/lib/processosServidores.js",
  "src/lib/processosServidoresDados.js",
  "src/lib/processosIdentidade.js",
  "src/lib/processosIdentidadeDados.js",
  "src/components/processos/SeletorBanco.jsx",
  "src/components/processos/ModalProcessoDiaria.jsx",
  "src/components/processos/ModalServidor.jsx",
  "src/components/processos/PaginaDiarias.jsx",
  "src/components/processos/PaginaServidores.jsx",
  "src/components/configuracoes/CategoriaProcessos.jsx",
  "src/pages/ModuloProcessos.jsx",
];

const SOLICITANTE = {
  id: "sol-1",
  nome: "Secretaria Municipal de Educação",
  nome_curto: "Educação",
  secretario: "Ana Lima de Oliveira",
  secretario_cpf: "987.654.321-00",
  secretario_cargo: "Secretária Municipal de Educação",
  situacao: "ativo",
};

const BANCOS = BANCOS_INICIAIS.map((banco, i) => ({ ...banco, id: `b-${i}`, situacao: "ativo" }));

function processoDeExemplo(extra = {}) {
  return {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    id: 41,
    numero: 1,
    ano: 2026,
    situacao: "rascunho",
    beneficiario_nome: "Maria Souza da Silva",
    beneficiario_cpf: "123.456.789-00",
    beneficiario_endereco: "Rua das Acácias, 120, Centro",
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
 * 1. A matrícula não aparece em lugar nenhum
 * ---------------------------------------------------------------------- */

test("1. a matrícula saiu da interface, do formulário e do documento", async () => {
  // Nem no cadastro do servidor, nem nos campos do processo.
  assert.ok(!CAMPOS_SERVIDOR.includes("matricula"));
  assert.ok(!("matricula" in servidorVazio()));
  assert.ok(!CAMPOS_REQUISICAO.includes("beneficiario_matricula"));
  assert.ok(!CAMPOS_COMPARTILHADOS.includes("beneficiario_matricula"));

  // Nem na gravação: a coluna existe no banco, mas nada é escrito nela.
  const linhaServidor = servidorParaBanco({ ...servidorVazio(), nome: "X", matricula: "2044-1" });
  assert.ok(!("matricula" in linhaServidor));
  const linhaProcesso = formularioParaBanco({
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    beneficiario_matricula: "2044-1",
  });
  assert.ok(!("beneficiario_matricula" in linhaProcesso));

  // Nem na cópia do cadastro para o documento.
  assert.ok(!("beneficiario_matricula" in dadosDoServidorParaDocumento({ id: "s", nome: "X" })));

  // Nem no que a tela mostra, nem no que ela lê do banco. Os COMENTÁRIOS podem
  // (e devem) explicar que o campo saiu -- o que não pode existir é o campo.
  const telas = [
    "src/components/processos/ModalServidor.jsx",
    "src/components/processos/PaginaServidores.jsx",
    "src/components/processos/ModalProcessoDiaria.jsx",
    "src/lib/processosServidoresDados.js",
    "src/lib/processosDiariasDados.js",
  ];
  for (const arquivo of telas) {
    assert.ok(!/matricula|Matrícula/i.test(semComentarios(await read(arquivo))), arquivo);
  }

  // E o documento impresso nunca imprime a palavra.
  const dados = dadosDoDocumento(processoDeExemplo({ beneficiario_matricula: "2044-1" }), {});
  assert.ok(!/matr[íi]cula/i.test(JSON.stringify(dados)));
  assert.ok(!/Matr[íi]cula/i.test(htmlDoProcesso(dados, { escopo: "completo" })));

  // A COLUNA fica: a migration documenta a desativação em vez de apagá-la.
  const sql = await read(`supabase/migrations/${MIGRATION_SOLICITANTES}`);
  assert.ok(!/drop\s+column/i.test(semComentariosSql(sql)));
  assert.ok(/comment on column public\.processos_servidores\.matricula/.test(sql));
  assert.ok(/comment on column public\.processos_diarias\.beneficiario_matricula/.test(sql));
});

/* -------------------------------------------------------------------------
 * 2. A data do processo é editável, e o documento imprime a escolhida
 * ---------------------------------------------------------------------- */

test("2. a data do processo é sugestão inicial, e o documento imprime a escolhida", async () => {
  // Hoje é só o valor inicial.
  assert.equal(processoVazio({ ano: 2026, hoje: "2026-09-11" }).data_processo, "2026-09-11");

  // Trocar para uma data ANTERIOR e para uma POSTERIOR grava a escolhida.
  ["2026-01-05", "2027-02-28"].forEach((escolhida) => {
    const linha = formularioParaBanco({
      ...processoVazio({ ano: 2026, hoje: "2026-09-11" }),
      data_processo: escolhida,
    });
    assert.equal(linha.data_processo, escolhida);
  });

  // E é a escolhida que sai impressa na página 1 -- agora pela DATA DA
  // REQUISIÇÃO, que é a data PRÓPRIA daquela folha.
  const dados = dadosDoDocumento(
    processoDeExemplo({ data_processo: "2026-01-05", requisicao_data: "2026-01-05" }),
    {},
  );
  assert.equal(dados.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.ok(htmlDoProcesso(dados, { escopo: "requisicao" }).includes("5 de janeiro de 2026"));

  // As TRÊS páginas têm cada uma a SUA data: a requisição imprime a dela, a
  // liquidação a dela e a prestação de contas a dela, e nunca a de hoje.
  const tresDatas = dadosDoDocumento(
    processoDeExemplo({
      data_processo: "2026-01-05",
      requisicao_data: "2026-01-05",
      liquidacao_data: "2026-04-02",
      prestacao_data: "2026-05-20",
    }),
    {},
  );
  assert.equal(tresDatas.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(tresDatas.liquidacao.localEData, "São José da Laje/AL, 2 de abril de 2026");
  assert.equal(tresDatas.prestacao.localEData, "São José da Laje/AL, 20 de maio de 2026");

  const folhas = textoDasFolhas(montarPdfDoProcesso(tresDatas, { escopo: "completo" }));
  assert.ok(folhas[0].includes("5 de janeiro de 2026"));
  assert.ok(folhas[1].includes("2 de abril de 2026"));
  assert.ok(folhas[2].includes("20 de maio de 2026"));

  // Sem data própria, as folhas acompanham a data de abertura do processo -- e
  // não a de hoje. É o que mantém o processo ANTIGO imprimindo como sempre.
  const semDatasProprias = dadosDoDocumento(
    processoDeExemplo({ data_processo: "2026-01-05", requisicao_data: "" }),
    {},
  );
  assert.equal(semDatasProprias.localEData, "São José da Laje/AL, 5 de janeiro de 2026");
  assert.equal(semDatasProprias.liquidacao.localEData, semDatasProprias.localEData);

  // O campo da tela é de data e é editável: não há `disabled` fixo nele.
  const modal = await read("src/components/processos/ModalProcessoDiaria.jsx");
  assert.ok(/rotulo="Data do processo \(abertura\)"\s*\n\s*tipo="date"/.test(modal));
  assert.ok(/onChange=\{\(v\) => definir\("data_processo", v\)\}/.test(modal));
  // E cada documento tem o campo DELE, também editável.
  assert.ok(/rotulo="Data da Requisição de Diárias"\s*\n\s*tipo="date"/.test(modal));
  assert.ok(/onChange=\{\(v\) => definir\("requisicao_data", v\)\}/.test(modal));
});

/* -------------------------------------------------------------------------
 * 3. As secretarias solicitantes, com secretário, CPF e cargo
 * ---------------------------------------------------------------------- */

test("3. cadastrar a solicitante e escolhê-la no processo traz secretário, CPF e cargo", () => {
  // Os seis campos pedidos.
  assert.deepEqual(CAMPOS_SOLICITANTE, [
    "nome",
    "nome_curto",
    "secretario",
    "secretario_cpf",
    "secretario_cargo",
  ]);
  assert.ok(ROTULOS_SOLICITANTE.situacao);
  assert.equal(solicitanteVazio().situacao, "ativo");

  // Cadastrar: o nome oficial é obrigatório, e não repete.
  assert.deepEqual(validarSolicitante(SOLICITANTE, { solicitantes: [] }), {});
  assert.ok(validarSolicitante(solicitanteVazio(), { solicitantes: [] }).nome);
  assert.ok(validarSolicitante({ ...SOLICITANTE, id: null }, { solicitantes: [SOLICITANTE] }).nome);
  assert.ok(nomeEmUso([SOLICITANTE], "  secretaria municipal de educação  "));
  assert.ok(!nomeEmUso([SOLICITANTE], SOLICITANTE.nome, { ignorarId: "sol-1" }));
  // CPF, quando informado, tem de ser um CPF.
  assert.ok(validarSolicitante({ ...SOLICITANTE, secretario_cpf: "123" }, { solicitantes: [] }).secretario_cpf);

  const linha = solicitanteParaBanco(SOLICITANTE);
  assert.equal(linha.nome, "Secretaria Municipal de Educação");
  assert.equal(linha.nome_curto, "Educação");
  assert.equal(linha.secretario, "Ana Lima de Oliveira");

  // Escolher no processo PREENCHE os quatro campos do documento.
  const dados = dadosDoSolicitanteParaDocumento(SOLICITANTE);
  assert.equal(dados.solicitante_id, "sol-1");
  assert.equal(dados.solicitante_nome, "Secretaria Municipal de Educação");
  assert.equal(dados.solicitante_secretario, "Ana Lima de Oliveira");
  assert.equal(dados.solicitante_secretario_cpf, "987.654.321-00");
  assert.equal(dados.solicitante_secretario_cargo, "Secretária Municipal de Educação");
  CAMPOS_SOLICITANTE_NO_PROCESSO.forEach((campo) => assert.ok(campo in dados, campo));

  // E os quatro vão GRAVADOS: é o congelamento.
  const gravado = formularioParaBanco({ ...processoVazio({ ano: 2026, hoje: "2026-03-10" }), ...dados });
  assert.equal(gravado.solicitante_id, "sol-1");
  assert.equal(gravado.solicitante_nome, "Secretaria Municipal de Educação");
  assert.equal(gravado.solicitante_secretario_cpf, "987.654.321-00");

  // Trocar o secretário no cadastro DEPOIS não reescreve o documento antigo.
  const finalizado = { ...processoDeExemplo({ situacao: "finalizada" }), ...dados };
  const cadastroMudou = [{ ...SOLICITANTE, secretario: "Outra Pessoa", secretario_cpf: "111" }];
  assert.equal(nomeDaSecretaria(finalizado, cadastroMudou), "Secretaria Municipal de Educação");
  const impresso = dadosDoDocumento(finalizado, { secretarias: cadastroMudou });
  assert.equal(impresso.secretaria, "Secretaria Municipal de Educação");
  assert.equal(impresso.requisitante, "Secretaria Municipal de Educação");
  const reaberto = processoParaFormulario(finalizado);
  assert.equal(reaberto.solicitante_secretario, "Ana Lima de Oliveira");
  assert.equal(formularioParaBanco(reaberto).solicitante_secretario, "Ana Lima de Oliveira");

  // O nome curto é o das listas; o oficial é o que sai impresso.
  assert.equal(rotuloDoSolicitante(SOLICITANTE), "Educação");
  assert.equal(nomeOficialDoSolicitante(SOLICITANTE), "Secretaria Municipal de Educação");

  // A escolha é exigida no processo e no cadastro de servidores.
  assert.ok(validarRascunho(processoVazio({ ano: 2026, hoje: "2026-03-10" })).solicitante_id);
  assert.deepEqual(validarRascunho({ solicitante_id: "sol-1" }), {});
  assert.ok(validarServidor(servidorVazio(), { servidores: [] }).solicitante_id);

  // Busca, ordenação e situação.
  assert.ok(solicitanteAtendeBusca(SOLICITANTE, "educa"));
  assert.ok(solicitanteAtendeBusca(SOLICITANTE, "ana lima"));
  assert.ok(!solicitanteAtendeBusca(SOLICITANTE, "saúde"));
  const inativa = { id: "sol-2", nome: "Secretaria Municipal de Saúde", situacao: "inativo" };
  assert.deepEqual(solicitantesAtivos([SOLICITANTE, inativa]).map((s) => s.id), ["sol-1"]);
  assert.equal(ordenarSolicitantes([inativa, SOLICITANTE])[0].id, "sol-1");
  assert.deepEqual(filtrarSolicitantes([SOLICITANTE, inativa], { situacao: "inativo" }).map((s) => s.id), ["sol-2"]);
  assert.ok(diferencaDoSolicitante(SOLICITANTE, { ...SOLICITANTE, secretario: "Outra" }).houveAlteracao);
});

/* -------------------------------------------------------------------------
 * 4. O cadastro de secretarias do FINANCEIRO continua intacto e separado
 * ---------------------------------------------------------------------- */

test("4. o cadastro de secretarias de Saldos/Pagamentos segue intocado e separado", async () => {
  // Duas tabelas, dois nomes, duas finalidades.
  assert.equal(TABELA_SOLICITANTES, "processos_secretarias_solicitantes");
  assert.notEqual(TABELA_SOLICITANTES, "secretarias");

  // ⚠️ Nenhum arquivo deste envio ESCREVE em public.secretarias.
  for (const arquivo of ARQUIVOS_DO_ENVIO) {
    const fonte = await read(arquivo);
    assert.ok(!/from\("secretarias"\)[^;]*\.(insert|update|upsert|delete)/s.test(fonte), arquivo);
    assert.ok(!/\.(insert|update|upsert|delete)\([^)]*\)[^;]*from\("secretarias"\)/s.test(fonte), arquivo);
  }

  // A leitura existe, e é só isso: o processo antigo continua mostrando a
  // secretaria financeira que gravou.
  const dadosDiarias = await read("src/lib/processosDiariasDados.js");
  assert.ok(/from\("secretarias"\)/.test(dadosDiarias));
  assert.ok(/\.select\(/.test(dadosDiarias));

  // A tela do financeiro não foi tocada por este envio.
  const financeiro = await read("src/components/configuracoes/CategoriaFinanceiro.jsx");
  assert.ok(!/solicitante|processos_bancos|processos_secretarias/i.test(financeiro));

  // E a migration não altera, não mescla e não apaga nada lá: `secretarias`
  // aparece apenas em leitura, para semear o cadastro novo.
  const sql = await read(`supabase/migrations/${MIGRATION_SOLICITANTES}`);
  assert.ok(!/(alter|drop)\s+table\s+(public\.)?secretarias\b/i.test(sql));
  assert.ok(!/(update|delete\s+from)\s+(public\.)?secretarias\b/i.test(sql));
  assert.ok(!/insert\s+into\s+(public\.)?secretarias\b/i.test(sql));
  assert.ok(/from public\.secretarias/.test(sql));

  // A lista de consulta junta as duas SEM mesclar cadastro: as solicitantes
  // primeiro, e cada linha diz de onde veio.
  const lista = listaDeSecretariasDoProcesso([SOLICITANTE], [{ id: 3, nome: "Secretaria de Finanças" }]);
  assert.equal(lista[0].solicitante, true);
  assert.equal(lista[0].nome, "Secretaria Municipal de Educação");
  assert.equal(lista[1].solicitante, false);
  assert.equal(lista[1].nome, "Secretaria de Finanças");
});

/* -------------------------------------------------------------------------
 * 5 e 6. O cadastro de bancos: escolher na lista, buscar e cadastrar novo
 * ---------------------------------------------------------------------- */

test("5. escolher o banco na lista funciona, com busca, e imprime número + nome", () => {
  // Os dez bancos pedidos, na ordem em que foram pedidos.
  assert.deepEqual(
    BANCOS_INICIAIS.map((b) => `${b.numero} ${b.nome}`),
    [
      "001 Banco do Brasil",
      "104 Caixa Econômica Federal",
      "237 Bradesco",
      "341 Itaú",
      "033 Santander",
      "756 Sicoob",
      "748 Sicredi",
      "077 Banco Inter",
      "260 Nu Pagamentos",
      "336 Banco C6",
    ],
  );

  // "001 — Banco do Brasil": número e nome juntos, como no modelo oficial.
  assert.equal(rotuloDoBanco(BANCOS[0]), `001${SEPARADOR_BANCO}Banco do Brasil`);
  assert.equal(rotuloDoBanco({ numero: "1", nome: "Banco do Brasil" }), "001 — Banco do Brasil");
  assert.equal(numeroDoBancoFormatado("33"), "033");
  assert.equal(numeroDoBancoFormatado("0001"), "0001");

  // A busca acha por NÚMERO e por NOME.
  assert.ok(bancoAtendeBusca(BANCOS[0], "001"));
  assert.ok(bancoAtendeBusca(BANCOS[0], "1"));
  assert.ok(bancoAtendeBusca(BANCOS[0], "brasil"));
  assert.ok(!bancoAtendeBusca(BANCOS[0], "bradesco"));
  assert.deepEqual(filtrarBancos(BANCOS, { busca: "237" }).map((b) => b.nome), ["Bradesco"]);
  assert.equal(filtrarBancos(BANCOS, { limite: 3 }).length, 3);

  // Escolher grava o PAR número + nome no documento.
  const dados = dadosDoBancoParaDocumento(BANCOS[2]);
  assert.deepEqual(dados, { banco_codigo: "237", banco: "Bradesco" });
  const linha = formularioParaBanco({ ...processoVazio({ ano: 2026, hoje: "2026-03-10" }), ...dados });
  assert.equal(linha.banco_codigo, "237");
  assert.equal(linha.banco, "Bradesco");
  assert.ok(CAMPOS_COMPARTILHADOS.includes("banco_codigo"));
  assert.ok(CAMPOS_SERVIDOR.includes("banco_codigo"));
  assert.equal(servidorParaBanco({ ...servidorVazio(), nome: "X", ...dadosDoBancoParaDocumento(BANCOS[0]) }).banco_codigo, "001");

  // E o documento imprime os dois juntos, na página 2 (é onde o modelo oficial
  // pede os dados bancários).
  const doc = dadosDoDocumento(processoDeExemplo({ banco_codigo: "001", banco: "Banco do Brasil" }), {});
  assert.equal(doc.banco.banco, "001 — Banco do Brasil");
  assert.ok(htmlDoProcesso(doc, { escopo: "liquidacao" }).includes("001 — Banco do Brasil"));
  assert.ok(
    textoDasFolhas(montarPdfDoProcesso(doc, { escopo: "liquidacao" }))[0].includes("001"),
  );

  // Banco INATIVO sai das escolhas novas, mas o já gravado continua legível.
  const comInativo = [...BANCOS.slice(0, 2), { ...BANCOS[2], situacao: "inativo" }];
  assert.deepEqual(bancosAtivos(comInativo).map((b) => b.numero), ["001", "104"]);
  assert.deepEqual(bancosParaEscolha(comInativo, { manterCodigo: "237" }).map((b) => b.numero), ["001", "104", "237"]);
  assert.equal(bancoDoDocumento({ banco_codigo: "237", banco: "Bradesco" }), "237 — Bradesco");

  // Documento ANTIGO, gravado quando o banco era texto livre: sem número, sai
  // exatamente o nome que ele gravou.
  assert.equal(bancoDoDocumento({ banco: "Bradesco" }), "Bradesco");
  const antigo = dadosDoDocumento(processoDeExemplo({ banco: "Bradesco" }), {});
  assert.equal(antigo.banco.banco, "Bradesco");
});

test("6. cadastrar um banco novo funciona, e não precisa de deploy", async () => {
  assert.equal(TABELA_BANCOS, "processos_bancos");
  assert.equal(bancoVazio().situacao, "ativo");

  // Número e nome são obrigatórios; o número não repete.
  const novo = { ...bancoVazio(), numero: "422", nome: "Banco Safra" };
  assert.deepEqual(validarBanco(novo, { bancos: BANCOS }), {});
  assert.ok(validarBanco(bancoVazio(), { bancos: [] }).numero);
  assert.ok(validarBanco({ ...bancoVazio(), numero: "001" }, { bancos: [] }).nome);
  assert.ok(validarBanco({ ...bancoVazio(), numero: "001", nome: "Outro" }, { bancos: BANCOS }).numero);
  // "1" e "001" são o MESMO banco: o zero à esquerda não cria um segundo.
  assert.ok(validarBanco({ ...bancoVazio(), numero: "1", nome: "Outro" }, { bancos: BANCOS }).numero);
  assert.ok(numeroEmUso(BANCOS, "1"));
  assert.ok(!numeroEmUso(BANCOS, "422"));

  // A SITUAÇÃO não sai por edição: inativar e reativar têm caminho próprio.
  assert.deepEqual(bancoParaBanco(novo), { numero: "422", nome: "Banco Safra" });

  // O cadastro é uma TELA, em Configurações → Processos: banco novo entra por
  // lá, sem deploy.
  const configuracoes = await read("src/components/configuracoes/CategoriaProcessos.jsx");
  assert.ok(/criarBanco/.test(configuracoes));
  assert.ok(/salvarBanco/.test(configuracoes));
  assert.ok(/criarSolicitante/.test(configuracoes));
  assert.ok(/salvarSolicitante/.test(configuracoes));

  // E a semente da migration é semente, não trava: `where not exists`.
  const sql = await read(`supabase/migrations/${MIGRATION_BANCOS}`);
  assert.ok(/insert into public\.processos_bancos/.test(sql));
  assert.ok(/where not exists/.test(sql));
  BANCOS_INICIAIS.forEach((banco) => assert.ok(sql.includes(`'${banco.nome}'`), banco.nome));
});

/* -------------------------------------------------------------------------
 * 7. Processo já criado continua abrindo normalmente
 * ---------------------------------------------------------------------- */

test("7. processo já criado continua abrindo, imprimindo e salvando", () => {
  // Um processo ANTIGO: secretaria do financeiro, banco em texto livre,
  // matrícula gravada e nenhum dado de solicitante.
  const antigo = processoDeExemplo({
    secretaria_id: 3,
    banco: "Bradesco",
    beneficiario_matricula: "2044-1",
    situacao: "finalizada",
  });
  const financeiras = [{ id: 3, nome: "Secretaria Municipal de Assistência Social" }];

  // Abre: o formulário volta com tudo o que ele tem.
  const formulario = processoParaFormulario(antigo);
  assert.equal(formulario.secretaria_id, 3);
  assert.equal(formulario.solicitante_id, "");
  assert.equal(formulario.banco, "Bradesco");

  // Continua mostrando a secretaria que gravou.
  assert.equal(nomeDaSecretaria(antigo, financeiras), "Secretaria Municipal de Assistência Social");
  assert.equal(
    nomeDaSecretaria(antigo, listaDeSecretariasDoProcesso([SOLICITANTE], financeiras)),
    "Secretaria Municipal de Assistência Social",
  );

  // Continua salvando: a validação aceita a secretaria legada.
  assert.deepEqual(validarRascunho(formulario), {});

  // Continua imprimindo, e sem a matrícula.
  const documento = dadosDoDocumento(antigo, { secretarias: financeiras });
  assert.equal(documento.secretaria, "Secretaria Municipal de Assistência Social");
  assert.equal(documento.banco.banco, "Bradesco");
  const html = htmlDoProcesso(documento, { escopo: "completo" });
  assert.ok(html.includes("Secretaria Municipal de Assistência Social"));
  assert.ok(!/Matr[íi]cula/i.test(html));
  assert.equal(textoDasFolhas(montarPdfDoProcesso(documento, { escopo: "completo" })).length, 3);
});

/* -------------------------------------------------------------------------
 * 5b. O rodapé institucional, padronizado com o CEP
 * ---------------------------------------------------------------------- */

test("o rodapé institucional sai em três linhas, com o CEP, em todas as páginas", async () => {
  assert.equal(
    IDENTIDADE_PADRAO.rodape_endereco,
    "Rua Dr. Oscar Gordilho, 23 – Centro – CEP: 57.860-000 – São José da Laje – Alagoas",
  );
  assert.equal(
    IDENTIDADE_PADRAO.rodape_contato,
    "Tel.: (82) 99395-5442 – E-mail: prefeitura@saojosedalaje.al.gov.br",
  );
  assert.equal(IDENTIDADE_PADRAO.rodape_cnpj, "CNPJ: 12.330.916/0001-99");
  assert.deepEqual(CAMPOS_RODAPE, ["rodape_endereco", "rodape_contato", "rodape_cnpj"]);
  assert.ok(validarIdentidade({}).rodape_cnpj === undefined);

  // As três linhas saem nas TRÊS páginas do processo.
  const dados = dadosDoDocumento(processoDeExemplo(), {});
  const html = htmlDoProcesso(dados, { escopo: "completo" });
  CAMPOS_RODAPE.forEach((campo) => {
    const linha = IDENTIDADE_PADRAO[campo];
    assert.equal(html.split(linha).length - 1 >= 3, true, campo);
  });
  const folhas = textoDasFolhas(montarPdfDoProcesso(dados, { escopo: "completo" }));
  assert.equal(folhas.length, 3);
  folhas.forEach((folha, i) => {
    assert.ok(folha.includes("CEP: 57.860-000"), `folha ${i + 1}`);
    assert.ok(folha.includes("CNPJ: 12.330.916/0001-99"), `folha ${i + 1}`);
  });

  // A configuração de fábrica ANTIGA é atualizada sozinha, sem redigitação.
  const atualizada = normalizarIdentidade(atualizarRodapeLegado({ ...RODAPE_LEGADO }));
  assert.equal(atualizada.rodape_endereco, IDENTIDADE_PADRAO.rodape_endereco);
  assert.equal(atualizada.rodape_contato, IDENTIDADE_PADRAO.rodape_contato);
  assert.equal(atualizada.rodape_cnpj, IDENTIDADE_PADRAO.rodape_cnpj);

  // Texto REESCRITO à mão pela prefeitura nunca é sobrescrito.
  const aMao = atualizarRodapeLegado({ rodape_endereco: "Praça da Matriz, s/n" });
  assert.equal(aMao.rodape_endereco, "Praça da Matriz, s/n");

  // ⚠️ Identidade CONGELADA em processo antigo trazia o CNPJ dentro da linha de
  // contato: a terceira linha sai vazia, e o documento não repete o CNPJ.
  const congelada = normalizarIdentidade(RODAPE_LEGADO);
  assert.equal(congelada.rodape_cnpj, "");
  const antigo = dadosDoDocumento(processoDeExemplo(), {
    identidade: { ...RODAPE_LEGADO, orgao: "PREFEITURA", estado: "ALAGOAS" },
  });
  const htmlAntigo = htmlDoProcesso(antigo, { escopo: "requisicao" });
  assert.equal(htmlAntigo.split("CNPJ: 12.330.916/0001-99").length - 1, 1);

  // O rodapé continua configurável em Configurações → Processos.
  const configuracoes = await read("src/components/configuracoes/CategoriaProcessos.jsx");
  assert.ok(/rodape_cnpj/.test(configuracoes));
  assert.ok(/rodape_endereco/.test(configuracoes));
  assert.ok(/rodape_contato/.test(configuracoes));
});

/* -------------------------------------------------------------------------
 * 8. Nada aqui altera saldo, dá baixa ou mexe na programação
 * ---------------------------------------------------------------------- */

const TABELAS_PROIBIDAS = [
  "pagamentos",
  "pagamentos_baixas",
  "valores_em_aberto",
  "saldos_historico",
  "contas_bancarias",
  "transferencias_contas",
  "programacoes_pagamento",
  "fornecedores",
];

test("8. nada neste envio debita conta, dá baixa em NF, altera saldo ou cria pagamento", async () => {
  const novos = [
    "src/lib/processosSecretariasSolicitantes.js",
    "src/lib/processosBancos.js",
    "src/lib/processosCadastrosDados.js",
    "src/components/processos/SeletorBanco.jsx",
  ];

  for (const arquivo of novos) {
    const fonte = await read(arquivo);
    for (const tabela of TABELAS_PROIBIDAS) {
      assert.ok(!new RegExp(`from\\("${tabela}"\\)`).test(fonte), `${arquivo} -> ${tabela}`);
    }
    assert.ok(!/\.rpc\(/.test(fonte), arquivo);
    assert.ok(!/saldo|baixa|programacao|programação/i.test(semComentarios(fonte)), arquivo);
  }

  // A migration é ADITIVA e não referencia nenhuma tabela financeira.
  const sql = await read(`supabase/migrations/${MIGRATION_SOLICITANTES}`);
  const codigo = semComentariosSql(sql);
  assert.ok(/^begin;$/m.test(codigo));
  assert.ok(/^commit;$/m.test(codigo));
  assert.ok(!/drop\s+(table|column)/i.test(codigo));
  [
    "pagamentos",
    "pagamentos_baixas",
    "valores_em_aberto",
    "saldos_historico",
    "contas_bancarias",
    "transferencias_contas",
    "programacoes_pagamento",
  ].forEach((tabela) => {
    const usos = sql.match(new RegExp(`public\\.${tabela}\\b`, "g")) ?? [];
    // Só a lista de garantias do cabeçalho pode citá-las, e ela é comentário.
    usos.forEach(() => {});
    assert.ok(!new RegExp(`public\\.${tabela}\\b`).test(codigo), tabela);
  });

  // E as duas migrations citadas pelas telas são a MESMA, rodada à mão.
  assert.equal(MIGRATION_SOLICITANTES, MIGRATION_BANCOS);
  assert.ok(/SQL Editor do Supabase/.test(AVISO_MIGRATION_SOLICITANTES));
  assert.ok(/MANUALMENTE no SQL Editor/.test(sql));
});
