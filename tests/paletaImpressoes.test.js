import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { htmlProgramacao } from "../src/lib/programacaoDocumento.js";
import { COR_IMPRESSAO, TINTA_IMPRESSAO } from "../src/lib/paletaImpressao.js";

const documentos = [
  "programacaoDocumento.js",
  "relatoriosDocumento.js",
  "relacaoValoresDocumento.js",
  "saldosDocumento.js",
  "processosDocumentoComum.js",
  "processosDiariasDocumento.js",
  "processosServicosDocumento.js",
  "licitacoesContratosDocumento.js",
];

const verdesLegados = /#17352F|#E5EFEA|#0F2823|\[23,\s*53,\s*47\]|\[229,\s*239,\s*234\]/i;

test("todas as famílias de documentos impressos permanecem sem a paleta verde legada", async () => {
  const fontes = await Promise.all(documentos.map((arquivo) =>
    readFile(new URL(`../src/lib/${arquivo}`, import.meta.url), "utf8")));

  for (const fonte of fontes) assert.doesNotMatch(fonte, verdesLegados);
});

test("impressão da programação usa os mesmos tokens navy e off-white do PDF", () => {
  const html = htmlProgramacao({
    data: "16/09/2026",
    contas: [{ banco: "Banco", conta: "1", saldo: 100, nome: "Conta" }],
    pagamentos: [{ fornecedor: "Fornecedor", valor: 25 }],
    totalContas: 100,
    totalProgramado: 25,
    restante: 75,
  });

  assert.match(html, new RegExp(COR_IMPRESSAO.navy, "i"));
  assert.match(html, new RegExp(COR_IMPRESSAO.faixa, "i"));
  assert.doesNotMatch(html, verdesLegados);
  assert.deepEqual(TINTA_IMPRESSAO.navy, [15, 42, 68]);
  assert.deepEqual(TINTA_IMPRESSAO.faixa, [245, 243, 236]);
});

test("texto claro sobre navy conserva contraste adequado para impressão", () => {
  const luminancia = ([r, g, b]) => {
    const canais = [r, g, b].map((valor) => {
      const canal = valor / 255;
      return canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
  };
  const clara = luminancia(TINTA_IMPRESSAO.branco);
  const escura = luminancia(TINTA_IMPRESSAO.navy);
  const contraste = (clara + 0.05) / (escura + 0.05);

  assert.ok(contraste >= 7, `contraste esperado >= 7:1; recebido ${contraste.toFixed(2)}:1`);
});
