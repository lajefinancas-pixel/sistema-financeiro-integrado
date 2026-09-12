// O ENCAMINHAMENTO DA PREFEITA: "À SECRETARIA DE ______".
//
// É o campo do despacho da prefeita, no fim da Requisição e da
// Liquidação/Solicitação de Pagamento: a secretaria a quem ela ENCAMINHA o
// processo para as providências. Ele não pode sair em branco no papel, e é
// sempre uma das secretarias que TÊM FINANCEIRO -- Finanças, Saúde, Assistência
// Social, Educação --, porque é lá que o processo continua.
//
// ⚠️ ESTA NÃO É A SECRETARIA SOLICITANTE. Quem SOLICITA vem do cadastro próprio
// do módulo Processos (`processos_secretarias_solicitantes`) e pode ser qualquer
// secretaria do município; quem recebe o encaminhamento é uma das que têm
// financeiro. Uma pede, a outra providencia -- e quase nunca são a mesma.
//
// ⚠️ APENAS LEITURA DO CADASTRO DO FINANCEIRO. As secretarias oferecidas são as
// de `public.secretarias`, o MESMO cadastro que Saldos das Contas e Pagamentos
// Diários usam. Nada aqui cria, altera ou apaga secretaria nenhuma: o módulo
// Processos só consulta a lista. Ler do cadastro é também o que garante que uma
// secretaria com financeiro criada amanhã apareça sozinha na escolha, sem
// ninguém mexer em código.
//
// ⚠️ UMA ESCOLHA POR FOLHA, COM PADRÃO PRÓPRIO. A requisição e a liquidação não
// vão para o mesmo lugar, então cada folha tem o campo dela:
//
//   REQUISIÇÃO  -> `despacho_secretaria`; sugere a própria SOLICITANTE quando
//                  ela tem financeiro, e Finanças quando não tem;
//   LIQUIDAÇÃO  -> `encaminhar_secretaria_id`/`_nome`; sugere FINANÇAS, que é
//                  quem paga e é o que o modelo oficial já traz impresso.
//
// Trocar uma NÃO arrasta a outra, e as duas seguem editáveis até a finalização.
// Processo criado antes disto tem só um campo preenchido: cada folha cai no
// campo do outro antes de cair em Finanças, e por isso o papel já emitido
// continua saindo exatamente como saía.
//
// ⚠️ O CONGELAMENTO CONTINUA VALENDO. O processo grava dentro dele o NOME da
// secretaria escolhida, e é esse nome que o documento imprime. Renomear a
// secretaria no cadastro financeiro amanhã não reescreve o documento emitido
// hoje.
//
// Documental, não financeiro: nada aqui debita conta, dá baixa em NF, altera
// saldo, cria pagamento ou toca na Programação Diária.
//
// Carregado direto pelos testes: só funções puras, nada de React e nada de supabase.

/** As colunas que o processo grava com o encaminhamento escolhido. */
export const CAMPOS_ENCAMINHAMENTO = ["encaminhar_secretaria_id", "encaminhar_secretaria_nome"];

/**
 * A secretaria sugerida quando a solicitante NÃO tem financeiro.
 *
 * É Finanças que recebe o processo nesse caso -- e é ela que o modelo oficial da
 * Liquidação já traz impresso ("À SECRETARIA DE FINANÇAS").
 */
export const ENCAMINHAMENTO_PADRAO = "Finanças";

function texto(valor) {
  return String(valor ?? "").trim();
}

function semAcento(valor) {
  return texto(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * O NÚCLEO do nome da secretaria: "Educação", e não "Secretaria Municipal de
 * Educação".
 *
 * A frase do despacho já diz "À SECRETARIA DE", então o que entra
 * depois dela é só o complemento. Sem isto o papel sairia "À SECRETARIA
 * MUNICIPAL DE SECRETARIA MUNICIPAL DE EDUCAÇÃO".
 */
export function nucleoDaSecretaria(nome) {
  return texto(nome)
    .replace(/^secretaria\s+municipal\s+d[eoa]s?\s+/i, "")
    .replace(/^secretaria\s+d[eoa]s?\s+/i, "")
    .replace(/^secretaria\s+municipal\s+/i, "")
    .replace(/^secretaria\s+/i, "")
    .trim();
}

/** A chave de comparação de duas secretarias: núcleo, sem acento e sem caixa. */
export function chaveDaSecretaria(nome) {
  return semAcento(nucleoDaSecretaria(nome));
}

/**
 * A lista que a escolha oferece: as secretarias do cadastro FINANCEIRO.
 *
 * Vem em ordem de nome, sem repetição e sem as inativas -- é a mesma leitura que
 * Saldos das Contas e Pagamentos Diários fazem. Cada item traz o `nucleo`, que é
 * o que vai impresso depois de "À SECRETARIA DE".
 */
export function secretariasParaEncaminhamento(secretariasFinanceiras = []) {
  const vistas = new Set();
  return (secretariasFinanceiras ?? [])
    .filter((s) => {
      if (s?.ativo === false) return false;
      const nome = texto(s?.nome);
      if (nome === "") return false;
      const chave = chaveDaSecretaria(nome);
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    })
    .map((s) => ({ id: s.id ?? null, nome: texto(s.nome), nucleo: nucleoDaSecretaria(s.nome) }))
    .sort((a, b) => semAcento(a.nome).localeCompare(semAcento(b.nome)));
}

/** A secretaria da lista que tem este id (ou nada, quando o id não está lá). */
export function encontrarEncaminhamento(secretarias = [], id) {
  const procurado = String(id ?? "");
  if (procurado === "") return null;
  return secretariasParaEncaminhamento(secretarias).find((s) => String(s.id) === procurado) ?? null;
}

/** A secretaria da lista cujo nome bate com o procurado (Saúde = SECRETARIA DE SAÚDE). */
export function encaminhamentoPeloNome(secretarias = [], nome) {
  const chave = chaveDaSecretaria(nome);
  if (chave === "") return null;
  return secretariasParaEncaminhamento(secretarias).find((s) => chaveDaSecretaria(s.nome) === chave) ?? null;
}

/**
 * O que a escolha leva GRAVADO para o processo: o id e o nome.
 *
 * O nome é o congelamento -- é ele que o documento imprime. O id fica para a
 * tela remarcar a opção quando o processo é reaberto, e é gravado SEM chave
 * estrangeira: o cadastro financeiro não é travado nem alterado por causa disto.
 */
export function dadosDoEncaminhamentoParaDocumento(secretaria) {
  if (!secretaria) return { encaminhar_secretaria_id: null, encaminhar_secretaria_nome: "" };
  return {
    encaminhar_secretaria_id: secretaria.id ?? null,
    encaminhar_secretaria_nome: texto(secretaria.nome),
  };
}

/** A coluna onde a REQUISIÇÃO (página 1) guarda o encaminhamento dela. */
export const CAMPO_ENCAMINHAMENTO_REQUISICAO = "despacho_secretaria";

/**
 * O que a escolha da REQUISIÇÃO leva gravado: o nome da secretaria.
 *
 * A página 1 grava em `despacho_secretaria`, que é desde o começo a coluna do
 * despacho DESTA folha ("À SECRETARIA DE ____", na autorização da prefeita da
 * requisição). Ela guarda só o nome, e é esse nome que congela: renomear a
 * secretaria no cadastro financeiro amanhã não reescreve o documento de hoje.
 */
export function dadosDoEncaminhamentoDaRequisicao(secretaria) {
  return { [CAMPO_ENCAMINHAMENTO_REQUISICAO]: secretaria ? texto(secretaria.nome) : "" };
}

/**
 * A SUGESTÃO da criação, UMA POR FOLHA -- e elas são DIFERENTES de propósito.
 *
 * ⚠️ UMA SOLICITA, A OUTRA PAGA, e por isso cada folha nasce apontando para um
 * lugar:
 *
 *   REQUISIÇÃO  -> a própria secretaria SOLICITANTE quando ela tem financeiro
 *                  (o processo volta para a casa que pediu), senão Finanças;
 *   LIQUIDAÇÃO  -> FINANÇAS, sempre. É quem paga, é o que o modelo oficial já
 *                  traz impresso, e é o padrão pedido para esta folha.
 *
 * As duas saem na MESMA chamada porque as duas folhas nascem juntas, no mesmo
 * registro -- e as duas continuam editáveis, cada uma por conta própria, até a
 * finalização. Trocar o destino da requisição NÃO arrasta o da liquidação.
 */
export function sugerirEncaminhamento({ secretariasFinanceiras = [], nomeDaSolicitante = "" } = {}) {
  const lista = secretariasParaEncaminhamento(secretariasFinanceiras);
  const financas = encaminhamentoPeloNome(lista, ENCAMINHAMENTO_PADRAO);
  const solicitante = encaminhamentoPeloNome(lista, nomeDaSolicitante);

  return {
    // A página 1: a solicitante com financeiro, ou Finanças. Cadastro financeiro
    // ainda não lido: o papel sai com Finanças escrito, que é o destino de
    // sempre, em vez de sair em branco.
    ...dadosDoEncaminhamentoDaRequisicao(solicitante ?? financas ?? { nome: ENCAMINHAMENTO_PADRAO }),
    // A página 2: Finanças. Sem a secretaria no cadastro, o nome vai escrito e
    // sem id -- o campo não sai em branco no papel de jeito nenhum.
    ...(financas
      ? dadosDoEncaminhamentoParaDocumento(financas)
      : { encaminhar_secretaria_id: null, encaminhar_secretaria_nome: ENCAMINHAMENTO_PADRAO }),
  };
}

/**
 * A sugestão de QUEM PAGA, isolada: FINANÇAS.
 *
 * É o que a folha de LIQUIDAÇÃO usa. As DIÁRIAS chamam esta, e não a de cima,
 * porque a Requisição de Diárias não tem despacho da prefeita -- ela tem as três
 * assinaturas empilhadas, e nenhum "À SECRETARIA DE" para preencher.
 */
export function sugerirEncaminhamentoDaLiquidacao({ secretariasFinanceiras = [] } = {}) {
  const financas = encaminhamentoPeloNome(
    secretariasParaEncaminhamento(secretariasFinanceiras),
    ENCAMINHAMENTO_PADRAO,
  );
  return financas
    ? dadosDoEncaminhamentoParaDocumento(financas)
    : { encaminhar_secretaria_id: null, encaminhar_secretaria_nome: ENCAMINHAMENTO_PADRAO };
}

/**
 * O COMPLEMENTO impresso depois de "À SECRETARIA DE ___" na REQUISIÇÃO.
 *
 * A ordem é a do congelamento, e é ela que faz processo antigo continuar
 * imprimindo o que sempre imprimiu:
 *
 *   1. a secretaria escolhida NESTA folha (`despacho_secretaria`);
 *   2. o encaminhamento único que o processo antigo gravou, de quando as duas
 *      folhas dividiam um só campo -- é isto que preserva o papel já emitido;
 *   3. a secretaria solicitante, como o documento fazia antes;
 *   4. Finanças, para o campo NUNCA sair em branco no papel.
 *
 * O núcleo é aplicado em todos os casos: o "À SECRETARIA DE" já está impresso no
 * quadro, e sem isto o papel sairia "À SECRETARIA DE SECRETARIA DE EDUCAÇÃO".
 */
export function complementoDoEncaminhamento(processo, nomeDaSolicitante = "") {
  const daFolha = nucleoDaSecretaria(processo?.[CAMPO_ENCAMINHAMENTO_REQUISICAO]);
  if (daFolha !== "") return daFolha;

  const legado = nucleoDaSecretaria(processo?.encaminhar_secretaria_nome);
  if (legado !== "") return legado;

  const solicitante = nucleoDaSecretaria(nomeDaSolicitante);
  if (solicitante !== "") return solicitante;

  return ENCAMINHAMENTO_PADRAO;
}

/**
 * O COMPLEMENTO impresso depois de "À SECRETARIA DE ___" na LIQUIDAÇÃO.
 *
 * A folha de quem PAGA tem o destino DELA, e o padrão é Finanças:
 *
 *   1. a secretaria escolhida NESTA folha (`encaminhar_secretaria_nome`);
 *   2. o despacho escrito no campo antigo, para o processo que só tem ele
 *      continuar imprimindo o que sempre imprimiu;
 *   3. Finanças, que é o que o modelo oficial traz e o que esta folha nunca
 *      deixa de ter.
 *
 * ⚠️ Ela NÃO cai na secretaria solicitante: quem solicita não é quem paga.
 */
export function complementoDoEncaminhamentoDaLiquidacao(processo) {
  const daFolha = nucleoDaSecretaria(processo?.encaminhar_secretaria_nome);
  if (daFolha !== "") return daFolha;

  const legado = nucleoDaSecretaria(processo?.[CAMPO_ENCAMINHAMENTO_REQUISICAO]);
  if (legado !== "") return legado;

  return ENCAMINHAMENTO_PADRAO;
}

/**
 * O destino impresso na autorização da LIQUIDAÇÃO: "SECRETARIA DE FINANÇAS".
 *
 * O modelo oficial já vem com Finanças, e Finanças continua sendo o padrão: sem
 * escolha gravada, o documento sai palavra por palavra como sempre saiu. Com
 * escolha gravada, sai a secretaria escolhida.
 */
export function destinoDaLiquidacao(processo) {
  return `SECRETARIA DE ${complementoDoEncaminhamentoDaLiquidacao(processo)}`.toUpperCase();
}

/**
 * O destino escrito como as DIÁRIAS o escrevem: "Secretaria Municipal de Finanças".
 *
 * A folha da liquidação de diárias traz a frase inteira ("À Secretaria Municipal
 * de Finanças, para as providências de pagamento."), em caixa normal -- e não em
 * maiúsculas como a de serviços. Finanças continua sendo o padrão: sem escolha
 * gravada, a frase sai palavra por palavra como sempre saiu.
 */
export function secretariaMunicipalDoEncaminhamento(processo) {
  return `Secretaria Municipal de ${complementoDoEncaminhamentoDaLiquidacao(processo)}`;
}

/** O rótulo que a tela mostra para o encaminhamento da LIQUIDAÇÃO. */
export function rotuloDoEncaminhamento(processo) {
  const gravado = texto(processo?.encaminhar_secretaria_nome);
  return gravado === "" ? "" : gravado;
}
