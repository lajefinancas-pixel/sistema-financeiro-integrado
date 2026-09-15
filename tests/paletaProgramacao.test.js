import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const arquivos = [
  "../src/pages/PagamentosRedesenhado.jsx",
  "../src/components/pagamentos/ModalTransferenciaEntreContas.jsx",
  "../src/components/pagamentos/PainelExecucaoProgramacao.jsx",
  "../src/components/pagamentos/ModalAprovacaoProgramacao.jsx",
  "../src/components/pagamentos/ModalReaberturaProgramacao.jsx",
  "../src/components/pagamentos/ModalEstornoTransferencia.jsx",
];

test("programação e modais usam os tokens oficiais no lugar do verde de identidade", async () => {
  const fontes = await Promise.all(arquivos.map((arquivo) => readFile(new URL(arquivo, import.meta.url), "utf8")));
  for (const fonte of fontes) {
    assert.doesNotMatch(fonte, /#17352F|#E5EFEA|#0F2823/);
  }
  assert.match(fontes.join("\n"), /var\(--color-brand-navy\)/);
  assert.match(fontes.join("\n"), /var\(--color-brand-gold\)/);
  assert.match(fontes.join("\n"), /var\(--color-brand-off-white\)/);
});

test("verde permanece apenas na mensagem semântica de sucesso", async () => {
  const pagina = await readFile(new URL(arquivos[0], import.meta.url), "utf8");
  assert.match(pagina, /erro \? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"/);
});
