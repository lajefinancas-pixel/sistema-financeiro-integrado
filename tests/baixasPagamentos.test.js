import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ACOES_BAIXAS,
  aplicarBaixa,
  aplicarEstorno,
  notaPodeReceberBaixa,
  notaQuitada,
  notasEmAberto,
  resolverPermissoesBaixas,
  resumoBaixas,
  situacaoPagamento,
  validarBaixaDeNota,
  validarValorBaixa,
  valorEmAbertoDaNota,
} from "../src/lib/regrasBaixas.js";

const read = (arquivo) => readFile(new URL(`../${arquivo}`, import.meta.url), "utf8");

test("baixa parcial evolui de em aberto até pago", () => {
  assert.equal(situacaoPagamento(50000, 0), "em_aberto");
  assert.equal(situacaoPagamento(50000, 20000), "parcialmente_pago");
  assert.equal(situacaoPagamento(50000, 50000), "pago");
  assert.deepEqual(resumoBaixas(50000, [
    { valor_pago: 20000, status: "efetivada" },
    { valor_pago: 15000, status: "efetivada" },
    { valor_pago: 5000, status: "estornada" },
  ]), { valorTotal: 50000, totalBaixado: 35000, saldoEmAberto: 15000, situacao: "parcialmente_pago" });
});

test("bloqueia baixa superior ao saldo em aberto", () => {
  assert.equal(validarValorBaixa(15000, 15000).ok, true);
  assert.equal(validarValorBaixa(15000.01, 15000).ok, false);
  assert.match(validarValorBaixa(0, 15000).mensagem, /maior que zero/);
});

test("permissões de baixa são independentes e relatórios incluem filtros", async () => {
  const [permissoes, relatorios, pagina] = await Promise.all([
    read("src/lib/permissoesEspeciais.js"),
    read("src/lib/relatoriosPersonalizados.js"),
    read("src/pages/Baixas.jsx"),
  ]);
  for (const acao of ["visualizar_baixas", "registrar_baixa", "registrar_baixa_avulsa", "editar_baixa", "estornar_baixa"]) assert.match(permissoes, new RegExp(acao));
  assert.match(relatorios, /id: "baixas"/);
  assert.match(relatorios, /campo: "fornecedor"/);
  assert.match(relatorios, /campo: "conta"/);
  assert.match(pagina, /exportarExcel/);
  assert.match(pagina, /exportarPDF/);
  assert.match(pagina, /imprimir/);
});

/* -------------------------------------------------------------------------
 * Teste de ponta a ponta da aba "Baixas de Pagamentos"
 *
 * Uma baixa PARCIAL e uma baixa INTEGRAL sobre a mesma nota, conferindo que o
 * valor em aberto foi abatido corretamente e que o SALDO DA CONTA NÃO FOI
 * ALTERADO. `aplicarBaixa` e `aplicarEstorno` são o espelho em JavaScript de
 * `public.registrar_baixa_nota` e `public.estornar_baixa_nota`.
 *
 * O saldo é observado por um razão em memória: a única forma de mexer nele é
 * chamar `movimentarSaldo`. Se qualquer passo da baixa tocasse no saldo, o
 * razão registraria -- e as asserções abaixo falhariam.
 * ---------------------------------------------------------------------- */

function bancoSimulado() {
  return {
    nota: {
      id: "nota-1",
      fornecedor_id: 7,
      numero_nota_fiscal: "1234",
      valor: 1000,
      valor_pago: 0,
      situacao: "em_aberto",
      data_vencimento: "2026-09-30",
    },
    baixas: [],
    conta: { id: 3, nome_conta: "Conta Movimento", saldo: 250_000 },
    razaoDeSaldo: [],
  };
}

/** O único caminho que altera saldo no sistema -- nenhuma baixa passa por aqui. */
function movimentarSaldo(banco, valor) {
  banco.conta.saldo += valor;
  banco.razaoDeSaldo.push(valor);
}

function registrar(banco, campos) {
  const efeito = aplicarBaixa(banco.nota, campos, banco.baixas);
  if (efeito.erro) return efeito;
  if (!efeito.jaRegistrada) {
    banco.nota = efeito.nota;
    banco.baixas = [...banco.baixas, { id: `baixa-${banco.baixas.length + 1}`, ...efeito.baixa }];
  }
  return efeito;
}

test("baixa parcial e baixa integral abatem o valor em aberto sem alterar o saldo da conta", () => {
  const banco = bancoSimulado();
  const saldoInicial = banco.conta.saldo;

  // Estado inicial: nota de R$ 1.000,00 inteiramente em aberto.
  assert.equal(valorEmAbertoDaNota(banco.nota), 1000);
  assert.equal(notaQuitada(banco.nota), false);

  // 1) Baixa PARCIAL de R$ 400,00.
  const parcial = registrar(banco, {
    chaveIdempotencia: "chave-parcial",
    valor: 400,
    dataPagamento: "2026-09-10",
    contaId: banco.conta.id,
    observacao: "primeira parcela paga no banco",
  });
  assert.equal(parcial.erro, undefined);
  assert.equal(banco.nota.valor_pago, 400);
  assert.equal(banco.nota.situacao, "parcialmente_pago");
  assert.equal(valorEmAbertoDaNota(banco.nota), 600);
  assert.equal(notaQuitada(banco.nota), false);
  assert.equal(banco.baixas.length, 1);
  assert.equal(banco.baixas[0].valor_pago, 400);
  assert.equal(banco.baixas[0].conta_id, banco.conta.id);
  assert.equal(banco.baixas[0].status, "efetivada");
  // O saldo não se mexeu.
  assert.equal(banco.conta.saldo, saldoInicial);
  assert.deepEqual(banco.razaoDeSaldo, []);
  // E a baixa não devolve nada de saldo para a tela gravar.
  assert.equal("saldo" in parcial, false);
  assert.equal("saldo" in parcial.baixa, false);

  // Confirmação repetida (duplo clique, F5): nada é lançado em duplicidade.
  const repetida = registrar(banco, {
    chaveIdempotencia: "chave-parcial",
    valor: 400,
    dataPagamento: "2026-09-10",
    contaId: banco.conta.id,
  });
  assert.equal(repetida.jaRegistrada, true);
  assert.equal(banco.baixas.length, 1);
  assert.equal(valorEmAbertoDaNota(banco.nota), 600);

  // Acima do que restou em aberto: recusado, com mensagem para leitura humana.
  const excesso = registrar(banco, {
    chaveIdempotencia: "chave-excesso",
    valor: 600.01,
    dataPagamento: "2026-09-20",
    contaId: banco.conta.id,
  });
  assert.match(excesso.erro, /em aberto/i);
  assert.equal(banco.baixas.length, 1);
  assert.equal(valorEmAbertoDaNota(banco.nota), 600);

  // 2) Baixa INTEGRAL do que restou: R$ 600,00.
  const integral = registrar(banco, {
    chaveIdempotencia: "chave-integral",
    valor: 600,
    dataPagamento: "2026-09-20",
    contaId: banco.conta.id,
  });
  assert.equal(integral.erro, undefined);
  assert.equal(banco.nota.valor_pago, 1000);
  assert.equal(banco.nota.situacao, "pago");
  assert.equal(valorEmAbertoDaNota(banco.nota), 0);
  assert.equal(notaQuitada(banco.nota), true);
  assert.equal(notaPodeReceberBaixa(banco.nota), false);
  assert.equal(banco.baixas.length, 2);
  // Nota quitada sai da lista de notas em aberto da tela.
  assert.deepEqual(notasEmAberto([banco.nota]), []);
  // O saldo continua exatamente onde estava, depois das duas baixas.
  assert.equal(banco.conta.saldo, saldoInicial);
  assert.deepEqual(banco.razaoDeSaldo, []);

  // Nota quitada não recebe nova baixa.
  const depoisDeQuitada = registrar(banco, {
    chaveIdempotencia: "chave-extra",
    valor: 10,
    dataPagamento: "2026-09-21",
    contaId: banco.conta.id,
  });
  assert.match(depoisDeQuitada.erro, /quitada|em aberto/i);
  assert.equal(banco.baixas.length, 2);

  // 3) Estorno da baixa integral: o valor volta para o em aberto e o registro
  // original é PRESERVADO (nunca apagado). O saldo, de novo, não se mexe.
  const estorno = aplicarEstorno(banco.nota, banco.baixas[1], "pagamento não confirmado pelo banco");
  assert.equal(estorno.erro, undefined);
  banco.nota = estorno.nota;
  banco.baixas = banco.baixas.map((item) => (item.id === estorno.baixa.id ? estorno.baixa : item));
  assert.equal(banco.nota.valor_pago, 400);
  assert.equal(banco.nota.situacao, "parcialmente_pago");
  assert.equal(valorEmAbertoDaNota(banco.nota), 600);
  assert.equal(banco.baixas.length, 2);
  assert.equal(banco.baixas[1].status, "estornada");
  assert.match(banco.baixas[1].motivo_estorno, /não confirmado/);
  assert.equal(banco.conta.saldo, saldoInicial);
  assert.deepEqual(banco.razaoDeSaldo, []);

  // O razão só se move quando alguém chama o caminho do saldo -- que a baixa
  // não chama em nenhum passo.
  movimentarSaldo(banco, -100);
  assert.equal(banco.conta.saldo, saldoInicial - 100);
  assert.deepEqual(banco.razaoDeSaldo, [-100]);

  // Estorno sem justificativa é recusado.
  assert.match(aplicarEstorno(banco.nota, banco.baixas[0], " ").erro, /justificativa/i);
  // Estorno repetido não duplica nada.
  assert.equal(aplicarEstorno(banco.nota, banco.baixas[1], "tentativa repetida").jaEstornada, true);
});

test("valor da baixa é recusado quando é zero, negativo ou sem conta", () => {
  const nota = { id: "n", valor: 500, valor_pago: 0, situacao: "em_aberto" };
  assert.match(validarBaixaDeNota({ nota, valor: 0, dataPagamento: "2026-09-01", contaId: 1 }).mensagem, /maior que zero/);
  assert.match(validarBaixaDeNota({ nota, valor: -5, dataPagamento: "2026-09-01", contaId: 1 }).mensagem, /maior que zero/);
  assert.equal(validarBaixaDeNota({ nota, valor: 500, dataPagamento: "2026-09-01", contaId: "" }).ok, false);
  assert.equal(validarBaixaDeNota({ nota, valor: 500, dataPagamento: "", contaId: 1 }).ok, false);
  assert.equal(validarBaixaDeNota({ nota, valor: 500, dataPagamento: "2026-09-01", contaId: 1 }).ok, true);
});

test("as cinco permissões do módulo de baixas são independentes e a concessão avulsa nunca subtrai", () => {
  // Matriz de Permissões decide: o módulo 'baixas' manda, mesmo quando a
  // permissão especial antiga está gravada como false.
  assert.deepEqual(
    resolverPermissoesBaixas({
      baixas: { pode_visualizar: true, pode_cadastrar: true, pode_editar: true, pode_aprovar: false, pode_excluir: false },
      especiais: { visualizar_baixas: false, registrar_baixa: false, estornar_baixa: false },
    }),
    { visualizar: true, registrar: true, imprimir: true, exportar: false, estornar: false },
  );

  // Sem linha do módulo novo, o padrão é o que a pessoa já tem em 'pagamentos'.
  assert.deepEqual(
    resolverPermissoesBaixas({
      pagamentos: { pode_visualizar: true, pode_cadastrar: false, pode_editar: false, pode_aprovar: true, pode_excluir: true },
    }),
    { visualizar: true, registrar: false, imprimir: true, exportar: true, estornar: true },
  );

  // A concessão avulsa antiga SOMA.
  assert.deepEqual(
    resolverPermissoesBaixas({
      baixas: { pode_visualizar: false, pode_cadastrar: false, pode_editar: false, pode_aprovar: false, pode_excluir: false },
      especiais: { registrar_baixa: true },
    }),
    { visualizar: false, registrar: true, imprimir: false, exportar: false, estornar: false },
  );

  // Sem nada, ninguém entra.
  assert.deepEqual(resolverPermissoesBaixas({}), {
    visualizar: false,
    registrar: false,
    imprimir: false,
    exportar: false,
    estornar: false,
  });

  assert.equal(ACOES_BAIXAS.length, 5);
  assert.equal(new Set(ACOES_BAIXAS.map((a) => a.campo)).size, 5);
});

test("o módulo de baixas tem rótulos próprios na Matriz de Permissões", async () => {
  const permissoes = await read("src/lib/permissoesUsuario.js");
  assert.match(permissoes, /\{ id: "baixas", label: "Baixas de Pagamentos" \}/);
  for (const label of ["Visualizar baixas", "Registrar baixa", "Imprimir", "Exportar", "Estornar baixa"]) {
    assert.match(permissoes, new RegExp(label));
  }
  assert.match(permissoes, /if \(modulo === MODULO_BAIXAS\) return ACOES_BAIXAS;/);
});

test("a baixa não movimenta saldo em nenhuma linha do código que a executa", async () => {
  const [migration, pagina, dados, modal] = await Promise.all([
    read("supabase/migrations/20260829120000_baixas_pagamentos_por_nota.sql"),
    read("src/pages/Baixas.jsx"),
    read("src/lib/baixasPagamentos.js"),
    read("src/components/baixas/ModalRegistrarBaixa.jsx"),
  ]);

  // Na migration, as tabelas de saldo só aparecem nos comentários que explicam
  // por que elas NÃO são tocadas.
  const sqlSemComentarios = migration
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n");
  for (const proibido of [
    "saldos_historico",
    "pagamento_movimentacoes",
    "transferencias_contas",
    "transferencia_lotes",
    "saldo_atual",
    "valor_saldo",
  ]) {
    assert.equal(sqlSemComentarios.includes(proibido), false, `a migration não deve tocar em ${proibido}`);
  }

  // A migration avisa que precisa ser rodada à mão e diz o próprio nome.
  assert.match(migration, /MANUALMENTE/);
  assert.match(migration, /20260829120000_baixas_pagamentos_por_nota\.sql/);

  // A tela e a camada de dados da aba não importam nada de saldo.
  for (const arquivo of [pagina, dados, modal]) {
    assert.equal(/buscarSaldoRealPorConta|montarSaldosDasContas|saldosContas\b/.test(arquivo), false);
  }

  // A gravação passa pelas duas funções do banco, e só por elas.
  assert.match(dados, /rpc\("registrar_baixa_nota"/);
  assert.match(dados, /rpc\("estornar_baixa_nota"/);
});

test("a trilha de auditoria tem rótulo para a baixa e para o estorno", async () => {
  const auditoria = await read("src/lib/auditoria.js");
  assert.match(auditoria, /registrou_baixa: "Registrou baixa"/);
  assert.match(auditoria, /estornou_baixa: "Estornou baixa"/);
});
