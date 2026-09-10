import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * A TRAVA DE CPF/CNPJ REPETIDO EM POSTGRES DE VERDADE.
 *
 * O outro teste deste envio exercita as regras em JavaScript e trava o texto da
 * migration. Este roda a migration
 * `20260910130000_fornecedor_documento_unico.sql` verbatim num Postgres em
 * memória (PGlite) e prova no banco o que o comando exige:
 *
 *   O MESMO DOCUMENTO NÃO ENTRA DUAS VEZES (nem com pontuação diferente)
 *   DOCUMENTO INÉDITO CONTINUA ENTRANDO
 *   EDITAR O CADASTRO SEM MEXER NO DOCUMENTO CONTINUA SALVANDO
 *   MUDAR O DOCUMENTO PARA O DE OUTRO FORNECEDOR É RECUSADO
 *   FORNECEDOR SEM CPF/CNPJ CONTINUA PERMITIDO, QUANTOS EXISTIREM
 *   INATIVO E EXCLUÍDO ENTRAM NA TRAVA
 *   COM DUPLICADOS NO BANCO A MIGRATION ABORTA E NÃO ALTERA NADA
 *   A MIGRATION É IDEMPOTENTE
 *
 * A estrutura montada aqui é a MÍNIMA para a migration se aplicar e para a
 * consulta de identificação funcionar (fornecedores, usuarios e a visão de
 * permissões efetivas).
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado o
 * teste é PULADO e a suíte continua passando.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const MIGRATION = join(RAIZ, "supabase/migrations/20260910130000_fornecedor_documento_unico.sql");

const OPERADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VISITANTE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const ESTRUTURA = `
create role anon;
create role authenticated;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $x$
  select nullif(current_setting('ensaio.auth_uid', true), '')::uuid
$x$;

create table public.secretarias (id integer primary key, nome text);

create table public.fornecedores (
  id serial primary key,
  razao_social text,
  nome_fantasia text,
  cpf_cnpj text,
  secretaria_id integer references public.secretarias (id),
  telefone text,
  email text,
  ativo boolean not null default true,
  excluido_em timestamptz
);

create table public.usuarios (
  id integer primary key,
  auth_id uuid,
  status text not null default 'ativo'
);

create view public.permissoes_efetivas as
  select 1 as usuario_id, 'fornecedores'::text as modulo,
         true as pode_visualizar, true as pode_cadastrar, true as pode_editar,
         false as pode_excluir, false as pode_aprovar;
`;

const DADOS = `
insert into public.secretarias values (1, 'Educação');
insert into public.usuarios (id, auth_id, status) values
  (1, '${OPERADOR}', 'ativo'),
  (2, '${VISITANTE}', 'ativo');
insert into public.fornecedores (id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, telefone) values
  (7, 'Padaria Central Ltda.', 'Padaria Central', '12.345.678/0001-90', 1, '(00) 0000-0000'),
  (8, 'Mercado da Esquina ME', null, '98765432000111', 1, null),
  (9, 'Fornecedor Sem Documento', null, null, 1, null);
select setval('fornecedores_id_seq', 100);
`;

async function pglite() {
  try {
    return (await import("@electric-sql/pglite")).PGlite;
  } catch {
    return null;
  }
}

async function abrirBanco({ passadas = 1 } = {}) {
  const PGlite = await pglite();
  if (!PGlite) return null;
  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  await db.exec(DADOS);
  const migration = readFileSync(MIGRATION, "utf8");
  // Rodar mais de uma vez é o ensaio de idempotência: é assim que a migration
  // vai ser usada no SQL Editor.
  for (let i = 0; i < passadas; i += 1) await db.exec(migration);
  await db.exec(`set ensaio.auth_uid = '${OPERADOR}'`);
  return db;
}

const pular = (t) => t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

async function recusa(db, sql) {
  try {
    await db.exec(sql);
  } catch (e) {
    return e;
  }
  return null;
}

test("1 e 2. o mesmo CNPJ não entra duas vezes, com ou sem pontuação", async (t) => {
  const db = await abrirBanco({ passadas: 2 });
  if (!db) return pular(t);

  // Exatamente o mesmo texto do cadastro que já existe.
  const igual = await recusa(
    db,
    `insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id)
       values ('Padaria Central Outra Vez', '12.345.678/0001-90', 1)`,
  );
  assert.ok(igual, "o banco deveria recusar o CNPJ repetido");
  assert.match(String(igual.message), /fornecedores_cpf_cnpj_unico_idx/);

  // 2. Mesmo documento, pontuação diferente.
  const semPontuacao = await recusa(
    db,
    `insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id)
       values ('Padaria Central Outra Vez', '12345678000190', 1)`,
  );
  assert.ok(semPontuacao, "o banco deveria recusar o mesmo documento sem pontuação");

  const comPontuacao = await recusa(
    db,
    `insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id)
       values ('Mercado da Esquina Outra Vez', '98.765.432/0001-11', 1)`,
  );
  assert.ok(comPontuacao, "o banco deveria recusar o mesmo documento com pontuação");

  // Nenhum cadastro novo entrou e os dois originais estão intactos.
  const linhas = await db.query(`select id, razao_social, cpf_cnpj from public.fornecedores order by id`);
  assert.deepEqual(linhas.rows, [
    { id: 7, razao_social: "Padaria Central Ltda.", cpf_cnpj: "12.345.678/0001-90" },
    { id: 8, razao_social: "Mercado da Esquina ME", cpf_cnpj: "98765432000111" },
    { id: 9, razao_social: "Fornecedor Sem Documento", cpf_cnpj: null },
  ]);
  await db.close();
});

test("3. fornecedor novo com CNPJ inédito é cadastrado normalmente", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.exec(`
    insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id, telefone, email)
      values ('Gráfica Nova Ltda.', '11.222.333/0001-44', 1, '(00) 1111-2222', 'contato@grafica.com')`);

  const novo = await db.query(
    `select razao_social, cpf_cnpj, ativo from public.fornecedores where cpf_cnpj = '11.222.333/0001-44'`,
  );
  assert.deepEqual(novo.rows, [
    { razao_social: "Gráfica Nova Ltda.", cpf_cnpj: "11.222.333/0001-44", ativo: true },
  ]);

  // CPF (11 dígitos) também entra, e conviver com CNPJ não é problema.
  await db.exec(
    `insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id) values ('José da Silva', '123.456.789-09', 1)`,
  );
  const total = await db.query(`select count(*)::int as total from public.fornecedores`);
  assert.equal(total.rows[0].total, 5);
  await db.close();
});

test("4. editar o fornecedor sem mexer no documento continua salvando", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  // Telefone, e-mail, nome fantasia, razão social e situação: tudo continua
  // editável, inclusive gravando o MESMO documento de novo.
  await db.exec(`
    update public.fornecedores
       set razao_social = 'Padaria Central Comércio Ltda.',
           nome_fantasia = 'Padaria do Centro',
           telefone = '(00) 3333-4444',
           email = 'contato@padaria.com',
           cpf_cnpj = '12.345.678/0001-90'
     where id = 7`);

  const editado = await db.query(
    `select razao_social, nome_fantasia, telefone, email, cpf_cnpj from public.fornecedores where id = 7`,
  );
  assert.deepEqual(editado.rows[0], {
    razao_social: "Padaria Central Comércio Ltda.",
    nome_fantasia: "Padaria do Centro",
    telefone: "(00) 3333-4444",
    email: "contato@padaria.com",
    cpf_cnpj: "12.345.678/0001-90",
  });

  // Repontuar o próprio documento também é permitido: continua sendo dele.
  await db.exec(`update public.fornecedores set cpf_cnpj = '12345678000190' where id = 7`);
  assert.equal(
    (await db.query(`select cpf_cnpj from public.fornecedores where id = 7`)).rows[0].cpf_cnpj,
    "12345678000190",
  );

  // 3. Mudar o documento para o de OUTRO fornecedor é recusado pelo banco.
  const conflito = await recusa(db, `update public.fornecedores set cpf_cnpj = '98.765.432/0001-11' where id = 7`);
  assert.ok(conflito, "o banco deveria recusar a edição para um documento de outro fornecedor");
  assert.match(String(conflito.message), /fornecedores_cpf_cnpj_unico_idx/);
  assert.equal(
    (await db.query(`select cpf_cnpj from public.fornecedores where id = 7`)).rows[0].cpf_cnpj,
    "12345678000190",
  );
  await db.close();
});

test("6. fornecedor sem CPF/CNPJ continua permitido, quantos existirem", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.exec(`
    insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id) values
      ('Sem documento 2', null, 1),
      ('Sem documento 3', '', 1),
      ('Sem documento 4', '  ', 1),
      ('Sem documento 5', '--/', 1)`);

  const sem = await db.query(`
    select count(*)::int as total
      from public.fornecedores
     where cpf_cnpj is null or regexp_replace(cpf_cnpj, '[^0-9]', '', 'g') = ''`);
  assert.equal(sem.rows[0].total, 5);
  await db.close();
});

test("7. inativo e excluído entram na trava e a consulta diz a situação", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.exec(`update public.fornecedores set ativo = false where id = 8`);
  await db.exec(`
    insert into public.fornecedores (id, razao_social, cpf_cnpj, secretaria_id, ativo, excluido_em)
      values (30, 'Gráfica Excluída Ltda.', '44.555.666/0001-77', 1, false, now())`);

  // O documento do INATIVO não pode ser recadastrado.
  const inativo = await recusa(
    db,
    `insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id) values ('Mercado outra vez', '98765432000111', 1)`,
  );
  assert.ok(inativo, "documento de fornecedor inativo deveria continuar reservado");

  // Nem o do que está na LIXEIRA.
  const excluido = await recusa(
    db,
    `insert into public.fornecedores (razao_social, cpf_cnpj, secretaria_id) values ('Gráfica outra vez', '44555666000177', 1)`,
  );
  assert.ok(excluido, "documento de fornecedor na Lixeira deveria continuar reservado");

  const respostaInativo = await db.query(`select public.fornecedor_com_documento('98.765.432/0001-11') as r`);
  assert.deepEqual(respostaInativo.rows[0].r.fornecedor.situacao, "inativo");
  assert.equal(respostaInativo.rows[0].r.fornecedor.razao_social, "Mercado da Esquina ME");
  assert.equal(respostaInativo.rows[0].r.documento, "98765432000111");

  const respostaExcluido = await db.query(`select public.fornecedor_com_documento('44555666000177') as r`);
  assert.equal(respostaExcluido.rows[0].r.fornecedor.situacao, "excluido");
  assert.equal(respostaExcluido.rows[0].r.fornecedor.razao_social, "Gráfica Excluída Ltda.");
  await db.close();
});

test("a consulta identifica quem já usa o documento, ignora o próprio cadastro e exige permissão", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  const achou = await db.query(`select public.fornecedor_com_documento('12345678000190') as r`);
  assert.equal(achou.rows[0].r.encontrado, true);
  assert.equal(achou.rows[0].r.fornecedor.id, 7);
  assert.equal(achou.rows[0].r.fornecedor.razao_social, "Padaria Central Ltda.");
  assert.equal(achou.rows[0].r.fornecedor.cpf_cnpj, "12.345.678/0001-90");
  assert.equal(achou.rows[0].r.fornecedor.situacao, "ativo");

  // Na edição, o próprio fornecedor não conflita consigo mesmo.
  const proprio = await db.query(`select public.fornecedor_com_documento('12.345.678/0001-90', '7') as r`);
  assert.equal(proprio.rows[0].r.encontrado, false);
  assert.equal(proprio.rows[0].r.fornecedor, null);

  // Documento inédito e documento em branco não encontram nada.
  assert.equal((await db.query(`select public.fornecedor_com_documento('11222333000144') as r`)).rows[0].r.encontrado, false);
  assert.equal((await db.query(`select public.fornecedor_com_documento('   ') as r`)).rows[0].r.encontrado, false);

  // Sem sessão, a consulta é recusada.
  await db.exec(`set ensaio.auth_uid = ''`);
  const semSessao = await recusa(db, `select public.fornecedor_com_documento('12345678000190')`);
  assert.ok(semSessao);
  assert.match(String(semSessao.message), /não autenticado/i);

  // Com sessão, mas sem permissão no módulo de fornecedores, também.
  await db.exec(`set ensaio.auth_uid = '${VISITANTE}'`);
  const semPermissao = await recusa(db, `select public.fornecedor_com_documento('12345678000190')`);
  assert.ok(semPermissao);
  assert.match(String(semPermissao.message), /permissão/i);
  await db.close();
});

test("5. com duplicados no banco a migration ABORTA, sem apagar, mesclar ou alterar fornecedor", async (t) => {
  const PGlite = await pglite();
  if (!PGlite) return pular(t);

  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  await db.exec(DADOS);
  await db.exec(`
    insert into public.fornecedores (id, razao_social, cpf_cnpj, secretaria_id) values
      (20, 'Padaria Central (segundo cadastro)', '12345678000190', 1),
      (21, 'Mercado da Esquina (segundo cadastro)', '98.765.432/0001-11', 1);
  `);

  const antes = await db.query(`select id, razao_social, cpf_cnpj, ativo, excluido_em from public.fornecedores order by id`);

  const falha = await recusa(db, readFileSync(MIGRATION, "utf8"));
  assert.ok(falha, "a migration deveria abortar com duplicados no banco");
  // A migration roda dentro de begin/commit: abortar desfaz tudo o que ela
  // tinha começado. No SQL Editor isso é automático; aqui a sessão precisa
  // sair da transação abortada para o teste poder conferir o estado do banco.
  await db.exec("rollback");
  const mensagem = String(falha.message);
  assert.match(mensagem, /MIGRATION ABORTADA/);
  // Quantos: 2 documentos repetidos, em 4 cadastros.
  assert.match(mensagem, /2 documento\(s\) de CPF\/CNPJ repetido\(s\), em 4 cadastros/);
  // Quais: os documentos normalizados e os ids envolvidos.
  assert.match(mensagem, /12345678000190 \(2 cadastros, ids 7, 20\)/);
  assert.match(mensagem, /98765432000111 \(2 cadastros, ids 8, 21\)/);
  assert.match(mensagem, /NENHUM fornecedor foi apagado, mesclado ou alterado/);

  // Nenhum fornecedor foi tocado.
  const depois = await db.query(`select id, razao_social, cpf_cnpj, ativo, excluido_em from public.fornecedores order by id`);
  assert.deepEqual(depois.rows, antes.rows);
  assert.equal(depois.rows.length, 5);

  // E o índice não foi criado: o banco continua exatamente como estava.
  const indice = await db.query(`select count(*)::int as total from pg_indexes where indexname = 'fornecedores_cpf_cnpj_unico_idx'`);
  assert.equal(indice.rows[0].total, 0);

  // Resolvidos os duplicados (decisão da usuária), a mesma migration aplica.
  await db.exec(`delete from public.fornecedores where id in (20, 21)`);
  await db.exec(readFileSync(MIGRATION, "utf8"));
  const agora = await db.query(`select count(*)::int as total from pg_indexes where indexname = 'fornecedores_cpf_cnpj_unico_idx'`);
  assert.equal(agora.rows[0].total, 1);
  await db.close();
});

test("a migration aplica duas vezes e não altera nenhum fornecedor existente", async (t) => {
  const PGlite = await pglite();
  if (!PGlite) return pular(t);

  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  await db.exec(DADOS);
  const antes = await db.query(`select * from public.fornecedores order by id`);

  const migration = readFileSync(MIGRATION, "utf8");
  await db.exec(migration);
  await db.exec(migration);

  const depois = await db.query(`select * from public.fornecedores order by id`);
  assert.deepEqual(depois.rows, antes.rows);

  // Um índice único, criado uma vez.
  const indices = await db.query(`
    select indexname from pg_indexes
     where tablename = 'fornecedores' and indexname = 'fornecedores_cpf_cnpj_unico_idx'`);
  assert.deepEqual(indices.rows, [{ indexname: "fornecedores_cpf_cnpj_unico_idx" }]);
  await db.close();
});
