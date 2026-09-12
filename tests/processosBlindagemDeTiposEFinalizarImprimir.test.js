import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mensagemFalhaDoProcesso, MIGRATION_BLINDAGEM_PROCESSOS, ehRecusaDeTipo } from "../src/lib/processosErros.js";
import { primeiroErro as primeiroErroServico, validarFinalizacao as validarFinalizacaoServico, processoVazio as processoVazioServico } from "../src/lib/processosServicos.js";
import { primeiroErro as primeiroErroDiaria, validarFinalizacao as validarFinalizacaoDiaria, processoVazio as processoVazioDiaria } from "../src/lib/processosDiarias.js";

/**
 * PROCESSOS — A QUARTA VEZ DO MESMO 22P02, E A VARREDURA PARA NÃO HAVER UMA
 * QUINTA.
 *
 * O DEFEITO RELATADO: salvar o processo de serviços/materiais na página 2
 * (Liquidação / solicitação de pagamento) era recusado com 22P02 em toda
 * tentativa. A causa medida: `encaminhar_secretaria_id` foi criada como `uuid`
 * escrito à mão na 20260912120000, mas guarda o id de public.secretarias -- o
 * cadastro do FINANCEIRO, cujo id é integer neste banco. A tela mandava "3", e
 * o Postgres recusava antes de olhar qualquer dado. processos_diarias tinha a
 * coluna gêmea, com o mesmo defeito à espera.
 *
 * O que este arquivo exige, em ordem:
 *   1. a coluna passa a ser text nas DUAS tabelas, e o salvamento da página 2
 *      volta a funcionar -- provado em Postgres de verdade, com o defeito
 *      reproduzido antes;
 *   2. TODAS as seis funções do módulo Processos estão varridas: leitura ::text,
 *      etapa nomeada e tipo real das colunas na falha inesperada;
 *   3. a mensagem ao operador diz O QUE FAZER, não só o código;
 *   4. "Finalizar e imprimir" finaliza o processo e abre a impressão das
 *      páginas completas numa única ação, nos dois tipos de processo;
 *   5. NADA financeiro se move: nem saldo, nem baixa, nem NF, nem programação.
 *
 * ⚠️ FINALIZAR NÃO É PAGAR, e IMPRIMIR NÃO ALTERA O PROCESSO. Os dois ensaios
 * finais conferem isso somando o financeiro antes e depois de tudo.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const read = (caminho) => readFile(join(RAIZ, caminho), "utf8");
const lerSync = (caminho) => readFileSync(join(RAIZ, caminho), "utf8");

const MIGRATION = "supabase/migrations/20260912200000_processos_blindagem_de_tipos_e_encaminhamento.sql";
const MIGRATION_DEFEITO = "supabase/migrations/20260912120000_processos_datas_por_documento_e_encaminhamento.sql";
const MIGRATION_DIARIAS = "supabase/migrations/20260911160000_processos_modulo_diarias.sql";
const MIGRATION_SERVICOS = "supabase/migrations/20260911260000_processos_modulo_servicos.sql";
const MIGRATION_SERVIDORES = "supabase/migrations/20260911230000_processos_servidores_e_ajustes_documento.sql";

const MODAL_SERVICO = "src/components/processos/ModalProcessoServico.jsx";
const MODAL_DIARIA = "src/components/processos/ModalProcessoDiaria.jsx";
const PAGINA_SERVICOS = "src/components/processos/PaginaServicos.jsx";
const PAGINA_DIARIAS = "src/components/processos/PaginaDiarias.jsx";

/** As SEIS funções do módulo Processos. A varredura pedida é esta lista inteira. */
const FUNCOES_DO_MODULO = [
  "pode_em_processos",
  "proximo_numero_processo_diaria",
  "proximo_numero_processo_servico",
  "conferir_alteracao_processo_diaria",
  "conferir_alteracao_processo_servico",
  "conferir_alteracao_servidor_processos",
];

function semComentarios(sql) {
  return sql
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
}

/** O corpo de uma função, do `create or replace` até o fim do bloco. */
function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio >= 0, `a função ${nome} não está na migration`);
  const fim = sql.indexOf("\n$fn$;", inicio);
  assert.ok(fim > inicio, `a função ${nome} não fecha com $fn$`);
  return sql.slice(inicio, fim + 6);
}

/* -------------------------------------------------------------------------
 * 1. A COLUNA DO DEFEITO
 * ---------------------------------------------------------------------- */

test("a coluna do encaminhamento deixa de ser uuid e passa a text nas duas tabelas", async () => {
  // O defeito, documentado onde nasceu: tipo escrito à mão no arquivo.
  const defeito = semComentarios(await read(MIGRATION_DEFEITO));
  assert.match(defeito, /add column if not exists encaminhar_secretaria_id uuid/);
  assert.equal((defeito.match(/encaminhar_secretaria_id uuid/g) ?? []).length, 2);

  const sql = semComentarios(await read(MIGRATION));
  // A conversão acontece nas duas tabelas, pela mesma volta do laço.
  assert.match(sql, /array\['processos_servicos',\s*'processos_diarias'\]/);
  assert.match(sql, /alter column encaminhar_secretaria_id type text using encaminhar_secretaria_id::text/);
  // Idempotente: só converte se ainda não for text, e cria como text se faltar.
  assert.match(sql, /if v_tipo = 'coluna ausente' then/);
  assert.match(sql, /elsif v_tipo <> 'text' then/);
  // O tipo é lido do CATÁLOGO, nunca suposto.
  assert.match(sql, /v_tipo := public\.tipo_da_coluna\(v_tabela, 'encaminhar_secretaria_id'\)/);
  // Nenhuma outra coluna tem o tipo trocado.
  const alteracoes = sql.match(/alter column \w+ type/g) ?? [];
  assert.deepEqual(alteracoes, ["alter column encaminhar_secretaria_id type"]);
});

test("a migration não cria, apaga nem renomeia nada, e não toca em tabela financeira", async () => {
  const sql = semComentarios(await read(MIGRATION));

  for (const proibido of [
    "public.pagamentos",
    "public.pagamentos_baixas",
    "public.valores_em_aberto",
    "public.saldos_historico",
    "public.contas_bancarias",
    "public.transferencias_contas",
    "public.programacoes_pagamento",
    "public.programacao_contas",
  ]) {
    assert.ok(!sql.includes(proibido), `a migration não pode mencionar ${proibido}`);
  }

  // Estrutura: nada de tabela, gatilho, política, índice ou coluna removida.
  for (const proibido of [
    /\bcreate table\b/i,
    /\bdrop table\b/i,
    /\bdrop column\b/i,
    /\bdrop trigger\b/i,
    /\bcreate trigger\b/i,
    /\bdrop policy\b/i,
    /\bcreate policy\b/i,
    /\brename\b/i,
    /\btruncate\b/i,
    /\bdelete from\b/i,
  ]) {
    assert.ok(!proibido.test(sql), `a migration não pode conter ${proibido}`);
  }

  // O cadastro de secretarias do financeiro é só referência em comentário: não
  // é lido, escrito nem travado por chave estrangeira.
  assert.ok(!/references\s+public\.secretarias/i.test(sql));
  assert.ok(!/(insert|update|delete)\s+[\s\S]{0,40}public\.secretarias/i.test(sql));

  // E o arquivo avisa que é rodado à mão, com o próprio nome dentro.
  const bruto = await read(MIGRATION);
  assert.match(bruto, /rodada MANUALMENTE no SQL Editor do\n-- Supabase/);
  assert.match(bruto, /20260912200000_processos_blindagem_de_tipos_e_encaminhamento\.sql/);
});

/* -------------------------------------------------------------------------
 * 2. A VARREDURA: as seis funções do módulo
 * ---------------------------------------------------------------------- */

test("a varredura cobre TODAS as funções do módulo Processos", async () => {
  const sql = semComentarios(await read(MIGRATION));

  // Nenhuma função do módulo existe fora desta lista: se alguém criar uma nova
  // sem blindar, este teste quebra junto com a lista.
  const existentes = new Set();
  for (const arquivo of [MIGRATION_DIARIAS, MIGRATION_SERVICOS, MIGRATION_SERVIDORES]) {
    for (const achado of lerSync(arquivo).matchAll(/create or replace function public\.(\w+)\s*\(/g)) {
      existentes.add(achado[1]);
    }
  }
  for (const nome of existentes) {
    assert.ok(
      FUNCOES_DO_MODULO.includes(nome),
      `${nome} é função do módulo Processos e ficou fora da varredura`,
    );
  }
  for (const nome of FUNCOES_DO_MODULO) {
    assert.ok(sql.includes(`create or replace function public.${nome}(`), `${nome} não foi refeita`);
  }

  // Os cadastros que NÃO têm função própria entram pela porta única, e o
  // arquivo diz isso por escrito para quem for varrer de novo.
  const bruto = await read(MIGRATION);
  assert.match(bruto, /NÃO TÊM FUNÇÃO PRÓPRIA/);
  for (const cadastro of ["secretarias\nsolicitantes", "bancos", "tabela de diárias", "prefeita"]) {
    assert.ok(bruto.includes(cadastro.replace("\n", " ")) || bruto.includes(cadastro), cadastro);
  }
});

test("cada função varrida lê como texto, nomeia a ETAPA e diz o tipo real das colunas", async () => {
  const sql = semComentarios(await read(MIGRATION));

  for (const nome of FUNCOES_DO_MODULO) {
    const corpo = corpoDaFuncao(sql, nome);

    // Etapa nomeada, no mesmo padrão de confirmar_transferencias_programacao e
    // aprovar_programacao_pagamento.
    assert.match(corpo, /v_etapa text := 'início';/, nome);
    assert.ok((corpo.match(/v_etapa := /g) ?? []).length >= 3, `${nome} precisa nomear as etapas`);

    // Tratador de erro com diagnóstico, tipo real das colunas e recado de leitura.
    assert.match(corpo, /get stacked diagnostics/, nome);
    assert.match(corpo, /errcode = 'P0001'/, nome);
    assert.match(corpo, /public\.tipo_da_coluna\(/, nome);
    assert.match(corpo, /hint = 'Leia o DETAIL/, nome);
    assert.match(corpo, /etapa=%s sqlstate=%s/, nome);

    // As mensagens escritas para o usuário, as recusas de permissão e a falta de
    // estrutura passam intactas -- é como a tela reconhece cada caso.
    assert.match(
      corpo,
      /sqlstate in \('P0001', '42501', '42P01', '42703', '42883', '42P13'\)\s*then\s*raise;/,
      nome,
    );

    // E a mensagem do usuário cita a etapa e o código, nunca só o código.
    assert.match(corpo, /na etapa "%"\. O banco recusou/, nome);
  }
});

test("nenhuma comparação de coluna que pode ser enum ou domínio ficou sem ::text", async () => {
  const sql = semComentarios(await read(MIGRATION));

  // situacao e status: SEMPRE ::text quando comparados com literal.
  for (const achado of sql.matchAll(/(new|old|u|pe|p)\.(situacao|status)(::text)?\s*(=|<>|is distinct from)/g)) {
    assert.equal(achado[3], "::text", `comparação sem ::text: ${achado[0]}`);
  }

  // As colunas de permissão saem ::text e são lidas por public.texto_verdadeiro,
  // para que os ramos do case tenham todos o mesmo tipo.
  const porta = corpoDaFuncao(sql, "pode_em_processos");
  for (const coluna of ["pode_visualizar", "pode_cadastrar", "pode_editar", "pode_excluir", "pode_aprovar"]) {
    assert.ok(porta.includes(`pe.${coluna}::text`), `${coluna} sem ::text na porta do módulo`);
  }
  assert.match(porta, /public\.texto_verdadeiro\(v_texto\)/);
  assert.match(porta, /pe\.modulo::text = p_modulo/);
  assert.match(porta, /u\.status::text = 'ativo'/);

  // Os dois ajudantes da blindagem vêm no arquivo, com o corpo de sempre.
  assert.match(sql, /create or replace function public\.tipo_da_coluna\(p_tabela text, p_coluna text\)/);
  assert.match(sql, /create or replace function public\.texto_verdadeiro\(p_texto text\)/);
  assert.match(sql, /'coluna ausente'/);
});

test("a porta do módulo mantém o mesmo mapa de ação para coluna, e a mesma resposta padrão", async () => {
  const sql = semComentarios(await read(MIGRATION));
  const porta = corpoDaFuncao(sql, "pode_em_processos");

  // O MESMO mapa de antes: nenhuma permissão é ampliada nem reduzida.
  for (const [acao, coluna] of [
    ["visualizar", "pode_visualizar"],
    ["cadastrar", "pode_cadastrar"],
    ["editar", "pode_editar"],
    ["excluir", "pode_excluir"],
    ["aprovar", "pode_aprovar"],
  ]) {
    assert.ok(new RegExp(`when '${acao}'\\s+then '${coluna}'`).test(porta), `${acao} -> ${coluna}`);
  }
  // Ação desconhecida e usuário sem linha continuam devolvendo false.
  assert.match(porta, /else null\s*\n\s*end;/);
  assert.match(porta, /return coalesce\(public\.texto_verdadeiro\(v_texto\), false\);/);
  // Continua sendo a mesma função para a RLS: estável e security definer.
  assert.match(porta, /stable\s*\nsecurity definer\s*\nset search_path = public/);
});

/* -------------------------------------------------------------------------
 * 3. A MENSAGEM PARA QUEM OPERA A TELA
 * ---------------------------------------------------------------------- */

test("a recusa por tipo diz o que fazer, e não manda o operador abrir o console", async () => {
  const texto = mensagemFalhaDoProcesso(
    { code: "22P02", message: 'invalid input syntax for type uuid: "3"' },
    "Não foi possível salvar as alterações.",
  );

  // Começa pelo que a pessoa estava fazendo.
  assert.match(texto, /^Não foi possível salvar as alterações\./);
  // Diz que não foi ela e que nada foi gravado.
  assert.match(texto, /NÃO É O QUE VOCÊ DIGITOU/);
  assert.match(texto, /nada foi gravado, finalizado ou alterado/);
  assert.match(texto, /nenhum saldo, baixa, NF ou programação foi tocado/);
  // Diz o que fazer, com o arquivo que corrige e onde rodar.
  assert.match(texto, /O QUE FAZER: não refaça o preenchimento/);
  assert.match(texto, /SQL Editor do Supabase/);
  assert.ok(texto.includes(MIGRATION_BLINDAGEM_PROCESSOS));
  assert.equal(
    MIGRATION_BLINDAGEM_PROCESSOS,
    "supabase/migrations/20260912200000_processos_blindagem_de_tipos_e_encaminhamento.sql",
  );
  // E NÃO manda ninguém abrir o console: era essa a instrução inútil.
  assert.doesNotMatch(texto, /console|F12/i);

  // 42804 (tipos que não se unificam) é a mesma família e recebe o mesmo texto.
  assert.ok(ehRecusaDeTipo({ code: "42804" }));
  assert.ok(ehRecusaDeTipo({ code: "22P02" }));
  assert.ok(!ehRecusaDeTipo({ code: "42501" }));
  assert.match(mensagemFalhaDoProcesso({ code: "42804" }, "Não foi possível finalizar."), /código 42804/);
});

test("a mensagem escrita pelo banco continua chegando ao usuário, com a etapa", () => {
  // P0001 é o texto que as funções escrevem: passa como está.
  assert.equal(
    mensagemFalhaDoProcesso(
      { code: "P0001", message: "Sem permissão para finalizar processos de serviços/materiais." },
      "Não foi possível finalizar este processo.",
    ),
    "Sem permissão para finalizar processos de serviços/materiais.",
  );
  // 42501 continua virando a recusa de permissão de sempre.
  assert.match(
    mensagemFalhaDoProcesso({ code: "42501" }, "Não foi possível finalizar este processo."),
    /não tem permissão/i,
  );
});

test("as duas telas de Processos usam a mensagem do módulo, não a genérica", async () => {
  for (const caminho of [PAGINA_SERVICOS, PAGINA_DIARIAS]) {
    const pagina = await read(caminho);
    assert.match(pagina, /import \{ mensagemFalhaDoProcesso \} from "\.\.\/\.\.\/lib\/processosErros\.js";/, caminho);
    assert.ok(!/\bmensagemAmigavel\(/.test(pagina), `${caminho} não pode mais cair na mensagem genérica`);
    // Cada ponto de falha continua dizendo o que estava tentando fazer.
    for (const contexto of [
      "Não foi possível criar este processo.",
      "Não foi possível salvar as alterações.",
      "Não foi possível finalizar este processo.",
    ]) {
      assert.ok(pagina.includes(contexto), `${caminho} perdeu o contexto "${contexto}"`);
    }
  }
});

/* -------------------------------------------------------------------------
 * 4. "FINALIZAR E IMPRIMIR", NUMA ÚNICA AÇÃO
 * ---------------------------------------------------------------------- */

test("'Finalizar e imprimir' finaliza o processo e abre a impressão das páginas completas numa única ação", async () => {
  for (const [modal, pagina, folhas] of [
    [MODAL_SERVICO, PAGINA_SERVICOS, "2 páginas"],
    [MODAL_DIARIA, PAGINA_DIARIAS, "3 páginas"],
  ]) {
    const formulario = await read(modal);
    const tela = await read(pagina);

    // O botão existe, é UM clique, e diz o que faz.
    assert.match(formulario, /<Printer size=\{15\} \/> Finalizar e imprimir/, modal);
    assert.match(formulario, /onClick=\{\(\) => finalizar\(\{ comImpressao: true \}\)\}/, modal);
    assert.ok(
      formulario.includes(`Finaliza e abre a impressão do processo completo (${folhas}) numa única ação`),
      `${modal} precisa dizer quantas folhas saem`,
    );
    // Só aparece para quem pode finalizar E imprimir.
    assert.match(formulario, /\{permissoes\.finalizar && permissoes\.imprimir && rascunho && \(/, modal);

    // AS AÇÕES SEPARADAS CONTINUAM: "Finalizar" sozinha no formulário...
    assert.match(formulario, /<FileCheck2 size=\{15\} \/> Finalizar\n/, modal);
    assert.match(formulario, /onClick=\{\(\) => finalizar\(\)\}/, modal);
    // ...e "Imprimir" pela lista de processos.
    assert.match(tela, /onImprimir=\{\(\) => imprimir\(processo, "completo"\)\}/, pagina);

    // A CONFERÊNCIA VEM PRIMEIRO: falta de campo obrigatório avisa e não chama
    // nem a finalização nem a impressão.
    const corpo = formulario.slice(formulario.indexOf("async function finalizar({ comImpressao"));
    const gate = corpo.slice(0, corpo.indexOf("const ok = comImpressao"));
    assert.match(gate, /const erros = validarFinalizacao\(formulario\);/, modal);
    assert.match(gate, /if \(impedimento\) \{\s*\n\s*setAviso\(impedimento\);/, modal);
    assert.match(gate, /if \(!criado\) \{/, modal);
    assert.ok(!gate.includes("onFinalizarEImprimir"), `${modal} não pode imprimir antes de conferir`);
    assert.match(corpo, /onFinalizarEImprimir\?\.\(formulario\)/, modal);

    // NA TELA: finaliza, e só então imprime o processo JÁ FINALIZADO -- é ele
    // que carrega a identidade visual e a prefeita congeladas.
    const fluxo = tela.slice(tela.indexOf("async function finalizar(formulario, { comImpressao"));
    const fim = fluxo.indexOf("await carregar();");
    const trecho = fluxo.slice(0, fim);
    assert.ok(trecho.includes("const atualizado = await finalizar"), pagina);
    assert.ok(
      trecho.indexOf("const atualizado = await finalizar") <
        trecho.indexOf('if (comImpressao) await imprimir(atualizado, "completo");'),
      `${pagina} precisa finalizar ANTES de imprimir`,
    );
    // A ligação do formulário com a tela.
    assert.match(
      tela,
      /onFinalizarEImprimir=\{\(formulario\) => finalizar\(formulario, \{ comImpressao: true \}\)\}/,
      pagina,
    );
    // O aviso conta as duas coisas, e repete que finalizar não é pagar.
    assert.match(tela, /finalizado\$\{comImpressao \? " e enviado para impressão" : ""\}/, pagina);
    assert.match(tela, /Finalizar não é pagar: nenhum saldo, baixa, NF ou programação foi alterado/, pagina);
    assert.match(tela, /imprimir não altera o processo/, pagina);
  }
});

test("processo incompleto avisa o que falta e não imprime nada", () => {
  // A mesma conferência que o formulário roda antes de finalizar: sem ela
  // passar, nem a finalização nem a impressão acontecem.
  const servico = processoVazioServico({ ano: 2026 });
  const errosServico = validarFinalizacaoServico(servico);
  assert.ok(primeiroErroServico(errosServico), "serviços: processo vazio tem de ter impedimento");

  const diaria = processoVazioDiaria({ ano: 2026 });
  const errosDiaria = validarFinalizacaoDiaria(diaria);
  assert.ok(primeiroErroDiaria(errosDiaria), "diárias: processo vazio tem de ter impedimento");
});

/* -------------------------------------------------------------------------
 * 5. POSTGRES DE VERDADE: os cinco ensaios obrigatórios
 * ---------------------------------------------------------------------- */

const OPERADOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/**
 * A estrutura como está na produção: `public.secretarias.id` é INTEGER (é o que
 * faz o id "3" chegar à coluna) e `encaminhar_secretaria_id` nasce uuid, do jeito
 * que a 20260912120000 a criou.
 *
 * @param {{ idEncaminhamento?: string, situacaoEnum?: boolean, permissaoTexto?: boolean }} opcoes
 */
const ESTRUTURA = ({ idEncaminhamento = "uuid", situacaoEnum = false, permissaoTexto = false } = {}) => `
create role anon;
create role authenticated;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $x$
  select nullif(current_setting('ensaio.auth_uid', true), '')::uuid
$x$;

${situacaoEnum ? "create type situacao_processo as enum ('rascunho','finalizada','cancelado');" : ""}

create table public.secretarias (id integer primary key, nome text, ativo boolean not null default true);
create table public.usuarios (id uuid primary key, auth_id uuid, nome_completo text, status text not null default 'ativo');
create table public.permissoes_efetivas (
  usuario_id uuid, modulo text,
  pode_visualizar ${permissaoTexto ? "text" : "boolean"} not null default ${permissaoTexto ? "'false'" : "false"},
  pode_cadastrar boolean not null default false,
  pode_editar boolean not null default false,
  pode_excluir boolean not null default false,
  pode_aprovar boolean not null default false
);
create table public.fornecedores (id integer primary key, razao_social text, secretaria_id integer);
create table public.contas_bancarias (id integer primary key, nome_conta text, secretaria_id integer, ativo boolean not null default true);
create table public.saldos_historico (id serial primary key, conta_id integer, data_saldo date, valor_saldo numeric(14,2));
create table public.programacoes_pagamento (id integer primary key, secretaria_id integer, status text, total_programado numeric(14,2) default 0);
create table public.pagamentos (id serial primary key, programacao_id integer, fornecedor_id integer, valor_a_pagar numeric(14,2), situacao text);
create table public.pagamentos_baixas (id serial primary key, nota_id integer, valor_pago numeric(14,2));
create table public.valores_em_aberto (id integer primary key, fornecedor_id integer, valor_bruto numeric(14,2), valor_em_aberto numeric(14,2), situacao text);

create table public.processos_servidores (
  id uuid primary key default gen_random_uuid(),
  nome text not null, cpf text, cargo text, categoria_diaria text,
  situacao text not null default 'ativo',
  inativado_em timestamptz, inativado_por uuid, motivo_inativacao text,
  atualizado_em timestamptz, atualizado_por uuid
);
create table public.processos_secretarias_solicitantes (
  id uuid primary key default gen_random_uuid(), nome text not null, sigla text,
  situacao text not null default 'ativo', atualizado_em timestamptz
);
create table public.processos_bancos (
  id uuid primary key default gen_random_uuid(), numero text, nome text,
  situacao text not null default 'ativo', atualizado_em timestamptz
);
create table public.processos_prefeita (
  id uuid primary key default gen_random_uuid(), nome text not null, cargo text,
  situacao text not null default 'ativo', atualizado_em timestamptz
);

create table public.processos_servicos (
  id uuid primary key default gen_random_uuid(),
  ano integer not null, numero integer not null,
  situacao ${situacaoEnum ? "situacao_processo" : "text"} not null default 'rascunho',
  data_processo date, requisicao_data date, liquidacao_data date,
  tipo text, atestado text,
  solicitante_id uuid, solicitante_nome text,
  fornecedor_id integer, nota_id integer,
  itens jsonb not null default '[]'::jsonb,
  banco_nome text, banco_agencia text, banco_conta text,
  identidade_visual jsonb, prefeita jsonb,
  encaminhar_secretaria_id ${idEncaminhamento}, encaminhar_secretaria_nome text,
  finalizada_em timestamptz, finalizada_por uuid,
  cancelada_em timestamptz, cancelada_por uuid, motivo_cancelamento text,
  excluido_em timestamptz, excluido_por uuid, motivo_exclusao text,
  criado_em timestamptz default now(), criado_por uuid,
  atualizado_em timestamptz, atualizado_por uuid
);
create table public.processos_servicos_numeracao (ano integer primary key, ultimo_numero integer not null default 0, atualizado_em timestamptz default now());
create table public.processos_servicos_historico (id serial primary key, processo_id uuid, acao text, criado_em timestamptz default now());

create table public.processos_diarias (
  id uuid primary key default gen_random_uuid(),
  ano integer not null, numero integer not null,
  situacao ${situacaoEnum ? "situacao_processo" : "text"} not null default 'rascunho',
  data_processo date, requisicao_data date, liquidacao_data date, prestacao_data date,
  secretaria_id integer,
  beneficiario_servidor_id uuid, beneficiario_nome text, destino text, finalidade text,
  saida_em timestamptz, retorno_em timestamptz, valor_total numeric(14,2) default 0,
  diaria_valor_unitario numeric(14,2), diaria_pernoite_percentual numeric(6,2),
  diaria_tabela_versao text, diaria_tabela_id uuid,
  identidade_visual jsonb, prefeita jsonb,
  encaminhar_secretaria_id ${idEncaminhamento}, encaminhar_secretaria_nome text,
  assinante_secretaria_nome text,
  finalizada_em timestamptz, finalizada_por uuid,
  cancelada_em timestamptz, cancelada_por uuid, motivo_cancelamento text,
  excluido_em timestamptz, excluido_por uuid, motivo_exclusao text,
  criado_em timestamptz default now(), criado_por uuid,
  atualizado_em timestamptz, atualizado_por uuid
);
create table public.processos_diarias_numeracao (ano integer primary key, ultimo_numero integer not null default 0, atualizado_em timestamptz default now());
create table public.processos_diarias_historico (id serial primary key, processo_id uuid, acao text, criado_em timestamptz default now());
`;

const DADOS = ({ permissaoTexto = false } = {}) => {
  const ver = permissaoTexto ? "'true'" : "true";
  return `
insert into public.secretarias (id, nome) values (1, 'Educação'), (3, 'Finanças'), (4, 'Saúde');
insert into public.usuarios (id, auth_id, nome_completo, status) values ('${OPERADOR}', '${OPERADOR}', 'Chefe do setor', 'ativo');
insert into public.permissoes_efetivas (usuario_id, modulo, pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar) values
  ('${OPERADOR}', 'processos_servicos', ${ver}, true, true, true, true),
  ('${OPERADOR}', 'processos_servicos_saida', ${ver}, true, false, false, false),
  ('${OPERADOR}', 'processos_diarias', ${ver}, true, true, true, true),
  ('${OPERADOR}', 'processos_diarias_saida', ${ver}, true, false, false, false),
  ('${OPERADOR}', 'processos_servidores', ${ver}, true, true, true, false),
  ('${OPERADOR}', 'processos_solicitantes', ${ver}, true, true, true, false),
  ('${OPERADOR}', 'processos_bancos', ${ver}, true, true, true, false),
  ('${OPERADOR}', 'processos_prefeita', ${ver}, true, true, false, false);
insert into public.fornecedores (id, razao_social, secretaria_id) values (7, 'Padaria Central Ltda.', 1);
insert into public.contas_bancarias (id, nome_conta, secretaria_id) values (11, 'FUNDEB', 1);
insert into public.saldos_historico (conta_id, data_saldo, valor_saldo) values (11, '2026-09-10', 180000.00);
insert into public.programacoes_pagamento (id, secretaria_id, status, total_programado) values (50, 1, 'aprovada', 2450.75);
insert into public.pagamentos (programacao_id, fornecedor_id, valor_a_pagar, situacao) values (50, 7, 2450.75, 'em_aberto');
insert into public.valores_em_aberto (id, fornecedor_id, valor_bruto, valor_em_aberto, situacao) values (90, 7, 2450.75, 2450.75, 'em_aberto');
`;
};

/** O corpo de uma função como ela está HOJE no banco, antes desta correção. */
function funcaoLegada(arquivo, nome) {
  const sql = lerSync(arquivo);
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio >= 0, `${nome} não está em ${arquivo}`);
  const fim = sql.indexOf("\n$$;", inicio);
  return sql.slice(inicio, fim + 4);
}

/**
 * Abre um Postgres de ensaio.
 *
 * @param {{ blindado?: boolean } & Parameters<typeof ESTRUTURA>[0]} opcoes
 *   blindado=true roda a migration desta correção; sem ela, o banco fica como
 *   está hoje -- é assim que o defeito é reproduzido antes de ser corrigido.
 */
async function abrirBanco({ blindado = false, instalarLegadas = true, ...opcoes } = {}) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    return null;
  }
  const db = await new PGlite();
  await db.exec(ESTRUTURA(opcoes));
  if (instalarLegadas) {
    await db.exec(funcaoLegada(MIGRATION_DIARIAS, "pode_em_processos"));
    await db.exec(funcaoLegada(MIGRATION_DIARIAS, "proximo_numero_processo_diaria"));
    await db.exec(funcaoLegada(MIGRATION_DIARIAS, "conferir_alteracao_processo_diaria"));
    await db.exec(funcaoLegada(MIGRATION_SERVICOS, "proximo_numero_processo_servico"));
    await db.exec(funcaoLegada(MIGRATION_SERVICOS, "conferir_alteracao_processo_servico"));
    await db.exec(funcaoLegada(MIGRATION_SERVIDORES, "conferir_alteracao_servidor_processos"));
    await db.exec(`
create trigger processos_servicos_alteracao before update on public.processos_servicos
  for each row execute function public.conferir_alteracao_processo_servico();
create trigger processos_diarias_alteracao before update on public.processos_diarias
  for each row execute function public.conferir_alteracao_processo_diaria();
create trigger conferir_alteracao_servidor_processos before update on public.processos_servidores
  for each row execute function public.conferir_alteracao_servidor_processos();
`);
  }
  await db.exec(DADOS(opcoes));
  if (blindado) await db.exec(lerSync(MIGRATION));
  await db.exec(`set ensaio.auth_uid = '${OPERADOR}'`);
  return db;
}

const pular = (t) => t.skip("@electric-sql/pglite não instalado (npm i -D @electric-sql/pglite)");

/** Cria o processo, como a tela cria: número emitido pela função e insert. */
async function criarServico(db, ano = 2026) {
  const numero = (await db.query("select public.proximo_numero_processo_servico($1) as n", [ano])).rows[0].n;
  const inserido = await db.query(
    `insert into public.processos_servicos (ano, numero, data_processo, tipo, solicitante_id, solicitante_nome, itens)
     values ($1, $2, '2026-09-12', 'servico', gen_random_uuid(), 'Secretaria de Obras',
             '[{"descricao":"Reparo do portão","quantidade":1,"valor_unitario":100}]'::jsonb)
     returning id`,
    [ano, numero],
  );
  return inserido.rows[0].id;
}

async function criarDiaria(db, ano = 2026) {
  const numero = (await db.query("select public.proximo_numero_processo_diaria($1) as n", [ano])).rows[0].n;
  const inserido = await db.query(
    `insert into public.processos_diarias
       (ano, numero, data_processo, secretaria_id, beneficiario_nome, destino, finalidade, valor_total, saida_em, retorno_em)
     values ($1, $2, '2026-09-12', 1, 'Maria dos Santos', 'Belém', 'Curso de capacitação', 500, '2026-09-15', '2026-09-17')
     returning id`,
    [ano, numero],
  );
  return inserido.rows[0].id;
}

/** A soma do financeiro: nada disto pode mudar por causa dos Processos. */
async function financeiro(db) {
  return (
    await db.query(`
      select
        (select coalesce(sum(valor_saldo), 0)::text from public.saldos_historico) saldos,
        (select count(*)::int from public.pagamentos) pagamentos,
        (select coalesce(sum(valor_a_pagar), 0)::text from public.pagamentos) programado,
        (select count(*)::int from public.pagamentos_baixas) baixas,
        (select coalesce(sum(valor_em_aberto), 0)::text from public.valores_em_aberto) em_aberto,
        (select coalesce(sum(valor_bruto), 0)::text from public.valores_em_aberto) bruto,
        (select coalesce(sum(total_programado), 0)::text from public.programacoes_pagamento) total_programado,
        (select count(*)::int from public.secretarias) secretarias
    `)
  ).rows[0];
}

test("1. o 22P02 da página 2 é reproduzido no banco de hoje e desaparece com a migration", async (t) => {
  const hoje = await abrirBanco();
  if (!hoje) return pular(t);

  // COMO ESTÁ HOJE: a coluna é uuid e o id da secretaria do financeiro é "3".
  const id = await criarServico(hoje);
  await assert.rejects(
    () =>
      hoje.query(
        `update public.processos_servicos
            set encaminhar_secretaria_id = $1, encaminhar_secretaria_nome = $2, liquidacao_data = '2026-09-20'
          where id = $3`,
        ["3", "Secretaria Municipal de Finanças", id],
      ),
    (erro) => {
      assert.equal(erro.code, "22P02");
      assert.match(erro.message, /invalid input syntax for type uuid: "3"/);
      return true;
    },
    "o defeito relatado tem de se reproduzir antes de ser corrigido",
  );

  // DEPOIS DA MIGRATION: o mesmo salvamento passa.
  const banco = await abrirBanco({ blindado: true });
  const outro = await criarServico(banco);
  await banco.query(
    `update public.processos_servicos
        set encaminhar_secretaria_id = $1, encaminhar_secretaria_nome = $2, liquidacao_data = '2026-09-20'
      where id = $3`,
    ["3", "Secretaria Municipal de Finanças", outro],
  );
  const linha = (
    await banco.query(
      "select situacao::text s, encaminhar_secretaria_id e, encaminhar_secretaria_nome n, liquidacao_data l from public.processos_servicos where id = $1",
      [outro],
    )
  ).rows[0];
  assert.equal(linha.s, "rascunho");
  assert.equal(linha.e, "3");
  assert.equal(linha.n, "Secretaria Municipal de Finanças");
  assert.ok(linha.l);

  // A coluna virou text nas DUAS tabelas -- a das diárias tinha o mesmo defeito.
  const tipos = (
    await banco.query(
      `select table_name, data_type from information_schema.columns
        where table_schema = 'public' and column_name = 'encaminhar_secretaria_id' order by table_name`,
    )
  ).rows;
  assert.deepEqual(tipos, [
    { table_name: "processos_diarias", data_type: "text" },
    { table_name: "processos_servicos", data_type: "text" },
  ]);

  // Rodar de novo é inofensivo.
  await banco.exec(lerSync(MIGRATION));
});

test("2. finalizar o processo de serviços/materiais funciona, e o congelamento segue valendo", async (t) => {
  const db = await abrirBanco({ blindado: true });
  if (!db) return pular(t);

  const id = await criarServico(db);
  await db.query(
    "update public.processos_servicos set encaminhar_secretaria_id = $1, encaminhar_secretaria_nome = 'Finanças' where id = $2",
    ["3", id],
  );
  // Finalizar escreve situação e congelamentos no MESMO update -- é por isso que
  // identidade_visual e prefeita estão na lista de controle do gatilho.
  await db.query(
    `update public.processos_servicos
        set situacao = 'finalizada', finalizada_em = now(), finalizada_por = $2,
            identidade_visual = '{"brasao":"a"}'::jsonb, prefeita = '{"nome":"Maria da Silva"}'::jsonb
      where id = $1`,
    [id, OPERADOR],
  );
  assert.equal(
    (await db.query("select situacao::text s from public.processos_servicos where id = $1", [id])).rows[0].s,
    "finalizada",
  );

  // Congelado uma vez, congelado para sempre.
  await assert.rejects(
    () => db.query("update public.processos_servicos set prefeita = '{\"nome\":\"Outra\"}'::jsonb where id = $1", [id]),
    (e) => (assert.equal(e.code, "P0001"), assert.match(e.message, /prefeita congelados/), true),
  );
  // Conteúdo de processo finalizado não é mais alterado.
  await assert.rejects(
    () => db.query("update public.processos_servicos set tipo = 'material' where id = $1", [id]),
    (e) => (assert.equal(e.code, "P0001"), assert.match(e.message, /não está em rascunho/), true),
  );
  // Número emitido nunca é reutilizado.
  assert.equal((await db.query("select public.proximo_numero_processo_servico(2026) as n")).rows[0].n, 2);
});

test("3. diárias: salvar, finalizar e cancelar continuam funcionando", async (t) => {
  const db = await abrirBanco({ blindado: true });
  if (!db) return pular(t);

  const id = await criarDiaria(db);

  // SALVAR o rascunho, com o encaminhamento que derrubava a página 2.
  await db.query(
    `update public.processos_diarias
        set encaminhar_secretaria_id = $1, encaminhar_secretaria_nome = 'Secretaria Municipal de Finanças',
            liquidacao_data = '2026-09-20', requisicao_data = '2026-09-12'
      where id = $2`,
    ["3", id],
  );

  // FINALIZAR, com os congelamentos da tabela de diárias.
  await db.query(
    `update public.processos_diarias
        set situacao = 'finalizada', finalizada_em = now(), finalizada_por = $2,
            diaria_valor_unitario = 250, diaria_tabela_versao = '2026', identidade_visual = '{}'::jsonb,
            prefeita = '{"nome":"Maria da Silva"}'::jsonb
      where id = $1`,
    [id, OPERADOR],
  );

  // CANCELAR (que é update de situação, não exclusão).
  await db.query(
    `update public.processos_diarias
        set situacao = 'cancelada', cancelada_em = now(), cancelada_por = $2, motivo_cancelamento = 'viagem desmarcada'
      where id = $1`,
    [id, OPERADOR],
  );
  const linha = (
    await db.query("select situacao::text s, motivo_cancelamento m, encaminhar_secretaria_id e from public.processos_diarias where id = $1", [id])
  ).rows[0];
  assert.equal(linha.s, "cancelada");
  assert.equal(linha.m, "viagem desmarcada");
  assert.equal(linha.e, "3");

  // As regras de sempre continuam: conteúdo de processo fora de rascunho não é
  // mais alterado, e processo finalizado não tem exclusão comum.
  await assert.rejects(
    () => db.query("update public.processos_diarias set destino = 'Macapá' where id = $1", [id]),
    (e) => (assert.equal(e.code, "P0001"), assert.match(e.message, /não está em rascunho/), true),
  );
  const finalizado = await criarDiaria(db);
  await db.query("update public.processos_diarias set situacao = 'finalizada', finalizada_em = now() where id = $1", [finalizado]);
  await assert.rejects(
    () => db.query("update public.processos_diarias set excluido_em = now() where id = $1", [finalizado]),
    (e) => (assert.equal(e.code, "P0001"), assert.match(e.message, /use cancelar/), true),
  );
});

test("4. servidor, secretaria solicitante, banco e prefeita: cadastrar e editar funcionam", async (t) => {
  const db = await abrirBanco({ blindado: true });
  if (!db) return pular(t);

  // SERVIDOR: cadastrar, editar e inativar são permissões separadas, e as três
  // passam para quem as tem.
  const servidor = (
    await db.query(
      "insert into public.processos_servidores (nome, cpf, cargo, categoria_diaria) values ('João Pereira', '111.222.333-44', 'Motorista', 'servidor') returning id",
    )
  ).rows[0].id;
  await db.query("update public.processos_servidores set cargo = 'Motorista I', atualizado_em = now() where id = $1", [servidor]);
  await db.query("update public.processos_servidores set situacao = 'inativo', inativado_em = now() where id = $1", [servidor]);
  const depois = (await db.query("select cargo, situacao from public.processos_servidores where id = $1", [servidor])).rows[0];
  assert.deepEqual(depois, { cargo: "Motorista I", situacao: "inativo" });

  // SECRETARIA SOLICITANTE, BANCO e PREFEITA: não têm função própria -- entram
  // pela porta única, que é pode_em_processos.
  for (const [tabela, insercao] of [
    ["processos_secretarias_solicitantes", "insert into public.processos_secretarias_solicitantes (nome, sigla) values ('Secretaria de Obras', 'SEMOB') returning id"],
    ["processos_bancos", "insert into public.processos_bancos (numero, nome) values ('104', 'Caixa Econômica Federal') returning id"],
    ["processos_prefeita", "insert into public.processos_prefeita (nome, cargo) values ('Maria da Silva', 'Prefeita Municipal') returning id"],
  ]) {
    const id = (await db.query(insercao)).rows[0].id;
    await db.query(`update public.${tabela} set nome = nome || ' (editado)', atualizado_em = now() where id = $1`, [id]);
    const linha = (await db.query(`select nome from public.${tabela} where id = $1`, [id])).rows[0];
    assert.match(linha.nome, / \(editado\)$/, tabela);
  }

  // A porta responde o esperado para cada módulo e ação, inclusive as ausentes.
  const portas = (
    await db.query(`select
      public.pode_em_processos('processos_servicos', 'aprovar') finalizar_servico,
      public.pode_em_processos('processos_prefeita', 'editar') editar_prefeita,
      public.pode_em_processos('processos_prefeita', 'excluir') excluir_prefeita,
      public.pode_em_processos('processos_servicos', 'voar') acao_inexistente,
      public.pode_em_processos('modulo_que_nao_existe', 'visualizar') modulo_inexistente`)
  ).rows[0];
  assert.deepEqual(portas, {
    finalizar_servico: true,
    editar_prefeita: true,
    excluir_prefeita: false,
    acao_inexistente: false,
    modulo_inexistente: false,
  });
});

test("5. nenhum saldo, baixa, NF ou programação é alterado por nada disso", async (t) => {
  const db = await abrirBanco({ blindado: true });
  if (!db) return pular(t);

  const antes = await financeiro(db);

  // Todo o roteiro do módulo, de uma vez: criar, salvar, finalizar, cancelar,
  // cadastrar e editar.
  const servico = await criarServico(db);
  await db.query("update public.processos_servicos set encaminhar_secretaria_id = '3', nota_id = 90, fornecedor_id = 7 where id = $1", [servico]);
  await db.query("update public.processos_servicos set situacao = 'finalizada', finalizada_em = now() where id = $1", [servico]);
  const diaria = await criarDiaria(db);
  await db.query("update public.processos_diarias set encaminhar_secretaria_id = '3' where id = $1", [diaria]);
  await db.query("update public.processos_diarias set situacao = 'finalizada', finalizada_em = now() where id = $1", [diaria]);
  await db.query("update public.processos_diarias set situacao = 'cancelada', cancelada_em = now(), motivo_cancelamento = 'x' where id = $1", [diaria]);
  await db.query("insert into public.processos_servidores (nome) values ('Ana')");

  // ⚠️ VINCULAR NF NÃO DÁ BAIXA: o processo aponta a nota 90 e o valor em aberto
  // dela continua o que era.
  assert.deepEqual(await financeiro(db), antes);
  const nota = (await db.query("select valor_em_aberto::text v, situacao from public.valores_em_aberto where id = 90")).rows[0];
  assert.deepEqual(nota, { v: "2450.75", situacao: "em_aberto" });
});

/* -------------------------------------------------------------------------
 * 6. A VARREDURA MEDIDA: os dois tipos que quebravam de verdade
 * ---------------------------------------------------------------------- */

test("situacao em ENUM: o gatilho de hoje estoura ao finalizar, o blindado não", async (t) => {
  const hoje = await abrirBanco({ situacaoEnum: true });
  if (!hoje) return pular(t);

  // Banco cujo enum de situação não tem o rótulo 'cancelada' (tem 'cancelado').
  // O gatilho antigo compara `new.situacao = 'cancelada'` sem ::text e o
  // Postgres recusa o UPDATE INTEIRO antes de olhar permissão nenhuma.
  const id = await criarServico(hoje);
  await assert.rejects(
    () => hoje.query("update public.processos_servicos set situacao = 'finalizada' where id = $1", [id]),
    (e) => {
      assert.equal(e.code, "22P02");
      assert.match(e.message, /invalid input value for enum situacao_processo: "cancelada"/);
      return true;
    },
  );

  const blindado = await abrirBanco({ situacaoEnum: true, blindado: true });
  const outro = await criarServico(blindado);
  await blindado.query("update public.processos_servicos set situacao = 'finalizada' where id = $1", [outro]);
  assert.equal(
    (await blindado.query("select situacao::text s from public.processos_servicos where id = $1", [outro])).rows[0].s,
    "finalizada",
  );
});

test("permissão em coluna de TEXTO: a porta de hoje nem instala, a blindada responde certo", async (t) => {
  const db = await abrirBanco({ permissaoTexto: true, instalarLegadas: false });
  if (!db) return pular(t);

  // A porta antiga unifica boolean com texto no `case`: o Postgres recusa a
  // própria criação da função, e com ela o módulo INTEIRO fecharia -- diárias,
  // serviços, servidores, prefeita, solicitantes, bancos e tabela de diárias.
  await assert.rejects(
    () => db.exec(funcaoLegada(MIGRATION_DIARIAS, "pode_em_processos")),
    (e) => {
      assert.equal(e.code, "42804");
      assert.match(e.message, /cannot be matched/);
      return true;
    },
  );

  const blindado = await abrirBanco({ permissaoTexto: true, instalarLegadas: false, blindado: true });
  const portas = (
    await blindado.query(`select
      public.pode_em_processos('processos_servicos', 'visualizar') ver,
      public.pode_em_processos('processos_diarias', 'visualizar') ver_diaria`)
  ).rows[0];
  assert.deepEqual(portas, { ver: true, ver_diaria: true });
});

test("falha inesperada diz a ETAPA e o tipo real das colunas, em vez de só um código", async (t) => {
  const db = await abrirBanco({ blindado: true });
  if (!db) return pular(t);

  const id = await criarServico(db);

  // Uma quebra por tipo dentro da porta, para ver o que o gatilho relata.
  await db.exec(
    "create or replace function public.pode_em_processos(p_modulo text, p_acao text) returns boolean language plpgsql as $x$ begin raise exception 'coluna fora do tipo' using errcode = '22P02'; end $x$;",
  );
  await assert.rejects(
    () => db.query("update public.processos_servicos set situacao = 'finalizada' where id = $1", [id]),
    (e) => {
      assert.equal(e.code, "P0001");
      // A mensagem diz a ETAPA e o código, não só o código.
      assert.match(e.message, /na etapa "conferência da mudança de situação do processo"/);
      assert.match(e.message, /com o código 22P02/);
      // O DETAIL traz o tipo REAL de cada coluna suspeita.
      assert.match(e.detail, /processos_servicos\.situacao=text/);
      assert.match(e.detail, /processos_servicos\.encaminhar_secretaria_id=text/);
      assert.match(e.detail, /processos_servicos\.fornecedor_id=integer/);
      assert.match(e.hint, /Leia o DETAIL/);
      return true;
    },
  );

  // E a porta, quando é ela que quebra, diz a etapa dela.
  const outro = await abrirBanco({ blindado: true });
  await outro.exec(
    "create or replace function public.texto_verdadeiro(p_texto text) returns boolean language plpgsql as $x$ begin raise exception 'tipo recusado' using errcode = '22P02'; end $x$;",
  );
  await assert.rejects(
    () => outro.query("select public.pode_em_processos('processos_servicos', 'editar')"),
    (e) => {
      assert.equal(e.code, "P0001");
      assert.match(e.message, /na etapa "leitura da permissão pode_editar no módulo processos_servicos"/);
      assert.match(e.detail, /usuarios\.status=text/);
      assert.match(e.detail, /permissoes_efetivas\.pode_editar=boolean/);
      return true;
    },
  );
});
