// Testes da causa raiz do 23503: gravar em coluna de usuário um id que não
// existe na tabela referenciada.
//
// O diagnóstico no banco de produção mostrou que NENHUM id de auth.users tem
// linha correspondente em public.usuarios -- os três usuários que fazem login
// estão fora daquela tabela. Como public.pagamentos.excluido_por e
// public.auditoria_eventos.usuario_id referenciam public.usuarios (id), gravar
// auth.uid() neles é violação de chave estrangeira garantida.
//
// public.usuario_auditoria_id() NÃO resolve: ela devolve auth.uid() como último
// recurso, que é exatamente o id recusado. Em coluna com vínculo, o último
// recurso é o defeito.
//
// O que estes testes travam:
//
//   NENHUMA COLUNA DE USUÁRIO RECEBE auth.uid() ÀS CEGAS
//   O ID É ESCOLHIDO PELO VÍNCULO REAL DA COLUNA, LIDO DO CATÁLOGO
//   ID NULO NÃO APAGA A RASTREABILIDADE DA TRILHA
//   AS SEIS FUNÇÕES DAS DUAS FASES SEGUEM O MESMO PADRÃO
//   FORA DO ID DE USUÁRIO, NENHUMA LINHA DE REGRA DE NEGÓCIO MUDOU
//   SALVAR NÃO É PAGAR, APROVAR NÃO É PAGAR
//   A MIGRATION NÃO CRIA, NÃO ALTERA E NÃO APAGA ESTRUTURA NEM DADO

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const MIGRATION = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";
const MIGRATION_FASE_2 = "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql";
const MIGRATION_APROVACAO = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const MIGRATION_FORNECEDORES = "supabase/migrations/20260828190000_corrigir_gravacao_fornecedores_programacao.sql";
const MIGRATION_AUDITORIA = "supabase/migrations/20260811130000_auditoria_eventos.sql";
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";

// As seis funções auditadas e a migration de onde vem o corpo anterior de cada
// uma. É esse par que permite comparar linha por linha o que mudou.
const FUNCOES = [
  { nome: "salvar_planejamento_programacao", origem: MIGRATION_FORNECEDORES },
  { nome: "marcar_programacao_em_analise", origem: MIGRATION_APROVACAO },
  { nome: "aprovar_programacao_pagamento", origem: MIGRATION_APROVACAO },
  { nome: "definir_conta_origem_pagamento", origem: MIGRATION_FASE_2 },
  { nome: "confirmar_transferencias_programacao", origem: MIGRATION_FASE_2 },
  { nome: "estornar_transferencia", origem: MIGRATION_FASE_2 },
];

// Tudo que fala de id de usuário. É o que esta migration muda -- e só isso.
const TOCA_USUARIO = /v_usuario|usuario_para_coluna|usuario_registro_id|usuario_auditoria_id|rastro_do_login/;

function semComentarios(sql) {
  return sql
    .split("\n")
    .filter((linha) => !/^\s*--/.test(linha))
    .join("\n");
}

// Corpo da função: do `create or replace` até o fim do bloco, sem grant nem
// comment. Serve para as duas migrations, que usam $$ e $fn$.
function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio > 0, `função ausente: ${nome}`);
  const trecho = sql.slice(inicio);
  const fim = trecho.search(/\nend \$\$;|\n\$fn\$;/);
  assert.ok(fim > 0, `fim de corpo não encontrado: ${nome}`);
  return trecho.slice(0, fim);
}

function linhasNormalizadas(sql) {
  return semComentarios(sql)
    .replaceAll("\n      || public.rastro_do_login(v_usuario_auditoria)", "")
    .replaceAll(" || public.rastro_do_login(v_usuario_auditoria)", "")
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);
}

// ---------------------------------------------------------------------------
// 1. A causa: auth.uid() em coluna que referencia public.usuarios
// ---------------------------------------------------------------------------

test("as duas colunas que quebravam realmente referenciam public.usuarios e aceitam nulo", async () => {
  const exclusao = await read("supabase/migrations/20260823150000_exclusao_controlada_por_permissao.sql");
  assert.match(exclusao, /excluido_por %s references public\.usuarios \(id\) on delete set null/);

  const auditoria = await read(MIGRATION_AUDITORIA);
  assert.match(auditoria, /usuario_id uuid references public\.usuarios \(id\) on delete set null/);
  // `on delete set null` só existe em coluna anulável: NULL é gravação válida
  // nas duas, e é por isso que o id nulo é resposta legítima.
  assert.doesNotMatch(auditoria, /usuario_id uuid not null references public\.usuarios/);
});

test("usuario_auditoria_id continua devolvendo auth.uid() como último recurso — por isso não serve", async () => {
  const fase2 = semComentarios(await read(MIGRATION_FASE_2));
  const resolvedor = corpoDaFuncao(fase2, "usuario_auditoria_id");
  assert.match(resolvedor, /coalesce\([\s\S]*auth\.uid\(\)\s*\n\s*\);/);

  // A migration não muda o corpo dela (objetos fora destas fases podem
  // depender do que ela devolve), mas registra o aviso no próprio objeto.
  const sql = await read(MIGRATION);
  assert.ok(!semComentarios(sql).includes("create or replace function public.usuario_auditoria_id"));
  assert.match(sql, /comment on function public\.usuario_auditoria_id\(\)/);
  assert.match(sql, /NÃO use em coluna com chave estrangeira para public\.usuarios/);
});

test("nenhuma coluna de usuário recebe auth.uid(), em nenhuma das seis funções", async () => {
  const sql = semComentarios(await read(MIGRATION));
  for (const { nome } of FUNCOES) {
    const corpo = corpoDaFuncao(sql, nome);
    // auth.uid() só pode aparecer na conferência da sessão, nunca como valor
    // gravado em coluna.
    for (const linha of corpo.split("\n")) {
      if (!linha.includes("auth.uid()")) continue;
      assert.match(
        linha,
        /v_usuario := auth\.uid\(\);|if auth\.uid\(\) is null then/,
        `${nome}: auth.uid() usado fora da conferência da sessão -- ${linha.trim()}`,
      );
    }
    // E o resolvedor errado não volta pela porta de trás.
    assert.ok(!corpo.includes("usuario_auditoria_id()"), `${nome} ainda usa usuario_auditoria_id()`);
  }
});

// ---------------------------------------------------------------------------
// 2. O id é escolhido pelo vínculo real da coluna
// ---------------------------------------------------------------------------

test("o resolvedor lê o vínculo no catálogo e devolve nulo quando a coluna aponta para usuarios", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const resolvedor = corpoDaFuncao(sql, "usuario_para_coluna");

  assert.match(resolvedor, /from pg_constraint fk/, "o vínculo não é lido do catálogo");
  assert.match(resolvedor, /fk\.contype = 'f'/);
  assert.match(resolvedor, /destino\.relname = 'usuarios'/);
  assert.match(resolvedor, /destino_ns\.nspname = 'auth' and destino\.relname = 'users'/);

  // Coluna que aponta para public.usuarios: o id do registro, e NADA de
  // coalesce com auth.uid() -- é justamente o que a chave estrangeira recusa.
  assert.match(resolvedor, /if v_destino = 'usuarios' then\s*\n\s*return v_registro;/);
  // Coluna que aponta para o auth: aí sim auth.uid().
  assert.match(resolvedor, /elsif v_destino = 'auth' then\s*\n\s*return auth\.uid\(\);/);
  // Sem vínculo não há o que violar, e o id do cadastro é o que as telas leem.
  assert.match(resolvedor, /return coalesce\(v_registro, auth\.uid\(\)\);/);
  // Falha na leitura do catálogo não pode derrubar gravação.
  assert.match(resolvedor, /exception\s*\n\s*when others then\s*\n\s*return coalesce\(v_registro, auth\.uid\(\)\);/);
  assert.match(resolvedor, /stable/);
});

test("o id de public.usuarios vem do vínculo com a sessão, e nunca é inventado", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const registro = corpoDaFuncao(sql, "usuario_registro_id");
  assert.match(registro, /where u\.auth_id = auth\.uid\(\)/);
  assert.match(registro, /from public\.usuarios u/);
  assert.doesNotMatch(
    registro,
    /coalesce\([\s\S]*\n\s*auth\.uid\(\)\s*\n\s*\)/,
    "voltou a devolver auth.uid() como último recurso",
  );
});

test("cada coluna de usuário das duas fases passa pelo resolvedor, com o nome certo", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const esperado = [
    ["pagamentos", "excluido_por"],
    ["programacoes_pagamento", "responsavel_id"],
    ["programacoes_pagamento", "aprovada_por"],
    ["auditoria_eventos", "usuario_id"],
    ["transferencia_lotes", "usuario_id"],
    ["transferencia_lotes", "estornado_por"],
    ["transferencias_contas", "usuario_id"],
    ["transferencias_contas", "estornada_por"],
  ];
  for (const [tabela, coluna] of esperado) {
    assert.ok(
      sql.includes(`public.usuario_para_coluna('${tabela}', '${coluna}')`),
      `coluna fora do padrão: ${tabela}.${coluna}`,
    );
  }
  // Nenhuma coluna de usuário sobrou recebendo variável de outra coluna.
  assert.ok(!sql.includes("excluido_por = v_usuario\n"), "excluido_por voltou a receber o id do auth");
  assert.match(sql, /excluido_por = v_usuario_registro/);
  assert.match(sql, /responsavel_id = v_usuario_responsavel,/);
  assert.match(sql, /aprovada_por = v_usuario_aprovacao,/);
  assert.match(sql, /estornada_por = v_usuario_estorno,/);
  assert.match(sql, /estornado_por = v_usuario_lote_estorno,/);
});

// ---------------------------------------------------------------------------
// 3. Id nulo não apaga a rastreabilidade
// ---------------------------------------------------------------------------

test("com id nulo a trilha guarda o login; com id presente o evento fica igual ao de hoje", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const rastro = corpoDaFuncao(sql, "rastro_do_login");

  assert.match(rastro, /when p_usuario_id is not null then '\{\}'::jsonb/, "o evento normal ganhou campo novo");
  assert.match(rastro, /'login_sem_cadastro', true/);
  assert.match(rastro, /'login_auth_id', auth\.uid\(\)/);

  // Todo evento de auditoria das seis funções carrega o rastro.
  for (const { nome } of FUNCOES) {
    const corpo = corpoDaFuncao(sql, nome);
    const eventos = corpo.split("insert into public.auditoria_eventos").length - 1;
    const rastros = corpo.split("public.rastro_do_login(v_usuario_auditoria)").length - 1;
    assert.ok(eventos > 0, `${nome} deixou de registrar auditoria`);
    assert.ok(rastros >= eventos, `${nome}: evento de auditoria sem rastro do login`);
  }
});

// ---------------------------------------------------------------------------
// 4. Fora do id de usuário, nada mudou
// ---------------------------------------------------------------------------

test("as regras de negócio das seis funções continuam linha por linha as mesmas", async () => {
  const nova = semComentarios(await read(MIGRATION));

  for (const { nome, origem } of FUNCOES) {
    const anterior = semComentarios(await read(origem));
    const antes = linhasNormalizadas(corpoDaFuncao(anterior, nome)).filter((l) => !TOCA_USUARIO.test(l));
    const depois = linhasNormalizadas(corpoDaFuncao(nova, nome)).filter((l) => !TOCA_USUARIO.test(l));

    if (nome === "definir_conta_origem_pagamento") {
      // Única mudança de estrutura de código: a trilha passa a ser isolada, do
      // mesmo jeito que a 20260828170000 fez nas funções da Fase 1.
      const isolamento = depois.indexOf("insert into public.auditoria_eventos (") - 1;
      assert.equal(depois[isolamento], "begin", "o isolamento da trilha saiu do lugar esperado");
      depois.splice(isolamento, 1);
      for (const linha of [
        "exception when others then",
        "raise warning 'Conta de pagamento da programação % definida, mas o evento de auditoria não foi gravado (% -- %).',",
        "p_programacao_id, sqlstate, sqlerrm;",
        "end;",
      ]) {
        const posicao = depois.lastIndexOf(linha);
        assert.ok(posicao > 0, `linha do isolamento ausente: ${linha}`);
        depois.splice(posicao, 1);
      }
    }

    assert.deepEqual(depois, antes, `${nome}: mudou alguma coisa além do id de usuário`);
  }
});

test("a trilha da transferência continua atômica com a movimentação de saldo", async () => {
  const sql = semComentarios(await read(MIGRATION));
  for (const nome of ["confirmar_transferencias_programacao", "estornar_transferencia"]) {
    const corpo = corpoDaFuncao(sql, nome);
    const evento = corpo.indexOf("insert into public.auditoria_eventos");
    // Nada de begin/exception em volta: se a trilha cair, o saldo não se move.
    assert.doesNotMatch(corpo.slice(evento), /exception when others then/, `${nome}: trilha isolada indevidamente`);
  }
});

test("as assinaturas chamadas pela tela continuam as mesmas", async () => {
  const sql = await read(MIGRATION);
  const assinaturas = [
    "public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric)",
    "public.marcar_programacao_em_analise(integer)",
    "public.aprovar_programacao_pagamento(integer, numeric, numeric, numeric)",
    "public.definir_conta_origem_pagamento(integer, integer[], integer)",
    "public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text)",
    "public.estornar_transferencia(uuid, text)",
  ];
  for (const assinatura of assinaturas) {
    assert.ok(sql.includes(`grant execute on function ${assinatura} to authenticated`), `grant ausente: ${assinatura}`);
  }

  // Os nomes dos parâmetros também são contrato: a aplicação chama por nome e
  // guarda a assinatura esperada de cada função para sondar o banco.
  const { FUNCOES_FASE_1 } = await import("../src/lib/estruturaPagamentosFase1.js");
  const { FUNCOES_FASE_2 } = await import("../src/lib/estruturaPagamentosFase2.js");
  const registradas = [...FUNCOES_FASE_1, ...FUNCOES_FASE_2].filter((f) =>
    FUNCOES.some((alvo) => alvo.nome === f.nome),
  );
  assert.equal(registradas.length, FUNCOES.length, "alguma função saiu do registro da aplicação");

  for (const { nome, assinatura } of registradas) {
    const inicio = sql.indexOf(`create or replace function public.${nome}(`);
    const parametros = sql
      .slice(inicio + `create or replace function public.${nome}`.length)
      .split(")\nreturns")[0]
      .replace(/\s+/g, " ")
      .replaceAll(" default null", "")
      .replace("( ", "(")
      .trim();
    assert.equal(`${parametros})`, assinatura, `${nome}: assinatura diferente da que a aplicação chama`);
  }
});

// ---------------------------------------------------------------------------
// 5. Travas de não regressão
// ---------------------------------------------------------------------------

test("SALVAR NÃO É PAGAR: as funções da proposta continuam sem mover saldo", async () => {
  const sql = semComentarios(await read(MIGRATION));
  for (const nome of [
    "salvar_planejamento_programacao",
    "marcar_programacao_em_analise",
    "aprovar_programacao_pagamento",
    "definir_conta_origem_pagamento",
  ]) {
    const corpo = corpoDaFuncao(sql, nome);
    for (const proibido of [
      "saldos_historico",
      "pagamentos_baixas",
      "pagamento_movimentacoes",
      "transferencias_contas",
      "valor_pago",
      "pago_em",
    ]) {
      assert.ok(!corpo.includes(proibido), `${nome} mexeu em ${proibido}`);
    }
  }
});

test("a migration é aditiva e idempotente: nenhuma estrutura e nenhum dado muda", async () => {
  const sql = await read(MIGRATION);
  assert.doesNotMatch(
    sql,
    /drop table|drop function|drop column|drop policy|truncate|delete from|alter table|create table|create policy|grant .* on table/i,
  );
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);

  const definicoes = [...sql.matchAll(/create (or replace )?function/g)];
  assert.equal(definicoes.length, 9, "a migration cria ou substitui exatamente nove funções");
  for (const definicao of definicoes) assert.ok(definicao[1], "função criada sem `or replace`: rodar de novo falharia");

  // Nenhuma escrita em cadastro: a migration não conserta cadastro de usuário,
  // e isso é de propósito.
  assert.doesNotMatch(
    semComentarios(sql),
    /\b(insert into|update) public\.(usuarios|contas_bancarias|fornecedores|certidoes|tarefas|configuracoes|secretarias)\b/i,
  );
});

test("as migrations já aplicadas continuam no disco, inteiras", async () => {
  for (const [caminho, funcao] of [
    [MIGRATION_FASE_2, "confirmar_transferencias_programacao"],
    [MIGRATION_APROVACAO, "aprovar_programacao_pagamento"],
    [MIGRATION_FORNECEDORES, "salvar_planejamento_programacao"],
  ]) {
    const sql = await read(caminho);
    assert.match(sql, new RegExp(`create or replace function public\\.${funcao}`));
    assert.match(sql, /^commit;$/m);
  }
});

test("nenhum outro módulo é tocado", async () => {
  const sql = semComentarios(await read(MIGRATION));
  for (const modulo of [
    "certidoes",
    "tarefas",
    "configuracoes",
    "relatorios",
    "backup",
    "notificacoes",
    "perfis_permissoes",
  ]) {
    assert.ok(!sql.includes(`public.${modulo}`), `a migration mexeu em public.${modulo}`);
  }
});

test("a tela diz qual arquivo executar enquanto a correção não roda", async () => {
  const pagina = await read(PAGINA);
  assert.match(
    pagina,
    /MIGRATION_PADRONIZACAO_USUARIO = "supabase\/migrations\/20260828210000_padronizar_usuario_em_vinculos_pagamentos\.sql"/,
  );
  const trecho = pagina.slice(pagina.indexOf('=== "23503"'), pagina.indexOf('=== "23503"') + 1200);
  assert.ok(trecho.includes("${MIGRATION_PADRONIZACAO_USUARIO}"), "o aviso de 23503 não cita a nova migration");
  assert.match(trecho, /não existe mais/);
  assert.doesNotMatch(trecho, /ligado a outros lançamentos/);
});
