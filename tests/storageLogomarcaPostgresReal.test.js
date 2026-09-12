import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * A MIGRATION DA LOGOMARCA RODANDO DE PONTA A PONTA, EM POSTGRES DE VERDADE.
 *
 * Os outros testes conferem o TEXTO do arquivo -- que a função vem antes das
 * políticas, que os blocos tratam `when others`, que não existe
 * `delete from storage.objects`. Texto, porém, não prova execução: a migration
 * anterior também "parecia certa" e morria na primeira política com
 *
 *   ERROR: 42883: function public.pode_editar_configuracoes() does not exist
 *
 * Este teste roda
 * `20260912160000_storage_logomarca_politicas_corrigidas.sql` VERBATIM num
 * Postgres em memória (PGlite), sobre um `storage` de mentira com a mesma forma
 * do de produção, e confere o que o SQL Editor mostraria:
 *
 *   - a execução chega ao fim, sem erro;
 *   - a função de permissão existe, e é a do padrão do projeto;
 *   - as QUATRO políticas ficam no lugar (select, insert, update, delete);
 *   - ⚠️ A LOGOMARCA QUE JÁ ESTAVA NO BUCKET CONTINUA LÁ, com a data original;
 *   - rodar duas vezes dá no mesmo (idempotência);
 *   - a permissão vale de fato: quem tem `pode_editar` em 'administracao' grava
 *     pela RLS, quem não tem é recusado;
 *   - faltando a origem das permissões, o script PARA ANTES de encostar em
 *     política alguma -- nunca metade no lugar;
 *   - e o arquivo velho, o que abortava, ABORTA MESMO, com 42883.
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado o
 * teste é PULADO e a suíte continua passando. Para rodá-lo:
 * `npm i -D @electric-sql/pglite`.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const MIGRATION = join(RAIZ, "supabase/migrations/20260912160000_storage_logomarca_politicas_corrigidas.sql");
const ABORTAVA = join(RAIZ, "supabase/migrations/20260912130000_storage_logomarca.sql");
const ORIGEM_DA_FUNCAO = join(RAIZ, "supabase/migrations/20260823160000_lixeira_restauracao_exclusao_definitiva.sql");

/**
 * A função de permissão COMO ELA É EM PRODUÇÃO, lida da migration que a criou
 * -- e não de uma cópia escrita aqui, para o teste comparar a migration nova
 * contra a função de verdade.
 */
function funcaoOriginal() {
  const src = readFileSync(ORIGEM_DA_FUNCAO, "utf8");
  const i = src.indexOf("create or replace function public.pode_em_administracao(acao text)");
  assert.notEqual(i, -1, "a função deveria existir na migration que a criou");
  return src.slice(i, src.indexOf("$$;", src.indexOf("as $$", i)) + 3);
}

const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONSULTA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** O nome do arquivo que JÁ ESTÁ no bucket antes de a migration rodar. */
const LOGOMARCA_EM_USO = "logomarca/brasao.png";

/**
 * O `storage` do Supabase, na forma que interessa: o bucket com as três colunas
 * que a migration ajusta (public, file_size_limit, allowed_mime_types) e a
 * tabela de objetos com RLS, que é onde as políticas pegam.
 */
const STORAGE = `
  create schema if not exists storage;
  create schema if not exists auth;

  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz not null default now()
  );

  create table storage.objects (
    id bigserial primary key,
    bucket_id text not null references storage.buckets (id),
    name text not null,
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;

  create table auth.users (id uuid primary key);

  -- auth.uid() do ensaio: lê o usuário "logado" de uma configuração de sessão.
  create function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('ensaio.auth_uid', true), '')::uuid $$;
`;

/**
 * As DUAS origens da permissão que a migration exige antes de criar a função:
 * public.usuarios e a view public.permissoes_efetivas. Aqui elas têm só as
 * colunas que o corpo da função lê -- é o contrato, não a tabela inteira.
 */
const PERMISSOES = `
  create table public.usuarios (
    id uuid primary key,
    auth_id uuid,
    nome_completo text,
    status text not null default 'ativo'
  );

  create table public.permissoes_base (
    usuario_id uuid not null,
    modulo text not null,
    pode_visualizar boolean not null default false,
    pode_cadastrar boolean not null default false,
    pode_editar boolean not null default false,
    pode_excluir boolean not null default false,
    pode_aprovar boolean not null default false
  );

  create view public.permissoes_efetivas as
    select usuario_id, modulo, pode_visualizar, pode_cadastrar, pode_editar,
           pode_excluir, pode_aprovar
      from public.permissoes_base;
`;

/**
 * O estado do banco ANTES da migration: bucket já criado (foi o que a migration
 * pela metade deixou), A LOGOMARCA JÁ ENVIADA, e dois usuários -- um que pode
 * editar em 'administracao' e um que só consulta.
 */
const ANTES = `
  insert into storage.buckets (id, name, public, file_size_limit)
    values ('configuracoes', 'configuracoes', false, 1024);
  insert into storage.objects (bucket_id, name, created_at)
    values ('configuracoes', '${LOGOMARCA_EM_USO}', '2026-03-04 10:20:30+00');

  insert into auth.users (id) values ('${ADMIN}'), ('${CONSULTA}');
`;

/** Os usuários e as permissões deles -- só existem quando a origem existe. */
const USUARIOS = `
  insert into public.usuarios (id, auth_id, nome_completo, status) values
    ('99999999-9999-9999-9999-999999999999', '${ADMIN}', 'Administradora', 'ativo'),
    ('88888888-8888-8888-8888-888888888888', '${CONSULTA}', 'Consulta', 'ativo');
  insert into public.permissoes_base (usuario_id, modulo, pode_visualizar, pode_editar) values
    ('99999999-9999-9999-9999-999999999999', 'administracao', true, true),
    ('88888888-8888-8888-8888-888888888888', 'administracao', true, false);
`;

const migration = () => readFileSync(MIGRATION, "utf8");

async function abrirBanco({ comPermissoes = true } = {}) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  // O papel do Supabase para quem está logado: é a ele que as políticas são
  // concedidas, e é como ele que a gravação da tela acontece.
  await db.exec("create role authenticated;");
  await db.exec(STORAGE);
  if (comPermissoes) await db.exec(PERMISSOES);
  await db.exec(ANTES);
  if (comPermissoes) await db.exec(USUARIOS);
  await db.exec(`
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant usage, select on sequence storage.objects_id_seq to authenticated;
  `);
  return db;
}

const PULAR = "@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)";

async function politicas(db) {
  const { rows } = await db.query(`
    select policyname, cmd from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'configuracoes_%'
     order by policyname
  `);
  return rows;
}

/* -------------------------------------------------------------------------
 * 1. A execução inteira, e duas vezes
 * ---------------------------------------------------------------------- */

test("a migration da logomarca roda inteira, sem erro, e rodar de novo dá no mesmo", async (t) => {
  const db = await abrirBanco();
  if (!db) return t.skip(PULAR);

  // ⚠️ AQUI ESTÁ A PROVA DE PONTA A PONTA: nenhuma exceção. É a execução que o
  // SQL Editor faria, com o arquivo lido do disco, sem uma linha adaptada.
  await db.exec(migration());

  // A função de permissão do padrão do projeto ficou disponível -- é o conserto
  // do 42883, e ela vem ANTES de qualquer política.
  const { rows: funcoes } = await db.query(
    "select to_regprocedure('public.pode_em_administracao(text)')::text as funcao",
  );
  assert.deepEqual(funcoes, [{ funcao: "pode_em_administracao(text)" }]);
  // E a função que abortava a migration anterior continua NÃO existindo: o
  // conserto foi usar a do padrão, não criar um nome novo.
  const { rows: velha } = await db.query(
    "select 1 from pg_proc where proname = 'pode_editar_configuracoes'",
  );
  assert.equal(velha.length, 0);

  // O bucket: público (a impressão carrega a imagem por URL), teto de 26 MB e
  // sem lista de tipos.
  const { rows: baldes } = await db.query(
    "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'configuracoes'",
  );
  assert.deepEqual(baldes, [{ public: true, file_size_limit: 26214400, allowed_mime_types: null }]);

  // AS QUATRO POLÍTICAS, e não uma parte delas -- era exatamente o que falhava.
  assert.deepEqual(await politicas(db), [
    { policyname: "configuracoes_delete_administracao", cmd: "DELETE" },
    { policyname: "configuracoes_insert_administracao", cmd: "INSERT" },
    { policyname: "configuracoes_leitura_publica", cmd: "SELECT" },
    { policyname: "configuracoes_update_administracao", cmd: "UPDATE" },
  ]);

  // ⚠️ A LOGOMARCA EM USO NÃO FOI PERDIDA: mesmo nome, mesma data de envio.
  const { rows: arquivos } = await db.query(
    "select name, created_at from storage.objects where bucket_id = 'configuracoes'",
  );
  assert.equal(arquivos.length, 1);
  assert.equal(arquivos[0].name, LOGOMARCA_EM_USO);
  assert.equal(new Date(arquivos[0].created_at).toISOString(), "2026-03-04T10:20:30.000Z");

  // IDEMPOTENTE: a segunda execução também vai até o fim, e o estado é o mesmo.
  await db.exec(migration());
  assert.equal((await politicas(db)).length, 4);
  const { rows: aindaLa } = await db.query(
    "select name from storage.objects where bucket_id = 'configuracoes'",
  );
  assert.deepEqual(aindaLa, [{ name: LOGOMARCA_EM_USO }]);
  const { rows: umBalde } = await db.query(
    "select count(*)::int as total from storage.buckets where id = 'configuracoes'",
  );
  assert.deepEqual(umBalde, [{ total: 1 }]);

  await db.close();
});

/* -------------------------------------------------------------------------
 * 2. A política funciona: a permissão é a do módulo 'administracao'
 * ---------------------------------------------------------------------- */

test("com as políticas no lugar, quem pode editar em administracao grava a logomarca", async (t) => {
  const db = await abrirBanco();
  if (!db) return t.skip(PULAR);
  await db.exec(migration());

  // A ADMINISTRADORA grava -- é o envio da logomarca pela tela.
  await db.exec(`
    begin;
      set local role authenticated;
      set local ensaio.auth_uid = '${ADMIN}';
      insert into storage.objects (bucket_id, name) values ('configuracoes', 'logomarca/nova.png');
    commit;
  `);
  const { rows } = await db.query(
    "select count(*)::int as total from storage.objects where name = 'logomarca/nova.png'",
  );
  assert.deepEqual(rows, [{ total: 1 }]);

  // QUEM SÓ CONSULTA é recusado pela RLS -- a mesma permissão que a tela
  // confere e que a função do servidor confere antes de gravar.
  await assert.rejects(
    () => db.exec(`
      begin;
        set local role authenticated;
        set local ensaio.auth_uid = '${CONSULTA}';
        insert into storage.objects (bucket_id, name) values ('configuracoes', 'logomarca/proibida.png');
      commit;
    `),
    /row-level security/i,
  );
  await db.exec("rollback;");

  // Mas a LEITURA é pública: é assim que o brasão aparece no cabeçalho impresso
  // e no relatório, carregado por URL, sem sessão.
  const { rows: lidos } = await db.query(`
    select count(*)::int as total from storage.objects where bucket_id = 'configuracoes'
  `);
  assert.deepEqual(lidos, [{ total: 2 }]);

  await db.close();
});

/* -------------------------------------------------------------------------
 * 3. Sem a origem das permissões: para ANTES, e não deixa metade
 * ---------------------------------------------------------------------- */

test("faltando public.usuarios, a migration para antes de tocar em política alguma", async (t) => {
  const db = await abrirBanco({ comPermissoes: false });
  if (!db) return t.skip(PULAR);

  // Ela NÃO tenta criar a função com o corpo inválido nem sai criando políticas
  // que chamariam uma função inexistente -- o 42883 de novo. Ela para e diz o
  // que rodar primeiro.
  await assert.rejects(() => db.exec(migration()), /PARADO ANTES DE MUDAR QUALQUER COISA/);
  await db.exec("rollback;");

  // ⚠️ NADA PELA METADE: nenhuma política do bucket foi criada.
  assert.deepEqual(await politicas(db), []);
  // E a logomarca que já estava lá continua lá, intocada.
  const { rows } = await db.query(
    "select name from storage.objects where bucket_id = 'configuracoes'",
  );
  assert.deepEqual(rows, [{ name: LOGOMARCA_EM_USO }]);

  await db.close();
});

/* -------------------------------------------------------------------------
 * 4. O arquivo velho aborta mesmo -- é por isto que existe o novo
 * ---------------------------------------------------------------------- */

test("o arquivo anterior aborta com 42883, e é por isso que foi substituído", async (t) => {
  const db = await abrirBanco();
  if (!db) return t.skip(PULAR);

  // O motivo do conserto, demonstrado: a função que ele chama não existe neste
  // banco, e o erro é de uma classe que o `exception when insufficient_privilege`
  // dele não pega -- então o script inteiro morre.
  await assert.rejects(
    () => db.exec(readFileSync(ABORTAVA, "utf8")),
    (erro) => {
      assert.match(String(erro.message), /pode_editar_configuracoes/);
      return true;
    },
  );
  await db.exec("rollback;");

  // Nem a política de leitura, que vem antes da que estoura, sobrevive: é o
  // "nada foi aplicado" que a tela mostrava como falha de envio sem motivo.
  assert.deepEqual(await politicas(db), []);

  await db.close();
});

/* -------------------------------------------------------------------------
 * 5. Banco que JÁ tem a função: nada muda de valor para ninguém
 * ---------------------------------------------------------------------- */

test("num banco onde a função de permissão já existe, o corpo dela não é alterado", async (t) => {
  const db = await abrirBanco();
  if (!db) return t.skip(PULAR);

  // O banco de produção que já rodou 20260823160000 chega aqui com a função no
  // lugar. É o caso mais comum, e o que precisa sair INTACTO.
  await db.exec(funcaoOriginal());
  const antes = await db.query("select prosrc from pg_proc where proname = 'pode_em_administracao'");

  await db.exec(migration());

  // ⚠️ MESMO CORPO, LETRA POR LETRA: quem podia editar continua podendo, quem
  // não podia continua não podendo. A migration não reescreve permissão.
  const depois = await db.query("select prosrc from pg_proc where proname = 'pode_em_administracao'");
  assert.deepEqual(depois.rows, antes.rows);
  // E as quatro políticas entraram do mesmo jeito.
  assert.equal((await politicas(db)).length, 4);

  // A permissão continua respondendo o que respondia, ação por ação.
  await db.exec(`set ensaio.auth_uid = '${ADMIN}'`);
  const { rows: daAdmin } = await db.query(`
    select public.pode_em_administracao('editar') as editar,
           public.pode_em_administracao('excluir') as excluir,
           public.pode_em_administracao('inventada') as inventada
  `);
  assert.deepEqual(daAdmin, [{ editar: true, excluir: false, inventada: false }]);
  await db.exec(`set ensaio.auth_uid = '${CONSULTA}'`);
  const { rows: daConsulta } = await db.query(
    "select public.pode_em_administracao('editar') as editar",
  );
  assert.deepEqual(daConsulta, [{ editar: false }]);

  await db.close();
});
