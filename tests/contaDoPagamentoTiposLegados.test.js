// CONTA DO PAGAMENTO — a recusa 22P02 que travava os três caminhos da tela.
//
// Atribuir a conta na seção "Execução da programação" era recusada pelo banco
// em TODA chamada, com o código 22P02, e a tela mandava rodar a migration da
// aprovação -- que já estava rodada e que não contém a função da conta.
//
// O que fica travado aqui:
//
//   A COMPARAÇÃO QUE ESTOURAVA: coalesce(p.situacao, '') com situacao em enum
//   OS TRÊS CAMINHOS: atribuir aos selecionados, aplicar a todos, escolha individual
//   A CONTA PERSISTE DEPOIS DE RECARREGAR
//   O CONTADOR "com conta definida" SEGUE O BANCO, NÃO A TELA
//   SALVAR, MARCAR EM ANÁLISE E APROVAR CONTINUAM FUNCIONANDO
//   DEFINIR CONTA NÃO MOVE SALDO NENHUM
//   A MENSAGEM DE 22P02 APONTA O ARQUIVO DA OPERAÇÃO QUE FALHOU -- OU NENHUM
//
// A metade que só o banco faz valer roda em POSTGRES DE VERDADE (PGlite), com
// public.pagamentos.situacao no ENUM que a produção tem, a migration executada
// verbatim e as funções chamadas de fato. Sem `@electric-sql/pglite` instalado,
// essa parte é PULADA e a suíte continua passando.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { classificarFalhaFase1 } from "../src/lib/estruturaPagamentosFase1.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const read = (caminho) => readFile(join(RAIZ, caminho), "utf8");

const MIGRATION = "supabase/migrations/20260911120000_blindar_tipos_legados_pagamentos.sql";
const MIGRATION_DEFEITO = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";
const MIGRATION_APROVACAO = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const MIGRATION_FASE_2 = "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql";
const MIGRATION_SALVAR = "supabase/migrations/20260910150000_origem_do_item_na_programacao_diaria.sql";
const MIGRATION_FORNECEDORES = "supabase/migrations/20260828190000_corrigir_gravacao_fornecedores_programacao.sql";
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";
const DADOS_LIB = "src/lib/execucaoProgramacaoDados.js";

// Os comentários da migration descrevem a regra; as asserções olham o SQL que
// roda, não a explicação escrita ao lado dele.
function semComentarios(sql) {
  return sql
    .split("\n")
    .filter((linha) => !/^\s*--/.test(linha))
    .join("\n");
}

/** Só o corpo de uma função, recortado de uma migration. */
function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio >= 0, `função não encontrada: ${nome}`);
  const fim = sql.indexOf(`grant execute on function public.${nome}`, inicio);
  assert.ok(fim > inicio, `grant não encontrado depois de ${nome}`);
  return sql.slice(inicio, fim);
}

function funcaoDaMigration(caminho, nome) {
  return corpoDaFuncao(readFileSync(join(RAIZ, caminho), "utf8"), nome);
}

// ---------------------------------------------------------------------------
// 1. A migration: nenhuma leitura depende do tipo da coluna legada
// ---------------------------------------------------------------------------

test("a função da conta do pagamento não compara mais situacao sem converter para texto", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const conta = corpoDaFuncao(sql, "definir_conta_origem_pagamento");

  // A causa medida do 22P02: o '' vira valor do enum situacao_pagamento.
  assert.doesNotMatch(conta, /coalesce\(\s*p\.situacao\s*,/, "voltou a comparar situacao sem ::text");
  assert.ok(conta.includes("coalesce(p.situacao::text, '')"), "a comparação de situacao precisa sair como texto");

  // As outras quatro colunas legadas do caminho, todas lidas como texto.
  assert.ok(conta.includes("pr.status::text"), "status precisa sair como texto");
  assert.ok(conta.includes("pr.fechado::text"), "fechado precisa sair como texto");
  assert.ok(conta.includes("pc.ativa::text"), "ativa precisa sair como texto");
  assert.ok(conta.includes("cb.ativo::text"), "ativo precisa sair como texto");
  assert.doesNotMatch(conta, /v_fechado\s+boolean|v_conta_ativa\s+boolean/, "voltou a declarar coluna legada como boolean");
  assert.doesNotMatch(conta, /if v_fechado is true then/, "fechado voltou a ser lido como boolean");
  assert.doesNotMatch(conta, /pc\.ativa = true/, "ativa voltou a ser comparada com true");
});

test("a gravação da conta converte para o tipo real da coluna, lido do catálogo", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const conta = corpoDaFuncao(sql, "definir_conta_origem_pagamento");

  assert.ok(conta.includes("public.tipo_da_coluna('pagamentos', 'conta_origem_id')"), "o tipo da coluna não é lido do catálogo");
  assert.match(conta, /conta_origem_id = \$1::%s/, "a gravação não converte para o tipo real da coluna");
  assert.match(conta, /get diagnostics v_atualizados = row_count/, "sem row_count não se sabe quantos pagamentos mudaram");

  // Coluna ausente sai como 42703 -- o código que a tela reconhece como falta de
  // estrutura. Quem nomeia arquivo é a tela; o banco só diz o que faltou.
  assert.match(conta, /v_tipo_conta_origem = 'coluna ausente'/);
  assert.match(conta, /errcode = '42703'/);
  assert.equal(classificarFalhaFase1({ code: "42703" }).tipo, "estrutura");
});

test("a função da conta diz a etapa e o tipo real das colunas em falha inesperada", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const conta = corpoDaFuncao(sql, "definir_conta_origem_pagamento");

  assert.match(conta, /v_etapa text := 'início'/);
  for (const etapa of [
    "conferência da permissão de definir a conta",
    "leitura da programação",
    "leitura da conta bancária escolhida",
    "conferência da conta entre as contas de trabalho",
    "leitura do tipo real da coluna conta_origem_id",
    "gravação da conta de origem nos pagamentos",
    "registro na auditoria",
  ]) {
    assert.ok(conta.includes(`v_etapa := '${etapa}'`), `etapa não nomeada: ${etapa}`);
  }

  assert.match(conta, /get stacked diagnostics/);
  assert.match(conta, /etapa=%s sqlstate=%s/);
  for (const coluna of [
    ["programacoes_pagamento", "status"],
    ["programacoes_pagamento", "fechado"],
    ["programacao_contas", "ativa"],
    ["contas_bancarias", "ativo"],
    ["pagamentos", "situacao"],
    ["pagamentos", "conta_origem_id"],
    ["auditoria_eventos", "nivel"],
  ]) {
    assert.ok(
      conta.includes(`public.tipo_da_coluna('${coluna[0]}', '${coluna[1]}')`),
      `o erro não informa o tipo real de ${coluna[0]}.${coluna[1]}`,
    );
  }
  // Os códigos de "falta objeto no banco" passam intactos: é deles que a tela
  // tira o nome do arquivo a executar.
  assert.match(conta, /sqlstate in \('P0001', '42501', '42P01', '42703', '42883', '42P13'\)/);
});

test("a varredura cobre todas as funções do módulo que liam coluna legada sem converter", async () => {
  const sql = semComentarios(await read(MIGRATION));

  // As portas de permissão: um `case` que misturava boolean com texto era
  // recusado com 42804 e fechava TODAS as operações da fase de uma vez.
  for (const porta of ["pode_em_pagamentos_fase2", "pode_em_baixas", "pode_reabrir_programacao"]) {
    const corpo = corpoDaFuncao(sql, porta);
    assert.ok(corpo.includes("u.status::text = 'ativo'"), `${porta}: status do usuário sem ::text`);
    assert.match(corpo, /public\.texto_verdadeiro/, `${porta}: permissão lida sem passar pelo leitor de texto`);
    assert.doesNotMatch(corpo, /\n\s+and u\.status = 'ativo'/, `${porta}: status voltou a ser comparado sem ::text`);
    assert.doesNotMatch(corpo, /pe\.permitido from public\.permissoes_especiais/, `${porta}: permitido sem ::text`);
  }

  // A baixa: coalesce(c.ativo, true) assumia boolean e derrubava a baixa inteira.
  const baixa = corpoDaFuncao(sql, "registrar_baixa_nota");
  assert.doesNotMatch(baixa, /coalesce\(c\.ativo, true\)/, "voltou a ler contas_bancarias.ativo como boolean");
  assert.ok(baixa.includes("coalesce(c.ativo::text, 'true')"));
  // A BAIXA NÃO DEBITA O SALDO DA CONTA: continua sem escrever em saldo.
  assert.doesNotMatch(baixa, /insert into public\.saldos_historico|update public\.saldos_historico|update public\.contas_bancarias/);

  // O estorno: status explicitado como texto, e ele continua sendo o único
  // (junto da transferência) que move saldo.
  const estorno = corpoDaFuncao(sql, "estornar_transferencia");
  assert.ok(estorno.includes("tc.status::text"), "o status da transferência precisa sair como texto");

  // O nome de exibição ganha a etapa e os tipos, como as demais.
  const nome = corpoDaFuncao(sql, "definir_nome_exibicao_programacao");
  assert.match(nome, /v_etapa text := 'início'/);
  assert.match(nome, /public\.tipo_da_coluna\('programacoes_pagamento', 'fechado'\)/);
});

test("definir conta não escreve em nenhuma tabela de saldo, e a migration não altera estrutura", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const conta = corpoDaFuncao(sql, "definir_conta_origem_pagamento");

  // CONTA SELECIONADA != CONTA DEBITADA. A função grava UMA coluna e mais nada.
  for (const proibido of [
    /saldos_historico/,
    /pagamento_movimentacoes/,
    /pagamentos_baixas/,
    /update public\.contas_bancarias/,
    /update public\.programacao_contas/,
  ]) {
    assert.doesNotMatch(conta, proibido, `a conta do pagamento não pode tocar em ${proibido}`);
  }
  assert.match(conta, /'debitou_conta', false/, "a resposta precisa continuar dizendo que nada foi debitado");

  // Nenhuma alteração de estrutura: a migration só substitui corpo de função.
  for (const proibido of [/\balter table\b/i, /\bdrop (table|column|function|view|policy)\b/i, /\bcreate table\b/i, /\bdelete from\b/i, /\btruncate\b/i, /\bupdate public\./i]) {
    const fora = sql.split("\n").filter((linha) => proibido.test(linha) && !/^\s{2,}/.test(linha));
    assert.deepEqual(fora, [], `a migration não pode alterar estrutura: ${proibido}`);
  }
});

// ---------------------------------------------------------------------------
// 2. A tela: a mensagem do 22P02 para de apontar o arquivo errado
// ---------------------------------------------------------------------------

test("o 22P02 aponta o arquivo da operação que falhou, e nenhum quando não se sabe", async () => {
  const pagina = await read(PAGINA);

  // O ramo do 22P02 continua existindo, agora escolhendo o arquivo pela operação.
  assert.match(pagina, /String\(falha\?\.code \?\? ""\) === "22P02"/);
  assert.match(pagina, /const MIGRATION_DE_TIPO_POR_OPERACAO = \{/);
  assert.match(pagina, /const arquivo = MIGRATION_DE_TIPO_POR_OPERACAO\[String\(operacao \?\? ""\)\]/);

  // Definir a conta aponta a migration desta correção, não a da aprovação.
  assert.match(pagina, /definir_conta: MIGRATION_BLINDAGEM_TIPOS/);
  assert.match(pagina, /MIGRATION_BLINDAGEM_TIPOS = "supabase\/migrations\/20260911120000_blindar_tipos_legados_pagamentos\.sql"/);
  // Aprovar, salvar e marcar em análise continuam apontando a que os refez.
  assert.match(pagina, /aprovar: MIGRATION_CORRECAO_APROVACAO/);
  assert.match(pagina, /salvar: MIGRATION_CORRECAO_APROVACAO/);
  assert.match(pagina, /em_analise: MIGRATION_CORRECAO_APROVACAO/);
  assert.match(pagina, /reabrir: MIGRATION_REABERTURA/);

  // Operação desconhecida não ganha palpite de arquivo -- e o mapa só tem as
  // operações que a própria tela relata.
  assert.match(pagina, /: "Nenhum saldo foi movimentado\."/);
  const mapa = pagina.slice(pagina.indexOf("const MIGRATION_DE_TIPO_POR_OPERACAO = {"));
  const chaves = mapa.slice(0, mapa.indexOf("};")).match(/^\s{2}(\w+):/gm).map((linha) => linha.trim().replace(":", ""));
  assert.deepEqual(chaves.sort(), ["aprovar", "definir_conta", "em_analise", "nome_exibicao", "reabrir", "salvar"]);
  for (const chave of chaves) {
    assert.ok(
      new RegExp(`, "${chave}"\\)`).test(pagina),
      `a operação ${chave} está no mapa mas nenhum ponto da tela a informa`,
    );
  }

  // A transferência e o estorno caem na mensagem geral, que explica o 22P02 sem
  // citar arquivo: é o que o pedido manda fazer quando não se pode determinar.
  const gerais = await read("src/lib/erros.js");
  const generica = gerais.slice(gerais.indexOf('"22P02":'), gerais.indexOf('"22P02":') + 800);
  assert.doesNotMatch(generica, /supabase\/migrations/);
  assert.match(generica, /incompatibilidade de tipo/);
  assert.match(generica, /console do navegador/);
  // ⚠️ A mensagem geral passou a DIZER O QUE FAZER, não só citar o console: a
  // instrução "o erro completo está no console (F12)" não serve para quem opera
  // o sistema. O console continua citado, mas como recado de quem vai corrigir.
  assert.match(generica, /O QUE FAZER/);
  assert.match(generica, /nada foi gravado ou alterado/);
  assert.match(generica, /avise quem administra o sistema/);

  // E cada ponto de chamada declara o que estava tentando fazer.
  assert.match(pagina, /mensagemFalhaFase2\(falha, "Não foi possível definir a conta destes pagamentos\.", "definir_conta"\)/);
  assert.match(pagina, /mensagemFalhaFase1\(falha, "Não foi possível salvar a programação\.", "salvar"\)/);
  assert.match(pagina, /mensagemFalhaFase1\(error, "Não foi possível marcar como em análise\.", "em_analise"\)/);
  assert.match(pagina, /mensagemFalhaFase2\(falha, "Não foi possível aprovar a programação\.", "aprovar"\)/);
});

test("os três caminhos da tela chamam a mesma função do banco", async () => {
  const dados = await read(DADOS_LIB);
  assert.match(dados, /supabase\.rpc\("definir_conta_origem_pagamento"/);
  // Um único ponto de entrada: atribuir aos selecionados, aplicar a todos e a
  // escolha individual mudam só a lista de ids.
  assert.equal((await read(DADOS_LIB)).match(/definir_conta_origem_pagamento/g).length, 1);
  const painel = await read("src/components/pagamentos/PainelExecucaoProgramacao.jsx");
  assert.match(painel, /Atribuir conta aos selecionados/);
  assert.match(painel, /Aplicar conta a todos/);
});

// ---------------------------------------------------------------------------
// 3. POSTGRES DE VERDADE: os seis ensaios obrigatórios
// ---------------------------------------------------------------------------

const OPERADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// A estrutura legada da produção: public.pagamentos.situacao é ENUM, e é essa a
// coluna que fazia `coalesce(situacao, '')` estourar com 22P02.
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

-- situacao em ENUM: a coluna legada que derrubava a atribuição de conta.
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
  (9, 'Distribuidora Norte Ltda.', 1);
insert into public.contas_bancarias (id, nome_conta, numero_conta, secretaria_id) values
  (11, 'FUNDEB', '2.042-7', 1),
  (12, 'MERENDA', '1.001-9', 1),
  (13, 'DESATIVADA', '9.999-0', 1);
update public.contas_bancarias set ativo = false where id = 13;
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
];

/**
 * @param {{ legado?: boolean }} opcoes legado=true instala a versão que estava
 *   no banco de produção (a do defeito), sem a blindagem.
 */
async function abrirBanco({ legado = false } = {}) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  // Os resolvedores de id de usuário, como estão aplicados no banco.
  for (const ajudante of ["usuario_registro_id", "usuario_para_coluna", "rastro_do_login"]) {
    await db.exec(funcaoDaMigration(MIGRATION_DEFEITO, ajudante));
  }
  // A conferência de fornecedor que o salvamento usa, também a de verdade.
  await db.exec(funcaoDaMigration(MIGRATION_FORNECEDORES, "fornecedor_referenciavel"));
  await db.exec(funcaoDaMigration(MIGRATION_FASE_2, "pode_em_pagamentos_fase2"));
  // Salvar, marcar em análise e aprovar, as de verdade e já corrigidas.
  await db.exec(readFileSync(join(RAIZ, MIGRATION_APROVACAO), "utf8"));
  await db.exec(funcaoDaMigration(MIGRATION_SALVAR, "salvar_planejamento_programacao"));
  await db.exec(DADOS);
  await db.exec(
    legado
      ? funcaoDaMigration(MIGRATION_DEFEITO, "definir_conta_origem_pagamento")
      : readFileSync(join(RAIZ, MIGRATION), "utf8"),
  );
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

const aprovar = (db, id = 50) =>
  db.query("select public.aprovar_programacao_pagamento($1, null, null, null) as r", [id]);

const definirConta = (db, ids, conta, id = 50) =>
  db.query("select public.definir_conta_origem_pagamento($1, $2::int[], $3) as r", [id, ids, conta]);

const idsDosItens = async (db, id = 50) =>
  (await db.query("select id from public.pagamentos where programacao_id = $1 order by id", [id])).rows.map((l) => l.id);

/** Como a tela relê depois de recarregar: direto da tabela. */
const contasGravadas = async (db, id = 50) =>
  (
    await db.query(
      "select id, conta_origem_id, situacao::text as situacao from public.pagamentos where programacao_id = $1 order by id",
      [id],
    )
  ).rows;

/** O contador "com conta definida" da tela, contado pelo banco. */
const comContaDefinida = async (db, id = 50) =>
  Number(
    (
      await db.query(
        "select count(*) as n from public.pagamentos where programacao_id = $1 and excluido_em is null and conta_origem_id is not null",
        [id],
      )
    ).rows[0].n,
  );

/** Tudo que representa dinheiro. Nada disto pode mudar ao definir conta. */
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
  return idsDosItens(db);
}

test("o defeito relatado: a versão antiga recusa TODA atribuição de conta com 22P02", async (t) => {
  const db = await abrirBanco({ legado: true });
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    await assert.rejects(
      () => definirConta(db, [ids[0]], 11),
      (erro) => {
        // É a recusa exata que a tela mostrava, e ela não depende dos dados:
        // acontece na montagem da comparação, antes de olhar um pagamento.
        assert.equal(erro.code ?? erro.fields?.C, "22P02");
        assert.match(String(erro.message), /situacao_pagamento/);
        return true;
      },
      "a versão antiga tinha de falhar -- é o defeito que esta migration corrige",
    );
  } finally {
    await db.close();
  }
});

test("1. atribuir conta aos selecionados funciona e persiste depois de recarregar", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    const selecionados = [ids[0], ids[2]];

    const resposta = (await definirConta(db, selecionados, 11)).rows[0].r;
    assert.equal(resposta.ok, true);
    assert.equal(resposta.pagamentos_atualizados, 2);
    assert.equal(resposta.conta_origem_id, 11);
    assert.equal(resposta.debitou_conta, false);

    // "Recarregar" é reler a tabela: é daqui que a tela remonta a lista.
    const gravadas = await contasGravadas(db);
    assert.deepEqual(
      gravadas.map((linha) => linha.conta_origem_id),
      [11, null, 11],
      "a conta só pode ficar nos pagamentos selecionados",
    );
    // Nenhuma situação mudou: definir conta não paga nada. PROGRAMADO != PAGO.
    assert.deepEqual(gravadas.map((linha) => linha.situacao), ["programado", "programado", "programado"]);
  } finally {
    await db.close();
  }
});

test("2. aplicar conta a todos funciona", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    const resposta = (await definirConta(db, ids, 12)).rows[0].r;
    assert.equal(resposta.pagamentos_atualizados, 3);
    const gravadas = await contasGravadas(db);
    assert.deepEqual(gravadas.map((linha) => linha.conta_origem_id), [12, 12, 12]);
  } finally {
    await db.close();
  }
});

test("3. definir conta individualmente funciona, e trocar ou retirar também", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);

    await definirConta(db, [ids[1]], 11);
    assert.deepEqual((await contasGravadas(db)).map((l) => l.conta_origem_id), [null, 11, null]);

    // Trocar a conta de um item só troca aquele item.
    await definirConta(db, [ids[1]], 12);
    assert.deepEqual((await contasGravadas(db)).map((l) => l.conta_origem_id), [null, 12, null]);

    // Retirar a conta (conta nula) é operação legítima e continua valendo.
    const retirada = (await definirConta(db, [ids[1]], null)).rows[0].r;
    assert.equal(retirada.conta_origem_id, null);
    assert.deepEqual((await contasGravadas(db)).map((l) => l.conta_origem_id), [null, null, null]);
  } finally {
    await db.close();
  }
});

test("4. o contador \"com conta definida\" acompanha o banco a cada passo", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    assert.equal(await comContaDefinida(db), 0);

    await definirConta(db, [ids[0]], 11);
    assert.equal(await comContaDefinida(db), 1);

    await definirConta(db, [ids[1], ids[2]], 12);
    assert.equal(await comContaDefinida(db), 3);

    // Repetir a mesma atribuição não infla o contador.
    await definirConta(db, [ids[1], ids[2]], 12);
    assert.equal(await comContaDefinida(db), 3);

    // Retirar volta a contagem, sem deixar sobra.
    await definirConta(db, ids, null);
    assert.equal(await comContaDefinida(db), 0);
  } finally {
    await db.close();
  }
});

test("5. salvar, marcar em análise e aprovar continuam funcionando depois da migration", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    // Salvar.
    const salvo = (await salvar(db)).rows[0].r;
    assert.equal(salvo.ok, true);
    assert.equal((await idsDosItens(db)).length, 3);

    // Marcar em análise.
    const analise = (await db.query("select public.marcar_programacao_em_analise($1) as r", [50])).rows[0].r;
    assert.equal(analise.ok, true);
    assert.equal(
      (await db.query("select status::text as s from public.programacoes_pagamento where id = 50")).rows[0].s,
      "em_analise",
    );

    // Aprovar.
    const aprovada = (await aprovar(db)).rows[0].r;
    assert.equal(aprovada.ok, true);
    assert.equal(
      (await db.query("select status::text as s from public.programacoes_pagamento where id = 50")).rows[0].s,
      "aprovada",
    );

    // E definir a conta em seguida, no mesmo banco, também.
    const ids = await idsDosItens(db);
    assert.equal((await definirConta(db, ids, 11)).rows[0].r.pagamentos_atualizados, 3);

    // E salvar de novo não apaga a conta já definida: o salvamento não escreve
    // em conta_origem_id, e continua não escrevendo.
    await salvar(db, ids.map((identificador, ordem) => ({ id: identificador, ...ITENS[ordem] })));
    assert.deepEqual((await contasGravadas(db)).map((linha) => linha.conta_origem_id), [11, 11, 11]);
  } finally {
    await db.close();
  }
});

test("6. definir conta não altera saldo nenhum", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    const antes = await retratoDoDinheiro(db);

    await definirConta(db, [ids[0], ids[1]], 11);
    await definirConta(db, [ids[2]], 12);
    await definirConta(db, [ids[0]], null);

    const depois = await retratoDoDinheiro(db);
    // Saldo real, conta bancária, saldo congelado, rateio, valor do item,
    // situação e o cabeçalho da programação: tudo idêntico.
    assert.deepEqual(depois, antes, "definir conta movimentou algo que representa dinheiro");

    // E a trilha registra explicitamente que nada foi debitado.
    const eventos = (
      await db.query(
        "select valor_novo from public.auditoria_eventos where registro_afetado like 'Conta de pagamento%' order by id",
      )
    ).rows;
    assert.equal(eventos.length, 3);
    for (const evento of eventos) {
      assert.equal(evento.valor_novo.debitou_conta, false);
    }
  } finally {
    await db.close();
  }
});

test("as recusas de negócio continuam em pé, e nenhuma delas vira 22P02", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);

    // Conta desativada.
    await assert.rejects(() => definirConta(db, ids, 13), /desativada/i);
    // Conta que não está entre as contas de trabalho da programação.
    await db.exec("insert into public.contas_bancarias (id, nome_conta, secretaria_id) values (14, 'OUTRA', 1)");
    await assert.rejects(() => definirConta(db, ids, 14), /contas de trabalho/i);
    // Conta de outra secretaria.
    await db.exec("insert into public.secretarias values (2, 'Saúde')");
    await db.exec("insert into public.contas_bancarias (id, nome_conta, secretaria_id) values (15, 'SAUDE', 2)");
    await assert.rejects(() => definirConta(db, ids, 15), /secretaria da programação/i);
    // Seleção vazia.
    await assert.rejects(() => definirConta(db, [], 11), /ao menos um pagamento/i);
    // Nada foi gravado por nenhuma delas.
    assert.equal(await comContaDefinida(db), 0);

    // Programação ainda não aprovada não aceita conta.
    await db.exec("insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status) values (80, 1, '2026-09-11', 'em_elaboracao')");
    await salvar(db, ITENS.slice(0, 1), 80);
    const outros = await idsDosItens(db, 80);
    await assert.rejects(() => definirConta(db, outros, 11, 80), /depois da aprovação/i);

    // Programação fechada continua intocável.
    await db.exec("update public.programacoes_pagamento set fechado = true where id = 50");
    await assert.rejects(() => definirConta(db, ids, 11), /fechadas não podem ser alteradas/i);
  } finally {
    await db.close();
  }
});

test("sem permissão de editar em pagamentos, o banco recusa a atribuição de conta", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    await db.exec(`update public.permissoes_efetivas set pode_editar = false where usuario_id = '${OPERADOR}'`);
    await assert.rejects(() => definirConta(db, ids, 11), /permissão para definir a conta/i);
    assert.equal(await comContaDefinida(db), 0);
  } finally {
    await db.close();
  }
});

test("a porta da Fase 2 responde igual com as permissões em coluna de texto", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    // É o cenário legado: a matriz de permissões guardada como texto. A versão
    // anterior de pode_em_pagamentos_fase2 era recusada com 42804 aqui, e isso
    // fechava aprovar, executar, definir conta, transferir e estornar de uma vez.
    await db.exec(`
      alter table public.permissoes_efetivas alter column pode_editar type text using pode_editar::text;
      alter table public.permissoes_efetivas alter column pode_aprovar type text using pode_aprovar::text;
    `);
    assert.equal((await definirConta(db, ids, 11)).rows[0].r.pagamentos_atualizados, 3);

    await db.exec(`update public.permissoes_efetivas set pode_editar = 'false' where usuario_id = '${OPERADOR}'`);
    await assert.rejects(() => definirConta(db, ids, 12), /permissão para definir a conta/i);
  } finally {
    await db.close();
  }
});

test("o erro inesperado diz a etapa e o tipo real das colunas", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    // Um gatilho que estoura sem ser recusa de negócio: é o caminho que antes
    // chegava à tela como 22P02 pelado.
    await db.exec(`
      create or replace function public.quebrar() returns trigger language plpgsql as $x$
      begin
        perform 1 / 0;
        return new;
      end $x$;
      create trigger quebrar_conta before update on public.pagamentos
        for each row execute function public.quebrar();
    `);
    await assert.rejects(
      () => definirConta(db, ids, 11),
      (erro) => {
        const detalhe = String(erro.detail ?? erro.fields?.D ?? "");
        assert.match(String(erro.message), /gravação da conta de origem nos pagamentos/);
        assert.match(detalhe, /etapa=gravação da conta de origem nos pagamentos/);
        // O tipo REAL de cada coluna suspeita, lido do catálogo.
        assert.match(detalhe, /pagamentos\.situacao=situacao_pagamento/);
        assert.match(detalhe, /pagamentos\.conta_origem_id=integer/);
        assert.match(detalhe, /programacoes_pagamento\.fechado=boolean/);
        return true;
      },
    );
  } finally {
    await db.close();
  }
});

test("sem a coluna conta_origem_id o banco devolve 42703, que a tela sabe traduzir", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);
  try {
    const ids = await prepararAprovada(db);
    await db.exec("alter table public.pagamentos drop column conta_origem_id");
    await assert.rejects(
      () => definirConta(db, ids, 11),
      (erro) => {
        assert.equal(erro.code ?? erro.fields?.C, "42703");
        // 42703 é o que a tela classifica como falta de estrutura -- e é assim
        // que ela chega a apontar a migration que cria a coluna, em vez de
        // mandar rodar a da aprovação.
        assert.equal(classificarFalhaFase1({ code: "42703" }).tipo, "estrutura");
        return true;
      },
    );
    assert.equal(
      (await db.query("select public.tipo_da_coluna('pagamentos', 'conta_origem_id') as t")).rows[0].t,
      "coluna ausente",
    );
  } finally {
    await db.close();
  }
});
