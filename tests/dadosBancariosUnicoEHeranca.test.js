import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TIPO_CONTA_PADRAO,
  TIPO_PIX_PADRAO,
  dadosBancariosDaForma,
  dadosBancariosVazios,
  partesDeDadosBancarios,
  partesPermitidas,
  podeAbrirDadosBancarios,
  resumoDoQueSeraGravado,
  temParteDeConta,
  temPartePix,
  validarDadosBancarios,
} from "../src/lib/dadosBancariosUnificados.js";
import {
  dadosDePagamentoSugeridos,
  opcoesDePagamentoDoFornecedor,
  precisaEscolherPagamento,
} from "../src/lib/processosServicos.js";
import { dadosDoServidorParaDocumento } from "../src/lib/processosServidores.js";

/**
 * BOTÃO ÚNICO DE DADOS BANCÁRIOS, ROLAGEM DA LISTA DE BANCOS E HERANÇA DOS
 * DADOS DE PAGAMENTO NOS PROCESSOS.
 *
 * Três correções verificadas aqui:
 *
 * 1. Na Vida do Fornecedor, UM botão -- "Adicionar dados bancários" -- abre UM
 *    formulário com conta bancária e PIX juntos. Preencher só a conta, só o PIX
 *    ou os dois funciona, e o que já estava cadastrado continua aparecendo e
 *    abrindo para edição, sem conversão e sem perda.
 * 2. A lista de bancos rola até o último item, no computador e no toque do iPad,
 *    e avisa enquanto houver item abaixo.
 * 3. Escolher o fornecedor no processo preenche banco, agência, conta, chave PIX
 *    e titular; havendo mais de uma conta ou chave, a principal entra e a troca
 *    é oferecida. O mesmo vale para a diária com servidor do cadastro.
 *
 * ⚠️ TRAVA DE NÃO REGRESSÃO: nada disto debita conta, dá baixa em nota, altera
 * saldo, cria pagamento ou toca em programação -- é cadastro e documento.
 */

const CONTA_CADASTRADA = {
  id: "conta-1",
  kind: "bank",
  bankCode: "001",
  bankName: "001 — Banco do Brasil",
  agency: "1234",
  account: "56789",
  accountDigit: "0",
  accountType: "corrente",
  holderName: "Construtora Alfa LTDA",
  holderDocument: "12.345.678/0001-99",
  isPrimary: true,
};

const PIX_CADASTRADO = {
  id: "pix-1",
  kind: "pix",
  pixKeyType: "cnpj",
  pixKey: "12345678000199",
  holderName: "Construtora Alfa LTDA",
  holderDocument: "12.345.678/0001-99",
  isPrimary: true,
};

/** O código-fonte sem os comentários: para não confundir explicação com tela. */
function semComentarios(fonte) {
  return fonte
    .split("\n")
    .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
    .join("\n");
}

/* -------------------------------------------------------------------------
 * 1. UM BOTÃO, UM FORMULÁRIO -- conta, PIX, ou as duas
 * ---------------------------------------------------------------------- */

test("o formulário único nasce em branco, com os tipos sugeridos", () => {
  const vazio = dadosBancariosVazios();
  assert.equal(vazio.contaId, null);
  assert.equal(vazio.pixId, null);
  assert.equal(vazio.accountType, TIPO_CONTA_PADRAO);
  assert.equal(vazio.pixKeyType, TIPO_PIX_PADRAO);
  assert.equal(vazio.isPrimary, false);
  assert.equal(temParteDeConta(vazio), false);
  assert.equal(temPartePix(vazio), false);
  assert.equal(resumoDoQueSeraGravado(vazio), "Nada a gravar ainda.");
  // Em branco não grava nada, e diz o que falta.
  assert.match(validarDadosBancarios(vazio), /Preencha a conta bancária, a chave PIX, ou as duas/);
  assert.deepEqual(partesDeDadosBancarios(vazio), []);
});

test("salvar SÓ A CONTA grava um registro de conta e nenhum de PIX", () => {
  const formulario = {
    ...dadosBancariosVazios(),
    bankCode: "104",
    bankName: "104 — Caixa Econômica Federal",
    agency: "0987",
    account: "112233",
    accountDigit: "4",
    holderName: "Papelaria Beta ME",
    holderDocument: "98.765.432/0001-11",
  };

  assert.equal(validarDadosBancarios(formulario), null);
  const partes = partesDeDadosBancarios(formulario);
  assert.equal(partes.length, 1);
  assert.equal(partes[0].kind, "bank");
  assert.equal(partes[0].id, null);
  assert.equal(partes[0].bankCode, "104");
  assert.equal(partes[0].account, "112233");
  assert.equal(partes[0].accountDigit, "4");
  assert.equal(partes[0].accountType, TIPO_CONTA_PADRAO);
  assert.equal(partes[0].holderName, "Papelaria Beta ME");
  assert.match(resumoDoQueSeraGravado(formulario), /Salva conta bancária/);
});

test("salvar SÓ O PIX grava um registro de PIX e nenhum de conta", () => {
  const formulario = {
    ...dadosBancariosVazios(),
    pixKey: "beta@exemplo.com.br",
    pixKeyType: "email",
    pixHolderName: "Papelaria Beta ME",
  };

  assert.equal(validarDadosBancarios(formulario), null);
  const partes = partesDeDadosBancarios(formulario);
  assert.equal(partes.length, 1);
  assert.equal(partes[0].kind, "pix");
  assert.equal(partes[0].pixKey, "beta@exemplo.com.br");
  assert.equal(partes[0].pixKeyType, "email");
  assert.equal(partes[0].holderName, "Papelaria Beta ME");
  assert.match(resumoDoQueSeraGravado(formulario), /Salva PIX/);
});

test("salvar AS DUAS PARTES grava dois registros, cada um com o seu kind", () => {
  const formulario = {
    ...dadosBancariosVazios(),
    bankCode: "237",
    bankName: "237 — Bradesco",
    agency: "0101",
    account: "778899",
    holderName: "Construtora Alfa LTDA",
    holderDocument: "12.345.678/0001-99",
    pixKey: "12345678000199",
    isPrimary: true,
  };

  assert.equal(validarDadosBancarios(formulario), null);
  const partes = partesDeDadosBancarios(formulario);
  assert.deepEqual(partes.map((parte) => parte.kind), ["bank", "pix"]);
  // O titular do PIX em branco é o titular da conta: mesma pessoa.
  assert.equal(partes[1].holderName, "Construtora Alfa LTDA");
  // O CPF/CNPJ acompanha as duas partes.
  assert.equal(partes[0].holderDocument, "12.345.678/0001-99");
  assert.equal(partes[1].holderDocument, "12.345.678/0001-99");
  // "Principal" vale para a conta entre as contas e para a chave entre as
  // chaves -- uma não apaga a marcação da outra.
  assert.equal(partes[0].isPrimary, true);
  assert.equal(partes[1].isPrimary, true);
  assert.match(resumoDoQueSeraGravado(formulario), /Salva conta bancária e PIX/);
});

test("a parte preenchida exige o essencial dela, e só dela", () => {
  const base = dadosBancariosVazios();
  assert.match(
    validarDadosBancarios({ ...base, account: "1234" }),
    /Escolha o banco da conta na lista/,
  );
  assert.match(
    validarDadosBancarios({ ...base, bankName: "001 — Banco do Brasil" }),
    /Informe o número da conta/,
  );
  assert.match(
    validarDadosBancarios({ ...base, bankName: "001 — Banco do Brasil", account: "1234" }),
    /Informe o nome do titular da conta/,
  );
  assert.match(
    validarDadosBancarios({ ...base, pixId: "pix-9" }),
    /Informe a chave PIX/,
  );
  assert.match(
    validarDadosBancarios({ ...base, pixKey: "chave" }),
    /Informe o titular do PIX/,
  );
});

test("registro JÁ CADASTRADO abre no formulário único levando o próprio id", () => {
  const daConta = dadosBancariosDaForma(CONTA_CADASTRADA);
  assert.equal(daConta.contaId, "conta-1");
  assert.equal(daConta.pixId, null);
  assert.equal(daConta.bankName, "001 — Banco do Brasil");
  assert.equal(daConta.agency, "1234");
  assert.equal(daConta.account, "56789");
  assert.equal(daConta.isPrimary, true);
  // Gravar de novo ATUALIZA aquele registro -- não cria um segundo.
  const partesDaConta = partesDeDadosBancarios(daConta);
  assert.equal(partesDaConta.length, 1);
  assert.equal(partesDaConta[0].id, "conta-1");
  assert.match(resumoDoQueSeraGravado(daConta), /Atualiza conta bancária/);

  const doPix = dadosBancariosDaForma(PIX_CADASTRADO);
  assert.equal(doPix.pixId, "pix-1");
  assert.equal(doPix.contaId, null);
  assert.equal(doPix.pixKey, "12345678000199");
  assert.equal(doPix.pixHolderName, "Construtora Alfa LTDA");
  const partesDoPix = partesDeDadosBancarios(doPix);
  assert.equal(partesDoPix.length, 1);
  assert.equal(partesDoPix[0].id, "pix-1");
  assert.equal(partesDoPix[0].kind, "pix");
});

test("completar a outra parte de um registro existente cria só o registro novo", () => {
  // Uma conta já cadastrada ganha a chave PIX no mesmo formulário: a conta é
  // atualizada pelo id dela, e o PIX nasce novo.
  const formulario = {
    ...dadosBancariosDaForma(CONTA_CADASTRADA),
    pixKey: "12345678000199",
  };
  const partes = partesDeDadosBancarios(formulario);
  assert.deepEqual(partes.map((parte) => parte.id), ["conta-1", null]);
  assert.deepEqual(partes.map((parte) => parte.kind), ["bank", "pix"]);
});

test("as permissões separadas de PIX e de dados bancários continuam valendo", () => {
  const vazio = dadosBancariosVazios();

  assert.deepEqual(
    partesPermitidas(vazio, { cadastrar_pix: true }),
    { conta: false, pix: true },
  );
  assert.deepEqual(
    partesPermitidas(vazio, { cadastrar_dados_bancarios: true }),
    { conta: true, pix: false },
  );
  assert.deepEqual(
    partesPermitidas(vazio, { cadastrar_pix: true, cadastrar_dados_bancarios: true }),
    { conta: true, pix: true },
  );
  // Editar registro existente pede a permissão de EDITAR daquele tipo.
  assert.deepEqual(
    partesPermitidas(dadosBancariosDaForma(CONTA_CADASTRADA), { cadastrar_dados_bancarios: true }),
    { conta: false, pix: false },
  );
  assert.deepEqual(
    partesPermitidas(dadosBancariosDaForma(PIX_CADASTRADO), { editar_pix: true }),
    { conta: false, pix: true },
  );

  // O botão único aparece para quem pode cadastrar pelo menos uma das partes.
  assert.equal(podeAbrirDadosBancarios({}), false);
  assert.equal(podeAbrirDadosBancarios({ cadastrar_pix: true }), true);
  assert.equal(podeAbrirDadosBancarios({ cadastrar_dados_bancarios: true }), true);
});

test("a tela da Vida do Fornecedor tem UM botão e UM formulário com as duas partes", async () => {
  const fonte = await readFile(
    new URL("../src/components/fornecedores/DadosParaPagamento.jsx", import.meta.url),
    "utf8",
  );
  const tela = semComentarios(fonte);

  assert.match(tela, /Adicionar dados bancários/);
  // Os dois botões antigos saíram da TELA (o histórico segue nos comentários).
  assert.doesNotMatch(tela, /Adicionar PIX/);
  assert.doesNotMatch(tela, /Adicionar Conta Bancária/);
  // Um formulário, com as duas partes e a marcação de principal compartilhada.
  assert.match(tela, /<legend[\s\S]{0,200}Conta bancária/);
  assert.match(tela, /<legend[\s\S]{0,200}PIX/);
  assert.match(tela, /Marcar como principal/);
  // A gravação é a unificada, que devolve um registro por parte preenchida.
  assert.match(tela, /salvarDadosBancarios\(fornecedorId, form\)/);
  // Validação nossa, e não a do navegador: "só a conta" e "só o PIX" passam.
  assert.match(tela, /noValidate/);
  assert.doesNotMatch(tela, /\srequired\b/);
  // ⚠️ Os registros de antes continuam listados e abrindo para edição.
  assert.match(tela, /dadosBancariosDaForma/);
  assert.match(tela, /Editar/);
});

test("a API resolve o principal POR TIPO, para conta e PIX conviverem", async () => {
  const fonte = await readFile(
    new URL("../netlify/functions/supplier-payment-methods.mts", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /limparPrincipalDoTipo/);
  // O limpar é restrito ao mesmo `kind`: gravar conta e PIX principais na mesma
  // passada não faz um apagar a marcação do outro.
  assert.match(
    fonte,
    /limparPrincipalDoTipo[\s\S]{0,400}eq\(supplierPaymentMethods\.kind, kind\)/,
  );
  assert.match(fonte, /limparPrincipalDoTipo\(tx, supplierId, payload\.kind\)/);
  // ⚠️ O kind continua sendo "bank" e "pix": nada é convertido.
  assert.match(fonte, /allowedKinds = new Set\(\["pix", "bank"\]\)/);
});

/* -------------------------------------------------------------------------
 * 2. A LISTA DE BANCOS ROLA ATÉ O FIM -- no computador e no iPad
 * ---------------------------------------------------------------------- */

test("a caixa rolável compartilhada rola por dentro e avisa que há mais abaixo", async () => {
  const fonte = await readFile(
    new URL("../src/components/comuns/ListaRolavel.jsx", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /className=\{`lista-rolavel /);
  // A medição é o que liga e desliga o aviso de "mais abaixo".
  assert.match(fonte, /scrollHeight - elemento\.clientHeight/);
  assert.match(fonte, /onScroll=/);
  assert.match(fonte, /mais abaixo — role a lista/);
  // O aviso não pode roubar o toque de quem está rolando.
  assert.match(fonte, /pointer-events-none/);
});

test("o CSS da lista rolável tem rolagem por toque, barra visível e overscroll contido", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const regra = css.slice(css.indexOf(".lista-rolavel {"));
  assert.match(regra, /overflow-y: auto/);
  // iPad: rolagem por toque, sem arrastar a página de trás.
  assert.match(regra, /overscroll-behavior: contain/);
  assert.match(regra, /-webkit-overflow-scrolling: touch/);
  assert.match(regra, /touch-action: pan-y/);
  // Computador: barra sempre visível -- é ela que denuncia que há mais item.
  assert.match(regra, /scrollbar-width: thin/);
  assert.match(regra, /\.lista-rolavel::-webkit-scrollbar \{/);
  assert.match(regra, /\.lista-rolavel::-webkit-scrollbar-thumb \{/);
});

test("o seletor de banco dos documentos usa a caixa rolável e não cancela o gesto", async () => {
  const fonte = await readFile(
    new URL("../src/components/processos/SeletorBanco.jsx", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /import ListaRolavel from "\.\.\/comuns\/ListaRolavel\.jsx"/);
  assert.match(fonte, /<ListaRolavel/);
  // ⚠️ A CAUSA DO BUG NO IPAD: `preventDefault` no item cancelava o arrasto, e
  // com isso a lista não rolava com o dedo. Ele não pode voltar.
  const itens = semComentarios(fonte.slice(fonte.indexOf("<ListaRolavel")));
  assert.doesNotMatch(itens, /preventDefault/);
  // O fim da lista é alcançável e é dito com letras.
  assert.match(fonte, /Fim da lista/);
  // O limite de desenho deixou de esconder a maior parte do cadastro.
  const limite = Number(/LIMITE_DA_LISTA = (\d+)/.exec(fonte)?.[1] ?? 0);
  assert.ok(limite >= 300, `o limite da lista ficou baixo: ${limite}`);
});

test("a lista do cadastro de bancos usa a mesma caixa rolável e marca o fim", async () => {
  const fonte = await readFile(
    new URL("../src/components/configuracoes/BlocoBancos.jsx", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /import ListaRolavel from "\.\.\/comuns\/ListaRolavel"/);
  assert.match(fonte, /<ListaRolavel/);
  // Nenhuma caixa com altura limitada sem a rolagem da classe compartilhada.
  assert.doesNotMatch(fonte, /max-h-72 divide-y[\s\S]{0,60}overflow-y-auto/);
  assert.match(fonte, /Fim da lista/);
});

/* -------------------------------------------------------------------------
 * 3. O PROCESSO HERDA OS DADOS DE PAGAMENTO DO CADASTRO
 * ---------------------------------------------------------------------- */

test("escolher o fornecedor preenche banco, agência, conta, PIX e titular", () => {
  const sugerido = dadosDePagamentoSugeridos([CONTA_CADASTRADA, PIX_CADASTRADO]);
  assert.equal(sugerido.banco_codigo, "001");
  assert.equal(sugerido.banco, "001 — Banco do Brasil");
  assert.equal(sugerido.agencia, "1234");
  assert.equal(sugerido.conta, "56789-0");
  assert.equal(sugerido.pix, "12345678000199");
  assert.equal(sugerido.titular, "Construtora Alfa LTDA");
});

test("cadastro com uma parte só preenche aquela parte, e não apaga a outra", () => {
  assert.deepEqual(dadosDePagamentoSugeridos([]), {});
  const soPix = dadosDePagamentoSugeridos([PIX_CADASTRADO]);
  assert.deepEqual(Object.keys(soPix).sort(), ["pix", "titular"]);
  const soConta = dadosDePagamentoSugeridos([CONTA_CADASTRADA]);
  assert.equal(soConta.pix, undefined);
  assert.equal(soConta.conta, "56789-0");
});

test("com mais de uma conta entra a PRINCIPAL, e a escolha é oferecida", () => {
  const segundaConta = {
    ...CONTA_CADASTRADA,
    id: "conta-2",
    bankCode: "237",
    bankName: "237 — Bradesco",
    agency: "5555",
    account: "999",
    accountDigit: "",
    isPrimary: false,
  };
  // A ordem de chegada não importa: a principal é a sugerida.
  const sugerido = dadosDePagamentoSugeridos([segundaConta, CONTA_CADASTRADA]);
  assert.equal(sugerido.banco, "001 — Banco do Brasil");
  assert.equal(sugerido.conta, "56789-0");

  // E a tela oferece a troca, com a principal em primeiro lugar.
  assert.equal(precisaEscolherPagamento([segundaConta, CONTA_CADASTRADA]), true);
  const opcoes = opcoesDePagamentoDoFornecedor([segundaConta, CONTA_CADASTRADA]);
  assert.equal(opcoes[0].principal, true);
  assert.match(opcoes[0].rotulo, /Principal$/);

  // Duas chaves PIX também são uma escolha.
  assert.equal(
    precisaEscolherPagamento([PIX_CADASTRADO, { ...PIX_CADASTRADO, id: "pix-2", pixKey: "outra", isPrimary: false }]),
    true,
  );
  // Uma conta e um PIX não são: os dois entram no papel juntos.
  assert.equal(precisaEscolherPagamento([CONTA_CADASTRADA, PIX_CADASTRADO]), false);
  assert.equal(precisaEscolherPagamento([]), false);
});

test("a herança acontece ao ESCOLHER o fornecedor, e não ao reabrir o documento", async () => {
  const fonte = await readFile(
    new URL("../src/components/processos/ModalProcessoServico.jsx", import.meta.url),
    "utf8",
  );
  // A marca é posta na escolha do fornecedor...
  assert.match(
    fonte,
    /function puxarFornecedor[\s\S]{0,900}puxarPagamentoDoCadastroRef\.current = String\(fornecedor\?\.id \?\? ""\)/,
  );
  // ...e consumida UMA vez, quando as formas de pagamento chegam.
  assert.match(
    fonte,
    /puxarPagamentoDoCadastroRef\.current === String\(fornecedorId\)[\s\S]{0,200}puxarPagamentoDoCadastroRef\.current = null/,
  );
  assert.match(fonte, /dadosDePagamentoSugeridos\(Array\.isArray\(formas\) \? formas : \[\]\)/);
  // A troca continua oferecida na página 2.
  assert.match(fonte, /escolhaDePagamentoNecessaria/);
  assert.match(fonte, /Qual conta ou chave PIX vai no documento/);
});

test("a diária herda os dados de pagamento do servidor do cadastro", () => {
  const dados = dadosDoServidorParaDocumento({
    id: "serv-1",
    nome: "Maria da Silva",
    cpf: "111.222.333-44",
    banco_codigo: "104",
    banco: "104 — Caixa Econômica Federal",
    agencia: "0987",
    conta: "112233-4",
    pix: "111.222.333-44",
    pix_titular: "Maria da Silva",
  });
  assert.equal(dados.banco_codigo, "104");
  assert.equal(dados.banco, "104 — Caixa Econômica Federal");
  assert.equal(dados.agencia, "0987");
  assert.equal(dados.conta, "112233-4");
  assert.equal(dados.pix, "111.222.333-44");
  assert.equal(dados.titular, "Maria da Silva");
  // Sem titular do PIX cadastrado, o titular impresso é o nome do servidor.
  assert.equal(
    dadosDoServidorParaDocumento({ id: "serv-2", nome: "João Souza" }).titular,
    "João Souza",
  );
});

test("editar no documento não volta para o cadastro do fornecedor nem do servidor", async () => {
  const servico = await readFile(
    new URL("../src/components/processos/ModalProcessoServico.jsx", import.meta.url),
    "utf8",
  );
  const diaria = await readFile(
    new URL("../src/components/processos/ModalProcessoDiaria.jsx", import.meta.url),
    "utf8",
  );
  // A cópia é num só sentido: nenhuma das duas telas grava forma de pagamento,
  // servidor ou fornecedor.
  [servico, diaria].forEach((fonte) => {
    const tela = semComentarios(fonte);
    assert.doesNotMatch(tela, /salvarFormaPagamento|salvarDadosBancarios|excluirFormaPagamento/);
    assert.doesNotMatch(tela, /from\("fornecedores"\)|from\("servidores"\)/);
  });
  assert.match(servico, /Editar aqui não altera o cadastro do fornecedor/);
});

/* -------------------------------------------------------------------------
 * TRAVA DE NÃO REGRESSÃO -- nada disto é financeiro
 * ---------------------------------------------------------------------- */

test("nada do que foi tocado mexe em saldo, baixa, pagamento ou programação", async () => {
  const arquivos = [
    "../src/lib/dadosBancariosUnificados.js",
    "../src/lib/dadosPagamentoFornecedor.js",
    "../src/components/comuns/ListaRolavel.jsx",
    "../src/components/fornecedores/DadosParaPagamento.jsx",
    "../src/components/processos/SeletorBanco.jsx",
    "../src/components/configuracoes/BlocoBancos.jsx",
  ];
  const proibidos = [
    /from\("pagamentos"\)/,
    /from\("programacao/,
    /from\("baixas/,
    /from\("contas_bancarias"\)/,
    /saldo_atual/,
    /registrarBaixa|darBaixa|debitarConta/,
  ];

  for (const caminho of arquivos) {
    const fonte = await readFile(new URL(caminho, import.meta.url), "utf8");
    const tela = semComentarios(fonte);
    for (const proibido of proibidos) {
      assert.doesNotMatch(tela, proibido, `${caminho} não pode tocar em ${proibido}`);
    }
  }
});
