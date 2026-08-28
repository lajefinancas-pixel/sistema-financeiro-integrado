import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  alteracoesDoCadastro,
  chaveDoNumero,
  contaDuplicada,
  mensagemDuplicidade,
  retratoDasAlteracoes,
  retratoDoCadastro,
  saldoInicialInformado,
  tipoContaLabel,
  validarCadastroConta,
} from "../src/lib/contasBancariasRegras.js";
import { campoPreenchido, linhasParaLancamento } from "../src/lib/lancamentoSaldosRegras.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const migration = "supabase/migrations/20260828120000_cadastro_contas_bancarias.sql";

const CADASTRO_VALIDO = {
  secretaria_id: "3",
  banco_id: "1",
  nome_conta: "FPM",
  numero_conta: "2.042-7",
  tipo_conta: "corrente",
};

// ---------------------------------------------------------------------------
// Cadastro: obrigatórios, saldo inicial e duplicidade
// ---------------------------------------------------------------------------

test("banco, número, nome, tipo e secretaria são obrigatórios", () => {
  assert.equal(validarCadastroConta(CADASTRO_VALIDO).valido, true);

  for (const campo of ["secretaria_id", "banco_id", "nome_conta", "numero_conta", "tipo_conta"]) {
    const validacao = validarCadastroConta({ ...CADASTRO_VALIDO, [campo]: "" });
    assert.equal(validacao.valido, false, `${campo} deveria ser obrigatório`);
    assert.ok(validacao.mensagem);
  }
});

test("secretaria e banco criados na hora satisfazem a obrigatoriedade", () => {
  const validacao = validarCadastroConta({
    ...CADASTRO_VALIDO,
    secretaria_id: "",
    banco_id: "",
    nova_secretaria: true,
    secretaria_novo_nome: "Secretaria de Saúde",
    novo_banco: true,
    banco_novo_nome: "Banco do Nordeste",
  });
  assert.equal(validacao.valido, true);
});

test("saldo inicial é opcional, mas quando informado precisa ser numérico e não negativo", () => {
  assert.equal(validarCadastroConta({ ...CADASTRO_VALIDO, saldo_inicial: "" }).valido, true);
  assert.equal(validarCadastroConta({ ...CADASTRO_VALIDO, saldo_inicial: 0 }).valido, true);
  assert.equal(validarCadastroConta({ ...CADASTRO_VALIDO, saldo_inicial: "1.250,30" }).valido, true);

  const semNumero = validarCadastroConta({ ...CADASTRO_VALIDO, saldo_inicial: "abc" });
  assert.equal(semNumero.valido, false);
  assert.match(semNumero.erros.saldo_inicial, /numérico/i);

  const negativo = validarCadastroConta({ ...CADASTRO_VALIDO, saldo_inicial: -50 });
  assert.equal(negativo.valido, false);
  assert.match(negativo.erros.saldo_inicial, /negativo/i);
});

test("saldo inicial em branco não é zero: a conta nasce sem lançamento", () => {
  assert.equal(saldoInicialInformado(""), false);
  assert.equal(saldoInicialInformado(null), false);
  assert.equal(saldoInicialInformado(0), true);
  assert.equal(saldoInicialInformado("1000"), true);
});

test("número da conta é comparado sem pontuação", () => {
  assert.equal(chaveDoNumero("2.042-7"), "20427");
  assert.equal(chaveDoNumero("2042-7"), chaveDoNumero("20427"));
  assert.equal(chaveDoNumero(""), "");
});

test("duas contas com o mesmo número, banco e secretaria são bloqueadas", () => {
  const contas = [
    { id: 1, secretaria_id: 3, banco_id: 1, numero_conta: "2.042-7", ativo: true },
    { id: 2, secretaria_id: 4, banco_id: 1, numero_conta: "2.042-7", ativo: true },
  ];

  const conflito = contaDuplicada({ contas, secretariaId: 3, bancoId: 1, numeroConta: "20427" });
  assert.equal(conflito?.id, 1);
  assert.match(mensagemDuplicidade(conflito), /Já existe uma conta/);

  // Outra secretaria, outro banco ou outro número: cadastro liberado.
  assert.equal(contaDuplicada({ contas, secretariaId: 9, bancoId: 1, numeroConta: "20427" }), null);
  assert.equal(contaDuplicada({ contas, secretariaId: 3, bancoId: 7, numeroConta: "20427" }), null);
  assert.equal(contaDuplicada({ contas, secretariaId: 3, bancoId: 1, numeroConta: "30001" }), null);

  // Na edição, a própria conta não conflita consigo mesma.
  assert.equal(
    contaDuplicada({ contas, secretariaId: 3, bancoId: 1, numeroConta: "2042-7", ignorarId: 1 }),
    null,
  );
});

test("conflito com conta desativada orienta a reativar em vez de duplicar", () => {
  const contas = [{ id: 5, secretaria_id: 3, banco_id: 1, numero_conta: "2.042-7", ativo: false }];
  const conflito = contaDuplicada({ contas, secretariaId: 3, bancoId: 1, numeroConta: "20427" });
  assert.equal(conflito?.id, 5);
  assert.match(mensagemDuplicidade(conflito), /desativada/i);
  assert.match(mensagemDuplicidade(conflito), /Reative/i);
});

// ---------------------------------------------------------------------------
// Edição: só cadastro, e a trilha com valor anterior e novo
// ---------------------------------------------------------------------------

test("edição registra na auditoria apenas os campos que mudaram, com antes e depois", () => {
  const antes = {
    secretaria: "Secretaria de Finanças",
    banco: "Banco do Brasil",
    numero_conta: "2.042-7",
    nome_conta: "PREFEITURA",
    tipo_conta: "corrente",
    fonte_recurso: null,
  };
  const depois = { ...antes, nome_conta: "FPM", numero_conta: "3.115-0" };

  const { alterados, houveMudanca, resumo } = alteracoesDoCadastro(antes, depois);
  assert.equal(houveMudanca, true);
  assert.deepEqual(Object.keys(alterados).sort(), ["nome_conta", "numero_conta"]);
  assert.match(resumo, /Nome da conta/);

  const { anterior, novo } = retratoDasAlteracoes(alterados);
  assert.deepEqual(anterior, { numero_conta: "2.042-7", nome_conta: "PREFEITURA" });
  assert.deepEqual(novo, { numero_conta: "3.115-0", nome_conta: "FPM" });
  // Nenhum campo de saldo entra na comparação: editar cadastro não mexe em saldo.
  assert.equal("saldo" in novo, false);
  assert.equal("data_saldo" in novo, false);
});

test("salvar sem alterar nada não gera evento de auditoria", () => {
  const cadastro = { secretaria: "A", banco: "B", numero_conta: "1", nome_conta: "C", tipo_conta: "corrente", fonte_recurso: null };
  assert.equal(alteracoesDoCadastro(cadastro, { ...cadastro }).houveMudanca, false);
});

test("retrato do cadastro usa as chaves que o dicionário da auditoria traduz", () => {
  const retrato = retratoDoCadastro({
    secretaria: "Secretaria de Finanças",
    banco: "Banco do Brasil",
    numero_conta: "2.042-7",
    nome_conta: "FPM",
    tipo_conta: "poupanca",
    fonte_recurso: "FPM",
  });
  assert.deepEqual(Object.keys(retrato).sort(), [
    "banco", "fonte_recurso", "nome_conta", "numero_conta", "secretaria", "tipo_conta",
  ]);
  assert.equal(retrato.tipo_conta, "Poupança");
});

test("tipo de conta antigo, digitado à mão, continua sendo exibido como está", () => {
  assert.equal(tipoContaLabel("corrente"), "Conta corrente");
  assert.equal(tipoContaLabel("custeio"), "custeio");
  assert.equal(tipoContaLabel(""), "--");
});

// ---------------------------------------------------------------------------
// Limpar campos / campos em branco por padrão
// ---------------------------------------------------------------------------

test("campo em branco não vira lançamento; zero vira", () => {
  assert.equal(campoPreenchido(""), false);
  assert.equal(campoPreenchido("   "), false);
  assert.equal(campoPreenchido(null), false);
  assert.equal(campoPreenchido(undefined), false);
  assert.equal(campoPreenchido(0), true);
  assert.equal(campoPreenchido("1.000,00"), true);
});

test("limpar os campos e salvar não grava linha nenhuma", () => {
  const contas = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const limpos = { 1: "", 2: "", 3: "" };
  assert.deepEqual(linhasParaLancamento({ contas, valores: limpos, data: "2026-08-28" }), []);
});

test("só as contas digitadas entram no lançamento do dia", () => {
  const contas = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const valores = { 1: 1500.5, 2: "", 3: 0 };
  assert.deepEqual(linhasParaLancamento({ contas, valores, data: "2026-08-28" }), [
    { conta_id: 1, valor_saldo: 1500.5, data_saldo: "2026-08-28" },
    { conta_id: 3, valor_saldo: 0, data_saldo: "2026-08-28" },
  ]);
});

// ---------------------------------------------------------------------------
// Tela e migration
// ---------------------------------------------------------------------------

test("Saldos das Contas usa a rotina única de lançamento, sem gravação paralela", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  assert.match(pagina, /linhasParaLancamento/);
  assert.match(pagina, /await lancarSaldos\(linhas\)/);
  assert.match(pagina, /lancarSaldoDaConta/);
  // Nenhum insert/upsert de saldo escrito à mão na tela.
  assert.doesNotMatch(pagina, /from\("saldos_historico"\)\s*\.\s*(insert|upsert|delete|update)/);
  assert.doesNotMatch(pagina, /saldos_historico"\)\.upsert/);
});

test("limpar campos é só visual: nenhum delete, update ou insert", async () => {
  const [pagina, modal] = await Promise.all([
    read("src/pages/Saldos.jsx"),
    read("src/components/saldos/ModalLimparCampos.jsx"),
  ]);
  const limpar = pagina.slice(pagina.indexOf("function limparCamposLote"), pagina.indexOf("function camposPreenchidosNoLote"));
  assert.match(limpar, /setSaldosLote/);
  assert.doesNotMatch(limpar, /supabase|delete|insert|upsert|update/);
  assert.match(pagina, /Limpar campos/);
  assert.match(modal, /Nada é apagado do banco/);
});

test("lançamento do dia abre em branco e mostra o último saldo como referência", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  assert.match(pagina, /dataDoSaldo === data \? \(c\.saldo \?\? ""\) : ""/);
  assert.match(pagina, /Último: \$\{formatBRL\(c\.saldo\)\}/);
  assert.match(pagina, /Sem lançamento anterior/);
  // O lápis de lançamento avulso também começa vazio.
  assert.match(pagina, /setNovoSaldo\(\{ valor: "", data: hojeISO\(\) \}\)/);
});

test("conta bancária não tem exclusão definitiva: só desativar e reativar", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  assert.match(pagina, /abrirSituacaoConta\(c\.id, "desativar"\)/);
  assert.match(pagina, /abrirSituacaoConta\(conta\.id, "reativar"\)/);
  assert.match(pagina, /desativou_conta/);
  assert.match(pagina, /reativou_conta/);
  assert.match(pagina, /historico_saldos: "Preservado integralmente"/);
  // Nenhum delete de conta em lugar nenhum da tela.
  assert.doesNotMatch(pagina, /from\("contas_bancarias"\)[\s\S]{0,40}\.delete\(/);
});

test("desativar avisa quando a conta está em programação em elaboração", async () => {
  const [pagina, modal] = await Promise.all([
    read("src/pages/Saldos.jsx"),
    read("src/components/saldos/ModalSituacaoConta.jsx"),
  ]);
  assert.match(pagina, /programacoesEmElaboracaoComConta/);
  assert.match(modal, /programaç(ão|ões) em elaboração/i);
  assert.match(modal, /Motivo da desativação/);
});

test("cadastro de conta respeita a matriz de permissões do módulo Saldos", async () => {
  const [pagina, permissoes] = await Promise.all([
    read("src/pages/Saldos.jsx"),
    read("src/lib/permissoesUsuario.js"),
  ]);
  assert.match(pagina, /permissaoSaldos\?\.pode_cadastrar === true/);
  assert.match(pagina, /permissaoSaldos\?\.pode_editar === true/);
  assert.match(pagina, /permissaoSaldos\?\.pode_excluir === true/);
  assert.match(permissoes, /Cadastrar conta bancária/);
  assert.match(permissoes, /Editar conta bancária/);
  assert.match(permissoes, /Desativar \/ reativar conta bancária/);
});

test("auditoria conhece as ações e os campos do cadastro de contas", async () => {
  const auditoria = await read("src/lib/auditoria.js");
  assert.match(auditoria, /desativou_conta: "Desativou conta bancária"/);
  assert.match(auditoria, /reativou_conta: "Reativou conta bancária"/);
  assert.match(auditoria, /tipo_conta: "Tipo de conta"/);
  assert.match(auditoria, /fonte_recurso: "Fonte de recurso"/);
  assert.match(auditoria, /motivo_desativacao: "Motivo da desativação"/);
});

test("conta desativada sai do uso corrente e continua consultável no histórico", async () => {
  const [programacao, historico, saldos] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/pages/Historico.jsx"),
    read("src/pages/Saldos.jsx"),
  ]);
  // Programação Diária segue lendo apenas contas ativas (nada mudou lá).
  assert.match(programacao, /from\("contas_bancarias"\)[\s\S]{0,220}\.eq\("ativo", true\)/);
  // Consulta por data não filtra por ativo: o passado da conta continua à vista.
  const consultaHistorico = historico.slice(historico.indexOf("async function carregarSaldosNaData"));
  assert.doesNotMatch(consultaHistorico.slice(0, 1200), /\.eq\("ativo", true\)[\s\S]{0,40}contas_bancarias/);
  assert.match(historico, /conta desativada\s*\n?\s*\/\/ continua tendo histórico|conta desativada/i);
  assert.match(saldos, /ContasDesativadas/);
});

test("trava de não regressão: ordem das colunas, saldo em negrito, arraste, impressão, PDF e Excel", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  const cabecalho = pagina.indexOf(">Banco<");
  assert.ok(cabecalho > 0);
  assert.ok(pagina.indexOf(">Número da Conta<") > cabecalho);
  assert.ok(pagina.indexOf(">Saldo<") > pagina.indexOf(">Número da Conta<"));
  assert.ok(pagina.indexOf(">Nome da Conta<") > pagina.indexOf(">Saldo<"));
  assert.match(pagina, /tabular-nums font-bold/);
  assert.match(pagina, /header: \["Secretaria", "Banco", "Número da Conta", "Saldo", "Nome da Conta"\]/);
  assert.match(pagina, /imprimirSaldos/);
  assert.match(pagina, /gerarPdfSaldos/);
  assert.match(pagina, /propsAlca|onDragStart/);
  assert.match(pagina, /preferencias_ordem_secretarias|TABELA_ORDEM/);
});

test("migration do cadastro é idempotente, transacional e não apaga dados", async () => {
  const sql = await read(migration);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /add column if not exists fonte_recurso_id/);
  assert.match(sql, /add column if not exists ativo/);
  assert.match(sql, /create table if not exists public\.fontes_recurso/);
  assert.match(sql, /create unique index if not exists contas_bancarias_conta_unica_idx/);
  assert.match(sql, /format_type/); // validação de tipos no início
  assert.doesNotMatch(sql, /\bdrop table\b|\bdelete from\b|\btruncate\b/i);
  // Uma variável %rowtype nunca aparece junto de outra na mesma lista INTO.
  assert.doesNotMatch(sql, /into\s+\w+\s*,\s*\w+/i);
});
