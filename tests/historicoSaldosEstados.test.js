import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("histórico por data mantém erro, vazio e resultado como estados exclusivos", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  const trecho = pagina.slice(pagina.indexOf("{carregandoHistorico ?"), pagina.indexOf("{exclusaoPendente &&"));

  assert.match(trecho, /carregandoHistorico[\s\S]*erroHistorico[\s\S]*contasPorSecretariaNaData\.length === 0/);
  assert.match(trecho, /erroHistorico[\s\S]*Tentar novamente/);
  assert.match(trecho, /erroHistorico[\s\S]*Nenhum saldo registrado até esta data/);
  assert.match(pagina, /setContasPorSecretariaNaData\(\[\]\);\s*setErroHistorico/);
});

test("consulta histórica divide cadastros grandes sem remover o filtro de contas", async () => {
  const consulta = await read("src/lib/saldosContasDados.js");

  assert.match(consulta, /dividirEmLotes\(contaIds\)/);
  assert.match(consulta, /for \(const lote of lotes\)/);
  assert.match(consulta, /lote \? filtrarPorConta\(consulta, lote\) : consulta/);
  assert.doesNotMatch(consulta, /ids\.length > MAXIMO_IDS_NO_FILTRO\) return consulta/);
});

test("data de hoje usa calendário local e não UTC", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  const funcao = pagina.slice(pagina.indexOf("function toISO"), pagina.indexOf("function hojeBR"));

  assert.match(funcao, /getFullYear\(\)/);
  assert.match(funcao, /getMonth\(\)/);
  assert.match(funcao, /getDate\(\)/);
  assert.doesNotMatch(funcao, /toISOString\(\)/);
});
