// Mensagens de falha do módulo PROCESSOS, escritas para quem opera a tela.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// O 22P02 já aparece no módulo Processos pela QUARTA VEZ com a mesma origem: uma
// coluna cujo tipo real não é o que o código assumiu. Nas três primeiras, a tela
// dizia ao operador que "o erro completo está no console do navegador (F12)" --
// o que não ajuda ninguém no balcão: a pessoa não abre o console, e se abrisse
// não teria o que fazer com o que está lá. O resultado prático era refazer o
// preenchimento várias vezes procurando um erro de digitação que não existia.
//
// Aqui a recusa por tipo passa a dizer as quatro coisas que a pessoa precisa
// saber: NÃO FOI ELA, NADA FOI GRAVADO, MEXER NO QUE DIGITOU NÃO RESOLVE e A
// QUEM AVISAR -- com o nome do arquivo que corrige, porque as migrations deste
// sistema são rodadas à mão no SQL Editor do Supabase e a pergunta seguinte do
// administrador é sempre "qual arquivo eu rodo?".
//
// PROCESSOS É DOCUMENTAL: nada neste arquivo grava, altera ou lê pagamento,
// baixa, nota, saldo, conta ou programação. Ele só transforma erro em frase.

import { mensagemAmigavel } from "./erros.js";

/**
 * A migration que blinda os tipos do módulo e corrige a coluna do
 * encaminhamento. Rodada À MÃO no SQL Editor do Supabase.
 */
export const MIGRATION_BLINDAGEM_PROCESSOS =
  "supabase/migrations/20260912200000_processos_blindagem_de_tipos_e_encaminhamento.sql";

/** Códigos em que o banco recusou por TIPO, não pelo valor digitado. */
const CODIGOS_DE_TIPO = new Set(["22P02", "42804"]);

/** true quando a recusa é de tipo de coluna (22P02/42804). */
export function ehRecusaDeTipo(erro) {
  const codigo = String(erro?.code ?? "");
  if (CODIGOS_DE_TIPO.has(codigo)) return true;
  return /invalid input (syntax|value) for|cannot be matched|invalid_text_representation/i.test(
    String(erro?.message ?? ""),
  );
}

/**
 * Mensagem de falha de uma ação dos Processos.
 *
 * Recusa por tipo ganha a explicação completa, com o que fazer e o arquivo que
 * corrige. Todo o resto segue por `mensagemAmigavel`, que já traduz permissão,
 * sessão expirada, falta de conexão e as mensagens que as próprias funções do
 * banco escrevem (P0001) -- inclusive a nova, que diz em que ETAPA quebrou.
 *
 * @param erro          o que foi capturado no catch
 * @param mensagemPadrao o que dizer quando a falha é técnica e desconhecida,
 *                       ex: "Não foi possível salvar as alterações."
 */
export function mensagemFalhaDoProcesso(erro, mensagemPadrao) {
  if (ehRecusaDeTipo(erro)) {
    const codigo = String(erro?.code ?? "22P02");
    return (
      `${mensagemPadrao} O banco recusou a gravação porque uma coluna está com tipo diferente do que o ` +
      `sistema espera (código ${codigo}). NÃO É O QUE VOCÊ DIGITOU, e nada foi gravado, finalizado ou ` +
      "alterado: o processo continua como estava e nenhum saldo, baixa, NF ou programação foi tocado. " +
      "O QUE FAZER: não refaça o preenchimento, porque não vai resolver. Avise quem administra o sistema " +
      `para rodar a migration ${MIGRATION_BLINDAGEM_PROCESSOS} no SQL Editor do Supabase; depois disso ` +
      "basta recarregar a página e salvar de novo."
    );
  }
  return mensagemAmigavel(erro, mensagemPadrao);
}
