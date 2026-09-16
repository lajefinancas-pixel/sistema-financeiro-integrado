import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a exportacao descobre todas as tabelas public em vez de manter lista fixa", async () => {
  const sql = await read("supabase/migrations/20260916020000_backup_real_do_sistema.sql");
  assert.match(sql, /pg_class/);
  assert.match(sql, /n\.nspname = 'public'/);
  assert.match(sql, /order by c\.relname/);
  assert.match(sql, /grant execute on function public\.exportar_backup_completo\(\) to service_role/);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/);
});

test("a Edge Function compacta, armazena e registra tamanho real e falhas", async () => {
  const edge = await read("supabase/functions/gerar-backup/index.ts");
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /CompressionStream\("gzip"\)/);
  assert.match(edge, /compactado\.byteLength/);
  assert.match(edge, /\.from\("backups-sistema"\)\.upload/);
  assert.match(edge, /status: "concluido"/);
  assert.match(edge, /status: "falhou"/);
  assert.match(edge, /createSignedUrl\(caminho, 600/);
});

test("o navegador chama o backend e baixa o arquivo real", async () => {
  const backups = await read("src/lib/backups.js");
  const tela = await read("src/components/configuracoes/CategoriaBackup.jsx");
  assert.match(backups, /functions\.invoke\("gerar-backup"/);
  assert.match(backups, /downloadUrl: data\.download_url/);
  assert.match(tela, /link\.href = resultado\.downloadUrl/);
  assert.match(tela, /Tamanho real:/);
});

test("o agendamento documentado executa as 02:00 de Maceio", async () => {
  const docs = await read("supabase/functions/gerar-backup/README.md");
  assert.match(docs, /'0 5 \* \* \*'/);
  assert.match(docs, /02:00 em `America\/Maceio`/);
  assert.match(docs, /x-backup-secret/);
});
