// REABRIR PROGRAMAÇÃO APROVADA — desfazer a aprovação, nunca os dados.
//
// Uma programação aprovada não tinha caminho de volta na tela, e ajustar algo
// depois que o gestor pede uma alteração exigia recomeçar. Esta suíte trava a
// ação nova e, principalmente, o que ela NÃO faz.
//
// O que fica travado aqui:
//
//   SÓ APROVADA SE REABRE, E FECHADA CONTINUA INTOCÁVEL
//   JUSTIFICATIVA OBRIGATÓRIA, MÍNIMO DE 10 CARACTERES
//   QUEM NÃO PODE APROVAR NÃO VÊ O BOTÃO E O BANCO RECUSA A CHAMADA
//   REABRIR NÃO DESFAZ DADOS: contas, fornecedores, valores, saldos congelados,
//     baixas, transferências e saldos reais ficam exatamente como estão
//   A APROVAÇÃO ANTERIOR NÃO É APAGADA DA TRILHA
//   REABRIR NÃO MOVIMENTA SALDO
//   IDEMPOTENTE: em elaboração, reabrir não faz nada e não dá erro
//
// A metade que só o banco faz valer roda em POSTGRES DE VERDADE (PGlite): a
// migration é executada verbatim e as funções são chamadas de fato. Sem
// `@electric-sql/pglite` instalado, essa parte é PULADA e a suíte continua
// passando.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  JUSTIFICATIVA_MINIMA_REABERTURA,
  MOTIVO_REABERTURA_FECHADA,
  MOTIVO_REABERTURA_JUSTIFICATIVA,
  MOTIVO_REABERTURA_SEM_PERMISSAO,
  MOTIVO_REABERTURA_STATUS,
  avisosDaReabertura,
  impedimentosParaReabrir,
  justificativaReaberturaValida,
  podeReabrirProgramacao,
  podeRevisarProposta,
} from "../src/lib/execucaoProgramacao.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const MIGRATION = "supabase/migrations/20260910120000_reabrir_programacao_aprovada.sql";
const MIGRATION_APROVACAO = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const MIGRATION_FASE_2 = "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql";
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";
const MODAL = "src/components/pagamentos/ModalReaberturaProgramacao.jsx";
const DADOS_LIB = "src/lib/execucaoProgramacaoDados.js";
const AUDITORIA_LIB = "src/lib/auditoria.js";

// Os comentários da migration descrevem a regra; as asserções olham o SQL que
// roda, não a explicação escrita ao lado dele.
function semComentarios(sql) {
  return sql
    .split("\n")
    .filter((linha) => !/^\s*--/.test(linha))
    .join("\n");
}

function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio > 0, `função ausente na migration: ${nome}`);
  const fim = sql.indexOf(`grant execute on function public.${nome}`, inicio);
  assert.ok(fim > inicio, `grant ausente para a função: ${nome}`);
  return sql.slice(inicio, fim);
}

// ---------------------------------------------------------------------------
// 1. As regras puras, sem banco e sem tela
// ---------------------------------------------------------------------------

test("só programação aprovada e não fechada pode ser reaberta", () => {
  assert.equal(podeReabrirProgramacao({ status: "aprovada", fechado: false }), true);
  assert.equal(podeReabrirProgramacao({ status: "aprovada" }), true);
  // Fechada é histórico: continua sem poder ser alterada.
  assert.equal(podeReabrirProgramacao({ status: "aprovada", fechado: true }), false);
  assert.equal(podeReabrirProgramacao({ status: "em_elaboracao" }), false);
  assert.equal(podeReabrirProgramacao({ status: "em_analise" }), false);
  assert.equal(podeReabrirProgramacao(null), false);
});

test("reabrir e revisar são caminhos complementares: nunca os dois ao mesmo tempo", () => {
  for (const programacao of [
    { status: "em_elaboracao" },
    { status: "em_analise" },
    { status: "aprovada" },
    { status: "aprovada", fechado: true },
    { status: "em_elaboracao", fechado: true },
  ]) {
    assert.ok(
      !(podeRevisarProposta(programacao) && podeReabrirProgramacao(programacao)),
      `estado com os dois caminhos abertos: ${JSON.stringify(programacao)}`,
    );
  }
});

test("a justificativa exige 10 caracteres úteis", () => {
  assert.equal(JUSTIFICATIVA_MINIMA_REABERTURA, 10);
  assert.equal(justificativaReaberturaValida(""), false);
  assert.equal(justificativaReaberturaValida(null), false);
  assert.equal(justificativaReaberturaValida("ajuste"), false);
  // Espaço não é justificativa: 12 caracteres de nada continuam sendo nada.
  assert.equal(justificativaReaberturaValida("            "), false);
  assert.equal(justificativaReaberturaValida("  ajuste  "), false);
  assert.equal(justificativaReaberturaValida("chefe pediu"), true);
  assert.equal(justificativaReaberturaValida("  chefe pediu ajuste  "), true);
});

test("cada impedimento aparece com o motivo escrito, em vez de botão em silêncio", () => {
  assert.deepEqual(impedimentosParaReabrir({ programacao: { status: "aprovada" } }), []);
  assert.deepEqual(impedimentosParaReabrir({ programacao: { status: "aprovada", fechado: true } }), [
    MOTIVO_REABERTURA_FECHADA,
  ]);
  assert.deepEqual(impedimentosParaReabrir({ programacao: { status: "em_analise" } }), [MOTIVO_REABERTURA_STATUS]);
  assert.deepEqual(impedimentosParaReabrir({ programacao: { status: "aprovada" }, podeReabrir: false }), [
    MOTIVO_REABERTURA_SEM_PERMISSAO,
  ]);
  assert.deepEqual(
    impedimentosParaReabrir({ programacao: { status: "aprovada" }, justificativa: "curta" }),
    [MOTIVO_REABERTURA_JUSTIFICATIVA],
  );
  assert.deepEqual(impedimentosParaReabrir({ programacao: { status: "aprovada" }, justificativa: "chefe pediu ajuste" }), []);
  assert.match(MOTIVO_REABERTURA_JUSTIFICATIVA, /10 caracteres/);
});

test("baixa e transferência viram AVISO, nunca bloqueio", () => {
  assert.deepEqual(avisosDaReabertura({ baixas: 0, transferencias: 0 }), []);

  const comBaixa = avisosDaReabertura({ baixas: 2, transferencias: 0 });
  assert.equal(comBaixa.length, 1);
  assert.match(comBaixa[0], /2 baixas registradas/);
  assert.match(comBaixa[0], /NÃO desfaz baixa nenhuma/);

  const comTransferencia = avisosDaReabertura({ baixas: 0, transferencias: 1 });
  assert.equal(comTransferencia.length, 1);
  assert.match(comTransferencia[0], /1 transferência vinculada/);
  assert.match(comTransferencia[0], /NÃO desfaz transferência nenhuma/);

  assert.equal(avisosDaReabertura({ baixas: 3, transferencias: 2 }).length, 2);

  // Contagem desconhecida não é zero: o aviso diz que não deu para conferir.
  const desconhecido = avisosDaReabertura({ baixas: null, transferencias: null });
  assert.equal(desconhecido.length, 1);
  assert.match(desconhecido[0], /Não foi possível conferir/);
});

test("a ação tem rótulo próprio na Auditoria", async () => {
  // A lib da Auditoria fala com o Supabase no topo do arquivo, então aqui vale o
  // texto: é o mesmo dicionário que dá nome à ação na tela e no filtro.
  const auditoria = await read(AUDITORIA_LIB);
  assert.match(auditoria, /reabriu_programacao: "Reabriu programação"/);
  // A aprovação continua com o rótulo que sempre teve.
  assert.match(auditoria, /aprovou: "Aprovou"/);
  assert.match(auditoria, /justificativa: "Justificativa"/);
});

// ---------------------------------------------------------------------------
// 2. O que a migration faz valer no banco
// ---------------------------------------------------------------------------

test("a migration cria as três funções com as assinaturas que a tela chama", async () => {
  const [sql, dados] = await Promise.all([read(MIGRATION), read(DADOS_LIB)]);
  for (const assinatura of [
    "public.pode_reabrir_programacao()",
    "public.vinculos_da_programacao(integer)",
    "public.reabrir_programacao_pagamento(integer, text)",
  ]) {
    assert.ok(
      sql.includes(`grant execute on function ${assinatura} to authenticated`),
      `grant ausente: ${assinatura}`,
    );
  }
  // Os nomes dos parâmetros também são contrato: a aplicação chama por nome.
  assert.match(sql, /reabrir_programacao_pagamento\(\s*\n\s*p_programacao_id integer,\s*\n\s*p_justificativa text\s*\n\)/);
  assert.match(dados, /rpc\("reabrir_programacao_pagamento", \{\s*\n\s*p_programacao_id: programacaoId,\s*\n\s*p_justificativa: texto,/);
  assert.match(dados, /rpc\("vinculos_da_programacao", \{/);
  assert.match(dados, /rpc\("pode_reabrir_programacao"\)/);
});

test("REABRIR NÃO DESFAZ DADOS: o único update escreve status e os campos da aprovação", async () => {
  const corpo = semComentarios(corpoDaFuncao(await read(MIGRATION), "reabrir_programacao_pagamento"));

  const updates = corpo.match(/update\s+public\.\w+/g) ?? [];
  assert.deepEqual(updates, ["update public.programacoes_pagamento"], "reabrir só altera o cabeçalho da programação");

  const colunas = (corpo.match(/set\s+status = 'em_elaboracao',\s+aprovada_em = null,\s+aprovada_por = null,\s+updated_at = now\(\)/) ?? [])[0];
  assert.ok(colunas, "o update precisa escrever exatamente status, aprovada_em, aprovada_por e updated_at");

  // Nenhuma tabela de dados, de dinheiro ou de razão é escrita.
  for (const tabela of [
    "programacao_contas",
    "pagamentos",
    "pagamentos_baixas",
    "transferencias_contas",
    "transferencia_lotes",
    "pagamento_movimentacoes",
    "saldos_historico",
    "contas_bancarias",
    "fornecedores",
    "valores_em_aberto",
  ]) {
    assert.doesNotMatch(
      corpo,
      new RegExp(`(insert into|update|delete from|truncate)\\s+public\\.${tabela}\\b`),
      `reabrir não pode escrever em public.${tabela}`,
    );
  }

  // O único insert é o da trilha de auditoria.
  const inserts = corpo.match(/insert into\s+public\.\w+/g) ?? [];
  assert.deepEqual(inserts, ["insert into public.auditoria_eventos"]);
  assert.doesNotMatch(corpo, /delete\s+from/i);
});

test("a migration não altera nem remove nada do que já existia", async () => {
  const sql = semComentarios(await read(MIGRATION));
  assert.doesNotMatch(sql, /alter table/i);
  assert.doesNotMatch(sql, /drop\s+(table|column|function|policy|constraint|index)/i);
  assert.doesNotMatch(sql, /create\s+(or replace\s+)?policy/i);
  assert.doesNotMatch(sql, /revoke/i);
  // As funções existentes não são recriadas por esta migration.
  for (const funcao of [
    "aprovar_programacao_pagamento",
    "salvar_planejamento_programacao",
    "marcar_programacao_em_analise",
    "pode_em_pagamentos_fase2",
    "definir_conta_origem_pagamento",
    "confirmar_transferencias_programacao",
    "estornar_transferencia",
    "registrar_baixa_nota",
  ]) {
    assert.ok(
      !sql.includes(`create or replace function public.${funcao}`),
      `a migration não deve recriar public.${funcao}`,
    );
  }
  // Só as três funções novas são criadas.
  const criadas = [...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(criadas.sort(), [
    "pode_reabrir_programacao",
    "reabrir_programacao_pagamento",
    "vinculos_da_programacao",
  ]);
});

test("as travas do banco: permissão, justificativa, fechada, status e idempotência", async () => {
  const corpo = corpoDaFuncao(await read(MIGRATION), "reabrir_programacao_pagamento");
  assert.match(corpo, /if not public\.pode_reabrir_programacao\(\) then/);
  assert.match(corpo, /errcode = '42501'/);
  assert.match(corpo, /length\(v_justificativa\) < 10/);
  assert.match(corpo, /Programações históricas fechadas não podem ser reabertas/);
  assert.match(corpo, /'em_elaboracao' then\s*\n\s*return jsonb_build_object/);
  assert.match(corpo, /ja_em_elaboracao', true/);
  assert.match(corpo, /Somente uma programação aprovada pode ser reaberta/);
  // Trava contra o 22P02 que já derrubou a aprovação: status e fechado saem
  // como texto, o que funciona para text, enum e domínio.
  assert.match(corpo, /pr\.status::text, pr\.fechado::text/);
  assert.match(corpo, /for update/);
  // A permissão da ação é a mesma de aprovar.
  const permissao = corpoDaFuncao(await read(MIGRATION), "pode_reabrir_programacao");
  assert.match(permissao, /pode_em_pagamentos_fase2\('aprovar_programacao'\)/);
  assert.match(permissao, /pe\.modulo = 'pagamentos'\s*\n\s*and pe\.pode_aprovar/);
});

test("o evento de auditoria é crítico, carrega a justificativa e não apaga a aprovação anterior", async () => {
  const corpo = corpoDaFuncao(await read(MIGRATION), "reabrir_programacao_pagamento");
  assert.match(corpo, /'reabriu_programacao'/);
  assert.match(corpo, /'critico'/);
  assert.match(corpo, /'justificativa', v_justificativa/);
  assert.match(corpo, /'status', v_status_anterior/);
  assert.match(corpo, /'aprovada_em', v_aprovada_em/);
  assert.match(corpo, /'aprovada_por', v_aprovada_por/);
  assert.match(corpo, /'movimentou_saldo', false/);
  assert.match(corpo, /'alterou_dados', false/);
  // A trilha da aprovação anterior não é tocada: nada é apagado de
  // auditoria_eventos por esta função.
  assert.doesNotMatch(corpo, /delete\s+from\s+public\.auditoria_eventos/i);
  assert.doesNotMatch(corpo, /update\s+public\.auditoria_eventos/i);
  // Aqui a auditoria fica na MESMA transação de propósito: a justificativa é
  // parte do resultado da operação.
  const trecho = corpo.slice(corpo.indexOf("insert into public.auditoria_eventos"));
  assert.doesNotMatch(trecho.split("return jsonb_build_object")[0], /exception when others then/);
  assert.match(await read(MIGRATION), /a auditoria NÃO é isolada de propósito/);
});

test("APROVAR e SALVAR continuam com o corpo que já tinham", async () => {
  // Trava de não regressão do arquivo que esta entrega não deve encostar.
  const sql = await read(MIGRATION_APROVACAO);
  const aprovar = semComentarios(corpoDaFuncao(sql, "aprovar_programacao_pagamento"));
  assert.match(aprovar, /set status = 'aprovada',\s+aprovada_em = now\(\),\s+aprovada_por = v_usuario/);
  assert.match(aprovar, /'movimentou_saldo', false/);
  for (const tabela of ["saldos_historico", "pagamentos_baixas", "transferencias_contas", "pagamento_movimentacoes"]) {
    assert.doesNotMatch(aprovar, new RegExp(`(insert into|update|delete from)\\s+public\\.${tabela}\\b`));
  }
  // A ação nova não entrou no mapa de ações da permissão da Fase 2 -- ela tem
  // função própria, e mexer nesse mapa mudaria uma função já aplicada.
  const fase2 = await read(MIGRATION_FASE_2);
  assert.ok(!fase2.includes("reabrir_programacao"), "a migration da Fase 2 não deve ser alterada");
});

// ---------------------------------------------------------------------------
// 3. A tela: botão discreto, com permissão e confirmação explícita
// ---------------------------------------------------------------------------

test("o botão fica junto às demais ações, discreto, e só para quem pode reabrir", async () => {
  const pagina = await read(PAGINA);
  assert.match(pagina, /podeReabrirProgramacao\(programacao\) && permissoesFase2\?\.reabrir_programacao !== false/);
  assert.match(pagina, /onClick=\{abrirReabertura\}/);
  assert.match(pagina, /Reabrir programação/);
  // Discreto: contorno sobre a barra de ações, sem cor cheia como as ações de
  // rotina (salvar, marcar em análise, aprovar).
  assert.match(pagina, /border border-white\/30 px-3 py-1\.5 text-\[12px\] font-medium text-white\/80/);
  // O botão da aprovação continua exatamente como estava.
  assert.match(pagina, /APROVAR PROGRAMAÇÃO/);
  assert.match(pagina, /podeRevisarProposta\(programacao\) && <button onClick=\{\(\) => setMostrarAprovacao\(true\)\}/);
  // Confirmação explícita antes de reabrir: a página não chama a RPC direto do
  // clique do botão.
  assert.match(pagina, /<ModalReaberturaProgramacao/);
  assert.match(pagina, /onConfirmar=\{confirmarReabertura\}/);
  // Aviso da migration pendente aponta o arquivo certo.
  assert.match(pagina, /20260910120000_reabrir_programacao_aprovada\.sql/);
});

test("a confirmação exige justificativa e diz o que acontece e o que NÃO acontece", async () => {
  const modal = await read(MODAL);
  assert.match(modal, /justificativaReaberturaValida/);
  assert.match(modal, /disabled=\{salvando \|\| !justificativaOk\}/);
  assert.match(modal, /obrigatória/);
  assert.match(modal, /volta para “em elaboração” e fica editável outra vez/);
  assert.match(modal, /Reabrir não desfaz nada/);
  assert.match(modal, /não é\s*\n?\s*apagada do histórico/);
  assert.match(modal, /avisosDaReabertura/);
});

test("a tela conta baixas e transferências por função do banco, e desconhecido não vira zero", async () => {
  const dados = await read(DADOS_LIB);
  assert.match(dados, /carregarVinculosDaProgramacao/);
  assert.match(dados, /baixas: data\?\.baixas \?\? null/);
  assert.match(dados, /return \{ baixas: null, transferencias: null, naoVerificado: true \}/);
  // A justificativa é conferida antes de sair da tela, e de novo no banco.
  assert.match(dados, /texto\.length < JUSTIFICATIVA_MINIMA_REABERTURA/);
  // A permissão de reabrir não é perguntada a pode_em_pagamentos_fase2, que não
  // conhece a ação e responderia "não" para todo mundo.
  assert.doesNotMatch(dados, /ACOES_FASE_2 = \[[^\]]*reabrir_programacao/s);
});

// ---------------------------------------------------------------------------
// 4. POSTGRES DE VERDADE: os sete ensaios obrigatórios
// ---------------------------------------------------------------------------

const APROVADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SEM_PERMISSAO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const ESTRUTURA = `
create role anon;
create role authenticated;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $x$
  select nullif(current_setting('ensaio.auth_uid', true), '')::uuid
$x$;

create table public.secretarias (id integer primary key, nome text);

create table public.usuarios (
  id uuid primary key,
  auth_id uuid,
  nome_completo text,
  status text not null default 'ativo'
);

-- A matriz de permissões do sistema, como a função da Fase 2 a lê.
create table public.permissoes_efetivas (
  usuario_id uuid,
  modulo text,
  pode_visualizar boolean not null default true,
  pode_editar boolean not null default false,
  pode_aprovar boolean not null default false,
  pode_excluir boolean not null default false
);

create table public.permissoes_especiais (
  usuario_id uuid,
  acao text,
  permitido boolean
);

create table public.fornecedores (id integer primary key, razao_social text, secretaria_id integer);

create table public.contas_bancarias (
  id integer primary key,
  nome_conta text,
  numero_conta text,
  secretaria_id integer,
  ativo boolean not null default true
);

-- O saldo real das contas vive aqui. Nenhuma linha desta tabela pode mudar ao
-- reabrir -- é o que o ensaio confere.
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

create table public.pagamentos (
  id serial primary key,
  programacao_id integer,
  fornecedor_id integer,
  valor_a_pagar numeric(14,2),
  nome_avulso text,
  cadastrar_fornecedor_posteriormente boolean not null default false,
  situacao text,
  conta_origem_id integer,
  excluido_em timestamptz,
  excluido_por uuid
);

-- saldo_considerado é o SALDO CONGELADO da conta na programação.
create table public.programacao_contas (
  id serial primary key,
  programacao_id integer,
  conta_id integer,
  saldo_considerado numeric(14,2) not null default 0,
  ordem integer,
  ativa boolean not null default true,
  valor_rateado numeric(14,2) not null default 0
);

-- A razão das baixas e das transferências: reabrir não pode encostar nelas.
create table public.pagamentos_baixas (
  id serial primary key,
  pagamento_id integer,
  fornecedor_id integer,
  valor_pago numeric(14,2),
  conta_id integer,
  status text not null default 'efetivada',
  criado_em timestamptz not null default now()
);

create table public.transferencias_contas (
  id serial primary key,
  programacao_id integer,
  conta_origem_id integer,
  conta_destino_id integer,
  valor numeric(14,2),
  status text not null default 'efetivada',
  criado_em timestamptz not null default now()
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
  ('${APROVADOR}', '${APROVADOR}', 'Chefe do setor', 'ativo'),
  ('${SEM_PERMISSAO}', '${SEM_PERMISSAO}', 'Auxiliar', 'ativo');

insert into public.permissoes_efetivas (usuario_id, modulo, pode_visualizar, pode_editar, pode_aprovar, pode_excluir) values
  ('${APROVADOR}', 'pagamentos', true, true, true, false),
  ('${SEM_PERMISSAO}', 'pagamentos', true, true, false, false);

insert into public.fornecedores values (7, 'José da Silva Comércio de Alimentos Ltda.', 1), (8, 'Padaria Central Ltda.', 1);
insert into public.contas_bancarias (id, nome_conta, numero_conta, secretaria_id) values
  (11, 'FUNDEB', '2.042-7', 1), (12, 'MERENDA', '1.001-9', 1);
insert into public.saldos_historico (conta_id, data_saldo, valor_saldo) values
  (11, '2026-09-10', 180000.00), (12, '2026-09-10', 42350.75);

-- A programação de trabalho, montada e aprovada pelo próprio ensaio.
insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status)
  values (50, 1, '2026-09-10', 'em_elaboracao');
-- Programação FECHADA: histórico, não pode ser reaberta.
insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status, fechado, aprovada_em, aprovada_por)
  values (60, 1, '2026-08-01', 'aprovada', true, now(), '${APROVADOR}');
-- Programação em elaboração: reabrir nela não faz nada e não dá erro.
insert into public.programacoes_pagamento (id, secretaria_id, data_programacao, status)
  values (70, 1, '2026-09-10', 'em_elaboracao');
`;

/** Só o corpo de uma função, recortado de uma migration já aplicada. */
function funcaoDaMigration(caminho, nome) {
  const sql = readFileSync(join(RAIZ, caminho), "utf8");
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  const fim = sql.indexOf(`grant execute on function public.${nome}`, inicio);
  assert.ok(inicio > 0 && fim > inicio, `função não recortada: ${nome}`);
  return sql.slice(inicio, fim);
}

async function abrirBanco() {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(ESTRUTURA);
  // A permissão da Fase 2 é a REAL, recortada da migration já aplicada: é ela
  // que decide se quem chama pode aprovar -- e, por consequência, reabrir.
  await db.exec(funcaoDaMigration(MIGRATION_FASE_2, "pode_em_pagamentos_fase2"));
  // Salvar, marcar em análise e aprovar, também as de verdade.
  await db.exec(readFileSync(join(RAIZ, MIGRATION_APROVACAO), "utf8"));
  await db.exec(DADOS);
  await db.exec(readFileSync(join(RAIZ, MIGRATION), "utf8"));
  await db.exec(`set ensaio.auth_uid = '${APROVADOR}'`);
  return db;
}

const pular = (t) => t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

const CONTAS = [
  { conta_id: 11, saldo_considerado: 180000.0, ordem: 1 },
  { conta_id: 12, saldo_considerado: 42350.75, ordem: 2 },
];

const salvar = (db, { id = 50, contas = CONTAS, pagamentos, saldo = 222350.75, total, restante }) =>
  db.query("select public.salvar_planejamento_programacao($1, $2::jsonb, $3::jsonb, $4, $5, $6) as r", [
    id,
    JSON.stringify(contas),
    JSON.stringify(pagamentos),
    saldo,
    total,
    restante,
  ]);

const aprovar = (db, id = 50) =>
  db.query("select public.aprovar_programacao_pagamento($1, null, null, null) as r", [id]);

const reabrir = (db, justificativa, id = 50) =>
  db.query("select public.reabrir_programacao_pagamento($1, $2) as r", [id, justificativa]);

const cabecalho = async (db, id = 50) =>
  (
    await db.query(
      `select status, fechado, aprovada_em, aprovada_por, saldo_considerado, total_programado, restante,
              conta_pagamento_id, responsavel_id
         from public.programacoes_pagamento where id = $1`,
      [id],
    )
  ).rows[0];

const itens = async (db, id = 50) =>
  (
    await db.query(
      `select id, fornecedor_id, nome_avulso, valor_a_pagar, situacao, conta_origem_id, excluido_em
         from public.pagamentos where programacao_id = $1 order by id`,
      [id],
    )
  ).rows;

const contasDa = async (db, id = 50) =>
  (
    await db.query(
      `select conta_id, saldo_considerado, ordem, ativa, valor_rateado
         from public.programacao_contas where programacao_id = $1 order by conta_id`,
      [id],
    )
  ).rows;

const eventos = async (db) =>
  (await db.query("select usuario_id, acao, registro_afetado, valor_anterior, valor_novo, nivel, criado_em from public.auditoria_eventos order by id")).rows;

/** Monta e aprova a programação 50, como a tela faz. */
async function aprovada(db) {
  await salvar(db, {
    pagamentos: [
      { fornecedor_id: 7, valor_a_pagar: 100000 },
      { fornecedor_id: 8, valor_a_pagar: 25000 },
    ],
    total: 125000,
    restante: 97350.75,
  });
  const resposta = await aprovar(db);
  assert.equal(resposta.rows[0].r.ok, true);
  assert.equal(resposta.rows[0].r.movimentou_saldo ?? false, false);
  return resposta.rows[0].r;
}

test("1. programação aprovada é reaberta com justificativa e volta a ser editável", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await aprovada(db);
  assert.equal((await cabecalho(db)).status, "aprovada");

  const resposta = await reabrir(db, "o chefe pediu a retirada de um fornecedor");
  assert.equal(resposta.rows[0].r.ok, true);
  assert.equal(resposta.rows[0].r.ja_em_elaboracao, false);
  assert.equal(resposta.rows[0].r.status_anterior, "aprovada");
  assert.equal(resposta.rows[0].r.status, "em_elaboracao");
  assert.equal(resposta.rows[0].r.alterou_dados, false);
  assert.equal(resposta.rows[0].r.movimentou_saldo, false);

  const depois = await cabecalho(db);
  assert.equal(depois.status, "em_elaboracao");
  assert.equal(depois.aprovada_em, null);
  assert.equal(depois.aprovada_por, null);

  // Editável de novo: retirar um fornecedor e alterar o valor do outro passa.
  const antes = await itens(db);
  await salvar(db, {
    pagamentos: [{ id: antes[0].id, fornecedor_id: 7, valor_a_pagar: 90000 }],
    total: 90000,
    restante: 132350.75,
  });
  const vivos = (await itens(db)).filter((item) => item.excluido_em === null);
  assert.equal(vivos.length, 1);
  assert.equal(vivos[0].valor_a_pagar, "90000.00");
  await db.close();
});

test("2. reabrir sem justificativa é recusado, e a programação continua aprovada", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await aprovada(db);

  for (const tentativa of [null, "", "   ", "ajuste", "         "]) {
    await assert.rejects(() => reabrir(db, tentativa), (erro) => {
      assert.match(erro.message, /justificativa/i);
      assert.match(erro.message, /10 caracteres/);
      return true;
    });
  }

  const depois = await cabecalho(db);
  assert.equal(depois.status, "aprovada");
  assert.notEqual(depois.aprovada_em, null);
  // Recusa não deixa rastro de reabertura na trilha.
  assert.equal((await eventos(db)).filter((e) => e.acao === "reabriu_programacao").length, 0);
  await db.close();
});

test("3. depois de reaberta, editar e aprovar de novo funciona", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await aprovada(db);
  await reabrir(db, "o chefe pediu para trocar o valor do segundo fornecedor");

  const antes = await itens(db);
  await salvar(db, {
    pagamentos: [
      { id: antes[0].id, fornecedor_id: 7, valor_a_pagar: 100000 },
      { id: antes[1].id, fornecedor_id: 8, valor_a_pagar: 40000 },
    ],
    total: 140000,
    restante: 82350.75,
  });

  const segunda = await aprovar(db);
  assert.equal(segunda.rows[0].r.ok, true);
  assert.equal(segunda.rows[0].r.ja_aprovada, false);
  assert.equal(segunda.rows[0].r.total_aprovado, 140000);

  const depois = await cabecalho(db);
  assert.equal(depois.status, "aprovada");
  assert.notEqual(depois.aprovada_em, null);
  assert.equal(depois.aprovada_por, APROVADOR);

  // A trilha tem as duas aprovações e a reabertura entre elas.
  const acoes = (await eventos(db)).map((e) => e.acao);
  assert.deepEqual(
    acoes.filter((acao) => acao === "aprovou" || acao === "reabriu_programacao"),
    ["aprovou", "reabriu_programacao", "aprovou"],
  );
  await db.close();
});

test("4. contas, fornecedores, valores e saldos congelados ficam intactos após reabrir", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await aprovada(db);
  // Conta definida por pagamento, baixa registrada e transferência vinculada:
  // reabrir não pode encostar em nenhuma delas.
  await db.exec("update public.pagamentos set conta_origem_id = 11 where programacao_id = 50");
  await db.exec("update public.programacoes_pagamento set conta_pagamento_id = 12 where id = 50");
  await db.exec(
    "insert into public.pagamentos_baixas (pagamento_id, fornecedor_id, valor_pago, conta_id) select id, fornecedor_id, 10000, 11 from public.pagamentos where programacao_id = 50 order by id limit 1",
  );
  await db.exec(
    "insert into public.transferencias_contas (programacao_id, conta_origem_id, conta_destino_id, valor) values (50, 12, 11, 5000)",
  );

  const antes = {
    contas: await contasDa(db),
    itens: await itens(db),
    saldos: (await db.query("select conta_id, data_saldo, valor_saldo from public.saldos_historico order by id")).rows,
    baixas: (await db.query("select pagamento_id, valor_pago, conta_id, status from public.pagamentos_baixas order by id")).rows,
    transferencias: (await db.query("select programacao_id, conta_origem_id, conta_destino_id, valor, status from public.transferencias_contas order by id")).rows,
    cabecalho: await cabecalho(db),
  };

  const resposta = await reabrir(db, "ajuste solicitado pelo gestor na reunião de hoje");
  assert.equal(resposta.rows[0].r.baixas_registradas, 1);
  assert.equal(resposta.rows[0].r.transferencias_vinculadas, 1);

  const depois = {
    contas: await contasDa(db),
    itens: await itens(db),
    saldos: (await db.query("select conta_id, data_saldo, valor_saldo from public.saldos_historico order by id")).rows,
    baixas: (await db.query("select pagamento_id, valor_pago, conta_id, status from public.pagamentos_baixas order by id")).rows,
    transferencias: (await db.query("select programacao_id, conta_origem_id, conta_destino_id, valor, status from public.transferencias_contas order by id")).rows,
    cabecalho: await cabecalho(db),
  };

  // Saldos congelados das contas de trabalho: idênticos.
  assert.deepEqual(depois.contas, antes.contas);
  assert.deepEqual(
    depois.contas.map((c) => c.saldo_considerado),
    ["180000.00", "42350.75"],
  );
  // Fornecedores, valores e a conta definida de cada pagamento: idênticos.
  assert.deepEqual(depois.itens, antes.itens);
  // Saldo real das contas, baixas e transferências: nada se moveu.
  assert.deepEqual(depois.saldos, antes.saldos);
  assert.deepEqual(depois.baixas, antes.baixas);
  assert.deepEqual(depois.transferencias, antes.transferencias);
  // No cabeçalho, só o status e os campos da aprovação mudaram.
  assert.equal(depois.cabecalho.status, "em_elaboracao");
  assert.equal(depois.cabecalho.aprovada_em, null);
  assert.equal(depois.cabecalho.aprovada_por, null);
  assert.equal(depois.cabecalho.saldo_considerado, antes.cabecalho.saldo_considerado);
  assert.equal(depois.cabecalho.total_programado, antes.cabecalho.total_programado);
  assert.equal(depois.cabecalho.restante, antes.cabecalho.restante);
  assert.equal(depois.cabecalho.conta_pagamento_id, 12);
  assert.equal(depois.cabecalho.responsavel_id, antes.cabecalho.responsavel_id);
  await db.close();
});

test("5. sem permissão de aprovar, a função do banco recusa a chamada e a tela não mostra o botão", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await aprovada(db);
  await db.exec(`set ensaio.auth_uid = '${SEM_PERMISSAO}'`);

  // É esta resposta que esconde o botão na tela.
  const pode = await db.query("select public.pode_reabrir_programacao() as pode");
  assert.equal(pode.rows[0].pode, false);

  await assert.rejects(() => reabrir(db, "quero reabrir mesmo sem poder aprovar"), (erro) => {
    assert.match(erro.message, /permissão/i);
    return true;
  });
  assert.equal((await cabecalho(db)).status, "aprovada");

  // Concessão avulsa da ação própria é respeitada, e a recusa avulsa também.
  await db.exec(`insert into public.permissoes_especiais values ('${SEM_PERMISSAO}', 'reabrir_programacao', true)`);
  assert.equal((await db.query("select public.pode_reabrir_programacao() as pode")).rows[0].pode, true);

  await db.exec(`set ensaio.auth_uid = '${APROVADOR}'`);
  assert.equal((await db.query("select public.pode_reabrir_programacao() as pode")).rows[0].pode, true);
  await db.exec(`insert into public.permissoes_especiais values ('${APROVADOR}', 'reabrir_programacao', false)`);
  assert.equal((await db.query("select public.pode_reabrir_programacao() as pode")).rows[0].pode, false);
  await db.close();
});

test("6. o evento aparece na Auditoria, em nível crítico, com a justificativa e sem apagar a aprovação", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await aprovada(db);
  const aprovacao = (await eventos(db)).find((e) => e.acao === "aprovou");
  assert.ok(aprovacao, "a aprovação precisa estar na trilha antes da reabertura");

  const justificativa = "o chefe pediu para trocar o fornecedor do transporte";
  await reabrir(db, `  ${justificativa}  `);

  const trilha = await eventos(db);
  const evento = trilha.find((e) => e.acao === "reabriu_programacao");
  assert.ok(evento, "a reabertura precisa aparecer na Auditoria");
  assert.equal(evento.nivel, "critico");
  assert.equal(evento.usuario_id, APROVADOR);
  assert.equal(evento.registro_afetado, "Programação 50");
  // Justificativa gravada sem os espaços das pontas.
  assert.equal(evento.valor_novo.justificativa, justificativa);
  assert.equal(evento.valor_anterior.status, "aprovada");
  assert.ok(evento.valor_anterior.aprovada_em, "o evento guarda quando a aprovação desfeita aconteceu");
  assert.equal(evento.valor_anterior.aprovada_por, APROVADOR);
  assert.equal(evento.valor_novo.status, "em_elaboracao");
  assert.equal(evento.valor_novo.movimentou_saldo, false);
  assert.equal(evento.valor_novo.alterou_dados, false);
  assert.ok(evento.criado_em, "o evento tem data");

  // A APROVAÇÃO ANTERIOR CONTINUA NA TRILHA: ela aconteceu.
  const aprovacaoDepois = trilha.find((e) => e.acao === "aprovou");
  assert.deepEqual(aprovacaoDepois, aprovacao);
  await db.close();
});

test("7. programação fechada continua não podendo ser reaberta", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  const antes = await cabecalho(db, 60);
  await assert.rejects(() => reabrir(db, "queria ajustar uma programação histórica", 60), (erro) => {
    assert.match(erro.message, /fechadas não podem ser reabertas/i);
    return true;
  });
  assert.deepEqual(await cabecalho(db, 60), antes);
  assert.equal((await eventos(db)).length, 0);
  await db.close();
});

test("reabrir uma programação já em elaboração não faz nada e não dá erro", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  const antes = await cabecalho(db, 70);
  const primeira = await reabrir(db, "chamada repetida por dois cliques", 70);
  assert.equal(primeira.rows[0].r.ok, true);
  assert.equal(primeira.rows[0].r.ja_em_elaboracao, true);
  assert.equal(primeira.rows[0].r.alterou_dados, false);
  assert.deepEqual(await cabecalho(db, 70), antes);
  assert.equal((await eventos(db)).length, 0, "no-op não escreve na trilha");

  // E na programação que foi reaberta de verdade, a segunda chamada é no-op.
  await aprovada(db);
  await reabrir(db, "o chefe pediu um ajuste no valor do fornecedor");
  const depoisDaPrimeira = await cabecalho(db);
  const repetida = await reabrir(db, "o chefe pediu um ajuste no valor do fornecedor");
  assert.equal(repetida.rows[0].r.ja_em_elaboracao, true);
  assert.deepEqual(await cabecalho(db), depoisDaPrimeira);
  assert.equal((await eventos(db)).filter((e) => e.acao === "reabriu_programacao").length, 1);
  await db.close();
});

test("programação em análise não é reaberta: a recusa diz o motivo em palavras", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await db.query("select public.marcar_programacao_em_analise(70)");
  await assert.rejects(() => reabrir(db, "tentativa em programação em análise", 70), (erro) => {
    assert.match(erro.message, /Somente uma programação aprovada pode ser reaberta/i);
    assert.match(erro.message, /em_analise/);
    return true;
  });
  assert.equal((await cabecalho(db, 70)).status, "em_analise");
  await db.close();
});

test("a contagem de vínculos é só contagem, e continua igual depois de reabrir", async (t) => {
  const db = await abrirBanco();
  if (!db) return pular(t);

  await aprovada(db);
  const vazio = await db.query("select public.vinculos_da_programacao(50) as v");
  assert.deepEqual(vazio.rows[0].v, { programacao_id: 50, baixas: 0, transferencias: 0 });

  await db.exec(
    "insert into public.pagamentos_baixas (pagamento_id, fornecedor_id, valor_pago, conta_id, status) select id, fornecedor_id, 1000, 11, 'efetivada' from public.pagamentos where programacao_id = 50",
  );
  // Baixa estornada não conta como baixa em vigor.
  await db.exec(
    "insert into public.pagamentos_baixas (pagamento_id, fornecedor_id, valor_pago, conta_id, status) select id, fornecedor_id, 1000, 11, 'estornada' from public.pagamentos where programacao_id = 50 order by id limit 1",
  );
  await db.exec(
    "insert into public.transferencias_contas (programacao_id, conta_origem_id, conta_destino_id, valor) values (50, 12, 11, 5000), (50, 11, 12, 700)",
  );

  const cheio = await db.query("select public.vinculos_da_programacao(50) as v");
  assert.deepEqual(cheio.rows[0].v, { programacao_id: 50, baixas: 2, transferencias: 2 });

  await reabrir(db, "reabertura com baixas e transferências já registradas");
  const depois = await db.query("select public.vinculos_da_programacao(50) as v");
  assert.deepEqual(depois.rows[0].v, cheio.rows[0].v, "reabrir não desfaz baixa nem transferência");
  await db.close();
});
