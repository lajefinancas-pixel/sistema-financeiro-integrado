import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const migration = "supabase/migrations/20260923120000_duplicar_programacao_diaria.sql";

test("duplicação cria novo rascunho e copia somente a Proposta", async () => {
  const sql = await read(migration);
  assert.match(sql, /insert into public\.programacoes_pagamento/);
  assert.match(sql, /v_origem\.secretaria_id, p_data_destino/);
  assert.match(sql, /'em_elaboracao', false, 0, v_total, -v_total/);
  assert.match(sql, /insert into public\.pagamentos/);
  assert.match(sql, /p\.fornecedor_id, p\.nome_avulso, p\.valor_a_pagar, 'programado'/);
  assert.match(sql, /p\.nome_exibicao_programacao, p\.origem_tipo, p\.origem_id/);
});

test("duplicação não copia contas nem toca qualquer operação financeira", async () => {
  const sql = await read(migration);
  for (const alvo of [
    "programacao_contas", "contas_bancarias", "saldos_historico", "pagamentos_baixas",
    "valores_em_aberto", "notas_fiscais", "transferencias_contas", "estornar", "marcar_situacao_programacao",
  ]) assert.doesNotMatch(sql, new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${alvo}|${alvo}\\s+set`, "i"));
  assert.match(sql, /'contas_copiadas', 0/);
});

test("tela pede data livre, avisa conflito e não bloqueia uma segunda programação", async () => {
  const [pagina, modal] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/components/pagamentos/ModalDuplicarProgramacao.jsx"),
  ]);
  assert.match(pagina, /> Duplicar programação</);
  assert.match(pagina, /count: "exact", head: true/);
  assert.match(pagina, /duplicar_programacao_diaria/);
  assert.match(modal, /type="date" required autoFocus value=\{dataDestino\}/);
  assert.match(modal, /Já \{conflito === 1/);
  assert.match(modal, /Criar outra programação/);
  assert.doesNotMatch(modal, /hojeISO|amanhã|tomorrow/i);
});
