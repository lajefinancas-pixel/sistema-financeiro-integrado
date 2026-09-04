// Rodapé sempre alcançável nos modais que receberam a lista de contas.
//
// Depois do Envio 3, a lista de contas agrupada por Secretaria passou a abrir
// todas as secretarias de uma vez dentro do modal de registrar baixa. O modal
// crescia junto com a lista, o rodapé saía da área visível e o botão
// "Confirmar baixa" ficava inalcançável: nenhuma baixa podia ser registrada.
//
// A moldura correta é sempre a mesma, na baixa e na transferência:
//
//   MOLDURA -> coluna flex com altura máxima igual à da janela, para o modal
//              nunca passar da altura da tela;
//   CORPO   -> a única parte que rola (flex-1 + min-h-0 + overflow-y-auto);
//   CABEÇALHO e RODAPÉ -> shrink-0, portanto fixos: o botão de confirmar fica
//              visível por maior que seja a lista de contas;
//   LISTA   -> rolagem interna própria, com altura máxima que também respeita
//              janelas baixas (notebook, iPad e celular).
//
// Nada aqui mexe em regra: a baixa continua abatendo o valor em aberto e
// continua NÃO debitando o saldo da conta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const BAIXA = "src/components/baixas/ModalRegistrarBaixa.jsx";
const TRANSFERENCIA = "src/components/pagamentos/ModalTransferenciaEntreContas.jsx";

/** A classe do elemento cuja abertura contém `marca`. */
function classesDoBlocoCom(fonte, marca) {
  const inicio = fonte.indexOf(marca);
  assert.notEqual(inicio, -1, `bloco não encontrado: ${marca}`);
  const abertura = fonte.lastIndexOf("<", inicio);
  const trecho = fonte.slice(abertura, inicio + marca.length + 400);
  const classe = /className="([^"]+)"/.exec(trecho);
  assert.ok(classe, `sem className no bloco ${marca}`);
  return classe[1];
}

/** A moldura, o corpo rolável e o rodapé fixo de um modal. */
async function moldura(caminho) {
  const fonte = await read(caminho);
  const form = /<form[\s\S]{0,240}?className="([^"]+)"/.exec(fonte);
  assert.ok(form, `${caminho}: <form> sem className`);
  return { fonte, form: form[1] };
}

test("1. baixa: o modal caber na janela é o que devolve o botão de confirmar", async () => {
  const { fonte, form } = await moldura(BAIXA);

  // Coluna flex limitada pela altura da janela: o modal inteiro nunca passa da
  // tela, então sempre existe rodapé visível.
  for (const classe of ["flex", "flex-col", "max-h-full", "overflow-hidden"]) {
    assert.ok(form.split(/\s+/).includes(classe), `moldura da baixa sem "${classe}": ${form}`);
  }

  // O corpo é a única parte que rola. Sem min-h-0 o flex item não encolhe e o
  // rodapé volta a ser empurrado para fora.
  const corpo = classesDoBlocoCom(fonte, "sm:grid-cols-2");
  for (const classe of ["min-h-0", "flex-1", "overflow-y-auto"]) {
    assert.ok(corpo.split(/\s+/).includes(classe), `corpo da baixa sem "${classe}": ${corpo}`);
  }

  // Cabeçalho e rodapé fixos.
  const rodape = classesDoBlocoCom(fonte, "border-t border-black/5");
  assert.ok(rodape.split(/\s+/).includes("shrink-0"), `rodapé da baixa sem shrink-0: ${rodape}`);
  assert.match(fonte, /<div className="flex shrink-0 items-start justify-between border-b/);

  // O botão de confirmar mora no rodapé fixo, depois do corpo rolável.
  assert.ok(fonte.lastIndexOf("Confirmar baixa") > fonte.indexOf("min-h-0 flex-1"));

  // A lista de contas continua com rolagem interna e altura máxima própria.
  const altura = /altura="([^"]+)"/.exec(fonte);
  assert.ok(altura, "a baixa deixou de limitar a altura da lista de contas");
  assert.match(altura[1], /^max-h-\[/);
  assert.match(altura[1], /vh/, "a altura da lista também precisa acompanhar janelas baixas");
});

test("2. transferência entre contas: a mesma moldura, pelo mesmo motivo", async () => {
  const { fonte, form } = await moldura(TRANSFERENCIA);

  for (const classe of ["flex", "flex-col", "max-h-full", "overflow-hidden"]) {
    assert.ok(form.split(/\s+/).includes(classe), `moldura da transferência sem "${classe}": ${form}`);
  }

  const corpo = classesDoBlocoCom(fonte, "space-y-4 overflow-y-auto");
  for (const classe of ["min-h-0", "flex-1", "overflow-y-auto"]) {
    assert.ok(corpo.split(/\s+/).includes(classe), `corpo da transferência sem "${classe}": ${corpo}`);
  }

  const rodape = classesDoBlocoCom(fonte, "border-t border-black/5");
  assert.ok(rodape.split(/\s+/).includes("shrink-0"), `rodapé da transferência sem shrink-0: ${rodape}`);
  assert.ok(fonte.lastIndexOf("Confirmar transferência") > fonte.indexOf("min-h-0 flex-1"));

  // Nenhum dos dois modais rola no próprio <form>: quem rola é o corpo. Com o
  // form rolando, o rodapé dependeria de sticky e voltava a sumir em janelas
  // baixas.
  assert.doesNotMatch(form, /overflow-y-auto/);
  assert.doesNotMatch(fonte, /sticky (top|bottom)-0/);

  // As três listas de contas do modal seguem com altura máxima e rolagem.
  const alturas = [...fonte.matchAll(/altura="([^"]+)"/g)].map((achado) => achado[1]);
  assert.ok(alturas.length >= 2, "a transferência tem lista de destino e de origem");
  for (const altura of alturas) {
    assert.match(altura, /^max-h-\[/);
    assert.match(altura, /vh/);
  }
});

test("3. o que não muda: a baixa abate a nota e não debita o saldo da conta", async () => {
  const fonte = await read(BAIXA);

  // A gravação continua sendo a mesma chamada, com a mesma trava de repetição.
  assert.match(fonte, /registrarBaixaDeNota\(\{/);
  assert.match(fonte, /chaveIdempotencia: chaveIdempotencia\.current/);
  assert.match(fonte, /valorEmAbertoId: nota\.id/);

  // O aviso de que a baixa não mexe no saldo continua na tela.
  assert.match(fonte, /não altera o saldo da conta/);

  // A conferência que libera o botão continua sendo a regra compartilhada, e o
  // modal continua sem cadastrar conta.
  assert.match(fonte, /validarBaixaDeNota\(\{/);
  assert.match(fonte, /disabled=\{salvando \|\| !conferencia\.ok\}/);
  assert.doesNotMatch(fonte, /nova conta|cadastrar conta/i);
});
