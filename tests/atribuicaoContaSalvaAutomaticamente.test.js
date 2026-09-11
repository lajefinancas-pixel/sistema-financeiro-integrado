// A CONTA DE CADA PAGAMENTO É SALVA ASSIM QUE DEFINIDA -- e a tela diz isso.
//
// O relato: na seção "Execução da programação" a usuária definia a conta de
// cada pagamento e ficava procurando um botão de salvar. Não achava, e não tinha
// como saber se o trabalho havia sido gravado ou perdido. A gravação sempre
// aconteceu no ato; o que faltava era a tela afirmar isso.
//
// O que fica travado aqui:
//
//   A LINHA NO CABEÇALHO da seção diz que a conta é salva assim que definida
//   NENHUM BOTÃO DE SALVAR foi criado nesta seção (criá-lo reabriria a dúvida)
//   A RESPOSTA DE CADA AÇÃO afirma que já está gravado, não só o que aconteceu
//   RECARREGAR A PÁGINA MANTÉM TODAS AS CONTAS ATRIBUÍDAS -- em Postgres de
//     verdade, relendo pela mesma consulta que a tela usa ao abrir
//
// As travas financeiras continuam escritas onde estavam:
//
//   ATRIBUIR CONTA NÃO DEBITA CONTA -> conta selecionada ≠ conta debitada.
//   A BAIXA NÃO DEBITA O SALDO DA CONTA. PROGRAMADO ≠ PAGO. APROVADO ≠ PAGO.
//   TRANSFERÊNCIA NÃO É DESPESA.
//
// A metade que só o banco faz valer roda em POSTGRES DE VERDADE (PGlite), com
// a migration vigente da função executada verbatim. Sem `@electric-sql/pglite`
// instalado, essa parte é PULADA e a suíte continua passando.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { resumoExecucao } from "../src/lib/execucaoProgramacao.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const read = (caminho) => readFile(join(RAIZ, caminho), "utf8");

const PAGINA = "src/pages/PagamentosRedesenhado.jsx";
const PAINEL = "src/components/pagamentos/PainelExecucaoProgramacao.jsx";

// A definição vigente da função que grava a conta do pagamento.
const MIGRATION = "supabase/migrations/20260911120000_blindar_tipos_legados_pagamentos.sql";
const MIGRATION_AJUDANTES = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";
const MIGRATION_APROVACAO = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const MIGRATION_FASE_2 = "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql";
const MIGRATION_SALVAR = "supabase/migrations/20260910150000_origem_do_item_na_programacao_diaria.sql";
const MIGRATION_FORNECEDORES = "supabase/migrations/20260828190000_corrigir_gravacao_fornecedores_programacao.sql";

/** Só o corpo de uma função, recortado de uma migration. */
function funcaoDaMigration(caminho, nome) {
  const sql = readFileSync(join(RAIZ, caminho), "utf8");
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio >= 0, `função não encontrada: ${nome}`);
  const fim = sql.indexOf(`grant execute on function public.${nome}`, inicio);
  assert.ok(fim > inicio, `grant não encontrado depois de ${nome}`);
  return sql.slice(inicio, fim);
}

/** O trecho da seção "Execução da programação" dentro do painel. */
function secaoDeExecucao(painel) {
  const inicio = painel.indexOf('titulo="Execução da programação"');
  const fim = painel.indexOf('titulo="Transferir entre contas"');
  assert.ok(inicio > 0 && fim > inicio, "a seção de execução não foi localizada no painel");
  return painel.slice(inicio, fim);
}

/** O corpo de gravarContaDosPagamentos, onde a resposta é montada. */
function blocoDaGravacao(pagina) {
  const inicio = pagina.indexOf("async function gravarContaDosPagamentos");
  const fim = pagina.indexOf("async function garantirContasDeTransferencia");
  assert.ok(inicio > 0 && fim > inicio, "gravarContaDosPagamentos não foi localizada na página");
  return pagina.slice(inicio, fim);
}

// ---------------------------------------------------------------------------
// 1. A tela afirma a gravação automática
// ---------------------------------------------------------------------------

test("o cabeçalho da seção diz que a conta é salva assim que definida", async () => {
  const painel = await read(PAINEL);

  // A frase pedida, no cabeçalho da seção de execução.
  assert.match(painel, /nota="A conta de cada pagamento é salva assim que definida\./);
  assert.match(secaoDeExecucao(painel), /nota="A conta de cada pagamento é salva assim que definida\./);

  // A nota é desenhada DENTRO do cabeçalho, então aparece com a seção aberta ou
  // recolhida -- é justamente quem ainda não abriu que procura o botão.
  const cabecalho = painel.slice(painel.indexOf("function CabecalhoRecolhivel"));
  assert.match(cabecalho, /nota = ""/, "a nota precisa ser opcional: seção sem nota fica como era");
  assert.match(cabecalho, /\{nota && \(/);
  assert.match(cabecalho, /\{nota\}/);

  // A descrição de antes continua lá: a nota acrescenta, não substitui.
  assert.match(painel, /descricao="Defina a conta de cada pagamento\. Definir a conta não debita nada — o débito acontece na baixa\."/);
});

test("nenhum botão de salvar foi criado na seção de execução", async () => {
  const secao = secaoDeExecucao(await read(PAINEL));
  // A gravação é automática: um botão de salvar aqui faria parecer que o que
  // não passou por ele se perdeu.
  assert.doesNotMatch(secao, />\s*Salvar/);
  assert.doesNotMatch(secao, /onSalvar|salvarAtribuicao|salvarContas/);
  // Os três caminhos de gravação continuam sendo os mesmos de antes.
  assert.match(secao, /Atribuir conta aos selecionados/);
  assert.match(secao, /Aplicar conta a todos/);
  assert.match(secao, /onDefinirConta\?\.\(pagamento, e\.target\.value \? Number\(e\.target\.value\) : null\)/);
});

test("a resposta de cada ação diz que já está gravado, e não só o que aconteceu", async () => {
  const bloco = blocoDaGravacao(await read(PAGINA));

  // Retirar a conta, um pagamento e vários: as três respostas afirmam a
  // gravação em palavras.
  assert.match(bloco, /A retirada já está gravada no banco: não é preciso salvar\./);
  assert.match(bloco, /Conta do pagamento definida e já gravada no banco: não é preciso salvar\./);
  assert.match(bloco, /Conta definida em \$\{alvos\.length\} pagamentos e já gravada no banco: não é preciso salvar\./);

  // A afirmação não é palpite: a conta é RELIDA do banco antes de a mensagem
  // aparecer, e é a leitura que alimenta a lista da tela.
  const releitura = bloco.indexOf("await contasDefinidasDosPagamentos(idProgramacao)");
  assert.ok(releitura > 0, "a releitura no banco continua sendo o que confirma a gravação");
  assert.ok(releitura < bloco.indexOf("const feito ="), "a mensagem só pode vir depois da releitura");

  // E as travas financeiras continuam nas mesmas respostas.
  assert.match(bloco, /Nenhum saldo foi movimentado\./);
  assert.match(bloco, /Definir conta não debita conta\./);
  // Nada de saldo, baixa ou transferência entra neste caminho.
  assert.doesNotMatch(bloco, /saldos_historico|registrarSaldo|confirmarTransferencias|dar_baixa|baixa/i);
});

// ---------------------------------------------------------------------------
// 2. POSTGRES DE VERDADE: recarregar a página mantém todas as contas
// ---------------------------------------------------------------------------

const OPERADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// A estrutura legada da produção, com situacao em ENUM.
const ESTRUTURA = `
create role anon;
create role authenticated;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $x$
  select nullif(current_setting('ensaio.auth_uid', true), '')::uuid
$x$;

create type situacao_pagamento as enum ('programado', 'em_aberto', 'pago', 'cancelado');

create table public.secretarias (id integer primary key, nome text);

create table public.usuarios (
  id uuid primary key,
  auth_id uuid,
  nome_completo text,
  status text not null default 'ativo'
);

create table public.permissoes_efetivas (
  usuario_id uuid,
  modulo text,
  pode_visualizar boolean not null default true,
  pode_cadastrar boolean not null default false,
  pode_editar boolean not null default false,
  pode_aprovar boolean not null default false,
  pode_excluir boolean not null default false
);

create table public.permissoes_especiais (usuario_id uuid, acao text, permitido boolean);

create table public.fornecedores (id integer primary key, razao_social text, apelido text, secretaria_id integer, ativo boolean not null default true);

create table public.contas_bancarias (
  id integer primary key,
  nome_conta text,
  numero_conta text,
  secretaria_id integer,
  ativo boolean not null default true
);

-- O saldo REAL das contas. Nenhuma linha aqui pode mudar por definir conta.
create table public.saldos_historico (
  id serial primary key,
  conta_id integer,
  data_saldo date not null,
  valor_saldo numeric(14,2) not null
);

create table public.programacoes_pagamento (
  id integer primary key,
  secretaria_id integer,
  data_programacao date,
  status text,
  fechado boolean not null default false,
  saldo_considerado numeric(14,2) not null default 0,
  total_programado numeric(14,2) not null default 0,
  restante numeric(14,2) not null default 0,
  conta_pagamento_id integer,
  responsavel_id uuid,
  aprovada_em timestamptz,
  aprovada_por uuid,
  updated_at timestamptz
);

create table public.pagamentos (
  id serial primary key,
  programacao_id integer,
  fornecedor_id integer,
  valor_a_pagar numeric(14,2),
  nome_avulso text,
  nome_exibicao_programacao text,
  cadastrar_fornecedor_posteriormente boolean not null default false,
  situacao situacao_pagamento,
  conta_origem_id integer,
  origem_tipo text,
  origem_id uuid,
  excluido_em timestamptz,
  excluido_por uuid
);

create table public.programacao_contas (
  id serial primary key,
  programacao_id integer,
  conta_id integer,
  saldo_considerado numeric(14,2) not null default 0,
  ordem integer,
  ativa boolean not null default true,
  valor_rateado numeric(14,2) not null default 0
);

create table public.auditoria_eventos (
  id serial primary key,
  usuario_id uuid not null,
  modulo text,
  acao text not null,
  registro_afetado text,
  valor_anterior jsonb,
  valor_novo jsonb,
  resultado text not null default 'sucesso',
  nivel text not null default 'informacao'
    constraint auditoria_eventos_nivel_check check (nivel in ('informacao', 'atencao', 'critico')),
  criado_em timestamptz not null default now(),
  data_hora timestamptz not null default now()
);

create or replace function public.usuario_auditoria_id() returns uuid language sql as $x$
  select coalesce((select u.id from public.usuarios u where u.auth_id = auth.uid() limit 1), auth.uid())
$x$;
`;

const DADOS = `
insert into public.secretarias values (1, 'Educação');
insert into public.usuarios (id, auth_id, nome_completo, status) values
  ('${OPERADOR}', '${OPERADOR}', 'Chefe do setor', 'ativo');
insert into public.permissoes_efetivas (usuario_id, modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_aprovar, pode_excluir) values
  ('${OPERADOR}', 'pagamentos', true, true, true, true, false);
insert into public.fornecedores (id, razao_social, secretaria_id) values
  (7, 'José da Silva Comércio de Alimentos Ltda.', 1),
  (8, 'Padaria Central Ltda.', 1),
  (9, 'Distribuidora Norte Ltda.', 1),
  (10, 'Transportes Vale Verde Ltda.', 1);
insert into public.contas_bancarias (id, nome_conta, numero_conta, secretaria_id) values
  (11, 'FUNDEB', '2.042-7', 1),
  (12, 'MERENDA', '1.001-9', 1);
insert into public.saldos_historico (conta_id, data_saldo, valor_saldo) values
  (11, '2026-09-10', 180000.00), (12, '2026-09-10', 42350.75);
insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status)
  values (50, 1, '2026-09-10', 'em_elaboracao');
`;

const CONTAS = [
  { conta_id: 11, saldo_considerado: 180000.0, ordem: 1 },
  { conta_id: 12, saldo_considerado: 42350.75, ordem: 2 },
];
const ITENS = [
  { fornecedor_id: 7, valor_a_pagar: 1200.5 },
  { fornecedor_id: 8, valor_a_pagar: 800.0 },
  { fornecedor_id: 9, valor_a_pagar: 450.25 },
  { fornecedor_id: 10, valor_a_pagar: 2310.0 },
];

// As contas de trabalho como a tela as tem em mãos (com o saldo congelado).
const CONTAS_DA_TELA = [
  { id: 11, nome_conta: "FUNDEB", secretaria_id: 1, saldo: 180000.0 },
  { id: 12, nome_conta: "MERENDA", secretaria_id: 1, saldo: 42350.75 },
];

async function abrirBanco() {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  for (const ajudante of ["usuario_registro_id", "usuario_para_coluna", "rastro_do_login"]) {
    await db.exec(funcaoDaMigration(MIGRATION_AJUDANTES, ajudante));
  }
  await db.exec(funcaoDaMigration(MIGRATION_FORNECEDORES, "fornecedor_referenciavel"));
  await db.exec(funcaoDaMigration(MIGRATION_FASE_2, "pode_em_pagamentos_fase2"));
  await db.exec(readFileSync(join(RAIZ, MIGRATION_APROVACAO), "utf8"));
  await db.exec(funcaoDaMigration(MIGRATION_SALVAR, "salvar_planejamento_programacao"));
  await db.exec(DADOS);
  // A função da conta como está valendo hoje, verbatim.
  await db.exec(readFileSync(join(RAIZ, MIGRATION), "utf8"));
  await db.exec(`set ensaio.auth_uid = '${OPERADOR}'`);
  return db;
}

const pular = (t) => t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

const salvar = (db, pagamentos = ITENS, id = 50) =>
  db.query("select public.salvar_planejamento_programacao($1, $2::jsonb, $3::jsonb, $4, $5, $6) as r", [
    id,
    JSON.stringify(CONTAS),
    JSON.stringify(pagamentos),
    222350.75,
    pagamentos.reduce((total, item) => total + item.valor_a_pagar, 0),
    0,
  ]);

const aprovar = (db, id = 50) => db.query("select public.aprovar_programacao_pagamento($1, null, null, null) as r", [id]);

const definirConta = (db, ids, conta, id = 50) =>
  db.query("select public.definir_conta_origem_pagamento($1, $2::int[], $3) as r", [id, ids, conta]);

/**
 * RECARREGAR A PÁGINA (F5).
 *
 * A tela não guarda nada entre uma carga e outra: ao abrir a programação ela lê
 * os itens e, pela MESMA consulta de `contasDefinidasDosPagamentos`, a conta
 * gravada de cada um. Esta função reproduz esse par de leituras e devolve a
 * lista de pagamentos exatamente como o painel a recebe.
 */
async function recarregarPagina(db, id = 50) {
  const itens = (
    await db.query(
      "select id, fornecedor_id, valor_a_pagar from public.pagamentos where programacao_id = $1 and excluido_em is null order by id",
      [id],
    )
  ).rows;
  const contas = (
    await db.query(
      "select id, conta_origem_id from public.pagamentos where programacao_id = $1 and excluido_em is null",
      [id],
    )
  ).rows;
  const contaPorPagamento = new Map(contas.map((linha) => [String(linha.id), linha.conta_origem_id ?? null]));
  return itens.map((item) => ({
    ...item,
    valor_a_pagar: Number(item.valor_a_pagar),
    conta_origem_id: contaPorPagamento.get(String(item.id)) ?? null,
  }));
}

/** Tudo que representa dinheiro. Nada disto pode mudar por atribuir conta. */
const retratoDoDinheiro = async (db) => ({
  saldos: (await db.query("select conta_id, data_saldo, valor_saldo from public.saldos_historico order by id")).rows,
  contas: (await db.query("select id, ativo from public.contas_bancarias order by id")).rows,
  congelados: (await db.query("select conta_id, saldo_considerado, valor_rateado from public.programacao_contas order by id")).rows,
  valores: (await db.query("select id, valor_a_pagar, situacao::text as situacao from public.pagamentos order by id")).rows,
  cabecalho: (await db.query("select id, saldo_considerado, total_programado, restante from public.programacoes_pagamento order by id")).rows,
});

async function prepararAprovada(db) {
  await salvar(db);
  await aprovar(db);
  return (await db.query("select id from public.pagamentos where programacao_id = 50 order by id")).rows.map((l) => l.id);
}

test("TESTE OBRIGATÓRIO: atribuir contas, recarregar a página e todas continuam atribuídas", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);

    // Antes de qualquer atribuição a tela mostra quatro pagamentos sem conta.
    const inicial = resumoExecucao(await recarregarPagina(db), CONTAS_DA_TELA);
    assert.equal(inicial.comConta, 0);
    assert.equal(inicial.semConta, 4);

    // O trabalho da usuária, pelos três caminhos da seção e sem botão de salvar:
    // escolha individual, atribuição aos marcados e aplicar a todos (depois
    // corrigido em dois itens).
    await definirConta(db, ids, 11); // aplicar conta a todos
    await definirConta(db, [ids[1], ids[3]], 12); // atribuir aos selecionados
    await definirConta(db, [ids[2]], 12); // escolha individual

    // F5. Nada foi "salvo" por botão nenhum -- e nada se perdeu.
    const depoisDoF5 = await recarregarPagina(db);
    assert.deepEqual(
      depoisDoF5.map((item) => item.conta_origem_id),
      [11, 12, 12, 12],
      "recarregar a página tem de manter a conta de TODOS os pagamentos",
    );

    // O que a seção mostra depois do F5: nenhum pagamento sem conta.
    const resumo = resumoExecucao(depoisDoF5, CONTAS_DA_TELA);
    assert.equal(resumo.comConta, 4);
    assert.equal(resumo.semConta, 0);
    // O resumo por conta continua ordenado pelo total atribuído, como sempre.
    assert.deepEqual(
      resumo.distribuicao.map((item) => [item.nome, item.quantidade, item.total]),
      [
        ["MERENDA", 3, 3560.25],
        ["FUNDEB", 1, 1200.5],
      ],
    );

    // Recarregar de novo não muda mais nada: a leitura é sempre a do banco.
    assert.deepEqual(await recarregarPagina(db), depoisDoF5);
  } finally {
    await db.close();
  }
});

test("retirar a conta também fica gravado, e o F5 mostra a retirada", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    await definirConta(db, ids, 11);
    await definirConta(db, [ids[0]], null);

    const depoisDoF5 = await recarregarPagina(db);
    assert.deepEqual(depoisDoF5.map((item) => item.conta_origem_id), [null, 11, 11, 11]);
    assert.equal(resumoExecucao(depoisDoF5, CONTAS_DA_TELA).semConta, 1);
  } finally {
    await db.close();
  }
});

test("atribuir e recarregar não movimenta saldo nenhum", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    const antes = await retratoDoDinheiro(db);

    await definirConta(db, ids, 11);
    await definirConta(db, [ids[0], ids[1]], 12);
    await recarregarPagina(db);

    // Saldo real, conta bancária, saldo congelado, rateio, valor e situação de
    // cada item e o cabeçalho da programação: idênticos.
    assert.deepEqual(await retratoDoDinheiro(db), antes, "atribuir conta movimentou algo que representa dinheiro");
  } finally {
    await db.close();
  }
});
