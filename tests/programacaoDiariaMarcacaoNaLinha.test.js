import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { situacaoDaMarcacao } from "../src/lib/execucaoProgramacao.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("a execução oferece somente pago e não pago na lista única", async () => {
  const [pagina, linhas] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/components/pagamentos/LinhasExecucaoProgramacao.jsx"),
  ]);

  assert.match(pagina, /emEtapaDeExecucao \? <LinhasExecucaoProgramacao/);
  assert.equal((pagina.match(/<LinhasExecucaoProgramacao/g) ?? []).length, 1);
  assert.match(linhas, /\["pago", "PAGO"\].*\["nao_pago", "NÃO PAGO"\]/);
  assert.doesNotMatch(linhas, /CampoMoeda|Parciais|valor parcial|Execução<\/span>/i);
  assert.match(linhas, /\["todos","Todos".*\["pago","Pagos".*\["nao_pago","Não pagos".*\["pendente","Pendentes"/s);
});

test("legado parcial passa a pendente e os estados integrais continuam reconhecidos", () => {
  assert.equal(situacaoDaMarcacao({ situacao: "pago", valor_pago: 100 }), "pago");
  assert.equal(situacaoDaMarcacao({ situacao: "suspenso" }), "nao_pago");
  assert.equal(situacaoDaMarcacao({ situacao: "parcialmente_pago", valor_pago: 50 }), "pendente");
  assert.equal(situacaoDaMarcacao({ situacao: "programado" }), "pendente");
});

test("marcar usa o valor integral e não recalcula os saldos do planejamento", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  const marcar = pagina.slice(pagina.indexOf("async function marcarSituacao"), pagina.indexOf("async function definirAdiamento"));

  assert.match(pagina, /totalPago = pagamentos\.reduce\([\s\S]*item\.situacao === "pago" \? numero\(item\.valor_a_pagar\) : 0/);
  assert.match(pagina, /totalNaoPago = pagamentos\.reduce\([\s\S]*numero\(item\.valor_a_pagar\)/);
  assert.match(pagina, /restante = calcularRestante\(totalDisponivel, totalProgramado\)/);
  assert.match(marcar, /marcar_situacao_programacao/);
  assert.match(marcar, /p_pagamento_id: String\(pagamento\.id\)[\s\S]*p_situacao: situacao/);
  assert.doesNotMatch(marcar, /p_valor_pago/);
  assert.match(marcar, /code: falha\?\.code[\s\S]*details: falha\?\.details/);
  assert.doesNotMatch(marcar, /contas_bancarias|saldos_historico|pagamentos_baixas|update\(.*saldo/is);
});

test("clicar na marcação ativa desfaz para pendente", async () => {
  const linhas = await read("src/components/pagamentos/LinhasExecucaoProgramacao.jsx");
  assert.match(linhas, /situacao\(item\) === nova \? "pendente" : nova/);
});

test("migration consolida a assinatura e protege o enum legado sem tocar saldos", async () => {
  const sql = await read("supabase/migrations/20260919120000_consolidar_marcacao_programacao_diaria.sql");
  assert.match(sql, /add value if not exists.*suspenso/i);
  assert.match(sql, /drop function if exists public\.marcar_situacao_programacao\(text, text, numeric\)/i);
  assert.match(sql, /function public\.marcar_situacao_programacao\(\s*p_pagamento_id text,\s*p_situacao text/s);
  assert.match(sql, /when 'pendente' then 'programado'/);
  assert.match(sql, /'movimentou_saldo', false/);
  assert.doesNotMatch(sql, /insert into public\.saldos_historico|update public\.contas_bancarias/i);
});

test("saldo da programação volta a ser o valor principal do topo", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  const topo = pagina.slice(pagina.indexOf("sticky top-0"), pagina.indexOf("lg:grid-cols", pagina.indexOf("sticky top-0")));
  assert.ok(topo.indexOf("Saldo da programação") < topo.indexOf("Saldo restante"));
  assert.match(topo, /Saldo da programação<\/span><strong className="text-xl/);
});
