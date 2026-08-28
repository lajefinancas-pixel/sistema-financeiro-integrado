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
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado o
 * teste é PULADO, e a suíte continua passando sem dependência nova. Para
 * rodá-lo: `npm i -D @electric-sql/pglite`.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const MIGRATION = join(RAIZ, "supabase/migrations/20260829120000_baixas_pagamentos_por_nota.sql");
const ANTERIOR = join(AQUI, "fixtures/baixasEstruturaAnterior.sql");
const AJUDANTES = join(RAIZ, "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql");

const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AUXILIAR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** As duas funções de que a migration depende, lidas da migration que as criou. */
function ajudantes() {
  const src = readFileSync(AJUDANTES, "utf8");
  return ["public.usuario_registro_id()", "public.usuario_para_coluna(p_tabela text, p_coluna text)"]
    .map((nome) => {
      const i = src.indexOf(`create or replace function ${nome}`);
      assert.notEqual(i, -1, `${nome} deveria existir na migration que a criou`);
      return src.slice(i, src.indexOf("$$;", src.indexOf("as $$", i)) + 3);
    })
    .join("\n\n");
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

async function abrirBanco() {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(readFileSync(ANTERIOR, "utf8"));
  await db.exec(ajudantes());
  // Os dados já existem no banco quando a migration roda -- é o que revela se
  // o seed do módulo novo esbarra em alguma restrição.
  await db.exec(DADOS);
  await db.exec(readFileSync(MIGRATION, "utf8"));
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

  await t.test("a migration é idempotente", async () => {
    await db.exec(readFileSync(MIGRATION, "utf8"));
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
    assert.deepEqual(await nota(), { valor_pago: "400.00", situacao: "parcialmente_pago", aberto: "600.00" });
    assert.equal(await fotoDoSaldo(), saldoInicial, "a baixa não pode mexer no saldo");
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
    assert.deepEqual(await nota(), { valor_pago: "400.00", situacao: "parcialmente_pago", aberto: "600.00" });

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

  await t.test("o saldo terminou exatamente como começou", async () => {
    assert.equal(await fotoDoSaldo(), saldoInicial);
  });

  await db.close();
});
