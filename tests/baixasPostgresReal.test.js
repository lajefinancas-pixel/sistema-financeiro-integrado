import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * A baixa de ponta a ponta em POSTGRES DE VERDADE.
 *
 * Os outros testes de baixa exercitam as regras em JavaScript. Este roda a
 * migration `20260829120000_baixas_pagamentos_por_nota.sql` verbatim e chama
 * `registrar_baixa_nota` / `estornar_baixa_nota` de fato, num Postgres em
 * memória (PGlite). Foi ele que pegou duas falhas que nenhum teste de regra
 * pegaria:
 *
 *   1. o seed do módulo 'baixas' rodava ANTES de a restrição de lista fixa de
 *      módulos ser relaxada, e a migration inteira abortava;
 *   2. `on conflict (chave_idempotencia)` não inferia o índice único, porque o
 *      índice é PARCIAL -- toda baixa falhava com 42P10.
 *   3. `valores_em_aberto.situacao` é o ENUM situacao_valor no banco em uso, e
 *      não texto: a validação da estrutura abortava, e a gravação da situação
 *      nova não seria aceita. O ensaio antigo não pegou porque a estrutura
 *      reconstruída usava uma coluna de texto.
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado o
 * teste é PULADO, e a suíte continua passando sem dependência nova. Para
 * rodá-lo: `npm i -D @electric-sql/pglite`.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const MIGRATION = join(RAIZ, "supabase/migrations/20260829120000_baixas_pagamentos_por_nota.sql");
const ANTERIOR = join(AQUI, "fixtures/baixasEstruturaAnterior.sql");

const PADRONIZACAO = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";
const DIAGNOSTICO = "supabase/migrations/20260828230000_diagnosticar_transferencia_entre_contas.sql";
const CORRECAO_RPC = "supabase/migrations/20260922120000_corrigir_funcoes_baixa_pagamentos.sql";

/**
 * As funções que a migration de baixas USA e NÃO CRIA, cada uma lida da
 * migration que a criou -- e não de uma cópia escrita aqui, para o ensaio rodar
 * contra a mesma função que está em produção.
 *
 * `tipo_da_coluna` está nesta lista de propósito: a versão de produção devolve
 * o texto 'coluna ausente' quando a coluna não existe, e o tratador de erros de
 * confirmar_transferencias_programacao depende disso. A migration de baixas não
 * a recria para não quebrar esse tratador.
 */
const AJUDANTES = [
  [PADRONIZACAO, "public.usuario_registro_id()"],
  [PADRONIZACAO, "public.usuario_para_coluna(p_tabela text, p_coluna text)"],
  [DIAGNOSTICO, "public.tipo_da_coluna(p_tabela text, p_coluna text)"],
];

const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AUXILIAR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function ajudantes() {
  return AJUDANTES.map(([arquivo, nome]) => {
    const src = readFileSync(join(RAIZ, arquivo), "utf8");
    const i = src.indexOf(`create or replace function ${nome}`);
    assert.notEqual(i, -1, `${nome} deveria existir na migration que a criou`);
    return src.slice(i, src.indexOf("$$;", src.indexOf("as $$", i)) + 3);
  }).join("\n\n");
}

const DADOS = `
  insert into public.secretarias (id, nome) values (1, 'Finanças');
  insert into public.bancos (id, nome) values (1, 'Banco do Brasil');
  insert into public.perfis_acesso (id, nome) values
    ('11111111-1111-1111-1111-111111111111', 'Administrador'),
    ('22222222-2222-2222-2222-222222222222', 'Consulta');
  insert into public.perfis_permissoes (perfil_id, modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar)
    values ('11111111-1111-1111-1111-111111111111', 'pagamentos', true, true, true, true, true);
  insert into auth.users (id) values ('${ADMIN}'), ('${AUXILIAR}');
  insert into public.usuarios (id, auth_id, nome_completo, status, perfil_id) values
    ('99999999-9999-9999-9999-999999999999', '${ADMIN}', 'Tesoureira', 'ativo', '11111111-1111-1111-1111-111111111111'),
    ('88888888-8888-8888-8888-888888888888', '${AUXILIAR}', 'Auxiliar', 'ativo', '22222222-2222-2222-2222-222222222222');
  insert into public.fornecedores (id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id)
    values (7, 'Construtora Alfa LTDA', 'Alfa', '12345678000199', 1);
  insert into public.contas_bancarias (id, nome_conta, numero_conta, banco_id, secretaria_id, saldo_atual)
    values (3, 'Conta Movimento', '00123-4', 1, 1, 250000.00);
  insert into public.valores_em_aberto (id, fornecedor_id, numero_nota_fiscal, data_nota_fiscal, valor, data_vencimento, situacao)
    values (55, 7, '1234', '2026-08-01', 1000.00, '2026-09-10', 'em_aberto');
  select setval(pg_get_serial_sequence('public.valores_em_aberto','id'), 100);
`;

/** Tabelas e colunas de SALDO: a fotografia que a baixa não pode mudar. */
const TABELAS_DE_SALDO = ["saldos_historico", "pagamento_movimentacoes", "transferencias_contas", "transferencia_lotes"];

/** Os seis rótulos do enum situacao_valor, na ordem em que existem no banco. */
const ROTULOS = ["em_aberto", "programado", "parcialmente_pago", "pago", "suspenso", "cancelado"];

const COLUNA_ENUM = "situacao public.situacao_valor not null default 'em_aberto',";
const COLUNA_TEXTO = "situacao text not null default 'em_aberto',";

/**
 * A situação da nota não é a única coluna que pode ser enum. usuarios.status é
 * comparado com 'ativo' e auditoria_eventos.nivel recebe 'atencao'/'critico':
 * este trecho troca as duas por enums para o ensaio passar por elas também.
 */
const OUTROS_ENUMS = ({ nivel = ["info", "atencao", "critico"] } = {}) => [
  [
    "create table public.perfis_acesso (",
    `create type public.usuario_status as enum ('ativo', 'inativo');
create type public.nivel_evento as enum (${nivel.map((n) => `'${n}'`).join(", ")});

create table public.perfis_acesso (`,
  ],
  ["  status text not null default 'ativo',", "  status public.usuario_status not null default 'ativo',"],
  ["  nivel text,", "  nivel public.nivel_evento,"],
];

/**
 * A estrutura anterior, com a situação da nota como ENUM (o banco em uso) ou
 * como TEXTO (banco novo, e a única variação que a migration também aceita).
 * `rotulos` permite tirar um valor do enum para ver a migration abortar.
 */
function estruturaAnterior({ situacao = "enum", rotulos = ROTULOS, outrosEnums = null } = {}) {
  let sql = readFileSync(ANTERIOR, "utf8");

  assert.ok(sql.includes(COLUNA_ENUM), "a estrutura do ensaio precisa declarar situacao como enum");
  if (situacao === "texto") sql = sql.replace(COLUNA_ENUM, COLUNA_TEXTO);

  if (outrosEnums) {
    for (const [de, para] of OUTROS_ENUMS(outrosEnums)) {
      assert.ok(sql.includes(de), `a estrutura do ensaio precisa conter: ${de}`);
      sql = sql.replace(de, para);
    }
  }

  const enumOriginal = /create type public\.situacao_valor as enum \([\s\S]*?\);/;
  assert.match(sql, enumOriginal, "a estrutura do ensaio precisa criar o enum situacao_valor");
  sql = sql.replace(
    enumOriginal,
    `create type public.situacao_valor as enum (${rotulos.map((r) => `'${r}'`).join(", ")});`,
  );
  return sql;
}

async function abrirBanco(opcoes = {}) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(estruturaAnterior(opcoes));
  await db.exec(ajudantes());
  // Os dados já existem no banco quando a migration roda -- é o que revela se
  // o seed do módulo novo esbarra em alguma restrição.
  await db.exec(DADOS);
  if (opcoes.rodarMigration !== false) await db.exec(readFileSync(MIGRATION, "utf8"));
  await db.exec(`set ensaio.auth_uid = '${ADMIN}'`);
  return db;
}

test("baixa parcial e integral de ponta a ponta em Postgres real, sem tocar o saldo", async (t) => {
  const db = await abrirBanco();
  if (!db) return t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

  const fotoDoSaldo = async () => {
    const contas = await db.query("select id, saldo_atual::text from public.contas_bancarias order by id");
    const tabelas = {};
    for (const tabela of TABELAS_DE_SALDO) {
      tabelas[tabela] = (await db.query(`select count(*)::int as n from public.${tabela}`)).rows[0].n;
    }
    return JSON.stringify({ contas: contas.rows, tabelas });
  };
  const nota = async () =>
    (await db.query(
      "select valor_pago::text, situacao, (valor - valor_pago)::text as aberto from public.valores_em_aberto where id = 55",
    )).rows[0];
  const baixas = async () =>
    (await db.query(
      "select id::text, valor_pago::text, status, motivo_estorno from public.pagamentos_baixas order by criado_em",
    )).rows;
  const registrar = (chave, valor, extra = {}) =>
    db.query("select public.registrar_baixa_nota($1,$2,$3,$4,$5,$6) as r", [
      chave, extra.notaId ?? "55", valor, extra.data ?? "2026-08-20", extra.contaId ?? 3, extra.observacao ?? null,
    ]);

  const saldoInicial = await fotoDoSaldo();

  await t.test("a situação da nota é o ENUM situacao_valor, não texto", async () => {
    // A guarda deste ensaio: com uma coluna de texto ele passaria sem exercitar
    // nada do que o enum exige.
    const { rows } = await db.query(
      "select pg_typeof(situacao)::text as tipo from public.valores_em_aberto where id = 55",
    );
    assert.equal(rows[0].tipo, "situacao_valor");
    const { rows: labels } = await db.query(
      "select enumlabel::text as r from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'situacao_valor' order by e.enumsortorder",
    );
    assert.deepEqual(labels.map((l) => l.r), ROTULOS);
  });

  await t.test("a migration é idempotente", async () => {
    await db.exec(readFileSync(MIGRATION, "utf8"));
  });

  await t.test("a migration preserva a public.tipo_da_coluna que já existia", async () => {
    // A versão de produção responde 'coluna ausente' em vez de levantar
    // exceção. É disso que o tratador de erros de
    // confirmar_transferencias_programacao depende, e rodar a migration de
    // baixas não pode trocar esse comportamento.
    const { rows } = await db.query(
      "select public.tipo_da_coluna('valores_em_aberto', 'coluna_que_nao_existe') as t",
    );
    assert.equal(rows[0].t, "coluna ausente");
  });

  await t.test("o módulo 'baixas' nasce semeado na Matriz de Permissões", async () => {
    const { rows } = await db.query(
      "select modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_aprovar, pode_excluir from public.perfis_permissoes where modulo = 'baixas'",
    );
    assert.equal(rows.length, 2, "todo perfil precisa de linha do módulo novo");
    // Administrador copia o que já tinha em 'pagamentos'; Consulta não tinha nada.
    assert.deepEqual(rows.filter((r) => r.pode_visualizar).length, 1);
    for (const acao of ["visualizar", "registrar_baixa", "imprimir", "exportar", "estornar_baixa"]) {
      const { rows: pode } = await db.query("select public.pode_em_baixas($1) as pode", [acao]);
      assert.equal(pode[0].pode, true, `o Administrador deveria poder ${acao}`);
    }
  });

  await t.test("baixa PARCIAL de R$ 400,00 numa nota de R$ 1.000,00", async () => {
    const { rows } = await registrar("chave-parcial-0001", 400, { observacao: "Pagamento parcial via TED" });
    assert.equal(rows[0].r.ok, true);
    assert.equal(rows[0].r.quitada, false);
    assert.equal(rows[0].r.movimentou_saldo, false);
    // Parcial NÃO muda a situação: o abatimento fica em valor_pago e o em
    // aberto continua sendo valor - valor_pago.
    assert.deepEqual(await nota(), { valor_pago: "400.00", situacao: "em_aberto", aberto: "600.00" });
    assert.equal(await fotoDoSaldo(), saldoInicial, "a baixa não pode mexer no saldo");
  });

  await t.test("a situação que a nota tinha é guardada como TEXTO na baixa", async () => {
    // A origem é enum e o destino é texto: a conversão tem de ser explícita, e o
    // que fica gravado é o rótulo.
    const { rows } = await db.query(
      "select situacao_anterior, pg_typeof(situacao_anterior)::text as tipo from public.pagamentos_baixas order by criado_em limit 1",
    );
    assert.deepEqual(rows[0], { situacao_anterior: "em_aberto", tipo: "text" });
  });

  await t.test("confirmar a MESMA baixa outra vez não registra nem abate de novo", async () => {
    const { rows } = await registrar("chave-parcial-0001", 400, { observacao: "Pagamento parcial via TED" });
    assert.equal(rows[0].r.ja_registrada, true);
    assert.equal((await baixas()).length, 1);
    assert.equal((await nota()).valor_pago, "400.00");
  });

  await t.test("valor acima do em aberto é recusado, em formato de moeda brasileiro", async () => {
    await assert.rejects(() => registrar("chave-excesso", 600.01), (e) => {
      assert.match(e.message, /maior do que o valor em aberto/i);
      assert.match(e.message, /R\$ 600,01/, "a mensagem usa vírgula decimal");
      assert.match(e.message, /R\$ 600,00/);
      return true;
    });
    await db.exec(
      "insert into public.valores_em_aberto (id, fornecedor_id, numero_nota_fiscal, valor, situacao) values (56, 7, '9999', 1234567.89, 'em_aberto')",
    );
    await assert.rejects(() => registrar("chave-milhar", 1234567.9, { notaId: "56" }), (e) => {
      assert.match(e.message, /R\$ 1\.234\.567,89/, "milhar com ponto, centavo com vírgula");
      return true;
    });
    await db.exec("delete from public.valores_em_aberto where id = 56");
  });

  await t.test("nota cancelada não recebe baixas", async () => {
    // A comparação com 'cancelado' é feita sobre o rótulo do enum lido como
    // texto. Se a leitura mudar, é aqui que aparece.
    await db.exec(
      "insert into public.valores_em_aberto (id, fornecedor_id, numero_nota_fiscal, valor, situacao) values (57, 7, '7777', 500.00, 'cancelado')",
    );
    await assert.rejects(() => registrar("chave-cancelada", 100, { notaId: "57" }), /cancelada/i);
    assert.equal((await baixas()).length, 1, "a nota cancelada não pode gerar registro de baixa");
    await db.exec("delete from public.valores_em_aberto where id = 57");
  });

  await t.test("valor zero é recusado", async () => {
    await assert.rejects(() => registrar("chave-zero", 0), /maior que zero/i);
    assert.equal(await fotoDoSaldo(), saldoInicial);
  });

  await t.test("baixa INTEGRAL do restante quita a nota", async () => {
    const { rows } = await registrar("chave-integral-0002", 600, { data: "2026-08-25", observacao: "Quitação" });
    assert.equal(rows[0].r.quitada, true);
    assert.equal(rows[0].r.movimentou_saldo, false);
    assert.deepEqual(await nota(), { valor_pago: "1000.00", situacao: "pago", aberto: "0.00" });
    assert.equal(await fotoDoSaldo(), saldoInicial, "nem a quitação mexe no saldo");
  });

  await t.test("a nota quitada sai da lista de notas em aberto", async () => {
    const { rows } = await db.query(
      "select id from public.valores_em_aberto where fornecedor_id = 7 and situacao in ('em_aberto','programado','parcialmente_pago','suspenso') and (valor - valor_pago) > 0.004",
    );
    assert.equal(rows.length, 0);
    await assert.rejects(() => registrar("chave-depois", 10), /quitada/i);
  });

  await t.test("o estorno devolve o valor e PRESERVA o registro", async () => {
    const alvo = (await baixas()).find((b) => b.valor_pago === "600.00");
    const { rows } = await db.query("select public.estornar_baixa_nota($1,$2) as r", [alvo.id, "Banco devolveu o pagamento"]);
    assert.equal(rows[0].r.movimentou_saldo, false);
    assert.deepEqual(await nota(), { valor_pago: "400.00", situacao: "em_aberto", aberto: "600.00" });

    const depois = await baixas();
    assert.equal(depois.length, 2, "estorno nunca apaga a baixa");
    const estornada = depois.find((b) => b.id === alvo.id);
    assert.equal(estornada.status, "estornada");
    assert.equal(estornada.valor_pago, "600.00");
    assert.equal(estornada.motivo_estorno, "Banco devolveu o pagamento");
    assert.equal(await fotoDoSaldo(), saldoInicial);

    // Estornar de novo não devolve o valor duas vezes.
    const repetido = await db.query("select public.estornar_baixa_nota($1,$2) as r", [alvo.id, "outra tentativa"]);
    assert.equal(repetido.rows[0].r.ja_estornada, true);
    assert.equal((await nota()).aberto, "600.00");
  });

  await t.test("estorno sem justificativa é recusado", async () => {
    const viva = (await baixas()).find((b) => b.status !== "estornada");
    await assert.rejects(
      () => db.query("select public.estornar_baixa_nota($1,$2) as r", [viva.id, "   "]),
      /justificativa|motivo/i,
    );
  });

  await t.test("a recusa que vale é a do banco, não a da tela", async () => {
    await db.exec(`set ensaio.auth_uid = '${AUXILIAR}'`);
    const { rows } = await db.query(
      "select public.pode_em_baixas('estornar_baixa') as estornar, public.pode_em_baixas('registrar_baixa') as registrar",
    );
    assert.deepEqual(rows[0], { estornar: false, registrar: false });

    const viva = (await baixas()).find((b) => b.status !== "estornada");
    await assert.rejects(
      () => db.query("select public.estornar_baixa_nota($1,$2) as r", [viva.id, "sem permissão"]),
      /permissão/i,
    );
    await assert.rejects(() => registrar("chave-sem-permissao", 10), /permissão/i);
    await db.exec(`set ensaio.auth_uid = '${ADMIN}'`);
  });

  await t.test("a concessão avulsa soma, nunca subtrai", async () => {
    await db.exec(
      "insert into public.permissoes_especiais (usuario_id, acao, permitido) values ('99999999-9999-9999-9999-999999999999', 'estornar_baixa', false)",
    );
    const { rows } = await db.query("select public.pode_em_baixas('estornar_baixa') as pode");
    assert.equal(rows[0].pode, true, "o false avulso não pode derrubar o que a Matriz concedeu");
  });

  await t.test("cada baixa e cada estorno deixam evento na auditoria", async () => {
    const { rows } = await db.query(
      "select acao, nivel, valor_novo->>'movimentou_saldo' as movimentou from public.auditoria_eventos order by criado_em",
    );
    assert.equal(rows.filter((e) => e.acao === "registrou_baixa").length, 2);
    assert.equal(rows.filter((e) => e.acao === "estornou_baixa").length, 1);
    assert.deepEqual([...new Set(rows.map((e) => e.nivel))].sort(), ["atencao", "critico"]);
    assert.ok(rows.every((e) => e.movimentou === "false"), "o evento registra que não houve movimentação de saldo");
  });

  await t.test("a baixa nunca grava 'parcialmente_pago', mesmo existindo no enum", async () => {
    // A regra combinada: parcial mantém 'em_aberto', só a quitação grava
    // 'pago'. O rótulo existe no tipo e continua sem uso.
    const { rows } = await db.query(
      "select distinct situacao::text as situacao from public.valores_em_aberto order by 1",
    );
    assert.deepEqual(rows.map((r) => r.situacao), ["em_aberto"]);
    const { rows: registradas } = await db.query(
      "select distinct situacao_anterior from public.pagamentos_baixas order by 1",
    );
    assert.deepEqual(registradas.map((r) => r.situacao_anterior), ["em_aberto"]);
  });

  await t.test("o saldo terminou exatamente como começou", async () => {
    assert.equal(await fotoDoSaldo(), saldoInicial);
  });

  await db.close();
});

test("a mesma migration continua servindo um banco em que situacao é TEXTO", async (t) => {
  // Bancos novos nascem com a coluna de texto. A migration não pode passar a
  // exigir enum para funcionar: a conversão da situação nova é feita para o tipo
  // REAL da coluna, seja ele qual for.
  const db = await abrirBanco({ situacao: "texto" });
  if (!db) return t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

  const nota = async () =>
    (await db.query("select valor_pago::text, situacao::text as situacao from public.valores_em_aberto where id = 55")).rows[0];
  const registrar = (chave, valor) =>
    db.query("select public.registrar_baixa_nota($1,$2,$3,$4,$5,$6) as r", [chave, "55", valor, "2026-08-20", 3, null]);

  assert.equal(
    (await db.query("select pg_typeof(situacao)::text as tipo from public.valores_em_aberto where id = 55")).rows[0].tipo,
    "text",
  );

  await registrar("texto-parcial", 400);
  assert.deepEqual(await nota(), { valor_pago: "400.00", situacao: "em_aberto" });

  await registrar("texto-quitacao", 600);
  assert.deepEqual(await nota(), { valor_pago: "1000.00", situacao: "pago" });

  const alvo = (await db.query("select id::text from public.pagamentos_baixas where valor_pago = 600.00")).rows[0];
  await db.query("select public.estornar_baixa_nota($1,$2) as r", [alvo.id, "Banco devolveu o pagamento"]);
  assert.deepEqual(await nota(), { valor_pago: "400.00", situacao: "em_aberto" });

  await db.close();
});

test("enum sem os valores que a baixa grava aborta a migration, dizendo qual falta", async (t) => {
  // A gravação só usa 'em_aberto' e 'pago'. Faltando um deles no enum, a baixa
  // quebraria na primeira nota -- então a migration recusa a rodar e diz o que
  // acrescentar, antes de qualquer DDL.
  const db = await abrirBanco({ rotulos: ["em_aberto", "cancelado"], rodarMigration: false });
  if (!db) return t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

  await assert.rejects(() => db.exec(readFileSync(MIGRATION, "utf8")), (e) => {
    assert.match(e.message, /Enum incompat/i);
    assert.match(e.message, /valores_em_aberto\.situacao/);
    assert.match(e.message, /\bpago\b/, "a mensagem tem de dizer qual valor falta");
    assert.match(e.message, /alter type/i, "e o que fazer para resolver");
    return true;
  });

  // Abortou ANTES do primeiro DDL: nada da migration ficou pela metade. O
  // `begin;` da migration deixou a sessão numa transação abortada, e é ela que
  // se desfaz aqui antes de olhar o banco.
  await db.exec("rollback");
  const { rows } = await db.query("select to_regclass('public.pagamentos_baixas') is null as ausente");
  assert.equal(rows[0].ausente, true);

  await db.close();
});

test("as outras colunas de enum que a baixa toca: status do usuário e nível do evento", async (t) => {
  // A situação da nota não é a única. `pode_em_baixas` compara usuarios.status
  // com 'ativo' e cada baixa grava 'atencao'/'critico' em auditoria_eventos.nivel.
  // Com as duas como enum, a migration e a baixa têm de rodar igual.
  const db = await abrirBanco({ outrosEnums: {} });
  if (!db) return t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

  const tipos = await db.query("select pg_typeof(status)::text as status from public.usuarios limit 1");
  assert.equal(tipos.rows[0].status, "usuario_status");

  assert.equal((await db.query("select public.pode_em_baixas('registrar_baixa') as pode")).rows[0].pode, true);

  await db.query("select public.registrar_baixa_nota($1,$2,$3,$4,$5,$6) as r", [
    "enums-parcial", "55", 400, "2026-08-20", 3, null,
  ]);
  const alvo = (await db.query("select id::text from public.pagamentos_baixas order by criado_em limit 1")).rows[0];
  await db.query("select public.estornar_baixa_nota($1,$2) as r", [alvo.id, "Banco devolveu o pagamento"]);

  const { rows } = await db.query(
    "select acao, nivel::text as nivel, pg_typeof(nivel)::text as tipo from public.auditoria_eventos order by criado_em",
  );
  assert.deepEqual(rows, [
    { acao: "registrou_baixa", nivel: "atencao", tipo: "nivel_evento" },
    { acao: "estornou_baixa", nivel: "critico", tipo: "nivel_evento" },
  ]);

  await db.close();
});

test("nível de evento sem 'critico' também aborta a migration com a mensagem certa", async (t) => {
  // Mesmo tratamento da situação da nota, em outra coluna: sem o rótulo que a
  // baixa grava, a migration recusa a rodar em vez de quebrar no estorno.
  const db = await abrirBanco({ outrosEnums: { nivel: ["info", "atencao"] }, rodarMigration: false });
  if (!db) return t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

  await assert.rejects(() => db.exec(readFileSync(MIGRATION, "utf8")), (e) => {
    assert.match(e.message, /Enum incompat/i);
    assert.match(e.message, /auditoria_eventos\.nivel/);
    assert.match(e.message, /critico/);
    return true;
  });

  await db.exec("rollback");
  assert.equal(
    (await db.query("select to_regclass('public.pagamentos_baixas') is null as ausente")).rows[0].ausente,
    true,
  );

  await db.close();
});

test("correção crítica: nota 296.771 baixa, quita e estorna com saldo no centavo", async (t) => {
  const db = await abrirBanco();
  if (!db) return t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

  await db.exec(`
    create or replace function public.texto_verdadeiro(p_valor text)
    returns boolean language sql immutable as $$
      select lower(trim(coalesce(p_valor, ''))) in ('true','t','1','sim','s','yes','y')
    $$;

    update public.contas_bancarias
       set nome_conta = 'Banco do Brasil 2.042-7 (FPM)'
     where id = 3;
    alter table public.saldos_historico add column data_saldo date;
    create unique index saldos_historico_conta_data_teste
      on public.saldos_historico(conta_id, data_saldo);
    insert into public.saldos_historico(conta_id, valor_saldo, data_saldo)
      values (3, 50000.00, '2026-09-22');
    insert into public.fornecedores
      (id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id)
      values (8, 'AUTO POSTO GLOBO LTDA', 'AUTO POSTO GLOBO', '12345678000270', 1);
    insert into public.valores_em_aberto
      (id, fornecedor_id, numero_nota_fiscal, data_nota_fiscal, valor, data_vencimento, situacao)
      values (296771, 8, '296.771', '2026-09-01', 10079.27, '2026-09-22', 'em_aberto');

    alter table public.pagamentos_baixas
      add column if not exists saldo_antes numeric(14,2),
      add column if not exists saldo_depois numeric(14,2);

    create or replace function public.movimentar_saldo_pela_baixa()
    returns trigger language plpgsql security definer set search_path=public as $fn$
    declare v_saldo numeric(14,2); v_data date;
    begin
      if tg_op='INSERT' and new.status::text='efetivada' then
        select valor_saldo, data_saldo into v_saldo, v_data
          from public.saldos_historico where conta_id=new.conta_id
          order by data_saldo desc, id desc limit 1 for update;
        insert into public.saldos_historico(conta_id,valor_saldo,data_saldo)
          values(new.conta_id,round(v_saldo-new.valor_pago,2),greatest(v_data,new.data_pagamento))
          on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
        update public.pagamentos_baixas set saldo_antes=v_saldo,
          saldo_depois=round(v_saldo-new.valor_pago,2) where id=new.id;
      elsif tg_op='UPDATE' and old.status::text='efetivada' and new.status::text='estornada' then
        select valor_saldo, data_saldo into v_saldo, v_data
          from public.saldos_historico where conta_id=new.conta_id
          order by data_saldo desc, id desc limit 1 for update;
        insert into public.saldos_historico(conta_id,valor_saldo,data_saldo)
          values(new.conta_id,round(v_saldo+new.valor_pago,2),v_data)
          on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
      end if;
      return new;
    end $fn$;
    create trigger pagamentos_baixas_movimentar_saldo
      after insert or update of status on public.pagamentos_baixas
      for each row execute function public.movimentar_saldo_pela_baixa();
  `);

  await db.exec(readFileSync(join(RAIZ, CORRECAO_RPC), "utf8"));
  await db.exec(readFileSync(join(RAIZ, CORRECAO_RPC), "utf8"));

  const argumentos = await db.query(`
    select p.proname, pg_get_function_arguments(p.oid) argumentos
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('registrar_baixa_nota','estornar_baixa_nota')
     order by p.proname
  `);
  assert.match(argumentos.rows[0].argumentos, /p_baixa_id text, p_motivo text/);
  assert.match(argumentos.rows[1].argumentos, /p_chave_idempotencia text, p_valor_em_aberto_id text/);

  const registrar = (chave, valor) => db.query(
    "select public.registrar_baixa_nota($1,$2,$3,$4,$5,$6) r",
    [chave, "296771", valor, "2026-09-22", 3, null],
  );
  const saldo = async () => (await db.query(
    "select valor_saldo::text valor from public.saldos_historico where conta_id=3 order by data_saldo desc,id desc limit 1",
  )).rows[0].valor;
  const nota = async () => (await db.query(
    "select valor_pago::text pago,(valor-valor_pago)::text aberto,situacao::text situacao from public.valores_em_aberto where id=296771",
  )).rows[0];

  await registrar("nota-296771-parcial", 4000.13);
  assert.equal(await saldo(), "45999.87");
  assert.deepEqual(await nota(), { pago: "4000.13", aberto: "6079.14", situacao: "em_aberto" });
  await assert.rejects(() => registrar("nota-296771-excesso", 6079.15), /maior do que o valor em aberto/i);
  assert.equal(await saldo(), "45999.87");

  const quitacao = await registrar("nota-296771-quitacao", 6079.14);
  assert.equal(await saldo(), "39920.73");
  assert.deepEqual(await nota(), { pago: "10079.27", aberto: "0.00", situacao: "pago" });

  await db.query("select public.estornar_baixa_nota($1,$2)", [quitacao.rows[0].r.baixa_id, "Estorno do teste obrigatório"]);
  assert.equal(await saldo(), "45999.87");
  assert.deepEqual(await nota(), { pago: "4000.13", aberto: "6079.14", situacao: "em_aberto" });
  assert.equal((await db.query(
    "select count(*)::int n from public.pagamentos_baixas where id::text=$1 and status::text='estornada'",
    [quitacao.rows[0].r.baixa_id],
  )).rows[0].n, 1);

  await db.close();
});
