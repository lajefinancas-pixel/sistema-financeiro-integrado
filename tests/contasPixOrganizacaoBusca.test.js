import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TIPOS_CHAVE_PIX,
  contaTemPix,
  dadosPixParaGravar,
  documentoDoTitularObrigatorio,
  retratoDoCadastro,
  tipoChavePixLabel,
  validarCadastroConta,
  validarPixDaConta,
} from "../src/lib/contasBancariasRegras.js";
import {
  MENSAGEM_SEM_RESULTADO,
  agruparContasPorSecretaria,
  alternarGrupo,
  contaAtendeBusca,
  filtrarContasCadastradas,
  grupoRecolhido,
  linhaDaConta,
  rotuloDoGrupo,
  selecionadasNoGrupo,
} from "../src/lib/contasBancariasBusca.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260904120000_conta_bancaria_agencia_e_pix.sql";

const CADASTRO_VALIDO = {
  secretaria_id: "3",
  banco_id: "1",
  nome_conta: "FPM",
  numero_conta: "2.042-7",
  tipo_conta: "corrente",
};

const CONTAS = [
  { id: 1, secretaria_id: 10, secretaria: "SAÚDE", banco: "Banco do Brasil", agencia: "1234-5", numero_conta: "2.042-7", nome_conta: "FUNDO MUNICIPAL DE SAÚDE", saldo: 1500 },
  { id: 2, secretaria_id: 10, secretaria: "SAÚDE", banco: "Caixa", agencia: "9876", numero_conta: "51.221-0", nome_conta: "PAB", saldo: 200 },
  { id: 3, secretaria_id: 20, secretaria: "EDUCAÇÃO", banco: "Sicoob", agencia: "1234-5", numero_conta: "7.100-1", nome_conta: "FUNDEB", saldo: 0 },
  { id: 4, secretaria_id: 30, secretaria: "FINANÇAS", banco: "Banco do Brasil", agencia: "555", numero_conta: "9.999-9", nome_conta: "TRIBUTOS", saldo: null },
];

// ---------------------------------------------------------------------------
// 1. PIX no MESMO cadastro da conta
// ---------------------------------------------------------------------------

test("PIX é opcional: conta sem PIX salva normalmente", () => {
  assert.equal(validarCadastroConta({ ...CADASTRO_VALIDO }).valido, true);
  assert.equal(validarCadastroConta({ ...CADASTRO_VALIDO, possui_pix: false }).valido, true);
  assert.deepEqual(validarPixDaConta({ possui_pix: false }), {});

  // "Não" limpa os campos de PIX na gravação, sem deixar chave órfã.
  assert.deepEqual(dadosPixParaGravar({ possui_pix: false, pix_chave: "algo" }), {
    possui_pix: false,
    pix_tipo_chave: null,
    pix_chave: null,
    pix_titular: null,
    pix_documento_titular: null,
  });
});

test("com PIX marcado, tipo da chave, chave e titular passam a ser conferidos", () => {
  const semNada = validarCadastroConta({ ...CADASTRO_VALIDO, possui_pix: true });
  assert.equal(semNada.valido, false);
  for (const campo of ["pix_tipo_chave", "pix_chave", "pix_titular"]) {
    assert.ok(semNada.erros[campo], `${campo} deveria ser conferido`);
  }

  const completo = validarCadastroConta({
    ...CADASTRO_VALIDO,
    possui_pix: true,
    pix_tipo_chave: "aleatoria",
    pix_chave: "abc-123",
    pix_titular: "PREFEITURA MUNICIPAL",
  });
  assert.equal(completo.valido, true);
});

test("CPF/CNPJ do titular é conferido só quando o tipo da chave é CPF ou CNPJ", () => {
  assert.equal(documentoDoTitularObrigatorio("cpf"), true);
  assert.equal(documentoDoTitularObrigatorio("cnpj"), true);
  for (const tipo of ["telefone", "email", "aleatoria", "", null]) {
    assert.equal(documentoDoTitularObrigatorio(tipo), false);
  }

  const base = { ...CADASTRO_VALIDO, possui_pix: true, pix_chave: "123", pix_titular: "PREFEITURA" };
  assert.equal(validarCadastroConta({ ...base, pix_tipo_chave: "cpf" }).valido, false);
  assert.equal(
    validarCadastroConta({ ...base, pix_tipo_chave: "cpf", pix_documento_titular: "111.111.111-11" }).valido,
    true,
  );
  assert.equal(validarCadastroConta({ ...base, pix_tipo_chave: "email" }).valido, true);
});

test("os cinco tipos de chave são exatamente os oferecidos no formulário", () => {
  assert.deepEqual(TIPOS_CHAVE_PIX.map((tipo) => tipo.id), ["cpf", "cnpj", "telefone", "email", "aleatoria"]);
  assert.deepEqual(TIPOS_CHAVE_PIX.map((tipo) => tipo.label), ["CPF", "CNPJ", "Telefone", "E-mail", "Chave aleatória"]);
  // Tipo antigo, gravado fora da lista, continua sendo exibido como está.
  assert.equal(tipoChavePixLabel("pix_qr"), "pix_qr");
  assert.equal(contaTemPix("sim"), true);
  assert.equal(contaTemPix(null), false);
});

test("agência e PIX ficam no MESMO formulário do cadastro, na ordem pedida", async () => {
  const modal = await read("src/components/saldos/ModalContaBancaria.jsx");
  // Um único formulário: nenhuma aba, botão ou página separada de PIX.
  assert.equal(modal.match(/<form /g).length, 1);
  assert.doesNotMatch(modal, /aba de pix|abrir pix|Cadastrar PIX|nova página/i);

  const ordem = ["Secretaria", "Banco", "Agência", "Número da conta", "Nome da conta", "Possui PIX?", "Saldo inicial"];
  let anterior = -1;
  for (const rotulo of ordem) {
    const posicao = modal.indexOf(`label="${rotulo}"`);
    assert.ok(posicao > anterior, `${rotulo} fora de ordem no formulário`);
    anterior = posicao;
  }

  for (const rotulo of ["Tipo da chave", "Chave PIX", "Titular", "CPF/CNPJ do titular"]) {
    assert.match(modal, new RegExp(`label="${rotulo}"`));
  }
  // Editar cadastro continua sem tocar em saldo.
  assert.match(modal, /O saldo desta conta não é editado aqui/);
});

test("retrato do cadastro leva agência e PIX para a auditoria", async () => {
  const retrato = retratoDoCadastro({
    secretaria: "SAÚDE",
    banco: "Caixa",
    agencia: "1234-5",
    numero_conta: "2.042-7",
    nome_conta: "FPM",
    tipo_conta: "corrente",
    possui_pix: true,
    pix_tipo_chave: "cnpj",
    pix_chave: "00.000.000/0001-00",
    pix_titular: "PREFEITURA",
    pix_documento_titular: "00.000.000/0001-00",
  });
  assert.equal(retrato.agencia, "1234-5");
  assert.equal(retrato.possui_pix, "Sim");
  assert.equal(retrato.pix_tipo_chave, "CNPJ");

  // O dicionário da auditoria traduz cada chave do retrato.
  const auditoria = await read("src/lib/auditoria.js");
  for (const chave of Object.keys(retrato)) {
    assert.match(auditoria, new RegExp(`^\\s{2}${chave}:`, "m"), `${chave} sem rótulo na auditoria`);
  }
});

// ---------------------------------------------------------------------------
// 2 e 3. Organização por Secretaria e grupos que abrem e fecham
// ---------------------------------------------------------------------------

test("contas ficam agrupadas por Secretaria, com a contagem no cabeçalho", () => {
  const grupos = agruparContasPorSecretaria(CONTAS, { ordem: [30, 10, 20] });
  assert.deepEqual(grupos.map((grupo) => grupo.nome), ["FINANÇAS", "SAÚDE", "EDUCAÇÃO"]);
  assert.deepEqual(grupos.map((grupo) => grupo.quantidade), [1, 2, 1]);

  // Cada conta continua na secretaria dela, uma única vez.
  assert.deepEqual(
    grupos.flatMap((grupo) => grupo.contas.map((conta) => conta.id)).sort(),
    [1, 2, 3, 4],
  );

  assert.equal(rotuloDoGrupo({ nome: "Saúde", quantidade: 12 }), "SAÚDE — 12 contas");
  assert.equal(rotuloDoGrupo({ nome: "Educação", quantidade: 9 }), "EDUCAÇÃO — 9 contas");
  assert.equal(rotuloDoGrupo({ nome: "Finanças", quantidade: 1 }), "FINANÇAS — 1 conta");
});

test("recolher mexe só naquele grupo e não desmarca conta nenhuma", () => {
  const selecionadas = new Set(["1", "3"]);

  let recolhidos = alternarGrupo(new Set(), "10");
  assert.equal(grupoRecolhido(recolhidos, "10"), true);
  assert.equal(grupoRecolhido(recolhidos, "20"), false);

  recolhidos = alternarGrupo(recolhidos, "20");
  assert.equal(grupoRecolhido(recolhidos, "10"), true);
  assert.equal(grupoRecolhido(recolhidos, "20"), true);

  recolhidos = alternarGrupo(recolhidos, "10");
  assert.equal(grupoRecolhido(recolhidos, "10"), false);
  assert.equal(grupoRecolhido(recolhidos, "20"), true);

  // A seleção é outro estado: recolher não a toca.
  assert.deepEqual([...selecionadas], ["1", "3"]);
  const grupos = agruparContasPorSecretaria(CONTAS);
  const saude = grupos.find((grupo) => grupo.nome === "SAÚDE");
  assert.equal(selecionadasNoGrupo(saude, selecionadas), 1);
});

test("Saldos das Contas organiza por secretaria sem criar subtotal por secretaria", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  assert.match(pagina, /rotuloDoGrupo\(\{ nome: sec\.nome, quantidade: sec\.contas\.length \}\)/);
  assert.match(pagina, /alternarSecretaria\(sec\.id\)/);
  // O cabeçalho do grupo continua sem subtotal.
  assert.match(pagina, /não exibe subtotal/);
  const cabecalho = pagina.slice(pagina.indexOf("propsAlca(sec.id)"), pagina.indexOf("sec.contas.length === 0"));
  assert.doesNotMatch(cabecalho, /formatBRL\(sec\.total\)/);
  // Ordem das colunas da tabela, intacta.
  assert.ok(pagina.indexOf(">Banco<") < pagina.indexOf(">Número da Conta<"));
  assert.ok(pagina.indexOf(">Número da Conta<") < pagina.indexOf(">Saldo<"));
  assert.ok(pagina.indexOf(">Saldo<") < pagina.indexOf(">Nome da Conta<"));
});

// ---------------------------------------------------------------------------
// 4. Busca da conta já cadastrada
// ---------------------------------------------------------------------------

test("busca acha a conta por número, parte do número, nome, banco, agência e secretaria", () => {
  const acha = (termo) => filtrarContasCadastradas(CONTAS, termo).map((conta) => conta.id);

  assert.deepEqual(acha("2.042-7"), [1]);
  assert.deepEqual(acha("20427"), [1]);
  assert.deepEqual(acha("042"), [1]);
  assert.deepEqual(acha("fundeb"), [3]);
  assert.deepEqual(acha("SICOOB"), [3]);
  assert.deepEqual(acha("1234-5"), [1, 3]);
  assert.deepEqual(acha("saude"), [1, 2]);
  assert.deepEqual(acha("educacao"), [3]);
  // Termo vazio devolve tudo, sem filtrar.
  assert.equal(acha("").length, CONTAS.length);
});

test("a busca é global: encontra conta de qualquer secretaria e mostra a secretaria", () => {
  // Nenhum grupo aberto interfere: a busca varre a lista inteira.
  const encontradas = filtrarContasCadastradas(CONTAS, "banco do brasil");
  assert.deepEqual(encontradas.map((conta) => conta.secretaria), ["SAÚDE", "FINANÇAS"]);

  const linha = linhaDaConta(CONTAS[0]);
  assert.deepEqual(Object.keys(linha), ["id", "banco", "numero_conta", "nome_conta", "secretaria", "agencia", "saldo"]);
  assert.equal(linha.secretaria, "SAÚDE");
  assert.equal(linhaDaConta({ id: 9 }).secretaria, "--");
});

test("sem resultado, a mensagem é exatamente a combinada", () => {
  assert.equal(MENSAGEM_SEM_RESULTADO, "Nenhuma conta cadastrada encontrada.");
  assert.deepEqual(filtrarContasCadastradas(CONTAS, "conta que não existe"), []);
  assert.equal(contaAtendeBusca(CONTAS[0], "zzz"), false);
});

test("toda tela que seleciona conta tem o campo Buscar conta...", async () => {
  const [seletor, saldos, programacao, baixa, transferencia, execucao] = await Promise.all([
    read("src/components/comuns/SeletorContas.jsx"),
    read("src/pages/Saldos.jsx"),
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/components/baixas/ModalRegistrarBaixa.jsx"),
    read("src/components/pagamentos/ModalTransferenciaEntreContas.jsx"),
    read("src/components/pagamentos/PainelExecucaoProgramacao.jsx"),
  ]);

  // O seletor compartilhado usa o texto único das telas operacionais
  // ("Buscar conta por número, nome, banco ou Secretaria..."); a tela de Saldos
  // continua com o campo próprio dela.
  assert.match(seletor, /placeholder = PLACEHOLDER_BUSCA_CONTA/);
  assert.match(saldos, /placeholder="Buscar conta\.\.\."/);
  for (const tela of [programacao, baixa, transferencia, execucao]) {
    assert.match(tela, /<SeletorContas/);
  }

  // Busca enquanto se digita, sem recarregar a página: nada de submit, nada de
  // consulta ao banco dentro do seletor.
  assert.doesNotMatch(seletor, /supabase|window\.location|<form|onSubmit|type="submit"/i);
  assert.match(seletor, /onChange=\{\(evento\) => mudarBusca\(evento\.target\.value\)\}/);
});

// ---------------------------------------------------------------------------
// 5. Nunca criar conta manual
// ---------------------------------------------------------------------------

// Comentário explicando a regra não é oferta de criar conta: a conferência olha
// só o código, sem os comentários.
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("nenhuma tela de seleção oferece criar, inventar ou cadastrar conta na hora", async () => {
  const arquivos = await Promise.all([
    read("src/components/comuns/SeletorContas.jsx"),
    read("src/lib/contasBancariasBusca.js"),
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/components/baixas/ModalRegistrarBaixa.jsx"),
    read("src/components/pagamentos/ModalTransferenciaEntreContas.jsx"),
  ]);

  for (const arquivo of arquivos) {
    const codigo = semComentarios(arquivo);
    assert.doesNotMatch(codigo, /nova conta|conta avulsa|conta temporária|cadastro rápido/i);
    assert.doesNotMatch(codigo, /criarContaBancaria|\+ Cadastrar nova conta/);
    assert.doesNotMatch(codigo, /from\("contas_bancarias"\)[\s\S]{0,120}\.insert\(/);
  }

  // O seletor só devolve conta que recebeu na lista: nenhuma opção "outra".
  const seletor = arquivos[0];
  assert.match(seletor, /Só se escolhe conta que já está cadastrada/);
});

// ---------------------------------------------------------------------------
// 6. Rolagem interna da lista
// ---------------------------------------------------------------------------

test("a lista de contas tem altura máxima e rola por dentro, sem travar a página", async () => {
  const [seletor, saldos] = await Promise.all([
    read("src/components/comuns/SeletorContas.jsx"),
    read("src/pages/Saldos.jsx"),
  ]);
  assert.match(seletor, /max-h-\[320px\] sm:max-h-\[380px\]/);
  assert.match(seletor, /overflow-y-auto overscroll-contain/);
  assert.match(saldos, /max-h-\[60vh\] overflow-y-auto overflow-x-auto overscroll-contain print:max-h-none/);
  // Nada de travar a rolagem da página.
  for (const arquivo of [seletor, saldos]) {
    assert.doesNotMatch(arquivo, /overflow-hidden">\s*$/m);
    assert.doesNotMatch(arquivo, /document\.body\.style\.overflow/);
  }
});

// ---------------------------------------------------------------------------
// Regras financeiras que a entrega não pode encostar
// ---------------------------------------------------------------------------

test("escolher conta não movimenta saldo em nenhuma das telas", async () => {
  const [seletor, busca, baixa] = await Promise.all([
    read("src/components/comuns/SeletorContas.jsx"),
    read("src/lib/contasBancariasBusca.js"),
    read("src/components/baixas/ModalRegistrarBaixa.jsx"),
  ]);
  for (const arquivo of [seletor, busca]) {
    assert.doesNotMatch(arquivo, /saldos_historico|lancarSaldo|update\(|insert\(|rpc\(/);
  }
  // A baixa continua dizendo, na própria tela, que não altera saldo de conta.
  assert.match(baixa, /não altera o saldo da conta/);
});

test("migration de agência e PIX é idempotente, transacional e só acrescenta", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /^-- Agência e PIX no cadastro da conta bancária/);
  assert.match(sql, /\bbegin;/);
  assert.match(sql, /\bcommit;/);
  assert.match(sql, /add column if not exists agencia text/);
  for (const coluna of ["possui_pix", "pix_tipo_chave", "pix_chave", "pix_titular", "pix_documento_titular"]) {
    assert.match(sql, new RegExp(`add column if not exists ${coluna}`));
  }
  // Nada de apagar, renomear ou reescrever dado existente.
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|alter column|rename)\b/i);
  assert.doesNotMatch(sql, /\bupdate public\.(contas_bancarias|saldos_historico|pagamentos)\b/i);
  // A restrição do tipo da chave só entra quando os dados a respeitam.
  assert.match(sql, /raise notice 'public\.contas_bancarias tem % registro\(s\) com pix_tipo_chave/);
});

test("a estrutura ausente esconde os campos em vez de derrubar a tela", async () => {
  const [lib, saldos, modal] = await Promise.all([
    read("src/lib/contasBancarias.js"),
    read("src/pages/Saldos.jsx"),
    read("src/components/saldos/ModalContaBancaria.jsx"),
  ]);
  assert.match(lib, /export const estruturaDePixAusente = estruturaDeFonteAusente;/);
  assert.match(lib, /\{ comFonteRecurso: false, comPix: false \}/);
  assert.match(saldos, /setComPix\(temColunasPix\)/);
  assert.match(saldos, /comPix=\{comPix\}/);
  assert.match(modal, /\{comPix && \(/);
});
