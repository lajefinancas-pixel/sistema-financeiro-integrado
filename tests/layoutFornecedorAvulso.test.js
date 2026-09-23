import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pagina = await readFile(
  new URL("../src/pages/PagamentosRedesenhado.jsx", import.meta.url),
  "utf8",
);

test("fornecedor avulso mantém campos dentro das colunas em telas largas", () => {
  assert.match(pagina, /sm:grid-cols-\[minmax\(0,1fr\)_9rem_auto\]/);
  assert.match(pagina, /className="min-w-0 w-full rounded-lg border/);
  assert.match(pagina, /aria-label="Valor do fornecedor avulso" className="w-full max-w-full/);
});

test("fornecedor avulso empilha controles e expande o botão em telas menores", () => {
  assert.match(pagina, /className="w-full rounded-lg bg-\[#A5542F\][^"]*sm:w-auto"/);
});

