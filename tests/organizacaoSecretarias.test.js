import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("secretaria sem mapeamento recebe uma cor neutra declarada", async () => {
  const fonte = await readFile(new URL("../src/lib/organizacaoSecretarias.js", import.meta.url), "utf8");
  assert.match(fonte, /export const COR_NEUTRA_SECRETARIA = "#[0-9A-F]{6}"/i);
  assert.match(fonte, /indice < 0 \? COR_NEUTRA_SECRETARIA/);
});

test("seletor usa a variável cor declarada sem referência livre a color", async () => {
  const fonte = await readFile(new URL("../src/components/comuns/SeletorContas.jsx", import.meta.url), "utf8");
  assert.match(fonte, /color:\s*cor/);
  assert.doesNotMatch(fonte, /borderLeft:[^}]+,\s*color\s*}/);
});
