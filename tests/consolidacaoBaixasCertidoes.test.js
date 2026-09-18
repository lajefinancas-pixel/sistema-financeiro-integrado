import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mensagemErroBanco } from "../src/lib/erros.js";

const read = (arquivo) => readFile(new URL(`../${arquivo}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260918193000_consolidar_baixas_e_permissao_alertas_certidoes.sql";

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

test("recusa na varredura de certidões permanece visível", async () => {
  const fonte = await read("src/lib/alertasCertidoes.js");
  assert.match(fonte, /Falha na \$\{chamada\} \(\$\{codigo\}\): \$\{texto\}/);
  assert.doesNotMatch(fonte, /nenhum aviso é mostrado na tela/);
});
