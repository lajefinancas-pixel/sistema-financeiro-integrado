import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ACOES_DIARIAS,
  CAMPOS_COMPARTILHADOS,
  CAMPOS_LIQUIDACAO,
  MIGRATION_PROCESSOS,
  MODULO_DIARIAS,
  MODULO_DIARIAS_SAIDA,
  TITULO_PAGINA_1,
  TITULO_PAGINA_2,
  acoesDisponiveis,
  alteracaoManualDeValor,
  aplicarCalculo,
  calcularValorTotal,
  dadosDoFornecedorParaDocumento,
  diferencaParaAuditoria,
  duplicarProcesso,
  filtrarProcessos,
  numeroDoProcesso,
  numeroFormatado,
  preenchimentoDoProcesso,
  filtrosVazios,
  processoVazio,
  resolverPermissoesDiarias,
  sincronizarLiquidacao,
  soltarVinculoDeCadastro,
  totalDivergeDoCalculo,
  totalFiltrosAtivos,
  validarFinalizacao,
  validarRascunho,
  valorNaLiquidacao,
} from "../src/lib/processosDiarias.js";
import {
  ESCOPOS,
  dadosDoDocumento,
  folhasDoEscopo,
  htmlDoProcesso,
  montarPdfDoProcesso,
  nomeDoArquivo,
} from "../src/lib/processosDiariasDocumento.js";

/**
 * PROCESSOS · Diárias — o módulo documental.
 *
 * O que este arquivo defende, e que nenhuma outra parte da suíte defende:
 *
 *   1. um processo é UM registro com DUAS páginas -- Solicitação e Liquidação
 *      não são cadastros independentes e carregam o mesmo número;
 *   2. a sincronização leva o dado compartilhado para a página 2 e NUNCA apaga
 *      o que a liquidação já tinha de próprio;
 *   3. o beneficiário preenchido à mão não vira fornecedor, e editar o
 *      documento não encosta no cadastro de ninguém;
 *   4. a impressão sai com a Liquidação em folha nova, e o PDF é um arquivo só;
 *   5. NADA aqui debita conta, dá baixa em NF, altera saldo, cria pagamento ou
 *      mexe na Programação Diária -- nem em código, nem por engano.
 */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const ARQUIVOS_DO_MODULO = [
  "src/lib/processosDiarias.js",
  "src/lib/processosDiariasDados.js",
  "src/lib/processosDiariasDocumento.js",
  "src/lib/permissoesProcessos.js",
  "src/pages/ModuloProcessos.jsx",
  "src/components/processos/PaginaDiarias.jsx",
  "src/components/processos/ModalProcessoDiaria.jsx",
  "src/components/processos/PreVisualizacaoProcesso.jsx",
  "src/components/processos/ModalHistoricoProcesso.jsx",
];

function processoDeExemplo(extra = {}) {
  return {
    ...processoVazio({ ano: 2026, hoje: "2026-03-10" }),
    id: 41,
    numero: 7,
    situacao: "rascunho",
    secretaria_id: 3,
    beneficiario_nome: "Maria Souza",
    beneficiario_cpf: "123.456.789-00",
    destino: "Brasília/DF",
    finalidade: "Reunião no Ministério da Fazenda.",
    data_saida: "2026-03-12",
    data_retorno: "2026-03-14",
    quantidade_diarias: "2,5",
    valor_unitario: "320,00",
    valor_total: 800,
    ...extra,
  };
}

/* -------------------------------------------------------------------------
 * Numeração (teste 9)
 * ---------------------------------------------------------------------- */

test("numeração é sequencial, por ano, com quatro dígitos e igual nas duas páginas", () => {
  assert.equal(numeroFormatado(2026, 1), "0001/2026");
  assert.equal(numeroFormatado(2026, 137), "0137/2026");
  assert.equal(numeroFormatado(2027, 1), "0001/2027"); // a sequência reinicia por ano

  const processo = processoDeExemplo({ ano: 2026, numero: 1 });
  // As duas páginas leem o mesmo registro: é impossível divergirem.
  assert.equal(numeroDoProcesso(processo), "0001/2026");
  const dados = dadosDoDocumento(processo, { secretarias: [{ id: 3, nome: "Secretaria de Finanças" }] });
  assert.equal(dados.numero, "0001/2026");
});

test("o número emitido é de quem o pegou: o banco reserva antes de criar e nunca reaproveita", async () => {
  const sql = await read(`supabase/migrations/${MIGRATION_PROCESSOS}`);
  assert.match(sql, /create or replace function public\.proximo_numero_processo_diaria/);
  // A sequência mora em tabela própria, com trava de linha -- dois usuários
  // clicando junto recebem números diferentes.
  assert.match(sql, /processos_diarias_numeracao/);
  assert.match(sql, /for update/i);
  // Cancelar não devolve o número: a situação muda, a linha (e o número) ficam.
  assert.match(sql, /revoke delete/i);
});

/* -------------------------------------------------------------------------
 * Cálculo (teste 3)
 * ---------------------------------------------------------------------- */

test("valor total = quantidade × valor unitário, no centavo", () => {
  assert.equal(calcularValorTotal(2, "320,00"), 640);
  assert.equal(calcularValorTotal("2,5", "320,00"), 800);
  assert.equal(calcularValorTotal("1,5", "333,33"), 500); // 499,995 arredonda no papel
  assert.equal(calcularValorTotal("", ""), 0);

  const calculado = aplicarCalculo({ quantidade_diarias: "3", valor_unitario: "1.234,56" });
  assert.equal(calculado.valor_total, 3703.68);
});

test("valor assumido à mão não é recalculado por cima, e a divergência fica visível", () => {
  const manual = aplicarCalculo({
    quantidade_diarias: "2",
    valor_unitario: "320,00",
    valor_total: 500,
    valor_total_manual: true,
  });
  assert.equal(manual.valor_total, 500);
  assert.equal(totalDivergeDoCalculo(manual), true);

  // E a alteração manual tem evento próprio de auditoria, com os dois números.
  const registro = alteracaoManualDeValor({ valor_total: 640, valor_total_manual: false }, manual);
  assert.equal(registro.valor_calculado, 640);
  assert.equal(registro.valor_total, 500);
});

/* -------------------------------------------------------------------------
 * Um processo, duas páginas (testes 4 e 5)
 * ---------------------------------------------------------------------- */

test("os dados compartilhados chegam na liquidação sem redigitação", () => {
  const processo = processoDeExemplo();
  // Beneficiário, CPF, secretaria, destino, finalidade, valor e dados bancários
  // são as MESMAS colunas nas duas páginas.
  ["beneficiario_nome", "beneficiario_cpf", "secretaria_id", "destino", "finalidade", "valor_total"].forEach(
    (campo) => assert.ok(CAMPOS_COMPARTILHADOS.includes(campo), `${campo} deveria ser compartilhado`)
  );
  // E os campos que a liquidação tem em separado nascem espelhando a página 1.
  assert.equal(valorNaLiquidacao(processo, "liquidacao_data_saida"), "2026-03-12");
  assert.equal(valorNaLiquidacao(processo, "liquidacao_quantidade"), "2,5");
  assert.equal(valorNaLiquidacao(processo, "liquidacao_valor"), 800);
});

test("alterar dado compartilhado atualiza a liquidação que ainda espelhava", () => {
  const antes = { data_retorno: "2026-03-14", liquidacao_data_retorno: "2026-03-14" };
  const depois = sincronizarLiquidacao(antes, { ...antes, data_retorno: "2026-03-15" });
  assert.equal(depois.liquidacao_data_retorno, "2026-03-15");
});

test("a sincronização NUNCA apaga informação específica já preenchida na liquidação", () => {
  const antes = {
    data_retorno: "2026-03-14",
    liquidacao_data_retorno: "2026-03-13", // voltou um dia antes: informação própria
    quantidade_diarias: "2,5",
    liquidacao_quantidade: "1,5",
    liquidacao_relatorio: "Relatório da viagem já redigido.",
    liquidacao_responsavel: "João da Silva",
  };
  const depois = sincronizarLiquidacao(antes, { ...antes, data_retorno: "2026-03-16", quantidade_diarias: "3" });

  assert.equal(depois.liquidacao_data_retorno, "2026-03-13");
  assert.equal(depois.liquidacao_quantidade, "1,5");
  assert.equal(depois.liquidacao_relatorio, "Relatório da viagem já redigido.");
  assert.equal(depois.liquidacao_responsavel, "João da Silva");
});

test("a tela propaga o compartilhado e só o compartilhado", async () => {
  const modal = await read("src/components/processos/ModalProcessoDiaria.jsx");
  assert.match(modal, /CAMPOS_COMPARTILHADOS\.includes\(chave\)/);
  assert.match(modal, /sincronizarLiquidacao\(atual, alterado\)/);
});

/* -------------------------------------------------------------------------
 * Rascunho e salvamento (testes 1 e 2)
 * ---------------------------------------------------------------------- */

test("rascunho é salvo incompleto; finalizar é que exige a página 1", () => {
  const pelaMetade = { secretaria_id: 3, beneficiario_nome: "Maria Souza" };
  assert.deepEqual(validarRascunho(pelaMetade), {});

  const erros = validarFinalizacao(pelaMetade);
  assert.ok(erros.destino);
  assert.ok(erros.finalidade);
  assert.ok(erros.valor_total);
  // A página 2 NÃO é exigida para finalizar: a liquidação vem depois da viagem.
  CAMPOS_LIQUIDACAO.forEach((campo) => assert.equal(erros[campo], undefined));

  assert.deepEqual(validarFinalizacao(processoDeExemplo()), {});
});

test("retorno antes da saída é recusado na finalização", () => {
  const erros = validarFinalizacao(processoDeExemplo({ data_saida: "2026-03-14", data_retorno: "2026-03-12" }));
  assert.ok(erros.data_retorno);
});

test("o rascunho é salvo sozinho enquanto se preenche e nunca é apagado por sair da tela", async () => {
  const [modal, pagina, dados] = await Promise.all([
    read("src/components/processos/ModalProcessoDiaria.jsx"),
    read("src/components/processos/PaginaDiarias.jsx"),
    read("src/lib/processosDiariasDados.js"),
  ]);
  assert.match(modal, /ESPERA_AUTOSSALVAMENTO/);
  assert.match(modal, /silencioso: true/);
  assert.match(modal, /último salvamento/);
  // Fechar a tela só fecha a tela: não existe descarte automático de rascunho.
  assert.doesNotMatch(modal, /descartarRascunho|apagarRascunho/);
  assert.doesNotMatch(pagina, /descartarRascunho|apagarRascunho/);
  // Excluir rascunho existe, mas é ação explícita, com motivo, e é lógica.
  assert.match(dados, /excluido_em/);
  assert.match(dados, /motivo_exclusao/);
});

/* -------------------------------------------------------------------------
 * Beneficiário: cadastrado ou manual (testes 6, 7 e 8)
 * ---------------------------------------------------------------------- */

test("buscar fornecedor cadastrado puxa os dados para o documento", () => {
  const puxado = dadosDoFornecedorParaDocumento({
    id: 88,
    razao_social: "Maria Souza",
    cpf_cnpj: "123.456.789-00",
    banco: "Banco do Brasil",
    agencia: "1234-5",
    conta: "98765-4",
    pix_chave: "maria@exemplo.gov.br",
  });
  assert.equal(puxado.fornecedor_id, 88);
  assert.equal(puxado.beneficiario_nome, "Maria Souza");
  assert.equal(puxado.beneficiario_cpf, "123.456.789-00");
  assert.equal(puxado.pix, "maria@exemplo.gov.br");
});

test("preenchimento manual funciona e NÃO cria fornecedor no cadastro", async () => {
  const manual = soltarVinculoDeCadastro({ beneficiario_nome: "Pedro Lima", beneficiario_cpf: "999", fornecedor_id: 88 });
  assert.equal(manual.fornecedor_id, null);
  // O que foi digitado continua no documento.
  assert.equal(manual.beneficiario_nome, "Pedro Lima");

  // E nenhum arquivo do módulo escreve no cadastro de fornecedores.
  const arquivos = await Promise.all(ARQUIVOS_DO_MODULO.map(read));
  arquivos.forEach((conteudo, i) => {
    assert.doesNotMatch(
      conteudo,
      /from\("fornecedores"\)|from\('fornecedores'\)/,
      `${ARQUIVOS_DO_MODULO[i]} não pode escrever no cadastro de fornecedores`
    );
  });
});

test("editar o documento altera o documento, nunca o cadastro", () => {
  const cadastro = { id: 88, razao_social: "Maria Souza", cpf_cnpj: "123.456.789-00" };
  const documento = { ...processoDeExemplo(), ...dadosDoFornecedorParaDocumento(cadastro) };
  documento.beneficiario_nome = "Maria Souza de Oliveira"; // correção só no papel

  assert.equal(cadastro.razao_social, "Maria Souza");
  assert.equal(cadastro.cpf_cnpj, "123.456.789-00");
  // O vínculo interno é preservado.
  assert.equal(documento.fornecedor_id, 88);
});

/* -------------------------------------------------------------------------
 * Duplicar (teste 12)
 * ---------------------------------------------------------------------- */

test("duplicar cria processo novo, sem número e sem a liquidação do original", () => {
  const original = processoDeExemplo({ situacao: "finalizada", liquidacao_relatorio: "Viagem realizada." });
  const congelado = JSON.stringify(original);

  const copia = duplicarProcesso(original, { ano: 2026, hoje: "2026-04-01" });

  assert.equal(copia.id, null);
  assert.equal(copia.numero, null); // o número novo é emitido ao salvar
  assert.equal(copia.situacao, "rascunho");
  assert.equal(copia.data_processo, "2026-04-01");
  assert.equal(copia.duplicado_de, 41);
  assert.equal(copia.duplicado_de_numero, "0007/2026");
  assert.equal(copia.beneficiario_nome, "Maria Souza");
  assert.equal(copia.destino, "Brasília/DF");
  // A liquidação do original não vem junto: aquela viagem foi outra.
  assert.equal(copia.liquidacao_relatorio, "");
  // E o original não foi tocado.
  assert.equal(JSON.stringify(original), congelado);
});

/* -------------------------------------------------------------------------
 * Lista, busca e filtros (testes 17 e 18)
 * ---------------------------------------------------------------------- */

test("o indicador diz o que falta em cada página", () => {
  assert.equal(preenchimentoDoProcesso(processoDeExemplo()).texto, "Solicitação ✓ | Liquidação pendente");
  const completo = processoDeExemplo({ liquidacao_relatorio: "Viagem realizada." });
  assert.equal(preenchimentoDoProcesso(completo).texto, "Solicitação ✓ | Liquidação ✓");
});

test("a busca rápida acha por número, nome, CPF, destino, objeto e situação", () => {
  const secretarias = [{ id: 3, nome: "Secretaria de Finanças" }];
  const lista = [
    processoDeExemplo({ id: 1, numero: 7, objeto: "Reunião técnica" }),
    processoDeExemplo({ id: 2, numero: 8, beneficiario_nome: "Carlos Dias", destino: "Recife/PE", objeto: "Curso" }),
  ];
  const acha = (busca) => filtrarProcessos(lista, { busca, secretarias }).map((p) => p.id);

  assert.deepEqual(acha("0007"), [1]);
  assert.deepEqual(acha("carlos"), [2]);
  assert.deepEqual(acha("123.456"), [1, 2]);
  assert.deepEqual(acha("recife"), [2]);
  assert.deepEqual(acha("curso"), [2]);
  assert.deepEqual(acha("finanças"), [1, 2]);
  assert.deepEqual(acha("rascunho"), [1, 2]);
});

test("os filtros recortam por ano, período, secretaria, beneficiário e situação", () => {
  const lista = [
    processoDeExemplo({ id: 1, ano: 2026, data_processo: "2026-03-10", situacao: "rascunho" }),
    processoDeExemplo({
      id: 2,
      ano: 2025,
      data_processo: "2025-11-02",
      data_saida: "2025-11-04",
      data_retorno: "2025-11-06",
      situacao: "finalizada",
      secretaria_id: 9,
      beneficiario_nome: "Carlos Dias",
    }),
  ];
  const filtrar = (filtros) => filtrarProcessos(lista, { filtros }).map((p) => p.id);

  assert.deepEqual(filtrar(filtrosVazios()), [1, 2]);
  assert.deepEqual(filtrar({ ano: "2026" }), [1]);
  // O período confere a viagem: "as diárias de novembro" é a saída em novembro.
  assert.deepEqual(filtrar({ periodoInicio: "2025-01-01", periodoFim: "2025-12-31" }), [2]);
  assert.deepEqual(filtrar({ secretaria: "9" }), [2]);
  assert.deepEqual(filtrar({ situacao: "finalizada" }), [2]);
  assert.deepEqual(filtrar({ beneficiario: "maria" }), [1]);
  assert.deepEqual(filtrar({ beneficiario: "12345678900" }), [1, 2]); // beneficiário por CPF
  assert.equal(totalFiltrosAtivos({ ano: "2026", situacao: "finalizada" }), 2);
});

test("a lista é compacta, com as colunas pedidas e os filtros do sistema", async () => {
  const pagina = await read("src/components/processos/PaginaDiarias.jsx");
  ["Nº", "Beneficiário", "Secretaria", "Destino", "Período", "Valor", "Situação", "Ações"].forEach((coluna) =>
    assert.ok(pagina.includes(coluna), `falta a coluna ${coluna}`)
  );
  assert.match(pagina, /PainelFiltros/);
  assert.match(pagina, /Nova Diária/);
});

/* -------------------------------------------------------------------------
 * Impressão e PDF (testes 10 e 11)
 * ---------------------------------------------------------------------- */

test("o processo completo sai em duas folhas, com a liquidação começando na segunda", () => {
  assert.deepEqual(folhasDoEscopo("completo"), ["solicitacao", "liquidacao"]);
  assert.deepEqual(folhasDoEscopo("solicitacao"), ["solicitacao"]);
  assert.deepEqual(folhasDoEscopo("liquidacao"), ["liquidacao"]);
  assert.deepEqual(ESCOPOS.map((e) => e.id), ["completo", "solicitacao", "liquidacao"]);

  const dados = dadosDoDocumento(processoDeExemplo({ numero: 1 }), {
    secretarias: [{ id: 3, nome: "Secretaria de Finanças" }],
  });
  const html = htmlDoProcesso(dados, { escopo: "completo" });

  // Duas folhas A4, e a quebra é da folha -- não depende do tamanho do texto.
  assert.equal((html.match(/class="folha"/g) ?? []).length, 2);
  assert.match(html, /size: A4 portrait/);
  assert.match(html, /page-break-after: always/);
  assert.ok(html.indexOf(TITULO_PAGINA_1) < html.indexOf(TITULO_PAGINA_2));
  // O mesmo número nas duas páginas.
  assert.equal((html.match(/0001\/2026/g) ?? []).length >= 2, true);
});

test("o PDF é um arquivo único com as duas páginas", () => {
  const dados = dadosDoDocumento(processoDeExemplo({ numero: 1 }), {
    secretarias: [{ id: 3, nome: "Secretaria de Finanças" }],
  });
  const pdf = montarPdfDoProcesso(dados, { escopo: "completo" });
  assert.equal(pdf.getNumberOfPages(), 2);
  assert.equal(montarPdfDoProcesso(dados, { escopo: "solicitacao" }).getNumberOfPages(), 1);
  assert.equal(nomeDoArquivo(dados, "pdf", "completo"), "processo-diaria-0001-2026.pdf");
});

test("o documento tem layout próprio -- não é captura de tela -- e não gera Word neste envio", async () => {
  const [documento, pagina, previa] = await Promise.all([
    read("src/lib/processosDiariasDocumento.js"),
    read("src/components/processos/PaginaDiarias.jsx"),
    read("src/components/processos/PreVisualizacaoProcesso.jsx"),
  ]);
  assert.match(documento, /imprimirDocumentoHtml/); // iframe próprio, como o resto do sistema
  assert.match(documento, /assinaturas/);
  assert.doesNotMatch(documento, /html2canvas|canvas\.toDataURL/);
  [documento, pagina, previa].forEach((arquivo) => assert.doesNotMatch(arquivo, /docx|\.doc\b|Word/));
  // A pré-visualização mostra a MESMA folha que vai para a impressora.
  assert.match(previa, /htmlDoProcesso/);
  assert.match(previa, /Gerar PDF/);
  assert.match(previa, /Cancelar/);
});

/* -------------------------------------------------------------------------
 * Permissões (teste 13)
 * ---------------------------------------------------------------------- */

test("as sete ações da área saem das cinco colunas dos dois módulos", () => {
  const nenhuma = resolverPermissoesDiarias({ linhas: [] });
  ACOES_DIARIAS.forEach((acao) => assert.equal(nenhuma[acao.chave], false));

  const permissoes = resolverPermissoesDiarias({
    linhas: [
      {
        modulo: MODULO_DIARIAS,
        pode_visualizar: true,
        pode_cadastrar: true,
        pode_editar: true,
        pode_aprovar: false,
        pode_excluir: false,
      },
      { modulo: MODULO_DIARIAS_SAIDA, pode_visualizar: true, pode_cadastrar: false },
    ],
  });

  assert.equal(permissoes.visualizar, true);
  assert.equal(permissoes.criar, true);
  assert.equal(permissoes.editar, true);
  assert.equal(permissoes.finalizar, false); // quem edita não necessariamente finaliza
  assert.equal(permissoes.cancelar, false);
  assert.equal(permissoes.imprimir, true);
  assert.equal(permissoes.duplicar, false);
});

test("cada situação oferece só o que faz sentido nela", () => {
  const tudo = Object.fromEntries(ACOES_DIARIAS.map((a) => [a.chave, true]));

  const rascunho = acoesDisponiveis({ situacao: "rascunho" }, tudo);
  assert.equal(rascunho.editar, true);
  assert.equal(rascunho.finalizar, true);
  assert.equal(rascunho.excluir, true);

  // Processo finalizado não tem exclusão comum: a saída é cancelar.
  const finalizada = acoesDisponiveis({ situacao: "finalizada" }, tudo);
  assert.equal(finalizada.editar, false);
  assert.equal(finalizada.excluir, false);
  assert.equal(finalizada.cancelar, true);
  assert.equal(finalizada.imprimir, true);

  // Cancelado não volta a ser editado, mas continua consultável e imprimível.
  const cancelada = acoesDisponiveis({ situacao: "cancelada" }, tudo);
  assert.equal(cancelada.editar, false);
  assert.equal(cancelada.cancelar, false);
  assert.equal(cancelada.abrir, true);
  assert.equal(cancelada.historico, true);

  // Sem permissão nenhuma, nada é oferecido.
  const semNada = acoesDisponiveis({ situacao: "rascunho" }, {});
  assert.equal(Object.values(semNada).some(Boolean), false);
});

test("os dois módulos aparecem na matriz de permissões com rótulos próprios", async () => {
  // O arquivo fala com o Supabase e não é importável fora do navegador; o que
  // interessa aqui é que os dois módulos estejam listados com rótulos que digam
  // o que a permissão concede -- inclusive que finalizar não é pagar.
  const matriz = await read("src/lib/permissoesUsuario.js");
  assert.match(matriz, new RegExp(`id: "${MODULO_DIARIAS}"`));
  assert.match(matriz, new RegExp(`id: "${MODULO_DIARIAS_SAIDA}"`));
  assert.match(matriz, /label: "Finalizar \(não é pagar\)"/);
  assert.match(matriz, /label: "Cancelar \/ anular"/);
  assert.match(matriz, /label: "Imprimir e gerar PDF"/);
  assert.match(matriz, /label: "Duplicar"/);
  assert.match(matriz, /ACOES_PROCESSOS_DIARIAS_SAIDA/);
  // As permissões que já existiam continuam intactas.
  assert.match(matriz, /const ACOES_BAIXAS = \[/);
  assert.match(matriz, /const ACOES_AREAS_FORNECEDORES = \[/);
});

test("o banco confere a permissão antes de devolver ou gravar qualquer linha", async () => {
  const sql = await read(`supabase/migrations/${MIGRATION_PROCESSOS}`);
  assert.match(sql, /create or replace function public\.pode_em_processos/);
  assert.match(sql, /permissoes_efetivas/); // perfil + exceção individual, o modelo que já existe
  assert.match(sql, /enable row level security/i);
});

/* -------------------------------------------------------------------------
 * Auditoria (teste 14)
 * ---------------------------------------------------------------------- */

test("a diferença para a auditoria traz o antes e o depois campo a campo", () => {
  const antes = processoDeExemplo();
  const depois = { ...antes, destino: "Recife/PE", valor_total: 900 };
  const { anterior, novo, houveAlteracao } = diferencaParaAuditoria(antes, depois);

  assert.equal(houveAlteracao, true);
  assert.deepEqual(Object.keys(novo).sort(), ["destino", "valor_total"]);
  assert.equal(anterior.destino, "Brasília/DF");
  assert.equal(novo.destino, "Recife/PE");

  // Nada mudou, nada é gravado.
  assert.equal(diferencaParaAuditoria(antes, { ...antes }).houveAlteracao, false);
});

test("a trilha conhece o módulo, as ações e os campos do processo", async () => {
  const auditoria = await read("src/lib/auditoria.js");
  assert.match(auditoria, /processos_diarias: "Processos · Diárias"/);
  ["duplicou_processo", "finalizou_processo", "reabriu_processo", "cancelou_processo", "alterou_valor_manual"].forEach(
    (acao) => assert.ok(auditoria.includes(`${acao}:`), `falta a ação ${acao}`)
  );
  assert.match(auditoria, /finalizou_processo: "Finalizou processo \(não é pagamento\)"/);
  // Valores do documento são lidos como dinheiro no Antes/Depois.
  ["valor_unitario", "valor_total", "valor_calculado", "liquidacao_valor"].forEach((campo) =>
    assert.ok(auditoria.includes(`"${campo}"`), `falta o campo de moeda ${campo}`)
  );
});

test("todas as ações do módulo passam pela auditoria e pelo histórico do processo", async () => {
  const dados = await read("src/lib/processosDiariasDados.js");
  ["criou", "duplicou_processo", "alterou", "alterou_valor_manual", "finalizou_processo", "reabriu_processo", "cancelou_processo"].forEach(
    (acao) => assert.ok(dados.includes(acao), `a ação ${acao} não é registrada`)
  );
  assert.match(dados, /registrarEvento/);
});

/* -------------------------------------------------------------------------
 * Backup (teste 24) e menu (item 1)
 * ---------------------------------------------------------------------- */

test("as três tabelas do módulo entram no backup", async () => {
  const backups = await read("src/lib/backups.js");
  ["processos_diarias", "processos_diarias_numeracao", "processos_diarias_historico"].forEach((tabela) =>
    assert.match(backups, new RegExp(`tabela: "${tabela}"`))
  );
});

test("PROCESSOS é um item expansível próprio e o submenu de Fornecedores não foi mexido", async () => {
  const layout = await read("src/components/Layout.jsx");
  assert.match(layout, /submenu: "processos"/);
  assert.match(layout, /function ItemProcessos/);
  assert.match(layout, /useAreasDeProcessosNoMenu/);
  // O item de Fornecedores continua exatamente com o que já tinha.
  assert.match(layout, /function ItemFornecedores/);
  assert.match(layout, /useAreasVisiveisNoMenu/);
  assert.match(layout, /sfi\.menuLateral\.fornecedoresAberto/);
  // Chave de preferência própria: uma seção não fecha a outra.
  assert.match(layout, /sfi\.menuLateral\.processosAberto/);
  // Toque no iPad: as linhas do submenu têm altura de alvo confortável.
  assert.match(layout, /min-h-\[2\.5rem\]/);

  const menu = await read("src/lib/permissoesProcessos.js");
  assert.match(menu, /\/processos\/diarias/);
  // Serviços/Materiais e Arquivo são de outros envios: não existe rota nem item
  // de menu para eles neste.
  assert.doesNotMatch(menu, /\/processos\/(servicos|materiais|arquivo)/i);
  assert.equal((menu.match(/rotulo: "/g) ?? []).length, 1);
});

/* -------------------------------------------------------------------------
 * A trava do módulo (teste 15)
 * ---------------------------------------------------------------------- */

test("NENHUM arquivo do módulo toca em saldo, baixa, NF ou programação", async () => {
  const proibido = [
    /from\("pagamentos"\)/,
    /from\("pagamento_movimentacoes"\)/,
    /from\("programacoes_pagamento"\)/,
    /from\("contas_bancarias"\)/,
    /from\("saldos_historico"\)/,
    /registrar_baixa|estornar_baixa|registrarBaixa/,
    /atualizarSaldo|lancarSaldo|debitar/i,
    /valor_pago|valor_em_aberto/,
  ];

  const arquivos = await Promise.all(ARQUIVOS_DO_MODULO.map(read));
  arquivos.forEach((conteudo, i) => {
    proibido.forEach((padrao) =>
      assert.doesNotMatch(conteudo, padrao, `${ARQUIVOS_DO_MODULO[i]} não pode referenciar ${padrao}`)
    );
  });
});

test("a migration do módulo é aditiva e não encosta em tabela financeira", async () => {
  const sql = await read(`supabase/migrations/${MIGRATION_PROCESSOS}`);
  assert.doesNotMatch(sql, /\bdrop table\b|\btruncate\b/i);
  [
    /alter table (public\.)?pagamentos\b/i,
    /alter table (public\.)?contas_bancarias\b/i,
    /alter table (public\.)?saldos_historico\b/i,
    /alter table (public\.)?programacoes_pagamento\b/i,
    /alter table (public\.)?fornecedores\b/i,
  ].forEach((padrao) => assert.doesNotMatch(sql, padrao));
  assert.match(sql, /create table public\.processos_diarias\b/i);
});

test("finalizar fecha o documento e nada mais", async () => {
  const [dados, sql] = await Promise.all([
    read("src/lib/processosDiariasDados.js"),
    read(`supabase/migrations/${MIGRATION_PROCESSOS}`),
  ]);
  // Finalizar mexe em situação e data; nenhuma tabela financeira é escrita.
  assert.match(dados, /situacao: "finalizada"/);
  assert.doesNotMatch(dados, /\.rpc\("(registrar|estornar)_baixa/);
  assert.doesNotMatch(dados, /insert\(\{[^}]*pagamento/i);
  assert.doesNotMatch(sql, /insert into public\.pagamentos/i);
  // A finalização é gravada como fato documental, com o nome que diz isso.
  assert.match(dados, /finalizou_processo/);
});
