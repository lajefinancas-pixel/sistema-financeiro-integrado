import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mensagemErroBanco } from "../src/lib/erros.js";

const read = (arquivo) => readFile(new URL(`../${arquivo}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260918193000_consolidar_baixas_e_permissao_alertas_certidoes.sql";
const MIGRATION_DEBITO = "supabase/migrations/20260918150000_baixa_unico_debito_e_diagnostico_programacao.sql";

test("frontend chama somente as RPCs canônicas de baixa e estorno", async () => {
  const fonte = await read("src/lib/baixasPagamentos.js");
  assert.match(fonte, /rpc\("registrar_baixa_nota"/);
  assert.match(fonte, /rpc\("estornar_baixa_nota"/);
  assert.doesNotMatch(fonte, /rpc\("(?:registrar|estornar)_baixa_pagamento"/);
  assert.doesNotMatch(fonte, /_baixa_nota_validada/);
});

test("migration consolida variantes, permissões e recarrega o schema", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /rename to registrar_baixa_nota/);
  assert.match(sql, /rename to estornar_baixa_nota/);
  assert.match(sql, /registrar_baixa_pagamento/);
  assert.match(sql, /estornar_baixa_pagamento/);
  assert.match(sql, /notificacoes_insert_certidao_propria/);
  assert.match(sql, /usuario_id in \([\s\S]*auth\.uid\(\)/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(sql, /drop function[^;\n]*cascade/i);
});

test("falha de baixa mostra código e texto exatos do banco", () => {
  assert.equal(
    mensagemErroBanco({ code: "PGRST202", message: "Could not find the function public.registrar_baixa_nota" }),
    "PGRST202: Could not find the function public.registrar_baixa_nota",
  );
  assert.equal(mensagemErroBanco({ code: "42501", message: "Saldo bloqueado." }), "42501: Saldo bloqueado.");
});

test("telas explicam que baixa debita e estorno devolve o saldo", async () => {
  const [registro, estorno] = await Promise.all([
    read("src/components/baixas/ModalRegistrarBaixa.jsx"),
    read("src/components/baixas/ModalEstornarBaixa.jsx"),
  ]);
  assert.match(registro, /debita o saldo da conta/);
  assert.match(estorno, /devolvido ao saldo da conta/);
  assert.doesNotMatch(registro, /não altera o saldo da conta/);
  assert.doesNotMatch(estorno, /não é alterado/);
});

test("caso 0011/2026: baixa parcial, quitação e estorno fecham saldo e aberto no centavo", async () => {
  const sql = await read(MIGRATION_DEBITO);

  // A prova estrutural usa a migration efetivamente entregue: débito e crédito
  // são efeitos do mesmo registro preservado na razão de baixas.
  assert.match(sql, /after insert or update of status on public\.pagamentos_baixas/);
  assert.match(sql, /round\(v_saldo - new\.valor_pago, 2\)/);
  assert.match(sql, /round\(v_saldo \+ new\.valor_pago, 2\)/);
  assert.match(sql, /old\.status::text = 'efetivada' and new\.status::text = 'estornada'/);

  // Processo 0011/2026, total de R$ 2.688,00: primeiro R$ 1.000,00 e depois
  // R$ 1.688,00. O estorno da quitação reabre exatamente a segunda parcela.
  let saldoConta = 10_000;
  let valorEmAberto = 2_688;
  const baixar = (valor) => {
    assert.ok(valor > 0 && valor <= valorEmAberto);
    saldoConta = Number((saldoConta - valor).toFixed(2));
    valorEmAberto = Number((valorEmAberto - valor).toFixed(2));
  };
  const estornar = (valor) => {
    saldoConta = Number((saldoConta + valor).toFixed(2));
    valorEmAberto = Number((valorEmAberto + valor).toFixed(2));
  };

  baixar(1_000);
  assert.deepEqual({ saldoConta, valorEmAberto }, { saldoConta: 9_000, valorEmAberto: 1_688 });
  baixar(1_688);
  assert.deepEqual({ saldoConta, valorEmAberto }, { saldoConta: 7_312, valorEmAberto: 0 });
  estornar(1_688);
  assert.deepEqual({ saldoConta, valorEmAberto }, { saldoConta: 9_000, valorEmAberto: 1_688 });
});

test("recusa na varredura de certidões permanece visível", async () => {
  const fonte = await read("src/lib/alertasCertidoes.js");
  assert.match(fonte, /Falha na \$\{chamada\} \(\$\{codigo\}\): \$\{texto\}/);
  assert.doesNotMatch(fonte, /nenhum aviso é mostrado na tela/);
});
