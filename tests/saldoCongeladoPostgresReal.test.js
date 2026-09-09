import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * O SALDO CONGELADO da programação em POSTGRES DE VERDADE.
 *
 * A correção do saldo congelado é de leitura e exibição: a tela passou a mostrar
 * o `saldo_considerado` que já estava gravado, em vez de buscar o saldo atual.
 * Esta suíte prova, no banco, as duas metades da afirmação:
 *
 *   O SALDO CONSIDERADO É GRAVADO CORRETAMENTE -- uma linha por conta, com o
 *     valor enviado, e o total no cabeçalho da programação.
 *   SALVAR DE NOVO NÃO REESCREVE O DOCUMENTO -- reenviando o saldo congelado, a
 *     programação de data anterior continua com os valores da época.
 *   SALVAR NÃO TOCA SALDO -- saldos_historico e o saldo real das contas ficam
 *     exatamente como estavam. Marcar conta não debita e não reserva.
 *
 * A migration `20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql`
 * roda verbatim num Postgres em memória (PGlite) e
 * `salvar_planejamento_programacao` é chamada de fato. A estrutura montada aqui
 * é a mínima para a migration se aplicar; os ajudantes que ela não cria são
 * substituídos por versões simples.
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado os
 * testes são PULADOS e a suíte continua passando.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const MIGRATION = join(RAIZ, "supabase/migrations/20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql");

const ESTRUTURA = `
create role anon;
create role authenticated;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $x$
  select nullif(current_setting('ensaio.auth_uid', true), '')::uuid
$x$;

create table public.secretarias (id integer primary key, nome text);

create table public.usuarios (id uuid primary key, nome text);

create table public.fornecedores (
  id integer primary key,
  razao_social text,
  nome_fantasia text,
  cpf_cnpj text,
  secretaria_id integer references public.secretarias (id),
  ativo boolean not null default true,
  excluido_em timestamptz
);

create table public.contas_bancarias (
  id integer primary key,
  nome_conta text,
  numero_conta text,
  secretaria_id integer references public.secretarias (id),
  ativo boolean not null default true
);

-- O saldo das contas vive aqui, em lançamentos. Nenhuma linha desta tabela é
-- escrita ao salvar a programação -- é o que o teste confere.
create table public.saldos_historico (
  id serial primary key,
  conta_id integer references public.contas_bancarias (id),
  data_saldo date not null,
  valor_saldo numeric(14,2) not null
);

create table public.programacoes_pagamento (
  id integer primary key,
  secretaria_id integer references public.secretarias (id),
  data_programacao date,
  status text,
  fechado boolean not null default false,
  saldo_considerado numeric(14,2) not null default 0,
  total_programado numeric(14,2) not null default 0,
  restante numeric(14,2) not null default 0,
  responsavel_id uuid,
  updated_at timestamptz,
  atualizado_em timestamptz,
  excluido_em timestamptz
);

create table public.pagamentos (
  id serial primary key,
  programacao_id integer references public.programacoes_pagamento (id),
  fornecedor_id integer references public.fornecedores (id),
  valor_a_pagar numeric(14,2),
  nome_avulso text,
  cadastrar_fornecedor_posteriormente boolean not null default false,
  situacao text,
  excluido_em timestamptz,
  excluido_por uuid references public.usuarios (id),
  atualizado_em timestamptz
);

-- saldo_considerado é o SALDO CONGELADO de cada conta da programação: o valor
-- que estava na mesa quando ela foi montada. not null default 0 é o motivo de
-- a tela precisar distinguir "zero gravado" de "nada gravado".
create table public.programacao_contas (
  id serial primary key,
  programacao_id integer references public.programacoes_pagamento (id),
  conta_id integer references public.contas_bancarias (id),
  saldo_considerado numeric(14,2) not null default 0,
  ordem integer,
  ativa boolean not null default true,
  valor_rateado numeric(14,2) not null default 0
);

create table public.auditoria_eventos (
  id serial primary key,
  usuario_id uuid,
  modulo text,
  acao text,
  registro_afetado text,
  valor_anterior jsonb,
  valor_novo jsonb,
  resultado text,
  nivel text,
  criado_em timestamptz not null default now()
);

-- Ajudantes que a migration usa e não cria.
create or replace function public.usuario_auditoria_id() returns uuid language sql as $x$ select auth.uid() $x$;
create or replace function public.usuario_registro_id() returns uuid language sql as $x$
  select id from public.usuarios limit 1
$x$;
create or replace function public.fornecedor_referenciavel(p_id integer) returns text language sql as $x$
  select case when exists (select 1 from public.fornecedores f where f.id = p_id) then 'ativo' else 'ausente' end
$x$;
create or replace function public.pode_em_certidoes(p_acao text) returns boolean language sql as $x$ select true $x$;
create or replace function public.tipo_da_coluna(p_tabela text, p_coluna text) returns text language sql as $x$
  select coalesce(
    (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = to_regclass(format('public.%I', p_tabela))
        and a.attname = p_coluna and not a.attisdropped),
    'coluna ausente')
$x$;

create view public.fornecedores_identificacao as
  select f.id, f.razao_social, f.nome_fantasia, f.cpf_cnpj, f.secretaria_id, f.ativo
    from public.fornecedores f;
`;

const OPERADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// A programação de 02/09 e a de hoje, com as mesmas duas contas. Em 02/09 as
// contas tinham 180.000,00 e 42.350,75; hoje têm outro dinheiro.
const DADOS = `
insert into public.secretarias values (1, 'Educação');
insert into public.usuarios values ('${OPERADOR}', 'Operador do ensaio');
insert into public.fornecedores (id, razao_social, cpf_cnpj, secretaria_id)
  values (7, 'José da Silva Comércio de Alimentos Ltda.', '12345678000199', 1);
insert into public.contas_bancarias (id, nome_conta, numero_conta, secretaria_id)
  values (11, 'FUNDEB', '2.042-7', 1), (12, 'MERENDA', '1.001-9', 1), (13, 'TRANSPORTE', '3.300-1', 1);

insert into public.saldos_historico (conta_id, data_saldo, valor_saldo) values
  (11, '2026-09-02', 180000.00), (12, '2026-09-02', 42350.75),
  (11, '2026-09-09', 5000.00),   (12, '2026-09-09', 990000.00), (13, '2026-09-09', 77000.00);

-- A programação de 02/09, montada naquele dia com os saldos daquele dia.
insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status, saldo_considerado)
  values (41, 1, '2026-09-02', 'em_elaboracao', 222350.75);
insert into public.programacao_contas (programacao_id, conta_id, saldo_considerado, ordem)
  values (41, 11, 180000.00, 1), (41, 12, 42350.75, 2);

-- A programação de hoje, ainda sem contas.
insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status)
  values (90, 1, '2026-09-09', 'em_elaboracao');
`;

async function abrirBanco() {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  await db.exec(DADOS);
  await db.exec(readFileSync(MIGRATION, "utf8"));
  await db.exec(`set ensaio.auth_uid = '${OPERADOR}'`);
  return db;
}

const pular = (t) => t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

/** Como a tela chama a RPC ao salvar. */
const salvar = (db, { programacaoId, contas, pagamentos = [], saldo, total = 0, restante = 0 }) =>
  db.query(
    `select public.salvar_planejamento_programacao($1, $2::jsonb, $3::jsonb, $4, $5, $6) as r`,
    [programacaoId, JSON.stringify(contas), JSON.stringify(pagamentos), saldo, total, restante],
  );

const contasGravadas = (db, programacaoId) =>
  db.query(
    `select conta_id, saldo_considerado, ordem, ativa from public.programacao_contas
      where programacao_id = $1 order by ordem`,
    [programacaoId],
  );

test("a programação do dia grava o saldo atual de cada conta e o total no cabeçalho", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  // Montada hoje: a tela envia o saldo atual das contas marcadas.
  const resposta = await salvar(db, {
    programacaoId: 90,
    contas: [
      { conta_id: 11, saldo_considerado: 5000.0, ordem: 1 },
      { conta_id: 12, saldo_considerado: 990000.0, ordem: 2 },
    ],
    pagamentos: [{ fornecedor_id: 7, valor_a_pagar: 100000 }],
    saldo: 995000.0,
    total: 100000,
    restante: 895000.0,
  });
  assert.equal(resposta.rows[0].r.ok, true);

  const contas = await contasGravadas(db, 90);
  assert.deepEqual(contas.rows, [
    { conta_id: 11, saldo_considerado: "5000.00", ordem: 1, ativa: true },
    { conta_id: 12, saldo_considerado: "990000.00", ordem: 2, ativa: true },
  ]);

  // O cabeçalho guarda o total considerado, que é a soma das contas gravadas.
  const cabecalho = await db.query(`select saldo_considerado, total_programado, restante from public.programacoes_pagamento where id = 90`);
  assert.deepEqual(cabecalho.rows[0], { saldo_considerado: "995000.00", total_programado: "100000.00", restante: "895000.00" });
  const soma = await db.query(`select sum(saldo_considerado) as s from public.programacao_contas where programacao_id = 90 and ativa`);
  assert.equal(soma.rows[0].s, "995000.00");
  await db.close();
});

test("salvar uma programação de data anterior mantém o saldo daquele dia", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  // É o que a tela envia em modo congelado: o valor JÁ GRAVADO de cada conta,
  // e no cabeçalho a soma desses mesmos valores. Nada de saldo de hoje.
  const resposta = await salvar(db, {
    programacaoId: 41,
    contas: [
      { conta_id: 11, saldo_considerado: 180000.0, ordem: 1 },
      { conta_id: 12, saldo_considerado: 42350.75, ordem: 2 },
    ],
    pagamentos: [{ fornecedor_id: 7, valor_a_pagar: 30000 }],
    saldo: 222350.75,
    total: 30000,
    restante: 192350.75,
  });
  assert.equal(resposta.rows[0].r.ok, true);

  const contas = await contasGravadas(db, 41);
  assert.deepEqual(contas.rows, [
    { conta_id: 11, saldo_considerado: "180000.00", ordem: 1, ativa: true },
    { conta_id: 12, saldo_considerado: "42350.75", ordem: 2, ativa: true },
  ]);
  const cabecalho = await db.query(`select saldo_considerado from public.programacoes_pagamento where id = 41`);
  assert.equal(cabecalho.rows[0].saldo_considerado, "222350.75");
  // O saldo de hoje não entrou em lugar nenhum do documento.
  const hoje = await db.query(`select count(*) as n from public.programacao_contas
    where programacao_id = 41 and saldo_considerado in (5000.00, 990000.00, 995000.00)`);
  assert.equal(Number(hoje.rows[0].n), 0);
  await db.close();
});

test("conta acrescentada a uma programação antiga entra sem alterar as que já estavam", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await salvar(db, {
    programacaoId: 41,
    contas: [
      { conta_id: 11, saldo_considerado: 180000.0, ordem: 1 },
      { conta_id: 12, saldo_considerado: 42350.75, ordem: 2 },
      { conta_id: 13, saldo_considerado: 77000.0, ordem: 3 },
    ],
    saldo: 299350.75,
    total: 0,
    restante: 299350.75,
  });

  const contas = await contasGravadas(db, 41);
  assert.deepEqual(contas.rows, [
    { conta_id: 11, saldo_considerado: "180000.00", ordem: 1, ativa: true },
    { conta_id: 12, saldo_considerado: "42350.75", ordem: 2, ativa: true },
    { conta_id: 13, saldo_considerado: "77000.00", ordem: 3, ativa: true },
  ]);

  // Desmarcar uma conta desativa o vínculo e PRESERVA o saldo congelado dela:
  // o documento não perde o valor que foi considerado naquele dia.
  await salvar(db, {
    programacaoId: 41,
    contas: [{ conta_id: 11, saldo_considerado: 180000.0, ordem: 1 }],
    saldo: 180000.0,
    total: 0,
    restante: 180000.0,
  });
  const depois = await db.query(`select conta_id, saldo_considerado, ativa from public.programacao_contas
    where programacao_id = 41 order by conta_id`);
  assert.deepEqual(depois.rows, [
    { conta_id: 11, saldo_considerado: "180000.00", ativa: true },
    { conta_id: 12, saldo_considerado: "42350.75", ativa: false },
    { conta_id: 13, saldo_considerado: "77000.00", ativa: false },
  ]);
  await db.close();
});

test("salvar a programação não escreve saldo: saldos_historico fica intacto", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  const antes = await db.query(`select conta_id, data_saldo, valor_saldo from public.saldos_historico order by id`);

  await salvar(db, {
    programacaoId: 41,
    contas: [
      { conta_id: 11, saldo_considerado: 180000.0, ordem: 1 },
      { conta_id: 12, saldo_considerado: 42350.75, ordem: 2 },
    ],
    pagamentos: [{ fornecedor_id: 7, valor_a_pagar: 30000 }],
    saldo: 222350.75,
    total: 30000,
    restante: 192350.75,
  });

  const depois = await db.query(`select conta_id, data_saldo, valor_saldo from public.saldos_historico order by id`);
  assert.deepEqual(depois.rows, antes.rows);
  // Nenhum lançamento novo, nenhum valor alterado: programar não debita nada.
  assert.equal(depois.rows.length, 5);

  // O item de pagamento foi gravado como PROPOSTA -- programado, não pago.
  const item = await db.query(`select fornecedor_id, valor_a_pagar, situacao from public.pagamentos where programacao_id = 41`);
  assert.deepEqual(item.rows, [{ fornecedor_id: 7, valor_a_pagar: "30000.00", situacao: "programado" }]);
  await db.close();
});

test("programação fechada não é alterada e o saldo congelado dela não muda", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.exec(`update public.programacoes_pagamento set fechado = true where id = 41`);
  await assert.rejects(
    () => salvar(db, {
      programacaoId: 41,
      contas: [{ conta_id: 11, saldo_considerado: 5000.0, ordem: 1 }],
      saldo: 5000.0,
    }),
    /Programações históricas fechadas não podem ser alteradas/,
  );

  const contas = await contasGravadas(db, 41);
  assert.deepEqual(contas.rows, [
    { conta_id: 11, saldo_considerado: "180000.00", ordem: 1, ativa: true },
    { conta_id: 12, saldo_considerado: "42350.75", ordem: 2, ativa: true },
  ]);
  const cabecalho = await db.query(`select saldo_considerado from public.programacoes_pagamento where id = 41`);
  assert.equal(cabecalho.rows[0].saldo_considerado, "222350.75");
  await db.close();
});

test("a programação antiga sem saldo gravado continua com zero no banco -- quem trata é a tela", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  // Programação anterior à coluna: `not null default 0` deixou zero em todas as
  // contas e no cabeçalho. O banco não é corrigido (seria inventar valor); a
  // tela reconhece esse caso e mostra "--".
  await db.exec(`
    insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status)
      values (7, 1, '2026-08-10', 'em_elaboracao');
    insert into public.programacao_contas (programacao_id, conta_id, ordem)
      values (7, 11, 1), (7, 12, 2);
  `);

  const linhas = await db.query(`select conta_id, saldo_considerado from public.programacao_contas where programacao_id = 7 order by ordem`);
  const cabecalho = await db.query(`select saldo_considerado from public.programacoes_pagamento where id = 7`);
  assert.deepEqual(linhas.rows, [
    { conta_id: 11, saldo_considerado: "0.00" },
    { conta_id: 12, saldo_considerado: "0.00" },
  ]);
  assert.equal(cabecalho.rows[0].saldo_considerado, "0.00");

  const { semRegistroDeSaldoCongelado } = await import("../src/lib/saldoCongeladoProgramacao.js");
  assert.equal(
    semRegistroDeSaldoCongelado({
      linhas: linhas.rows,
      saldoCabecalho: cabecalho.rows[0].saldo_considerado,
    }),
    true,
  );
  await db.close();
});
