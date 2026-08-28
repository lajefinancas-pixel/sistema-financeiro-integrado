// Testes do defeito "não foi possível salvar a programação na etapa 'gravação
// dos fornecedores da programação' -- código 23503".
//
// 23503 é foreign_key_violation. A etapa apontada pela mensagem da migration
// 20260828170000 grava três vínculos (programacao_id, fornecedor_id e
// excluido_por) e o que quebrava era o terceiro: public.pagamentos.excluido_por
// referencia public.usuarios (id), mas a função gravava nele auth.uid(). Neste
// sistema public.usuarios.id NÃO é o id do auth -- a ligação com a sessão é
// public.usuarios.auth_id = auth.uid(). Gravar auth.uid() ali é gravar um id
// que não existe na tabela referenciada.
//
// O que estes testes travam:
//
//   COLUNA COM VÍNCULO PARA usuarios NUNCA RECEBE auth.uid()
//   FORNECEDOR INEXISTENTE É RECUSADO EM PORTUGUÊS, NÃO COMO 23503
//   A CONTA POR PAGAMENTO NÃO É GRAVADA NA FASE DE PROPOSTA
//   CONSTRAINT, TABELA, COLUNA E DETALHE VÃO PARA O CONSOLE
//   A MENSAGEM COM O NOME DA ETAPA CONTINUA DE PÉ
//   SALVAR CONTINUA NÃO SENDO PAGAR
//
// A parte que só o banco faz valer é travada pelo texto da migration, que é a
// única coisa que a garante de verdade.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { mensagemAmigavel } from "../src/lib/erros.js";
import { detalheDoBanco } from "../src/lib/estruturaPagamentosFase1.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260828190000_corrigir_gravacao_fornecedores_programacao.sql";
const MIGRATION_ANTERIOR = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const MIGRATION_EXCLUSAO = "supabase/migrations/20260823150000_exclusao_controlada_por_permissao.sql";
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";

function semComentarios(sql) {
  return sql
    .split("\n")
    .filter((linha) => !/^\s*--/.test(linha))
    .join("\n");
}

function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio > 0, `função ausente na migration: ${nome}`);
  const fim = sql.indexOf("grant execute on function public." + nome, inicio);
  assert.ok(fim > inicio, `grant ausente para a função: ${nome}`);
  return sql.slice(inicio, fim);
}

// ---------------------------------------------------------------------------
// 1. A causa: excluido_por recebia auth.uid()
// ---------------------------------------------------------------------------

test("o vínculo que quebrava existe mesmo: excluido_por aponta para public.usuarios", async () => {
  const sql = await read(MIGRATION_EXCLUSAO);
  assert.match(sql, /excluido_por %s references public\.usuarios \(id\) on delete set null/);
  // A coluna é anulável: NULL é gravação válida e nunca viola o vínculo.
  assert.doesNotMatch(sql, /excluido_por %s not null/);
});

test("nenhuma coluna com vínculo para usuarios recebe auth.uid()", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");

  assert.doesNotMatch(salvar, /excluido_por = v_usuario\b/, "excluido_por voltou a receber o id do auth");
  assert.match(salvar, /excluido_por = v_usuario_registro/, "excluido_por não recebe o id de public.usuarios");
  assert.match(salvar, /v_usuario_registro := public\.usuario_registro_id\(\)/);

  // responsavel_id continua como está hoje: é auth.uid() que a própria tela
  // grava ao criar a programação, e é isso que funciona neste banco.
  assert.match(salvar, /responsavel_id = v_usuario,/);
});

test("o id de usuário usado em coluna com vínculo é o de public.usuarios, e nunca inventa um", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const resolvedor = corpoDaFuncao(sql, "usuario_registro_id");

  assert.match(resolvedor, /where u\.auth_id = auth\.uid\(\)/, "o vínculo com a sessão é auth_id");
  assert.match(resolvedor, /from public\.usuarios u/);
  assert.match(resolvedor, /returns uuid/);
  // O último recurso de public.usuario_auditoria_id() -- devolver auth.uid() --
  // é justamente o valor que a chave estrangeira recusa. Aqui não existe.
  assert.doesNotMatch(
    resolvedor,
    /coalesce\([\s\S]*\n\s*auth\.uid\(\)\s*\n\s*\)/,
    "voltou a devolver auth.uid() como último recurso",
  );
});

// ---------------------------------------------------------------------------
// 2. Fornecedor trocado ou removido durante os testes
// ---------------------------------------------------------------------------

test("fornecedor que não existe mais é recusado antes de qualquer gravação", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");

  const conferencia = salvar.indexOf("conferência dos fornecedores selecionados");
  const primeiraGravacao = salvar.indexOf("update public.programacoes_pagamento");
  assert.ok(conferencia > 0, "a conferência dos fornecedores não existe");
  assert.ok(conferencia < primeiraGravacao, "a conferência acontece depois de já ter gravado");
  assert.match(salvar, /public\.fornecedor_referenciavel\(v_fornecedor_id\)/);
  assert.match(salvar, /if v_situacao_fornecedor = 'ausente' then/);
});

test("a conferência do fornecedor vê o que o vínculo vê, não o que o RLS mostra", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const conferidor = corpoDaFuncao(sql, "fornecedor_referenciavel");

  // security definer: fornecedor de outra secretaria existe para a chave
  // estrangeira, e não pode ser acusado de inexistente por causa de política.
  assert.match(conferidor, /security definer/);
  assert.match(conferidor, /return 'ausente'/);
  // Exclusão lógica mantém a linha no banco: o vínculo continua válido e o
  // salvamento não pode ser bloqueado por isso.
  assert.match(conferidor, /return 'excluido'/);
  assert.doesNotMatch(conferidor, /delete|drop|insert into|update public/i, "a conferência grava alguma coisa");
});

test("fornecedor avulso vai com vínculo nulo e nome livre, da tela ao banco", async () => {
  const pagina = await read(PAGINA);
  // Na tela: o avulso nasce sem fornecedor_id e com nome_avulso.
  assert.match(pagina, /fornecedor_id: null,\n\s*fornecedores: null,\n\s*nome_avulso: avulso\.nome\.trim\(\)/);
  // No envio: "" e 0 não são id, e não podem virar vínculo.
  assert.match(pagina, /fornecedor_id: vazio\(item\.fornecedor_id\) \? null : idInteiro/);
  assert.match(pagina, /return valor == null \|\| valor === "" \|\| Number\(valor\) === 0;/);

  const sql = semComentarios(await read(MIGRATION));
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");
  assert.match(salvar, /nullif\(v_pagamento->>'fornecedor_id', ''\)::integer/);
  assert.match(salvar, /nullif\(trim\(v_pagamento->>'nome_avulso'\), ''\)/);
});

// ---------------------------------------------------------------------------
// 3. A conta por pagamento não pertence à proposta
// ---------------------------------------------------------------------------

test("a proposta não grava conta por pagamento", async () => {
  const sql = await read(MIGRATION);
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");
  assert.ok(!salvar.includes("conta_origem_id"), "a proposta voltou a atribuir conta por pagamento");

  const pagina = await read(PAGINA);
  const envio = pagina.slice(pagina.indexOf("const payloadPagamentos"), pagina.indexOf("const programacaoIdInteiro"));
  assert.ok(!envio.includes("conta_origem_id"), "a tela manda conta por pagamento no salvamento da proposta");
});

// ---------------------------------------------------------------------------
// 4. Identificar a chave exata em um único teste
// ---------------------------------------------------------------------------

test("a função lê constraint, tabela, coluna e detalhe do erro e os manda no DETAIL", async () => {
  const sql = await read(MIGRATION);
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");

  assert.match(salvar, /get stacked diagnostics/);
  for (const campo of ["constraint_name", "table_name", "column_name", "pg_exception_detail"]) {
    assert.match(salvar, new RegExp(campo), `o erro não registra ${campo}`);
  }
  for (const rotulo of ["constraint=%s", "tabela=%s", "coluna=%s", "detalhe=%s"]) {
    assert.ok(salvar.includes(rotulo), `o DETAIL não leva ${rotulo}`);
  }
  // O nome da constraint é texto de backend: fica no DETAIL, que a aplicação
  // registra no console, e nunca na frase mostrada na tela.
  const mensagemFinal = salvar.slice(salvar.lastIndexOf("raise exception"));
  assert.doesNotMatch(mensagemFinal.split("using errcode")[0], /sqlerrm|v_constraint|v_detalhe_erro/);
});

test("o console recebe a chave estrangeira com nome, separada em campos", async () => {
  const falha = {
    code: "P0001",
    message:
      'Não foi possível salvar a programação na etapa "gravação dos fornecedores da programação". O banco recusou a operação com o código 23503.',
    details:
      'insert or update on table "pagamentos" violates foreign key constraint "pagamentos_excluido_por_fkey" | ' +
      "etapa=gravação dos fornecedores da programação sqlstate=23503 " +
      "constraint=pagamentos_excluido_por_fkey tabela=pagamentos coluna=- " +
      'detalhe=Key (excluido_por)=(0000) is not present in table "usuarios". | pagamentos.excluido_por=uuid',
    hint: "Leia o DETAIL.",
  };

  const detalhe = detalheDoBanco(falha);
  assert.equal(detalhe.constraint, "pagamentos_excluido_por_fkey");
  assert.equal(detalhe.tabela, "pagamentos");
  assert.equal(detalhe.etapa, "gravação dos fornecedores da programação");
  assert.match(detalhe.detalhe, /excluido_por/);
  assert.equal(detalhe.coluna, null, "'-' não é nome de coluna");

  // Erro sem DETAIL estruturado não inventa campo nenhum.
  assert.deepEqual(detalheDoBanco({ code: "23503" }), {
    etapa: null,
    constraint: null,
    tabela: null,
    coluna: null,
    detalhe: null,
  });
  assert.deepEqual(detalheDoBanco(null).constraint, null);

  const pagina = await read(PAGINA);
  assert.match(pagina, /banco: detalheDoBanco\(falha\)/, "o console da Fase 1 não registra os campos do banco");
  const fase2 = pagina.slice(pagina.indexOf("function registrarErroFase2"));
  assert.match(fase2.slice(0, 500), /banco: detalheDoBanco\(falha\)/, "o console da Fase 2 não registra os campos do banco");
});

// ---------------------------------------------------------------------------
// 5. O que aparece na tela
// ---------------------------------------------------------------------------

test("23503 explicado pelo banco chega à tela em português, sem texto técnico", () => {
  const escritas = [
    'Não foi possível salvar a programação na etapa "gravação dos fornecedores da programação". O banco recusou a operação com o código 23503. O vínculo recusado foi o do usuário responsável pela gravação: o seu login não tem registro correspondente no cadastro de usuários do sistema. Peça para a Equipe conferir o seu cadastro.',
    'Não foi possível salvar a programação na etapa "gravação dos fornecedores da programação". O banco recusou a operação com o código 23503. O vínculo recusado foi o de um fornecedor: um dos fornecedores escolhidos não existe mais no cadastro. Remova-o da lista, escolha o fornecedor novamente e salve.',
    "Um dos fornecedores escolhidos não existe mais no cadastro. Remova-o da lista de fornecedores da programação, escolha o fornecedor novamente e salve.",
  ];
  for (const texto of escritas) {
    const mostrada = mensagemAmigavel(
      { code: "P0001", message: texto, details: "constraint=pagamentos_excluido_por_fkey", hint: "Leia o DETAIL." },
      "Não foi possível salvar a programação.",
    );
    assert.equal(mostrada, texto, "a explicação real do banco foi trocada pela mensagem genérica");
    assert.doesNotMatch(mostrada, /constraint|fkey|foreign key|public\./i, "texto de backend chegou à tela");
  }
});

test("as frases mostradas na tela são as que a migration escreve", async () => {
  const sql = await read(MIGRATION);
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");
  for (const trecho of [
    "O vínculo recusado foi o do usuário responsável pela gravação",
    "O vínculo recusado foi o de um fornecedor",
    "O vínculo recusado foi o da própria programação",
    "O vínculo recusado foi o de uma conta bancária",
    "Um dos fornecedores escolhidos não existe mais no cadastro",
  ]) {
    assert.ok(salvar.includes(trecho), `frase ausente na migration: ${trecho}`);
  }
  assert.match(salvar, /if sqlstate = '23503' then/);
});

test("23503 cru, antes da migration rodar, diz o que executar e não culpa o registro em uso", async () => {
  const pagina = await read(PAGINA);
  assert.match(pagina, /MIGRATION_CORRECAO_FORNECEDORES = "supabase\/migrations\/20260828190000_corrigir_gravacao_fornecedores_programacao\.sql"/);
  assert.match(pagina, /String\(falha\?\.code \?\? ""\) === "23503"/, "a tela não explica o 23503 nem diz o que executar");
  // A mensagem geral do sistema para 23503 descreve o caso oposto (registro em
  // uso); a tela dos Pagamentos Diários precisa da sua própria.
  const trecho = pagina.slice(pagina.indexOf('=== "23503"'), pagina.indexOf('=== "23503"') + 900);
  assert.doesNotMatch(trecho, /ligado a outros lançamentos/);
  assert.match(trecho, /não existe mais/);
});

// ---------------------------------------------------------------------------
// 6. Trava de não regressão
// ---------------------------------------------------------------------------

test("a mensagem com o nome da etapa continua de pé", async () => {
  const sql = await read(MIGRATION);
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");

  assert.match(salvar, /v_etapa text := 'início'/);
  for (const etapa of [
    "conferência da sessão",
    "leitura da programação",
    "gravação dos totais da programação",
    "gravação das contas de trabalho",
    "gravação dos fornecedores da programação",
    "registro na auditoria",
  ]) {
    assert.ok(salvar.includes(`v_etapa := '${etapa}'`), `etapa perdida: ${etapa}`);
  }
  assert.match(
    salvar,
    /Não foi possível salvar a programação na etapa "%"\. O banco recusou a operação com o código %/,
  );
  assert.match(
    salvar,
    /if sqlstate in \('P0001', '42501', '42P01', '42703', '42883', '42P13'\) then\s*\n\s*raise;/,
    "a migration engole a mensagem escrita ou o aviso de estrutura ausente",
  );
});

test("auditar continua sem derrubar o salvamento, com nível aceito pela coluna", async () => {
  const sql = await read(MIGRATION);
  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");
  const posicao = salvar.indexOf("insert into public.auditoria_eventos");
  assert.ok(posicao > 0, "o salvamento deixou de registrar auditoria");
  assert.match(salvar.slice(0, posicao).slice(-120), /begin\s*$/, "auditoria não isolada");
  assert.match(salvar.slice(posicao), /exception when others then\s*\n\s*raise warning/);
  assert.doesNotMatch(sql, /'normal'/, "'normal' está fora do domínio de auditoria_eventos.nivel");
  assert.ok(salvar.includes("'informacao'"));
});

test("SALVAR NÃO É PAGAR: a correção não move nenhum saldo", async () => {
  const sql = await read(MIGRATION);
  for (const proibido of [
    "saldos_historico",
    "pagamentos_baixas",
    "pagamento_movimentacoes",
    "transferencias_contas",
    "marcar_pagamento_pago",
    "saldo_atual",
    "valor_pago",
    "pago_em",
  ]) {
    assert.ok(!sql.includes(proibido), `o salvamento mexeu em ${proibido}`);
  }
});

test("a migration é aditiva e idempotente: nenhuma estrutura e nenhum dado muda", async () => {
  const sql = await read(MIGRATION);
  assert.doesNotMatch(sql, /drop table|drop function|drop column|drop policy|truncate|delete from|alter table|create table|create policy|grant .* on table/i);
  assert.doesNotMatch(sql, /\bupdate public\.(contas_bancarias|fornecedores|certidoes|tarefas|configuracoes|usuarios)\b/i);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);

  const definicoes = [...sql.matchAll(/create (or replace )?function/g)];
  assert.equal(definicoes.length, 3, "a migration cria ou substitui exatamente três funções");
  for (const definicao of definicoes) assert.ok(definicao[1], "função criada sem `or replace`: rodar de novo falharia");

  for (const funcao of ["usuario_registro_id", "fornecedor_referenciavel", "salvar_planejamento_programacao"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${funcao}\\(`), `grant ausente: ${funcao}`);
  }
});

test("a assinatura que a tela chama continua a mesma", async () => {
  const sql = await read(MIGRATION);
  assert.match(
    sql,
    /salvar_planejamento_programacao\(\s*\n\s*p_programacao_id integer,\s*\n\s*p_contas jsonb,\s*\n\s*p_pagamentos jsonb,\s*\n\s*p_saldo_considerado numeric,\s*\n\s*p_total_programado numeric,\s*\n\s*p_restante numeric\s*\n\)/,
  );
  assert.match(
    sql,
    /grant execute on function public\.salvar_planejamento_programacao\(integer, jsonb, jsonb, numeric, numeric, numeric\) to authenticated/,
  );
  const pagina = await read(PAGINA);
  assert.match(pagina, /p_programacao_id: programacaoIdInteiro/);
  assert.match(pagina, /supabase\.rpc\("salvar_planejamento_programacao", argumentos\)/);
});

test("a aprovação e o em análise ficam como a migration anterior deixou", async () => {
  // Só o SQL que roda: os comentários da migration citam as duas funções para
  // dizer justamente que elas ficam intactas.
  const sql = semComentarios(await read(MIGRATION));
  assert.ok(!sql.includes("aprovar_programacao_pagamento"), "a migration redefine a aprovação");
  assert.ok(!sql.includes("marcar_programacao_em_analise"), "a migration redefine o em análise");

  // A migration já aplicada continua no disco, inteira.
  const anterior = await read(MIGRATION_ANTERIOR);
  assert.match(anterior, /create or replace function public\.aprovar_programacao_pagamento/);
  assert.match(anterior, /create or replace function public\.marcar_programacao_em_analise/);
  assert.match(anterior, /create or replace function public\.tipo_da_coluna/);
});

test("nenhum outro módulo é tocado", async () => {
  const sql = await read(MIGRATION);
  for (const modulo of [
    "certidoes",
    "tarefas",
    "configuracoes",
    "relatorios",
    "backup",
    "notificacoes",
    "perfis_permissoes",
    "saldos_historico",
  ]) {
    assert.ok(!semComentarios(sql).includes(`public.${modulo}`), `a migration mexeu em public.${modulo}`);
  }
});
