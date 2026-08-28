// Testes do apagão de diagnóstico na transferência entre contas.
//
// UMA transferência VÁLIDA (mesma secretaria, saldo suficiente, somas
// conferidas) era recusada e a tela mostrava só "Não foi possível concluir a
// operação." -- sem etapa, sem código, sem detalhe. A frase não vinha do banco:
// vinha de `errorResponse`, em netlify/functions/_shared/auth.mts. No caminho
// normal do postgrest-js a recusa chega como OBJETO SIMPLES, então
// `error instanceof Error` dava false, a frase literal era devolvida e code,
// message, details e hint eram descartados sem passar por nenhum log.
//
// O que estes testes travam:
//
//   O ERRO COMPLETO DO BANCO É REGISTRADO ANTES DE QUALQUER MENSAGEM NA TELA
//   code, message, details E hint ATRAVESSAM A FUNÇÃO ATÉ O NAVEGADOR
//   AS TRÊS FUNÇÕES DIZEM EM QUE ETAPA QUEBRARAM E COM QUE CÓDIGO
//   42P01/42703/42883/42P13 CONTINUAM PASSANDO INTACTOS
//   AS COMPARAÇÕES DE COLUNA LEGADA SÃO À PROVA DE TIPO
//   SEGREGAÇÃO, IDEMPOTÊNCIA, ADVISORY LOCK, ATOMICIDADE E TRILHA ATÔMICA INTACTAS
//   O DIAGNÓSTICO NÃO GRAVA NADA
//   NENHUM OUTRO MÓDULO É TOCADO

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const MIGRATION = "supabase/migrations/20260828230000_diagnosticar_transferencia_entre_contas.sql";
const MIGRATION_ANTERIOR = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";
const AUTH = "netlify/functions/_shared/auth.mts";
const FUNCAO_HTTP = "netlify/functions/account-transfers.mts";
const TRANSPORTE = "src/lib/transferenciasContas.js";

const CODIGOS_QUE_PASSAM = ["P0001", "42501", "42P01", "42703", "42883", "42P13"];

const FUNCOES_COM_ETAPA = [
  { nome: "definir_conta_origem_pagamento", frase: "definir a conta de pagamento na etapa" },
  { nome: "confirmar_transferencias_programacao", frase: "concluir a transferência entre contas na etapa" },
  { nome: "estornar_transferencia", frase: "concluir o estorno da transferência na etapa" },
];

function semComentarios(sql) {
  return sql
    .split("\n")
    .filter((linha) => !/^\s*--/.test(linha))
    .join("\n");
}

function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio > 0, `função ausente: ${nome}`);
  const trecho = sql.slice(inicio);
  const fim = trecho.search(/\nend \$\$;|\n\$fn\$;/);
  assert.ok(fim > 0, `fim de corpo não encontrado: ${nome}`);
  return trecho.slice(0, fim);
}

// ---------------------------------------------------------------------------
// 1. A causa do apagão: a frase da tela nascia na função Netlify
// ---------------------------------------------------------------------------

test("a frase genérica não é mais a resposta para toda recusa do banco", async () => {
  const auth = await read(AUTH);

  // A recusa do postgrest-js é objeto simples: decidir pelo `instanceof Error`
  // era exatamente o que jogava code, message, details e hint no lixo.
  assert.doesNotMatch(
    auth,
    /const message = error instanceof Error \? error\.message : "Não foi possível concluir a operação\."/,
  );
  assert.match(auth, /error && typeof error === "object"/);

  // A frase literal continua existindo, mas só como último recurso, quando o
  // erro não trouxe mensagem nenhuma.
  assert.match(auth, /campos\.message \?\? "Não foi possível concluir a operação\."/);
});

test("o erro completo do Supabase é registrado antes de qualquer resposta", async () => {
  const auth = await read(AUTH);
  const trecho = auth.slice(auth.indexOf("export function errorResponse"));

  const posicaoLog = trecho.indexOf("console.error");
  const posicaoResposta = trecho.indexOf("Response.json");
  assert.ok(posicaoLog > 0, "errorResponse não registra o erro");
  assert.ok(posicaoLog < posicaoResposta, "o log tem de acontecer ANTES de montar a resposta");

  for (const campo of ["code", "message", "details", "hint"]) {
    assert.match(trecho, new RegExp(`${campo}: campos\\.${campo}`), `campo ausente no log: ${campo}`);
  }
});

test("code, details e hint chegam ao navegador junto com a mensagem", async () => {
  const auth = await read(AUTH);
  const resposta = auth.slice(auth.indexOf("export function errorResponse"));
  assert.match(resposta, /error: campos\.message/);
  assert.match(resposta, /code: campos\.code/);
  assert.match(resposta, /details: campos\.details/);
  assert.match(resposta, /hint: campos\.hint/);

  // O status continua 500: mudar isso mexeria no comportamento de telas que
  // nada têm a ver com transferência.
  assert.match(resposta, /\{ status: 500 \}/);
});

test("a função de transferência registra a recusa com a função e os argumentos chamados", async () => {
  const funcao = await read(FUNCAO_HTTP);
  assert.match(funcao, /function registrarRecusa\(/);
  assert.match(funcao, /registrarRecusa\(\s*"confirmar_transferencias_programacao"/);
  assert.match(funcao, /registrarRecusa\(\s*"estornar_transferencia"/);
  for (const campo of ["code", "message", "details", "hint"]) {
    assert.match(funcao, new RegExp(`${campo}: campo\\("${campo}"\\)`), `campo ausente no log: ${campo}`);
  }

  // A chave de idempotência não entra no log: ela é identificador de operação,
  // não dado de diagnóstico.
  const log = funcao.slice(funcao.indexOf("function registrarRecusa"), funcao.indexOf("Cópia de conferência"));
  assert.doesNotMatch(log, /idempotencyKey|p_chave_idempotencia/);
});

test("o navegador registra o erro completo antes de a tela mostrar qualquer frase", async () => {
  const transporte = await read(TRANSPORTE);

  const posicaoLog = transporte.indexOf("console.error");
  const posicaoThrow = transporte.indexOf("throw falha;");
  assert.ok(posicaoLog > 0 && posicaoThrow > posicaoLog, "o log tem de vir antes de a falha subir para a tela");

  for (const campo of ["code", "message", "details", "hint", "status"]) {
    assert.match(transporte, new RegExp(`${campo}: falha\\.${campo}`), `campo ausente no log: ${campo}`);
  }
  // A etapa sai separada, sem precisar ler o DETAIL inteiro no console.
  assert.match(transporte, /detalheDoBanco\(falha\)/);
});

test("a falha entregue à tela tem a forma de um erro do Supabase, sem deixar de ser Error", async () => {
  const transporte = await read(TRANSPORTE);
  assert.match(transporte, /class ErroDaTransferencia extends Error/);
  for (const campo of ["code", "details", "hint", "status"]) {
    assert.match(transporte, new RegExp(`this\\.${campo} = ${campo} \\?\\? null;`), `campo ausente: ${campo}`);
  }
  // `new Error(body.error)` sozinho apagava o código -- e sem código
  // mensagemAmigavel não sabe distinguir frase escrita para o usuário de texto
  // técnico.
  assert.doesNotMatch(transporte, /throw new Error\(body\.error/);
});

// ---------------------------------------------------------------------------
// 2. A etapa nomeada nas três funções
// ---------------------------------------------------------------------------

test("as três funções dizem em que etapa quebraram e com que código", async () => {
  const sql = semComentarios(await read(MIGRATION));

  for (const { nome, frase } of FUNCOES_COM_ETAPA) {
    const corpo = corpoDaFuncao(sql, nome);
    assert.match(corpo, /v_etapa text := 'início';/, `${nome}: etapa não é variável`);
    assert.match(corpo, new RegExp(`'Não foi possível ${frase} "%"`), `${nome}: mensagem sem etapa`);
    assert.match(corpo, /O banco recusou a operação com o código %\./, `${nome}: mensagem sem código`);
    assert.match(corpo, /using errcode = 'P0001'/, `${nome}: a recusa reescrita precisa sair como P0001`);

    // A mensagem da tela nunca cita Postgres, tabela ou coluna: isso fica no
    // DETAIL, que só o console lê.
    const mensagem = corpo.slice(corpo.indexOf("raise exception\n      'Não foi possível"));
    assert.doesNotMatch(mensagem.split("\n")[1], /public\.|postgres|sqlstate/i);
  }
});

test("o DETAIL leva a mensagem crua do banco, a etapa e o tipo real das colunas", async () => {
  const sql = semComentarios(await read(MIGRATION));

  for (const { nome } of FUNCOES_COM_ETAPA) {
    const corpo = corpoDaFuncao(sql, nome);
    assert.match(corpo, /detail = format\(/, `${nome}: sem DETAIL`);
    assert.match(corpo, /sqlerrm, v_etapa, sqlstate,/, `${nome}: DETAIL sem mensagem crua`);
    assert.match(corpo, /etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s/, `${nome}: DETAIL fora do formato que a tela sabe ler`);
    assert.match(corpo, /public\.tipo_da_coluna\(/, `${nome}: DETAIL sem tipo real das colunas`);
    assert.match(corpo, /hint = 'Leia o DETAIL/, `${nome}: sem HINT apontando o DETAIL`);

    // get stacked diagnostics: um raise novo perderia constraint, tabela e
    // coluna, que é justamente o que identifica a recusa em um único teste.
    assert.match(corpo, /get stacked diagnostics/, `${nome}: sem os campos estruturados do erro`);
  }

  const confirmar = corpoDaFuncao(sql, "confirmar_transferencias_programacao");
  for (const coluna of [
    ["contas_bancarias", "ativo"],
    ["saldos_historico", "data_saldo"],
    ["transferencia_lotes", "usuario_id"],
    ["transferencias_contas", "usuario_id"],
    ["auditoria_eventos", "usuario_id"],
  ]) {
    assert.match(
      confirmar,
      new RegExp(`public\\.tipo_da_coluna\\('${coluna[0]}', '${coluna[1]}'\\)`),
      `coluna suspeita ausente do DETAIL: ${coluna.join(".")}`,
    );
  }
});

test("os códigos de objeto ausente e de permissão passam intactos", async () => {
  const sql = semComentarios(await read(MIGRATION));

  for (const { nome } of FUNCOES_COM_ETAPA) {
    const corpo = corpoDaFuncao(sql, nome);
    const guarda = corpo.slice(corpo.indexOf("if sqlstate in ("));
    for (const codigo of CODIGOS_QUE_PASSAM) {
      assert.match(guarda, new RegExp(`'${codigo}'`), `${nome}: ${codigo} deixaria de passar intacto`);
    }
    // `raise;` sem argumento: relevanta o erro original, com código e detalhe.
    assert.match(guarda, /\n      raise;\n/, `${nome}: o erro original não é relevantado`);
  }
});

// ---------------------------------------------------------------------------
// 3. As conversões à prova de tipo
// ---------------------------------------------------------------------------

test("definir_conta_origem_pagamento ganhou as conversões que faltavam", async () => {
  const anterior = corpoDaFuncao(semComentarios(await read(MIGRATION_ANTERIOR)), "definir_conta_origem_pagamento");
  const atual = corpoDaFuncao(semComentarios(await read(MIGRATION)), "definir_conta_origem_pagamento");

  // O defeito que existia: colunas legadas lidas sem ::text.
  assert.match(anterior, /pr\.secretaria_id, pr\.status, pr\.fechado/);
  assert.match(anterior, /v_fechado boolean/);
  assert.match(anterior, /coalesce\(p\.situacao, ''\)/);
  assert.match(anterior, /pc\.ativa = true/);

  assert.match(atual, /pr\.secretaria_id, pr\.status::text, pr\.fechado::text/);
  assert.match(atual, /coalesce\(p\.situacao::text, ''\) <> 'cancelado'/);
  assert.match(atual, /lower\(coalesce\(pc\.ativa::text, ''\)\) in \('true', 't', 'sim', '1', 'y', 'yes'\)/);
  assert.match(atual, /lower\(coalesce\(v_fechado_texto, ''\)\) in \('true', 't', 'sim', '1', 'y', 'yes'\)/);
  assert.doesNotMatch(atual, /v_fechado boolean/);
  assert.doesNotMatch(atual, /pc\.ativa = true/);
  assert.doesNotMatch(atual, /coalesce\(p\.situacao, ''\)/);
});

test("contas_bancarias.ativo passa a ser lido como texto nas duas transferências", async () => {
  const atual = semComentarios(await read(MIGRATION));
  for (const nome of ["definir_conta_origem_pagamento", "confirmar_transferencias_programacao"]) {
    const corpo = corpoDaFuncao(atual, nome);
    assert.match(corpo, /coalesce\(cb\.ativo::text, 'true'\)/, `${nome}: ativo ainda vai direto para boolean`);
    assert.doesNotMatch(corpo, /coalesce\(cb\.ativo, true\)/, `${nome}: leitura antiga de ativo ainda presente`);
    assert.doesNotMatch(corpo, /_ativa boolean;/, `${nome}: variável boolean recebendo coluna legada`);
  }

  // A regra não mudou: conta desativada continua recusada, com a mesma frase.
  const confirmar = corpoDaFuncao(atual, "confirmar_transferencias_programacao");
  assert.match(confirmar, /Conta de destino desativada não pode receber transferência\./);
  assert.match(confirmar, /Conta de origem desativada não pode transferir\./);
});

// ---------------------------------------------------------------------------
// 4. A trava de não regressão
// ---------------------------------------------------------------------------

test("segregação por secretaria continua idêntica, com a mesma exceção", async () => {
  const confirmar = corpoDaFuncao(semComentarios(await read(MIGRATION)), "confirmar_transferencias_programacao");
  assert.match(confirmar, /if v_origem_secretaria is distinct from v_destino_secretaria then/);
  assert.match(confirmar, /public\.transferencia_entre_secretarias_permitida\(v_secretaria_origem_nome, v_secretaria_destino_nome\)/);
  assert.match(
    confirmar,
    /A única exceção é a Secretaria de Finanças para Saúde, Educação e Assistência Social\./,
  );
});

test("idempotência, advisory lock e o upsert de saldo continuam onde estavam", async () => {
  const sql = semComentarios(await read(MIGRATION));

  const confirmar = corpoDaFuncao(sql, "confirmar_transferencias_programacao");
  assert.match(confirmar, /on conflict \(chave_idempotencia\) do nothing/);
  assert.match(confirmar, /'ja_confirmada', true/);
  assert.match(confirmar, /perform pg_advisory_xact_lock\(918273645, v_conta\);/);

  const estornar = corpoDaFuncao(sql, "estornar_transferencia");
  assert.match(estornar, /'estorno:' \|\| p_transferencia_id::text/);
  assert.match(estornar, /on conflict \(chave_idempotencia\) do nothing/);
  assert.match(estornar, /pg_advisory_xact_lock\(918273645, least\(v_origem_id, v_destino_id\)\)/);
  assert.match(estornar, /pg_advisory_xact_lock\(918273645, greatest\(v_origem_id, v_destino_id\)\)/);

  // Todo lançamento de saldo continua sendo upsert por (conta_id, data_saldo):
  // é o que impede duas linhas do mesmo dia para a mesma conta.
  const lancamentos = [...sql.matchAll(/insert into public\.saldos_historico[\s\S]{0,220}?;/g)];
  assert.equal(lancamentos.length, 4, "o número de lançamentos de saldo mudou");
  for (const [lancamento] of lancamentos) {
    assert.match(lancamento, /on conflict \(conta_id, data_saldo\)\s*\n\s*do update set valor_saldo = excluded\.valor_saldo/);
  }
});

test("a trilha da transferência continua atômica com a movimentação de saldo", async () => {
  const sql = semComentarios(await read(MIGRATION));

  for (const nome of ["confirmar_transferencias_programacao", "estornar_transferencia"]) {
    const corpo = corpoDaFuncao(sql, nome);
    const trilha = corpo.slice(corpo.indexOf("insert into public.auditoria_eventos"));
    // Nada de `begin ... exception` em volta da trilha: aqui o dinheiro se move,
    // e movimentação sem trilha não vale. As duas caem juntas.
    assert.doesNotMatch(trilha.slice(0, 40), /begin/);
    assert.doesNotMatch(corpo, /begin\s*\n\s*insert into public\.auditoria_eventos/, `${nome}: trilha isolada`);
  }

  // Em definir_conta_origem_pagamento é o contrário: nada de dinheiro se move,
  // então uma falha só de trilha não pode derrubar o vínculo já gravado.
  const definir = corpoDaFuncao(sql, "definir_conta_origem_pagamento");
  assert.match(definir, /begin\s*\n\s*insert into public\.auditoria_eventos/);
  assert.match(definir, /raise warning 'Conta de pagamento da programação % definida/);
});

test("NÃO É DESPESA: a transferência continua sem tocar baixas e movimentações", async () => {
  // Fora os `comment on`, que só documentam essa mesma regra.
  const sql = semComentarios(await read(MIGRATION)).replace(/comment on [\s\S]*?';/g, "");
  assert.doesNotMatch(sql, /pagamento_movimentacoes|pagamentos_baixas|marcar_pagamento_pago/i);
  for (const nome of ["confirmar_transferencias_programacao", "estornar_transferencia"]) {
    assert.match(corpoDaFuncao(sql, nome), /'eh_despesa', false/, `${nome}: perdeu a marca de não-despesa`);
  }
});

test("as assinaturas chamadas pela tela continuam as mesmas", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /grant execute on function public\.confirmar_transferencias_programacao\(integer, integer, jsonb, text, text\) to authenticated;/);
  assert.match(sql, /grant execute on function public\.estornar_transferencia\(uuid, text\) to authenticated;/);
  assert.match(sql, /grant execute on function public\.definir_conta_origem_pagamento\(integer, integer\[\], integer\) to authenticated;/);
});

// ---------------------------------------------------------------------------
// 5. O diagnóstico
// ---------------------------------------------------------------------------

test("o diagnóstico responde os quatro pontos e não grava nada", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const corpo = corpoDaFuncao(sql, "diagnostico_transferencia_contas");

  // 1. vínculo real de cada coluna de usuário e o que o resolvedor devolve nela
  assert.match(corpo, /pg_constraint/);
  for (const par of [
    "'transferencia_lotes', 'usuario_id'",
    "'transferencia_lotes', 'estornado_por'",
    "'transferencias_contas', 'usuario_id'",
    "'transferencias_contas', 'estornada_por'",
    "'auditoria_eventos', 'usuario_id'",
  ]) {
    assert.ok(corpo.includes(`(${par})`), `par ausente no diagnóstico: ${par}`);
  }
  assert.match(corpo, /public\.usuario_para_coluna\(v_par\.tabela, v_par\.coluna\)/);

  // 2. o índice único que o `on conflict (conta_id, data_saldo)` usa de árbitro
  assert.match(corpo, /array\['conta_id', 'data_saldo'\]::text\[\]/);
  assert.match(corpo, /'indice_unico_conta_id_data_saldo', v_indice_ok/);

  // 3. o par origem/destino, e a constatação de que banco não entra na regra
  assert.match(corpo, /'mesma_secretaria', v_mesma_secretaria/);
  assert.match(corpo, /'a_regra_olha_banco', false/);

  // 4. a permissão de transferir
  assert.match(corpo, /public\.pode_em_pagamentos_fase2\('executar_transferencia'\)/);

  // Só leitura: nenhuma escrita, em nenhuma tabela. (O cabeçalho `create or
  // replace function` fica fora da conta -- o que importa é o corpo.)
  const somenteCorpo = corpo.slice(corpo.indexOf("as $fn$"));
  assert.doesNotMatch(
    somenteCorpo,
    /\binsert into\b|\bupdate\s+public\.|\bdelete from\b|\bcreate table\b|\bdrop \b|\balter \b|\bperform\b/i,
  );
});

test("o diagnóstico também expõe o que derrubaria a trilha atômica", async () => {
  const corpo = corpoDaFuncao(semComentarios(await read(MIGRATION)), "diagnostico_transferencia_contas");
  // RLS forçada aplica política até para o dono da tabela. Como a trilha da
  // transferência é atômica com a movimentação, isso derrubaria a transferência
  // inteira -- e é invisível sem olhar o catálogo.
  assert.match(corpo, /'rls_forcada', c\.relforcerowsecurity/);
  assert.match(corpo, /'dono', pg_get_userbyid\(c\.relowner\)/);
  assert.match(corpo, /'colunas_obrigatorias_sem_default'/);
  assert.match(corpo, /'restricoes_de_verificacao'/);
  assert.match(corpo, /'gatilhos'/);
});

// ---------------------------------------------------------------------------
// 6. Aditiva, idempotente e sem invadir outro módulo
// ---------------------------------------------------------------------------

test("a migration é aditiva e idempotente: nenhuma estrutura e nenhum dado muda", async () => {
  const sql = await read(MIGRATION);
  assert.doesNotMatch(
    sql,
    /drop table|drop function|drop column|drop policy|truncate|delete from|alter table|create table|create policy|create index|grant .* on table/i,
  );
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);

  const definicoes = [...sql.matchAll(/create (or replace )?function/g)];
  assert.equal(definicoes.length, 5, "a migration cria ou substitui exatamente cinco funções");
  for (const definicao of definicoes) assert.ok(definicao[1], "função criada sem `or replace`: rodar de novo falharia");

  assert.doesNotMatch(
    semComentarios(sql),
    /\b(insert into|update) public\.(usuarios|contas_bancarias|fornecedores|certidoes|tarefas|configuracoes|secretarias)\b/i,
  );
});

test("nenhum outro módulo é tocado", async () => {
  const sql = semComentarios(await read(MIGRATION));
  assert.doesNotMatch(
    sql,
    /create or replace function public\.(salvar_planejamento_programacao|marcar_programacao_em_analise|aprovar_programacao_pagamento|pode_em_pagamentos_fase2|usuario_para_coluna|usuario_registro_id|rastro_do_login|transferencia_entre_secretarias_permitida)\b/,
  );
  assert.doesNotMatch(sql, /\b(certidoes|tarefas|backups|relatorio_|configuracoes)\b/i);
});

test("as migrations já aplicadas continuam no disco, inteiras", async () => {
  for (const [caminho, funcao] of [
    [MIGRATION_ANTERIOR, "confirmar_transferencias_programacao"],
    ["supabase/migrations/20260828140000_execucao_financeira_fase_2.sql", "confirmar_transferencias_programacao"],
    ["supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql", "aprovar_programacao_pagamento"],
    ["supabase/migrations/20260828190000_corrigir_gravacao_fornecedores_programacao.sql", "salvar_planejamento_programacao"],
  ]) {
    const sql = await read(caminho);
    assert.match(sql, new RegExp(`create or replace function public\\.${funcao}`));
    assert.match(sql, /^commit;$/m);
  }
});
