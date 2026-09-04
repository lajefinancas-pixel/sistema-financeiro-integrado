import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * O apelido e o nome de exibição em POSTGRES DE VERDADE.
 *
 * Os outros testes deste envio exercitam as regras em JavaScript e travam o
 * texto da migration. Este roda a migration
 * `20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql` verbatim
 * num Postgres em memória (PGlite) e chama
 * `definir_nome_exibicao_programacao` de fato, para provar no banco o que o
 * comando exige:
 *
 *   RENOMEAR NA PROGRAMAÇÃO NÃO ALTERA O CADASTRO
 *   O ITEM CONTINUA VINCULADO AO MESMO FORNECEDOR_ID
 *   CAMPO VAZIO DEVOLVE O ITEM AO NOME DE SEMPRE
 *   PROGRAMAÇÃO FECHADA NÃO PODE SER ALTERADA
 *   A MIGRATION É IDEMPOTENTE
 *
 * A estrutura montada aqui é a MÍNIMA para a migration se aplicar (as mesmas
 * tabelas, colunas e tipos que ela confere antes de alterar qualquer coisa).
 * Os ajudantes que ela usa e não cria são substituídos por versões simples --
 * o que está sob ensaio é a migration nova, não eles.
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado o
 * teste é PULADO e a suíte continua passando.
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

create table public.fornecedores (
  id integer primary key,
  razao_social text,
  nome_fantasia text,
  cpf_cnpj text,
  secretaria_id integer references public.secretarias (id),
  ativo boolean not null default true,
  excluido_em timestamptz
);

create table public.programacoes_pagamento (
  id integer primary key,
  secretaria_id integer references public.secretarias (id),
  status text,
  fechado boolean not null default false,
  saldo_considerado numeric,
  total_programado numeric,
  restante numeric,
  atualizado_em timestamptz,
  excluido_em timestamptz
);

create table public.pagamentos (
  id integer primary key,
  programacao_id integer references public.programacoes_pagamento (id),
  fornecedor_id integer references public.fornecedores (id),
  valor_a_pagar numeric,
  nome_avulso text,
  cadastrar_fornecedor_posteriormente boolean not null default false,
  situacao text,
  excluido_em timestamptz,
  excluido_por integer,
  atualizado_em timestamptz
);

create table public.programacao_contas (
  id serial primary key,
  programacao_id integer references public.programacoes_pagamento (id),
  conta_id integer,
  saldo_considerado numeric,
  ordem integer,
  ativa boolean not null default true
);

create table public.auditoria_eventos (
  id serial primary key,
  usuario_id integer,
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
create or replace function public.usuario_auditoria_id() returns integer language sql as $x$ select 1 $x$;
create or replace function public.usuario_registro_id() returns integer language sql as $x$ select 1 $x$;
create or replace function public.fornecedor_referenciavel(p_id integer) returns boolean language sql as $x$
  select exists (select 1 from public.fornecedores f where f.id = p_id)
$x$;
create or replace function public.pode_em_certidoes(p_acao text) returns boolean language sql as $x$ select true $x$;
create or replace function public.tipo_da_coluna(p_tabela text, p_coluna text) returns text language sql as $x$
  select coalesce(
    (select format_type(a.atttypid, a.atttypmod) from pg_attribute a
      where a.attrelid = to_regclass(format('public.%I', p_tabela))
        and a.attname = p_coluna and not a.attisdropped),
    'coluna ausente')
$x$;

-- A view versionada pela 20260824130000, antes do apelido.
create view public.fornecedores_identificacao as
  select f.id, f.razao_social, f.nome_fantasia, f.cpf_cnpj, f.secretaria_id, f.ativo
    from public.fornecedores f;
`;

const DADOS = `
insert into public.secretarias values (1, 'Educação');
insert into public.fornecedores (id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id)
  values (7, 'José da Silva Comércio de Alimentos Ltda.', 'Silva Alimentos', '12345678000199', 1),
         (8, 'Padaria Central Ltda.', null, '98765432000111', 1);
insert into public.programacoes_pagamento (id, secretaria_id, status, fechado)
  values (10, 1, 'em_elaboracao', false);
insert into public.pagamentos (id, programacao_id, fornecedor_id, valor_a_pagar)
  values (100, 10, 7, 1500.00), (101, 10, 8, 320.50);
`;

const OPERADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

async function abrirBanco({ passadas = 1 } = {}) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  await db.exec(DADOS);
  const migration = readFileSync(MIGRATION, "utf8");
  // Rodar mais de uma vez é o ensaio de idempotência: a migration se declara
  // repetível, e é assim que ela vai ser usada no SQL Editor.
  for (let i = 0; i < passadas; i += 1) await db.exec(migration);
  await db.exec(`set ensaio.auth_uid = '${OPERADOR}'`);
  return db;
}

const pular = (t) => t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

test("a migration aplica duas vezes e cria só as colunas novas", async (t) => {
  const db = await abrirBanco({ passadas: 2 });
  if (!db) return pular(t);

  const colunas = await db.query(`
    select table_name, column_name, data_type
      from information_schema.columns
     where (table_name = 'fornecedores' and column_name = 'apelido')
        or (table_name = 'pagamentos' and column_name = 'nome_exibicao_programacao')
        or (table_name = 'fornecedores_identificacao' and column_name = 'apelido')
     order by table_name`);
  assert.deepEqual(colunas.rows, [
    { table_name: "fornecedores", column_name: "apelido", data_type: "text" },
    { table_name: "fornecedores_identificacao", column_name: "apelido", data_type: "text" },
    { table_name: "pagamentos", column_name: "nome_exibicao_programacao", data_type: "text" },
  ]);

  // Fornecedor antigo continua exatamente como estava, com apelido nulo.
  const antigo = await db.query(`select razao_social, nome_fantasia, cpf_cnpj, apelido from public.fornecedores where id = 8`);
  assert.deepEqual(antigo.rows[0], {
    razao_social: "Padaria Central Ltda.",
    nome_fantasia: null,
    cpf_cnpj: "98765432000111",
    apelido: null,
  });
  await db.close();
});

test("renomear o item da programação não altera o cadastro nem o vínculo", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.exec(`update public.fornecedores set apelido = 'Zé Alimentos' where id = 7`);

  const gravou = await db.query(`select public.definir_nome_exibicao_programacao(100, '  Zé   Alimentos —  Merenda ') as r`);
  const resposta = gravou.rows[0].r;
  assert.equal(resposta.ok, true);
  // Espaços repetidos viraram um só.
  assert.equal(resposta.nome_exibicao_programacao, "Zé Alimentos — Merenda");
  // fornecedor_id volta na resposta: é a prova de que o vínculo não mudou.
  assert.equal(resposta.fornecedor_id, 7);
  assert.equal(resposta.programacao_id, 10);

  const item = await db.query(`
    select p.fornecedor_id, p.nome_exibicao_programacao, p.valor_a_pagar,
           f.razao_social, f.nome_fantasia, f.apelido, f.cpf_cnpj
      from public.pagamentos p
      join public.fornecedores f on f.id = p.fornecedor_id
     where p.id = 100`);
  assert.deepEqual(item.rows[0], {
    fornecedor_id: 7,
    nome_exibicao_programacao: "Zé Alimentos — Merenda",
    valor_a_pagar: "1500.00",
    razao_social: "José da Silva Comércio de Alimentos Ltda.",
    nome_fantasia: "Silva Alimentos",
    apelido: "Zé Alimentos",
    cpf_cnpj: "12345678000199",
  });

  // O outro item da mesma programação não foi tocado.
  const vizinho = await db.query(`select fornecedor_id, nome_exibicao_programacao, valor_a_pagar from public.pagamentos where id = 101`);
  assert.deepEqual(vizinho.rows[0], { fornecedor_id: 8, nome_exibicao_programacao: null, valor_a_pagar: "320.50" });

  // A renomeação ficou na trilha de auditoria, com o fornecedor de origem.
  const evento = await db.query(`select modulo, acao, valor_anterior, valor_novo from public.auditoria_eventos order by id desc limit 1`);
  assert.equal(evento.rows[0].modulo, "pagamentos");
  assert.equal(evento.rows[0].valor_novo.fornecedor_id, 7);
  assert.equal(evento.rows[0].valor_anterior.nome_exibicao_programacao, null);

  // Campo apagado devolve o item ao nome de sempre.
  const limpou = await db.query(`select public.definir_nome_exibicao_programacao(100, '   ') as r`);
  assert.equal(limpou.rows[0].r.nome_exibicao_programacao, null);
  assert.equal(limpou.rows[0].r.fornecedor_id, 7);

  // Texto longo é cortado no mesmo limite da tela.
  const longo = await db.query(`select public.definir_nome_exibicao_programacao(100, repeat('x', 200)) as r`);
  assert.equal(longo.rows[0].r.nome_exibicao_programacao.length, 120);
  await db.close();
});

test("sem sessão, item inexistente e programação fechada são recusados", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.exec(`set ensaio.auth_uid = ''`);
  await assert.rejects(
    () => db.query(`select public.definir_nome_exibicao_programacao(100, 'Qualquer nome')`),
    /Usuário não autenticado/,
  );

  await db.exec(`set ensaio.auth_uid = '${OPERADOR}'`);
  await assert.rejects(
    () => db.query(`select public.definir_nome_exibicao_programacao(999, 'Qualquer nome')`),
    /Item de pagamento não encontrado/,
  );
  await assert.rejects(
    () => db.query(`select public.definir_nome_exibicao_programacao(null, 'Qualquer nome')`),
    /Salve a programação antes de renomear/,
  );

  await db.exec(`update public.programacoes_pagamento set fechado = true where id = 10`);
  await assert.rejects(
    () => db.query(`select public.definir_nome_exibicao_programacao(100, 'Qualquer nome')`),
    /Programações históricas fechadas não podem ser alteradas/,
  );

  // Nenhuma das recusas deixou rastro no item.
  const item = await db.query(`select nome_exibicao_programacao, fornecedor_id from public.pagamentos where id = 100`);
  assert.deepEqual(item.rows[0], { nome_exibicao_programacao: null, fornecedor_id: 7 });
  await db.close();
});
