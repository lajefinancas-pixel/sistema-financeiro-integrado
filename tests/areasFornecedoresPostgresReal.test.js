import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * As três áreas de Fornecedores em POSTGRES DE VERDADE.
 *
 * Os testes de regra (tests/areasFornecedores.test.js) exercitam o cálculo de
 * Pago e Saldo em JavaScript. Este roda a migration
 * `20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql` verbatim,
 * em cima da estrutura que já existe e da migration de baixas, e responde no
 * banco às perguntas que só o banco responde:
 *
 *   1. o mesmo fornecedor entra nas três áreas, várias vezes, e continua sendo
 *      UM cadastro só -- nenhuma linha nova em public.fornecedores;
 *   2. Pago sai da baixa da NF vinculada (registrar_baixa_nota de verdade) e é
 *      exatamente o valor_pago que a aba de Baixas mostra, sem nenhuma coluna
 *      de valor pago nas seis tabelas novas;
 *   3. quem só pode INATIVAR inativa, e é RECUSADO ao tentar mudar valor ou
 *      situação no mesmo update;
 *   4. inativar não apaga a linha, e `authenticated` não tem delete nos
 *      registros;
 *   5. a lista fixa de módulos é relaxada antes do seed, e a migration roda
 *      duas vezes sem reclamar.
 *
 * O Postgres em memória é opcional: sem `@electric-sql/pglite` instalado o
 * teste é PULADO. Para rodá-lo: `npm i -D @electric-sql/pglite`.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const ANTERIOR = join(AQUI, "fixtures/baixasEstruturaAnterior.sql");
const MIGRATION_BAIXAS = join(RAIZ, "supabase/migrations/20260829120000_baixas_pagamentos_por_nota.sql");
const MIGRATION_AREAS = join(
  RAIZ,
  "supabase/migrations/20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql",
);

const PADRONIZACAO = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";
const DIAGNOSTICO = "supabase/migrations/20260828230000_diagnosticar_transferencia_entre_contas.sql";

/** As funções que a migration de baixas usa e não cria, lidas de onde nasceram. */
const AJUDANTES = [
  [PADRONIZACAO, "public.usuario_registro_id()"],
  [PADRONIZACAO, "public.usuario_para_coluna(p_tabela text, p_coluna text)"],
  [DIAGNOSTICO, "public.tipo_da_coluna(p_tabela text, p_coluna text)"],
];

function ajudantes() {
  return AJUDANTES.map(([arquivo, nome]) => {
    const src = readFileSync(join(RAIZ, arquivo), "utf8");
    const i = src.indexOf(`create or replace function ${nome}`);
    assert.notEqual(i, -1, `${nome} deveria existir na migration que a criou`);
    return src.slice(i, src.indexOf("$$;", src.indexOf("as $$", i)) + 3);
  }).join("\n\n");
}

const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INATIVADOR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CONSULTA = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const PERFIL_ADMIN = "11111111-1111-1111-1111-111111111111";
const PERFIL_INATIVADOR = "22222222-2222-2222-2222-222222222222";
const PERFIL_CONSULTA = "33333333-3333-3333-3333-333333333333";

const USUARIO_ADMIN = "99999999-9999-9999-9999-999999999999";
const USUARIO_INATIVADOR = "88888888-8888-8888-8888-888888888888";

/**
 * O cenário: UM fornecedor (a produtora) e as suas notas.
 *
 * O perfil "Auxiliar" existe para o caso da permissão parcial: ele enxerga
 * Fornecedores e pode INATIVAR, mas não pode editar. O perfil "Consulta" não
 * tem nem linha de 'fornecedores', e não se chama Administrador: ele nasce sem
 * nada nas áreas.
 */
const DADOS = `
  insert into public.secretarias (id, nome) values (1, 'Cultura'), (2, 'Saúde');
  insert into public.bancos (id, nome) values (1, 'Banco do Brasil');
  insert into public.perfis_acesso (id, nome) values
    ('${PERFIL_ADMIN}', 'Administrador'),
    ('${PERFIL_INATIVADOR}', 'Auxiliar'),
    ('${PERFIL_CONSULTA}', 'Consulta');
  insert into public.perfis_permissoes
    (perfil_id, modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar)
  values
    ('${PERFIL_ADMIN}', 'fornecedores', true, true, true, true, false),
    ('${PERFIL_ADMIN}', 'pagamentos', true, true, true, true, true),
    ('${PERFIL_INATIVADOR}', 'fornecedores', true, false, false, true, false);
  insert into auth.users (id) values ('${ADMIN}'), ('${INATIVADOR}'), ('${CONSULTA}');
  insert into public.usuarios (id, auth_id, nome_completo, status, perfil_id) values
    ('${USUARIO_ADMIN}', '${ADMIN}', 'Tesoureira', 'ativo', '${PERFIL_ADMIN}'),
    ('${USUARIO_INATIVADOR}', '${INATIVADOR}', 'Auxiliar de Cadastro', 'ativo', '${PERFIL_INATIVADOR}'),
    ('77777777-7777-7777-7777-777777777777', '${CONSULTA}', 'Estagiário', 'ativo', '${PERFIL_CONSULTA}');
  insert into public.fornecedores (id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id)
    values (7, 'Produções Artísticas São José LTDA', 'SJ Produções', '12345678000199', 1);
  insert into public.contas_bancarias (id, nome_conta, numero_conta, banco_id, secretaria_id, saldo_atual)
    values (3, 'Conta Movimento', '00123-4', 1, 1, 250000.00);
  insert into public.valores_em_aberto (id, fornecedor_id, numero_nota_fiscal, data_nota_fiscal, valor, data_vencimento, situacao)
  values
    (55, 7, '1234', '2026-08-01', 10000.00, '2026-09-10', 'em_aberto'),
    (56, 7, '1235', '2026-08-02', 4000.00, '2026-09-15', 'em_aberto');
  select setval(pg_get_serial_sequence('public.valores_em_aberto','id'), 100);
`;

const AREAS_SQL = [
  { area: "patrocinios", tabela: "fornecedor_patrocinios", notas: "fornecedor_patrocinio_notas", coluna: "patrocinio_id" },
  { area: "alugueis", tabela: "fornecedor_alugueis", notas: "fornecedor_aluguel_notas", coluna: "aluguel_id" },
  { area: "bandas", tabela: "fornecedor_bandas", notas: "fornecedor_banda_notas", coluna: "banda_id" },
];

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
  await db.exec(DADOS);
  await db.exec(readFileSync(MIGRATION_BAIXAS, "utf8"));
  await db.exec(readFileSync(MIGRATION_AREAS, "utf8"));
  await db.exec(`set ensaio.auth_uid = '${ADMIN}'`);
  return db;
}

test("as três áreas de Fornecedores em Postgres real", async (t) => {
  const db = await abrirBanco();
  if (!db) return t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

  /** Pago e Saldo do registro, calculados como a tela calcula: das baixas das NFs. */
  const resumo = async (item, id) => {
    const { rows } = await db.query(
      `select r.valor::text as valor,
              coalesce(sum(v.valor_pago), 0)::text as pago,
              (r.valor - coalesce(sum(v.valor_pago), 0))::text as saldo,
              count(v.id)::int as notas
         from public.${item.tabela} r
         left join public.${item.notas} vn on vn.${item.coluna} = r.id
         left join public.valores_em_aberto v on v.id = vn.valor_em_aberto_id
        where r.id = $1
        group by r.id, r.valor`,
      [id],
    );
    return rows[0];
  };

  const como = (uid) => db.exec(`set ensaio.auth_uid = '${uid}'`);

  await t.test("a migration é idempotente: roda duas vezes sem reclamar", async () => {
    await db.exec(readFileSync(MIGRATION_AREAS, "utf8"));
  });

  await t.test("nenhuma das seis tabelas tem coluna de valor pago, pago ou saldo", async () => {
    const { rows } = await db.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('fornecedor_patrocinios','fornecedor_alugueis','fornecedor_bandas',
                             'fornecedor_patrocinio_notas','fornecedor_aluguel_notas','fornecedor_banda_notas')
          and column_name in ('valor_pago','pago','saldo','valor_baixado')`,
    );
    assert.deepEqual(rows, [], "Pago e Saldo são calculados; nunca gravados");
  });

  await t.test("o cadastro do fornecedor não ganhou categoria nem tipo", async () => {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'fornecedores'
        order by ordinal_position`,
    );
    const colunas = rows.map((r) => r.column_name);
    assert.deepEqual(colunas, [
      "id",
      "razao_social",
      "nome_fantasia",
      "cpf_cnpj",
      "secretaria_id",
      "ativo",
      "excluido_em",
    ]);
  });

  let patrocinioFesta;
  let patrocinioNatal;

  await t.test("teste 1: patrocínio criado para um fornecedor que já existe", async () => {
    const { rows } = await db.query(
      `insert into public.fornecedor_patrocinios
         (fornecedor_id, nome, evento, secretaria_id, valor, observacoes, situacao, criado_por)
       values (7, 'Patrocínio Festa de São José', 'Festa de São José', 1, 10000.00, 'Palco principal', 'vigente', $1)
       returning id, fornecedor_id::text as fornecedor_id, situacao, ativo`,
      [USUARIO_ADMIN],
    );
    patrocinioFesta = rows[0].id;
    assert.equal(rows[0].fornecedor_id, "7");
    assert.equal(rows[0].ativo, true);

    // Sem NF vinculada: Pago é zero e Saldo é o valor total.
    const r = await resumo(AREAS_SQL[0], patrocinioFesta);
    assert.equal(r.pago, "0");
    assert.equal(r.saldo, "10000.00");
    assert.equal(r.notas, 0);
  });

  await t.test("teste 2: o mesmo fornecedor com dois patrocínios", async () => {
    const { rows } = await db.query(
      `insert into public.fornecedor_patrocinios (fornecedor_id, nome, evento, secretaria_id, valor)
       values (7, 'Patrocínio Natal Iluminado', 'Natal 2026', 1, 6000.00)
       returning id`,
    );
    patrocinioNatal = rows[0].id;

    const { rows: contagem } = await db.query(
      "select count(*)::int as n from public.fornecedor_patrocinios where fornecedor_id = 7",
    );
    assert.equal(contagem[0].n, 2);
    assert.notEqual(patrocinioFesta, patrocinioNatal, "cada patrocínio é um registro próprio");
  });

  await t.test("teste 3: o mesmo fornecedor em aluguéis e bandas, sem duplicar o cadastro", async () => {
    await db.exec(`
      insert into public.fornecedor_alugueis
        (fornecedor_id, descricao, objeto, secretaria_id, valor, valor_mensal, data_inicio, data_fim)
      values (7, 'Aluguel de imóvel — Secretaria de Saúde', 'Imóvel', 2, 24000.00, 2000.00, '2026-01-01', '2026-12-31');
    `);
    await db.exec(`
      insert into public.fornecedor_bandas (fornecedor_id, banda, evento, data_apresentacao, secretaria_id, valor)
      values
        (7, 'Banda Mel do Sertão', 'Festa de São José', '2026-03-19', 1, 30000.00),
        (7, 'Trio Pé de Serra', 'Festa de São José', '2026-03-20', 1, 12000.00),
        (7, 'DJ Nordeste', 'Réveillon 2027', '2026-12-31', 1, 8000.00);
    `);

    // Seis registros do mesmo fornecedor, e UM cadastro só.
    const { rows } = await db.query(`
      select (select count(*)::int from public.fornecedor_patrocinios where fornecedor_id = 7) as patrocinios,
             (select count(*)::int from public.fornecedor_alugueis where fornecedor_id = 7) as alugueis,
             (select count(*)::int from public.fornecedor_bandas where fornecedor_id = 7) as bandas,
             (select count(*)::int from public.fornecedores) as fornecedores
    `);
    assert.deepEqual(rows[0], { patrocinios: 2, alugueis: 1, bandas: 3, fornecedores: 1 });
  });

  await t.test("testes 4 e 5: nome artístico diferente da razão social, vários por fornecedor", async () => {
    const { rows } = await db.query(`
      select b.banda, f.razao_social
        from public.fornecedor_bandas b
        join public.fornecedores f on f.id = b.fornecedor_id
       order by b.banda
    `);
    assert.deepEqual(rows.map((r) => r.banda), ["Banda Mel do Sertão", "DJ Nordeste", "Trio Pé de Serra"]);
    for (const linha of rows) {
      assert.equal(linha.razao_social, "Produções Artísticas São José LTDA");
      assert.notEqual(linha.banda, linha.razao_social, "o nome artístico não precisa ser a razão social");
    }
  });

  await t.test("teste 6: Pago e Saldo saem da baixa da NF vinculada, com o número da aba de Baixas", async () => {
    // O vínculo é com uma NF que JÁ EXISTE. Nenhuma nota é criada aqui.
    await db.query(
      `insert into public.fornecedor_patrocinio_notas (patrocinio_id, valor_em_aberto_id) values ($1, 55), ($1, 56)`,
      [patrocinioFesta],
    );

    const antes = await resumo(AREAS_SQL[0], patrocinioFesta);
    assert.equal(antes.pago, "0.00");
    assert.equal(antes.saldo, "10000.00");

    // A baixa continua sendo por NF/processo, pela função de sempre.
    const { rows: baixa } = await db.query(
      "select public.registrar_baixa_nota($1,$2,$3,$4,$5,$6) as r",
      ["chave-area-0001", "55", 4000, "2026-08-20", 3, "Parcial"],
    );
    assert.equal(baixa[0].r.ok, true);
    assert.equal(baixa[0].r.movimentou_saldo, false, "a baixa não debita o saldo da conta");

    const depois = await resumo(AREAS_SQL[0], patrocinioFesta);
    assert.equal(depois.pago, "4000.00");
    assert.equal(depois.saldo, "6000.00");

    // É o MESMO número que a nota mostra na aba de Baixas.
    const { rows: notas } = await db.query(
      "select coalesce(sum(valor_pago),0)::text as pago from public.valores_em_aberto where id in (55, 56)",
    );
    assert.equal(notas[0].pago, depois.pago);

    // E o outro patrocínio do mesmo fornecedor não recebeu nada: o cálculo é
    // por registro, pelas notas vinculadas a ele.
    const outro = await resumo(AREAS_SQL[0], patrocinioNatal);
    assert.equal(outro.pago, "0");
    assert.equal(outro.saldo, "6000.00");
  });

  await t.test("desvincular a NF não devolve nem retira um centavo da nota", async () => {
    await db.query(
      "delete from public.fornecedor_patrocinio_notas where patrocinio_id = $1 and valor_em_aberto_id = 56",
      [patrocinioFesta],
    );
    const { rows } = await db.query(
      "select valor_pago::text as pago, valor::text as valor, situacao::text as situacao from public.valores_em_aberto where id = 56",
    );
    assert.deepEqual(rows[0], { pago: "0.00", valor: "4000.00", situacao: "em_aberto" });
  });

  await t.test("a mesma NF não pode ser vinculada duas vezes ao mesmo registro", async () => {
    await assert.rejects(
      () =>
        db.query(
          "insert into public.fornecedor_patrocinio_notas (patrocinio_id, valor_em_aberto_id) values ($1, 55)",
          [patrocinioFesta],
        ),
      /duplicate key|unique/i,
    );
  });

  await t.test("teste 8: cada área tem permissão própria, e ninguém herda o que não tem", async () => {
    // O padrão de cada perfil é o que ele já tinha em 'fornecedores'.
    const { rows } = await db.query(`
      select p.nome, pp.modulo, pp.pode_visualizar, pp.pode_cadastrar, pp.pode_editar, pp.pode_excluir
        from public.perfis_permissoes pp
        join public.perfis_acesso p on p.id = pp.perfil_id
       where pp.modulo in ('patrocinios','alugueis','bandas')
       order by p.nome, pp.modulo
    `);
    assert.equal(rows.length, 9, "três módulos para cada um dos três perfis");

    for (const linha of rows.filter((r) => r.nome === "Administrador")) {
      assert.deepEqual(
        [linha.pode_visualizar, linha.pode_cadastrar, linha.pode_editar, linha.pode_excluir],
        [true, true, true, true],
      );
    }
    for (const linha of rows.filter((r) => r.nome === "Auxiliar")) {
      assert.deepEqual(
        [linha.pode_visualizar, linha.pode_cadastrar, linha.pode_editar, linha.pode_excluir],
        [true, false, false, true],
        "o Auxiliar enxerga e inativa, e não cadastra nem edita",
      );
    }
    for (const linha of rows.filter((r) => r.nome === "Consulta")) {
      assert.deepEqual(
        [linha.pode_visualizar, linha.pode_cadastrar, linha.pode_editar, linha.pode_excluir],
        [false, false, false, false],
        "quem não enxerga Fornecedores continua sem enxergar as áreas",
      );
    }

    // Nenhuma permissão EXISTENTE mudou.
    const { rows: antigas } = await db.query(`
      select p.nome, pp.pode_visualizar, pp.pode_cadastrar, pp.pode_editar, pp.pode_excluir
        from public.perfis_permissoes pp
        join public.perfis_acesso p on p.id = pp.perfil_id
       where pp.modulo = 'fornecedores' order by p.nome
    `);
    assert.deepEqual(antigas, [
      { nome: "Administrador", pode_visualizar: true, pode_cadastrar: true, pode_editar: true, pode_excluir: true },
      { nome: "Auxiliar", pode_visualizar: true, pode_cadastrar: false, pode_editar: false, pode_excluir: true },
    ]);

    // E a função de permissão responde por usuário logado.
    for (const { area } of AREAS_SQL) {
      await como(ADMIN);
      for (const acao of ["visualizar", "cadastrar", "editar", "excluir"]) {
        const { rows: pode } = await db.query("select public.pode_em_area_fornecedor($1,$2) as pode", [area, acao]);
        assert.equal(pode[0].pode, true, `o Administrador deveria poder ${acao} em ${area}`);
      }

      await como(INATIVADOR);
      const esperado = { visualizar: true, cadastrar: false, editar: false, excluir: true };
      for (const [acao, valor] of Object.entries(esperado)) {
        const { rows: pode } = await db.query("select public.pode_em_area_fornecedor($1,$2) as pode", [area, acao]);
        assert.equal(pode[0].pode, valor, `o Auxiliar em ${area}: ${acao}`);
      }

      await como(CONSULTA);
      const { rows: pode } = await db.query("select public.pode_em_area_fornecedor($1,'visualizar') as pode", [area]);
      assert.equal(pode[0].pode, false, `Consulta não vê a subaba de ${area}`);
    }
    await como(ADMIN);
  });

  await t.test("quem só pode inativar inativa, e não muda valor nem situação", async () => {
    await como(INATIVADOR);

    // Inativar: aceito.
    await db.query(
      "update public.fornecedor_patrocinios set ativo = false, inativado_em = now(), inativado_por = $2 where id = $1",
      [patrocinioNatal, USUARIO_INATIVADOR],
    );
    const { rows } = await db.query(
      "select ativo, valor::text as valor, situacao from public.fornecedor_patrocinios where id = $1",
      [patrocinioNatal],
    );
    assert.equal(rows[0].ativo, false);

    // Mudar valor: recusado pelo gatilho.
    await assert.rejects(
      () => db.query("update public.fornecedor_patrocinios set valor = 99999 where id = $1", [patrocinioNatal]),
      /permite apenas inativar ou reativar/,
    );
    // Mudar situação junto com o ativo: também recusado.
    await assert.rejects(
      () =>
        db.query("update public.fornecedor_patrocinios set ativo = true, situacao = 'concluido' where id = $1", [
          patrocinioNatal,
        ]),
      /permite apenas inativar ou reativar/,
    );

    // Reativar: aceito.
    await db.query("update public.fornecedor_patrocinios set ativo = true where id = $1", [patrocinioNatal]);

    const { rows: intacto } = await db.query(
      "select ativo, valor::text as valor, situacao from public.fornecedor_patrocinios where id = $1",
      [patrocinioNatal],
    );
    assert.deepEqual(intacto[0], { ativo: true, valor: "6000.00", situacao: "vigente" });

    await como(ADMIN);
    // Quem tem editar edita.
    await db.query("update public.fornecedor_patrocinios set valor = 6500, situacao = 'concluido' where id = $1", [
      patrocinioNatal,
    ]);
    const { rows: editado } = await db.query(
      "select valor::text as valor, situacao from public.fornecedor_patrocinios where id = $1",
      [patrocinioNatal],
    );
    assert.deepEqual(editado[0], { valor: "6500.00", situacao: "concluido" });
  });

  await t.test("teste 11: a exclusão é lógica -- inativar não apaga a linha", async () => {
    await db.query("update public.fornecedor_bandas set ativo = false where banda = 'DJ Nordeste'");
    const { rows } = await db.query(
      "select count(*)::int as total, count(*) filter (where ativo)::int as ativas from public.fornecedor_bandas",
    );
    assert.deepEqual(rows[0], { total: 3, ativas: 2 });

    // E o banco não dá delete nos registros para quem usa o sistema.
    const { rows: grants } = await db.query(`
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and privilege_type = 'DELETE'
         and table_name in ('fornecedor_patrocinios','fornecedor_alugueis','fornecedor_bandas',
                            'fornecedor_patrocinio_notas','fornecedor_aluguel_notas','fornecedor_banda_notas')
       order by table_name
    `);
    assert.deepEqual(
      grants.map((g) => g.table_name),
      ["fornecedor_aluguel_notas", "fornecedor_banda_notas", "fornecedor_patrocinio_notas"],
      "delete existe só no vínculo com a NF, nunca no registro",
    );
  });

  await t.test("o fornecedor com registro em área não pode ser apagado por acidente", async () => {
    await assert.rejects(
      () => db.query("delete from public.fornecedores where id = 7"),
      /foreign key|viola/i,
    );
  });

  await t.test("a situação do registro é o andamento dele, e nunca quer dizer pago", async () => {
    const situacaoDaNota = async () =>
      (await db.query("select situacao::text as s from public.valores_em_aberto where id = 55")).rows[0].s;
    const antes = await situacaoDaNota();

    for (const situacao of ["previsto", "vigente", "concluido", "suspenso", "cancelado"]) {
      await db.query("update public.fornecedor_alugueis set situacao = $1 where fornecedor_id = 7", [situacao]);
    }
    // 'pago' não é situação de registro: quem diz que algo foi pago é a baixa
    // da NF, e só ela.
    await assert.rejects(
      () => db.query("update public.fornecedor_alugueis set situacao = 'pago' where fornecedor_id = 7"),
      /situacao_check|violates check/i,
    );

    // E a situação da NF é a mesma que a baixa deixou: nada nas áreas a move.
    assert.equal(await situacaoDaNota(), antes);
  });

  await t.test("a baixa da área não existe: as tabelas de saldo continuam vazias", async () => {
    for (const tabela of ["saldos_historico", "pagamento_movimentacoes", "transferencias_contas", "transferencia_lotes"]) {
      const { rows } = await db.query(`select count(*)::int as n from public.${tabela}`);
      assert.equal(rows[0].n, 0, `${tabela} não pode receber linha das áreas`);
    }
    const { rows } = await db.query("select saldo_atual::text as saldo from public.contas_bancarias where id = 3");
    assert.equal(rows[0].saldo, "250000.00", "o saldo da conta é o mesmo do começo");
  });

  await t.test("a RLS está ligada nas seis tabelas, com política de cada ação", async () => {
    const { rows } = await db.query(`
      select c.relname, c.relrowsecurity, count(p.polname)::int as politicas
        from pg_class c
        left join pg_policy p on p.polrelid = c.oid
       where c.relname in ('fornecedor_patrocinios','fornecedor_alugueis','fornecedor_bandas',
                           'fornecedor_patrocinio_notas','fornecedor_aluguel_notas','fornecedor_banda_notas')
       group by c.relname, c.relrowsecurity order by c.relname
    `);
    assert.equal(rows.length, 6);
    for (const linha of rows) {
      assert.equal(linha.relrowsecurity, true, `${linha.relname} precisa de RLS ligada`);
      assert.equal(linha.politicas, 3, `${linha.relname} precisa das três políticas`);
    }
  });
});
