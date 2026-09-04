// Testes de dois defeitos de tela, sem mudança de regra em nenhum dos dois:
//
//   1. ABRIR CERTIDÕES COMO ADMINISTRADOR AVISAVA "VOCÊ NÃO TEM PERMISSÃO PARA
//      FAZER ISSO." -- e as 255 certidões apareciam normalmente logo abaixo. O
//      aviso vinha da varredura de alertas de vencimento, que GRAVA em
//      public.notificacoes ao abrir a tela: a recusa do banco a essa gravação
//      era traduzida para a frase de permissão e mostrada como se a pessoa não
//      pudesse ver o módulo.
//
//   2. NA PROGRAMAÇÃO DIÁRIA, "Execução da programação" e "Transferir entre
//      contas" abriam expandidas.
//
// O que estes testes travam:
//
//   RECUSA DE PERMISSÃO DA VARREDURA NÃO VIRA AVISO DE TELA
//   MIGRATION AUSENTE E FALHA DE REDE CONTINUAM AVISANDO
//   A TELA CONTINUA TENDO ONDE MOSTRAR AVISO DE VARREDURA
//   ALERTA DE EMISSÃO JÁ SUPERADA NÃO CHEGA AO PAINEL
//   AS DUAS SEÇÕES DA PROGRAMAÇÃO ABREM RECOLHIDAS
//   RECOLHER NÃO DESMONTA NADA E NÃO MUDA REGRA FINANCEIRA
//
// A varredura vive num módulo que fala com o Supabase e não pode ser importado
// aqui; o que é dela é travado pelo texto do arquivo, que é o que garante que
// nenhuma das quatro chamadas voltou a mandar a recusa para a tela.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { ehRecusaDePermissao, mensagemAmigavel } from "../src/lib/erros.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const ALERTAS = "src/lib/alertasCertidoes.js";
const NOTIFICACOES = "src/lib/notificacoes.js";
const TELA_CERTIDOES = "src/pages/Certidoes.jsx";
const PAINEL = "src/components/pagamentos/PainelExecucaoProgramacao.jsx";
const PAGINA_PAGAMENTOS = "src/pages/PagamentosRedesenhado.jsx";

/** Corpo de `sincronizarAlertasCertidoes`, que é a varredura de abertura da tela. */
function corpoDaVarredura(fonte) {
  const inicio = fonte.indexOf("export async function sincronizarAlertasCertidoes(");
  assert.ok(inicio > 0, "sincronizarAlertasCertidoes não encontrada");
  return fonte.slice(inicio);
}

// ---------------------------------------------------------------------------
// 1. A recusa que produzia o aviso
// ---------------------------------------------------------------------------

test("a frase do relato é exatamente o que 42501 e 403 produzem", () => {
  // Confirma de onde vinha o texto: qualquer recusa do banco chegando à tela
  // por este caminho aparece como o aviso relatado.
  assert.equal(mensagemAmigavel({ code: "42501" }, "Padrão"), "Você não tem permissão para fazer isso.");
  assert.equal(mensagemAmigavel({ status: 403 }, "Padrão"), "Você não tem permissão para fazer isso.");
});

test("recusa de permissão é reconhecida por código e por texto do RLS", () => {
  assert.equal(ehRecusaDePermissao({ code: "42501" }), true);
  assert.equal(ehRecusaDePermissao({ status: 403 }), true);
  assert.equal(ehRecusaDePermissao({ code: "403" }), true);
  // O insert barrado pelo RLS de public.notificacoes.
  assert.equal(
    ehRecusaDePermissao({ message: 'new row violates row-level security policy for table "notificacoes"' }),
    true,
  );
  assert.equal(ehRecusaDePermissao({ message: "permission denied for table notificacoes" }), true);
});

test("o que não é recusa de permissão continua não sendo", () => {
  // Migration ainda não aplicada: quem administra precisa saber.
  assert.equal(ehRecusaDePermissao({ code: "42703" }), false);
  assert.equal(ehRecusaDePermissao({ code: "PGRST204" }), false);
  // Rede, duplicidade, sessão expirada e falha sem código nenhum.
  assert.equal(ehRecusaDePermissao({ message: "Failed to fetch" }), false);
  assert.equal(ehRecusaDePermissao({ code: "23505" }), false);
  assert.equal(ehRecusaDePermissao({ code: "PGRST301" }), false);
  assert.equal(ehRecusaDePermissao(null), false);
  assert.equal(ehRecusaDePermissao(new Error("Deu ruim")), false);
});

// ---------------------------------------------------------------------------
// 2. A varredura de abertura da tela de Certidões
// ---------------------------------------------------------------------------

test("nenhuma das chamadas da varredura manda a recusa direto para a tela", async () => {
  const varredura = corpoDaVarredura(await read(ALERTAS));

  // As quatro gravações/leituras da varredura passam pela triagem.
  assert.match(varredura, /leitura das pendências gravadas/);
  assert.match(varredura, /criação de pendências/);
  assert.match(varredura, /atualização de pendência/);
  assert.match(varredura, /remoção de pendências já resolvidas/);
  assert.match(varredura, /leitura das pendências ativas/);
  assert.equal(varredura.match(/avisoDaVarredura\(/g)?.length, 5);

  // Nenhuma delas escapa pelo caminho antigo.
  assert.doesNotMatch(varredura, /mensagemAmigavel\(/);
  // O insert é feito por notificar(), que já formatava a mensagem por conta
  // própria: a triagem tem de chegar até lá.
  assert.match(varredura, /notificar\(novas, \{\s*\n?\s*aoFalhar:/);
});

test("a triagem separa migration ausente, recusa de permissão e o resto", async () => {
  const fonte = await read(ALERTAS);
  const inicio = fonte.indexOf("export function avisoDaVarredura(");
  assert.ok(inicio > 0, "avisoDaVarredura não encontrada");
  const triagem = fonte.slice(inicio, fonte.indexOf("\n}", inicio));

  // Estrutura ausente ganha aviso de tela antes de qualquer outra coisa.
  assert.ok(triagem.indexOf("erroDeEstrutura") < triagem.indexOf("ehRecusaDePermissao"));
  // Recusa de permissão vira registro no console, não aviso de tela.
  assert.match(triagem, /console\.warn/);
  assert.match(triagem, /ehRecusaDePermissao\(erro\)[\s\S]*return null;/);
  // Qualquer outra falha continua sendo mostrada, como antes.
  assert.match(triagem, /return mensagemAmigavel\(erro, mensagemPadrao\);/);
  // A recusa não é engolida em silêncio: o nome da chamada vai para o console.
  assert.match(triagem, /chamada/);
});

test("notificar aceita a triagem de quem chamou e por padrão avisa como antes", async () => {
  const fonte = await read(NOTIFICACOES);
  assert.match(fonte, /export async function notificar\(linhas, \{ aoFalhar = null \} = \{\}\)/);
  assert.match(fonte, /if \(typeof aoFalhar === "function"\) return aoFalhar\(error\);/);
  // Quem não passa nada recebe exatamente a mensagem de sempre: os avisos de
  // tarefa não mudam de comportamento.
  assert.match(fonte, /Alguns avisos da equipe não foram gerados agora\./);
  assert.match(fonte, /return notificar\(novas\);/);
});

test("a tela de Certidões continua tendo onde mostrar aviso de varredura", async () => {
  const fonte = await read(TELA_CERTIDOES);
  // O aviso não foi removido da tela -- só deixou de ser gerado por recusa de
  // permissão. Migration ausente e falha de rede continuam aparecendo.
  assert.match(fonte, /erroAlertas/);
  assert.match(fonte, /setErroAlertas\(falha\)/);
  // A listagem continua vindo do mesmo carregamento de antes.
  assert.match(fonte, /listarCertidoes/);
  assert.match(fonte, /sincronizarAlertasCertidoes\(usuarioId, certidoes\)/);
});

test("pendência de emissão já superada não chega ao painel de alertas", async () => {
  const fonte = await read(ALERTAS);
  // O que vale é o cálculo da regra compartilhada, não o que está gravado: se a
  // remoção da pendência da emissão antiga não pôde ser feita, o painel ainda
  // assim não acusa "1 certidão vencida" de um FGTS já renovado.
  assert.match(fonte, /somenteVigentes/);
  assert.match(fonte, /function pendenciasQueAindaValem\(alertas, estagioPorCertidao, certidoes\)/);
  assert.match(fonte, /estagioPorCertidao\.has\(alerta\.certidao_id\)/);
  assert.match(fonte, /pendenciasQueAindaValem\(gravadosAgora, estagioPorCertidao, lista\)/);
  // Lista vazia (sem permissão de leitura) não esconde alerta nenhum.
  assert.match(fonte, /if \(\(certidoes \?\? \[\]\)\.length === 0\) return alertas \?\? \[\];/);
});

// ---------------------------------------------------------------------------
// 3. As seções recolhidas da Programação Diária
// ---------------------------------------------------------------------------

test("as duas seções da programação abrem recolhidas", async () => {
  const fonte = await read(PAINEL);
  assert.match(fonte, /const \[execucaoAberta, setExecucaoAberta\] = React\.useState\(false\);/);
  assert.match(fonte, /const \[transferenciasAbertas, setTransferenciasAbertas\] = React\.useState\(false\);/);
  // São duas seções irmãs, cada uma com o seu cabeçalho.
  assert.equal(fonte.match(/<CabecalhoRecolhivel/g)?.length, 2);
  assert.match(fonte, /titulo="Execução da programação"/);
  assert.match(fonte, /titulo="Transferir entre contas"/);
});

test("o cabeçalho é clicável e anuncia se está aberto", async () => {
  const fonte = await read(PAINEL);
  const inicio = fonte.indexOf("function CabecalhoRecolhivel(");
  assert.ok(inicio > 0, "CabecalhoRecolhivel não encontrado");
  const cabecalho = fonte.slice(inicio);
  // O cabeçalho inteiro é o botão: clicar em qualquer parte dele alterna.
  assert.match(cabecalho, /<button/);
  assert.match(cabecalho, /onClick=\{onAlternar\}/);
  assert.match(cabecalho, /aria-expanded=\{aberta\}/);
  assert.match(cabecalho, /aria-controls=\{id\}/);
  assert.match(cabecalho, /ChevronUp|ChevronDown/);
  assert.match(fonte, /setExecucaoAberta\(\(valor\) => !valor\)/);
  assert.match(fonte, /setTransferenciasAbertas\(\(valor\) => !valor\)/);
});

test("recolher esconde por CSS e não desmonta o conteúdo", async () => {
  const fonte = await read(PAINEL);
  // Escondido por classe, nunca retirado da árvore: o que estiver marcado, a
  // conta escolhida para o lote e o que já foi atribuído sobrevivem a recolher.
  assert.match(fonte, /id="execucao-da-programacao" className=\{`[^`]*\$\{execucaoAberta \? "" : "hidden"\}`\}/);
  assert.match(fonte, /id="transferir-entre-contas" className=\{`[^`]*\$\{transferenciasAbertas \? "" : "hidden"\}`\}/);
  assert.doesNotMatch(fonte, /\{execucaoAberta &&/);
  assert.doesNotMatch(fonte, /\{transferenciasAbertas &&/);
  // O estado do lote continua acima do trecho recolhível, no componente.
  assert.match(fonte, /const \[marcados, setMarcados\] = React\.useState\(\(\) => new Set\(\)\);/);
  assert.match(fonte, /const \[contaEmLote, setContaEmLote\] = React\.useState\(""\);/);
});

test("nada da lógica de execução e de transferência mudou", async () => {
  const fonte = await read(PAINEL);
  // Mesmos cálculos, mesmas ações, mesmas permissões de antes.
  assert.match(fonte, /contasAtribuiveis\(\{ contas, contasSelecionadas, secretariaId \}\)/);
  assert.match(fonte, /resumoExecucao\(pagamentos, disponiveis\)/);
  assert.match(fonte, /permissoes\.definir_conta_pagamento !== false && permissoes\.executar_programacao !== false/);
  assert.match(fonte, /onClick=\{onTransferir\}/);
  assert.match(fonte, /permissoes\.executar_transferencia === false/);
  assert.match(fonte, /permissoes\.estornar_transferencia !== false/);
  assert.match(fonte, /onEstornar\?\.\(item\)/);
  assert.match(fonte, /Estornar/);
  assert.match(fonte, /onAtribuirAosSelecionados\?\.\(\[\.\.\.marcados\], Number\(contaEmLote\)\)/);
  assert.match(fonte, /onAplicarATodos\?\.\(Number\(contaEmLote\)\)/);

  // Regras financeiras intocáveis, ainda escritas na tela.
  assert.match(fonte, /Definir a conta não debita nada/);
  assert.match(fonte, /o débito acontece na baixa/);
  assert.match(fonte, /Transferência entre contas próprias não é despesa/);
  assert.match(fonte, /ela é estornada/);
});

test("a programação monta o painel do mesmo jeito de antes", async () => {
  const fonte = await read(PAGINA_PAGAMENTOS);
  // O recolhimento é interno ao painel: a página não ganhou prop nem estado.
  assert.match(fonte, /<PainelExecucaoProgramacao/);
  assert.match(fonte, /onTransferir=\{abrirTransferencia\}/);
  assert.match(fonte, /onEstornar=\{abrirEstorno\}/);
  assert.doesNotMatch(fonte, /execucaoAberta|transferenciasAbertas/);
  // Salvar e aprovar continuam onde estavam.
  assert.match(fonte, /confirmarAprovacao/);
  assert.match(fonte, /ModalAprovacaoProgramacao/);
});
