// Testes do envio "Apelido e nome de exibição do fornecedor".
//
// Um fornecedor passa a poder ter três nomes ao mesmo tempo, e eles NÃO se
// substituem:
//
//   RAZÃO SOCIAL -- o nome oficial do cadastro, que continua gravado e continua
//   sendo o que vai para documento oficial e fiscal.
//   APELIDO -- opcional, do cadastro ("Zé Alimentos"), para reconhecer e buscar
//   o fornecedor na tela.
//   NOME DE EXIBIÇÃO DA PROGRAMAÇÃO -- opcional, do ITEM de uma programação
//   diária ("Zé Alimentos — Merenda"), que vale só naquela programação.
//
// O que estes testes travam:
//
//   O APELIDO É OPCIONAL: CADASTRO SEM APELIDO CONTINUA IDÊNTICO
//   A BUSCA ENCONTRA PELO APELIDO SEM DEIXAR DE ENCONTRAR PELA RAZÃO SOCIAL E PELO CNPJ
//   O APELIDO APARECE EM DESTAQUE E A RAZÃO SOCIAL VIRA A LINHA SECUNDÁRIA
//   RENOMEAR NA PROGRAMAÇÃO NÃO ALTERA CADASTRO NENHUM
//   O VÍNCULO É PELO ID, NUNCA PELO NOME MOSTRADO
//   A IMPRESSÃO USA O MESMO NOME DA TELA
//   DOCUMENTO OFICIAL CONTINUA COM A RAZÃO SOCIAL
//
// A parte que só o banco faz valer é travada pelo texto da migration, que é a
// única coisa que a garante de verdade.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  apelidoDoFornecedor,
  complementoDoFornecedor,
  complementoDoPagamento,
  estruturaDeApelidoAusente,
  filtrarFornecedoresPorTermo,
  fornecedorAtendeBusca,
  nomeExibicaoDoFornecedor,
  nomeExibicaoDoPagamento,
  nomeOficialDoFornecedor,
  nomeOficialDoPagamento,
  normalizarNomeExibicao,
  temApelido,
} from "../src/lib/nomesFornecedor.js";
import { filtrarFornecedores, nomeDoFornecedor } from "../src/lib/regrasBaixas.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const MIGRATION = "supabase/migrations/20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql";
const PAGINA_FORNECEDORES = "src/pages/Fornecedores.jsx";
const PAGINA_PROGRAMACAO = "src/pages/PagamentosRedesenhado.jsx";
const PAGINA_BAIXAS = "src/pages/Baixas.jsx";
const COMPONENTE_NOME = "src/components/comuns/NomeFornecedor.jsx";
const DADOS_EXECUCAO = "src/lib/execucaoProgramacaoDados.js";

// Cadastros de exemplo do próprio comando: a razão social é longa, o apelido é
// como as pessoas chamam o fornecedor.
const ZE = {
  id: 7,
  razao_social: "José da Silva Comércio de Alimentos Ltda.",
  nome_fantasia: "Silva Alimentos",
  apelido: "Zé Alimentos",
  cpf_cnpj: "12.345.678/0001-99",
};
const PADARIA = {
  id: 8,
  razao_social: "Padaria Central Ltda.",
  nome_fantasia: null,
  apelido: null,
  cpf_cnpj: "98.765.432/0001-11",
};

/* -------------------------------------------------------------------------
 * 1. O campo apelido existe e é opcional
 * ---------------------------------------------------------------------- */

test("1. apelido é opcional: fornecedor sem apelido continua exibido como sempre", () => {
  assert.equal(temApelido(PADARIA), false);
  assert.equal(apelidoDoFornecedor(PADARIA), "");
  // Sem apelido não há mudança nenhuma: uma linha, a razão social.
  assert.equal(nomeExibicaoDoFornecedor(PADARIA), "Padaria Central Ltda.");
  assert.equal(complementoDoFornecedor(PADARIA), "");

  // Campo em branco, com espaços ou nulo é ausência de apelido, não apelido vazio.
  for (const valor of [null, undefined, "", "   "]) {
    assert.equal(temApelido({ ...PADARIA, apelido: valor }), false);
    assert.equal(nomeExibicaoDoFornecedor({ ...PADARIA, apelido: valor }), "Padaria Central Ltda.");
  }
});

test("1. a tela de cadastro grava o apelido só quando ele foi preenchido", async () => {
  const pagina = await read(PAGINA_FORNECEDORES);
  assert.match(pagina, /Apelido \/ Nome de exibição \(opcional\)/);
  assert.match(pagina, /apelido: ""/);
  // Apelido vazio nem entra no insert: cadastrar continua funcionando em banco
  // onde a migration ainda não rodou.
  assert.match(pagina, /if \(apelido\) cadastro\.apelido = apelido;/);
  assert.match(pagina, /estruturaDeApelidoAusente\(error\)\) throw erroAmigavel\(AVISO_MIGRATION_APELIDO\)/);
  // A razão social continua obrigatória e continua sendo gravada.
  assert.match(pagina, /razao_social: form\.razao_social,/);
  assert.match(pagina, /Preencha razão social, CPF\/CNPJ e secretaria\./);
});

test("1. a migration cria as duas colunas novas sem tocar em nada existente", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /alter table public\.fornecedores\s*\n\s*add column if not exists apelido text;/);
  assert.match(sql, /alter table public\.pagamentos\s*\n\s*add column if not exists nome_exibicao_programacao text;/);
  // Coluna nova é sempre "add column if not exists": nada é removido, renomeado
  // nem alterado de tipo.
  assert.doesNotMatch(sql, /drop column|drop table|rename column|alter column .* type|truncate/i);
  assert.match(sql, /rodada manualmente no SQL Editor/i);
});

/* -------------------------------------------------------------------------
 * 2 e 3. A busca
 * ---------------------------------------------------------------------- */

test("2. a busca encontra o fornecedor pelo apelido", () => {
  const lista = [ZE, PADARIA];
  for (const termo of ["Zé", "ze", "ZE ALIMENTOS", " zé alim "]) {
    const achados = filtrarFornecedoresPorTermo(lista, termo);
    assert.deepEqual(achados.map((f) => f.id), [7], `termo: ${termo}`);
  }
});

test("3. a busca continua encontrando pela razão social, nome fantasia e CPF/CNPJ", () => {
  const lista = [ZE, PADARIA];
  assert.deepEqual(filtrarFornecedoresPorTermo(lista, "josé da silva").map((f) => f.id), [7]);
  assert.deepEqual(filtrarFornecedoresPorTermo(lista, "Silva Alimentos").map((f) => f.id), [7]);
  assert.deepEqual(filtrarFornecedoresPorTermo(lista, "12.345.678").map((f) => f.id), [7]);
  assert.deepEqual(filtrarFornecedoresPorTermo(lista, "12345678").map((f) => f.id), [7]);
  assert.deepEqual(filtrarFornecedoresPorTermo(lista, "padaria").map((f) => f.id), [8]);
  assert.deepEqual(filtrarFornecedoresPorTermo(lista, "98765432000111").map((f) => f.id), [8]);
  // Termo vazio devolve a lista inteira, e quem não combina fica fora.
  assert.equal(filtrarFornecedoresPorTermo(lista, "").length, 2);
  assert.equal(filtrarFornecedoresPorTermo(lista, "supermercado").length, 0);
  // Fornecedor sem apelido não é prejudicado pela existência do campo.
  assert.equal(fornecedorAtendeBusca(PADARIA, "central"), true);
});

test("2. a mesma busca vale na tela de Baixas, na Programação Diária e no cadastro", async () => {
  // Baixas usa a regra compartilhada.
  assert.deepEqual(filtrarFornecedores([ZE, PADARIA], "zé").map((f) => f.id), [7]);

  const baixas = await read(PAGINA_BAIXAS);
  assert.match(baixas, /Busque por nome, apelido, razão social, nome fantasia ou CNPJ\/CPF/);

  const programacao = await read(PAGINA_PROGRAMACAO);
  assert.match(programacao, /filtrarFornecedoresPorTermo\(fornecedores, buscaFornecedor\)/);
  assert.match(programacao, /placeholder="Buscar por nome, apelido, razão social ou CNPJ\/CPF"/);
  // A consulta traz o apelido e o CPF/CNPJ, senão a busca não teria o que comparar.
  assert.match(programacao, /COLUNAS_FORNECEDOR_PROGRAMACAO = "id, razao_social, nome_fantasia, cpf_cnpj"/);
  assert.match(programacao, /\$\{COLUNAS_FORNECEDOR_PROGRAMACAO\}, apelido/);

  const cadastro = await read(PAGINA_FORNECEDORES);
  assert.match(cadastro, /\$\{f\.apelido \?\? ""\}/);
});

/* -------------------------------------------------------------------------
 * 4. O apelido em destaque nas telas operacionais
 * ---------------------------------------------------------------------- */

test("4. o apelido aparece em destaque e a razão social vira a informação secundária", () => {
  assert.equal(nomeExibicaoDoFornecedor(ZE), "Zé Alimentos");
  assert.equal(complementoDoFornecedor(ZE), "José da Silva Comércio de Alimentos Ltda.");
  // A razão social não é substituída em lugar nenhum: continua disponível.
  assert.equal(nomeOficialDoFornecedor(ZE), "José da Silva Comércio de Alimentos Ltda.");
  // Sem apelido, uma linha só -- a tela fica como era.
  assert.equal(complementoDoFornecedor(PADARIA), "");
});

test("4. as telas operacionais usam o mesmo componente de nome", async () => {
  const componente = await read(COMPONENTE_NOME);
  assert.match(componente, /nomeExibicaoDoPagamento\(pagamento\) : nomeExibicaoDoFornecedor\(fornecedor\)/);
  assert.match(componente, /complementoDoPagamento\(pagamento\) : complementoDoFornecedor\(fornecedor\)/);
  // Sem segunda linha quando não há apelido: nada é acrescentado à tela atual.
  assert.match(componente, /secundaria !== "" &&/);

  for (const caminho of [PAGINA_FORNECEDORES, PAGINA_PROGRAMACAO, PAGINA_BAIXAS]) {
    const pagina = await read(caminho);
    assert.match(pagina, /import NomeFornecedor from ".*components\/comuns\/NomeFornecedor"/, caminho);
    assert.match(pagina, /<NomeFornecedor/, caminho);
  }
});

/* -------------------------------------------------------------------------
 * 5, 6 e 7. Renomear na Programação Diária
 * ---------------------------------------------------------------------- */

test("5. o nome do fornecedor é editável na Programação Diária, sem sair da tela", async () => {
  const pagina = await read(PAGINA_PROGRAMACAO);
  assert.match(pagina, /import \{ AlertTriangle, Check, FileDown, FileSpreadsheet, Pencil,/);
  assert.match(pagina, /<Pencil size=\{13\} \/>/);
  assert.match(pagina, /onClick=\{\(\) => abrirNomeExibicao\(pagamento, indice\)\}/);
  assert.match(pagina, /onClick=\{\(\) => salvarNomeExibicao\(pagamento, indice\)\}/);
  // Grava pela função do banco, e o item ainda não gravado guarda o nome na
  // tela até o "Salvar programação".
  assert.match(pagina, /await definirNomeExibicaoDoPagamento\(\{/);
  assert.match(pagina, /if \(vazio\(pagamento\.id\)\) \{/);
  assert.match(pagina, /nome_exibicao_programacao: normalizarNomeExibicao\(item\.nome_exibicao_programacao\)/);

  const dados = await read(DADOS_EXECUCAO);
  assert.match(dados, /supabase\.rpc\("definir_nome_exibicao_programacao"/);
});

test("5. o nome mostrado do item obedece programação -> apelido -> razão social", () => {
  const semNada = { id: 30, fornecedor_id: 7, fornecedores: { razao_social: PADARIA.razao_social } };
  assert.equal(nomeExibicaoDoPagamento(semNada), "Padaria Central Ltda.");

  const comApelido = { id: 31, fornecedor_id: 7, fornecedores: ZE };
  assert.equal(nomeExibicaoDoPagamento(comApelido), "Zé Alimentos");

  const renomeado = { ...comApelido, nome_exibicao_programacao: "Zé Alimentos — Merenda" };
  assert.equal(nomeExibicaoDoPagamento(renomeado), "Zé Alimentos — Merenda");
  assert.equal(complementoDoPagamento(renomeado), "José da Silva Comércio de Alimentos Ltda.");

  // Campo apagado devolve o item ao nome de sempre.
  assert.equal(normalizarNomeExibicao("   "), null);
  assert.equal(nomeExibicaoDoPagamento({ ...comApelido, nome_exibicao_programacao: "  " }), "Zé Alimentos");
  // Espaços repetidos e limite de tamanho, iguais aos do banco.
  assert.equal(normalizarNomeExibicao("  Zé   Alimentos —  Merenda "), "Zé Alimentos — Merenda");
  assert.equal(normalizarNomeExibicao("x".repeat(200)).length, 120);
});

test("6. renomear na programação não altera razão social, apelido nem o resto do cadastro", async () => {
  // Na tela: o nome renomeado é do ITEM, e o cadastro segue intacto ao lado.
  const item = {
    id: 31,
    fornecedor_id: 7,
    fornecedores: ZE,
    nome_exibicao_programacao: "Zé Alimentos — Merenda",
  };
  assert.equal(nomeExibicaoDoPagamento(item), "Zé Alimentos — Merenda");
  assert.equal(nomeOficialDoPagamento(item), "José da Silva Comércio de Alimentos Ltda.");
  assert.equal(apelidoDoFornecedor(item.fornecedores), "Zé Alimentos");
  assert.equal(item.fornecedores.cpf_cnpj, "12.345.678/0001-99");

  // No banco: a função escreve UMA coluna e nenhuma outra tabela.
  const sql = await read(MIGRATION);
  const corpo = sql.slice(
    sql.indexOf("create or replace function public.definir_nome_exibicao_programacao"),
    sql.indexOf("grant execute on function public.definir_nome_exibicao_programacao"),
  );
  assert.match(corpo, /update public\.pagamentos\s*\n\s*set nome_exibicao_programacao = v_nome\s*\n\s*where id = p_pagamento_id;/);
  const escritas = corpo.match(/\bupdate\s+public\.\w+/g) ?? [];
  assert.deepEqual(escritas, ["update public.pagamentos"]);
  // O único insert é o da trilha de auditoria.
  const insercoes = corpo.match(/\binsert into public\.\w+/g) ?? [];
  assert.deepEqual(insercoes, ["insert into public.auditoria_eventos"]);
  assert.doesNotMatch(corpo, /update\s+public\.fornecedores|set\s+razao_social|set\s+apelido|set\s+cpf_cnpj/);
  // Programação fechada é histórico: nem o rótulo muda.
  assert.match(corpo, /Programações históricas fechadas não podem ser alteradas\./);
  assert.match(corpo, /Usuário não autenticado\./);
});

test("7. o item continua vinculado ao MESMO fornecedor, pelo id e nunca pelo nome", async () => {
  const sql = await read(MIGRATION);
  const corpo = sql.slice(
    sql.indexOf("create or replace function public.definir_nome_exibicao_programacao"),
    sql.indexOf("grant execute on function public.definir_nome_exibicao_programacao"),
  );
  // fornecedor_id não é escrito e volta na resposta como prova de que não mudou.
  assert.doesNotMatch(corpo, /set\s+fornecedor_id/);
  assert.match(corpo, /'fornecedor_id', v_fornecedor_id/);

  const pagina = await read(PAGINA_PROGRAMACAO);
  // O item salvo continua levando o fornecedor_id inteiro; o nome é só rótulo.
  assert.match(pagina, /fornecedor_id: vazio\(item\.fornecedor_id\) \? null : idInteiro\(item\.fornecedor_id, "Fornecedor"\)/);
  assert.match(pagina, /O item guarda o cadastro só para MOSTRAR o nome; o vínculo é o id acima\./);
});

test("8. na baixa, notas e processos continuam vindo pelo id do fornecedor", async () => {
  const baixas = await read(PAGINA_BAIXAS);
  const dados = await read("src/lib/baixasPagamentos.js");
  // Notas, processos e baixas são procurados por fornecedor_id -- nunca pelo
  // texto mostrado, que agora pode ser apelido ou nome de exibição da programação.
  assert.match(dados, /\.eq\("fornecedor_id", fornecedorId\)/);
  for (const fonte of [dados, baixas]) {
    assert.doesNotMatch(
      fonte,
      /eq\("razao_social"|ilike\("razao_social"|eq\("apelido"|eq\("nome_exibicao_programacao"/,
    );
  }
  // A tela guarda o ID do escolhido e é com ele que carrega notas e baixas; o
  // nome mostrado (apelido incluído) é resolvido a partir do cadastro pelo id.
  assert.match(baixas, /carregarNotasEBaixas\(fornecedorId,/);
  assert.match(baixas, /base\.fornecedores\.find\(\(item\) => String\(item\.id\) === String\(fornecedorId\)\)/);
});

/* -------------------------------------------------------------------------
 * 9 e 10. Impressão e a base que já existe
 * ---------------------------------------------------------------------- */

test("9. a impressão da Programação Diária usa o nome escolhido, não outro", async () => {
  const pagina = await read(PAGINA_PROGRAMACAO);
  // A mesma função alimenta a tela, a impressão, o PDF e o Excel.
  assert.match(pagina, /function nomePagamento\(pagamento\) \{\s*\n\s*return nomeExibicaoDoPagamento\(pagamento\);\s*\n\}/);
  assert.match(pagina, /pagamentos: pagamentos\.map\(\(item\) => \(\{ fornecedor: nomePagamento\(item\), valor: numero\(item\.valor_a_pagar\) \}\)\)/);
  assert.match(pagina, /imprimirProgramacao\(dadosDocumento\(\)\)/);
  assert.match(pagina, /gerarPdfProgramacao\(dadosDocumento\(\)\)/);
  assert.match(pagina, /exportarExcelProgramacao\(dadosDocumento\(\)\)/);

  // A ordem impressa é a mesma da tela.
  const item = { id: 40, fornecedor_id: 7, fornecedores: ZE, nome_exibicao_programacao: "Zé Alimentos — Merenda" };
  assert.equal(nomeExibicaoDoPagamento(item), "Zé Alimentos — Merenda");
  assert.equal(nomeExibicaoDoPagamento({ ...item, nome_exibicao_programacao: null }), "Zé Alimentos");
  assert.equal(nomeExibicaoDoPagamento({ id: 41, fornecedores: PADARIA }), "Padaria Central Ltda.");
});

test("9. documento oficial e fiscal continua saindo com a razão social", () => {
  // A regra das baixas segue devolvendo o nome oficial: recibo, relatório e
  // planilha de baixas não passam a usar apelido.
  assert.equal(nomeDoFornecedor(ZE), "José da Silva Comércio de Alimentos Ltda.");
  assert.equal(nomeOficialDoPagamento({ fornecedores: ZE }), "José da Silva Comércio de Alimentos Ltda.");
});

test("10. fornecedor antigo, sem apelido, funciona exatamente como antes", async () => {
  const antigo = { id: 9, razao_social: "Comércio Antigo Ltda.", cpf_cnpj: "11.111.111/0001-11" };
  assert.equal(nomeExibicaoDoFornecedor(antigo), "Comércio Antigo Ltda.");
  assert.equal(complementoDoFornecedor(antigo), "");
  assert.equal(nomeDoFornecedor(antigo), "Comércio Antigo Ltda.");
  assert.equal(fornecedorAtendeBusca(antigo, "antigo"), true);
  assert.equal(fornecedorAtendeBusca(antigo, "11111111"), true);

  const itemAntigo = { id: 50, fornecedor_id: 9, fornecedores: { razao_social: antigo.razao_social } };
  assert.equal(nomeExibicaoDoPagamento(itemAntigo), "Comércio Antigo Ltda.");
  assert.equal(complementoDoPagamento(itemAntigo), "");
  // Fornecedor avulso continua com o nome digitado nele.
  assert.equal(nomeExibicaoDoPagamento({ id: 51, fornecedor_id: null, nome_avulso: "Mercado da Esquina" }), "Mercado da Esquina");
});

test("10. as telas funcionam antes de a migration rodar", async () => {
  // Estrutura ausente não é erro de uso: a consulta é repetida sem a coluna nova.
  for (const codigo of ["42703", "PGRST204", "PGRST205"]) {
    assert.equal(estruturaDeApelidoAusente({ code: codigo }), true);
  }
  assert.equal(estruturaDeApelidoAusente({ message: "column fornecedores.apelido does not exist" }), true);
  assert.equal(estruturaDeApelidoAusente({ code: "23503", message: "foreign key violation" }), false);

  const programacao = await read(PAGINA_PROGRAMACAO);
  assert.match(programacao, /if \(!estruturaDeApelidoAusente\(comApelido\.error\)\) return comApelido;/);
  assert.match(programacao, /return consultar\(`\$\{COLUNAS_PAGAMENTO_PROGRAMACAO\}, fornecedores\(razao_social\)`\);/);
  assert.match(programacao, /MIGRATION_APELIDO = "supabase\/migrations\/20260905120000_apelido_fornecedor_e_nome_exibicao_programacao\.sql"/);

  const baixas = await read("src/lib/baixasPagamentos.js");
  assert.match(baixas, /estruturaDeApelidoAusente\(resposta\.error\)/);

  const certidoes = await read("src/lib/certidoes.js");
  assert.match(certidoes, /estruturaDeApelidoAusente\(error\)/);
});

/* -------------------------------------------------------------------------
 * As regras financeiras que este envio não pode ter tocado
 * ---------------------------------------------------------------------- */

test("baixa, saldo, programado e aprovado continuam como estavam", async () => {
  const sql = await read(MIGRATION);
  // A migration diz, e cumpre, que não toca em saldo, baixa nem transferência:
  // não há gravação em nenhuma tabela de dinheiro.
  assert.match(sql, /A BAIXA NÃO DEBITA O SALDO DA CONTA/);
  assert.match(sql, /PROGRAMADO ≠ PAGO. APROVADO ≠ PAGO/);
  assert.match(sql, /TRANSFERÊNCIA ENTRE CONTAS NÃO É DESPESA/);
  assert.doesNotMatch(
    sql,
    /(update|delete from|insert into)\s+public\.(contas_bancarias|pagamentos_baixas|valores_em_aberto|transferencias\w*)/i,
  );

  // A gravação do planejamento continua sendo a mesma, só com uma coluna a mais.
  const planejamento = sql.slice(sql.indexOf("create or replace function public.salvar_planejamento_programacao"));
  assert.match(planejamento, /nome_exibicao_programacao = v_nome_exibicao,/);
  assert.match(planejamento, /excluido_por\s*=\s*v_usuario_registro|v_usuario_registro/);
  assert.doesNotMatch(planejamento, /update\s+public\.contas_bancarias|update\s+public\.valores_em_aberto/);
});
