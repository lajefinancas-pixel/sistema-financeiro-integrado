import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INDICE_DOCUMENTO_UNICO,
  chaveDocumento,
  documentoInformado,
  duplicidadeDeDocumento,
  estruturaDeDocumentoUnicoAusente,
  fornecedorComMesmoDocumento,
  mensagemDocumentoDuplicado,
  mensagemDocumentoDuplicadoSemIdentificacao,
  mesmoDocumento,
  rotuloDocumento,
  situacaoDoFornecedor,
} from "../src/lib/documentoFornecedorRegras.js";

/**
 * UM DOCUMENTO, UM CADASTRO — a trava de fornecedor duplicado por CPF/CNPJ.
 *
 * Estes testes cobrem as regras em JavaScript, o texto da migration e a ligação
 * da tela. A prova em banco de verdade (índice único, edição e a migration que
 * aborta sem alterar nada) está em fornecedorDocumentoUnicoPostgresReal.test.js.
 */

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260910130000_fornecedor_documento_unico.sql";
const PAGINA = "src/pages/Fornecedores.jsx";

const PADARIA = { id: 1, razao_social: "Padaria Central Ltda.", cpf_cnpj: "12.345.678/0001-90", ativo: true };
const MERCADO = { id: 2, razao_social: "Mercado da Esquina ME", cpf_cnpj: "98765432000111", ativo: true };
const SEM_DOCUMENTO = { id: 3, razao_social: "Fornecedor Sem Documento", cpf_cnpj: null, ativo: true };
const CADASTRO = [PADARIA, MERCADO, SEM_DOCUMENTO];

/* -------------------------------------------------------------------------
 * 1 e 2. O mesmo documento é o mesmo documento, com ou sem pontuação
 * ---------------------------------------------------------------------- */

test("1. CPF/CNPJ já cadastrado é recusado dizendo o nome do fornecedor que já o usa", () => {
  const conflito = fornecedorComMesmoDocumento({ fornecedores: CADASTRO, cpfCnpj: "12.345.678/0001-90" });
  assert.equal(conflito, PADARIA);

  const mensagem = mensagemDocumentoDuplicado(conflito);
  assert.match(mensagem, /Padaria Central Ltda\./);
  assert.match(mensagem, /12\.345\.678\/0001-90/);
  assert.match(mensagem, /CNPJ/);
  // A pessoa precisa entender que não é erro de digitação.
  assert.match(mensagem, /não erro de digitação/);
});

test("2. pontuação não conta: 12.345.678/0001-90 e 12345678000190 são o mesmo documento", () => {
  assert.equal(chaveDocumento("12.345.678/0001-90"), "12345678000190");
  assert.equal(chaveDocumento(" 123.456.789-09 "), "12345678909");
  assert.equal(mesmoDocumento("12.345.678/0001-90", "12345678000190"), true);
  assert.equal(mesmoDocumento("12345678000190", "12.345.678/0001-90"), true);

  // O cadastro tem o documento pontuado; a digitação vem sem pontuação.
  assert.equal(fornecedorComMesmoDocumento({ fornecedores: CADASTRO, cpfCnpj: "12345678000190" }), PADARIA);
  // E o contrário: cadastro sem pontuação, digitação pontuada.
  assert.equal(
    fornecedorComMesmoDocumento({ fornecedores: CADASTRO, cpfCnpj: "98.765.432/0001-11" }),
    MERCADO,
  );
});

test("3. CPF/CNPJ inédito não é recusado", () => {
  assert.equal(fornecedorComMesmoDocumento({ fornecedores: CADASTRO, cpfCnpj: "11.222.333/0001-44" }), null);
  assert.equal(fornecedorComMesmoDocumento({ fornecedores: [], cpfCnpj: "11222333000144" }), null);
});

/* -------------------------------------------------------------------------
 * 3. A mesma conferência na edição
 * ---------------------------------------------------------------------- */

test("4. na edição o fornecedor não conflita consigo mesmo", () => {
  // Salvar o mesmo cadastro sem mexer no documento continua liberado.
  assert.equal(
    fornecedorComMesmoDocumento({ fornecedores: CADASTRO, cpfCnpj: PADARIA.cpf_cnpj, ignorarId: PADARIA.id }),
    null,
  );
  // Inclusive com o id em texto, como vem da tela.
  assert.equal(
    fornecedorComMesmoDocumento({ fornecedores: CADASTRO, cpfCnpj: "12345678000190", ignorarId: "1" }),
    null,
  );
});

test("4. na edição, mudar o documento para o de OUTRO fornecedor é recusado", () => {
  const conflito = fornecedorComMesmoDocumento({
    fornecedores: CADASTRO,
    cpfCnpj: "98.765.432/0001-11",
    ignorarId: PADARIA.id,
  });
  assert.equal(conflito, MERCADO);
  assert.match(mensagemDocumentoDuplicado(conflito), /Mercado da Esquina ME/);
});

/* -------------------------------------------------------------------------
 * 6. Fornecedor sem CPF/CNPJ continua permitido
 * ---------------------------------------------------------------------- */

test("6. fornecedor sem CPF/CNPJ não entra na trava", () => {
  assert.equal(documentoInformado(""), false);
  assert.equal(documentoInformado(null), false);
  assert.equal(documentoInformado("./-"), false);
  assert.equal(documentoInformado("12345678000190"), true);

  for (const vazio of ["", null, undefined, "   ", "./-"]) {
    assert.equal(fornecedorComMesmoDocumento({ fornecedores: CADASTRO, cpfCnpj: vazio }), null);
  }
  // Dois cadastros sem documento não são duplicidade entre si.
  const semDocumento = [SEM_DOCUMENTO, { id: 4, razao_social: "Outro sem documento", cpf_cnpj: "" }];
  assert.equal(fornecedorComMesmoDocumento({ fornecedores: semDocumento, cpfCnpj: "" }), null);
});

/* -------------------------------------------------------------------------
 * 7. Inativo e excluído: entram na verificação, com o caminho de saída
 * ---------------------------------------------------------------------- */

test("7. cadastro INATIVO com o mesmo documento é recusado oferecendo reativar", () => {
  const inativo = { id: 9, razao_social: "Transportes Antigos Ltda.", cpf_cnpj: "11.222.333/0001-44", ativo: false };
  assert.equal(situacaoDoFornecedor(inativo), "inativo");

  const mensagem = mensagemDocumentoDuplicado(inativo);
  assert.match(mensagem, /Transportes Antigos Ltda\./);
  assert.match(mensagem, /INATIVO/);
  assert.match(mensagem, /reative o cadastro que já existe/i);
  assert.doesNotMatch(mensagem, /Lixeira/);
});

test("7. cadastro na LIXEIRA com o mesmo documento é recusado oferecendo restaurar", () => {
  const excluido = {
    id: 10,
    razao_social: "Gráfica Excluída Ltda.",
    cpf_cnpj: "44.555.666/0001-77",
    ativo: false,
    excluido_em: "2026-09-01T12:00:00Z",
  };
  assert.equal(situacaoDoFornecedor(excluido), "excluido");

  const mensagem = mensagemDocumentoDuplicado(excluido);
  assert.match(mensagem, /Gráfica Excluída Ltda\./);
  assert.match(mensagem, /LIXEIRA/);
  assert.match(mensagem, /restaure o cadastro pela Lixeira/i);
});

test("7. a situação vinda do banco é respeitada como está", () => {
  assert.equal(situacaoDoFornecedor({ situacao: "inativo", ativo: true }), "inativo");
  assert.equal(situacaoDoFornecedor({ situacao: "excluido" }), "excluido");
  assert.equal(situacaoDoFornecedor({}), "ativo");
});

test("o rótulo do documento acompanha a quantidade de dígitos", () => {
  assert.equal(rotuloDocumento("123.456.789-09"), "CPF");
  assert.equal(rotuloDocumento("12.345.678/0001-90"), "CNPJ");
  assert.equal(rotuloDocumento("1234"), "CPF/CNPJ");
});

test("sem saber de quem é o cadastro, a recusa ainda diz o documento e o caminho", () => {
  const mensagem = mensagemDocumentoDuplicadoSemIdentificacao("12.345.678/0001-90");
  assert.match(mensagem, /12\.345\.678\/0001-90/);
  assert.match(mensagem, /um único cadastro/i);
  assert.match(mensagem, /inativos e na Lixeira/i);
});

/* -------------------------------------------------------------------------
 * A recusa do banco traduzida, e o banco sem a migration
 * ---------------------------------------------------------------------- */

test("a recusa do índice único é reconhecida; outra duplicidade não é confundida", () => {
  assert.equal(
    duplicidadeDeDocumento({
      code: "23505",
      message: `duplicate key value violates unique constraint "${INDICE_DOCUMENTO_UNICO}"`,
    }),
    true,
  );
  assert.equal(
    duplicidadeDeDocumento({ code: "23505", details: "Key (cpf_cnpj)=(12345678000190) already exists." }),
    true,
  );
  // Duplicidade de outra coisa continua sendo tratada como sempre.
  assert.equal(
    duplicidadeDeDocumento({ code: "23505", message: 'duplicate key value violates unique constraint "fornecedores_pkey"' }),
    false,
  );
  assert.equal(duplicidadeDeDocumento({ code: "23503", message: "foreign key" }), false);
  assert.equal(duplicidadeDeDocumento(null), false);
});

test("banco sem a migration é reconhecido como estrutura ausente, não como erro de uso", () => {
  assert.equal(estruturaDeDocumentoUnicoAusente({ code: "42883" }), true);
  assert.equal(
    estruturaDeDocumentoUnicoAusente({ code: "PGRST202", message: "Could not find the function public.fornecedor_com_documento" }),
    true,
  );
  assert.equal(estruturaDeDocumentoUnicoAusente({ code: "42501", message: "permissão" }), false);
});

/* -------------------------------------------------------------------------
 * 4 e 5. A migration: trava no banco, e nada é alterado
 * ---------------------------------------------------------------------- */

test("a migration avisa que é manual e cria o índice único sobre o documento normalizado", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /rodada MANUALMENTE no SQL Editor do\n-- Supabase/);
  assert.match(
    sql,
    /create unique index if not exists fornecedores_cpf_cnpj_unico_idx\s*\n\s*on public\.fornecedores \(\(regexp_replace\(cpf_cnpj, '\[\^0-9\]', '', 'g'\)\)\)/,
  );
  // 6. Nulo e documento sem dígito ficam fora do índice.
  assert.match(sql, /where cpf_cnpj is not null\s*\n\s*and regexp_replace\(cpf_cnpj, '\[\^0-9\]', '', 'g'\) <> ''/);
  // 7. O índice cobre inativo e excluído: nenhum recorte por ativo/excluido_em.
  const indice = sql.slice(sql.indexOf("create unique index"), sql.indexOf("comment on index"));
  assert.doesNotMatch(indice, /ativo|excluido_em/);
});

test("5. havendo duplicados, a migration ABORTA listando quantos e quais", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /MIGRATION ABORTADA/);
  assert.match(sql, /having count\(\*\) > 1/);
  assert.match(sql, /string_agg\(\s*\n\s*format\('%s \(%s cadastros, ids %s\)', documento, cadastros, ids\)/);
  assert.match(sql, /Documentos repetidos: %/);
  assert.match(sql, /NENHUM fornecedor foi apagado, mesclado ou alterado/);
  // A conferência vem ANTES da criação do índice, para a mensagem ser a dela.
  assert.ok(sql.indexOf("MIGRATION ABORTADA") < sql.indexOf("create unique index if not exists"));
});

test("5. a migration não escreve em nenhum fornecedor", async () => {
  const sql = await read(MIGRATION);
  const comandos = sql.replace(/^\s*--.*$/gm, "");
  assert.deepEqual(comandos.match(/\bupdate\s+public\.\w+/gi) ?? [], []);
  assert.deepEqual(comandos.match(/\bdelete\s+from\s+public\.\w+/gi) ?? [], []);
  assert.deepEqual(comandos.match(/\binsert\s+into\s+public\.\w+/gi) ?? [], []);
  assert.deepEqual(comandos.match(/\bmerge\s+into\s+public\.\w+/gi) ?? [], []);
  assert.deepEqual(comandos.match(/\balter\s+table\s+public\.\w+/gi) ?? [], []);
  assert.deepEqual(comandos.match(/\bdrop\s+\w+/gi) ?? [], []);
  assert.deepEqual(comandos.match(/\btruncate\b/gi) ?? [], []);
});

test("a consulta de quem já usa o documento é só leitura e só identificação", async () => {
  const sql = await read(MIGRATION);
  const corpo = sql.slice(
    sql.indexOf("create or replace function public.fornecedor_com_documento"),
    sql.indexOf("revoke all on function public.fornecedor_com_documento"),
  );
  assert.match(corpo, /\bstable\b/);
  assert.match(corpo, /security definer/);
  assert.match(corpo, /set search_path = public/);
  // Permissão: reaproveita o módulo 'fornecedores' que já existe.
  assert.match(corpo, /pe\.modulo = 'fornecedores'/);
  assert.match(corpo, /Usuário não autenticado\./);
  // Só identificação sai daqui: nada de dado bancário ou alíquota.
  const resposta = corpo.slice(corpo.lastIndexOf("return jsonb_build_object"));
  assert.doesNotMatch(resposta, /aliquota|agencia|pix|numero_conta|banco/i);
  // p_ignorar_id é o que faz a mesma consulta servir para a edição.
  assert.match(corpo, /p_ignorar_id is null or f\.id::text <> p_ignorar_id/);
  assert.match(sql, /grant execute on function public\.fornecedor_com_documento\(text, text\) to authenticated;/);
});

/* -------------------------------------------------------------------------
 * A tela
 * ---------------------------------------------------------------------- */

test("o cadastro na tela confere o documento antes de gravar e traduz a recusa do banco", async () => {
  const pagina = await read(PAGINA);
  assert.match(pagina, /await conferirDocumentoDisponivel\(\{ cpfCnpj: form\.cpf_cnpj, fornecedores \}\);/);
  assert.match(pagina, /if \(duplicidadeDeDocumento\(error\)\) \{/);
  assert.match(pagina, /await mensagemDeDuplicidadeDoBanco\(\{ cpfCnpj: form\.cpf_cnpj \}\)/);
  // A conferência acontece ANTES do insert.
  assert.ok(
    pagina.indexOf("await conferirDocumentoDisponivel") <
      pagina.indexOf('await supabase.from("fornecedores").insert(cadastro)'),
  );
});

test("nenhum caminho da aplicação altera o CPF/CNPJ de um fornecedor já cadastrado", async () => {
  const [pagina, documento] = await Promise.all([read(PAGINA), read("src/lib/documentoFornecedor.js")]);
  // A tela edita apelido e situação; o documento não tem campo de edição.
  assert.doesNotMatch(pagina, /update\(\{[^}]*cpf_cnpj/);
  // A conferência é só leitura: nenhuma gravação em fornecedores mora nela.
  assert.doesNotMatch(documento, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  // E a mesma conferência já aceita o id do próprio cadastro, para a edição.
  assert.match(documento, /ignorarId/);
});
