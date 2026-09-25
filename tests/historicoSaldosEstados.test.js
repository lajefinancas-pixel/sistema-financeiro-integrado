import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { montarSaldosDasContas, saldoRealPorConta } from "../src/lib/saldosContas.js";

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

test("histórico por data usa leitura paginada sem filtro tipado de conta", async () => {
  const consulta = await read("src/lib/saldosContasDados.js");
  const inicio = consulta.indexOf("export async function buscarSaldoHistoricoNaData");
  const trecho = consulta.slice(inicio, consulta.indexOf("/**", inicio + 10));

  assert.match(trecho, /buscarSaldoRealPorConta\(\{ ate \}\)/);
  assert.doesNotMatch(trecho, /contaIds|\.in\(/);
});

test("falha do histórico oferece detalhe técnico sem misturar erro e vazio", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  const trecho = pagina.slice(pagina.indexOf("{carregandoHistorico ?"), pagina.indexOf("{exclusaoPendente &&"));

  assert.match(pagina, /mensagemErroBanco\(e, "Erro sem detalhe devolvido pelo servidor\."\)/);
  assert.match(trecho, /erroHistorico[\s\S]*Ver detalhes técnicos[\s\S]*Tentar novamente/);
});

test("data de hoje usa calendário local e não UTC", async () => {
  const pagina = await read("src/pages/Saldos.jsx");
  const funcao = pagina.slice(pagina.indexOf("function toISO"), pagina.indexOf("function hojeBR"));

  assert.match(funcao, /getFullYear\(\)/);
  assert.match(funcao, /getMonth\(\)/);
  assert.match(funcao, /getDate\(\)/);
  assert.doesNotMatch(funcao, /toISOString\(\)/);
});

test("histórico distingue hoje, passado conhecido e data legitimamente vazia", () => {
  const contas = [{ id: 7, nome_conta: "Conta teste" }];
  const linhas = [
    { conta_id: 7, data_saldo: "2026-09-25", valor_saldo: "250.50" },
    { conta_id: 7, data_saldo: "2026-09-10", valor_saldo: "100.00" },
  ];
  const naData = (data) => montarSaldosDasContas(contas, {
    saldos: saldoRealPorConta(linhas.filter((linha) => linha.data_saldo <= data)),
    reservas: new Map(),
  }).filter((conta) => conta.dataSaldo !== null);

  assert.deepEqual(naData("2026-09-25").map((conta) => [conta.dataSaldo, conta.saldo]), [["2026-09-25", 250.5]]);
  assert.deepEqual(naData("2026-09-10").map((conta) => [conta.dataSaldo, conta.saldo]), [["2026-09-10", 100]]);
  assert.deepEqual(naData("2026-09-01"), []);
});
