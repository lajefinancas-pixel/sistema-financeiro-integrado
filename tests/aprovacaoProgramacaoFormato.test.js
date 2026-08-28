// Testes do defeito "não é possível aprovar a programação": a tela recusava a
// aprovação com "Algum valor informado está em um formato inválido" em qualquer
// valor -- R$ 194.631,04 ou R$ 300,00, dava no mesmo.
//
// O que estes testes travam:
//
//   O VALOR EM FORMATO BRASILEIRO É LIDO CERTO
//   22P02 NÃO ACUSA O VALOR DIGITADO PELO USUÁRIO
//   MENSAGEM ESCRITA NO BANCO CHEGA A QUEM USA A TELA
//   COMPARAÇÃO NO BANCO NÃO DEPENDE DO TIPO DA COLUNA ANTIGA
//   AUDITAR NUNCA DERRUBA A AÇÃO PRINCIPAL
//   APROVAR CONTINUA NÃO SENDO PAGAR
//
// A parte que só o banco faz valer (a comparação que estourava 22P02) é travada
// pelo texto da migration, que é a única coisa que a garante de verdade.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { formatBRL, mascararMoedaDigitando, paraNumeroMoeda } from "../src/lib/moeda.js";
import { mensagemAmigavel } from "../src/lib/erros.js";
import { calcularRestante, somarContasSelecionadas, somarPagamentos, valorPlanejamento } from "../src/lib/planejamentoPagamentos.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";
const DADOS = "src/lib/execucaoProgramacaoDados.js";

// Os comentários da migration citam o defeito que ela corrige (o
// `coalesce(p.situacao, '')` e o `nivel = 'normal'` antigos). As asserções
// abaixo olham o SQL que roda, não a explicação escrita ao lado dele.
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
// 1. Os valores do relato do defeito
// ---------------------------------------------------------------------------

test("os valores exatos do relato são lidos certo, em real brasileiro", () => {
  assert.equal(paraNumeroMoeda("R$ 194.631,04"), 194631.04);
  assert.equal(paraNumeroMoeda("R$ 10.000,00"), 10000);
  assert.equal(paraNumeroMoeda("R$ 300,00"), 300);
  assert.equal(paraNumeroMoeda("R$ 100,00"), 100);
  assert.equal(paraNumeroMoeda("R$ 1.234,56"), 1234.56);
  // Total programado do relato: 2 fornecedores, R$ 300,00 + R$ 100,00.
  assert.equal(somarPagamentos([{ valor_a_pagar: "R$ 300,00" }, { valor_a_pagar: "R$ 100,00" }]), 400);
});

test("milhar brasileiro continua sendo milhar, e o campo com máscara não muda", () => {
  assert.equal(paraNumeroMoeda("1.000.000"), 1000000);
  assert.equal(paraNumeroMoeda("1.234"), 1234);
  assert.equal(formatBRL("1.234"), formatBRL(1234));
  assert.equal(mascararMoedaDigitando("194631,04"), "R$ 194.631,04");
  assert.equal(mascararMoedaDigitando("R$ 12.345."), "R$ 12.345");
  assert.equal(paraNumeroMoeda("-R$ 1.000,00"), -1000);
});

test("número escrito pela máquina não é multiplicado por mil", () => {
  // Valor devolvido pelo banco em coluna numeric, ou soma feita em código.
  assert.equal(paraNumeroMoeda("194631.04"), 194631.04);
  assert.equal(paraNumeroMoeda("12345.678"), 12345.678);
  assert.equal(paraNumeroMoeda("0.5"), 0.5);
});

test("o que a tela manda para o banco é sempre número finito", () => {
  const contas = [
    { id: 1, saldo: "R$ 194.631,04" },
    { id: 2, saldo: "R$ 10.000,00" },
  ];
  const selecionadas = new Set([1, 2]);
  const pagamentos = [{ valor_a_pagar: "R$ 300,00" }, { valor_a_pagar: "R$ 100,00" }];

  const disponivel = somarContasSelecionadas(contas, selecionadas);
  const programado = somarPagamentos(pagamentos);
  const restante = calcularRestante(disponivel, programado);

  for (const valor of [disponivel, programado, restante, valorPlanejamento("R$ 1.234,56"), valorPlanejamento("")]) {
    assert.equal(typeof valor, "number");
    assert.ok(Number.isFinite(valor), `valor não finito iria para o banco: ${valor}`);
  }
  assert.equal(programado, 400);
  assert.equal(disponivel, 204631.04);
});

// ---------------------------------------------------------------------------
// 2. A mensagem que aparecia na tela
// ---------------------------------------------------------------------------

test("22P02 não acusa mais o valor digitado pelo usuário", async () => {
  const mensagem = mensagemAmigavel({ code: "22P02", message: 'invalid input value for enum situacao_pagamento: ""' }, "Não foi possível aprovar a programação.");
  assert.doesNotMatch(mensagem, /formato inválido/i, "a tela voltaria a culpar o valor digitado");
  assert.match(mensagem, /22P02/, "o código precisa aparecer para poder ser relatado");
  assert.doesNotMatch(mensagem, /enum|situacao_pagamento|invalid input/i, "texto de backend não vai para a tela");

  const fonte = await read("src/lib/erros.js");
  assert.doesNotMatch(fonte, /Algum valor informado está em um formato inválido/, "a frase do defeito ainda está no código");
});

test("mensagem escrita dentro da função do banco chega a quem usa a tela", () => {
  // Estas frases foram redigidas para o usuário nas funções da Fase 1 e 2.
  const escritas = [
    "Não é possível aprovar uma programação sem fornecedores.",
    "Não é possível aprovar uma programação sem contas de trabalho.",
    "Programações históricas fechadas não podem ser aprovadas.",
    "O valor programado não pode ser negativo.",
    'Não foi possível aprovar a programação na etapa "soma dos fornecedores da programação". O banco recusou a operação com o código 22P02.',
  ];
  for (const texto of escritas) {
    assert.equal(
      mensagemAmigavel({ code: "P0001", message: texto, details: "detalhe técnico", hint: "rode a migration" }, "Não foi possível aprovar a programação."),
      texto,
      "a explicação real do banco foi trocada pela mensagem genérica",
    );
  }
});

test("texto técnico continua fora da tela, mesmo com código de mensagem escrita", () => {
  const padrao = "Não foi possível aprovar a programação.";
  const tecnicos = [
    'relation "public.programacoes_pagamento" does not exist',
    "permission denied for table pagamentos",
    'new row violates row-level security policy for table "pagamentos"',
    "duplicate key value violates unique constraint",
  ];
  for (const message of tecnicos) {
    assert.equal(mensagemAmigavel({ code: "P0001", message }, padrao), padrao, `chegou à tela: ${message}`);
  }
});

test("o erro real do Supabase vai inteiro para o console", async () => {
  const fonte = await read("src/lib/erros.js");
  assert.match(fonte, /console\.error\("\[erro tratado\]"/);
  for (const campo of ["code", "message", "details", "hint", "status"]) {
    assert.match(fonte, new RegExp(`${campo}: erro\\.${campo}`), `o console não registra ${campo}`);
  }

  const dados = await read(DADOS);
  assert.match(dados, /console\.info\("\[Pagamentos Fase 2\] rpc aprovar_programacao_pagamento", argumentos\)/);
  const pagina = await read(PAGINA);
  assert.match(pagina, /console\.info\("\[Pagamentos Fase 1\] rpc salvar_planejamento_programacao", argumentos\)/);
  assert.match(pagina, /MIGRATION_CORRECAO_APROVACAO/);
  assert.match(pagina, /String\(falha\?\.code \?\? ""\) === "22P02"/, "a tela não explica mais o 22P02 nem diz o que executar");
});

// ---------------------------------------------------------------------------
// 3. A comparação que estourava no banco
// ---------------------------------------------------------------------------

test("nenhuma comparação depende do tipo da coluna antiga", async () => {
  const sql = semComentarios(await read(MIGRATION));

  // A causa do 22P02: `coalesce(p.situacao, '')` converte o '' para o tipo da
  // coluna, e um enum recusa a comparação.
  assert.doesNotMatch(sql, /coalesce\(\s*p\.situacao\s*,/, "voltou a comparar situacao sem converter para texto");
  assert.doesNotMatch(sql, /coalesce\(\s*situacao\s*,\s*''\s*\)\s+in/, "voltou a comparar situacao sem converter para texto");
  assert.doesNotMatch(sql, /\.fechado is true|v_programacao\.fechado/, "fechado voltou a ser lido como boolean");

  for (const trecho of ["coalesce(p.situacao::text, '')", "coalesce(situacao::text, '')", "pr.status::text", "pr.fechado::text"]) {
    assert.ok(sql.includes(trecho), `conversão ausente na migration: ${trecho}`);
  }

  const aprovar = corpoDaFuncao(sql, "aprovar_programacao_pagamento");
  assert.match(aprovar, /coalesce\(p\.situacao::text, ''\) <> 'cancelado'/);
  assert.match(aprovar, /v_etapa/, "a função não diz em que etapa falhou");
});

test("o nível gravado na auditoria é um dos aceitos pela coluna", async () => {
  const sql = semComentarios(await read(MIGRATION));
  // 'normal' não existe no domínio de auditoria_eventos.nivel
  // (informacao/atencao/critico) nem no mapa de níveis da tela de Auditoria.
  assert.doesNotMatch(sql, /'normal'/, "'normal' está fora do domínio de auditoria_eventos.nivel");

  let conferidos = 0;
  for (const funcao of ["aprovar_programacao_pagamento", "salvar_planejamento_programacao", "marcar_programacao_em_analise"]) {
    const corpo = corpoDaFuncao(sql, funcao);
    const insert = corpo.slice(corpo.indexOf("insert into public.auditoria_eventos"));
    // nivel é o último valor do insert.
    const nivel = insert.match(/,\s*'([a-z_]+)'\s*\n\s*\);/);
    assert.ok(nivel, `nível da auditoria não encontrado em ${funcao}`);
    assert.ok(
      ["informacao", "atencao", "critico"].includes(nivel[1]),
      `nível inválido gravado por ${funcao}: ${nivel[1]}`,
    );
    conferidos += 1;
  }
  assert.equal(conferidos, 3);
});

test("auditar nunca derruba a ação principal", async () => {
  const sql = await read(MIGRATION);
  const inserts = [...sql.matchAll(/insert into public\.auditoria_eventos/g)];
  assert.equal(inserts.length, 3, "as três funções da tela precisam registrar auditoria");

  for (const funcao of ["aprovar_programacao_pagamento", "salvar_planejamento_programacao", "marcar_programacao_em_analise"]) {
    const corpo = corpoDaFuncao(sql, funcao);
    const posicao = corpo.indexOf("insert into public.auditoria_eventos");
    assert.ok(posicao > 0, `sem registro de auditoria: ${funcao}`);
    // O insert fica dentro de um bloco próprio com tratamento de exceção, para
    // que uma falha só da trilha não desfaça o que já foi gravado.
    const antes = corpo.slice(0, posicao);
    assert.match(antes.slice(-120), /begin\s*$/, `auditoria não isolada em ${funcao}`);
    assert.match(corpo.slice(posicao), /exception when others then\s*\n\s*raise warning/, `falha de auditoria derruba ${funcao}`);
  }
});

test("qualquer falha inesperada diz a etapa, o código e não vaza texto de backend", async () => {
  const sql = await read(MIGRATION);
  for (const funcao of ["aprovar_programacao_pagamento", "salvar_planejamento_programacao", "marcar_programacao_em_analise"]) {
    const corpo = corpoDaFuncao(sql, funcao);
    // Passam intactas: mensagem escrita para o usuário, recusa de permissão e
    // falta de objeto -- esta última é como a tela reconhece que a migration
    // ainda não rodou e diz qual arquivo executar.
    assert.match(
      corpo,
      /if sqlstate in \('P0001', '42501', '42P01', '42703', '42883', '42P13'\) then\s*\n\s*raise;/,
      `${funcao} engole a mensagem escrita ou o aviso de estrutura ausente`,
    );
    // A mensagem exibida é em português; o texto cru do Postgres vai em detail.
    assert.match(corpo, /using errcode = 'P0001',\s*\n\s*detail = format\(/, `${funcao} não guarda o erro cru em detail`);
    const mensagemFinal = corpo.slice(corpo.lastIndexOf("raise exception"));
    assert.doesNotMatch(mensagemFinal.split("using errcode")[0], /sqlerrm/, `${funcao} mostraria o texto cru do Postgres na tela`);
  }
});

// ---------------------------------------------------------------------------
// 4. Trava de não regressão
// ---------------------------------------------------------------------------

test("APROVAR NÃO É PAGAR: a correção não move nenhum saldo", async () => {
  const sql = await read(MIGRATION);
  const aprovar = corpoDaFuncao(sql, "aprovar_programacao_pagamento");

  for (const proibido of ["saldos_historico", "pagamentos_baixas", "pagamento_movimentacoes", "saldo_atual", "valor_pago", "pago_em"]) {
    assert.ok(!aprovar.includes(proibido), `a aprovação mexeu em ${proibido}`);
  }
  assert.match(aprovar, /set status = 'aprovada'/);
  assert.match(aprovar, /'movimentou_saldo', false/);

  const salvar = corpoDaFuncao(sql, "salvar_planejamento_programacao");
  for (const proibido of ["saldos_historico", "pagamentos_baixas", "pagamento_movimentacoes"]) {
    assert.ok(!salvar.includes(proibido), `o salvamento mexeu em ${proibido}`);
  }
});

test("a migration é aditiva e idempotente: nenhuma estrutura e nenhum dado muda", async () => {
  const sql = await read(MIGRATION);
  assert.doesNotMatch(sql, /drop table|drop function|drop column|drop policy|truncate|delete from|alter table|create table/i);
  assert.doesNotMatch(sql, /\bupdate public\.(contas_bancarias|fornecedores|certidoes|tarefas|configuracoes|usuarios)\b/i);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);

  // Só corpo de função é substituído; assinatura, retorno e grant permanecem.
  const definicoes = [...sql.matchAll(/create (or replace )?function/g)];
  assert.equal(definicoes.length, 4, "a migration cria ou substitui exatamente quatro funções");
  for (const definicao of definicoes) assert.ok(definicao[1], "função criada sem `or replace`: rodar de novo falharia");

  for (const funcao of ["aprovar_programacao_pagamento", "salvar_planejamento_programacao", "marcar_programacao_em_analise", "tipo_da_coluna"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${funcao}\\(`), `grant ausente: ${funcao}`);
  }
});

test("a assinatura que a tela chama continua a mesma", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /aprovar_programacao_pagamento\(\s*\n\s*p_programacao_id integer,\s*\n\s*p_saldo_considerado numeric default null,\s*\n\s*p_total_programado numeric default null,\s*\n\s*p_restante numeric default null\s*\n\)/);
  assert.match(sql, /grant execute on function public\.aprovar_programacao_pagamento\(integer, numeric, numeric, numeric\) to authenticated/);
  assert.match(sql, /grant execute on function public\.salvar_planejamento_programacao\(integer, jsonb, jsonb, numeric, numeric, numeric\) to authenticated/);
  assert.match(sql, /grant execute on function public\.marcar_programacao_em_analise\(integer\) to authenticated/);
});
