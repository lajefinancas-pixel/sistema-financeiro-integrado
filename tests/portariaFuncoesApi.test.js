// Testes da PORTARIA das funções Netlify — o último degrau onde uma recusa
// ainda saía "sem etapa, sem código, sem detalhe".
//
// O QUE ESTAVA ACONTECENDO
//
// As funções do banco já nomeiam a etapa de qualquer falha inesperada
// (20260828230000), e `errorResponse` já repassa code, message, details e hint.
// Sobrou um caminho inteiro FORA do banco: `authenticatedSupabase` recusava com
// `new Response("texto", { status })`, e `errorResponse` devolve todo Response
// intacto. Resultado:
//
//   * corpo em TEXTO -> o `response.json()` do navegador falhava e o corpo
//     virava {}, então a falha subia sem mensagem, sem código e sem detalhe;
//   * nenhum log no servidor -> a portaria levantava antes de qualquer
//     console.error, então a recusa não aparecia nem no log da função.
//
// E a leitura de public.usuarios dessa portaria passa pela RLS da tabela: um
// login legítimo que não consiga ler a PRÓPRIA linha era barrado ali, ANTES de
// a função do banco ser chamada -- o que explica por que nenhum diagnóstico
// dentro do banco encontrava nada. A transferência entre contas é a única
// operação de rotina que passa por uma função Netlify; o resto das telas fala
// direto com o Supabase e nunca encostou nessa portaria.
//
// O que estes testes travam:
//
//   TODA RECUSA DA PORTARIA SAI COMO JSON, COM CÓDIGO PRÓPRIO E LOG ANTES
//   A TRANSFERÊNCIA DEIXA A AUTORIZAÇÃO PARA O BANCO, QUE JÁ A FAZ
//   QUEM GRAVA COM O ID DE public.usuarios CONTINUA EXIGINDO O CADASTRO
//   A TELA TRADUZ OS CÓDIGOS DA PORTARIA EM VEZ DE CAIR NA GENÉRICA
//   CORPO NÃO-JSON AINDA CHEGA À TELA COM MENSAGEM E CÓDIGO
//   O REPASSE DA RECUSA DO BANCO CONTINUA EXATAMENTE COMO ESTAVA

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mensagemAmigavel, MENSAGEM_GENERICA } from "../src/lib/erros.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const AUTH = "netlify/functions/_shared/auth.mts";
const TRANSFERENCIAS = "netlify/functions/account-transfers.mts";
const FORNECEDORES = "netlify/functions/supplier-payment-methods.mts";
const TRANSPORTE = "src/lib/transferenciasContas.js";

const CODIGOS_DA_PORTARIA = [
  "AUTH_SEM_TOKEN",
  "AUTH_CONFIG_AUSENTE",
  "AUTH_SESSAO_INVALIDA",
  "AUTH_SEM_CADASTRO",
  "AUTH_SEM_PERMISSAO_ESPECIAL",
];

// ---------------------------------------------------------------------------
// 1. Nenhuma recusa da portaria sai mais em texto puro
// ---------------------------------------------------------------------------

test("a portaria não recusa mais com corpo em texto puro", async () => {
  const auth = await read(AUTH);

  // Era isto: `throw new Response("Usuário não encontrado.", { status: 403 })`.
  // Texto puro é o que fazia o response.json() do navegador falhar.
  assert.doesNotMatch(auth, /throw new Response\(\s*"/, "ainda há recusa com corpo em texto puro");

  // Toda saída de recusa passa por um lugar só.
  const recusas = [...auth.matchAll(/throw recusaDaPortaria\(/g)];
  assert.equal(recusas.length, 5, "o número de recusas da portaria mudou");
});

test("cada recusa da portaria tem código próprio e é registrada ANTES de subir", async () => {
  const auth = await read(AUTH);
  const helper = auth.slice(auth.indexOf("function recusaDaPortaria"), auth.indexOf("* Autentica a requisição"));

  const posicaoLog = helper.indexOf("console.error");
  const posicaoResposta = helper.indexOf("new Response(");
  assert.ok(posicaoLog > 0, "a recusa da portaria não é registrada");
  assert.ok(posicaoLog < posicaoResposta, "o log tem de acontecer ANTES de montar a resposta");

  // Os quatro campos que a tela e o console leem, no corpo da resposta.
  assert.match(helper, /JSON\.stringify\(\{ error: message, code, details, hint \}\)/);
  assert.match(helper, /"Content-Type": "application\/json"/);

  for (const codigo of CODIGOS_DA_PORTARIA) {
    assert.match(auth, new RegExp(`"${codigo}"`), `código ausente na portaria: ${codigo}`);
  }
});

test("a recusa por cadastro separa 'não existe' de 'a RLS não deixou ler'", async () => {
  const auth = await read(AUTH);
  // Sem esta distinção, o mesmo 403 significava duas coisas muito diferentes e
  // mandava quem investiga procurar cadastro que já existe.
  assert.match(auth, /a leitura de public\.usuarios por auth_id foi recusada/);
  assert.match(auth, /a RLS da tabela não permite que ele leia a própria linha/);
  assert.match(auth, /userError\.code/);
});

// ---------------------------------------------------------------------------
// 2. Quem autoriza a transferência é o banco
// ---------------------------------------------------------------------------

test("a transferência deixa a autorização para o banco, que já a faz por inteiro", async () => {
  const funcao = await read(TRANSFERENCIAS);
  assert.match(funcao, /authenticatedSupabase\(req, \{ exigirCadastro: false \}\)/);

  // O token continua sendo validado: o que sai é só a conferência REPETIDA de
  // cadastro, que a função do banco já faz via pode_em_pagamentos_fase2.
  const auth = await read(AUTH);
  assert.match(auth, /supabase\.auth\.getUser\(token\)/);
  assert.match(auth, /export async function authenticatedSupabase\(req: Request, \{ exigirCadastro = true \} = \{\}\)/);

  // A cópia de conferência é etiqueta, não autorização: usa o id que houver.
  assert.match(funcao, /userId: registroId \?\? authId/);
});

test("quem grava com o id de public.usuarios continua exigindo o cadastro", async () => {
  const fornecedores = await read(FORNECEDORES);
  // supplier-payment-methods grava usuario_id em auditoria_eventos direto, como
  // `authenticated`: sem o id de public.usuarios a RLS da trilha recusaria. Ele
  // NÃO pode abrir mão do cadastro.
  assert.match(fornecedores, /await authenticatedSupabase\(req\)/);
  assert.doesNotMatch(fornecedores, /exigirCadastro/);

  // E o padrão da portaria continua sendo exigir.
  const auth = await read(AUTH);
  assert.match(auth, /exigirCadastro = true/);
});

test("a ausência de cadastro nunca é silenciosa, mesmo quando não recusa", async () => {
  const auth = await read(AUTH);
  const trecho = auth.slice(auth.indexOf("if (exigirCadastro)"));
  assert.match(trecho, /console\.error\(\s*"\[api\] login autenticado sem cadastro legível em public\.usuarios"/);
});

// ---------------------------------------------------------------------------
// 3. A tela traduz os códigos da portaria
// ---------------------------------------------------------------------------

test("os códigos da portaria viram frase em português, não a genérica", () => {
  for (const codigo of CODIGOS_DA_PORTARIA) {
    const frase = mensagemAmigavel({ code: codigo, message: "Usuário não encontrado." }, "Falha ao transferir.");
    assert.notEqual(frase, "Falha ao transferir.", `${codigo} ainda cai na mensagem da tela`);
    assert.notEqual(frase, MENSAGEM_GENERICA, `${codigo} ainda cai na genérica`);
    assert.ok(frase.length > 20, `${codigo}: frase curta demais para explicar algo`);
  }
});

test("o código diz o que fazer: sessão, configuração e cadastro têm saídas diferentes", () => {
  assert.match(mensagemAmigavel({ code: "AUTH_SESSAO_INVALIDA" }), /sessão expirou/i);
  assert.match(mensagemAmigavel({ code: "AUTH_CONFIG_AUSENTE" }), /AUTH_CONFIG_AUSENTE/);
  assert.match(mensagemAmigavel({ code: "AUTH_SEM_CADASTRO" }), /AUTH_SEM_CADASTRO/);
  assert.match(mensagemAmigavel({ code: "AUTH_SEM_PERMISSAO_ESPECIAL" }), /permissão/i);

  // Nenhuma delas vaza nome de tabela, coluna ou variável de ambiente.
  for (const codigo of CODIGOS_DA_PORTARIA) {
    const frase = mensagemAmigavel({ code: codigo });
    assert.doesNotMatch(frase, /public\.|VITE_|anon|jwt|rls/i, `${codigo}: a frase da tela vaza detalhe técnico`);
  }
});

test("as mensagens escritas no banco e os códigos do Postgres continuam como estavam", () => {
  // Não-regressão: a tradução nova não pode ter empurrado nada para o lado.
  assert.equal(
    mensagemAmigavel({ code: "P0001", message: "Saldo insuficiente na conta de origem." }, "padrão"),
    "Saldo insuficiente na conta de origem.",
  );
  assert.match(mensagemAmigavel({ code: "42501", message: "Você não tem permissão para transferir entre contas." }), /permissão para transferir/);
  assert.match(mensagemAmigavel({ code: "23503" }), /ligado a outros lançamentos/);
  assert.match(mensagemAmigavel({ status: 403 }), /permissão/i);
});

// ---------------------------------------------------------------------------
// 4. O transporte não engole mais corpo que não seja JSON
// ---------------------------------------------------------------------------

test("corpo não-JSON ainda chega à tela com mensagem e código", async () => {
  const transporte = await read(TRANSPORTE);

  // `response.json().catch(() => ({}))` transformava toda resposta em texto
  // numa falha sem mensagem, sem código e sem detalhe.
  assert.doesNotMatch(transporte, /response\.json\(\)\.catch/);
  assert.match(transporte, /async function corpoDaResposta\(response\)/);
  assert.match(transporte, /await response\.text\(\)/);
  assert.match(transporte, /JSON\.parse\(bruto\)/);

  // Sem código no corpo, o status HTTP vira o código -- é o que faz 401 e 403
  // virarem frase em vez de genérica.
  assert.match(transporte, /code: body\.code \?\? String\(response\.status\)/);
});

// ---------------------------------------------------------------------------
// 5. Nada do que já funcionava mudou
// ---------------------------------------------------------------------------

test("o repasse da recusa do banco continua exatamente como estava", async () => {
  const auth = await read(AUTH);
  const resposta = auth.slice(auth.indexOf("export function errorResponse"));

  assert.match(auth, /if \(error instanceof Response\) return error;/);
  assert.match(auth, /error && typeof error === "object"/);
  assert.match(resposta, /error: campos\.message/);
  assert.match(resposta, /code: campos\.code/);
  assert.match(resposta, /details: campos\.details/);
  assert.match(resposta, /hint: campos\.hint/);
  assert.match(resposta, /\{ status: 500 \}/);

  const posicaoLog = resposta.indexOf("console.error");
  assert.ok(posicaoLog > 0 && posicaoLog < resposta.indexOf("Response.json"));
});

test("nenhuma migration foi tocada por esta correção", async () => {
  // A correção é inteira do lado da aplicação: as funções do banco continuam as
  // da 20260828230000, e as migrations já aplicadas seguem intactas no disco.
  for (const caminho of [
    "supabase/migrations/20260828230000_diagnosticar_transferencia_entre_contas.sql",
    "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql",
    "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql",
  ]) {
    const sql = await read(caminho);
    assert.match(sql, /^commit;$/m, `${caminho}: migration incompleta`);
  }
});
