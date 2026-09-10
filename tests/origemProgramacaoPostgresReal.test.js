import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * A ORIGEM DO ITEM DA PROGRAMAÇÃO em POSTGRES DE VERDADE.
 *
 * Os outros testes desta parte exercitam as regras em JavaScript e travam o
 * texto da migration. Este roda
 * `20260910150000_origem_do_item_na_programacao_diaria.sql` verbatim num
 * Postgres em memória (PGlite), em cima da migration do apelido que ela exige,
 * e chama `salvar_planejamento_programacao` de fato para provar no banco o que
 * o comando exige:
 *
 *   O ITEM CONTINUA VINCULADO AO FORNECEDOR PELO FORNECEDOR_ID
 *   ITEM SEM ORIGEM (O CASO NORMAL) CONTINUA FUNCIONANDO IGUAL
 *   A ORIGEM É INFORMAÇÃO ADICIONAL, GRAVADA JUNTO DO ITEM
 *   PROGRAMAR NÃO PAGA E NÃO MOVIMENTA SALDO DE CONTA
 *   NENHUM VALOR PAGO É GRAVADO NO REGISTRO DA ÁREA
 *   A MIGRATION É IDEMPOTENTE
 *
 * A estrutura montada aqui é a MÍNIMA para as duas migrations se aplicarem (as
 * mesmas tabelas, colunas e tipos que elas conferem antes de alterar qualquer
 * coisa). Os ajudantes que elas usam e não criam são substituídos por versões
 * simples -- o que está sob ensaio são as migrations, não eles.
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado os
 * testes são PULADOS e a suíte continua passando.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const MIGRATION_APELIDO = join(
  RAIZ,
  "supabase/migrations/20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql",
);
const MIGRATION = join(RAIZ, "supabase/migrations/20260910150000_origem_do_item_na_programacao_diaria.sql");

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

-- As três tabelas das áreas, como a 20260910140000 as cria: id uuid.
create table public.fornecedor_patrocinios (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id integer references public.fornecedores (id),
  nome text,
  valor numeric(14,2),
  situacao text,
  ativo boolean not null default true
);
create table public.fornecedor_alugueis (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id integer references public.fornecedores (id),
  descricao text,
  objeto text,
  valor numeric(14,2),
  situacao text,
  ativo boolean not null default true
);
create table public.fornecedor_bandas (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id integer references public.fornecedores (id),
  banda text,
  valor numeric(14,2),
  situacao text,
  ativo boolean not null default true
);
`;

const OPERADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PATROCINIO = "8f1c2b7e-3a4d-4e5f-9a6b-7c8d9e0f1a2b";
const BANDA = "11111111-2222-3333-4444-555555555555";

// Um fornecedor com um patrocínio e uma banda, uma conta com dinheiro e uma
// programação de hoje ainda vazia.
const DADOS = `
insert into public.secretarias values (1, 'Cultura');
insert into public.usuarios values ('${OPERADOR}', 'Operador do ensaio');
insert into public.fornecedores (id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id)
  values (7, 'Produções Artísticas São José LTDA', 'SJ Produções', '12345678000199', 1),
         (8, 'Padaria Central Ltda.', null, '98765432000111', 1);
insert into public.contas_bancarias (id, nome_conta, numero_conta, secretaria_id)
  values (11, 'CULTURA', '2.042-7', 1);
insert into public.saldos_historico (conta_id, data_saldo, valor_saldo) values (11, '2026-09-10', 90000.00);
insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status)
  values (90, 1, '2026-09-10', 'em_elaboracao');

insert into public.fornecedor_patrocinios (id, fornecedor_id, nome, valor, situacao)
  values ('${PATROCINIO}', 7, 'Festa do Peão 2026', 10000.00, 'vigente');
insert into public.fornecedor_bandas (id, fornecedor_id, banda, valor, situacao)
  values ('${BANDA}', 7, 'Trio Serra Azul', 4000.00, 'vigente');
`;

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
  await db.exec(readFileSync(MIGRATION_APELIDO, "utf8"));
  const migration = readFileSync(MIGRATION, "utf8");
  // Rodar mais de uma vez é o ensaio de idempotência: a migration se declara
  // repetível, e é assim que ela vai ser usada no SQL Editor.
  for (let i = 0; i < passadas; i += 1) await db.exec(migration);
  await db.exec(`set ensaio.auth_uid = '${OPERADOR}'`);
  return db;
}

const pular = (t) => t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

/** Como a tela chama a RPC ao salvar -- o MESMO caminho de sempre. */
const salvar = (db, pagamentos, { programacaoId = 90, contas = [] } = {}) =>
  db.query(
    `select public.salvar_planejamento_programacao($1, $2::jsonb, $3::jsonb, $4, $5, $6) as r`,
    [programacaoId, JSON.stringify(contas), JSON.stringify(pagamentos), 90000, 0, 90000],
  );

const itensDa = (db, programacaoId = 90) =>
  db.query(
    `select id, fornecedor_id, nome_avulso, valor_a_pagar, situacao, nome_exibicao_programacao,
            origem_tipo, origem_id::text as origem_id
       from public.pagamentos
      where programacao_id = $1 and excluido_em is null
      order by valor_a_pagar`,
    [programacaoId],
  );

test("a migration aplica duas vezes e só acrescenta as duas colunas de origem", async (t) => {
  const db = await abrirBanco({ passadas: 2 });
  if (!db) return pular(t);

  const colunas = await db.query(`
    select column_name, data_type, is_nullable
      from information_schema.columns
     where table_name = 'pagamentos' and column_name in ('origem_tipo', 'origem_id')
     order by column_name`);
  assert.deepEqual(colunas.rows, [
    { column_name: "origem_id", data_type: "uuid", is_nullable: "YES" },
    { column_name: "origem_tipo", data_type: "text", is_nullable: "YES" },
  ]);

  // Uma cópia só de cada restrição e do índice, mesmo aplicando duas vezes.
  const restricoes = await db.query(`
    select conname from pg_constraint
     where conrelid = 'public.pagamentos'::regclass and conname like 'pagamentos_origem%'
     order by conname`);
  assert.deepEqual(
    restricoes.rows.map((linha) => linha.conname),
    ["pagamentos_origem_completa_check", "pagamentos_origem_tipo_check"],
  );
  const indices = await db.query(
    `select indexname from pg_indexes where tablename = 'pagamentos' and indexname = 'pagamentos_origem_idx'`,
  );
  assert.equal(indices.rows.length, 1);

  // Nenhuma tabela de área ganhou coluna de valor pago: Pago e Saldo do
  // registro continuam saindo das baixas das NFs vinculadas.
  const pago = await db.query(`
    select table_name, column_name from information_schema.columns
     where table_name in ('fornecedor_patrocinios', 'fornecedor_alugueis', 'fornecedor_bandas')
       and column_name like '%pago%'`);
  assert.deepEqual(pago.rows, []);
  await db.close();
});

test("o item da área entra com a origem, e o vínculo continua sendo o fornecedor_id", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  const gravou = await salvar(db, [
    {
      id: null,
      fornecedor_id: 7,
      nome_avulso: null,
      nome_exibicao_programacao: "Patrocínio — Festa do Peão 2026",
      valor_a_pagar: 10000,
      cadastrar_fornecedor_posteriormente: false,
      origem_tipo: "patrocinio",
      origem_id: PATROCINIO,
    },
  ]);
  assert.equal(gravou.rows[0].r.ok, true);

  const itens = await itensDa(db);
  assert.equal(itens.rows.length, 1);
  const item = itens.rows[0];
  assert.equal(item.fornecedor_id, 7, "o vínculo do pagamento é o fornecedor_id");
  assert.equal(item.valor_a_pagar, "10000.00");
  // Programado, nunca pago: a baixa continua sendo por NF, na aba de Baixas.
  assert.equal(item.situacao, "programado");
  assert.equal(item.nome_exibicao_programacao, "Patrocínio — Festa do Peão 2026");
  assert.equal(item.origem_tipo, "patrocinio");
  assert.equal(item.origem_id, PATROCINIO);

  // O cadastro do fornecedor não foi tocado pelo nome de exibição do item.
  const fornecedor = await db.query(
    `select razao_social, nome_fantasia, apelido from public.fornecedores where id = 7`,
  );
  assert.deepEqual(fornecedor.rows[0], {
    razao_social: "Produções Artísticas São José LTDA",
    nome_fantasia: "SJ Produções",
    apelido: null,
  });

  // O registro do patrocínio ficou exatamente como estava: nenhum valor pago,
  // nenhuma marca de "programado" gravada nele.
  const patrocinio = await db.query(
    `select nome, valor, situacao from public.fornecedor_patrocinios where id = $1`,
    [PATROCINIO],
  );
  assert.deepEqual(patrocinio.rows[0], {
    nome: "Festa do Peão 2026",
    valor: "10000.00",
    situacao: "vigente",
  });

  // E o saldo da conta continua onde estava: programar não movimenta dinheiro.
  const saldos = await db.query(`select conta_id, valor_saldo from public.saldos_historico`);
  assert.deepEqual(saldos.rows, [{ conta_id: 11, valor_saldo: "90000.00" }]);
  await db.close();
});

test("item sem origem continua funcionando exatamente como antes", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  // O que a tela manda para um fornecedor escolhido na lista e para um avulso:
  // sem origem nenhuma, como sempre foi.
  const gravou = await salvar(db, [
    { id: null, fornecedor_id: 8, nome_avulso: null, valor_a_pagar: 320.5, cadastrar_fornecedor_posteriormente: false },
    { id: null, fornecedor_id: null, nome_avulso: "Fretes Silva", valor_a_pagar: 300, cadastrar_fornecedor_posteriormente: true },
  ]);
  assert.equal(gravou.rows[0].r.ok, true);

  const itens = await itensDa(db);
  assert.deepEqual(
    itens.rows.map(({ fornecedor_id, nome_avulso, valor_a_pagar, origem_tipo, origem_id }) => ({
      fornecedor_id,
      nome_avulso,
      valor_a_pagar,
      origem_tipo,
      origem_id,
    })),
    [
      { fornecedor_id: null, nome_avulso: "Fretes Silva", valor_a_pagar: "300.00", origem_tipo: null, origem_id: null },
      { fornecedor_id: 8, nome_avulso: null, valor_a_pagar: "320.50", origem_tipo: null, origem_id: null },
    ],
  );
  await db.close();
});

test("o valor do item continua editável depois de vir da área", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await salvar(db, [
    { id: null, fornecedor_id: 7, valor_a_pagar: 4000, origem_tipo: "banda", origem_id: BANDA },
  ]);
  const criado = await itensDa(db);
  const id = criado.rows[0].id;

  // A tela reabre, o usuário troca o valor e salva de novo -- o caminho de
  // sempre, agora com a origem já no item.
  await salvar(db, [
    { id, fornecedor_id: 7, valor_a_pagar: 2500, origem_tipo: "banda", origem_id: BANDA },
  ]);
  const depois = await db.query(
    `select valor_a_pagar, origem_tipo, origem_id::text as origem_id from public.pagamentos where id = $1`,
    [id],
  );
  assert.deepEqual(depois.rows[0], {
    valor_a_pagar: "2500.00",
    origem_tipo: "banda",
    origem_id: BANDA,
  });

  // Cliente antigo, que não conhece a origem, não apaga a que já estava.
  await salvar(db, [{ id, fornecedor_id: 7, valor_a_pagar: 2500 }]);
  const preservada = await db.query(
    `select origem_tipo, origem_id::text as origem_id from public.pagamentos where id = $1`,
    [id],
  );
  assert.deepEqual(preservada.rows[0], { origem_tipo: "banda", origem_id: BANDA });
  await db.close();
});

test("origem incompleta, desconhecida ou sem identificador é recusada", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  const recusa = async (item, esperado) => {
    await assert.rejects(() => salvar(db, [item]), esperado);
  };

  await recusa(
    { id: null, fornecedor_id: 7, valor_a_pagar: 100, origem_tipo: "contrato", origem_id: PATROCINIO },
    /não é reconhecida/i,
  );
  await recusa(
    { id: null, fornecedor_id: 7, valor_a_pagar: 100, origem_tipo: "patrocinio" },
    /incompleta/i,
  );
  await recusa(
    { id: null, fornecedor_id: 7, valor_a_pagar: 100, origem_tipo: "patrocinio", origem_id: "12" },
    /identificador/i,
  );

  // Nenhuma das recusas deixou item pela metade nem mexeu no saldo.
  const itens = await db.query(`select count(*)::int as total from public.pagamentos`);
  assert.equal(itens.rows[0].total, 0);
  const saldos = await db.query(`select valor_saldo from public.saldos_historico`);
  assert.deepEqual(saldos.rows, [{ valor_saldo: "90000.00" }]);
  await db.close();
});

test("programação fechada não recebe item de área nenhum", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.exec(`update public.programacoes_pagamento set fechado = true where id = 90`);
  await assert.rejects(
    () =>
      salvar(db, [
        { id: null, fornecedor_id: 7, valor_a_pagar: 100, origem_tipo: "patrocinio", origem_id: PATROCINIO },
      ]),
    /fechada/i,
  );
  const itens = await db.query(`select count(*)::int as total from public.pagamentos`);
  assert.equal(itens.rows[0].total, 0);
  await db.close();
});
